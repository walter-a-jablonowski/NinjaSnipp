<?php

namespace SnippetManager\Ai;

use RuntimeException;
use SnippetManager\ColorStore;
use Symfony\Component\Yaml\Yaml;

// The write tools. A call is never run when the model makes it: it becomes a proposal the
// user accepts or rejects in the sidebar, and only an accepted one is applied.
//
// Both go through prepare(), which checks a call against the library as it is now and
// works out what it would change:
//   label     one line for the sidebar row
//   path      the item, source  its source label
//   preview   [['field', 'before', 'after'], ...] read from the files, never from the model
//   warnings  what else the change affects (includes by name, links, shared sources)
//   hash      md5 of what the change is based on, null when its own checks guard it
//   paths     items the client has to refresh afterwards
//   apply     the change itself (not part of a proposal)
//   effects   what apply touches on disk, for the undo (AiUndo, not part of a proposal):
//             files (absolute) it writes or deletes, moves [from, to], dirs it creates
//
// Applying prepares the call again, so it is checked once more and works on the files as
// they are then. The hash makes it refuse when the user changed the same thing meanwhile.
class AiChanges
{
  // Fields of a yml snippet the model may set; id and version are never changed by it
  private const TEXT_FIELDS = ['content', 'short', 'sc'];

  private AiLibrary $lib;

  public function __construct( AiLibrary $lib )
  {
    $this->lib = $lib;
  }

  public function propose( string $id, string $tool, array $args ) : array
  {
    $change = $this->prepare($tool, $args);
    unset($change['apply'], $change['effects']);

    return ['id' => $id, 'tool' => $tool, 'args' => $args] + $change;
  }

  // Returns the paths to refresh. With $undo the change is recorded under $checkpoint (the
  // answer it came with), so it can be taken back.
  public function apply( array $proposal, ?AiUndo $undo = null, string $checkpoint = '' ) : array
  {
    $change = $this->prepare( (string)($proposal['tool'] ?? ''), is_array($proposal['args'] ?? null) ? $proposal['args'] : []);

    if( $change['hash'] !== ($proposal['hash'] ?? null) )
      throw new RuntimeException('Changed since it was proposed - ask the AI again');

    if( $undo )
      $undo->record($checkpoint, $change['effects'], $change['apply']);
    else
      ($change['apply'])();

    return $change['paths'];
  }

  private function prepare( string $tool, array $args ) : array
  {
    $source = AiArgs::optionalString($args, 'source');

    switch( $tool )
    {
      case 'snippet_create':    return $this->create($args, $source);
      case 'snippet_update':    return $this->update($args, $source);
      case 'snippet_edit':      return $this->edit($args, $source);
      case 'snippet_duplicate': return $this->duplicate($args, $source);
      case 'snippet_delete':    return $this->delete($args, $source);
      case 'folder_create':     return $this->createFolder($args, $source);
      case 'link_create':       return $this->createLink($args, $source);
      case 'item_rename':       return $this->rename($args, $source);
      case 'item_move':         return $this->move($args, $source);
      case 'item_color':        return $this->color($args, $source);
    }

    throw new RuntimeException("Unknown tool: $tool");
  }

  // --- Snippets ---

  // The fields go on top of the snippet template (SnippetStore::create())
  private function create( array $args, ?string $source ) : array
  {
    $path = $this->path($args);
    $type = pathinfo($path, PATHINFO_EXTENSION);

    if( $type !== 'yml' && $type !== 'md' )
      throw new RuntimeException('The path needs the extension .yml (snippet) or .md (markdown file)');
    if( $this->lib->basesOf($path) )
      throw new RuntimeException("$path exists already");

    $data    = ['_type' => $type];
    $touched = [];
    foreach( AiArgs::map($args, 'fields') as $key => $value )
      $touched[] = $this->setField($data, (string)$key, $value);

    unset($data['_type']);
    $this->requireContent($data);
    $base = $this->lib->baseForNew($path, $source);

    return $this->change('Create *' . AiLibrary::displayName($path) . '*', $path, $base,
      $this->diff([], $data, array_values( array_unique($touched))), [],
      fn() => $this->lib->manager->snippets->create($path, $data, $base)
    );
  }

  private function update( array $args, ?string $source ) : array
  {
    ['path' => $path, 'base' => $base, 'snippet' => $snippet] = $this->lib->snippetAt($this->path($args), $source);
    $fields = AiArgs::map($args, 'fields');

    if( ! $fields )
      throw new RuntimeException('Missing argument: fields');

    $data    = $snippet;
    $touched = [];
    foreach( $fields as $key => $value )
      $touched[] = $this->setField($data, (string)$key, $value);

    $touched = array_values( array_unique($touched));
    $this->requireContent($data);

    // Based on the fields it sets: a change of another field meanwhile does not matter
    $hash = md5( json_encode( array_map( fn( $field ) => $this->get($snippet, $field), $touched)));

    return $this->change('Update *' . AiLibrary::displayName($path) . '*: ' . implode(', ', $touched), $path, $base,
      $this->diff($snippet, $data, $touched), [],
      fn() => $this->lib->manager->snippets->save($path, $data, $base),
      ['hash' => $hash]
    );
  }

  // Each edit replaces text that occurs exactly once, which is its own guard: no hash
  private function edit( array $args, ?string $source ) : array
  {
    ['path' => $path, 'base' => $base, 'snippet' => $snippet] = $this->lib->snippetAt($this->path($args), $source);
    $edits = AiArgs::objects($args, 'edits');

    if( ! $edits )
      throw new RuntimeException('Missing argument: edits');

    $data    = $snippet;
    $touched = [];
    foreach( $edits as $n => $edit )
    {
      $field = AiArgs::string($edit, 'field');
      $old   = AiArgs::string($edit, 'old');
      $new   = AiArgs::string($edit, 'new', '');
      $value = $this->get($data, $field);
      $where = "edit " . ($n + 1) . " ($field)";

      if( ! is_string($value) )
        throw new RuntimeException("$where: $field is no text field" . ($value === null ? ' of this snippet' : ''));
      if( $old === '' )
        throw new RuntimeException("$where: old must not be empty");

      $count = substr_count($value, $old);
      if( $count === 0 )
        throw new RuntimeException("$where: old text not found - it has to match exactly, line breaks and spaces included");
      if( $count > 1 )
        throw new RuntimeException("$where: old text occurs $count times - give more of the surrounding text");

      $this->setField($data, $field, substr_replace($value, $new, strpos($value, $old), strlen($old)));
      $touched[] = $field;
    }

    $touched = array_values( array_unique($touched));
    $this->requireContent($data);

    return $this->change('Edit *' . AiLibrary::displayName($path) . '*: ' . implode(', ', $touched), $path, $base,
      $this->diff($snippet, $data, $touched), [],
      fn() => $this->lib->manager->snippets->save($path, $data, $base)
    );
  }

  private function duplicate( array $args, ?string $source ) : array
  {
    ['path' => $path, 'base' => $base] = $this->lib->snippetAt($this->path($args), $source);
    $newPath = AiLibrary::cleanPath( AiArgs::string($args, 'newPath'));
    $ext     = pathinfo($path, PATHINFO_EXTENSION);

    if( pathinfo($newPath, PATHINFO_EXTENSION) !== $ext )
      $newPath .= ".$ext";
    if( $this->lib->basesOf($newPath) )
      throw new RuntimeException("$newPath exists already");

    $preview = [['field' => 'path', 'before' => $path, 'after' => $newPath]];
    if( $ext === 'yml' )
      $preview[] = ['field' => 'id', 'before' => '', 'after' => 'a new id of today (the copy is a new prompt)'];

    return $this->change('Duplicate *' . AiLibrary::displayName($path) . '* as *' . AiLibrary::displayName($newPath) . '*', $newPath, $base,
      $preview, [],
      fn() => $this->lib->manager->snippets->duplicate($path, $newPath, $base)
    );
  }

  private function delete( array $args, ?string $source ) : array
  {
    $path    = $this->path($args);
    $base    = $this->lib->locateFile($path, $source);
    $snippet = $this->lib->manager->snippets->load($path, $base);   // a broken file may be deleted too

    return $this->change('Delete *' . AiLibrary::displayName($path) . '*', $path, $base,
      [['field' => 'content', 'before' => (string)($snippet['content'] ?? ''), 'after' => '']],
      array_merge($this->includeWarnings($path, 'deleting'), $this->linkWarnings($path)),
      fn() => $this->lib->manager->snippets->delete($path, $base),
      [
        'hash'    => md5_file("$base/$path"),
        'effects' => ['files' => ["$base/$path", ColorStore::file( dirname("$base/$path"))]]   // its color goes too
      ]
    );
  }

  // --- Folders, links, names, colors ---

  private function createFolder( array $args, ?string $source ) : array
  {
    $path = $this->path($args);
    $base = $this->lib->baseForNew($path, $source);

    if( file_exists("$base/$path") )
      throw new RuntimeException("$path exists already in " . $this->lib->label($base));

    return $this->change('Create folder *' . AiLibrary::displayName($path) . '*', $path, $base, [], [],
      fn() => $this->lib->manager->files->createFolder($path, $base),
      ['effects' => ['files' => [], 'dirs' => ["$base/$path"]]]
    );
  }

  private function createLink( array $args, ?string $source ) : array
  {
    $folder = AiLibrary::cleanPath( AiArgs::string($args, 'folder', ''));
    $target = preg_replace('/\.(yml|md)$/', '', AiLibrary::cleanPath( AiArgs::string($args, 'target')));
    $marker = ($folder !== '' ? "$folder/" : '') . "INCLUDE $target";

    if( strpos($target, '/') !== false )
      throw new RuntimeException('A link target is a folder or snippet at the root of a source: give its name only');
    if( ! $this->lib->isFolder($target) && ! $this->lib->basesOf("$target.yml") && ! $this->lib->basesOf("$target.md") )
      throw new RuntimeException("No folder or snippet $target at the root of a source");
    if( $folder !== '' && ! $this->lib->isFolder($folder) )
      throw new RuntimeException("No folder $folder");
    if( $this->lib->basesOf($marker) )
      throw new RuntimeException("$folder has this link already");

    $base = $this->lib->baseForNew($marker, $source);

    return $this->change("Link *$target* into *" . ($folder !== '' ? AiLibrary::displayName($folder) : 'the root') . '*', $marker, $base,
      [['field' => 'link', 'before' => '', 'after' => $marker]], [],
      fn() => $this->lib->manager->files->createLink($marker, $base),
      ['paths' => [$folder]]
    );
  }

  private function rename( array $args, ?string $source ) : array
  {
    $path    = $this->path($args);
    $newName = trim( AiArgs::string($args, 'newName'));

    if( $newName === '' || strpbrk($newName, '/\\') !== false )
      throw new RuntimeException('newName is a name, not a path - use item_move to move');

    $folder = $this->lib->isFolder($path);
    $ext    = pathinfo($path, PATHINFO_EXTENSION);
    if( ! $folder && pathinfo($newName, PATHINFO_EXTENSION) !== $ext )
      $newName .= ".$ext";

    $parent  = dirname($path);
    $newPath = ($parent !== '.' ? "$parent/" : '') . $newName;

    return $this->relocate('Rename *' . AiLibrary::displayName($path) . '* to *' . AiLibrary::displayName($newPath) . '*',
      $path, $newPath, $folder, $source, 'renaming');
  }

  private function move( array $args, ?string $source ) : array
  {
    $path     = $this->path($args);
    $toFolder = AiLibrary::cleanPath( AiArgs::string($args, 'toFolder', ''));
    $newPath  = ($toFolder !== '' ? "$toFolder/" : '') . basename($path);
    $folder   = $this->lib->isFolder($path);

    if( $folder && ($toFolder === $path || strpos($toFolder, "$path/") === 0) )
      throw new RuntimeException('A folder cannot be moved into itself');

    return $this->relocate('Move *' . AiLibrary::displayName($path) . '* to *' . ($toFolder !== '' ? AiLibrary::displayName($toFolder) : 'the root') . '*',
      $path, $newPath, $folder, $source, null);
  }

  // A rename or move, of a file in its one source or a folder in all sources it is shown from
  private function relocate( string $label, string $path, string $newPath, bool $folder, ?string $source, ?string $byName ) : array
  {
    if( $newPath === $path )
      throw new RuntimeException("$path is there already");

    $bases = $folder ? $this->lib->folderBases($path, $source) : [$this->lib->locateFile($path, $source)];

    foreach( $bases as $base )
      if( file_exists("$base/$newPath") )
        throw new RuntimeException("$newPath exists already in " . $this->lib->label($base));

    // A move keeps the name, so includes still find the snippet; a rename does not
    $warnings = $this->linkWarnings($path);
    if( ! $folder && $byName !== null && pathinfo($path, PATHINFO_FILENAME) !== pathinfo($newPath, PATHINFO_FILENAME) )
      $warnings = array_merge($this->includeWarnings($path, $byName), $warnings);

    // A file's color moves between the .sys of its old and new folder
    $effects = ['files' => [], 'moves' => []];
    foreach( $bases as $base )
    {
      $effects['moves'][] = ["$base/$path", "$base/$newPath"];
      array_push($effects['files'], ColorStore::file( dirname("$base/$path")), ColorStore::file( dirname("$base/$newPath")));
    }
    $effects['files'] = array_values( array_unique($effects['files']));

    return $this->change($label, $path, $bases[0],
      [['field' => 'path', 'before' => $path, 'after' => $newPath]], $warnings,
      fn() => $this->lib->manager->files->rename($path, $newPath, $bases),
      ['bases' => $bases, 'paths' => [$path, $newPath], 'effects' => $effects]
    );
  }

  private function color( array $args, ?string $source ) : array
  {
    $path    = $this->path($args);
    $color   = AiArgs::string($args, 'color', '');
    $colors  = $this->lib->manager->colors;
    $palette = array_keys($colors->getPalette('light'));

    if( $color !== '' && ! in_array($color, $palette, true) )
      throw new RuntimeException("Unknown color $color. The colors are: " . implode(', ', $palette) . " ('' clears)");

    $folder = $this->lib->isFolder($path);
    $bases  = $folder ? $this->lib->folderBases($path, $source) : [$this->lib->locateFile($path, $source)];
    $before = $folder
      ? $colors->getFolderColor("{$bases[0]}/$path")
      : $colors->getFileColor( dirname("{$bases[0]}/$path"), basename($path));
    $value  = $color === '' ? null : $color;

    if( $before === $value )
      throw new RuntimeException("$path has this color already");

    return $this->change(($value ? "Color *" : 'Clear the color of *') . AiLibrary::displayName($path) . '*' . ($value ? " $value" : ''), $path, $bases[0],
      [['field' => 'color', 'before' => (string)$before, 'after' => $color]], [],
      function() use ( $folder, $path, $value, $bases, $colors ) {
        foreach( $bases as $base )
          $folder ? $colors->setFolderColor($path, $value, $base) : $colors->setFileColor($path, $value, $base);
      },
      ['bases' => $bases, 'effects' => ['files' => array_map( fn( $base ) =>
        ColorStore::file($folder ? "$base/$path" : dirname("$base/$path")), $bases)]]
    );
  }

  // --- Helpers ---

  // The common shape of a change. $options:
  //   hash     see the class comment (default null)
  //   bases    every source it writes to, for the shared-source warning (default [$base])
  //   paths    what to refresh (default [$path])
  //   effects  see the class comment (default: the one file $base/$path)
  private function change( string $label, string $path, string $base, array $preview, array $warnings, callable $apply, array $options = [] ) : array
  {
    foreach( $options['bases'] ?? [$base] as $b )
    {
      $others = $this->lib->sharedWith($b);
      if( $others )
        $warnings[] = 'In the source ' . $this->lib->label($b) . ', which the data sets ' . implode(', ', $others) . ' use too';
    }

    return [
      'label'    => $label,
      'path'     => $path,
      'source'   => $this->lib->label($base),
      'preview'  => $preview,
      'warnings' => $warnings,
      'hash'     => $options['hash'] ?? null,
      'paths'    => $options['paths'] ?? [$path],
      'apply'    => $apply,
      'effects'  => ($options['effects'] ?? []) + ['files' => ["$base/$path"], 'moves' => [], 'dirs' => []]
    ];
  }

  private function path( array $args ) : string
  {
    $path = AiLibrary::cleanPath( AiArgs::string($args, 'path'));
    if( $path === '' )
      throw new RuntimeException('Missing argument: path');

    return $path;
  }

  private function requireContent( array $data ) : void
  {
    if( array_key_exists('content', $data) && trim((string)$data['content']) === '' )
      throw new RuntimeException('content must not be empty');
  }

  // Includes find a snippet by name: the snippets that would lose theirs
  private function includeWarnings( string $path, string $doing ) : array
  {
    $by = $this->lib->manager->renderer->includedBy( pathinfo($path, PATHINFO_FILENAME));
    if( ! $by )
      return [];

    return [count($by) . " snippet(s) include it by name, $doing breaks that: " . implode(', ', array_column($by, 'path'))];
  }

  private function linkWarnings( string $path ) : array
  {
    $links = $this->lib->linksTo($path);
    if( ! $links )
      return [];

    return ['INCLUDE links show it elsewhere, they break: ' . implode(', ', array_column($links, 'path'))];
  }

  // A field by its dotted name: content, short, sc, usage, usage.<key>, usage.<key>.<name>.
  // A plain-text usage counts as usage.text, as in the usage form.
  private function get( array $data, string $field )
  {
    $parts = explode('.', $field, 3);
    $value = $data[$parts[0]] ?? null;

    if( $parts[0] === 'usage' && count($parts) > 1 && is_string($value) )
      $value = ['text' => $value];

    foreach( array_slice($parts, 1) as $part )
      $value = is_array($value) ? ($value[$part] ?? null) : null;

    return $value;
  }

  // Sets a field by its dotted name (null removes it) and returns the field the preview
  // shows for it: a single usage.vars / usage.maybe entry shows as its whole list
  private function setField( array &$data, string $field, $value ) : string
  {
    $parts   = explode('.', $field, 3);
    $isMd    = ($data['_type'] ?? '') === 'md';
    $allowed = $isMd ? ['content'] : array_merge(self::TEXT_FIELDS, ['usage']);

    if( in_array($parts[0], ['id', 'version'], true) )
      throw new RuntimeException('id and version are never changed (id names the prompt, version is the file format)');
    if( ! in_array($parts[0], $allowed, true) || (count($parts) > 1 && $parts[0] !== 'usage') )
      throw new RuntimeException("Unknown field $field. Fields: " . ($isMd ? 'content' : 'content, short, sc, usage, usage.<key>, usage.vars.<name>, usage.maybe.<name>'));
    if( $value !== null && ! is_scalar($value) && ! is_array($value) )
      throw new RuntimeException("$field: unsupported value");
    if( is_array($value) && $parts[0] !== 'usage' )
      throw new RuntimeException("$field is text");
    if( is_scalar($value) )
      $value = (string)$value;

    if( count($parts) === 1 )
    {
      if( $value === null && $parts[0] === 'content' )
        throw new RuntimeException('content must not be empty');

      if( $value === null )
        unset($data[$field]);
      else
        $data[$field] = $value;

      return $field;
    }

    // Inside usage: a plain-text usage becomes its text first
    if( is_string($data['usage'] ?? null) )
      $data['usage'] = trim($data['usage']) === '' ? [] : ['text' => $data['usage']];
    if( ! is_array($data['usage'] ?? null) )
      $data['usage'] = [];

    [, $key] = $parts;

    if( count($parts) === 2 )
    {
      if( $value === null )
        unset($data['usage'][$key]);
      else
        $data['usage'][$key] = $value;
    }
    else
    {
      if( ! is_array($data['usage'][$key] ?? null) )
        $data['usage'][$key] = [];

      if( $value === null )
        unset($data['usage'][$key][$parts[2]]);
      else
        $data['usage'][$key][$parts[2]] = $value;
    }

    return "usage.$key";
  }

  private function diff( array $before, array $after, array $fields ) : array
  {
    $preview = [];

    foreach( $fields as $field )
    {
      $old = $this->text( $this->get($before, $field));
      $new = $this->text( $this->get($after, $field));

      if( $old !== $new )
        $preview[] = ['field' => $field, 'before' => $old, 'after' => $new];
    }

    if( ! $preview && $before )
      throw new RuntimeException('Nothing would change');

    return $preview;
  }

  private function text( $value ) : string
  {
    if( is_array($value) )
      return $value === [] ? '' : rtrim( Yaml::dump($value, 4, 2, Yaml::DUMP_MULTI_LINE_LITERAL_BLOCK));

    return (string)$value;
  }
}
