<?php

namespace SnippetManager;

// Full-text search over the current data set: folder names, and snippet name, short
// code, usage and content. Results are sorted by relevance.
class Search
{
  private FileTree $tree;
  private SnippetStore $snippets;

  public function __construct( FileTree $tree, SnippetStore $snippets )
  {
    $this->tree     = $tree;
    $this->snippets = $snippets;
  }

  public function search( string $query ) : array
  {
    $query   = strtolower($query);
    $results = [];

    $this->tree->walk( function( array $item, string $fsPath ) use ( $query, &$results ) {

      // The source a hit belongs to, so clicking it opens that copy and not whichever
      // source wins last. A link's basePath is the source holding the marker, not the
      // target, so those fall back to the last-wins lookup.
      $base = empty($item['isIncluded']) ? ($item['basePath'] ?? null) : null;

      if( $item['type'] === 'folder' )
      {
        if( strpos(strtolower($item['name']), $query) !== false )
          $results[] = ['path' => $fsPath, 'name' => $item['name'], 'type' => 'folder', 'basePath' => $base, 'snippet' => null];
        return;
      }

      $snippet = $this->snippets->load($fsPath, $base);
      if( $snippet && $this->matches($snippet, $query) )
        $results[] = ['path' => $fsPath, 'name' => $item['name'], 'type' => $snippet['_type'], 'basePath' => $base, 'snippet' => $snippet];
    });

    usort($results, fn($a, $b) => $this->score($b, $query) - $this->score($a, $query));

    return $results;
  }

  private function matches( array $snippet, string $query ) : bool
  {
    foreach( ['_name', 'sc', 'usage', 'content'] as $field )
      if( strpos($this->text($snippet[$field] ?? ''), $query) !== false )
        return true;

    return false;
  }

  private function score( array $result, string $query ) : int
  {
    if( $result['type'] === 'folder' )
      return $this->nameScore( strtolower($result['name']), $query, 80, 40, 20);

    $snippet = $result['snippet'];
    $sc      = $this->text($snippet['sc'] ?? '');
    $score   = $this->nameScore( $this->text($snippet['_name'] ?? ''), $query, 100, 50, 25);

    if( $sc === $query )
      $score += 75;
    elseif( $sc !== '' && strpos($sc, $query) !== false )
      $score += 20;

    if( strpos($this->text($snippet['usage'] ?? ''), $query) !== false )
      $score += 10;
    if( strpos($this->text($snippet['content'] ?? ''), $query) !== false )
      $score += 5;

    return $score;
  }

  private function nameScore( string $name, string $query, int $exact, int $prefix, int $contains ) : int
  {
    if( $name === $query )
      return $exact;
    if( strpos($name, $query) === 0 )
      return $prefix;
    if( strpos($name, $query) !== false )
      return $contains;
    return 0;
  }

  // Lower-cased plain text of a snippet field. `usage` is normally a nested mapping
  // (head/maybe/vars/text), so keys are included: searching "channel" finds a var channel.
  private function text( $value ) : string
  {
    if( is_array($value) )
    {
      $parts = [];
      foreach( $value as $key => $item )
      {
        if( ! is_int($key) )
          $parts[] = strtolower((string)$key);
        $parts[] = $this->text($item);
      }
      return implode(' ', $parts);
    }

    return is_scalar($value) ? strtolower((string)$value) : '';
  }
}
