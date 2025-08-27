<?php

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
