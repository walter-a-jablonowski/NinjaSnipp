<?php

namespace SnippetManager\Tests;

use SnippetManager\SnippetManager;

// Besides the data set "Test" (A, B) of every test a second one, "Other" (A, C):
// A is shared by both
class SnippetIndexTest extends TestCase
{
  private function twoDataSets() : SnippetManager
  {
    mkdir("{$this->root}/c");
    return $this->manager(['dataPaths' => ['Other' => ['A' => $this->a, 'C' => "{$this->root}/c"]]]);
  }

  // Entries by "name" (or "name@data set" when given), with the fields a test looks at
  private function entries( SnippetManager $manager, bool $byDataSet = false ) : array
  {
    $entries = [];
    foreach( $manager->index->all() as $entry )
      $entries[ $byDataSet ? "{$entry['name']}@{$entry['dataSets'][0]}" : $entry['name']] = $entry;

    ksort($entries);
    return $entries;
  }

  public function testFormAndText() : void
  {
    $this->write('a/sub/plain.yml', "sc: ' pl-- '\nshort: Plain\ncontent: |\n  one\n  two\n\n  {{ include: \"footer\" }}\n");
    $this->write('a/footer.yml', 'content: end');
    $this->write('a/greet.yml', 'content: "Hi {{ name=you }}"');
    $this->write('a/uses-greet.yml', "content: |\n  {{ include: \"greet\" }}\n");
    $this->write('a/optional.yml', "content: |\n  a\n  {{ MAYBE: More }}\n  b\n  {{ END-MAYBE }}\n");
    $this->write('a/note.md', "# Note\n\n{{ not a form }}\nline");

    $entries = $this->entries( $this->manager());

    $this->assertSame([
      'dataSets' => ['Test'],
      'path'     => 'sub/plain.yml',
      'basePath' => $this->a,
      'name'     => 'plain',
      'folder'   => 'sub',
      'sc'       => 'pl--',
      'short'    => 'Plain',
      'form'     => false,
      'text'     => "one two\n\nend"            // includes resolved, unwrapped as the manager copies it
    ], $entries['plain']);

    $this->assertTrue($entries['greet']['form']);
    $this->assertNull($entries['greet']['text']);
    $this->assertTrue($entries['uses-greet']['form']);      // a placeholder of an included snippet
    $this->assertTrue($entries['optional']['form']);        // MAYBE blocks only
    $this->assertFalse($entries['note']['form']);           // markdown as it is
    $this->assertSame("# Note\n\n{{ not a form }}\nline", $entries['note']['text']);
  }

  public function testSharedFilesAreOneEntryUnlessTheyComposeDifferently() : void
  {
    $manager = $this->twoDataSets();
    $this->write('a/shared.yml', 'content: shared');
    $this->write('b/only-test.yml', 'content: b');
    $this->write('c/only-other.yml', 'content: c');
    $this->write('a/uses-part.yml', "content: |\n  {{ include: \"part\" }}\n");
    $this->write('b/part.yml', 'content: part of Test');
    $this->write('c/part.yml', 'content: part of Other');

    $entries = $this->entries($manager, true);

    $this->assertSame(['only-other@Other', 'only-test@Test', 'part@Other', 'part@Test', 'shared@Test', 'uses-part@Other', 'uses-part@Test'], array_keys($entries));
    $this->assertSame(['Test', 'Other'], $entries['shared@Test']['dataSets']);
    $this->assertSame('part of Test', $entries['uses-part@Test']['text']);
    $this->assertSame('part of Other', $entries['uses-part@Other']['text']);
  }

  public function testALinkIsTheSnippetItPointsTo() : void
  {
    $this->write('a/shared.yml', 'content: shared');
    $this->write('b/sub/INCLUDE shared');

    $this->assertSame(['shared'], array_keys( $this->entries( $this->manager())));
  }

  public function testTheSelectedDataSetStaysAndNoFolderIsCreated() : void
  {
    $missing = "{$this->root}/missing";
    $manager = $this->manager(['dataPaths' => ['Broken' => ['X' => $missing], 'Other' => ['A' => $this->a]]]);
    $manager->sources->select('Other');

    $manager->index->all();

    $this->assertSame('Other', $manager->sources->getCurrentLabel());
    $this->assertDirectoryDoesNotExist($missing);
  }

  public function testStampChangesWithTheFiles() : void
  {
    $manager = $this->twoDataSets();
    $this->write('c/x.yml', 'content: x');
    $stamp = $manager->index->stamp();

    $this->assertSame($stamp, $manager->index->stamp());

    $this->write('c/x.yml', 'content: changed');            // in the data set that is not selected
    $this->assertNotSame($stamp, $changed = $manager->index->stamp());

    $this->write('a/deeper/y.yml', 'content: y');
    $this->assertNotSame($changed, $manager->index->stamp());
  }
}
