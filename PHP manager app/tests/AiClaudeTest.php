<?php

namespace SnippetManager\Tests;

use SnippetManager\Ai\AiClaude;
use SnippetManager\Ai\AiMcpServer;
use SnippetManager\Ai\AiTools;
use Symfony\Component\Yaml\Yaml;

// Claude Code as provider: the MCP server (in process and over stdio) and the parsing of the
// CLI's output. None of the tests starts the CLI.
class AiClaudeTest extends TestCase
{
  private string $turnDir;

  protected function setUp() : void
  {
    parent::setUp();

    // A user whose data set "Test" has the two sources of TestCase, and a request folder
    $this->write('user/settings.yml', Yaml::dump(['dataPaths' => ['Test' => ['A' => $this->a, 'B' => $this->b]], 'nav' => ['foldersMerged' => true]]));
    $this->turnDir = "{$this->root}/turn";
    mkdir($this->turnDir);
    file_put_contents("{$this->turnDir}/context.json", json_encode(['userDir' => "{$this->root}/user", 'dataSet' => 'Test']));
  }

  private function rpc( AiMcpServer $server, string $method, array $params = [], int $id = 1 ) : ?array
  {
    return $server->handle(['jsonrpc' => '2.0', 'id' => $id, 'method' => $method, 'params' => $params]);
  }

  private function recorded() : array
  {
    $file = "{$this->turnDir}/calls.ndjson";
    return is_file($file) ? array_map( fn( $l ) => json_decode($l, true), file($file, FILE_IGNORE_NEW_LINES)) : [];
  }

  public function testInitializeAndList() : void
  {
    $server = new AiMcpServer($this->turnDir);

    $init = $this->rpc($server, 'initialize', ['protocolVersion' => '2025-06-18']);
    $this->assertSame('2025-06-18', $init['result']['protocolVersion']);
    $this->assertNull( $server->handle(['jsonrpc' => '2.0', 'method' => 'notifications/initialized']));

    $tools = $this->rpc($server, 'tools/list')['result']['tools'];
    $this->assertSame( array_column(AiTools::defs(), 'name'), array_column($tools, 'name'));

    $byName = array_column($tools, null, 'name');
    $this->assertArrayHasKey('_meta', $byName['tree_list']);            // read tools may return large results
    $this->assertArrayNotHasKey('_meta', $byName['snippet_edit']);
    $this->assertSame(-32601, $this->rpc($server, 'nope')['error']['code']);
  }

  public function testCallsRunThroughTheToolsAndAreRecorded() : void
  {
    $this->write('a/x.yml', 'content: old');
    $server = new AiMcpServer($this->turnDir);

    $read = $this->rpc($server, 'tools/call', ['name' => 'snippet_get', 'arguments' => ['paths' => ['x.yml']]]);
    $this->assertFalse($read['result']['isError']);
    $this->assertSame('old', json_decode($read['result']['content'][0]['text'], true)['snippets'][0]['fields']['content']);

    $write = $this->rpc($server, 'tools/call', ['name' => 'snippet_update', 'arguments' => ['path' => 'x.yml', 'fields' => ['content' => 'new']]]);
    $this->assertSame('proposed_pending_user_approval', json_decode($write['result']['content'][0]['text'], true)['status']);
    $this->rpc($server, 'tools/call', ['name' => 'snippet_open', 'arguments' => ['path' => 'x.yml']]);

    [$proposal, $client] = $this->recorded();
    $this->assertSame('proposal', $proposal['kind']);
    $this->assertSame('Update *x*: content', $proposal['data']['label']);
    $this->assertStringStartsWith('cc_', $proposal['data']['id']);
    $this->assertSame(['kind' => 'client', 'data' => ['tool' => 'snippet_open', 'path' => 'x.yml', 'source' => 'A', 'basePath' => $this->a]], $client);
    $this->assertSame('content: old', $this->read('a/x.yml'));                // nothing written

    $bad = $this->rpc($server, 'tools/call', ['name' => 'snippet_get', 'arguments' => []]);
    $this->assertTrue($bad['result']['isError']);
  }

  public function testServerOverStdio() : void
  {
    $this->write('a/x.yml', "short: Over stdio\ncontent: x\n");

    $lines = implode("\n", array_map('json_encode', [
      ['jsonrpc' => '2.0', 'id' => 1, 'method' => 'initialize', 'params' => ['protocolVersion' => '2024-11-05']],
      ['jsonrpc' => '2.0', 'method' => 'notifications/initialized'],
      ['jsonrpc' => '2.0', 'id' => 2, 'method' => 'tools/call', 'params' => ['name' => 'snippet_search', 'arguments' => ['query' => 'stdio']]]
    ])) . "\n";

    $proc = proc_open([PHP_BINARY, __DIR__ . '/../mcp/ai_tools.php'], [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, ['NINJA_TURN_DIR' => $this->turnDir] + getenv());
    fwrite($pipes[0], $lines);
    fclose($pipes[0]);
    $out = stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    proc_close($proc);

    $answers = array_map( fn( $l ) => json_decode($l, true), array_filter( explode("\n", $out)));
    $this->assertCount(2, $answers, "Only protocol lines on stdout: $out");
    $this->assertSame('ninjasnipp', $answers[0]['result']['serverInfo']['name']);
    $this->assertSame('x.yml', json_decode($answers[1]['result']['content'][0]['text'], true)['hits'][0]['path']);
  }

  public function testParse() : void
  {
    $events = [
      ['type' => 'system', 'subtype' => 'init', 'mcp_servers' => [['name' => 'ninja', 'status' => 'connected']]],
      ['type' => 'assistant', 'message' => ['content' => [['type' => 'text', 'text' => 'Let me look.'], ['type' => 'tool_use', 'name' => 'mcp__ninja__snippet_get']]]],
      ['type' => 'assistant', 'message' => ['content' => [['type' => 'text', 'text' => 'I propose a fix.'], ['type' => 'tool_use', 'name' => 'mcp__ninja__snippet_edit']]]],
      ['type' => 'assistant', 'message' => ['content' => [['type' => 'text', 'text' => 'Review it in the sidebar.']]]],
      ['type' => 'result', 'result' => 'Review it in the sidebar.']
    ];
    $stdout = implode("\n", array_map('json_encode', $events)) . "\nnot json\n";

    // The thinking aloud before a read is dropped, the text around a proposal is kept
    $this->assertSame(['ready' => true, 'reply' => "I propose a fix.\n\nReview it in the sidebar.", 'error' => null], AiClaude::parse($stdout));

    $failed = AiClaude::parse( json_encode(['type' => 'system', 'subtype' => 'init', 'mcp_servers' => [['name' => 'ninja', 'status' => 'failed']]])
      . "\n" . json_encode(['type' => 'result', 'is_error' => true, 'subtype' => 'error_max_turns']));
    $this->assertSame(['ready' => false, 'reply' => '', 'error' => 'error_max_turns'], $failed);
  }

  public function testPrompt() : void
  {
    $this->assertSame('Hi', AiClaude::prompt([['role' => 'user', 'content' => 'Hi']]));
    $this->assertSame(
      "The conversation so far (you are the assistant):\n\n<user>\nHi\n</user>\n\n<assistant>\nHello\n</assistant>\n\nThe user's new message:\n\n<user>\nNext\n</user>",
      AiClaude::prompt([['role' => 'user', 'content' => 'Hi'], ['role' => 'assistant', 'content' => 'Hello'], ['role' => 'user', 'content' => ' Next ']])
    );
  }

  public function testOfferedOnlyWhereTheCliIs() : void
  {
    $this->assertFalse( AiClaude::available(['enabled' => false]));
    $this->assertFalse( AiClaude::available(['enabled' => true, 'bin' => "{$this->root}/missing.exe"]));
    $this->assertTrue( AiClaude::available(['enabled' => true, 'bin' => $this->write('claude.exe')]));
  }
}
