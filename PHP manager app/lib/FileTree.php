<?php

namespace SnippetManager;

// Lists one level of the merged tree of the current data set.
//
// Items: ['type' => 'file'|'folder', 'name', 'path', 'basePath', ...]
//   path       position in the tree (unique); for links and duplicates it is not on disk
//   fsPath     the real relative path, when it differs from path
//   basePath   source folder the item was found in (for links: the one holding the marker)
//   mergedBases  all sources of a folder shown once although several sources have it
//
// A link is an empty marker file "INCLUDE <target>" (optionally "11 INCLUDE <target>"),
// shown in the tree as the snippet or folder <target>, looked up by name in all sources.
class FileTree
{
  private Sources $sources;
  private ColorStore $colors;
  private bool $foldersMerged;
  private bool $foldersFirst;

  public function __construct( Sources $sources, ColorStore $colors, bool $foldersMerged, bool $foldersFirst )
  {
    $this->sources       = $sources;
    $this->colors        = $colors;
    $this->foldersMerged = $foldersMerged;
    $this->foldersFirst  = $foldersFirst;
  }

  // Returns the target name of a link marker file name, or null if it is none.
  // Matching the exact shape keeps a snippet called "INCLUDEs and notes.yml" a normal file.
  public static function linkTarget( string $fileName ) : ?string
  {
    if( ! preg_match('/^(?:\d{2}[ _.\-]+)?INCLUDE\s+(.+)$/', $fileName, $m) )
      return null;

    $target = trim($m[1]);
    return $target === '' ? null : $target;
  }

  public function listFiles( string $subPath = '' ) : array
  {
    if( ! $this->sources->isSafeRelativePath($subPath) )
      return [];

    $byPath = [];
    foreach( $this->sources->getFolders() as $folder )
      foreach( $this->listFolder($folder['path'], $folder['color'], $subPath) as $item )
      {
        $item['basePath'] = $folder['path'];
        $byPath[$item['path']][] = $item;
      }

    $items = $this->foldersMerged ? $this->merge($byPath) : $this->lastWins($byPath);

    usort($items, function( $a, $b ) {
      if( $this->foldersFirst && $a['type'] !== $b['type'] )
        return $a['type'] === 'folder' ? -1 : 1;
      return strcasecmp($a['name'], $b['name']);
    });

    return $items;
  }

  private function lastWins( array $byPath ) : array
  {
    return array_values( array_map( fn($group) => end($group), $byPath));
  }

  // A folder present in several sources becomes one entry; same-named files are all
  // shown, the 2nd+ with a "#n" suffix on the tree path to keep it unique
  private function merge( array $byPath ) : array
  {
    $items = [];

    foreach( $byPath as $group )
    {
      if( count($group) === 1 )
        $items[] = $group[0];
      elseif( $group[0]['type'] === 'folder' )
      {
        $entry = end($group);
        $entry['mergedBases'] = array_column($group, 'basePath');
        $items[] = $entry;
      }
      else
      {
        foreach( $group as $idx => $item )
        {
          if( $idx > 0 ) {
            $item['fsPath'] = $item['path'];
            $item['path']   = "{$item['path']}#$idx";
          }
          $items[] = $item;
        }
      }
    }

    return $items;
  }

  private function listFolder( string $basePath, ?string $color, string $subPath ) : array
  {
    $fullPath = $basePath . ($subPath ? "/$subPath" : '');

    if( ! is_dir($fullPath) )
      return [];

    $items = [];

    foreach( scandir($fullPath) as $file )
    {
      if( $file === '.' || $file === '..' || $file === '.sys' )
        continue;

      $filePath     = "$fullPath/$file";
      $relativePath = $subPath ? "$subPath/$file" : $file;
      $extension    = pathinfo($file, PATHINFO_EXTENSION);

      if( is_dir($filePath) )
      {
        $colorName = $this->colors->getFolderColor($filePath);
        $items[] = [
          'type'      => 'folder',
          'name'      => $file,
          'path'      => $relativePath,
          'color'     => $colorName ? $this->colors->resolve($colorName) : $color,
          'colorName' => $colorName,
        ];
      }
      elseif( ($target = self::linkTarget($file)) !== null )
      {
        $link = $this->resolveLink($target, $subPath, $basePath, $color);
        if( $link !== null )
          $items[] = $link;
      }
      elseif( $extension === 'yml' || $extension === 'md' )
      {
        $colorName = $this->colors->getFileColor($fullPath, $file);
        $items[] = [
          'type'      => 'file',
          'name'      => pathinfo($file, PATHINFO_FILENAME),
          'extension' => $extension,
          'path'      => $relativePath,
          'modified'  => filemtime($filePath),
          'color'     => $colorName ? $this->colors->resolve($colorName) : $color,
          'colorName' => $colorName
        ];
      }
    }

    return $items;
  }

  // Finds a link target: a folder or snippet at the root of a source, searched in the
  // marker's own source first, then in the others
  private function resolveLink( string $targetName, string $subPath, string $markerBase, ?string $color ) : ?array
  {
    $treePrefix = $subPath ? "$subPath/" : '';

    $folders = $this->sources->getFolders();
    usort($folders, fn($a, $b) => ($b['path'] === $markerBase) <=> ($a['path'] === $markerBase));

    foreach( $folders as $folder )
    {
      $base      = $folder['path'];
      $itemColor = $folder['color'] ?? $color;

      if( is_dir("$base/$targetName") )
        return [
          'type'       => 'folder',
          'name'       => $targetName,
          'path'       => $treePrefix . $targetName,
          'fsPath'     => $targetName,
          'isIncluded' => true,
          'color'      => $itemColor
        ];

      foreach( ['yml', 'md'] as $ext )
        if( file_exists("$base/$targetName.$ext") )
          return [
            'type'       => 'file',
            'name'       => $targetName,
            'extension'  => $ext,
            'path'       => "$treePrefix$targetName.$ext",
            'fsPath'     => "$targetName.$ext",
            'modified'   => filemtime("$base/$targetName.$ext"),
            'isIncluded' => true,
            'color'      => $itemColor
          ];
    }

    return null;
  }

  // Calls $visit(item, fsPath) for every item in the tree. Each real folder is entered
  // once: a folder reachable through several links is not scanned twice, and a link
  // pointing at an ancestor would otherwise recurse forever. $visit returns true to stop.
  public function walk( callable $visit ) : void
  {
    $visited = [];
    $this->walkFolder('', $visit, $visited);
  }

  private function walkFolder( string $subPath, callable $visit, array &$visited ) : bool
  {
    $key = trim($subPath, '/');
    if( isset($visited[$key]) )
      return false;
    $visited[$key] = true;

    foreach( $this->listFiles($subPath) as $item )
    {
      $fsPath = $item['fsPath'] ?? $item['path'];

      if( $visit($item, $fsPath) === true )
        return true;
      if( $item['type'] === 'folder' && $this->walkFolder($fsPath, $visit, $visited) )
        return true;
    }

    return false;
  }
}
