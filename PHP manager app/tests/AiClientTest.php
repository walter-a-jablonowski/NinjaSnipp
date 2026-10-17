<?php

namespace SnippetManager\Tests;

use RuntimeException;
use SnippetManager\Ai\AiClient;

// The provider conversions, without a network call
class AiClientTest extends TestCase
{
  private const CALL = ['id' => 'gemini_1', 'type' => 'function', 'geminiId' => 'g1', 'function' => ['name' => 'snippet_get', 'arguments' => '{"paths":["x.yml"]}']];

  public function testMissingKeyIsReported() : void
  {
    $this->expectExceptionMessage('No API key for Gemini: set AI_API_KEY_GEMINI in .env');
    new AiClient([], 'gemini', ['AI_API_KEY_OPENROUTER' => 'k']);
  }

  public function testOllamaNeedsNoKey() : void
  {
    $this->assertInstanceOf(AiClient::class, new AiClient([], 'ollama', []));
    $this->assertSame(['ollama' => 'Ollama'], AiClient::choices(['provider' => 'ollama']));
  }

  public function testLoadEnv() : void
  {
    $file = $this->write('.env', "# keys\nAI_API_KEY_GEMINI = \"abc\"\n\nBROKEN\nX=a=b\n");

    $this->assertSame(['AI_API_KEY_GEMINI' => 'abc', 'X' => 'a=b'], AiClient::loadEnv($file));
    $this->assertSame([], AiClient::loadEnv("{$this->root}/missing"));
  }

  public function testOpenAiMessagesDropTheGeminiExtras() : void
  {
    $messages = AiClient::openAiMessages([
      ['role' => 'assistant', 'content' => null, 'tool_calls' => [self::CALL], 'geminiParts' => [['text' => 'x']]],
      ['role' => 'tool', 'tool_call_id' => 'gemini_1', 'content' => '{}']
    ]);

    $this->assertSame([
      ['role' => 'assistant', 'content' => null, 'tool_calls' => [['id' => 'gemini_1', 'type' => 'function', 'function' => self::CALL['function']]]],
      ['role' => 'tool', 'content' => '{}', 'tool_call_id' => 'gemini_1']
    ], $messages);
  }

  public function testGeminiContents() : void
  {
    $contents = AiClient::geminiContents([
      ['role' => 'system', 'content' => 'sys'],
      ['role' => 'user', 'content' => 'Hi'],
      ['role' => 'assistant', 'content' => 'Looking', 'tool_calls' => [self::CALL]],
      ['role' => 'tool', 'tool_call_id' => 'gemini_1', 'content' => '{"snippets":[]}'],
      ['role' => 'assistant', 'content' => null, 'geminiParts' => [['text' => 'as sent', 'thoughtSignature' => 's']]]
    ]);

    $this->assertSame(['role' => 'user', 'parts' => [['text' => 'Hi']]], $contents[0]);
    $this->assertSame('Looking', $contents[1]['parts'][0]['text']);
    $this->assertEquals((object)['paths' => ['x.yml']], $contents[1]['parts'][1]['functionCall']['args']);
    $this->assertSame(['functionResponse' => ['name' => 'snippet_get', 'response' => ['result' => ['snippets' => []]], 'id' => 'g1']], $contents[2]['parts'][0]);
    $this->assertSame(['role' => 'model', 'parts' => [['text' => 'as sent', 'thoughtSignature' => 's']]], $contents[3]);
  }

  public function testGeminiMessage() : void
  {
    $message = AiClient::geminiMessage(['candidates' => [['content' => ['parts' => [
      ['text' => 'thinking', 'thought' => true],
      ['text' => 'Here'],
      ['functionCall' => ['name' => 'sources_get', 'args' => [], 'id' => 'g2'], 'thoughtSignature' => 's']
    ]]]]]);

    $this->assertSame('Here', $message['content']);
    $this->assertSame('sources_get', $message['tool_calls'][0]['function']['name']);
    $this->assertSame('{}', $message['tool_calls'][0]['function']['arguments']);
    $this->assertSame('g2', $message['tool_calls'][0]['geminiId']);
    $this->assertEquals(new \stdClass, $message['geminiParts'][2]['functionCall']['args']);   // {} again, not []

    $this->expectExceptionMessage('Gemini answered without a reply (SAFETY)');
    AiClient::geminiMessage(['promptFeedback' => ['blockReason' => 'SAFETY']]);
  }

  public function testDecodeReportsErrors() : void
  {
    $this->assertSame(['ok' => 1], AiClient::decode('{"ok":1}', 200));

    foreach( [
      ['{"error":{"message":"bad key"}}', 200, 'AI error (200): bad key'],
      ['<html><b>Gateway</b> timeout</html>', 504, 'The AI answered HTTP 504: Gateway timeout'],
      ['', 500, 'The AI answered HTTP 500 without a body']
    ] as [$body, $status, $message] )
    {
      try {
        AiClient::decode($body, $status);
        $this->fail("No exception for $body");
      }
      catch( RuntimeException $e ) {
        $this->assertSame($message, $e->getMessage());
      }
    }
  }
}
