<?php

// Routes ajax calls: {"action": "...", "dataPath": "<data set label>", ...} -> JSON
//
// The handlers live in /ajax, one file per area, each returning action => handler.
// A handler gets the request data and returns the response array. It reports a failure
// by throwing RuntimeException with a user-facing message.

use SnippetManager\SnippetManager;
use SnippetManager\UserStore;

require_once 'vendor/autoload.php';
require_once 'lib/functions.php';


header('Content-Type: application/json');

$input  = json_decode( file_get_contents('php://input'), true) ?: [];
$action = (string)($input['action'] ?? '');

// Everything inside the try: a broken settings.yml would otherwise throw before the handler
// is in place and the client would get an HTML error page instead of the JSON it parses
try {

  $appConfig = app_config();
  $user      = new UserStore( APP_ROOT . '/' . user_dir());
  $settings  = $user->getSettings();
  $manager   = new SnippetManager( $settings, __DIR__);

  // The data set the client works in; the first one if missing or unknown
  if( ! empty($input['dataPath']) )
    $manager->sources->select( (string)$input['dataPath']);

  $handlers = array_merge(
    require 'ajax/files.php',
    require 'ajax/snippets.php',
    require 'ajax/user.php'
  );

  $response = isset($handlers[$action])
    ? $handlers[$action]($input)
    : ['success' => false, 'message' => "Unknown action: $action"];
}
catch( RuntimeException $e ) {
  $response = ['success' => false, 'message' => $e->getMessage()];
}
catch( Throwable $e ) {
  // Throwable, not Exception: a TypeError/Error would otherwise escape as a fatal
  $response = ['success' => false, 'message' => 'Server error: ' . $e->getMessage()];
}

echo json_encode($response);
