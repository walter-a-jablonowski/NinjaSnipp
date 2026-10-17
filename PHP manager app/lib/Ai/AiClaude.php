<?php

namespace SnippetManager\Ai;

use RuntimeException;

// The local Claude Code CLI as an AI provider: the user's own subscription instead of an API
// key (config.yml ai.claudeCode). Offered only where the CLI is installed (available()).
//
// The CLI is an agent, not a chat endpoint: it runs the tool loop itself, so there is no
// AiChat here. "claude -p" talks to the app's MCP server (mcp/ai_tools.php, AiMcpServer),
// which runs every call through AiTools::call() and records the proposals and client calls.
// What comes back is the same as from AiChat - reply, proposals, client calls - so a change
// still waits in the sidebar for the user's accept.
//
// Each request is a new CLI run (--no-session-persistence): the conversation goes in as text
// (prompt()), so nothing lives on the CLI side. Flags, as HalfDoneHero and grid-view verified
// them on CLI 2.1:
//
// - --output-format stream-json needs --verbose; it gives the init event that says whether
//   our MCP server connected, and the tool calls in order
// - --setting-sources "" keeps the machine's own CLAUDE.md, memory and settings out
// - --tools "" switches the built-in Read / Edit / Bash / ... off; --allowedTools lists ours,
//   so none of them asks for permission; --strict-mcp-config: only our server
// - the prompt goes in over stdin and the system prompt as a file: a Windows command line
//   ends at 32k characters
class AiClaude
{
  public const PROVIDER = 'claudeCode';
  private const PREFIX  = 'mcp__' . AiMcpServer::NAME . '__';   // how the CLI names our tools

  private array $config;

  // $config: config.yml ai.claudeCode - enabled, default, model, bin, phpBin, timeout
  public function __construct( array $config )
  {
    $this->config = $config;
  }

  // Switched on in config.yml and the CLI found on this machine
  public static function available( array $config ) : bool
  {
    return ! empty($config['enabled']) && (new self($config))->bin() !== null;
  }

  // The folder of the request folders (cache/, not committed)
  public static function turnsDir() : string
  {
    $dir = dirname(__DIR__, 2) . '/cache/ai_turns';
    if( ! is_dir($dir) )
      @mkdir($dir, 0755, true);

    return $dir;
  }

  // The conversation as one prompt, the new message last: the CLI starts fresh every request
  // $messages: [['role' => 'user' | 'assistant', 'content'], ...], the last one the user's
  public static function prompt( array $messages ) : string
  {
    $last    = trim( (string)(array_pop($messages)['content'] ?? ''));
    $earlier = array_map( fn( $msg ) => "<{$msg['role']}>\n" . trim( (string)$msg['content']) . "\n</{$msg['role']}>", $messages);

    if( ! $earlier )
      return $last;

    return "The conversation so far (you are the assistant):\n\n" . implode("\n\n", $earlier)
         . "\n\nThe user's new message:\n\n<user>\n$last\n</user>";
  }

  // One request, until the CLI has answered: ['reply', 'proposals', 'clientCalls'] as AiChat::run()
  // $context: what the tool server needs - userDir, dataSet. $webSearch: the CLI's own
  // WebSearch / WebFetch, on the subscription
  public function run( string $system, string $prompt, array $context, bool $webSearch = false ) : array
  {
    $dir = self::turnsDir() . '/' . uniqid('turn_', true);
    if( ! @mkdir($dir, 0755, true) )
      throw new RuntimeException('Could not create the folder of this request');

    try {

      file_put_contents("$dir/context.json", json_encode($context, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
      file_put_contents("$dir/system.md", $system);

      $out  = $this->exec( $this->command($dir, $webSearch), $prompt, $dir);
      $turn = self::parse($out['stdout']);

      // Without its tools the CLI does not fail, it answers from a library it makes up
      // (grid-view saw a whole invented board): a run without them is an error
      if( ! $turn['ready'] )
        throw new RuntimeException('The snippet tools did not load, so the answer would not come from your snippets. '
          . 'The tool server starts as: ' . implode(' ', $this->serverCommand()) . ($out['stderr'] !== '' ? ' - ' . trim($out['stderr']) : ''));

      if( $turn['error'] !== null )
        throw new RuntimeException("Claude Code: {$turn['error']}");

      $calls = self::recorded("$dir/calls.ndjson");
      if( $turn['reply'] === '' && ! $calls['proposal'] && ! $calls['client'] )
        throw new RuntimeException($out['stderr'] !== '' ? trim($out['stderr']) : "Claude Code returned nothing (exit {$out['code']})");

      return ['reply' => $turn['reply'], 'proposals' => $calls['proposal'], 'clientCalls' => $calls['client']];
    }
    finally {
      self::removeDir($dir);
    }
  }

  // What a run printed (stream-json, one event per line): whether our server connected, the
  // reply, an error. The reply is the text written after the last read tool call: "let me
  // look at the folder" before a read is the model thinking aloud.
  // Returns ['ready' => bool, 'reply' => string, 'error' => ?string]
  public static function parse( string $stdout ) : array
  {
    $ready  = false;
    $texts  = [];
    $result = '';
    $error  = null;

    foreach( preg_split('/\r?\n/', $stdout) as $line )
    {
      $event = json_decode($line, true);
      if( ! is_array($event) )
        continue;

      $type = $event['type'] ?? '';

      if( $type === 'system' && ($event['subtype'] ?? '') === 'init' )
      {
        foreach( (array)($event['mcp_servers'] ?? []) as $server )
          if( ($server['name'] ?? '') === AiMcpServer::NAME && ($server['status'] ?? '') === 'connected' )
            $ready = true;
      }
      elseif( $type === 'assistant' )
      {
        foreach( (array)($event['message']['content'] ?? []) as $part )
        {
          if( ($part['type'] ?? '') === 'text' && trim($part['text'] ?? '') !== '' )
            $texts[] = trim($part['text']);
          elseif( ($part['type'] ?? '') === 'tool_use' && AiTools::kind( self::plainName($part['name'] ?? '')) === 'read' )
            $texts = [];
        }
      }
      elseif( $type === 'result' )
      {
        $result = trim( (string)($event['result'] ?? ''));
        if( ! empty($event['is_error']) )
          $error = $result !== '' ? $result : (string)($event['subtype'] ?? 'unknown error');
      }
    }

    return ['ready' => $ready, 'reply' => $texts ? implode("\n\n", $texts) : $result, 'error' => $error];
  }

  // What the tool server recorded: ['proposal' => [...], 'client' => [...]], in order
  private static function recorded( string $file ) : array
  {
    $recorded = ['proposal' => [], 'client' => []];

    foreach( is_file($file) ? file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [] as $line )
    {
      $entry = json_decode($line, true);
      if( isset($recorded[$entry['kind'] ?? '']) )
        $recorded[$entry['kind']][] = $entry['data'];
    }

    return $recorded;
  }

  // "mcp__ninja__snippet_get" -> "snippet_get"
  private static function plainName( string $name ) : string
  {
    return strpos($name, self::PREFIX) === 0 ? substr($name, strlen(self::PREFIX)) : $name;
  }

  // --- The process ---

  // The argument list: proc_open() starts the exe directly, no shell, no quoting rules
  private function command( string $dir, bool $webSearch ) : array
  {
    [$php, $script] = $this->serverCommand();
    $builtIn        = $webSearch ? ['WebSearch', 'WebFetch'] : [];

    // Forward slashes: --mcp-config takes a file name or JSON and tells them apart by
    // parsing - a Windows path would put "\x" in, no valid JSON escape (grid-view)
    $mcp = json_encode(['mcpServers' => [AiMcpServer::NAME => [
      'command' => $php,
      'args'    => [$script],
      'env'     => ['NINJA_TURN_DIR' => strtr($dir, '\\', '/')]
    ]]], JSON_UNESCAPED_SLASHES);

    $command = [
      $this->bin(), '-p',
      '--output-format', 'stream-json', '--verbose',
      '--no-session-persistence',
      '--setting-sources', '',
      '--tools', implode(',', $builtIn),
      '--mcp-config', $mcp, '--strict-mcp-config',
      '--allowedTools', implode(',', array_merge($builtIn, array_map( fn( $tool ) => self::PREFIX . $tool['name'], AiTools::defs()))),
      '--system-prompt-file', "$dir/system.md"
    ];

    $model = trim( (string)($this->config['model'] ?? ''));
    if( $model !== '' )
      array_push($command, '--model', $model);

    return $command;
  }

  // Runs the command with the prompt on stdin, until it ends or times out.
  // stderr goes to a file: with two pipes to drain, the one not read fills up and the child
  // blocks on it. stdout is polled with a non-blocking fread: stream_select() does not work
  // on pipes on Windows.
  private function exec( array $command, string $stdin, string $dir ) : array
  {
    $errFile = "$dir/stderr.txt";
    $work    = "$dir/work";            // an empty folder to run in: no project around it to read
    $pipes   = [];
    @mkdir($work);

    $proc = @proc_open($command, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['file', $errFile, 'w']], $pipes, $work);
    if( ! is_resource($proc) )
      throw new RuntimeException("Could not start the Claude Code CLI ({$command[0]})");

    $stdout   = '';
    $timeout  = max(30, (int)($this->config['timeout'] ?? 300));
    $deadline = time() + $timeout;

    // Whatever happens, the CLI must not stay behind
    try {

      fwrite($pipes[0], $stdin);
      fclose($pipes[0]);
      stream_set_blocking($pipes[1], false);

      while( true )
      {
        $chunk = fread($pipes[1], 65536);
        if( is_string($chunk) && $chunk !== '' ) {
          $stdout .= $chunk;
          continue;
        }

        if( ! (proc_get_status($proc)['running'] ?? false) )
        {
          while( is_string($chunk = fread($pipes[1], 65536)) && $chunk !== '' )
            $stdout .= $chunk;
          break;
        }

        if( time() > $deadline )
          throw new RuntimeException("Claude Code took longer than $timeout seconds and was stopped (config.yml ai.claudeCode.timeout)");

        usleep(50000);
      }

      fclose($pipes[1]);
    }
    finally {
      if( proc_get_status($proc)['running'] ?? false )
        proc_terminate($proc);
      $code = proc_close($proc);
    }

    return ['stdout' => $stdout, 'stderr' => is_file($errFile) ? (string)file_get_contents($errFile) : '', 'code' => $code];
  }

  // The CLI: config bin, else claude on the PATH; null when there is none
  public function bin() : ?string
  {
    $bin = trim( (string)($this->config['bin'] ?? ''));
    if( $bin !== '' )
      return is_file($bin) ? $bin : null;

    $exe = DIRECTORY_SEPARATOR === '\\' ? 'claude.exe' : 'claude';
    foreach( explode(PATH_SEPARATOR, (string)getenv('PATH')) as $dir )
      if( $dir !== '' && is_file("$dir/$exe") )
        return "$dir/$exe";

    return null;
  }

  // How the MCP server starts, as [php, script]: in --mcp-config, and in the error when it did
  // not come up - the command to try in a shell to see why.
  // PHP_BINARY is not the php CLI under a web server module (mod_php: the Apache binary), and
  // the CLI would then run without tools. So: config phpBin, PHP_BINARY when this is the CLI
  // (php -S too), beside the loaded php.ini, PHP_BINDIR, the PATH.
  private function serverCommand() : array
  {
    $exe   = DIRECTORY_SEPARATOR === '\\' ? 'php.exe' : 'php';
    $ini   = php_ini_loaded_file();
    $tries = [
      trim( (string)($this->config['phpBin'] ?? '')),
      in_array(PHP_SAPI, ['cli', 'cli-server'], true) ? PHP_BINARY : '',
      $ini ? dirname($ini) . "/$exe" : '',
      PHP_BINDIR . "/$exe"
    ];
    foreach( explode(PATH_SEPARATOR, (string)getenv('PATH')) as $dir )
      $tries[] = "$dir/$exe";

    foreach( $tries as $path )
      if( $path !== '' && is_file($path) )
        return [strtr($path, '\\', '/'), strtr( realpath(__DIR__ . '/../../mcp/ai_tools.php'), '\\', '/')];

    throw new RuntimeException("The php command line ($exe) that runs the snippet tools was not found - set config.yml ai.claudeCode.phpBin");
  }

  private static function removeDir( string $dir ) : void
  {
    foreach( array_diff(scandir($dir) ?: [], ['.', '..']) as $entry )
    {
      $path = "$dir/$entry";
      is_dir($path) ? self::removeDir($path) : @unlink($path);
    }

    @rmdir($dir);
  }
}
