<?php

namespace SnippetManager\Tests;

class FileOperationsTest extends TestCase
{
  // --- folders and links ---

  public function testCreateFolder() : void
  {
    $this->write('b/onlyB/x.yml');
    $files = $this->manager()->files;

    $files->createFolder('top');
    $files->createFolder('onlyB/inner');           // next to its parent, not in the first source
    $files->createFolder('there', $this->b);

    $this->assertDirectoryExists("{$this->a}/top");
    $this->assertDirectoryExists("{$this->b}/onlyB/inner");
    $this->assertMissing('a/onlyB');
    $this->assertDirectoryExists("{$this->b}/there");
  }

  /** @dataProvider invalidFolders */
  public function testCreateFolderFails( string $path, string $message ) : void
  {
    $this->write('a/exists/x.yml');

    $this->expectExceptionMessage($message);
    $this->manager()->files->createFolder($path);
  }

  public function invalidFolders() : array
  {
    return [
      'exists' => ['exists', 'Failed to create folder or folder already exists'],
      'empty'  => ['', 'Invalid folder path'],
      'unsafe' => ['../out', 'Invalid folder path']
    ];
  }

  public function testCreateAndRemoveLink() : void
  {
    $this->write('a/shared.yml');
    $files = $this->manager()->files;

    $files->createLink('sub/INCLUDE shared', $this->b);
    $this->assertSame('', $this->read('b/sub/INCLUDE shared'));

    $this->write('a/sub/05 INCLUDE shared');       // same link with ordinal, other source
    $files->removeLink('sub', 'shared');

    $this->assertMissing('b/sub/INCLUDE shared');
    $this->assertMissing('a/sub/05 INCLUDE shared');
    $this->assertExists('a/shared.yml');           // never the target
  }

  public function testRemoveLinkOnlyInGivenSources() : void
  {
    $this->write('a/INCLUDE t');
    $this->write('b/INCLUDE t');

    $this->manager()->files->removeLink('', 't', [$this->b]);

    $this->assertExists('a/INCLUDE t');
    $this->assertMissing('b/INCLUDE t');
  }

  public function testLinkErrors() : void
  {
    $this->write('a/INCLUDE t');
    $files = $this->manager()->files;

    foreach( [
      'Link already exists' => fn() => $files->createLink('INCLUDE t', $this->a),
      'Missing link path'   => fn() => $files->createLink(''),
      'Invalid link path'   => fn() => $files->createLink('../INCLUDE t'),
      'Link not found'      => fn() => $files->removeLink('', 'other')
    ] as $message => $call )
    {
      try {
        $call();
        $this->fail("Expected: $message");
      }
      catch( \RuntimeException $e ) {
        $this->assertSame($message, $e->getMessage());
      }
    }
  }

  public function testDeleteFolder() : void
  {
    $this->write('a/dir/sub/x.yml');
    $this->write('b/dir/y.yml');
    $files = $this->manager()->files;

    $files->deleteFolder('dir', $this->a);
    $this->assertMissing('a/dir');
    $this->assertExists('b/dir/y.yml');

    $files->deleteFolder('dir');                   // no source: last one wins
    $this->assertMissing('b/dir');
  }

  public function testDeleteFolderNeverDeletesASource() : void
  {
    $this->write('a/x.yml');

    $this->expectException(\RuntimeException::class);
    try {
      $this->manager()->files->deleteFolder('');
    }
    finally {
      $this->assertExists('a/x.yml');
    }
  }

  // --- rename ---

  public function testRenameFileKeepsColor() : void
  {
    $this->write('b/x.yml', 'content: x');
    $this->write('b/.sys/ninja.json', '{"fileColors": {"x.yml": "red"}}');

    $this->manager()->files->rename('x.yml', 'y.yml', [null]);   // found in the source it lives in

    $this->assertExists('b/y.yml');
    $this->assertMissing('b/x.yml');
    $this->assertSame(['fileColors' => ['y.yml' => 'red']], json_decode($this->read('b/.sys/ninja.json'), true));
  }

  public function testRenameMovesIntoNewFolder() : void
  {
    $this->write('a/x.yml');

    $this->manager()->files->rename('x.yml', 'new/dir/x.yml', [$this->a]);

    $this->assertExists('a/new/dir/x.yml');
  }

  public function testRenameMergedFolderInAllSources() : void
  {
    $this->write('a/dir/1.yml');
    $this->write('b/dir/2.yml');

    $this->manager()->files->rename('dir', 'renamed', [$this->a, $this->b]);

    $this->assertExists('a/renamed/1.yml');
    $this->assertExists('b/renamed/2.yml');
  }

  public function testRenameRefusesWhenAnySourceHasTheTarget() : void
  {
    $this->write('a/dir/1.yml');
    $this->write('b/dir/2.yml');
    $this->write('b/renamed/3.yml');

    try {
      $this->manager()->files->rename('dir', 'renamed', [$this->a, $this->b]);
      $this->fail('Expected an exception');
    }
    catch( \RuntimeException $e ) {
      $this->assertSame('Target already exists', $e->getMessage());
    }

    $this->assertExists('a/dir/1.yml');            // nothing was moved
    $this->assertExists('b/dir/2.yml');
  }

  /** @dataProvider invalidRenames */
  public function testRenameFails( string $old, string $new, string $message ) : void
  {
    $this->write('a/x.yml');

    $this->expectExceptionMessage($message);
    $this->manager()->files->rename($old, $new, [null]);
  }

  public function invalidRenames() : array
  {
    return [
      'missing'   => ['nope.yml', 'y.yml', 'Source missing'],
      'empty'     => ['', 'y.yml', 'Invalid parameters'],
      'unsafe'    => ['x.yml', '../y.yml', 'Invalid path']
    ];
  }

  public function testRenameUnknownSourceFails() : void
  {
    $this->write('a/x.yml');

    $this->expectExceptionMessage('Invalid source folder');
    $this->manager()->files->rename('x.yml', 'y.yml', ["{$this->root}/other"]);
  }

  // --- reorder ---

  public function testBatchRenameSwapsNames() : void
  {
    $this->write('a/sub/10 first.yml', 'content: first');
    $this->write('a/sub/20 second.yml', 'content: second');
    $this->write('a/sub/.sys/ninja.json', '{"fileColors": {"10 first.yml": "red"}}');

    $changed = $this->manager()->files->batchRename('sub', [
      ['base' => $this->a, 'oldName' => '10 first.yml',  'newName' => '20 first.yml',  'type' => 'file'],
      ['base' => $this->a, 'oldName' => '20 second.yml', 'newName' => '10 second.yml', 'type' => 'file']
    ]);

    $this->assertTrue($changed);
    $this->assertSame('content: first', $this->read('a/sub/20 first.yml'));
    $this->assertSame('content: second', $this->read('a/sub/10 second.yml'));
    $this->assertSame(['fileColors' => ['20 first.yml' => 'red']], json_decode($this->read('a/sub/.sys/ninja.json'), true));
  }

  public function testBatchRenameUndoesEverythingOnFailure() : void
  {
    $this->write('a/1 x.yml', 'x');
    $this->write('a/2 y.yml', 'y');
    $this->write('a/taken.yml', 't');

    try {
      $this->manager()->files->batchRename('', [
        ['base' => $this->a, 'oldName' => '1 x.yml', 'newName' => '3 x.yml'],
        ['base' => $this->a, 'oldName' => '2 y.yml', 'newName' => 'taken.yml']
      ]);
      $this->fail('Expected an exception');
    }
    catch( \RuntimeException $e ) {
      $this->assertSame('Target exists: taken.yml', $e->getMessage());
    }

    $this->assertSame(['1 x.yml', '2 y.yml', 'taken.yml'], array_values(array_diff(scandir($this->a), ['.', '..'])));
  }

  public function testBatchRenameWithNothingToDo() : void
  {
    $this->assertFalse( $this->manager()->files->batchRename('', [
      ['base' => $this->a, 'oldName' => 'same.yml', 'newName' => 'same.yml']
    ]));
  }

  public function testBatchRenameValidatesInput() : void
  {
    $files = $this->manager()->files;

    foreach( [
      'Invalid base path' => [['base' => "{$this->root}/other", 'oldName' => 'a', 'newName' => 'b']],
      'Invalid name'      => [['base' => $this->a, 'oldName' => 'a', 'newName' => '../b']]
    ] as $message => $ops )
    {
      try {
        $files->batchRename('', $ops);
        $this->fail("Expected: $message");
      }
      catch( \RuntimeException $e ) {
        $this->assertSame($message, $e->getMessage());
      }
    }
  }
}
