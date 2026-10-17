<?php

namespace SnippetManager;

use Symfony\Component\Yaml\Yaml;
use Symfony\Component\Yaml\Exception\ParseException;

// Reads and writes snippet files (.yml and .md).
//
// A loaded snippet is the parsed YAML plus meta keys that are never written to disk:
//   _type       'yml' | 'md'
//   _name       file name without extension
class SnippetStore
{
  // Key order of a written snippet, as documented in the README file format
  private const KEY_ORDER = ['id', 'version', 'sc', 'short', 'usage', 'content'];

  // A new yml snippet starts from this file; its version is the current file format
  public const TEMPLATE = __DIR__ . '/../snippet_template.yml';

  private Sources $sources;
  private ColorStore $colors;

  public function __construct( Sources $sources, ColorStore $colors )
  {
    $this->sources = $sources;
    $this->colors  = $colors;
  }

  // With $basePath given, reads that source only: when several sources hold the same
  // file name (foldersMerged), that is what tells the two tree entries apart.
  // Without it, the last source that has the file wins, like in the tree.
  public function load( string $path, ?string $basePath = null ) : ?array
  {
    if( ! $this->sources->isSafeRelativePath($path) )
      return null;

    $bases = $this->sources->getPaths();
    if( $basePath !== null && $basePath !== '' )
    {
      $base = $this->sources->resolveBasePath($basePath);
      if( $base === null )
        return null;
      $bases = [$base];
    }

    $result = null;
    foreach( $bases as $base )
    {
      $snippet = $this->read("$base/$path");
      if( $snippet !== null )
        $result = $snippet;
    }

    return $result;
  }

  private function read( string $fullPath ) : ?array
  {
    if( ! file_exists($fullPath) )
      return null;

    $name = pathinfo($fullPath, PATHINFO_FILENAME);

    switch( pathinfo($fullPath, PATHINFO_EXTENSION) )
    {
      case 'yml':
        try {
          $data = Yaml::parse(file_get_contents($fullPath));
        }
        catch( ParseException $e ) {
          return null;
        }

        // An empty or scalar file would otherwise blow up on the array writes below
        if( ! is_array($data) )
          $data = [];

        return array_merge($data, ['_type' => 'yml', '_name' => $name]);

      case 'md':
        return ['_type' => 'md', '_name' => $name, 'content' => file_get_contents($fullPath)];
    }

    return null;
  }

  // Writes a snippet and returns it as stored (usage parsed back into an array, so the
  // caller's in-memory copy stays structured). The target source is $targetBasePath, or
  // where the file already lives, or where its folder lives.
  // $createOnly: for creating (New Snippet, Duplicate) - never write over an existing file.
  // Throws RuntimeException with a user-facing message; the file stays untouched then.
  public function save( string $path, array $data, ?string $targetBasePath = null, bool $createOnly = false ) : array
  {
    $type = $data['_type'] ?? null;
    if( $type !== 'yml' && $type !== 'md' )
      throw new \RuntimeException('Failed to save snippet');

    $this->sources->requireRelativePath($path);
    $base     = $this->sources->resolveTargetBase($targetBasePath, $path);
    $fullPath = rtrim($base, '/') . '/' . ltrim($path, '/');
    $name     = $data['_name'] ?? pathinfo($path, PATHINFO_FILENAME);

    // Parse before touching the disk so a broken usage block cannot damage a good file.
    // A snippet without usage stays without, instead of gaining "usage: null".
    if( $type === 'yml' && array_key_exists('usage', $data) )
      $data['usage'] = $this->parseUsageText($data['usage']);

    if( $createOnly && file_exists($fullPath) )
      throw new \RuntimeException('A snippet with this name already exists');

    if( ! is_dir(dirname($fullPath)) )
      mkdir(dirname($fullPath), 0755, true);

    if( $type === 'md' )
    {
      $content = $data['content'] ?? '';
      $this->writeFile($fullPath, $content);
      return ['_type' => 'md', '_name' => $name, 'content' => $content];
    }

    unset($data['_type'], $data['_name']);

    $ordered = [];
    foreach( self::KEY_ORDER as $key )
      if( array_key_exists($key, $data) )
      {
        $ordered[$key] = $data[$key];
        unset($data[$key]);
      }
    $data = $ordered + $data;

    $this->writeFile($fullPath, Yaml::dump($data, 4, 2, Yaml::DUMP_MULTI_LINE_LITERAL_BLOCK));

    return array_merge($data, ['_type' => 'yml', '_name' => $name]);
  }

  // A new snippet, never written over an existing file. A yml one is the template with a
  // new id and $fields on top: a top-level field replaces the template's, a usage field
  // only that usage field. An md one is just its content.
  public function create( string $path, array $fields = [], ?string $targetBasePath = null ) : array
  {
    $type = pathinfo($path, PATHINFO_EXTENSION);
    $data = $fields;

    if( $type === 'yml' )
    {
      $template = $this->template();
      $data     = array_replace($template, $fields, ['id' => $this->newId()]);

      if( is_array($fields['usage'] ?? null) && is_array($template['usage'] ?? null) )
        $data['usage'] = array_replace($template['usage'], $fields['usage']);
    }

    return $this->save($path, ['_type' => $type] + $data, $targetBasePath, true);
  }

  public function template() : array
  {
    $template = Yaml::parseFile(self::TEMPLATE);
    return is_array($template) ? $template : [];
  }

  public function formatVersion() : int
  {
    return (int)($this->template()['version'] ?? 0);
  }

  // A new prompt's id: today's date, the next free number of the day and "-V1", as in
  // the template. Only a file written today can hold an id of today, so only those are read.
  public function newId() : string
  {
    $today = date('Y-m-d');
    $max   = 0;

    foreach( $this->sources->getPaths() as $base )
      foreach( $this->ymlFilesSince($base, strtotime('today')) as $file )
      {
        $id = (string)($this->read($file)['id'] ?? '');
        if( preg_match('/^' . preg_quote($today, '/') . '\.(\d+)/', $id, $m) )
          $max = max($max, (int)$m[1]);
      }

    return sprintf('%s.%02d-V1', $today, $max + 1);
  }

  private function ymlFilesSince( string $dir, int $since ) : array
  {
    $files = [];

    foreach( is_dir($dir) ? scandir($dir) : [] as $name )
    {
      $path = "$dir/$name";

      if( $name === '.' || $name === '..' || $name === '.sys' )
        continue;
      if( is_dir($path) )
        $files = array_merge($files, $this->ymlFilesSince($path, $since));
      elseif( pathinfo($name, PATHINFO_EXTENSION) === 'yml' && filemtime($path) >= $since )
        $files[] = $path;
    }

    return $files;
  }

  private function writeFile( string $fullPath, string $content ) : void
  {
    if( file_put_contents($fullPath, $content) === false )
      throw new \RuntimeException('Failed to save snippet');
  }

  public function delete( string $path, ?string $basePath = null ) : void
  {
    $this->sources->requireRelativePath($path);
    $base     = $this->sources->resolveTargetBase($basePath, $path);
    $fullPath = rtrim($base, '/') . '/' . ltrim($path, '/');

    if( ! is_file($fullPath) || ! unlink($fullPath) )
      throw new \RuntimeException('Failed to delete snippet');

    $this->colors->moveFileColor( dirname($fullPath), basename($fullPath), null);
  }

  // The copy lands in the same source; an existing target is refused. A copy is a new
  // prompt, so a yml one gets a new id.
  public function duplicate( string $sourcePath, string $targetPath, ?string $basePath = null ) : void
  {
    $snippet = $this->load($sourcePath, $basePath);
    if( $snippet === null )
      throw new \RuntimeException('Failed to duplicate snippet');

    $snippet['_name'] = pathinfo($targetPath, PATHINFO_FILENAME);
    if( $snippet['_type'] === 'yml' )
      $snippet['id'] = $this->newId();
    $this->save($targetPath, $snippet, $basePath, true);
  }

  // The editor posts `usage` structured (one control per field). A string is YAML text:
  // a scalar result means prose, which the renderer supports; a parse error means the
  // text is broken and must not be written, or the structured block would be flattened.
  private function parseUsageText( $usage )
  {
    if( ! is_string($usage) )
      return $usage;                  // already structured (editor, duplicate)

    if( trim($usage) === '' )
      return '';

    try {
      $parsed = Yaml::parse($usage);
    }
    catch( ParseException $e ) {
      throw new \RuntimeException('Usage is not valid YAML: ' . $e->getMessage());
    }

    return $parsed ?? '';
  }
}
