<?php

namespace SnippetManager\Tests;

class ColorStoreTest extends TestCase
{
  public function testPalettes() : void
  {
    $colors = $this->manager()->colors;

    $this->assertSame(['red' => '#fdd', 'blue' => '#ddf'], $colors->getPalette('light'));
    $this->assertSame(['red' => '#500'], $colors->getPalette('dark'));
    $this->assertSame('#fdd', $colors->resolve('red'));
    $this->assertSame('#abc', $colors->resolve('#abc'));
    $this->assertNull($colors->resolve('unknown'));
    $this->assertNull($colors->resolve(null));
  }

  public function testDarkThemeUsesDarkPalette() : void
  {
    $colors = $this->manager(['theme' => 'dark'])->colors;

    $this->assertSame('#500', $colors->resolve('red'));
  }

  public function testDarkPaletteFallsBackToLight() : void
  {
    $colors = $this->manager(['folderColorsDark' => null])->colors;

    $this->assertSame(['red' => '#fdd', 'blue' => '#ddf'], $colors->getPalette('dark'));
  }

  public function testFolderColor() : void
  {
    $this->write('a/dir/x.yml');
    $this->write('b/dir/y.yml');
    $colors = $this->manager()->colors;

    $colors->setFolderColor('dir', 'red', $this->a);
    $this->assertSame('red', $colors->getFolderColor("{$this->a}/dir"));
    $this->assertNull($colors->getFolderColor("{$this->b}/dir"));

    $colors->setFolderColor('dir', 'blue');                 // no source: last one wins
    $this->assertSame('blue', $colors->getFolderColor("{$this->b}/dir"));

    $colors->setFolderColor('dir', null, $this->a);
    $this->assertSame([], json_decode($this->read('a/dir/.sys/ninja.json'), true));
  }

  public function testFileColor() : void
  {
    $this->write('a/x.yml');
    $colors = $this->manager()->colors;

    $colors->setFileColor('x.yml', 'red');
    $this->assertSame('red', $colors->getFileColor($this->a, 'x.yml'));
    $this->assertSame(['fileColors' => ['x.yml' => 'red']], json_decode($this->read('a/.sys/ninja.json'), true));

    $colors->setFileColor('x.yml', null);
    $this->assertSame([], json_decode($this->read('a/.sys/ninja.json'), true));
  }

  public function testColorOfMissingItemFails() : void
  {
    $this->expectExceptionMessage('Failed to write file color');
    $this->manager()->colors->setFileColor('missing.yml', 'red');
  }

  public function testMoveFileColorKeepsOtherEntries() : void
  {
    $this->write('a/.sys/ninja.json', '{"color": "red", "fileColors": {"x.yml": "blue", "y.yml": "red"}}');
    $colors = $this->manager()->colors;

    $colors->moveFileColor($this->a, 'x.yml', 'z.yml');
    $colors->moveFileColor($this->a, 'y.yml', null);
    $colors->moveFileColor($this->a, 'nope.yml', 'n.yml');   // no entry: nothing happens

    $this->assertSame(['color' => 'red', 'fileColors' => ['z.yml' => 'blue']], json_decode($this->read('a/.sys/ninja.json'), true));
  }
}
