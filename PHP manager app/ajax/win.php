<?php

// The Win app ("Win app/dev/win_app_plan.md")

/** @var SnippetManager\SnippetManager $manager */

return [

  // All snippets of all data sets (SnippetIndex). With the stamp of the last answer only
  // 'unchanged' while nothing changed, so the Win app can poll cheaply.
  'winSnippets' => function( array $in ) use ( $manager ) : array {
    $stamp = $manager->index->stamp();
    if( ($in['stamp'] ?? null) === $stamp )
      return ['success' => true, 'unchanged' => true];

    return [
      'success'  => true,
      'stamp'    => $stamp,
      'dataSets' => array_keys( $manager->sources->getDataSets()),
      'snippets' => $manager->index->all()
    ];
  }
];
