<?php

namespace SnippetManager\Tests;

use SnippetManager\Ai\AiTools;
use SnippetManager\SnippetManager;
use SnippetManager\UserStore;

// The handler files in /ajax, loaded the way ajax.php loads them
class AjaxHandlersTest extends TestCase
{
  private const APP_DIR = __DIR__ . '/..';

  private SnippetManager $manager;
  private array $handlers;

  protected function setUp() : void
  {
    parent::setUp();

    // Variables the handler files use from ajax.php
    $manager   = $this->manager = $this->manager();
    $userDir   = "{$this->root}/user";
    $user      = new UserStore($userDir);
    $appConfig = ['special' => false];

    $this->handlers = array_merge(
      require self::APP_DIR . '/ajax/files.php',
      require self::APP_DIR . '/ajax/snippets.php',
      require self::APP_DIR . '/ajax/user.php',
      require self::APP_DIR . '/ajax/ai.php'
    );
  }

  private function call( string $action, array $input = [] ) : array
  {
    return $this->handlers[$action]($input + ['action' => $action]);
  }

  public function testEveryActionTheClientCallsHasAHandler() : void
  {
    $actions = [];
    foreach( array_merge( glob(self::APP_DIR . '/*.js'), glob(self::APP_DIR . '/controllers/*.js')) as $file )
    {
      preg_match_all("/apiCall\([^,]+,\s*'([A-Za-z]+)'/", file_get_contents($file), $m);
      $actions = array_merge($actions, $m[1]);
    }

    $this->assertNotEmpty($actions);
    $this->assertSame([], array_values( array_diff( array_unique($actions), array_keys($this->handlers))));
  }

  public function testListFiles() : void
  {
    $this->write('a/x.yml', 'content: x');

    $response = $this->call('listFiles', ['subPath' => '']);

    $this->assertTrue($response['success']);
    $this->assertSame('x.yml', $response['files'][0]['path']);
    $this->assertSame([$this->a => 'A', $this->b => 'B'], $response['baseFolderLabels']);
  }

  public function testSaveReturnsStoredSnippet() : void
  {
    $response = $this->call('saveSnippet', [
      'path' => 'x.yml',
      'data' => ['_type' => 'yml', '_name' => 'x', 'usage' => "head: Hi\n", 'content' => 'c']
    ]);

    $this->assertTrue($response['success']);
    $this->assertSame(['head' => 'Hi'], $response['snippet']['usage']);
    $this->assertSame('c', $this->call('loadSnippet', ['path' => 'x.yml'])['snippet']['content']);
  }

  public function testFailuresAreThrownForTheRouter() : void
  {
    $this->expectExceptionMessage('A snippet with this name already exists');

    $this->write('a/x.yml', 'content: x');
    $this->call('createSnippet', ['path' => 'x.yml']);
  }

  public function testExpectedFailuresAreResponses() : void
  {
    $this->assertSame(['success' => false, 'message' => 'Snippet missing'], $this->call('loadSnippet', ['path' => 'nope.yml']));
    $this->assertSame(['success' => false, 'message' => 'Missing folderPath'], $this->call('setFolderColor', ['color' => 'red']));
    $this->assertSame(['success' => false, 'message' => 'Invalid data path'], $this->call('setDataPath', ['dataPath' => 'Nope']));
    $this->assertSame(['success' => false, 'message' => 'Not available'], $this->call('openInExplorer', ['path' => 'x.yml']));
  }

  public function testRenameWithOneOrSeveralSources() : void
  {
    $this->write('b/x.yml');
    $this->write('a/dir/1.yml');
    $this->write('b/dir/2.yml');

    $this->assertTrue( $this->call('renameItem', ['oldPath' => 'x.yml', 'newPath' => 'y.yml', 'basePath' => $this->b])['success']);
    $this->assertTrue( $this->call('renameItem', ['oldPath' => 'dir', 'newPath' => 'moved', 'bases' => [$this->a, $this->b]])['success']);

    $this->assertExists('b/y.yml');
    $this->assertExists('a/moved/1.yml');
    $this->assertExists('b/moved/2.yml');
  }

  public function testBatchRenameMessage() : void
  {
    $this->assertSame(['success' => true, 'message' => 'Nothing to reorder'], $this->call('batchRename', ['subPath' => '', 'ops' => []]));
  }

  public function testColorsCanBeCleared() : void
  {
    $this->write('a/x.yml');

    $this->call('setFileColor', ['filePath' => 'x.yml', 'color' => 'red']);
    $this->call('setFileColor', ['filePath' => 'x.yml', 'color' => '']);

    $this->assertNull( $this->manager->colors->getFileColor($this->a, 'x.yml'));
  }

  public function testUserData() : void
  {
    $this->call('saveRecentSnippets', ['data' => [['path' => 'x.yml']]]);
    $this->call('setUserSettings', ['settings' => ['theme' => 'dark']]);

    $this->assertSame([['path' => 'x.yml']], $this->call('getRecentSnippets')['data']);
    $this->assertSame('dark', $this->call('getUserSettings')['settings']['theme']);
    $this->assertSame(['red' => '#500'], $this->call('getFolderColors', ['themeMode' => 'dark'])['colors']);
  }

  // --- AI ---

  public function testAiChatNeedsAUserLine() : void
  {
    $this->expectExceptionMessage('Nothing to answer');
    $this->call('aiChat', ['messages' => [['role' => 'assistant', 'content' => 'Hi'], ['role' => 'system', 'content' => 'x']]]);
  }

  public function testAiApplyRunsAnAcceptedProposal() : void
  {
    $this->write('a/x.yml', 'content: old');
    $proposal = (new AiTools($this->manager, new UserStore("{$this->root}/user")))
      ->call('c1', 'snippet_update', ['path' => 'x.yml', 'fields' => ['content' => 'new']])['proposal'];

    $response = $this->call('aiApply', ['proposal' => json_decode( json_encode($proposal), true), 'checkpoint' => 'cp_t']);

    $this->assertSame(['success' => true, 'paths' => ['x.yml']], $response);
    $this->assertSame('new', $this->manager->snippets->load('x.yml')['content']);

    $this->write('a/x.yml', 'content: changed by the user');
    $this->assertSame(['success' => true, 'restored' => 0, 'skipped' => ['A: x.yml']], $this->call('aiUndo', ['checkpoint' => 'cp_t']));
  }

  public function testAiSessions() : void
  {
    $saved = $this->call('aiSessionSave', ['session' => ['title' => 'First', 'messages' => [['role' => 'user', 'content' => 'Hi']], 'dataSet' => 'ignored']])['session'];

    $this->assertSame('Test', $saved['dataSet']);                 // the data set it is held in
    $this->assertSame([['id' => $saved['id'], 'title' => 'First', 'updated' => $saved['updated']]], $this->call('aiSessions')['sessions']);
    $this->assertSame('Hi', $this->call('aiSessionLoad', ['id' => $saved['id']])['session']['messages'][0]['content']);

    $again = $this->call('aiSessionSave', ['session' => ['id' => $saved['id'], 'title' => 'Renamed']])['session'];
    $this->assertSame($saved['created'], $again['created']);

    $this->call('aiSessionDelete', ['id' => $saved['id']]);
    $this->assertSame([], $this->call('aiSessions')['sessions']);

    $this->expectExceptionMessage('Invalid session id');
    $this->call('aiSessionLoad', ['id' => '../settings']);
  }
}
