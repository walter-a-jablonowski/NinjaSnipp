<?php

namespace SnippetManager\Tests;

class SearchTest extends TestCase
{
  private function paths( array $results ) : array
  {
    return array_column($results, 'path');
  }

  public function testSearchesAllFieldsAndFolderNames() : void
  {
    $this->write('a/alpha.yml', 'content: nothing');
    $this->write('a/b.yml', 'sc: alpha');
    $this->write('a/c.yml', "usage:\n  vars:\n    alpha: x\ncontent: y\n");   // a usage key
    $this->write('a/d.yml', 'content: "some ALPHA text"');                     // case-insensitive
    $this->write('a/e.md', 'alpha in markdown');
    $this->write('a/Alpha dir/z.yml', 'content: z');
    $this->write('a/none.yml', 'content: beta');

    $paths = $this->paths( $this->manager()->search->search('Alpha'));

    sort($paths);
    $this->assertSame(['Alpha dir', 'alpha.yml', 'b.yml', 'c.yml', 'd.yml', 'e.md'], $paths);
  }

  public function testRanksByRelevance() : void
  {
    $this->write('a/log.yml', 'content: x');              // exact name
    $this->write('a/logger.yml', 'content: x');           // name prefix
    $this->write('a/my log.yml', 'content: x');           // name contains
    $this->write('a/other.yml', 'sc: log');               // exact short code
    $this->write('a/text.yml', 'content: a log line');    // content only

    $this->assertSame(['log.yml', 'other.yml', 'logger.yml', 'my log.yml', 'text.yml'],
      $this->paths( $this->manager()->search->search('log')));
  }

  public function testResultsCarryTheirSource() : void
  {
    $this->write('a/x.yml', 'content: match a');
    $this->write('b/x.yml', 'content: match b');

    $results = $this->manager()->search->search('match');

    $this->assertSame([$this->a, $this->b], array_column($results, 'basePath'));
    $this->assertSame(['match a', 'match b'], array_column( array_column($results, 'snippet'), 'content'));
  }

  public function testLinkedFolderIsSearchedOnce() : void
  {
    $this->write('a/shared/x.yml', 'content: needle');
    $this->write('a/sub/INCLUDE shared');

    $results = $this->manager()->search->search('needle');

    $this->assertSame(['shared/x.yml'], $this->paths($results));
  }

  public function testIgnoresBrokenFiles() : void
  {
    $this->write('a/broken.yml', 'content: [needle');
    $this->write('a/ok.yml', 'content: needle');

    $this->assertSame(['ok.yml'], $this->paths( $this->manager()->search->search('needle')));
  }
}
