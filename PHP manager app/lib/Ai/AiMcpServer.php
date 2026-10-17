<?php

namespace SnippetManager\Ai;

use SnippetManager\SnippetManager;
use SnippetManager\UserStore;
use stdClass;

// The AI tools as an MCP server, for Claude Code (AiClaude). mcp/ai_tools.php runs it over
// stdio: newline-delimited JSON-RPC 2.0, one message in, at most one answer out. Only
// initialize, the initialized notification, tools/list, tools/call and ping arrive, so there
// is no framework, just handle().
//
// One server per request, started by the CLI. The request's folder (NINJA_TURN_DIR) holds
// context.json - the user folder and the data set - and gets calls.ndjson back. Every call
// goes through AiTools::call(), as in the API tool loop: a read tool is answered, a write
// call becomes a proposal and a client call is passed on - both recorded, one JSON line
// each, for AiClaude to hand to the sidebar. Nothing is written to the library here.
//
// A call that fails comes back as a tool result with isError, not as a JSON-RPC error:
// the model reads it and corrects the call.
class AiMcpServer
{
  public const NAME = 'ninja';                    // the server's name in --mcp-config

  // A tool result over 50,000 characters goes to a file the model cannot open, whatever
  // MAX_MCP_OUTPUT_TOKENS says; tree_list and snippet_check of a big data set pass that
  private const MAX_RESULT_CHARS = 400000;

  private string $turnDir;
  private ?AiTools $tools = null;

  public function __construct( string $turnDir )
  {
    $this->turnDir = $turnDir;
  }

  // The tools as MCP lists them, from the one registry
  public static function tools() : array
  {
    return array_map( fn( $def ) => [
      'name'        => $def['name'],
      'description' => $def['description'],
      'inputSchema' => $def['parameters']
    ] + (AiTools::kind($def['name']) === 'read' ? ['_meta' => ['anthropic/maxResultSizeChars' => self::MAX_RESULT_CHARS]] : []),
    AiTools::defs());
  }

  // The answer to one JSON-RPC message, null for a notification
  public function handle( array $msg ) : ?array
  {
    $id     = $msg['id'] ?? null;
    $method = (string)($msg['method'] ?? '');
    $params = is_array($msg['params'] ?? null) ? $msg['params'] : [];

    if( $id === null )
      return null;

    $answer = ['jsonrpc' => '2.0', 'id' => $id];

    switch( $method )
    {
      // Answered in the version the client asked for: it picked one we speak
      case 'initialize':
        return $answer + ['result' => [
          'protocolVersion' => (string)($params['protocolVersion'] ?? '2024-11-05'),
          'capabilities'    => ['tools' => new stdClass()],
          'serverInfo'      => ['name' => 'ninjasnipp', 'version' => '1.0']
        ]];

      case 'tools/list':
        return $answer + ['result' => ['tools' => self::tools()]];

      case 'tools/call':
        return $answer + ['result' => $this->call( (string)($params['name'] ?? ''), is_array($params['arguments'] ?? null) ? $params['arguments'] : [])];

      case 'ping':
        return $answer + ['result' => new stdClass()];
    }

    return $answer + ['error' => ['code' => -32601, 'message' => "Method not found: $method"]];
  }

  private function call( string $name, array $args ) : array
  {
    try {
      $out = $this->requestTools()->call('cc_' . bin2hex(random_bytes(6)), $name, $args);

      foreach( ['proposal', 'client'] as $kind )
        if( isset($out[$kind]) )
          $this->record($kind, $out[$kind]);
    }
    catch( \Throwable $e ) {
      error_log("AiMcpServer $name: {$e->getMessage()}");
      $out = ['result' => ['error' => $e->getMessage()]];
    }

    return [
      'content' => [['type' => 'text', 'text' => json_encode($out['result'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]],
      'isError' => isset($out['result']['error'])
    ];
  }

  private function record( string $kind, array $data ) : void
  {
    $line = json_encode(['kind' => $kind, 'data' => $data], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";

    if( file_put_contents("{$this->turnDir}/calls.ndjson", $line, FILE_APPEND | LOCK_EX) === false )
      throw new \RuntimeException('Could not record the call');
  }

  // The tools over the request's user and data set (context.json)
  private function requestTools() : AiTools
  {
    if( $this->tools === null )
    {
      $context = json_decode( (string)@file_get_contents("{$this->turnDir}/context.json"), true);
      $userDir = (string)($context['userDir'] ?? '');

      if( $userDir === '' || ! is_dir($userDir) )
        throw new \RuntimeException('The request named no user folder');

      $user    = new UserStore($userDir);
      $manager = new SnippetManager($user->getSettings(), dirname(__DIR__, 2));
      $manager->sources->select( (string)($context['dataSet'] ?? ''));

      $this->tools = new AiTools($manager, $user);
    }

    return $this->tools;
  }
}
