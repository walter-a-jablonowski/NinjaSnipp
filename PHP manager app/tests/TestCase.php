<?php

namespace SnippetManager\Tests;

use SnippetManager\SnippetManager;

// Every test runs against a fresh temporary data set "Test" with two sources:
//   A  <root>/a   (first source)
//   B  <root>/b   (second source, wins for paths that exist in both)
abstract class TestCase extends \PHPUnit\Framework\TestCase
{
  protected string $root;
  protected string $a;
  protected string $b;

  protected function setUp() : void
  {
    $this->root = str_replace('\\', '/', sys_get_temp_dir()) . '/ninja_test_' . bin2hex(random_bytes(4));
    $this->a    = "{$this->root}/a";
    $this->b    = "{$this->root}/b";

    mkdir($this->a, 0755, true);
    mkdir($this->b, 0755, true);
  }

  protected function tearDown() : void
  {
    $this->remove($this->root);
  }

  protected function manager( array $settings = [] ) : SnippetManager
  {
    $defaults = [
      'dataPaths'        => ['Test' => ['A' => $this->a, 'B' => $this->b]],
      'nav'              => ['foldersMerged' => true, 'foldersFirst' => false],
      'render'           => ['includedSameIndent' => true, 'highlightInclude' => false],
      'theme'            => 'light',
      'folderColors'     => ['red' => '#fdd', 'blue' => '#ddf'],
      'folderColorsDark' => ['red' => '#500']
    ];

    return new SnippetManager( array_replace_recursive($defaults, $settings), $this->root);
  }

  // Writes a file (and its folders) below the temp root, e.g. write('a/sub/x.yml', 'content: x')
  protected function write( string $relativePath, string $content = '' ) : string
  {
    $path = "{$this->root}/$relativePath";
    if( ! is_dir(dirname($path)) )
      mkdir(dirname($path), 0755, true);
    file_put_contents($path, $content);
    return $path;
  }

  protected function read( string $relativePath ) : string
  {
    return file_get_contents("{$this->root}/$relativePath");
  }

  protected function assertExists( string $relativePath ) : void
  {
    $this->assertFileExists("{$this->root}/$relativePath");
  }

  protected function assertMissing( string $relativePath ) : void
  {
    $this->assertFileDoesNotExist("{$this->root}/$relativePath");
  }

  // Names of the items of one tree level, in listing order
  protected function names( array $items ) : array
  {
    return array_column($items, 'path');
  }

  private function remove( string $path ) : void
  {
    if( ! is_dir($path) )
      return;

    foreach( scandir($path) as $item )
    {
      if( $item === '.' || $item === '..' )
        continue;
      is_dir("$path/$item") ? $this->remove("$path/$item") : unlink("$path/$item");
    }

    rmdir($path);
  }
}
