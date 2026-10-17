<?php

namespace SnippetManager\Ai;

use RuntimeException;
use SnippetManager\SnippetManager;
use SnippetManager\UserStore;

// The tools the AI gets, in one registry: what the model is told about each (schema) and
// what a call does. Three kinds:
//   read    runs at once, the result goes back to the model
//   write   becomes a proposal the user accepts or rejects (AiChanges)
//   client  acts in the browser - a list, opening a snippet, filling the form - and
//           changes nothing on disk
//
// call() is the one entry for every provider: the API tool loop (AiChat) and the MCP
// server Claude Code talks to.
class AiTools
{
  private const MAX_TREE_ITEMS = 800;
  private const MAX_GET        = 20;
  private const MAX_HITS       = 40;

  private AiLibrary $lib;
  private AiChanges $changes;
  private UserStore $user;

  public function __construct( SnippetManager $manager, UserStore $user )
  {
    $this->lib     = new AiLibrary($manager);
    $this->changes = new AiChanges($this->lib);
    $this->user    = $user;
  }

  // Runs one tool call: ['result' => for the model, 'proposal' => ?array, 'client' => ?array].
  // A call that fails gets its error as the result, so the model can correct it in the turn.
  public function call( string $id, string $name, array $args ) : array
  {
    try {

      $kind = self::kind($name);

      if( $kind === 'read' )
        return ['result' => $this->read($name, $args)];

      if( $kind === 'write' )
      {
        $proposal = $this->changes->propose($id, $name, $args);

        // Not "success": a model reads that as done and tells the user so
        return [
          'result'   => ['status' => 'proposed_pending_user_approval', 'label' => $proposal['label'], 'warnings' => $proposal['warnings']],
          'proposal' => $proposal
        ];
      }

      if( $kind === 'client' )
        return $this->client($name, $args);

      throw new RuntimeException("Unknown tool: $name");
    }
    catch( RuntimeException $e ) {
      return ['result' => ['error' => $e->getMessage()]];
    }
  }

  // read | write | client, null for an unknown tool
  public static function kind( string $name ) : ?string
  {
    return self::definitions()[$name]['kind'] ?? null;
  }

  // The tools as the providers take them: [['name', 'description', 'parameters'], ...]
  public static function defs() : array
  {
    $defs = [];
    foreach( self::definitions() as $name => $tool )
      $defs[] = ['name' => $name, 'description' => $tool['description'], 'parameters' => $tool['parameters']];

    return $defs;
  }

  // --- Read ---

  private function read( string $name, array $args ) : array
  {
    $manager = $this->lib->manager;
    $source  = AiArgs::optionalString($args, 'source');

    switch( $name )
    {
      case 'sources_get':
        return [
          'dataSet'           => $manager->sources->getCurrentLabel(),
          'sources'           => array_map( fn( $base ) => [
                                   'label'      => $this->lib->label($base),
                                   'sharedWith' => $this->lib->sharedWith($base)
                                 ], $manager->sources->getPaths()),
          'foldersMerged'     => $manager->tree->isMerged(),
          'otherDataSets'     => array_values( array_diff( array_keys($manager->sources->getDataSets()), [$manager->sources->getCurrentLabel()])),
          'colors'            => array_keys($manager->colors->getPalette('light')),
          'fileFormatVersion' => $manager->snippets->formatVersion()
        ];

      case 'tree_list':
        $path    = AiLibrary::cleanPath( AiArgs::string($args, 'path', ''));
        $depth   = max(1, min(5, AiArgs::int($args, 'depth', 2)));
        $count   = 0;
        $visited = [];

        if( $path !== '' && ! $this->lib->isFolder($path) )
          throw new RuntimeException("No folder $path");

        $items = $this->treeLevel($path, $depth, $count, $visited);
        return ['path' => $path, 'items' => $items] + ($count > self::MAX_TREE_ITEMS ? ['truncated' => true] : []);

      case 'snippet_search':
        $hits = array_slice($manager->search->search( AiArgs::string($args, 'query')), 0, self::MAX_HITS);
        return ['hits' => array_map( fn( $hit ) => array_filter([
          'path'   => $hit['path'],
          'type'   => $hit['type'] === 'folder' ? 'folder' : 'snippet',
          'source' => $this->lib->label( $hit['basePath'] ?? (string)$this->lib->shownBase($hit['path'], $hit['type'] === 'folder')),
          'short'  => $hit['snippet']['short'] ?? null
        ]), $hits)];

      case 'snippet_get':
        $paths = AiArgs::strings($args, 'paths');
        if( ! $paths )
          throw new RuntimeException('Missing argument: paths');
        if( count($paths) > self::MAX_GET )
          throw new RuntimeException('At most ' . self::MAX_GET . ' paths per call');

        return ['snippets' => array_map( fn( $path ) => $this->snippetInfo( AiLibrary::cleanPath($path), $source), $paths)];

      case 'snippet_usages':
        $path   = AiLibrary::cleanPath( AiArgs::string($args, 'path'));
        $folder = $this->lib->isFolder($path);
        $usages = ['links' => $this->lib->linksTo($path)];

        if( ! $folder )
        {
          $this->lib->locateFile($path, $source);
          $name    = pathinfo($path, PATHINFO_FILENAME);
          $resolve = $manager->renderer->findInclude($name);

          $usages['includedBy'] = array_map( fn( $by ) => [
            'path'   => $by['path'],
            'source' => $this->lib->label( $by['basePath'] ?? (string)$this->lib->shownBase($by['path']))
          ], $manager->renderer->includedBy($name));

          if( $resolve && $resolve['path'] !== $path )
            $usages['note'] = "An include of \"$name\" finds {$resolve['path']} first, not this snippet";
        }

        return $usages;

      case 'snippet_render':
        $at = $this->lib->snippetAt( AiLibrary::cleanPath( AiArgs::string($args, 'path')), $source);
        return [
          'text' => $manager->renderer->render($at['snippet'], AiArgs::map($args, 'values'), AiArgs::strings($args, 'maybeOff')),
          'form' => $manager->renderer->formNames($at['snippet'])
        ];

      case 'snippet_check':
        $path = AiLibrary::cleanPath( AiArgs::string($args, 'path', ''));
        if( $path !== '' && ! $this->lib->isFolder($path) )
          $this->lib->locateFile($path, $source);           // a single snippet: must exist
        return (new AiCheck($this->lib))->run($path);

      case 'recent_get':
        return ['recent' => array_map( fn( $entry ) => [
          'path'   => preg_replace('/#\d+$/', '', (string)($entry['path'] ?? '')),
          'opened' => date('Y-m-d H:i', (int)(($entry['timestamp'] ?? 0) / 1000))
        ], array_slice($this->user->getRecentSnippets($manager->sources->getCurrentLabel()), 0, 20))];
    }

    throw new RuntimeException("Unknown tool: $name");
  }

  // One tree level with $depth levels below: items as the tree shows them, a file of
  // several sources once with all of them, a folder shown through a link entered once
  private function treeLevel( string $path, int $depth, int &$count, array &$visited ) : array
  {
    $visited[$path] = true;
    $byPath         = [];

    foreach( $this->lib->manager->tree->listFiles($path) as $item )
    {
      $fsPath = $item['fsPath'] ?? $item['path'];
      $bases  = $item['mergedBases'] ?? [ empty($item['isIncluded']) ? $item['basePath'] : (string)$this->lib->shownBase($fsPath, $item['type'] === 'folder')];

      if( isset($byPath[$fsPath]) )
      {
        $byPath[$fsPath]['sources'] = array_values( array_unique( array_merge($byPath[$fsPath]['sources'], array_map([$this->lib, 'label'], $bases))));
        continue;
      }

      if( ++$count > self::MAX_TREE_ITEMS )
        break;

      $entry = [
        'name'    => AiLibrary::displayName($fsPath),
        'path'    => $fsPath,
        'type'    => $item['type'] === 'folder' ? 'folder' : $item['extension'],
        'sources' => array_map([$this->lib, 'label'], $bases)
      ];

      if( ! empty($item['isIncluded']) )
        $entry['link'] = true;                                 // shown here through an INCLUDE link
      if( ! empty($item['colorName']) )
        $entry['color'] = $item['colorName'];

      if( $item['type'] === 'file' && $item['extension'] === 'yml' )
      {
        $short = $this->lib->manager->snippets->load($fsPath, $bases[0])['short'] ?? '';
        if( is_string($short) && $short !== '' )
          $entry['short'] = $short;
      }

      if( $item['type'] === 'folder' && ! isset($visited[$fsPath]) )
      {
        if( $depth > 1 )
          $entry['items'] = $this->treeLevel($fsPath, $depth - 1, $count, $visited);
        else
          $entry['more'] = true;                               // list it with tree_list(path)
      }

      $byPath[$fsPath] = $entry;
    }

    return array_values($byPath);
  }

  private function snippetInfo( string $path, ?string $source ) : array
  {
    try {
      ['base' => $base, 'snippet' => $snippet] = $this->lib->snippetAt($path, $source);
    }
    catch( RuntimeException $e ) {
      return ['path' => $path, 'error' => $e->getMessage()];
    }

    $renderer = $this->lib->manager->renderer;
    $content  = (string)($snippet['content'] ?? '');
    $includes = [];

    foreach( $renderer->includeNames($content) as $name )
      $includes[$name] = $renderer->findInclude($name)['path'] ?? null;

    return [
      'path'         => $path,
      'source'       => $this->lib->label($base),
      'type'         => $snippet['_type'],
      'fields'       => array_diff_key($snippet, ['_type' => true, '_name' => true]),
      'placeholders' => $renderer->extractPlaceholders($content),
      'maybes'       => $renderer->extractMaybes($content),
      'includes'     => (object)$includes                        // name => path, null when not found
    ];
  }

  // --- Client ---

  private function client( string $name, array $args ) : array
  {
    $source = AiArgs::optionalString($args, 'source');

    if( $name === 'show_items' )
    {
      $items = [];
      foreach( AiArgs::objects($args, 'items') as $entry )
        $items[] = $this->clientItem( AiLibrary::cleanPath( AiArgs::string($entry, 'path')), AiArgs::optionalString($entry, 'source'))
                 + ['note' => AiArgs::string($entry, 'note', '')];

      if( ! $items )
        throw new RuntimeException('Missing argument: items');

      return [
        'result' => ['status' => 'shown_to_user'],
        'client' => ['tool' => $name, 'title' => AiArgs::string($args, 'title', ''), 'items' => $items]
      ];
    }

    $at = $this->lib->snippetAt( AiLibrary::cleanPath( AiArgs::string($args, 'path')), $source);
    $item = ['path' => $at['path'], 'source' => $this->lib->label($at['base']), 'basePath' => $at['base']];

    if( $name === 'snippet_open' )
      return ['result' => ['status' => 'opened'], 'client' => ['tool' => $name] + $item];

    // form_fill: only what the form has, so a typo does not get lost silently
    $form     = $this->lib->manager->renderer->formNames($at['snippet']);
    $values   = array_map('strval', array_filter( AiArgs::map($args, 'values'), 'is_scalar'));
    $maybeOff = AiArgs::strings($args, 'maybeOff');

    if( $unknown = array_diff( array_keys($values), array_keys($form['placeholders'])) )
      throw new RuntimeException('Not in the form: ' . implode(', ', $unknown) . '. Placeholders: ' . implode(', ', array_keys($form['placeholders'])));
    if( $unknown = array_diff($maybeOff, $form['maybes']) )
      throw new RuntimeException('No MAYBE block ' . implode(', ', $unknown) . '. MAYBE blocks: ' . implode(', ', $form['maybes']));

    return [
      'result' => ['status' => 'filled_in_form', 'note' => 'The user checks the form and copies the prompt from the app'],
      'client' => ['tool' => $name, 'values' => (object)$values, 'maybeOff' => $maybeOff] + $item
    ];
  }

  // An entry of a shown list; one that does not exist is shown greyed out, not refused
  private function clientItem( string $path, ?string $source ) : array
  {
    $folder = $this->lib->isFolder($path);

    try {
      $base = $folder ? $this->lib->folderBases($path, $source)[0] : $this->lib->locateFile($path, $source);
      return ['path' => $path, 'type' => $folder ? 'folder' : 'snippet', 'source' => $this->lib->label($base), 'basePath' => $base, 'exists' => true];
    }
    catch( RuntimeException $e ) {
      return ['path' => $path, 'type' => 'snippet', 'exists' => false];
    }
  }

  // --- Registry ---

  private static function definitions() : array
  {
    static $definitions = null;
    if( $definitions !== null )
      return $definitions;

    $path   = ['type' => 'string', 'description' => 'Path of the item as tree_list shows it, relative to the source folders, ordinal prefixes and extension included, e.g. "20 Coding/Review.yml"'];
    $source = ['type' => 'string', 'description' => 'Source label (sources_get). Only needed when the item exists in several sources.'];
    $values = ['type' => 'object', 'description' => 'Placeholder name: value', 'additionalProperties' => ['type' => 'string']];
    $off    = ['type' => 'array', 'items' => ['type' => 'string'], 'description' => 'MAYBE blocks to leave out; all others are kept'];
    $fields = 'Dotted field names: content, short, sc, usage (whole), usage.head, usage.text, usage.vars, usage.maybe, '
            . 'usage.vars.<placeholder>, usage.maybe.<name> (one entry). A list (usage.vars / usage.maybe) maps names to their description.';

    $schema = fn( array $properties, array $required = [] ) => ['type' => 'object', 'properties' => (object)$properties] + ($required ? ['required' => $required] : []);

    $definitions = [

      // Read

      'sources_get' => ['kind' => 'read',
        'description' => 'The current data set: its source folders (labels, and which other data sets share them), whether same-named folders are merged, the other data sets, the color names and the current file format version.',
        'parameters'  => $schema([])],

      'tree_list' => ['kind' => 'read',
        'description' => 'The folders and snippets of the data set as a tree, with the short description of each snippet. Folders deeper than depth carry "more": list them with their path. "link" marks an item shown through an INCLUDE link (its path is its real one).',
        'parameters'  => $schema([
          'path'  => ['type' => 'string', 'description' => 'Folder to list, "" for the root (default)'],
          'depth' => ['type' => 'integer', 'description' => 'Levels to list, 1 to 5 (default 2)']
        ])],

      'snippet_search' => ['kind' => 'read',
        'description' => 'Full-text search (case-insensitive substring) over the name, sc, short, usage and content of every snippet, and folder names. Best ranked first.',
        'parameters'  => $schema(['query' => ['type' => 'string']], ['query'])],

      'snippet_get' => ['kind' => 'read',
        'description' => 'Whole snippets: all fields, the placeholders and MAYBE names of the content, and its includes with the snippet each one resolves to (null: not found).',
        'parameters'  => $schema([
          'paths'  => ['type' => 'array', 'items' => ['type' => 'string'], 'description' => 'Up to 20 paths'],
          'source' => $source
        ], ['paths'])],

      'snippet_usages' => ['kind' => 'read',
        'description' => 'Where a snippet is used: the snippets that include it by name, and the INCLUDE links that show it (or a folder) elsewhere. Check this before renaming, moving or deleting.',
        'parameters'  => $schema(['path' => $path, 'source' => $source], ['path'])],

      'snippet_render' => ['kind' => 'read',
        'description' => 'The final text of a snippet as the user copies it: includes resolved, MAYBE blocks applied, placeholders filled from values or their defaults (a placeholder without either stays {{name}}). Also returns what the form offers (placeholders and MAYBE names, includes counted in).',
        'parameters'  => $schema(['path' => $path, 'values' => $values, 'maybeOff' => $off, 'source' => $source], ['path'])],

      'snippet_check' => ['kind' => 'read',
        'description' => 'Checks snippets: undocumented or unused placeholders and MAYBE names, unbalanced MAYBE tags, includes not found, missing id / short / content, an old file format, duplicate sc or id, files that do not parse. Returns only snippets with problems.',
        'parameters'  => $schema(['path' => ['type' => 'string', 'description' => 'A snippet or folder (recursive); "" for the whole data set (default)'], 'source' => $source])],

      'recent_get' => ['kind' => 'read',
        'description' => 'The snippets the user opened lately in this data set, newest first.',
        'parameters'  => $schema([])],

      // Write

      'snippet_create' => ['kind' => 'write',
        'description' => 'Creates a snippet. A .yml one starts from the snippet template and gets a new id; the fields you give replace the template\'s (a usage field only that one). A .md one is just content.',
        'parameters'  => $schema([
          'path'   => ['type' => 'string', 'description' => 'Path of the new snippet with .yml or .md, e.g. "Reviews/Code review.yml"'],
          'fields' => ['type' => 'object', 'description' => $fields],
          'source' => ['type' => 'string', 'description' => 'Source label, needed when the folder exists in several sources (always so at the root of a data set with several sources)']
        ], ['path'])],

      'snippet_update' => ['kind' => 'write',
        'description' => 'Sets fields of a snippet; the others stay. null removes a field or list entry. For a change of a few lines in a long text use snippet_edit. id and version are never changed.',
        'parameters'  => $schema([
          'path'   => $path,
          'fields' => ['type' => 'object', 'description' => $fields],
          'source' => $source
        ], ['path', 'fields'])],

      'snippet_edit' => ['kind' => 'write',
        'description' => 'Replaces text in text fields of a snippet. Each old text has to occur exactly once in its field, whitespace and line breaks included. Several edits of one snippet go in one call.',
        'parameters'  => $schema([
          'path'   => $path,
          'edits'  => ['type' => 'array', 'items' => $schema([
                        'field' => ['type' => 'string', 'description' => 'content, short, sc, usage.head, usage.text, usage.<key> or usage.vars.<placeholder>'],
                        'old'   => ['type' => 'string'],
                        'new'   => ['type' => 'string']
                      ], ['field', 'old', 'new'])],
          'source' => $source
        ], ['path', 'edits'])],

      'snippet_duplicate' => ['kind' => 'write',
        'description' => 'Copies a snippet into the same source, e.g. as the start of a variant. The copy is a new prompt and gets a new id.',
        'parameters'  => $schema(['path' => $path, 'newPath' => ['type' => 'string', 'description' => 'Path of the copy'], 'source' => $source], ['path', 'newPath'])],

      'snippet_delete' => ['kind' => 'write',
        'description' => 'Deletes a snippet file.',
        'parameters'  => $schema(['path' => $path, 'source' => $source], ['path'])],

      'folder_create' => ['kind' => 'write',
        'description' => 'Creates a folder (parent folders too).',
        'parameters'  => $schema(['path' => ['type' => 'string', 'description' => 'Path of the new folder'], 'source' => $source], ['path'])],

      'link_create' => ['kind' => 'write',
        'description' => 'Shows a folder or snippet of a source root in another folder too, through an INCLUDE link (an empty marker file "INCLUDE <name>"). Nothing is copied.',
        'parameters'  => $schema([
          'folder' => ['type' => 'string', 'description' => 'Folder to show it in, "" for the root'],
          'target' => ['type' => 'string', 'description' => 'Name of a folder or snippet at the root of a source'],
          'source' => $source
        ], ['target'])],

      'item_rename' => ['kind' => 'write',
        'description' => 'Renames a snippet or folder in its folder (a merged folder in all its sources). An ordinal prefix ("20 ") is part of the name. Includes find a snippet by name: propose snippet_edit for the snippets that include it too.',
        'parameters'  => $schema(['path' => $path, 'newName' => ['type' => 'string', 'description' => 'The new name; a snippet keeps its extension'], 'source' => $source], ['path', 'newName'])],

      'item_move' => ['kind' => 'write',
        'description' => 'Moves a snippet or folder into another folder of the same source, which is created if missing. The name stays, so includes still find it.',
        'parameters'  => $schema(['path' => $path, 'toFolder' => ['type' => 'string', 'description' => 'Target folder, "" for the root'], 'source' => $source], ['path', 'toFolder'])],

      'item_color' => ['kind' => 'write',
        'description' => 'Tags a snippet or folder with a color (names: sources_get), "" clears it.',
        'parameters'  => $schema(['path' => $path, 'color' => ['type' => 'string'], 'source' => $source], ['path', 'color'])],

      // Client

      'show_items' => ['kind' => 'client',
        'description' => 'Shows the user a clickable list of snippets or folders below your answer, e.g. search results or what to look at. A click opens the item.',
        'parameters'  => $schema([
          'title' => ['type' => 'string'],
          'items' => ['type' => 'array', 'items' => $schema(['path' => $path, 'note' => ['type' => 'string', 'description' => 'Why it is listed'], 'source' => $source], ['path'])]
        ], ['items'])],

      'snippet_open' => ['kind' => 'client',
        'description' => 'Opens a snippet in the editor.',
        'parameters'  => $schema(['path' => $path, 'source' => $source], ['path'])],

      'form_fill' => ['kind' => 'client',
        'description' => 'Opens a snippet and fills its form in the preview: placeholder values and which MAYBE blocks are off. The user checks it and copies the prompt as usual. Names as snippet_render returns them in form.',
        'parameters'  => $schema(['path' => $path, 'values' => $values, 'maybeOff' => $off, 'source' => $source], ['path'])]
    ];

    return $definitions;
  }
}
