<?php

namespace SnippetManager\Ai;

use RuntimeException;

// Typed reads of tool arguments. The arguments come from a model, so any of them may be
// missing or of the wrong type; a failure is a RuntimeException with a message the model
// can act on (it becomes the tool result).
class AiArgs
{
  // A string argument; without $default it is required. Numbers and booleans are taken as text.
  public static function string( array $args, string $key, ?string $default = null ) : string
  {
    $value = $args[$key] ?? null;

    if( $value === null )
    {
      if( $default === null )
        throw new RuntimeException("Missing argument: $key");
      return $default;
    }

    if( ! is_scalar($value) )
      throw new RuntimeException("Argument $key must be a string");

    return is_bool($value) ? ($value ? 'true' : 'false') : (string)$value;
  }

  public static function optionalString( array $args, string $key ) : ?string
  {
    return ($args[$key] ?? null) === null ? null : self::string($args, $key);
  }

  public static function int( array $args, string $key, int $default ) : int
  {
    $value = $args[$key] ?? null;

    if( $value === null )
      return $default;
    if( ! is_numeric($value) )
      throw new RuntimeException("Argument $key must be a number");

    return (int)$value;
  }

  // A list of strings, [] when missing
  public static function strings( array $args, string $key ) : array
  {
    $value = $args[$key] ?? [];

    if( ! is_array($value) )
      throw new RuntimeException("Argument $key must be a list");

    return array_map( fn( $item ) => self::string(['item' => $item], 'item'), array_values($value));
  }

  // A list of objects, [] when missing
  public static function objects( array $args, string $key ) : array
  {
    $value = $args[$key] ?? [];

    if( ! is_array($value) || array_filter($value, fn( $item ) => ! is_array($item)) )
      throw new RuntimeException("Argument $key must be a list of objects");

    return array_values($value);
  }

  // An object of name => value; a list or a string is refused. A model sends an empty
  // object as [] after json_decode, which is the same thing.
  public static function map( array $args, string $key ) : array
  {
    $value = $args[$key] ?? [];

    if( ! is_array($value) || ($value !== [] && array_keys($value) === range(0, count($value) - 1)) )
      throw new RuntimeException("Argument $key must be an object of name: value");

    return $value;
  }
}
