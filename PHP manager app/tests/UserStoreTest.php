<?php

namespace SnippetManager\Tests;

use SnippetManager\UserStore;
use Symfony\Component\Yaml\Yaml;

class UserStoreTest extends TestCase
{
  private function store() : UserStore
  {
    return new UserStore("{$this->root}/user");
  }

  public function testMissingFilesAreEmpty() : void
  {
    $store = $this->store();

    $this->assertSame([], $store->getSettings());
    $this->assertSame([], $store->getSearchHistory());
    $this->assertSame([], $store->getRecentSnippets('Any'));
  }

  public function testUpdateSettingsMergesRecursively() : void
  {
    $this->write('user/settings.yml', Yaml::dump(['theme' => 'dark', 'edit' => ['autosave' => false, 'other' => 1]]));

    $merged = $this->store()->updateSettings(['edit' => ['autosave' => true]]);

    $expected = ['theme' => 'dark', 'edit' => ['autosave' => true, 'other' => 1]];
    $this->assertSame($expected, $merged);
    $this->assertSame($expected, $this->store()->getSettings());
  }

  public function testRecentSnippetsArePerDataSet() : void
  {
    $store = $this->store();

    $store->saveRecentSnippets('One', [['path' => 'a.yml']]);
    $store->saveRecentSnippets('Two', [['path' => 'b.yml']]);

    $this->assertSame([['path' => 'a.yml']], $store->getRecentSnippets('One'));
    $this->assertSame([['path' => 'b.yml']], $store->getRecentSnippets('Two'));
  }

  public function testSearchHistory() : void
  {
    $this->store()->saveSearchHistory(['b', 'a']);

    $this->assertSame(['b', 'a'], $this->store()->getSearchHistory());
  }

  public function testCorruptJsonIsEmpty() : void
  {
    $this->write('user/search_history.json', '{broken');

    $this->assertSame([], $this->store()->getSearchHistory());
  }
}
