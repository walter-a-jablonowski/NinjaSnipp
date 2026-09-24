<?php

namespace SnippetManager;

// The configured data sets and their source folders, plus every rule about paths:
// which data set is active, which source a relative path lives in or is written to,
// and which client-supplied paths are allowed at all.
//
// A data set ("Dev") merges several source folders ("Common", "Dev") into one tree.
// When the same relative path exists in several sources, the last source wins.
class Sources
{
  // label => [['path' => string, 'color' => string|null, 'subLabel' => string|null], ...]
  private array $dataSets;
  private string $currentLabel;
  // Source folders of the current data set, each with its data set 'label' added
  private array $folders;
  private string $appRoot;

  public function __construct( array $dataPaths, string $appRoot = '' )
  {
    $this->appRoot  = $appRoot !== '' ? rtrim(str_replace('\\', '/', $appRoot), '/') : '';
    $this->dataSets = $this->normalize($dataPaths);

    $this->select( array_key_first($this->dataSets) );
  }

  // Accepts three config formats: "label: path", "label: {subLabel: path}" and the
  // older "label: {path: color}"
  private function normalize( array $dataPaths ) : array
  {
    $normalized = [];

    foreach( $dataPaths as $key => $value )
    {
      if( is_string($key) )
      {
        $folders = [];

        if( is_string($value) )
          $folders[] = $this->folder($value);
        elseif( is_array($value) )
        {
          foreach( $value as $k => $v )
          {
            if( is_string($v) && strpos($v, '#') !== 0 )
              $folders[] = $this->folder($v, null, (string)$k);   // subLabel => path
            else
              $folders[] = $this->folder((string)$k, $v);         // path => color|null
          }
        }

        if( ! empty($folders) )
          $normalized[$key] = $folders;
      }
      elseif( is_string($value) && $value !== '' )              // numeric key: path is the label
      {
        $folder = $this->folder($value);
        $normalized[$folder['path']] = [$folder];
      }
    }

    return $normalized ?: ['data' => [$this->folder('data')]];
  }

  private function folder( string $path, ?string $color = null, ?string $subLabel = null ) : array
  {
    return ['path' => $this->absolute($path), 'color' => $color, 'subLabel' => $subLabel];
  }

  // Normalizes slashes; resolves relative paths against the app root so the result
  // does not depend on the process's current working directory
  private function absolute( string $path ) : string
  {
    $path = str_replace('\\', '/', $path);

    if( $path === '' || $this->appRoot === '' || $this->isAbsolutePath($path) )
      return $path;

    return "{$this->appRoot}/" . ltrim($path, '/');
  }

  private function isAbsolutePath( string $path ) : bool
  {
    return $path !== ''
      && ( $path[0] === '/'                            // unix abs or UNC
        || preg_match('#^[A-Za-z]:/#', $path) );       // windows drive (e.g. C:/)
  }

  // --- Data sets ---

  public function getDataSets() : array
  {
    return $this->dataSets;
  }

  public function select( string $label ) : bool
  {
    if( ! isset($this->dataSets[$label]) )
      return false;

    $this->currentLabel = $label;
    $this->folders      = array_map( fn($f) => $f + ['label' => $label], $this->dataSets[$label]);

    // Only for the data set in use: a typo in another set's config should not litter the
    // disk, and an unreachable drive should not emit a warning into a JSON response
    foreach( $this->folders as $folder )
      if( ! is_dir($folder['path']) )
        @mkdir($folder['path'], 0755, true);

    return true;
  }

  public function getCurrentLabel() : string
  {
    return $this->currentLabel;
  }

  // Source folders of the current data set, in config order (later ones win)
  public function getFolders() : array
  {
    return $this->folders;
  }

  public function getPaths() : array
  {
    return array_column($this->folders, 'path');
  }

  // The first source: the fallback for new items that have no better place
  public function getFirstPath() : string
  {
    return $this->folders[0]['path'] ?? '';
  }

  // path => display label; the sub label is preferred over the data set label
  public function getLabels() : array
  {
    $map = [];
    foreach( $this->folders as $folder )
      $map[$folder['path']] = $folder['subLabel'] ?? $folder['label'];
    return $map;
  }

  // --- Path rules ---

  // Traversal guard for every client-supplied relative path. An empty path is safe - it
  // just refers to the source folder itself; callers that need a name check separately.
  public function isSafeRelativePath( string $path ) : bool
  {
    $path = str_replace('\\', '/', $path);

    if( strpos($path, "\0") !== false || $this->isAbsolutePath($path) )
      return false;

    return ! preg_match('#(^|/)\.\.(/|$)#', $path);
  }

  // Throws for a path that is empty or leaves the source folder
  public function requireRelativePath( string $path ) : string
  {
    if( trim($path, '/') === '' || ! $this->isSafeRelativePath($path) )
      throw new \RuntimeException('Invalid path');

    return $path;
  }

  // Guards client-supplied base paths: only configured sources are accepted
  public function isKnownBase( string $base ) : bool
  {
    return in_array( $this->normalizeBase($base), array_map([$this, 'normalizeBase'], $this->getPaths()), true);
  }

  private function normalizeBase( string $base ) : string
  {
    return rtrim(str_replace('\\', '/', $base), '/');
  }

  // Validates a client-supplied source folder. Returns the normalized path, the first
  // source when none was given, or null when it is not a configured source.
  public function resolveBasePath( ?string $base ) : ?string
  {
    if( $base === null || $base === '' )
      return $this->getFirstPath();

    $base = $this->normalizeBase($base);
    return $this->isKnownBase($base) ? $base : null;
  }

  // Returns the source to write $relativePath to (last source wins): the one that contains
  // the item, else - for a new item - the one that contains its parent folder, else the first.
  // Without the parent step a new item in a folder that only exists in a later source would
  // land in the first source, in a second folder of the same name.
  public function resolveWritePath( string $relativePath ) : string
  {
    $relativePath = ltrim($relativePath, '/');
    $parentDir    = dirname($relativePath);
    $itemMatch    = null;
    $parentMatch  = null;

    foreach( $this->getPaths() as $base )
    {
      if( file_exists("$base/$relativePath") )
        $itemMatch = $base;
      if( $parentDir !== '.' && is_dir("$base/$parentDir") )
        $parentMatch = $base;
    }

    return $itemMatch ?? $parentMatch ?? $this->getFirstPath();
  }

  // The source to write to: an explicit one (which must be configured), else resolveWritePath()
  public function resolveTargetBase( ?string $base, string $relativePath ) : string
  {
    if( $base === null || $base === '' )
      return $this->resolveWritePath($relativePath);

    $resolved = $this->resolveBasePath($base);
    if( $resolved === null )
      throw new \RuntimeException('Invalid source folder');

    return $resolved;
  }

  // Full OS path of an existing file or folder (last source wins), or null. With $base
  // given, looks only inside that source - which must be a configured one.
  public function resolvePhysicalPath( string $relativePath, string $type = 'file', ?string $base = null ) : ?string
  {
    if( ! $this->isSafeRelativePath($relativePath) )
      return null;

    $bases = $this->getPaths();
    if( $base !== null && $base !== '' )
    {
      if( ! $this->isKnownBase($base) )
        return null;
      $bases = [$this->normalizeBase($base)];
    }

    $match = null;
    foreach( $bases as $b )
    {
      $abs = rtrim($b, '/') . '/' . ltrim($relativePath, '/');
      if( $type === 'folder' ? is_dir($abs) : is_file($abs) )
        $match = $abs;
    }

    return $match;
  }
}
