<?php

namespace SnippetManager\Tests;

use RuntimeException;
use SnippetManager\Ai\AiChanges;
use SnippetManager\Ai\AiLibrary;
use Symfony\Component\Yaml\Yaml;

// The write tools: a proposal changes nothing, applying it does exactly what it showed
class AiChangesTest extends TestCase
{
  private function changes( array $settings = [] ) : AiChanges
  {
    return new AiChanges( new AiLibrary( $this->manager($settings)));
  }

  private function propose( string $tool, array $args, array $settings = [] ) : array
  {
    return $this->changes($settings)->propose('call_1', $tool, $args);
  }

  // Proposes and applies in one go, with a fresh manager each time as two requests would
  private function proposeAndApply( string $tool, array $args, array $settings = [] ) : array
  {
    $proposal = $this->propose($tool, $args, $settings);
    $this->changes($settings)->apply( json_decode( json_encode($proposal), true));   // as it comes back from the client
    return $proposal;
  }

  private function assertRefused( string $message, string $tool, array $args, array $settings = [] ) : void
  {
    try {
      $this->propose($tool, $args, $settings);
      $this->fail("$tool was not refused");
    }
    catch( RuntimeException $e ) {
      $this->assertStringStartsWith($message, $e->getMessage());
    }
  }

  // --- snippets ---

  public function testCreate() : void
  {
    $this->write('a/Reviews/.keep');

    $proposal = $this->propose('snippet_create', ['path' => 'Reviews/Code.yml', 'fields' => ['short' => 'Code review', 'usage.head' => 'Head', 'content' => 'Review {{ file }}']]);

    $this->assertSame('Create *Code*', $proposal['label']);
    $this->assertSame('A', $proposal['source']);
    $this->assertSame(['short', 'usage.head', 'content'], array_column($proposal['preview'], 'field'));
    $this->assertMissing('a/Reviews/Code.yml');

    $this->changes()->apply($proposal);
    $stored = Yaml::parse($this->read('a/Reviews/Code.yml'));

    $this->assertSame('Head', $stored['usage']['head']);
    $this->assertSame(date('Y-m-d') . '.01-V1', $stored['id']);
    $this->assertSame(3, $stored['version']);
  }

  public function testCreateRefusals() : void
  {
    $this->write('a/x.yml', 'content: x');

    $this->assertRefused('The path needs the extension', 'snippet_create', ['path' => 'y']);
    $this->assertRefused('x.yml exists already', 'snippet_create', ['path' => 'x.yml']);
    $this->assertRefused('id and version are never changed', 'snippet_create', ['path' => 'n.yml', 'fields' => ['id' => 'x']]);
    $this->assertRefused('Unknown field short', 'snippet_create', ['path' => 'n.md', 'fields' => ['short' => 'x']]);
    $this->assertRefused('n.yml could go to the sources A, B - pass source', 'snippet_create', ['path' => 'n.yml']);
    $this->assertSame('B', $this->propose('snippet_create', ['path' => 'n.yml', 'source' => 'B'])['source']);
  }

  public function testUpdate() : void
  {
    $this->write('a/p.yml', Yaml::dump(['id' => 'i', 'short' => 'old', 'usage' => ['vars' => ['a' => 'A', 'b' => 'B']], 'content' => 'c']));

    $proposal = $this->proposeAndApply('snippet_update', ['path' => 'p.yml', 'fields' => ['short' => 'new', 'usage.vars.b' => null, 'usage.vars.c' => 'C']]);

    $this->assertSame('Update *p*: short, usage.vars', $proposal['label']);
    $this->assertSame(['field' => 'usage.vars', 'before' => "a: A\nb: B", 'after' => "a: A\nc: C"], $proposal['preview'][1]);
    $this->assertSame(['id' => 'i', 'short' => 'new', 'usage' => ['vars' => ['a' => 'A', 'c' => 'C']], 'content' => 'c'], Yaml::parse($this->read('a/p.yml')));
  }

  public function testUpdatePlainTextUsageBecomesItsText() : void
  {
    $this->write('a/p.yml', "usage: Some prose\ncontent: c\n");

    $this->proposeAndApply('snippet_update', ['path' => 'p.yml', 'fields' => ['usage.head' => 'Head']]);

    $this->assertSame(['text' => 'Some prose', 'head' => 'Head'], Yaml::parse($this->read('a/p.yml'))['usage']);
  }

  public function testUpdateRefusals() : void
  {
    $this->write('a/p.yml', 'content: c');
    $this->write('a/m.md', 'm');

    $this->assertRefused('id and version are never changed', 'snippet_update', ['path' => 'p.yml', 'fields' => ['version' => 4]]);
    $this->assertRefused('Unknown field title', 'snippet_update', ['path' => 'p.yml', 'fields' => ['title' => 'x']]);
    $this->assertRefused('Unknown field short. Fields: content', 'snippet_update', ['path' => 'm.md', 'fields' => ['short' => 'x']]);
    $this->assertRefused('content must not be empty', 'snippet_update', ['path' => 'p.yml', 'fields' => ['content' => ' ']]);
    $this->assertRefused('Nothing would change', 'snippet_update', ['path' => 'p.yml', 'fields' => ['content' => 'c']]);
    $this->assertRefused('Missing argument: fields', 'snippet_update', ['path' => 'p.yml']);
  }

  public function testUpdateRefusedWhenTheFieldChangedMeanwhile() : void
  {
    $this->write('a/p.yml', "short: s\ncontent: c\n");
    $proposal = $this->propose('snippet_update', ['path' => 'p.yml', 'fields' => ['content' => 'new']]);

    // Another field changed: still applies, and keeps that change
    $this->write('a/p.yml', "short: edited\ncontent: c\n");
    $this->changes()->apply($proposal);
    $this->assertSame(['short' => 'edited', 'content' => 'new'], Yaml::parse($this->read('a/p.yml')));

    // The same field changed: refused
    $this->write('a/p.yml', "content: edited too\n");
    $this->expectExceptionMessage('Changed since it was proposed');
    $this->changes()->apply($proposal);
  }

  public function testEdit() : void
  {
    $this->write('a/p.yml', Yaml::dump(['usage' => ['text' => "### Changelog\n\n- V1: first\n"], 'content' => "Line one\nLine two\n"], 4, 2, Yaml::DUMP_MULTI_LINE_LITERAL_BLOCK));

    $proposal = $this->proposeAndApply('snippet_edit', ['path' => 'p.yml', 'edits' => [
      ['field' => 'content', 'old' => 'Line two', 'new' => 'Line 2'],
      ['field' => 'usage.text', 'old' => "- V1: first\n", 'new' => "- V1: first\n- V2: second\n"],
      ['field' => 'content', 'old' => 'one', 'new' => '1']
    ]]);

    $this->assertSame('Edit *p*: content, usage.text', $proposal['label']);
    $this->assertSame("Line 1\nLine 2\n", Yaml::parse($this->read('a/p.yml'))['content']);
    $this->assertStringEndsWith("- V2: second\n", Yaml::parse($this->read('a/p.yml'))['usage']['text']);
  }

  public function testEditRefusals() : void
  {
    $this->write('a/p.yml', "content: a a b\n");

    $this->assertRefused('edit 1 (content): old text not found', 'snippet_edit', ['path' => 'p.yml', 'edits' => [['field' => 'content', 'old' => 'x', 'new' => 'y']]]);
    $this->assertRefused('edit 1 (content): old text occurs 2 times', 'snippet_edit', ['path' => 'p.yml', 'edits' => [['field' => 'content', 'old' => 'a', 'new' => 'y']]]);
    $this->assertRefused('edit 1 (short): short is no text field of this snippet', 'snippet_edit', ['path' => 'p.yml', 'edits' => [['field' => 'short', 'old' => 'a', 'new' => 'y']]]);
    $this->assertRefused('Argument edits must be a list of objects', 'snippet_edit', ['path' => 'p.yml', 'edits' => ['x']]);
  }

  public function testDuplicate() : void
  {
    $this->write('b/sub/p.yml', "id: 2020-01-01.01-V1\ncontent: c\n");

    $proposal = $this->proposeAndApply('snippet_duplicate', ['path' => 'sub/p.yml', 'newPath' => 'sub/p LinkedIn']);

    $this->assertSame('sub/p LinkedIn.yml', $proposal['path']);
    $this->assertSame(date('Y-m-d') . '.01-V1', Yaml::parse($this->read('b/sub/p LinkedIn.yml'))['id']);
  }

  public function testDeleteWarnsAboutIncludesAndLinks() : void
  {
    $this->write('a/style.yml', 'content: style');
    $this->write('a/post.yml', "content: |\n  {{ include: \"style\" }}\n");
    $this->write('b/Dev/INCLUDE style');

    $proposal = $this->propose('snippet_delete', ['path' => 'style.yml']);

    $this->assertSame([
      '1 snippet(s) include it by name, deleting breaks that: post.yml',
      'INCLUDE links show it elsewhere, they break: Dev/INCLUDE style'
    ], $proposal['warnings']);
    $this->assertSame('style', $proposal['preview'][0]['before']);

    $this->write('a/style.yml', 'content: edited');
    $this->expectExceptionMessage('Changed since it was proposed');
    $this->changes()->apply($proposal);
  }

  // --- folders, links, names, colors ---

  public function testCreateFolderAndLink() : void
  {
    $this->write('a/Common/x.yml', 'content: x');
    $this->write('b/Dev/.keep');

    $this->proposeAndApply('folder_create', ['path' => 'Dev/Reviews']);
    $this->proposeAndApply('link_create', ['folder' => 'Dev', 'target' => 'Common']);

    $this->assertDirectoryExists("{$this->b}/Dev/Reviews");
    $this->assertExists('b/Dev/INCLUDE Common');
    $this->assertRefused('No folder or snippet Missing at the root', 'link_create', ['folder' => 'Dev', 'target' => 'Missing']);
    $this->assertRefused('Dev has this link already', 'link_create', ['folder' => 'Dev', 'target' => 'Common']);
  }

  public function testRenameWarnsAboutIncludesByName() : void
  {
    $this->write('a/sub/style.yml', 'content: style');
    $this->write('a/post.yml', "content: |\n  {{ include: \"style\" }}\n");

    $proposal = $this->proposeAndApply('item_rename', ['path' => 'sub/style.yml', 'newName' => 'Style guide']);

    $this->assertSame('Rename *style* to *Style guide*', $proposal['label']);
    $this->assertSame(['1 snippet(s) include it by name, renaming breaks that: post.yml'], $proposal['warnings']);
    $this->assertExists('a/sub/Style guide.yml');
    $this->assertRefused('newName is a name, not a path', 'item_rename', ['path' => 'post.yml', 'newName' => 'x/y']);
  }

  public function testRenameMergedFolderInAllSources() : void
  {
    $this->write('a/dir/x.yml', 'content: x');
    $this->write('b/dir/y.yml', 'content: y');

    $this->proposeAndApply('item_rename', ['path' => 'dir', 'newName' => '10 dir']);

    $this->assertExists('a/10 dir/x.yml');
    $this->assertExists('b/10 dir/y.yml');
  }

  public function testMoveKeepsTheNameAndColor() : void
  {
    $this->write('a/style.yml', 'content: style');
    $this->write('a/post.yml', "content: |\n  {{ include: \"style\" }}\n");
    $this->write('a/.sys/ninja.json', '{"fileColors": {"style.yml": "red"}}');

    $proposal = $this->proposeAndApply('item_move', ['path' => 'style.yml', 'toFolder' => 'Archive']);

    $this->assertSame([], $proposal['warnings']);                        // includes go by name
    $this->assertExists('a/Archive/style.yml');
    $this->assertSame(['fileColors' => ['style.yml' => 'red']], json_decode($this->read('a/Archive/.sys/ninja.json'), true));
    $this->assertRefused('A folder cannot be moved into itself', 'item_move', ['path' => 'Archive', 'toFolder' => 'Archive/sub']);
    $this->assertRefused('Archive/style.yml is there already', 'item_move', ['path' => 'Archive/style.yml', 'toFolder' => 'Archive']);
  }

  public function testColor() : void
  {
    $this->write('a/dir/x.yml', 'content: x');
    $this->write('b/dir/y.yml', 'content: y');

    $proposal = $this->proposeAndApply('item_color', ['path' => 'dir', 'color' => 'red']);

    $this->assertSame(['field' => 'color', 'before' => '', 'after' => 'red'], $proposal['preview'][0]);
    $this->assertSame('{"color":"red"}', str_replace([" ", "\n"], '', $this->read('a/dir/.sys/ninja.json')));
    $this->assertSame('{"color":"red"}', str_replace([" ", "\n"], '', $this->read('b/dir/.sys/ninja.json')));
    $this->assertRefused('Unknown color pink. The colors are: red, blue', 'item_color', ['path' => 'dir', 'color' => 'pink']);
    $this->assertRefused('dir has this color already', 'item_color', ['path' => 'dir', 'color' => 'red']);
  }

  public function testSharedSourceWarning() : void
  {
    $settings = ['dataPaths' => ['Test' => ['A' => $this->a, 'B' => $this->b], 'Dev' => ['A' => $this->a]]];
    $this->write('a/x.yml', 'content: x');

    $this->assertSame(['In the source A, which the data sets Dev use too'], $this->propose('snippet_update', ['path' => 'x.yml', 'fields' => ['short' => 's']], $settings)['warnings']);
  }

  public function testUnmergedFoldersUseTheSourceTheTreeShows() : void
  {
    $settings = ['nav' => ['foldersMerged' => false]];
    $this->write('a/x.yml', 'content: a');
    $this->write('b/x.yml', 'content: b');

    $this->assertSame('B', $this->propose('snippet_update', ['path' => 'x.yml', 'fields' => ['short' => 's']], $settings)['source']);
  }
}
