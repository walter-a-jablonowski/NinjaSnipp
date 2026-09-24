<?php

// Data set selection and per-user data: settings, search history, recent snippets

/** @var SnippetManager\SnippetManager $manager */
/** @var SnippetManager\UserStore $user */

return [

  'setDataPath' => fn( array $in ) => $manager->sources->select( (string)($in['dataPath'] ?? ''))
    ? ['success' => true, 'message' => 'Data path changed successfully']
    : ['success' => false, 'message' => 'Invalid data path'],

  'getFolderColors' => fn( array $in ) => [
    'success' => true,
    'colors'  => $manager->colors->getPalette( (string)($in['themeMode'] ?? 'light'))
  ],

  'getUserSettings' => fn() => ['success' => true, 'settings' => $user->getSettings()],

  'setUserSettings' => fn( array $in ) => [
    'success'  => true,
    'settings' => $user->updateSettings( is_array($in['settings'] ?? null) ? $in['settings'] : [])
  ],

  'getSearchHistory' => fn() => ['success' => true, 'data' => $user->getSearchHistory()],

  'saveSearchHistory' => function( array $in ) use ( $user ) : array {
    $user->saveSearchHistory( is_array($in['data'] ?? null) ? $in['data'] : []);
    return ['success' => true];
  },

  'getRecentSnippets' => fn() => [
    'success' => true,
    'data'    => $user->getRecentSnippets( $manager->sources->getCurrentLabel())
  ],

  'saveRecentSnippets' => function( array $in ) use ( $manager, $user ) : array {
    $user->saveRecentSnippets( $manager->sources->getCurrentLabel(), is_array($in['data'] ?? null) ? $in['data'] : []);
    return ['success' => true];
  }
];
