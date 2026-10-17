<?php

namespace SnippetManager\Tests;

use SnippetManager\Ai\AiTools;
use SnippetManager\UserStore;

// The read and client tools, and what call() hands back for each kind
class AiToolsTest extends TestCase
{
  private function tools( array $settings = [] ) : AiTools
  {
    return new AiTools( $this->manager($settings), new UserStore("{$this->root}/user"));
  }

  private function result( string $tool, array $args = [], array $settings = [] ) : array
  {
    return $this->tools($settings)->call('call_1', $tool, $args)['result'];
  }

  public function testDefinitionsAreComplete() : void
  {
    foreach( AiTools::defs() as $def )
    {
      $this->assertMatchesRegularExpression('/^[a-z_]+$/', $def['name']);
      $this->assertNotSame('', $def['description']);
      $this->assertSame('object', $def['parameters']['type'], $def['name']);

      // Every required argument is declared
      $properties = array_keys( (array)$def['parameters']['properties']);
      $this->assertSame([], array_diff($def['parameters']['required'] ?? [], $properties), $def['name']);
    }
  }

  public function testUnknownToolAndBadArgumentsBecomeErrors() : void
  {
    $this->assertSame(['error' => 'Unknown tool: nope'], $this->result('nope'));
    $this->assertSame(['error' => 'Missing argument: query'], $this->result('snippet_search'));
    $this->assertSame(['error' => 'Argument paths must be a list'], $this->result('snippet_get', ['paths' => 'x.yml']));
  }

  public function testSourcesGet() : void
  {
    $result = $this->result('sources_get', [], ['dataPaths' => ['Test' => ['A' => $this->a, 'B' => $this->b], 'Other' => ['A' => $this->a]]]);

    $this->assertSame('Test', $result['dataSet']);
    $this->assertSame([['label' => 'A', 'sharedWith' => ['Other']], ['label' => 'B', 'sharedWith' => []]], $result['sources']);
    $this->assertSame(['Other'], $result['otherDataSets']);
    $this->assertSame(['red', 'blue'], $result['colors']);
    $this->assertSame(3, $result['fileFormatVersion']);
  }

  public function testTreeList() : void
  {
    $this->write('a/10 Coding/20 Review.yml', "short: Reviews code\ncontent: x\n");
    $this->write('b/10 Coding/20 Review.yml', 'content: y');
    $this->write('a/10 Coding/deep/deeper/x.yml', 'content: x');
    $this->write('a/notes.md', '# Notes');
    $this->write('a/.sys/ninja.json', '{"fileColors": {"notes.md": "red"}}');

    $items = $this->result('tree_list', ['depth' => 2])['items'];

    $this->assertSame(['10 Coding', 'notes.md'], array_column($items, 'path'));
    $this->assertSame('Coding', $items[0]['name']);
    $this->assertSame(['A', 'B'], $items[0]['sources']);
    $this->assertSame(['name' => 'notes', 'path' => 'notes.md', 'type' => 'md', 'sources' => ['A'], 'color' => 'red'], $items[1]);

    // A file in both sources is one entry with both; a folder below the depth says "more"
    [$review, $deep] = $items[0]['items'];
    $this->assertSame(['name' => 'Review', 'path' => '10 Coding/20 Review.yml', 'type' => 'yml', 'sources' => ['A', 'B'], 'short' => 'Reviews code'], $review);
    $this->assertTrue($deep['more']);

    $this->assertSame('10 Coding/deep/deeper', $this->result('tree_list', ['path' => '10 Coding/deep'])['items'][0]['path']);
    $this->assertSame(['error' => 'No folder missing'], $this->result('tree_list', ['path' => 'missing']));
  }

  public function testTreeListShowsLinks() : void
  {
    $this->write('a/Common/x.yml', 'content: x');
    $this->write('b/Dev/INCLUDE Common');

    $dev = $this->result('tree_list', ['path' => 'Dev', 'depth' => 2])['items'];

    $this->assertSame('Common', $dev[0]['path']);
    $this->assertTrue($dev[0]['link']);
    $this->assertSame('Common/x.yml', $dev[0]['items'][0]['path']);
  }

  public function testSearch() : void
  {
    $this->write('a/post.yml', "short: A LinkedIn post\ncontent: x\n");

    $this->assertSame(
      ['hits' => [['path' => 'post.yml', 'type' => 'snippet', 'source' => 'A', 'short' => 'A LinkedIn post']]],
      $this->result('snippet_search', ['query' => 'linkedin'])
    );
  }

  public function testSnippetGet() : void
  {
    $this->write('a/style.yml', 'content: style');
    $this->write('a/post.yml', "id: 2026-01-01.01-V1\ncontent: |\n  Hi {{ name=you }} {{ MAYBE: Extra }}x{{ END-MAYBE }}\n  {{ include: \"style\" }}\n  {{ include: \"gone\" }}\n");
    $this->write('a/x.yml', 'content: a');
    $this->write('b/x.yml', 'content: b');

    [$post, $missing, $ambiguous] = $this->result('snippet_get', ['paths' => ['post.yml', 'missing.yml', 'x.yml']])['snippets'];

    $this->assertSame('A', $post['source']);
    $this->assertSame('2026-01-01.01-V1', $post['fields']['id']);
    $this->assertSame(['name' => ['type' => 'text', 'default' => 'you']], $post['placeholders']);
    $this->assertSame(['Extra'], $post['maybes']);
    $this->assertEquals((object)['style' => 'style.yml', 'gone' => null], $post['includes']);
    $this->assertStringStartsWith('No snippet missing.yml', $missing['error']);
    $this->assertSame('x.yml exists in the sources A, B - pass source', $ambiguous['error']);

    $this->assertSame('b', $this->result('snippet_get', ['paths' => ['x.yml'], 'source' => 'B'])['snippets'][0]['fields']['content']);
  }

  public function testUsages() : void
  {
    $this->write('a/style.yml', 'content: style');
    $this->write('a/sub/post.yml', "content: |\n  {{ include: \"style\" }}\n");
    $this->write('b/Dev/INCLUDE style');

    $this->assertSame([
      'links'      => [['path' => 'Dev/INCLUDE style', 'source' => 'B']],
      'includedBy' => [['path' => 'sub/post.yml', 'source' => 'A']]
    ], $this->result('snippet_usages', ['path' => 'style.yml']));
  }

  public function testRender() : void
  {
    $this->write('a/p.yml', "content: |\n  Review {{ file }} in {{ lang=PHP|JS }}\n  {{ MAYBE: Tests }}\n  with tests\n  {{ END-MAYBE }}\n");

    $result = $this->result('snippet_render', ['path' => 'p.yml', 'values' => ['file' => 'a.php'], 'maybeOff' => ['Tests']]);

    $this->assertSame("Review a.php in PHP\n", $result['text']);
    $this->assertSame(['file', 'lang'], array_keys($result['form']['placeholders']));
    $this->assertSame(['Tests'], $result['form']['maybes']);
  }

  public function testCheckOneSnippetOrAFolder() : void
  {
    $this->write('a/sub/bad.yml', 'content: ""');
    $this->write('a/other.yml', 'content: ""');

    $this->assertSame(['sub/bad.yml'], array_column($this->result('snippet_check', ['path' => 'sub/bad.yml'])['problems'], 'path'));
    $this->assertSame(1, $this->result('snippet_check', ['path' => 'sub'])['checked']);
    $this->assertSame(2, $this->result('snippet_check')['checked']);
    $this->assertStringStartsWith('No snippet', $this->result('snippet_check', ['path' => 'missing.yml'])['error']);
  }

  public function testRecent() : void
  {
    (new UserStore("{$this->root}/user"))->saveRecentSnippets('Test', [['path' => 'x.yml#1', 'name' => 'x', 'timestamp' => 1767225600000]]);

    $this->assertSame(['recent' => [['path' => 'x.yml', 'opened' => date('Y-m-d H:i', 1767225600)]]], $this->result('recent_get'));
  }

  public function testWriteToolsOnlyPropose() : void
  {
    $this->write('a/x.yml', 'content: old');

    $out = $this->tools()->call('call_7', 'snippet_update', ['path' => 'x.yml', 'fields' => ['content' => 'new']]);

    $this->assertSame('proposed_pending_user_approval', $out['result']['status']);
    $this->assertSame('call_7', $out['proposal']['id']);
    $this->assertSame('content: old', $this->read('a/x.yml'));
  }

  public function testClientTools() : void
  {
    $this->write('a/p.yml', "content: \"{{ topic }} {{ MAYBE: Short }}short{{ END-MAYBE }}\"\n");
    $tools = $this->tools();

    $shown = $tools->call('1', 'show_items', ['title' => 'Found', 'items' => [['path' => 'p.yml', 'note' => 'fits'], ['path' => 'gone.yml']]]);
    $this->assertSame(['status' => 'shown_to_user'], $shown['result']);
    $this->assertSame(
      [['path' => 'p.yml', 'type' => 'snippet', 'source' => 'A', 'basePath' => $this->a, 'exists' => true, 'note' => 'fits'],
       ['path' => 'gone.yml', 'type' => 'snippet', 'exists' => false, 'note' => '']],
      $shown['client']['items']
    );

    $this->assertSame(['tool' => 'snippet_open', 'path' => 'p.yml', 'source' => 'A', 'basePath' => $this->a], $tools->call('2', 'snippet_open', ['path' => 'p.yml'])['client']);

    $filled = $tools->call('3', 'form_fill', ['path' => 'p.yml', 'values' => ['topic' => 'AI'], 'maybeOff' => ['Short']])['client'];
    $this->assertEquals((object)['topic' => 'AI'], $filled['values']);
    $this->assertSame(['Short'], $filled['maybeOff']);

    $this->assertSame('Not in the form: topik. Placeholders: topic', $tools->call('4', 'form_fill', ['path' => 'p.yml', 'values' => ['topik' => 'AI']])['result']['error']);
    $this->assertSame('No MAYBE block Long. MAYBE blocks: Short', $tools->call('5', 'form_fill', ['path' => 'p.yml', 'maybeOff' => ['Long']])['result']['error']);
  }
}
