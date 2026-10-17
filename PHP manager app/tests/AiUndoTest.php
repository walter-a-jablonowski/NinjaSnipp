<?php

namespace SnippetManager\Tests;

use SnippetManager\Ai\AiChanges;
use SnippetManager\Ai\AiLibrary;
use SnippetManager\Ai\AiUndo;

// Undo per answer: changes applied through AiChanges with a checkpoint, then taken back
class AiUndoTest extends TestCase
{
  private function undo() : AiUndo
  {
    return new AiUndo("{$this->root}/user/ai_undo");
  }

  // Proposes and applies a change under the checkpoint, as the sidebar's Accept does
  private function accept( string $tool, array $args, string $checkpoint = 'cp_1' ) : void
  {
    $proposal = (new AiChanges( new AiLibrary( $this->manager())))->propose('c', $tool, $args);
    (new AiChanges( new AiLibrary( $this->manager())))->apply($proposal, $this->undo(), $checkpoint);
  }

  public function testUndoAllChangesOfAnAnswer() : void
  {
    $this->write('a/edit.yml', "content: old\n");
    $this->write('a/gone.yml', "content: gone\n");
    $this->write('a/.sys/ninja.json', '{"fileColors": {"gone.yml": "red", "move.yml": "blue"}}');
    $this->write('a/move.yml', "content: m\n");
    $before = $this->read('a/edit.yml');

    $this->accept('snippet_update', ['path' => 'edit.yml', 'fields' => ['content' => 'new']]);
    $this->accept('snippet_create', ['path' => 'new.yml', 'fields' => ['content' => 'n'], 'source' => 'A']);
    $this->accept('snippet_delete', ['path' => 'gone.yml']);
    $this->accept('folder_create', ['path' => 'Archive', 'source' => 'A']);
    $this->accept('item_move', ['path' => 'move.yml', 'toFolder' => 'Archive']);
    $this->accept('item_color', ['path' => 'edit.yml', 'color' => 'blue']);

    $this->assertExists('a/Archive/move.yml');
    $this->assertMissing('a/gone.yml');

    $result = $this->undo()->undo('cp_1');

    $this->assertSame([], $result['skipped']);
    $this->assertSame($before, $this->read('a/edit.yml'));
    $this->assertMissing('a/new.yml');
    $this->assertSame("content: gone\n", $this->read('a/gone.yml'));
    $this->assertExists('a/move.yml');
    $this->assertDirectoryDoesNotExist("{$this->a}/Archive");
    $this->assertSame(['fileColors' => ['gone.yml' => 'red', 'move.yml' => 'blue']], json_decode($this->read('a/.sys/ninja.json'), true));
  }

  public function testAChangeMadeSinceIsKept() : void
  {
    $this->write('a/x.yml', "content: old\n");
    $this->accept('snippet_update', ['path' => 'x.yml', 'fields' => ['content' => 'ai']]);

    $this->write('a/x.yml', "content: user\n");             // edited after the AI's change
    $result = $this->undo()->undo('cp_1');

    $this->assertSame(["{$this->a}/x.yml"], $result['skipped']);
    $this->assertSame("content: user\n", $this->read('a/x.yml'));
  }

  public function testAFolderThatGotContentStays() : void
  {
    $this->accept('folder_create', ['path' => 'New', 'source' => 'A']);
    $this->write('a/New/mine.yml', 'content: x');

    $this->undo()->undo('cp_1');

    $this->assertExists('a/New/mine.yml');
  }

  public function testCheckpointsAreSeparateAndUsedOnce() : void
  {
    $this->write('a/x.yml', "content: one\n");
    $this->accept('snippet_update', ['path' => 'x.yml', 'fields' => ['content' => 'two']], 'cp_1');
    $this->accept('snippet_update', ['path' => 'x.yml', 'fields' => ['short' => 's']], 'cp_2');

    $this->undo()->undo('cp_2');                               // the later answer only
    $this->assertSame('two', $this->manager()->snippets->load('x.yml')['content']);
    $this->assertArrayNotHasKey('short', $this->manager()->snippets->load('x.yml'));

    $this->expectExceptionMessage('Nothing to undo');
    $this->undo()->undo('cp_2');
  }

  public function testAFailedChangeRecordsNothing() : void
  {
    $undo = $this->undo();

    try {
      $undo->record('cp_1', ['files' => []], function() { throw new \RuntimeException('failed'); });
    }
    catch( \RuntimeException $e ) {
    }

    $this->expectExceptionMessage('Nothing to undo');
    $undo->undo('cp_1');
  }

  public function testInvalidCheckpoint() : void
  {
    $this->expectExceptionMessage('Invalid undo checkpoint');
    $this->undo()->undo('../x');
  }
}
