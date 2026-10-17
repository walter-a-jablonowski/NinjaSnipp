<?php

namespace SnippetManager\Ai;

// One chat turn with an API provider: the model may call tools, their results go back to
// it, until it answers without calling any. Read tools run, write calls become proposals,
// client calls are passed to the browser (AiTools::call()).
//
// Only the user's and the assistant's text survive the turn (the session); the tool
// rounds are rebuilt by the model from the tools when it needs them again.
class AiChat
{
  private $chat;              // fn( array $messages, array $tools ) : array - one model call
  private AiTools $tools;
  private int $maxSteps;

  public function __construct( callable $chat, AiTools $tools, int $maxSteps )
  {
    $this->chat     = $chat;
    $this->tools    = $tools;
    $this->maxSteps = max(1, $maxSteps);
  }

  // $history: [['role' => 'user' | 'assistant', 'content'], ...], the user's line last.
  // Returns ['reply', 'proposals' => [...], 'clientCalls' => [...]]
  public function run( string $systemPrompt, array $history ) : array
  {
    $messages    = array_merge([['role' => 'system', 'content' => $systemPrompt]], $history);
    $defs        = AiTools::defs();
    $proposals   = [];
    $clientCalls = [];

    for( $step = 1; $step <= $this->maxSteps; $step++ )
    {
      $message    = ($this->chat)($messages, $defs);
      $messages[] = $message;

      if( empty($message['tool_calls']) )
        return ['reply' => (string)($message['content'] ?? ''), 'proposals' => $proposals, 'clientCalls' => $clientCalls];

      foreach( $message['tool_calls'] as $call )
      {
        $args = json_decode($call['function']['arguments'] ?? '', true);
        $out  = is_array($args)
          ? $this->tools->call($call['id'], $call['function']['name'], $args)
          : ['result' => ['error' => 'The arguments are no JSON object']];

        if( isset($out['proposal']) )
          $proposals[] = $out['proposal'];
        if( isset($out['client']) )
          $clientCalls[] = $out['client'];

        $messages[] = ['role' => 'tool', 'tool_call_id' => $call['id'], 'content' => json_encode($out['result'])];
      }
    }

    // Out of steps while the model still wanted to go on
    $reply = trim( (string)($message['content'] ?? '') . "\n\n_Stopped after {$this->maxSteps} tool rounds - ask again to continue._");
    return ['reply' => $reply, 'proposals' => $proposals, 'clientCalls' => $clientCalls];
  }
}
