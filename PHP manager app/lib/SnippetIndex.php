<?php

namespace SnippetManager;

// All snippets of all data sets, for the Win app ("Win app/dev/win_app_plan.md"): typed
// shortcuts and the picker work across data sets, whichever one the manager has selected.
//
// A snippet is one entry, also when several data sets share its source folder (e.g. Common) or
// several tree positions show it (links). Unless it composes differently in them: an include
// is resolved by name in each data set, so it can stand for another snippet there.
//
// Entry: ['dataSets', 'path', 'basePath', 'name', 'folder', 'sc', 'short', 'form', 'text']
//   dataSets   labels of the data sets it is the same in; the first is the one to load it in
//   path       relative path for loadSnippet, with basePath (null for a link: last source wins)
//   folder     where it is in the tree, '' at the top
//   form       has placeholders or MAYBE blocks: the Win app shows the fill view
//   text       the text to insert when there is no form (as the manager copies it), else null
class SnippetIndex
{
  private Sources $sources;
  private FileTree $tree;
  private SnippetStore $snippets;
  private Renderer $renderer;

  public function __construct( Sources $sources, FileTree $tree, SnippetStore $snippets, Renderer $renderer )
  {
    $this->sources  = $sources;
    $this->tree     = $tree;
    $this->snippets = $snippets;
    $this->renderer = $renderer;
  }

  public function all() : array
  {
    $selected = $this->sources->getCurrentLabel();
    $entries  = [];   // md5 of file and composed content => entry

    foreach( array_keys($this->sources->getDataSets()) as $label )
    {
      $this->sources->select($label, false);

      $this->tree->walk( function( array $item, string $fsPath ) use ( $label, &$entries ) {

        if( $item['type'] !== 'file' )
          return;

        // A link's basePath is the source holding the marker, not the target (see Search)
        $base    = empty($item['isIncluded']) ? $item['basePath'] : null;
        $snippet = $this->snippets->load($fsPath, $base);
        if( $snippet === null )
          return;

        $file     = $base !== null ? "$base/$fsPath" : $this->sources->resolvePhysicalPath($fsPath);
        $composed = $this->renderer->compose($snippet);
        $key      = md5("$file\0$composed");

        if( isset($entries[$key]) )
        {
          if( ! in_array($label, $entries[$key]['dataSets'], true) )
            $entries[$key]['dataSets'][] = $label;
          return;
        }

        // Markdown snippets are inserted as they are, like the manager shows them
        $isMd = $snippet['_type'] === 'md';
        $form = ! $isMd && ($this->renderer->extractPlaceholders($composed) || strpos($composed, '<<<MAYBE:START:') !== false);
        $text = null;
        if( ! $form )
          $text = $isMd ? (string)$snippet['content'] : $this->renderer->unwrap( $this->renderer->render($snippet));

        $folder = dirname($item['path']);

        $entries[$key] = [
          'dataSets' => [$label],
          'path'     => $fsPath,
          'basePath' => $base,
          'name'     => $item['name'],
          'folder'   => $folder === '.' ? '' : $folder,
          'sc'       => trim((string)($snippet['sc'] ?? '')),
          'short'    => trim((string)($snippet['short'] ?? '')),
          'form'     => $form,
          'text'     => $text
        ];
      });
    }

    $this->sources->select($selected, false);

    return array_values($entries);
  }

  // Changes when a file in a source folder of any data set changes, or the data sets do. The
  // Win app polls with the stamp it has and only gets the snippets again when it changed.
  public function stamp() : string
  {
    $dataSets = $this->sources->getDataSets();
    $parts    = [ json_encode($dataSets) ];
    $folders  = array_unique( array_merge( ...array_map( fn( $set ) => array_column($set, 'path'), array_values($dataSets))));

    foreach( $folders as $folder )
      $this->stampFolder($folder, $parts);

    return md5( implode("\n", $parts));
  }

  private function stampFolder( string $dir, array &$parts ) : void
  {
    if( ! is_dir($dir) )
      return;

    foreach( scandir($dir) as $file )
    {
      if( $file === '.' || $file === '..' )
        continue;

      $path = "$dir/$file";
      if( is_dir($path) )
        $this->stampFolder($path, $parts);
      else
        $parts[] = $path . "\0" . filemtime($path) . "\0" . filesize($path);
    }
  }
}
