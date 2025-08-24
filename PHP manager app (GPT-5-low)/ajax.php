<?php
require __DIR__ . '/vendor/autoload.php';

header('Content-Type: application/json');

// Simple router that forwards to one-file-per-call under /ajax
try {
  $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
  $input = file_get_contents('php://input');
  $json = json_decode($input ?: '[]', true);
  if( ! is_array($json) ) $json = [];

  $action = $_GET['action'] ?? ($json['action'] ?? '');
  if( $action === '' ) throw new Exception('Missing action');

  $file = __DIR__ . '/ajax/' . preg_replace('/[^a-zA-Z0-9_\-]/', '', $action) . '.php';
  if( ! file_exists($file) ) throw new Exception('Unknown action');

  $ctx = [ 'input' => $json, 'get' => $_GET, 'post' => $_POST ];
  $result = (function($file, $ctx) {
    return require $file;
  })($file, $ctx);

  if( $result === null ) $result = [ 'ok' => true ];
  echo json_encode($result);
}
catch( Throwable $e ) {
  http_response_code(400);
  echo json_encode([ 'ok' => false, 'error' => $e->getMessage() ]);
}
