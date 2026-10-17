<?php

namespace SnippetManager\Ai;

use RuntimeException;

// Undo of the AI's changes, per answer. Every change applied from an answer is recorded
// under the answer's checkpoint (users/<user>/ai_undo/<checkpoint>/), with what it touched
// (AiChanges "effects"):
//   files  a copy of each before the change (or that it did not exist) and its md5 after
//   moves  [from, to]
//   dirs   the folders it created
//
// undo() walks the changes backwards and restores a file only while it is still as the
// change left it: one changed since (by the user, by a later change) is skipped and named,
// never overwritten. A checkpoint is used once; the newest KEEP are kept.
class AiUndo
{
  private const KEEP = 20;

  private string $dir;

  public function __construct( string $dir )
  {
    $this->dir = rtrim($dir, '/');
  }

  // Runs $apply and records what it changed. A change that fails records nothing.
  public function record( string $checkpoint, array $effects, callable $apply ) : void
  {
    $cpDir   = $this->checkpointDir($checkpoint);
    $journal = $this->journal($cpDir);
    $entry   = ['files' => [], 'moves' => $effects['moves'] ?? [], 'dirs' => []];

    if( ! is_dir($cpDir) && ! @mkdir($cpDir, 0755, true) )
      throw new RuntimeException('Could not create the undo checkpoint');

    foreach( $effects['files'] ?? [] as $i => $file )
    {
      $backup = null;
      if( is_file($file) )
      {
        $backup = count($journal) . "_$i.bak";
        if( ! copy($file, "$cpDir/$backup") )
          throw new RuntimeException('Could not keep a copy for the undo');
      }
      $entry['files'][] = ['path' => $file, 'backup' => $backup];
    }

    foreach( $effects['dirs'] ?? [] as $dir )
      if( ! is_dir($dir) )
        $entry['dirs'][] = $dir;

    $apply();

    foreach( $entry['files'] as &$file )
      $file['after'] = is_file($file['path']) ? md5_file($file['path']) : null;
    unset($file);

    $journal[] = $entry;
    file_put_contents("$cpDir/journal.json", json_encode($journal, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));

    $this->prune();
  }

  // Takes back every change of the checkpoint: ['restored' => n, 'skipped' => [absolute paths]]
  public function undo( string $checkpoint ) : array
  {
    $cpDir   = $this->checkpointDir($checkpoint);
    $journal = $this->journal($cpDir);

    if( ! $journal )
      throw new RuntimeException('Nothing to undo (already undone, or too old)');

    $restored = 0;
    $skipped  = [];

    foreach( array_reverse($journal) as $entry )
    {
      foreach( array_reverse($entry['moves']) as [$from, $to] )
      {
        if( file_exists($to) && ! file_exists($from) && (is_dir( dirname($from)) || @mkdir( dirname($from), 0755, true)) && @rename($to, $from) )
          $restored++;
        else
          $skipped[] = $to;
      }

      foreach( $entry['files'] as $file )
      {
        $now = is_file($file['path']) ? md5_file($file['path']) : null;
        if( $now !== $file['after'] ) {
          $skipped[] = $file['path'];
          continue;
        }

        if( $file['backup'] === null )
          $done = $now === null || @unlink($file['path']);
        else
          $done = (is_dir( dirname($file['path'])) || @mkdir( dirname($file['path']), 0755, true)) && copy("$cpDir/{$file['backup']}", $file['path']);

        $done ? $restored++ : ($skipped[] = $file['path']);
      }

      // A created folder goes only when nothing has been put into it since; an empty .sys
      // (colors, left by a file moved in and out again) is no content
      foreach( array_reverse($entry['dirs']) as $dir )
      {
        if( is_dir("$dir/.sys") && count( scandir("$dir/.sys")) === 2 )
          @rmdir("$dir/.sys");
        if( is_dir($dir) && count( scandir($dir)) === 2 )
          @rmdir($dir) ? $restored++ : ($skipped[] = $dir);
      }
    }

    $this->remove($cpDir);
    return ['restored' => $restored, 'skipped' => array_values( array_unique($skipped))];
  }

  private function checkpointDir( string $checkpoint ) : string
  {
    if( ! preg_match('/^[A-Za-z0-9_-]+$/', $checkpoint) )
      throw new RuntimeException('Invalid undo checkpoint');

    return "{$this->dir}/$checkpoint";
  }

  private function journal( string $cpDir ) : array
  {
    $journal = is_file("$cpDir/journal.json") ? json_decode( (string)file_get_contents("$cpDir/journal.json"), true) : null;
    return is_array($journal) ? $journal : [];
  }

  // The newest KEEP checkpoints stay
  private function prune() : void
  {
    $dirs = array_filter( glob("{$this->dir}/*") ?: [], 'is_dir');
    usort($dirs, fn( $a, $b ) => filemtime($b) <=> filemtime($a));

    foreach( array_slice($dirs, self::KEEP) as $old )
      $this->remove($old);
  }

  private function remove( string $dir ) : void
  {
    foreach( array_diff( scandir($dir) ?: [], ['.', '..']) as $entry )
      is_dir("$dir/$entry") ? $this->remove("$dir/$entry") : @unlink("$dir/$entry");

    @rmdir($dir);
  }
}
