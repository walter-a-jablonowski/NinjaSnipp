<?php

namespace SnippetManager\Tests;

use Symfony\Component\Yaml\Yaml;

class SnippetStoreTest extends TestCase
{
  private function yml( array $data ) : array
  {
    return array_merge(['_type' => 'yml', '_name' => 'x'], $data);
  }

  // --- load ---

  public function testLoadYml() : void
  {
    $this->write('a/sub/x.yml', "sc: xx\nusage:\n  vars:\n    name: The name\ncontent: \"Hi {{ name }}\"\n");

    $snippet = $this->manager()->snippets->load('sub/x.yml');

    $this->assertSame('yml', $snippet['_type']);
    $this->assertSame('x', $snippet['_name']);
    $this->assertSame('Hi {{ name }}', $snippet['content']);
    $this->assertSame(['vars' => ['name' => 'The name']], $snippet['usage']);
  }

  public function testLoadMd() : void
  {
    $this->write('a/doc.md', "# Title\n");

    $this->assertSame(['_type' => 'md', '_name' => 'doc', 'content' => "# Title\n"], $this->manager()->snippets->load('doc.md'));
  }

  public function testLoadPicksLastSourceUnlessOneIsGiven() : void
  {
    $this->write('a/x.yml', 'content: a');
    $this->write('b/x.yml', 'content: b');
    $snippets = $this->manager()->snippets;

    $this->assertSame('b', $snippets->load('x.yml')['content']);
    $this->assertSame('a', $snippets->load('x.yml', $this->a)['content']);
    $this->assertNull($snippets->load('x.yml', "{$this->root}/other"));
  }

  public function testLoadEdgeCases() : void
  {
    $this->write('a/empty.yml', '');
    $this->write('a/broken.yml', "content: [unclosed\n");
    $this->write('a/meta.yml', "_type: md\ncontent: x\n");
    $this->write('a/notes.txt', 'x');
    $snippets = $this->manager()->snippets;

    $this->assertSame(['_type' => 'yml', '_name' => 'empty'], $snippets->load('empty.yml'));
    $this->assertNull($snippets->load('broken.yml'));
    $this->assertSame('yml', $snippets->load('meta.yml')['_type']);     // meta keys are never taken from the file
    $this->assertNull($snippets->load('notes.txt'));
    $this->assertNull($snippets->load('missing.yml'));
    $this->assertNull($snippets->load('../a/empty.yml'));
  }

  // --- save ---

  public function testSaveWritesKeysInDocumentedOrderWithoutMetaKeys() : void
  {
    $saved = $this->manager()->snippets->save('x.yml', $this->yml([
      'content' => "line 1\nline 2\n", 'custom' => 1, 'usage' => "head: Hi\n", 'sc' => 'x', 'id' => '7'
    ]));

    $this->assertSame(['id', 'sc', 'usage', 'content', 'custom'], array_keys(Yaml::parse($this->read('a/x.yml'))));
    $this->assertStringContainsString("content: |\n  line 1\n  line 2\n", $this->read('a/x.yml'));
    $this->assertSame(['head' => 'Hi'], $saved['usage']);
    $this->assertSame('x', $saved['_name']);
  }

  // The editor posts usage structured, as it came with the loaded snippet
  public function testStructuredUsageSurvivesRoundTrip() : void
  {
    $usage = ['head' => "Some text\nwith: colon\n", 'maybe' => ['opt' => ''], 'vars' => ['name' => 'A: b'], 'text' => "Last\n", 'custom' => 'kept'];
    $this->write('a/x.yml', Yaml::dump(['usage' => $usage, 'content' => 'c']));
    $snippets = $this->manager()->snippets;

    $snippets->save('x.yml', $snippets->load('x.yml'));

    $this->assertSame($usage, $snippets->load('x.yml')['usage']);
  }

  public function testProseUsageAndEmptyUsage() : void
  {
    $snippets = $this->manager()->snippets;

    $this->assertSame('Just some prose', $snippets->save('p.yml', $this->yml(['usage' => 'Just some prose', 'content' => 'c']))['usage']);
    $this->assertSame('', $snippets->save('e.yml', $this->yml(['usage' => "  \n", 'content' => 'c']))['usage']);
  }

  public function testInvalidUsageLeavesFileUntouched() : void
  {
    $this->write('a/x.yml', "content: original\n");

    try {
      $this->manager()->snippets->save('x.yml', $this->yml(['usage' => 'a: [unclosed', 'content' => 'new']));
      $this->fail('Expected an exception');
    }
    catch( \RuntimeException $e ) {
      $this->assertStringStartsWith('Usage is not valid YAML', $e->getMessage());
    }

    $this->assertSame("content: original\n", $this->read('a/x.yml'));
  }

  public function testSaveMd() : void
  {
    $saved = $this->manager()->snippets->save('doc.md', ['_type' => 'md', '_name' => 'doc', 'content' => "# Hi\n"]);

    $this->assertSame("# Hi\n", $this->read('a/doc.md'));
    $this->assertSame(['_type' => 'md', '_name' => 'doc', 'content' => "# Hi\n"], $saved);
  }

  public function testSaveTarget() : void
  {
    $this->write('b/x.yml', 'content: b');
    $this->write('b/onlyB/y.yml', 'content: y');
    $snippets = $this->manager()->snippets;

    $snippets->save('x.yml', $this->yml(['content' => 'updated']));
    $snippets->save('onlyB/new.yml', $this->yml(['content' => 'new']));
    $snippets->save('there.yml', $this->yml(['content' => 't']), $this->b);

    $this->assertStringContainsString('updated', $this->read('b/x.yml'));   // where the file lives
    $this->assertMissing('a/x.yml');
    $this->assertExists('b/onlyB/new.yml');                                // where its folder lives
    $this->assertMissing('a/onlyB');
    $this->assertExists('b/there.yml');                                    // explicit source
  }

  public function testCreateOnlyNeverOverwrites() : void
  {
    $this->write('a/x.yml', "content: original\n");

    $this->expectExceptionMessage('A snippet with this name already exists');
    try {
      $this->manager()->snippets->save('x.yml', $this->yml(['content' => 'new']), null, true);
    }
    finally {
      $this->assertSame("content: original\n", $this->read('a/x.yml'));
    }
  }

  /** @dataProvider invalidSaves */
  public function testInvalidSaves( string $path, array $data, ?string $base ) : void
  {
    $this->expectException(\RuntimeException::class);
    $this->manager()->snippets->save($path, $data, $base === null ? null : $this->root . $base);
  }

  public function invalidSaves() : array
  {
    return [
      'unsafe path'    => ['../x.yml', ['_type' => 'yml', 'content' => 'x'], null],
      'empty path'     => ['', ['_type' => 'yml', 'content' => 'x'], null],
      'unknown type'   => ['x.txt', ['_type' => 'txt', 'content' => 'x'], null],
      'unknown source' => ['x.yml', ['_type' => 'yml', 'content' => 'x'], '/other']
    ];
  }

  // --- delete / duplicate ---

  public function testDeleteRemovesFileAndItsColor() : void
  {
    $this->write('a/x.yml');
    $this->write('b/x.yml');
    $this->write('a/.sys/ninja.json', '{"fileColors": {"x.yml": "red"}}');

    $this->manager()->snippets->delete('x.yml', $this->a);

    $this->assertMissing('a/x.yml');
    $this->assertExists('b/x.yml');
    $this->assertSame([], json_decode($this->read('a/.sys/ninja.json'), true));
  }

  public function testDeleteMissingFails() : void
  {
    $this->expectExceptionMessage('Failed to delete snippet');
    $this->manager()->snippets->delete('missing.yml');
  }

  public function testDuplicateStaysInItsSource() : void
  {
    $this->write('a/x.yml', "sc: s\ncontent: from a\n");
    $this->write('b/x.yml', "content: from b\n");

    $this->manager()->snippets->duplicate('x.yml', 'copy.yml', $this->a);

    $this->assertSame(['sc' => 's', 'content' => 'from a'], Yaml::parse($this->read('a/copy.yml')));
    $this->assertMissing('b/copy.yml');
  }

  public function testDuplicateNeverOverwrites() : void
  {
    $this->write('a/x.yml', "content: x\n");
    $this->write('a/taken.yml', "content: taken\n");

    $this->expectExceptionMessage('A snippet with this name already exists');
    try {
      $this->manager()->snippets->duplicate('x.yml', 'taken.yml');
    }
    finally {
      $this->assertSame("content: taken\n", $this->read('a/taken.yml'));
    }
  }

  public function testDuplicateMissingSourceFails() : void
  {
    $this->expectExceptionMessage('Failed to duplicate snippet');
    $this->manager()->snippets->duplicate('missing.yml', 'copy.yml');
  }
}
