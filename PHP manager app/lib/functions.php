<?php

use Symfony\Component\Yaml\Yaml;

const APP_ROOT = __DIR__ . '/..';

// App config: config.yml with an optional config.local.yml layered on top. The local file
// is not committed, so a checkout stays on the demo setup while a machine can point the
// app at its own user folder.
function app_config() : array
{
  static $config = null;

  if( $config === null )
  {
    $base  = is_file(APP_ROOT . '/config.yml')       ? Yaml::parseFile(APP_ROOT . '/config.yml')       : [];
    $local = is_file(APP_ROOT . '/config.local.yml') ? Yaml::parseFile(APP_ROOT . '/config.local.yml') : [];

    $config = array_replace_recursive(
      is_array($base)  ? $base  : [],
      is_array($local) ? $local : []
    );
  }

  return $config;
}

// Folder holding the active user's settings and lists, e.g. "users/walter".
// Seeded from the demo user the first time a new name is configured.
function user_dir() : string
{
  $user = (string)(app_config()['user'] ?? 'default');

  // A user name is one folder segment, never a path
  if( $user === '' || strpbrk($user, "/\\") !== false || strpos($user, '..') !== false )
    $user = 'default';

  $dir = APP_ROOT . "/users/$user";

  if( ! is_dir($dir) )
  {
    @mkdir($dir, 0755, true);
    $seed = APP_ROOT . '/users/default/settings.yml';
    if( is_file($seed) && ! is_file("$dir/settings.yml") )
      @copy($seed, "$dir/settings.yml");
  }

  return "users/$user";
}

// Asset URL stamped with the file's mtime, so browsers cache it until it really changes
function asset_url( string $file ) : string
{
  $path = __DIR__ . "/../$file";
  return is_file($path) ? "$file?v=" . filemtime($path) : $file;
}

function read_json_file( string $file, $default )
{
  if( ! file_exists($file) ) return $default;
  $raw = file_get_contents($file);
  if( $raw === false || $raw === '' ) return $default;
  $data = json_decode($raw, true);
  return $data === null ? $default : $data;
}

function write_json_file( string $file, $data ) : bool
{
  $dir = dirname($file);
  if( ! is_dir($dir) ) mkdir($dir, 0755, true);
  $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
  return file_put_contents($file, $json) !== false;
}
