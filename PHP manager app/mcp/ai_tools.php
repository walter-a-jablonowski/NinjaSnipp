<?php

// The AI tools as an MCP server over stdio, started by the Claude Code CLI for one request
// (lib/Ai/AiClaude.php); the protocol and the tools are in lib/Ai/AiMcpServer.php.
//
// Nothing but protocol lines may reach stdout: a PHP notice printed there breaks the stream
// and the CLI drops the server. So errors go to a log beside the request folders.

use SnippetManager\Ai\AiClaude;
use SnippetManager\Ai\AiMcpServer;

ini_set('display_errors', '0');
ini_set('log_errors', '1');

require_once __DIR__ . '/../vendor/autoload.php';

ini_set('error_log', AiClaude::turnsDir() . '/mcp_errors.log');

$server = new AiMcpServer( (string)getenv('NINJA_TURN_DIR'));
$stdin  = fopen('php://stdin', 'r');

while( ($line = fgets($stdin)) !== false )
{
  $msg = json_decode( trim($line), true);
  if( ! is_array($msg) )
    continue;

  $answer = $server->handle($msg);
  if( $answer !== null )
  {
    echo json_encode($answer, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), "\n";
    flush();
  }
}
