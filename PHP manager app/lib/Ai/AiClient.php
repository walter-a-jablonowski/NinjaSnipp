<?php

namespace SnippetManager\Ai;

use RuntimeException;
use stdClass;

// Chat client for the API providers (config.yml ai): OpenRouter, Gemini (Google AI Studio)
// and Ollama. Every provider is normalized to the OpenAI shape, so the tool loop deals with
// one format: chat() takes OpenAI messages and tool definitions and returns the assistant
// message ['role' => 'assistant', 'content' => ?string, 'tool_calls' => [...]].
//
// The API key comes from .env, AI_API_KEY_<PROVIDER>, so switching the provider needs no
// .env change; Ollama needs none.
class AiClient
{
  public const LABELS = ['openrouter' => 'OpenRouter', 'gemini' => 'Gemini', 'ollama' => 'Ollama'];

  private string $provider;
  private string $model;
  private string $apiKey;
  private string $ollamaUrl;
  private int $timeout;
  private int $maxTokens;

  public function __construct( array $config, string $provider, array $env )
  {
    if( ! isset(self::LABELS[$provider]) )
      throw new RuntimeException("Unknown AI provider: $provider");

    $this->provider  = $provider;
    $this->model     = (string)($config['model'] ?? '');
    $this->apiKey    = trim( (string)($env['AI_API_KEY_' . strtoupper($provider)] ?? ''));
    $this->ollamaUrl = rtrim( (string)($config['ollamaUrl'] ?? 'http://localhost:11434'), '/');
    $this->timeout   = (int)($config['timeout'] ?? 120);
    $this->maxTokens = (int)($config['maxTokens'] ?? 8192);

    if( $this->apiKey === '' && $provider !== 'ollama' )
      throw new RuntimeException('No API key for ' . self::LABELS[$provider] . ': set AI_API_KEY_' . strtoupper($provider) . ' in .env');
  }

  // What the sidebar's provider select offers, provider => label, the default first: the
  // configured provider, and Claude Code where it is available (first with claudeCode.default)
  public static function choices( array $config ) : array
  {
    $provider = (string)($config['provider'] ?? 'openrouter');
    $choices  = [$provider => self::LABELS[$provider] ?? $provider];
    $claude   = $config['claudeCode'] ?? [];

    if( AiClaude::available($claude) )
      $choices = ! empty($claude['default'])
        ? [AiClaude::PROVIDER => 'Claude Code'] + $choices
        : $choices + [AiClaude::PROVIDER => 'Claude Code'];

    return $choices;
  }

  // KEY=value lines; # starts a comment
  public static function loadEnv( string $file ) : array
  {
    $env = [];

    foreach( is_file($file) ? file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [] as $line )
    {
      $line = trim($line);
      if( $line === '' || $line[0] === '#' || strpos($line, '=') === false )
        continue;

      [$key, $value] = explode('=', $line, 2);
      $env[trim($key)] = trim( trim($value), '"\'');
    }

    return $env;
  }

  // $tools: [['name', 'description', 'parameters'], ...] (AiTools::defs())
  public function chat( array $messages, array $tools ) : array
  {
    if( $this->provider === 'gemini' )
      return $this->callGemini($messages, $tools);
    if( $this->provider === 'ollama' )
      return $this->callOllama($messages, $tools);

    return $this->callOpenRouter($messages, $tools);
  }

  private static function openAiTools( array $tools ) : array
  {
    return array_map( fn( $tool ) => ['type' => 'function', 'function' => $tool], $tools);
  }

  // --- OpenRouter (OpenAI compatible) ---

  private function callOpenRouter( array $messages, array $tools ) : array
  {
    $body = $this->post('https://openrouter.ai/api/v1/chat/completions', [
      'model'      => $this->model,
      'max_tokens' => $this->maxTokens,
      'messages'   => self::openAiMessages($messages),
      'tools'      => self::openAiTools($tools)
    ], ["Authorization: Bearer {$this->apiKey}", 'HTTP-Referer: NinjaSnipp']);

    $choice = $body['choices'][0] ?? null;

    if( ! isset($choice['message']) )
      throw new RuntimeException('The AI answered without a message');
    if( ($choice['finish_reason'] ?? '') === 'error' )
      throw new RuntimeException('The model ended its answer with an error');

    return [
      'role'       => 'assistant',
      'content'    => $choice['message']['content'] ?? null,
      'tool_calls' => $choice['message']['tool_calls'] ?? []
    ];
  }

  // Only what the OpenAI format has: the Gemini extras of a message are left out
  public static function openAiMessages( array $messages ) : array
  {
    return array_map( function( array $msg ) {

      $out = ['role' => $msg['role'], 'content' => $msg['content'] ?? null];

      if( ! empty($msg['tool_calls']) )
        $out['tool_calls'] = array_map( fn( $call ) => [
          'id'       => $call['id'],
          'type'     => 'function',
          'function' => ['name' => $call['function']['name'], 'arguments' => $call['function']['arguments']]
        ], $msg['tool_calls']);

      if( isset($msg['tool_call_id']) )
        $out['tool_call_id'] = $msg['tool_call_id'];

      return $out;
    }, $messages);
  }

  // --- Ollama ---

  // Ollama sends and expects the arguments of a call as an object, not as a JSON string,
  // and gives its calls no ids
  private function callOllama( array $messages, array $tools ) : array
  {
    $messages = array_map( function( array $msg ) {
      foreach( $msg['tool_calls'] ?? [] as $i => $call )
        $msg['tool_calls'][$i]['function']['arguments'] = (object)(json_decode($call['function']['arguments'], true) ?: []);
      return $msg;
    }, self::openAiMessages($messages));

    $body = $this->post("{$this->ollamaUrl}/api/chat", [
      'model'    => $this->model,
      'messages' => $messages,
      'tools'    => self::openAiTools($tools),
      'stream'   => false,
      'options'  => ['num_predict' => $this->maxTokens]
    ], []);

    if( ! isset($body['message']) )
      throw new RuntimeException('Ollama answered without a message');

    return [
      'role'       => 'assistant',
      'content'    => $body['message']['content'] ?? null,
      'tool_calls' => array_map( fn( $call ) => [
        'id'       => 'ollama_' . bin2hex(random_bytes(6)),
        'type'     => 'function',
        'function' => ['name' => $call['function']['name'], 'arguments' => json_encode($call['function']['arguments'] ?? new stdClass)]
      ], $body['message']['tool_calls'] ?? [])
    ];
  }

  // --- Gemini ---

  private function callGemini( array $messages, array $tools ) : array
  {
    $payload = [
      'contents'         => self::geminiContents($messages),
      'tools'            => [['functionDeclarations' => array_map( fn( $tool ) => [
                              'name'                 => $tool['name'],
                              'description'          => $tool['description'],
                              'parametersJsonSchema' => $tool['parameters']    // full JSON Schema, not the OpenAPI subset
                            ], $tools)]],
      'generationConfig' => ['maxOutputTokens' => $this->maxTokens]
    ];

    foreach( $messages as $msg )
      if( $msg['role'] === 'system' )
        $payload['systemInstruction'] = ['parts' => [['text' => $msg['content']]]];

    // The key goes in a header: a URL ends up in logs and error messages
    $url = "https://generativelanguage.googleapis.com/v1beta/models/{$this->model}:generateContent";
    return self::geminiMessage( $this->post($url, $payload, ["x-goog-api-key: {$this->apiKey}"]));
  }

  // The OpenAI conversation as Gemini contents. Tool calls and their results have to
  // survive, or the model does not know what it did and repeats it. A model turn of this
  // request goes back exactly as Gemini sent it (geminiParts): Gemini refuses the next
  // request without its thought signatures.
  public static function geminiContents( array $messages ) : array
  {
    $contents = [];
    $calls    = [];            // tool_call_id => [function name, Gemini's own call id]

    foreach( $messages as $msg )
    {
      if( $msg['role'] === 'system' )
        continue;

      if( $msg['role'] === 'assistant' )
      {
        foreach( $msg['tool_calls'] ?? [] as $call )
          $calls[$call['id']] = [$call['function']['name'], $call['geminiId'] ?? null];

        if( ! empty($msg['geminiParts']) )
        {
          $contents[] = ['role' => 'model', 'parts' => $msg['geminiParts']];
          continue;
        }

        $parts = ( ($msg['content'] ?? '') !== '') ? [['text' => $msg['content']]] : [];
        foreach( $msg['tool_calls'] ?? [] as $call )
          $parts[] = ['functionCall' => ['name' => $call['function']['name'], 'args' => (object)(json_decode($call['function']['arguments'], true) ?: [])]];

        if( $parts )
          $contents[] = ['role' => 'model', 'parts' => $parts];
        continue;
      }

      if( $msg['role'] === 'tool' )
      {
        [$name, $geminiId] = $calls[$msg['tool_call_id']] ?? ['tool', null];
        $response = ['name' => $name, 'response' => ['result' => json_decode($msg['content'], true) ?? $msg['content']]];
        if( $geminiId !== null )
          $response['id'] = $geminiId;

        $contents[] = ['role' => 'user', 'parts' => [['functionResponse' => $response]]];
        continue;
      }

      $contents[] = ['role' => 'user', 'parts' => [['text' => (string)$msg['content']]]];
    }

    return $contents;
  }

  public static function geminiMessage( array $body ) : array
  {
    $candidate = $body['candidates'][0] ?? null;

    // A blocked prompt comes back without candidates, the reason in promptFeedback
    if( ! $candidate )
      throw new RuntimeException('Gemini answered without a reply (' . ($body['promptFeedback']['blockReason'] ?? 'no candidates') . ')');

    $parts = $candidate['content']['parts'] ?? [];
    $text  = '';
    $calls = [];

    // json_decode made an empty object {} an empty list [], which Gemini refuses when the
    // turn goes back to it
    foreach( $parts as &$part )
      if( isset($part['functionCall']) && ($part['functionCall']['args'] ?? null) === [] )
        $part['functionCall']['args'] = new stdClass;
    unset($part);

    foreach( $parts as $part )
    {
      if( isset($part['text']) && empty($part['thought']) )
        $text .= $part['text'];

      if( isset($part['functionCall']) )
      {
        // Unique across rounds: the id also names the proposal in the sidebar
        $call = [
          'id'       => 'gemini_' . bin2hex(random_bytes(6)),
          'type'     => 'function',
          'function' => ['name' => $part['functionCall']['name'], 'arguments' => json_encode($part['functionCall']['args'] ?? new stdClass)]
        ];
        if( isset($part['functionCall']['id']) )
          $call['geminiId'] = $part['functionCall']['id'];

        $calls[] = $call;
      }
    }

    return ['role' => 'assistant', 'content' => $text !== '' ? $text : null, 'tool_calls' => $calls]
         + ($parts ? ['geminiParts' => $parts] : []);
  }

  // --- HTTP ---

  private function post( string $url, array $payload, array $headers ) : array
  {
    // A provider that is busy right now (503 "high demand") mostly answers a second try a
    // moment later; a rate limit (429) would not, so it is not retried
    for( $attempt = 1; $attempt <= 2; $attempt++ )
    {
      $ch = curl_init($url);
      curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($payload),
        CURLOPT_HTTPHEADER     => array_merge(['Content-Type: application/json'], $headers),
        CURLOPT_TIMEOUT        => $this->timeout
      ]);

      $response = curl_exec($ch);
      $status   = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
      $error    = curl_error($ch);
      curl_close($ch);

      if( $error !== '' || ! in_array($status, [502, 503, 504], true) )
        break;
      if( $attempt === 1 )
        sleep(3);
    }

    if( $error !== '' )
      throw new RuntimeException("The AI could not be reached: $error");

    return self::decode((string)$response, $status);
  }

  // The provider's answer, or an exception saying what went wrong: an HTML error page or an
  // {"error": ...} sent with HTTP 200 must not turn into an empty reply
  public static function decode( string $response, int $status ) : array
  {
    $data = json_decode($response, true);

    if( is_array($data) && isset($data['error']) )
    {
      $error = $data['error'];
      throw new RuntimeException("AI error ($status): " . (is_array($error) ? ($error['message'] ?? json_encode($error)) : $error));
    }

    if( $status >= 400 || ! is_array($data) )
    {
      $excerpt = substr( trim( strip_tags($response)), 0, 200);
      throw new RuntimeException("The AI answered HTTP $status" . ($excerpt !== '' ? ": $excerpt" : ' without a body'));
    }

    return $data;
  }
}
