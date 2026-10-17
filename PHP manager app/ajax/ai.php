<?php

// AI sidebar: chat turns, applying accepted proposals, chat sessions (dev/ai_sidebar_plan.md)

use SnippetManager\Ai\AiChanges;
use SnippetManager\Ai\AiChat;
use SnippetManager\Ai\AiClaude;
use SnippetManager\Ai\AiClient;
use SnippetManager\Ai\AiLibrary;
use SnippetManager\Ai\AiPrompt;
use SnippetManager\Ai\AiSessions;
use SnippetManager\Ai\AiTools;
use SnippetManager\Ai\AiUndo;

/** @var SnippetManager\SnippetManager $manager */
/** @var SnippetManager\UserStore $user */
/** @var array $appConfig */
/** @var string $userDir */

$aiConfig = $appConfig['ai'] ?? [];
$sessions = fn() => new AiSessions("$userDir/ai_sessions");
$undo     = fn() => new AiUndo("$userDir/ai_undo");

return [

  // One turn: {messages: [{role, content}, ...], provider?, mode?, open?: {path, basePath}}
  // -> {reply, proposals, clientCalls}. The tools only propose, nothing is written here
  // (mode apply: the sidebar accepts the proposals itself, the model is told so).
  // Claude Code runs the tool loop itself (AiClaude), the API providers here (AiChat).
  'aiChat' => function( array $in ) use ( $manager, $user, $aiConfig, $userDir ) : array {

    // A turn runs as long as the model and its tool rounds take; cut off half way it
    // would lose its whole result
    @set_time_limit(0);

    $history = array_values( array_filter( is_array($in['messages'] ?? null) ? $in['messages'] : [], fn( $msg ) =>
      is_array($msg) && in_array($msg['role'] ?? '', ['user', 'assistant'], true) && is_string($msg['content'] ?? null)
    ));
    $history = array_map( fn( $msg ) => ['role' => $msg['role'], 'content' => $msg['content']], $history);

    if( ! $history || end($history)['role'] !== 'user' )
      throw new RuntimeException('Nothing to answer');

    $choices  = AiClient::choices($aiConfig);
    $provider = isset($choices[$in['provider'] ?? '']) ? $in['provider'] : array_key_first($choices);

    $open = [];
    if( is_array($in['open'] ?? null) && ($in['open']['path'] ?? '') !== '' )
      $open = [
        'path'   => (string)$in['open']['path'],
        'source' => (new AiLibrary($manager))->label( (string)($in['open']['basePath'] ?? ''))
      ];

    $mode      = ($in['mode'] ?? '') === 'apply' ? 'apply' : 'ask';
    $webSearch = ! empty($aiConfig['webSearch']) && ($provider === AiClaude::PROVIDER || AiClient::canSearch($provider));
    $system    = AiPrompt::build($manager, $aiConfig, $open, $mode, $webSearch);

    if( $provider === AiClaude::PROVIDER )
      return ['success' => true] + (new AiClaude($aiConfig['claudeCode'] ?? []))->run($system, AiClaude::prompt($history), [
        'userDir' => $userDir,
        'dataSet' => $manager->sources->getCurrentLabel()
      ], $webSearch);

    $client = new AiClient($aiConfig, $provider, AiClient::loadEnv(__DIR__ . '/../.env'));
    $chat   = new AiChat([$client, 'chat'], new AiTools($manager, $user), (int)($aiConfig['maxSteps'] ?? 15));
    return ['success' => true] + $chat->run($system, $history);
  },

  // An accepted proposal, as aiChat returned it, recorded under the checkpoint of its answer
  // {proposal, checkpoint} -> {paths} to refresh
  'aiApply' => fn( array $in ) => [
    'success' => true,
    'paths'   => (new AiChanges( new AiLibrary($manager)))->apply(
      is_array($in['proposal'] ?? null) ? $in['proposal'] : [], $undo(), (string)($in['checkpoint'] ?? '')
    )
  ],

  // Takes back the accepted changes of an answer: {checkpoint} -> {restored, skipped: ["Source: path"]}
  'aiUndo' => function( array $in ) use ( $manager, $undo ) : array {
    $result = $undo()->undo( (string)($in['checkpoint'] ?? ''));
    $lib    = new AiLibrary($manager);

    // Absolute paths stay on the server: a skipped one is named by its source and path
    $named = array_map( function( $path ) use ( $lib, $manager ) {
      foreach( $manager->sources->getPaths() as $base )
        if( strpos($path, "$base/") === 0 )
          return $lib->label($base) . ': ' . substr($path, strlen($base) + 1);
      return basename($path);
    }, $result['skipped']);

    return ['success' => true, 'restored' => $result['restored'], 'skipped' => $named];
  },

  'aiSessions' => fn() => ['success' => true, 'sessions' => $sessions()->list( $manager->sources->getCurrentLabel())],

  'aiSessionLoad' => fn( array $in ) => ['success' => true, 'session' => $sessions()->load( (string)($in['id'] ?? ''))],

  // A session belongs to the data set it is held in
  'aiSessionSave' => fn( array $in ) => [
    'success' => true,
    'session' => $sessions()->save( array_merge( is_array($in['session'] ?? null) ? $in['session'] : [], ['dataSet' => $manager->sources->getCurrentLabel()]))
  ],

  'aiSessionDelete' => function( array $in ) use ( $sessions ) : array {
    $sessions()->delete( (string)($in['id'] ?? ''));
    return ['success' => true];
  }
];
