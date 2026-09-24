<?php

namespace SnippetManager\Tests;

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
    $user      = new UserStore("{$this->root}/user");
    $appConfig = ['special' => false];

    $this->handlers = array_merge(
      require self::APP_DIR . '/ajax/files.php',
      require self::APP_DIR . '/ajax/snippets.php',
      require self::APP_DIR . '/ajax/user.php'
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
      'data' => ['_type' => 'yml', '_name' => 'x', 'usage' => "head: Hi\n", 'content' => 'c'],
      'createOnly' => true
    ]);

    $this->assertTrue($response['success']);
    $this->assertSame(['head' => 'Hi'], $response['snippet']['usage']);
    $this->assertSame('c', $this->call('loadSnippet', ['path' => 'x.yml'])['snippet']['content']);
  }

  public function testFailuresAreThrownForTheRouter() : void
  {
    $this->expectExceptionMessage('A snippet with this name already exists');

    $this->write('a/x.yml', 'content: x');
    $this->call('saveSnippet', ['path' => 'x.yml', 'data' => ['_type' => 'yml', 'content' => 'y'], 'createOnly' => true]);
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
}
