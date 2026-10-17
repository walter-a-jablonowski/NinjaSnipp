<?php

namespace SnippetManager\Tests;

use SnippetManager\Ai\AiChat;
use SnippetManager\Ai\AiPrompt;
use SnippetManager\Ai\AiTools;
use SnippetManager\UserStore;

// The tool loop with a scripted model in place of a provider
class AiChatTest extends TestCase
{
  private array $sent = [];       // the messages of each model call

  // A model that answers with the given messages in turn
  private function chat( array $answers, int $maxSteps = 15 ) : AiChat
  {
    $model = function( array $messages, array $tools ) use ( &$answers ) : array {
      $this->sent[] = $messages;
      return array_shift($answers);
    };

    return new AiChat($model, new AiTools( $this->manager(), new UserStore("{$this->root}/user")), $maxSteps);
  }

  private static function calls( array ...$calls ) : array
  {
    return ['role' => 'assistant', 'content' => null, 'tool_calls' => array_map( fn( $call ) => [
      'id' => $call[0], 'type' => 'function', 'function' => ['name' => $call[1], 'arguments' => is_string($call[2]) ? $call[2] : json_encode($call[2])]
    ], $calls)];
  }

  public function testReadsProposesAndAnswers() : void
  {
    $this->write('a/x.yml', 'content: old');

    $turn = $this->chat([
      self::calls(['c1', 'snippet_get', ['paths' => ['x.yml']]]),
      self::calls(['c2', 'snippet_update', ['path' => 'x.yml', 'fields' => ['content' => 'new']]], ['c3', 'snippet_open', ['path' => 'x.yml']]),
      ['role' => 'assistant', 'content' => 'I propose a new content.']
    ])->run('System', [['role' => 'user', 'content' => 'Improve x']]);

    $this->assertSame('I propose a new content.', $turn['reply']);
    $this->assertSame(['c2'], array_column($turn['proposals'], 'id'));
    $this->assertSame(['snippet_open'], array_column($turn['clientCalls'], 'tool'));
    $this->assertSame('content: old', $this->read('a/x.yml'));

    // The system prompt first, every tool result back to the model under its call id
    [$system, $user, , $read] = $this->sent[1];
    $this->assertSame(['role' => 'system', 'content' => 'System'], $system);
    $this->assertSame('Improve x', $user['content']);
    $this->assertSame('c1', $read['tool_call_id']);
    $this->assertSame('old', json_decode($read['content'], true)['snippets'][0]['fields']['content']);

    [$proposed, $opened] = array_slice($this->sent[2], -2);
    $this->assertSame('proposed_pending_user_approval', json_decode($proposed['content'], true)['status']);
    $this->assertSame('{"status":"opened"}', $opened['content']);
  }

  public function testBrokenArgumentsGoBackAsError() : void
  {
    $this->chat([
      self::calls(['c1', 'snippet_get', '{not json']),
      ['role' => 'assistant', 'content' => 'Sorry']
    ])->run('System', [['role' => 'user', 'content' => 'x']]);

    $this->assertSame('{"error":"The arguments are no JSON object"}', end($this->sent[1])['content']);
  }

  public function testStopsAfterMaxSteps() : void
  {
    $turn = $this->chat([
      array_replace( self::calls(['c1', 'sources_get', []]), ['content' => 'Still looking']),
      array_replace( self::calls(['c2', 'sources_get', []]), ['content' => 'Still looking']),
    ], 2)->run('System', [['role' => 'user', 'content' => 'x']]);

    $this->assertSame("Still looking\n\n_Stopped after 2 tool rounds - ask again to continue._", $turn['reply']);
  }

  public function testSystemPrompt() : void
  {
    $prompt = AiPrompt::build( $this->manager(), ['systemPrompt' => 'Answer in German.'], ['path' => 'p.yml', 'source' => 'B']);

    $this->assertStringContainsString('You are the assistant built into NinjaSnipp', $prompt);
    $this->assertStringContainsString("```yml\nid:", $prompt);                       // the template
    $this->assertStringContainsString('- Data set: Test, sources: A, B (same-named folders merged)', $prompt);
    $this->assertStringContainsString('- Open in the editor ("this snippet"): p.yml in source B', $prompt);
    $this->assertStringEndsWith("## The user's instructions\n\nAnswer in German.", $prompt);
  }
}
