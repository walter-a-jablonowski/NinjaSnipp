<?php

namespace SnippetManager\Tests;

use SnippetManager\Sources;

class SourcesTest extends TestCase
{
  public function testConfigFormats() : void
  {
    $sources = new Sources([
      'Single'  => 'a',
      'Labeled' => ['First' => 'a', 'Second' => 'b'],
      'Legacy'  => ['a' => '#ff0000', 'b' => null],
      'c'
    ], $this->root);

    $sets = $sources->getDataSets();

    $this->assertSame(['Single', 'Labeled', 'Legacy', "{$this->root}/c"], array_keys($sets));
    $this->assertSame("{$this->root}/a", $sets['Single'][0]['path']);
    $this->assertSame('Second', $sets['Labeled'][1]['subLabel']);
    $this->assertSame('#ff0000', $sets['Legacy'][0]['color']);
  }

  public function testFallsBackToDataFolder() : void
  {
    $sources = new Sources([], $this->root);

    $this->assertSame(['data'], array_keys($sources->getDataSets()));
    $this->assertDirectoryExists("{$this->root}/data");
  }

  public function testSelect() : void
  {
    $sources = new Sources(['One' => 'a', 'Two' => ['X' => 'b', 'Y' => 'new']], $this->root);

    $this->assertSame('One', $sources->getCurrentLabel());
    $this->assertFalse($sources->select('Missing'));
    $this->assertSame('One', $sources->getCurrentLabel());

    $this->assertTrue($sources->select('Two'));
    $this->assertSame(["{$this->b}", "{$this->root}/new"], $sources->getPaths());
    $this->assertSame(["{$this->b}" => 'X', "{$this->root}/new" => 'Y'], $sources->getLabels());
    $this->assertDirectoryExists("{$this->root}/new");           // created for the selected set only
  }

  public function testLabelFallsBackToDataSetName() : void
  {
    $sources = new Sources(['Plain' => 'a'], $this->root);

    $this->assertSame(["{$this->a}" => 'Plain'], $sources->getLabels());
  }

  /** @dataProvider relativePaths */
  public function testIsSafeRelativePath( string $path, bool $safe ) : void
  {
    $this->assertSame($safe, $this->manager()->sources->isSafeRelativePath($path));
  }

  public function relativePaths() : array
  {
    return [
      'empty'          => ['', true],
      'file'           => ['x.yml', true],
      'nested'         => ['sub/x.yml', true],
      'dots in name'   => ['a..b.yml', true],
      'parent'         => ['../x.yml', false],
      'nested parent'  => ['sub/../../x', false],
      'backslash'      => ['sub\\..\\x', false],
      'unix absolute'  => ['/etc/passwd', false],
      'drive absolute' => ['C:/x', false],
      'null byte'      => ["x\0.yml", false]
    ];
  }

  public function testKnownBase() : void
  {
    $sources = $this->manager()->sources;

    $this->assertTrue($sources->isKnownBase($this->b));
    $this->assertTrue($sources->isKnownBase("{$this->b}/"));
    $this->assertFalse($sources->isKnownBase("{$this->root}/other"));
    $this->assertSame($this->a, $sources->resolveBasePath(null));
    $this->assertNull($sources->resolveBasePath("{$this->root}/other"));
  }

  public function testWritePathPrefersItemThenParentThenFirst() : void
  {
    $this->write('a/both.yml');
    $this->write('b/both.yml');
    $this->write('b/onlyB/x.yml');
    $sources = $this->manager()->sources;

    $this->assertSame($this->b, $sources->resolveWritePath('both.yml'));        // last source wins
    $this->assertSame($this->b, $sources->resolveWritePath('onlyB/new.yml'));   // where the parent is
    $this->assertSame($this->a, $sources->resolveWritePath('new.yml'));         // first source
    $this->assertSame($this->a, $sources->resolveWritePath('nowhere/new.yml'));
  }

  public function testTargetBaseRejectsUnknownSource() : void
  {
    $this->expectException(\RuntimeException::class);
    $this->manager()->sources->resolveTargetBase("{$this->root}/other", 'x.yml');
  }

  public function testPhysicalPath() : void
  {
    $this->write('a/x.yml');
    $this->write('b/x.yml');
    $this->write('a/dir/y.yml');
    $sources = $this->manager()->sources;

    $this->assertSame("{$this->b}/x.yml", $sources->resolvePhysicalPath('x.yml'));
    $this->assertSame("{$this->a}/x.yml", $sources->resolvePhysicalPath('x.yml', 'file', $this->a));
    $this->assertSame("{$this->a}/dir", $sources->resolvePhysicalPath('dir', 'folder'));
    $this->assertNull($sources->resolvePhysicalPath('dir', 'file'));
    $this->assertNull($sources->resolvePhysicalPath('x.yml', 'file', "{$this->root}/other"));
    $this->assertNull($sources->resolvePhysicalPath('../a/x.yml'));
  }
}
