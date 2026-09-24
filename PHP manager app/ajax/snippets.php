<?php

// Snippet files, search, rendering

/** @var SnippetManager\SnippetManager $manager */

return [

  'loadSnippet' => function( array $in ) use ( $manager ) : array {
    $snippet = $manager->snippets->load( (string)($in['path'] ?? ''), $in['basePath'] ?? null);

    return $snippet
      ? ['success' => true, 'snippet' => $snippet]
      : ['success' => false, 'message' => 'Snippet missing'];
  },

  // Returns the snippet as stored, so the client's copy keeps its parsed `usage`.
  // createOnly is set by "New Snippet": a name that is taken must never be written over.
  'saveSnippet' => fn( array $in ) => [
    'success' => true,
    'message' => 'Snippet saved successfully',
    'snippet' => $manager->snippets->save(
      (string)($in['path'] ?? ''),
      is_array($in['data'] ?? null) ? $in['data'] : [],
      $in['targetBasePath'] ?? null,
      (bool)($in['createOnly'] ?? false)
    )
  ],

  'deleteSnippet' => function( array $in ) use ( $manager ) : array {
    $manager->snippets->delete( (string)($in['path'] ?? ''), $in['basePath'] ?? null);
    return ['success' => true, 'message' => 'Snippet deleted successfully'];
  },

  'duplicateSnippet' => function( array $in ) use ( $manager ) : array {
    $manager->snippets->duplicate( (string)($in['sourcePath'] ?? ''), (string)($in['targetPath'] ?? ''), $in['basePath'] ?? null);
    return ['success' => true, 'message' => 'Snippet duplicated successfully'];
  },

  'searchSnippets' => fn( array $in ) => [
    'success' => true,
    'results' => $manager->search->search( (string)($in['query'] ?? ''))
  ],

  'composeContent' => fn( array $in ) => [
    'success'  => true,
    'composed' => $manager->renderer->compose( is_array($in['snippet'] ?? null) ? $in['snippet'] : [])
  ],

  'renderSnippet' => fn( array $in ) => [
    'success'  => true,
    'rendered' => $manager->renderer->render(
      is_array($in['snippet'] ?? null) ? $in['snippet'] : [],
      is_array($in['placeholders'] ?? null) ? $in['placeholders'] : []
    )
  ],

  'extractPlaceholders' => fn( array $in ) => [
    'success'      => true,
    'placeholders' => $manager->renderer->extractPlaceholders( (string)($in['content'] ?? ''))
  ]
];
