<?php

namespace SnippetManager;

// Structural changes to the tree: folders, links, renames, reordering.
// Every method throws RuntimeException with a user-facing message when it fails.
class FileOperations
{
  private Sources $sources;
  private ColorStore $colors;

  public function __construct( Sources $sources, ColorStore $colors )
  {
    $this->sources = $sources;
    $this->colors  = $colors;
  }

  // Without $base the folder goes where its parent folder lives
  public function createFolder( string $folderPath, ?string $base = null ) : void
  {
    $fullPath = $this->targetPath($folderPath, $base, 'Invalid folder path');

    if( is_dir($fullPath) || ! mkdir($fullPath, 0755, true) )
      throw new \RuntimeException('Failed to create folder or folder already exists');
  }

  // A link is an empty marker file "INCLUDE <target>"; the tree shows the target in its place
  public function createLink( string $linkPath, ?string $base = null ) : void
  {
    if( $linkPath === '' )
      throw new \RuntimeException('Missing link path');

    $fullPath = $this->targetPath($linkPath, $base, 'Invalid link path');
    $dir      = dirname($fullPath);

    if( ! is_dir($dir) && ! mkdir($dir, 0755, true) )
      throw new \RuntimeException('Failed to prepare target directory');
    if( file_exists($fullPath) )
      throw new \RuntimeException('Link already exists');
    if( file_put_contents($fullPath, '') === false )
      throw new \RuntimeException('Failed to create link');
  }

  private function targetPath( string $relativePath, ?string $base, string $invalidMessage ) : string
  {
    if( trim($relativePath, '/') === '' || ! $this->sources->isSafeRelativePath($relativePath) )
      throw new \RuntimeException($invalidMessage);

    try {
      $base = $this->sources->resolveTargetBase($base, $relativePath);
    }
    catch( \RuntimeException $e ) {
      throw new \RuntimeException($invalidMessage);
    }

    return rtrim($base, '/') . '/' . ltrim($relativePath, '/');
  }

  // Deletes the marker file(s) of a link, never the target. Matched by target name, so an
  // ordinal prefix on the marker does not matter. Without $bases all sources are searched.
  public function removeLink( string $subPath, string $target, ?array $bases = null ) : void
  {
    $target = trim($target);
    if( $target === '' || ! $this->sources->isSafeRelativePath($subPath) )
      throw new \RuntimeException('Link not found');

    $subPath     = trim(str_replace('\\', '/', $subPath), '/');
    $searchBases = array_filter( array_map('strval', $bases ?? []), [$this->sources, 'isKnownBase']);
    if( empty($searchBases) )
      $searchBases = $this->sources->getPaths();

    $removed = false;
    foreach( $searchBases as $base )
    {
      $dir = rtrim(str_replace('\\', '/', $base), '/') . ($subPath !== '' ? "/$subPath" : '');
      if( ! is_dir($dir) )
        continue;

      foreach( scandir($dir) as $file )
        if( FileTree::linkTarget($file) === $target && @unlink("$dir/$file") )
          $removed = true;
    }

    if( ! $removed )
      throw new \RuntimeException('Link not found');
  }

  public function deleteFolder( string $path, ?string $base = null ) : void
  {
    $this->sources->requireRelativePath($path);   // an empty path would be the source itself

    $fullPath = $this->sources->resolvePhysicalPath($path, 'folder', $base);
    if( $fullPath === null || ! $this->deleteRecursive($fullPath) )
      throw new \RuntimeException('Failed to delete folder');
  }

  private function deleteRecursive( string $path ) : bool
  {
    foreach( scandir($path) as $item )
    {
      if( $item === '.' || $item === '..' )
        continue;

      $full = "$path/$item";
      if( is_dir($full) )
        $this->deleteRecursive($full);
      else
        unlink($full);
    }

    return rmdir($path);
  }

  // Renames a file or folder in each of $bases (null entries mean the source it lives in).
  // A merged folder lives in several sources and has to move in all of them or in none,
  // so every source is checked up front and a failure part way through is walked back.
  // A file keeps its color.
  public function rename( string $oldPath, string $newPath, array $bases ) : void
  {
    if( trim($oldPath, '/') === '' || trim($newPath, '/') === '' )
      throw new \RuntimeException('Invalid parameters');

    if( ! $this->sources->isSafeRelativePath($oldPath) || ! $this->sources->isSafeRelativePath($newPath) )
      throw new \RuntimeException('Invalid path');

    $resolved = [];
    foreach( $bases ?: [null] as $base )
    {
      $base = ($base ?? '') === ''
        ? $this->sources->resolveWritePath($oldPath)
        : $this->sources->resolveBasePath((string)$base);

      if( $base === null )
        throw new \RuntimeException('Invalid source folder');

      $resolved[rtrim($base, '/')] = true;      // keyed, so a repeated base is renamed once
    }

    // Check every source before touching any of them
    $jobs = [];
    foreach( array_keys($resolved) as $base )
    {
      $old = "$base/" . ltrim($oldPath, '/');
      $new = "$base/" . ltrim($newPath, '/');

      if( ! file_exists($old) )                 // a merged folder may miss in some source
        continue;
      if( file_exists($new) )
        throw new \RuntimeException('Target already exists');

      $jobs[] = [$old, $new];
    }

    if( empty($jobs) )
      throw new \RuntimeException('Source missing');

    $done = [];
    foreach( $jobs as [$old, $new] )
    {
      // Nested renames may need a parent that does not exist in this source yet
      if( ! is_dir(dirname($new)) && ! mkdir(dirname($new), 0755, true) )
        $this->undo($done, 'Failed to prepare target directory');

      if( ! @rename($old, $new) )
        $this->undo($done, 'Failed to rename');

      $done[] = [$old, $new];
    }

    // Colors are keyed by name in the parent folder, so they only travel along when the
    // item stays in the same folder - which is what the rename dialog does
    if( dirname($oldPath) === dirname($newPath) )
      foreach( $jobs as [$old] )
        $this->colors->moveFileColor( dirname($old), basename($oldPath), basename($newPath));
  }

  // Renames a batch of siblings at once (drag & drop renumbering), possibly across sources.
  // $ops: [['base' => absSource, 'oldName' => name, 'newName' => name, 'type' => 'file'|'folder'], ...]
  // Per source it renames in two phases (old -> temp -> new) so a permutation cannot clobber
  // itself, and any failure undoes every rename made so far. Returns false if nothing changed.
  public function batchRename( string $subPath, array $ops ) : bool
  {
    if( ! $this->sources->isSafeRelativePath($subPath) )
      throw new \RuntimeException('Invalid path');

    $subPath = trim(str_replace('\\', '/', $subPath), '/');
    $byBase  = [];

    foreach( $ops as $op )
    {
      $base = rtrim(str_replace('\\', '/', (string)($op['base'] ?? '')), '/');
      $old  = (string)($op['oldName'] ?? '');
      $new  = (string)($op['newName'] ?? '');

      if( $base === '' || $old === '' || $new === '' || $old === $new )
        continue;
      if( ! $this->sources->isKnownBase($base) )
        throw new \RuntimeException('Invalid base path');
      if( strpbrk($old, '/\\') !== false || strpbrk($new, '/\\') !== false )
        throw new \RuntimeException('Invalid name');

      $byBase[$base][] = ['old' => $old, 'new' => $new, 'type' => ($op['type'] ?? 'file') === 'folder' ? 'folder' : 'file'];
    }

    if( empty($byBase) )
      return false;

    $done       = [];   // [[from, to], ...] every rename that really happened, in order
    $colorMoves = [];   // applied only once the whole batch went through

    foreach( $byBase as $base => $list )
    {
      $dir = $base . ($subPath !== '' ? "/$subPath" : '');
      if( ! is_dir($dir) )
        $this->undo($done, "Folder missing: $subPath");

      foreach( $list as $op )
        if( ! file_exists("$dir/{$op['old']}") )
          $this->undo($done, "Source missing: {$op['old']}");

      $temps = [];
      foreach( $list as $i => $op )
      {
        $temps[$i] = "$dir/.reorder_tmp_{$i}_" . bin2hex(random_bytes(3));
        if( ! @rename("$dir/{$op['old']}", $temps[$i]) )
          $this->undo($done, "Failed to stage {$op['old']}");
        $done[] = ["$dir/{$op['old']}", $temps[$i]];
      }

      foreach( $list as $i => $op )
      {
        $target = "$dir/{$op['new']}";
        if( file_exists($target) )
          $this->undo($done, "Target exists: {$op['new']}");
        if( ! @rename($temps[$i], $target) )
          $this->undo($done, "Failed to rename to {$op['new']}");
        $done[] = [$temps[$i], $target];

        if( $op['type'] === 'file' )
          $colorMoves[] = [$dir, $op['old'], $op['new']];
      }
    }

    foreach( $colorMoves as [$dir, $old, $new] )
      $this->colors->moveFileColor($dir, $old, $new);

    return true;
  }

  // Walks renames back, newest first, so every item ends up under its original name
  private function undo( array $done, string $message ) : void
  {
    foreach( array_reverse($done) as [$from, $to] )
      @rename($to, $from);

    throw new \RuntimeException($message);
  }
}
