<?php

namespace SnippetManager;

// Snippet content syntax:
//   {{ name }}, {{ name=default }}, {{ name=a|b|c }}   placeholders (text, choice)
//   {{ include: "Snippet name" }}                       another snippet, found by name
//   {{ MAYBE: Name }} ... {{ END-MAYBE }}               optional block
//
// compose() resolves includes and marks includes / MAYBE blocks for the inline editor;
// render() resolves everything to plain text.
class Renderer
{
  private Sources $sources;
  private FileTree $tree;
  private SnippetStore $snippets;
  private bool $includedSameIndent;
  private bool $highlightInclude;
  private array $byName = [];         // "dataSet\0name" => snippet|null, per request
  private array $includeStack = [];   // snippets being included right now (cycle guard)

  public function __construct( Sources $sources, FileTree $tree, SnippetStore $snippets, array $renderSettings )
  {
    $this->sources            = $sources;
    $this->tree               = $tree;
    $this->snippets           = $snippets;
    $this->includedSameIndent = (bool)($renderSettings['includedSameIndent'] ?? false);
    $this->highlightInclude   = (bool)($renderSettings['highlightInclude'] ?? false);
  }

  // For the inline editor: includes resolved, include and MAYBE regions marked with
  // <<<INC:START:name>>> ... <<<INC:END>>> and <<<MAYBE:START:name>>> ... <<<MAYBE:END>>>
  public function compose( array $snippet ) : string
  {
    if( ! isset($snippet['content']) )
      return '';

    $this->includeStack = [];
    return $this->processIncludes((string)$snippet['content'], true);
  }

  // Plain text: includes and MAYBE blocks resolved, placeholders filled from $values
  // or their defaults (the first choice for choice placeholders)
  public function render( array $snippet, array $values = [] ) : string
  {
    if( ! isset($snippet['content']) )
      return '';

    $this->includeStack = [];
    $content = $this->processIncludes((string)$snippet['content'], false);

    return preg_replace_callback('/\{\{\s*([^}]*)\s*\}\}/', function( $matches ) use ( $values ) {

      $placeholder = $this->parsePlaceholder($matches[1]);
      if( $placeholder === null )
        return $matches[0];

      [$name, $spec] = $placeholder;

      if( isset($values[$name]) )
        return $values[$name];
      if( $spec === null )
        return "{{{$name}}}";

      return $spec['default'];
    }, $content);
  }

  // name => ['type' => 'text'|'choice', 'default' => string, 'choices' => [...] (choice only)]
  public function extractPlaceholders( string $content ) : array
  {
    preg_match_all('/\{\{\s*([^}]*)\s*\}\}/', $content, $matches);

    $placeholders = [];
    foreach( $matches[1] as $raw )
    {
      $placeholder = $this->parsePlaceholder($raw);
      if( $placeholder !== null )
        $placeholders[$placeholder[0]] = $placeholder[1] ?? ['type' => 'text', 'default' => ''];
    }

    return $placeholders;
  }

  // Returns [name, spec|null] for a placeholder token, spec null when it has no default;
  // null for anything else (block syntax, malformed tokens)
  private function parsePlaceholder( string $raw ) : ?array
  {
    $token = trim($raw);

    // Block syntax, not placeholders. END-MAYBE in particular looks exactly like a name.
    if( stripos($token, 'include:') === 0 || stripos($token, 'MAYBE:') === 0 || strcasecmp($token, 'END-MAYBE') === 0 )
      return null;

    if( ! preg_match('/^([A-Za-z0-9_.-]+)(?:=(.+))?$/', $token, $m) )
      return null;

    if( ! isset($m[2]) )
      return [$m[1], null];

    if( strpos($m[2], '|') === false )
      return [$m[1], ['type' => 'text', 'default' => $m[2]]];

    $choices = array_map('trim', explode('|', $m[2]));
    return [$m[1], ['type' => 'choice', 'choices' => $choices, 'default' => $choices[0] ?? '']];
  }

  private function processIncludes( string $content, bool $forInline ) : string
  {
    $content = $this->processMaybeBlocks($content, $forInline);

    return preg_replace_callback('/^(\s*)\{\{\s*include:\s*["\']([^"\']+)["\']\s*\}\}/m', function( $matches ) use ( $forInline ) {

      [$line, $indent, $name] = $matches;

      // A snippet including itself (directly or through a chain) would recurse forever;
      // the marker stays in place instead, so the cycle is visible in the output
      $snippet = $this->findByName($name);
      if( ! $snippet || in_array($name, $this->includeStack, true) )
        return $line;

      $this->includeStack[] = $name;
      $included = $this->processIncludes((string)($snippet['content'] ?? ''), $forInline);
      array_pop($this->includeStack);

      if( $this->includedSameIndent )
        $included = implode("\n", array_map( fn($l) => $l === '' ? $l : $indent . $l, explode("\n", $included)));

      $included = preg_replace('/(\r?\n)+$/', '', $included);

      return $forInline && $this->highlightInclude
        ? "<<<INC:START:$name>>>$included<<<INC:END>>>"
        : $included;
    }, $content);
  }

  private function processMaybeBlocks( string $content, bool $forInline ) : string
  {
    // Consumes the whole tag lines (leading spaces + tag + trailing newline) so no blank lines remain
    $pattern = '/[^\S\n]*\{\{\s*MAYBE:\s*([^}]+)\s*\}\}[^\S\n]*\n?(.*?)[^\S\n]*\{\{\s*END-MAYBE\s*\}\}[^\S\n]*(\n?)/s';

    return preg_replace_callback($pattern, function( $matches ) use ( $forInline ) {

      $name  = trim($matches[1]);
      $block = rtrim( ltrim($matches[2], "\n"), "\n ");   // no extra blank lines from the block
      $block = $this->processMaybeBlocks($block, $forInline);

      // Inline, the block is its own element. As plain text it gets back the line break
      // of the END tag line, or the text after the block would join its last line.
      return $forInline ? "<<<MAYBE:START:$name>>>$block<<<MAYBE:END>>>" : $block . $matches[3];
    }, $content);
  }

  // First snippet with this name in tree order. A snippet is usually included many times
  // over and each lookup walks the tree, so results are kept for the request.
  private function findByName( string $name ) : ?array
  {
    $key = $this->sources->getCurrentLabel() . "\0$name";

    if( ! array_key_exists($key, $this->byName) )
    {
      $found = null;
      $this->tree->walk( function( array $item, string $fsPath ) use ( $name, &$found ) {
        if( $item['type'] !== 'file' || $item['name'] !== $name )
          return false;
        $found = $this->snippets->load($fsPath);   // a broken file must not end the search
        return $found !== null;
      });
      $this->byName[$key] = $found;
    }

    return $this->byName[$key];
  }
}
