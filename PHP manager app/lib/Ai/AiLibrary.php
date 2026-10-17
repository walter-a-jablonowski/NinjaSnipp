<?php

namespace SnippetManager\Ai;

use RuntimeException;
use SnippetManager\FileTree;
use SnippetManager\SnippetManager;

// The current data set as the AI tools address it. An item is named by its path relative
// to the source folders (real names, ordinal prefixes included), the same in every source;
// a source by its label ("Common", "Dev"). The model never sees an absolute path.
//
// Where the same path exists in several sources the tree shows one entry (last source
// wins), or with nav.foldersMerged every file of that name - then the model has to name
// the source, as the user picks one in the tree.
class AiLibrary
{
  public SnippetManager $manager;
  private array $labels;              // base path => label

  public function __construct( SnippetManager $manager )
  {
    $this->manager = $manager;
    $this->labels  = $manager->sources->getLabels();
  }

  // A path from the model: forward slashes, no leading or trailing one
  public static function cleanPath( string $path ) : string
  {
    return trim(str_replace('\\', '/', trim($path)), '/');
  }

  // A name as the tree shows it, without the ordinal prefix (mirrors FileTreeController._displayName())
  public static function displayName( string $path ) : string
  {
    $name = basename($path);
    if( in_array(pathinfo($name, PATHINFO_EXTENSION), ['yml', 'md'], true) )
      $name = pathinfo($name, PATHINFO_FILENAME);

    return preg_replace('/^\d{2}[ _.\-]+/', '', $name);
  }

  // --- Sources ---

  public function labels() : array
  {
    return array_values($this->labels);
  }

  public function label( string $base ) : string
  {
    return $this->labels[rtrim($base, '/')] ?? basename($base);
  }

  public function base( string $label ) : string
  {
    $base = array_search($label, $this->labels, true);
    if( $base === false )
      throw new RuntimeException("Unknown source: $label. The sources are: " . implode(', ', $this->labels()));

    return $base;
  }

  // Other data sets that use the source too: a change there shows in all of them
  public function sharedWith( string $base ) : array
  {
    $current = $this->manager->sources->getCurrentLabel();
    return array_values( array_diff($this->manager->sources->dataSetsWith($base), [$current]));
  }

  // --- Items ---

  // Sources (config order) that have $path as a file, or as a folder with $folder
  public function basesOf( string $path, bool $folder = false ) : array
  {
    if( $path === '' )
      return $folder ? $this->manager->sources->getPaths() : [];

    return array_values( array_filter( $this->manager->sources->getPaths(), fn( $base ) =>
      $folder ? is_dir("$base/$path") : is_file("$base/$path")
    ));
  }

  public function isFolder( string $path ) : bool
  {
    return $this->basesOf($path, true) !== [];
  }

  // The source the tree shows an item from (last one wins), null when none has it
  public function shownBase( string $path, bool $folder = false ) : ?string
  {
    $bases = $this->basesOf($path, $folder);
    return $bases ? end($bases) : null;
  }

  // The source a file is read from and written to: $source (which must have it), the only
  // one that has it, or of several the last - the one the tree shows. With merged folders
  // the tree shows all of them, so the model has to say which.
  public function locateFile( string $path, ?string $source ) : string
  {
    $this->requireSafe($path);
    $bases = $this->basesOf($path);

    if( $source !== null )
    {
      $base = $this->base($source);
      if( ! in_array($base, $bases, true) )
        throw new RuntimeException("$path is not in source $source" . ($bases ? ' but in ' . $this->labelList($bases) : ''));
      return $base;
    }

    if( ! $bases )
      throw new RuntimeException("No snippet $path - check the path with tree_list or snippet_search");

    if( count($bases) > 1 && $this->manager->tree->isMerged() )
      throw new RuntimeException("$path exists in the sources " . $this->labelList($bases) . ' - pass source');

    return end($bases);                                      // the one the tree shows
  }

  // The sources a folder change applies to: $source, else every source that has the folder
  // when folders are merged (the tree shows them as one), else the one the tree shows
  public function folderBases( string $path, ?string $source ) : array
  {
    $this->requireSafe($path);
    $bases = $this->basesOf($path, true);

    if( ! $bases )
      throw new RuntimeException("No folder $path - check the path with tree_list");

    if( $source !== null )
    {
      $base = $this->base($source);
      if( ! in_array($base, $bases, true) )
        throw new RuntimeException("Folder $path is not in source $source but in " . $this->labelList($bases));
      return [$base];
    }

    return $this->manager->tree->isMerged() ? $bases : [end($bases)];
  }

  // The source a new item at $path goes to: $source, else the one source that has its
  // nearest existing parent folder. When several have it (always so at the root of a data
  // set with several sources) the model has to say which, as the UI asks the user.
  public function baseForNew( string $path, ?string $source ) : string
  {
    $this->requireSafe($path);

    if( $source !== null )
      return $this->base($source);

    $parent = dirname($path);
    $bases  = [];
    while( ! $bases )
    {
      $parent = $parent === '.' ? '' : $parent;
      $bases  = $this->basesOf($parent, true);
      $parent = dirname($parent);
    }

    if( count($bases) > 1 )
      throw new RuntimeException("$path could go to the sources " . $this->labelList($bases) . ' - pass source');

    return $bases[0];
  }

  // A snippet that exists: ['path', 'base', 'snippet']
  public function snippetAt( string $path, ?string $source ) : array
  {
    $base    = $this->locateFile($path, $source);
    $snippet = $this->manager->snippets->load($path, $base);

    if( $snippet === null )
      throw new RuntimeException("$path does not parse as YAML");

    return ['path' => $path, 'base' => $base, 'snippet' => $snippet];
  }

  // Every snippet of the data set, or below $folder: ['path', 'base', 'snippet' (null when
  // it does not parse)]. A file shown in several places through links is listed once.
  public function snippets( string $folder = '' ) : array
  {
    $found = [];

    $this->manager->tree->walk( function( array $item, string $fsPath ) use ( $folder, &$found ) {

      if( $item['type'] !== 'file' || ($folder !== '' && strpos($fsPath, "$folder/") !== 0) )
        return;

      // A link's basePath is the source of the marker, not of the target
      $base = empty($item['isIncluded']) ? $item['basePath'] : $this->shownBase($fsPath);

      if( $base && ! isset($found["$base\0$fsPath"]) )
        $found["$base\0$fsPath"] = [
          'path'    => $fsPath,
          'base'    => $base,
          'snippet' => $this->manager->snippets->load($fsPath, $base)
        ];
    });

    return array_values($found);
  }

  // The INCLUDE markers that show the item $path elsewhere: ['path', 'source'] each.
  // A link names its target, looked up at the source roots, so only a root item has any.
  public function linksTo( string $path ) : array
  {
    if( $path === '' || strpos($path, '/') !== false )
      return [];

    $name  = $this->isFolder($path) ? $path : pathinfo($path, PATHINFO_FILENAME);
    $links = [];

    foreach( $this->manager->sources->getPaths() as $base )
      foreach( $this->markersBelow($base, '') as $marker )
        if( FileTree::linkTarget(basename($marker)) === $name )
          $links[] = ['path' => $marker, 'source' => $this->label($base)];

    return $links;
  }

  private function markersBelow( string $base, string $subPath ) : array
  {
    $dir     = $subPath === '' ? $base : "$base/$subPath";
    $markers = [];

    foreach( is_dir($dir) ? scandir($dir) : [] as $name )
    {
      if( $name === '.' || $name === '..' || $name === '.sys' )
        continue;

      $path = $subPath === '' ? $name : "$subPath/$name";

      if( is_dir("$dir/$name") )
        $markers = array_merge($markers, $this->markersBelow($base, $path));
      elseif( FileTree::linkTarget($name) !== null )
        $markers[] = $path;
    }

    return $markers;
  }

  private function requireSafe( string $path ) : void
  {
    if( ! $this->manager->sources->isSafeRelativePath($path) )
      throw new RuntimeException("Invalid path: $path");
  }

  private function labelList( array $bases ) : string
  {
    return implode(', ', array_map([$this, 'label'], $bases));
  }
}
