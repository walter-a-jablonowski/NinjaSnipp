<?php

namespace SnippetManager\Ai;

// The rules of snippet_check: what keeps a snippet usable and its documentation in step
// with its content. Duplicate sc / id are looked for in the whole data set, also when only
// a folder is checked.
//
// Placeholders and MAYBE names are read like the usage form reads them (lib/functions.js
// extractContentVars() / extractContentMaybes(), kept in step by tests/fixtures). A name is
// "undocumented" when the snippet's own content uses it and usage does not list it, and
// "unused" when usage lists it but neither the content nor an include uses it.
class AiCheck
{
  private AiLibrary $lib;

  public function __construct( AiLibrary $lib )
  {
    $this->lib = $lib;
  }

  // Checks the snippet $path, the snippets below the folder $path, or with '' all of them:
  // ['checked' => n, 'problems' => [['path', 'source', 'issues' => [...]], ...]]
  public function run( string $path = '' ) : array
  {
    $all      = $this->lib->snippets();
    $template = $this->lib->manager->snippets->template();
    $format   = $this->lib->manager->snippets->formatVersion();
    $checked  = 0;
    $problems = [];

    $taken = ['sc' => [], 'id' => []];        // value => paths, for duplicates
    foreach( $all as $entry )
      foreach( ['sc', 'id'] as $key )
      {
        $value = $entry['snippet'][$key] ?? '';
        if( is_scalar($value) && (string)$value !== '' )
          $taken[$key][(string)$value][] = $entry['path'];
      }

    foreach( $all as $entry )
    {
      if( $path !== '' && $entry['path'] !== $path && strpos($entry['path'], "$path/") !== 0 )
        continue;

      $checked++;
      $issues = $this->issues($entry, $template, $format, $taken);

      if( $issues )
        $problems[] = ['path' => $entry['path'], 'source' => $this->lib->label($entry['base']), 'issues' => $issues];
    }

    return ['checked' => $checked, 'problems' => $problems];
  }

  private function issues( array $entry, array $template, int $format, array $taken ) : array
  {
    $snippet = $entry['snippet'];

    if( $snippet === null )
      return ['does not parse as YAML'];

    $content = (string)($snippet['content'] ?? '');
    $issues  = [];

    if( trim($content) === '' )
      $issues[] = 'no content';

    if( $snippet['_type'] === 'md' )
      return $issues;

    $renderer = $this->lib->manager->renderer;
    $usage    = is_array($snippet['usage'] ?? null) ? $snippet['usage'] : [];
    $id       = (string)($snippet['id'] ?? '');
    $version  = $snippet['version'] ?? null;

    if( $id === '' )
      $issues[] = 'no id';
    elseif( $id === (string)($template['id'] ?? '') )
      $issues[] = "id is still the template's ($id)";

    if( $version === null )
      $issues[] = 'no file format version';
    elseif( (int)$version < $format )
      $issues[] = "file format version $version, the current one is $format";

    if( trim((string)($snippet['short'] ?? '')) === '' )
      $issues[] = 'no short description';

    $used = [
      'vars'  => array_keys($renderer->extractPlaceholders($content)),
      'maybe' => $renderer->extractMaybes($content)
    ];
    $form = $renderer->formNames($snippet);
    $anywhere = [
      'vars'  => array_keys($form['placeholders']),
      'maybe' => $form['maybes']
    ];

    foreach( ['vars' => 'placeholders', 'maybe' => 'MAYBE blocks'] as $list => $what )
    {
      $listed = array_map('strval', array_keys( is_array($usage[$list] ?? null) ? $usage[$list] : []));

      if( $missing = array_diff($used[$list], $listed) )
        $issues[] = "$what not documented in usage.$list: " . implode(', ', $missing);
      if( $unused = array_diff($listed, $anywhere[$list]) )
        $issues[] = "usage.$list lists names the content does not use: " . implode(', ', $unused);
    }

    $opens  = preg_match_all('/\{\{\s*MAYBE:/', $content);
    $closes = preg_match_all('/\{\{\s*END-MAYBE\s*\}\}/', $content);
    if( $opens !== $closes )
      $issues[] = "$opens MAYBE but $closes END-MAYBE tags";

    foreach( $renderer->includeNames($content) as $name )
      if( $renderer->findInclude($name) === null )
        $issues[] = "include not found: \"$name\"";

    // The template's placeholder id is reported above, as such
    foreach( ['sc', 'id'] as $key )
    {
      $value  = (string)($snippet[$key] ?? '');
      $others = array_diff($taken[$key][$value] ?? [], [$entry['path']]);
      if( $value !== '' && $others && ! ($key === 'id' && $value === (string)($template['id'] ?? '')) )
        $issues[] = "$key \"$value\" is used by " . implode(', ', $others) . ' too';
    }

    return $issues;
  }
}
