<?php

namespace SnippetManager\Ai;

use RuntimeException;

// The chat sessions of a user, one JSON file each in users/<user>/ai_sessions/. A session
// belongs to a data set: its proposals name paths that exist only there.
//
// The server keeps what the sidebar sends: id, title, dataSet, provider, mode and the
// messages with their proposals and the decisions on them; created / updated are its own.
class AiSessions
{
  private string $dir;

  public function __construct( string $dir )
  {
    $this->dir = rtrim($dir, '/');
  }

  // The sessions of a data set, newest first: [['id', 'title', 'updated'], ...]
  public function list( string $dataSet ) : array
  {
    $sessions = [];

    foreach( is_dir($this->dir) ? scandir($this->dir) : [] as $file )
    {
      if( pathinfo($file, PATHINFO_EXTENSION) !== 'json' )
        continue;

      $session = $this->read("{$this->dir}/$file");
      if( $session && ($session['dataSet'] ?? '') === $dataSet )
        $sessions[] = ['id' => $session['id'], 'title' => $session['title'] ?? '', 'updated' => $session['updated'] ?? ''];
    }

    usort($sessions, fn( $a, $b ) => strcmp($b['updated'], $a['updated']));
    return $sessions;
  }

  public function load( string $id ) : array
  {
    $session = $this->read( $this->file($id));
    if( $session === null )
      throw new RuntimeException('Session not found');

    return $session;
  }

  // Stores a session, a new one without id gets one; returns it as stored
  public function save( array $session ) : array
  {
    $id   = (string)($session['id'] ?? '');
    $file = $id !== '' ? $this->file($id) : '';
    $old  = $file !== '' ? $this->read($file) : null;

    if( $id === '' )
    {
      $id   = date('Y-m-d_His') . '_' . bin2hex(random_bytes(3));
      $file = $this->file($id);
    }

    $session = array_merge($session, [
      'id'      => $id,
      'created' => $old['created'] ?? date('Y-m-d H:i:s'),
      'updated' => date('Y-m-d H:i:s')
    ]);

    if( ! is_dir($this->dir) )
      mkdir($this->dir, 0755, true);

    if( file_put_contents($file, json_encode($session, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)) === false )
      throw new RuntimeException('Failed to save the session');

    return $session;
  }

  public function delete( string $id ) : void
  {
    $file = $this->file($id);
    if( is_file($file) && ! unlink($file) )
      throw new RuntimeException('Failed to delete the session');
  }

  // An id becomes a file name, so only safe characters
  private function file( string $id ) : string
  {
    if( ! preg_match('/^[A-Za-z0-9_-]+$/', $id) )
      throw new RuntimeException('Invalid session id');

    return "{$this->dir}/$id.json";
  }

  private function read( string $file ) : ?array
  {
    $data = is_file($file) ? json_decode( (string)file_get_contents($file), true) : null;
    return is_array($data) && isset($data['id']) ? $data : null;
  }
}
