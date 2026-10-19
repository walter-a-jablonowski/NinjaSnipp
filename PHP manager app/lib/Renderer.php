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
  // An include stands on a line of its own; the indent is kept for includedSameIndent
  private const INCLUDE_PATTERN = '/^(\s*)\{\{\s*include:\s*["\']([^"\']+)["\']\s*\}\}/m';
  // Mirrored by extractContentMaybes() in lib/functions.js (case-sensitive like there)
  private const MAYBE_NAME_PATTERN = '/\{\{\s*MAYBE:\s*([^}]+?)\s*\}\}/';

  private Sources $sources;
  private FileTree $tree;
  private SnippetStore $snippets;
  private bool $includedSameIndent;
  private bool $highlightInclude;
  private array $byName = [];         // "dataSet\0name" => ['path', 'snippet']|null, per request
  private array $includeStack = [];   // snippets being included right now (cycle guard)
  private array $maybeOff = [];       // MAYBE names render() leaves out

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
    $this->maybeOff     = [];
    return $this->process((string)$snippet['content'], true);
  }

  // Plain text: includes and MAYBE blocks resolved, placeholders filled from $values
  // or their defaults (the first choice for choice placeholders). A MAYBE block is kept
  // unless its name is in $maybeOff, in included snippets too - as in the preview, where
  // a switch sets every block of that name.
  public function render( array $snippet, array $values = [], array $maybeOff = [] ) : string
  {
    if( ! isset($snippet['content']) )
      return '';

    $this->includeStack = [];
    $this->maybeOff     = $maybeOff;
    $content = $this->process((string)$snippet['content'], false);

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

  // Copy output: text blocks (split at blank lines) with their soft wrapped lines joined, one
  // blank line between them. Structured lines (list items, headings, quotes, tables, code,
  // indented lines) keep their line breaks. Mirrors SnippetForm.unwrap() in lib/snippet-form.js,
  // tests/fixtures/unwrap.json runs against both.
  public function unwrap( string $text ) : string
  {
    $structured = '/^(?:[ \t]*(?:[-*+•]|\d+[.)])[ \t]|[ \t]*(?:#{1,6}[ \t]|>|\||```)|[ \t]+\S)/u';
    $blocks     = [];

    foreach( preg_split('/\n{2,}/', $text) as $block )
    {
      $lines = [];
      foreach( explode("\n", $block) as $line )
      {
        // Squeeze inner runs of blanks, keep the indent (nested lists)
        $indent = substr($line, 0, strspn($line, " \t"));
        $line   = $indent . trim( preg_replace('/[ \t]{2,}/', ' ', substr($line, strlen($indent))));
        if( trim($line) === '' )
          continue;

        $last = count($lines) - 1;
        if( $last >= 0 && ! preg_match($structured, $line) && ! preg_match($structured, $lines[$last]) )
          $lines[$last] .= " $line";
        else
          $lines[] = $line;
      }

      if( $lines )
        $blocks[] = implode("\n", $lines);
    }

    return implode("\n\n", $blocks);
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

  // What the preview form offers for a snippet, its includes counted in:
  // ['placeholders' => name => spec, 'maybes' => [name, ...]]
  public function formNames( array $snippet ) : array
  {
    $composed = $this->compose($snippet);
    preg_match_all('/<<<MAYBE:START:([^>]+)>>>/', $composed, $matches);

    return [
      'placeholders' => $this->extractPlaceholders($composed),
      'maybes'       => array_values( array_unique($matches[1]))
    ];
  }

  // Names of the MAYBE blocks, in order of first use
  public function extractMaybes( string $content ) : array
  {
    preg_match_all(self::MAYBE_NAME_PATTERN, $content, $matches);
    return array_values( array_unique( array_map('trim', $matches[1])));
  }

  // Names of the snippets the content includes, in order of first use
  public function includeNames( string $content ) : array
  {
    preg_match_all(self::INCLUDE_PATTERN, $content, $matches);
    return array_values( array_unique($matches[2]));
  }

  // The snippets that include the one called $name: ['path' => fsPath, 'basePath' => ?string]
  public function includedBy( string $name ) : array
  {
    $found = [];

    $this->tree->walk( function( array $item, string $fsPath ) use ( $name, &$found ) {

      // A link's basePath is the source holding the marker, not the target (see Search)
      $base = empty($item['isIncluded']) ? ($item['basePath'] ?? null) : null;

      if( $item['type'] !== 'file' || isset($found["$base\0$fsPath"]) )
        return;

      $snippet = $this->snippets->load($fsPath, $base);
      if( $snippet && in_array($name, $this->includeNames( (string)($snippet['content'] ?? '')), true) )
        $found["$base\0$fsPath"] = ['path' => $fsPath, 'basePath' => $base];
    });

    return array_values($found);
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

  // Includes first, MAYBE blocks after (process()): an include is found by its place at the
  // start of a line, and an inline MAYBE marker takes the line break of its END line - an
  // include right below a block, or as its first line, would no longer be found
  private function process( string $content, bool $forInline ) : string
  {
    return $this->processMaybeBlocks( $this->resolveIncludes($content, $forInline), $forInline);
  }

  private function resolveIncludes( string $content, bool $forInline ) : string
  {
    return preg_replace_callback(self::INCLUDE_PATTERN, function( $matches ) use ( $forInline ) {

      [$line, $indent, $name] = $matches;

      // A snippet including itself (directly or through a chain) would recurse forever;
      // the marker stays in place instead, so the cycle is visible in the output
      $snippet = $this->findInclude($name)['snippet'] ?? null;
      if( ! $snippet || in_array($name, $this->includeStack, true) )
        return $line;

      $this->includeStack[] = $name;
      $included = $this->resolveIncludes((string)($snippet['content'] ?? ''), $forInline);
      array_pop($this->includeStack);

      if( $this->includedSameIndent )
        $included = implode("\n", array_map( fn($l) => $l === '' ? $l : $indent . $l, explode("\n", $included)));

      $included = preg_replace('/(\r?\n)+$/', '', $included);

      return $forInline && $this->highlightInclude
        ? "<<<INC:START:$name>>>$included<<<INC:END>>>"
        : $included;
    }, $content);
  }

  // A block on lines of its own is like those lines: on, its text keeps the line break of the
  // END tag line (else the text after the block would join its last line); off, the lines are
  // gone. A block within a line keeps the blanks around it, they separate it from the text.
  // For the inline editor the line break is inside the markers: it goes with the block, the
  // copy output (SnippetForm.updateText) then is the same text as render() gives.
  private function processMaybeBlocks( string $content, bool $forInline ) : string
  {
    // Consumes the whole tag lines (leading spaces + tag + trailing newline) so no blank lines remain
    $pattern = '/([^\S\n]*)\{\{\s*MAYBE:\s*([^}]+)\s*\}\}[^\S\n]*\n?(.*?)[^\S\n]*\{\{\s*END-MAYBE\s*\}\}([^\S\n]*)(\n?)/s';

    return preg_replace_callback($pattern, function( $matches ) use ( $content, $forInline ) {

      $offset    = $matches[0][1];
      $name      = trim($matches[2][0]);
      $lineBreak = $matches[5][0];
      $before    = $offset > 0 && $content[$offset - 1] !== "\n" ? $matches[1][0] : '';   // the indent of a tag line is no text
      $after     = $lineBreak === '' ? $matches[4][0] : '';

      $block = rtrim( ltrim($matches[3][0], "\n"), "\n ");   // no extra blank lines from the block
      $block = $this->processMaybeBlocks($block, $forInline) . $lineBreak;

      if( $forInline )
        return "$before<<<MAYBE:START:$name>>>$block<<<MAYBE:END>>>$after";

      return in_array($name, $this->maybeOff, true) ? $before . $after : $before . $block . $after;
    }, $content, -1, $count, PREG_OFFSET_CAPTURE);
  }

  // The snippet an include of $name resolves to, ['path' => fsPath, 'snippet'], or null:
  // the first snippet with this name in tree order. A snippet is usually included many
  // times over and each lookup walks the tree, so results are kept for the request.
  public function findInclude( string $name ) : ?array
  {
    $key = $this->sources->getCurrentLabel() . "\0$name";

    if( ! array_key_exists($key, $this->byName) )
    {
      $found = null;
      $this->tree->walk( function( array $item, string $fsPath ) use ( $name, &$found ) {
        if( $item['type'] !== 'file' || $item['name'] !== $name )
          return false;
        $snippet = $this->snippets->load($fsPath);   // a broken file must not end the search
        $found   = $snippet !== null ? ['path' => $fsPath, 'snippet' => $snippet] : null;
        return $found !== null;
      });
      $this->byName[$key] = $found;
    }

    return $this->byName[$key];
  }
}
