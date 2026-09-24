<?php

namespace SnippetManager\Tests;

use SnippetManager\FileTree;

class FileTreeTest extends TestCase
{
  public function testListsSnippetsAndFoldersOnly() : void
  {
    $this->write('a/x.yml');
    $this->write('a/y.md');
    $this->write('a/notes.txt');
    $this->write('a/sub/z.yml');
    $this->write('a/.sys/ninja.json', '{}');

    $items = $this->manager()->tree->listFiles();

    $this->assertSame(['sub', 'x.yml', 'y.md'], $this->names($items));
    $this->assertSame('x', $items[1]['name']);
    $this->assertSame('yml', $items[1]['extension']);
    $this->assertSame($this->a, $items[1]['basePath']);
  }

  public function testSubFolderLevel() : void
  {
    $this->write('a/sub/z.yml');
    $this->write('b/sub/w.yml');

    $this->assertSame(['sub/w.yml', 'sub/z.yml'], $this->names($this->manager()->tree->listFiles('sub')));
  }

  public function testSortOrder() : void
  {
    $this->write('a/b.yml');
    $this->write('a/C.yml');
    $this->write('a/a dir/x.yml');
    $this->write('b/z dir/x.yml');

    $mixed        = $this->manager()->tree->listFiles();
    $foldersFirst = $this->manager(['nav' => ['foldersFirst' => true]])->tree->listFiles();

    $this->assertSame(['a dir', 'b.yml', 'C.yml', 'z dir'], $this->names($mixed));   // case-insensitive
    $this->assertSame(['a dir', 'z dir', 'b.yml', 'C.yml'], $this->names($foldersFirst));
  }

  public function testNotMergedLastSourceWins() : void
  {
    $this->write('a/x.yml');
    $this->write('b/x.yml');
    $this->write('a/dir/1.yml');
    $this->write('b/dir/2.yml');

    $items = $this->manager(['nav' => ['foldersMerged' => false]])->tree->listFiles();

    $this->assertSame(['dir', 'x.yml'], $this->names($items));
    $this->assertSame($this->b, $items[1]['basePath']);
    $this->assertArrayNotHasKey('mergedBases', $items[0]);
  }

  public function testMergedShowsDuplicateFilesAndOneFolder() : void
  {
    $this->write('a/x.yml');
    $this->write('b/x.yml');
    $this->write('a/dir/1.yml');
    $this->write('b/dir/2.yml');

    $items = $this->manager()->tree->listFiles();

    $this->assertSame(['dir', 'x.yml', 'x.yml#1'], $this->names($items));
    $this->assertSame([$this->a, $this->b], $items[0]['mergedBases']);
    $this->assertSame($this->a, $items[1]['basePath']);
    $this->assertSame('x.yml', $items[2]['fsPath']);
    $this->assertSame($this->b, $items[2]['basePath']);
  }

  /** @dataProvider linkNames */
  public function testLinkTarget( string $fileName, ?string $target ) : void
  {
    $this->assertSame($target, FileTree::linkTarget($fileName));
  }

  public function linkNames() : array
  {
    return [
      'plain'          => ['INCLUDE common', 'common'],
      'ordinal prefix' => ['11 INCLUDE common', 'common'],
      'spaces'         => ['INCLUDE  my folder ', 'my folder'],
      'not a link'     => ['INCLUDEs and notes.yml', null],
      'no target'      => ['INCLUDE ', null],
      'lower case'     => ['include common', null]
    ];
  }

  public function testLinksShowTheirTarget() : void
  {
    $this->write('a/shared/s.yml');
    $this->write('b/common.md', '# c');                 // target in another source
    $this->write('b/sub/10 INCLUDE shared');
    $this->write('b/sub/INCLUDE common');
    $this->write('b/sub/INCLUDE missing');

    $items = $this->manager()->tree->listFiles('sub');

    $this->assertSame(['sub/common.md', 'sub/shared'], $this->names($items));
    $this->assertSame('common.md', $items[0]['fsPath']);
    $this->assertTrue($items[0]['isIncluded']);
    $this->assertSame('folder', $items[1]['type']);
    $this->assertSame('shared', $items[1]['fsPath']);
    $this->assertSame($this->b, $items[1]['basePath']);   // the source holding the marker
  }

  public function testLinkPrefersMarkerSource() : void
  {
    $this->write('a/t.yml', 'content: a');
    $this->write('b/t.yml', 'content: b');
    $this->write('a/sub/INCLUDE t');

    $item = $this->manager()->tree->listFiles('sub')[0];

    $this->assertSame('sub/t.yml', $item['path']);
    $this->assertSame($this->a, $item['basePath']);
  }

  public function testColors() : void
  {
    $this->write('a/dir/x.yml');
    $this->write('a/dir/.sys/ninja.json', '{"color": "red"}');
    $this->write('a/y.yml');
    $this->write('a/.sys/ninja.json', '{"fileColors": {"y.yml": "#123456"}}');

    [$dir, $file] = $this->manager()->tree->listFiles();

    $this->assertSame(['red', '#fdd'], [$dir['colorName'], $dir['color']]);
    $this->assertSame('#123456', $file['color']);           // legacy hex value
  }

  public function testRejectsUnsafeSubPath() : void
  {
    $this->write('x.yml');

    $this->assertSame([], $this->manager()->tree->listFiles('..'));
  }

  public function testWalkVisitsEachFolderOnceDespiteLinkCycles() : void
  {
    $this->write('a/top/x.yml');
    $this->write('a/top/INCLUDE top');      // a link to its own ancestor

    $seen = [];
    $this->manager()->tree->walk( function( $item, $fsPath ) use ( &$seen ) {
      $seen[] = $fsPath;
    });

    $this->assertSame(['top', 'top', 'top/x.yml'], $seen);
  }

  public function testWalkStops() : void
  {
    $this->write('a/1.yml');
    $this->write('a/2.yml');

    $seen = [];
    $this->manager()->tree->walk( function( $item, $fsPath ) use ( &$seen ) {
      $seen[] = $fsPath;
      return true;
    });

    $this->assertSame(['1.yml'], $seen);
  }
}
