<?php

namespace SnippetManager\Tests;

use SnippetManager\Ai\AiCheck;
use SnippetManager\Ai\AiLibrary;
use Symfony\Component\Yaml\Yaml;

class AiCheckTest extends TestCase
{
  private function issues( string $path = '' ) : array
  {
    $result = (new AiCheck( new AiLibrary( $this->manager())))->run($path);
    return array_column($result['problems'], 'issues', 'path');
  }

  private function snippet( string $relativePath, array $data ) : void
  {
    $this->write($relativePath, Yaml::dump($data + ['id' => uniqid(), 'version' => 3, 'short' => 's'], 4, 2));
  }

  public function testAGoodSnippetHasNoIssues() : void
  {
    $this->write('a/style.yml', "id: s1\nversion: 3\nshort: s\ncontent: \"{{ tone }}\"\nusage:\n  vars:\n    tone: x\n");
    $this->snippet('a/post.yml', [
      'usage'   => ['vars' => ['topic' => 'The topic', 'tone' => 'documented here, used in the include'], 'maybe' => ['Extra' => 'More']],
      'content' => "Write about {{ topic }}\n{{ MAYBE: Extra }}\nmore\n{{ END-MAYBE }}\n{{ include: \"style\" }}\n"
    ]);

    $this->assertSame([], $this->issues());
  }

  public function testDocumentationOutOfStep() : void
  {
    $this->snippet('a/p.yml', [
      'usage'   => ['vars' => ['myVar' => null, 'topic' => 't'], 'maybe' => ['myVar' => null]],
      'content' => "{{ topic }} {{ lang=PHP|JS }}\n{{ MAYBE: Extra }}\nx\n"
    ]);

    $this->assertSame([
      'placeholders not documented in usage.vars: lang',
      'usage.vars lists names the content does not use: myVar',
      'MAYBE blocks not documented in usage.maybe: Extra',
      'usage.maybe lists names the content does not use: myVar',
      '1 MAYBE but 0 END-MAYBE tags'
    ], $this->issues()['p.yml']);
  }

  public function testFormatIdAndMissingFields() : void
  {
    $this->write('a/old.yml', "id: \"YYYY-MM-DD.01-V1\"\nversion: 2\ncontent: \"\"\n");
    $this->write('a/blank.yml', "id: \"YYYY-MM-DD.01-V1\"\nversion: 3\nshort: s\ncontent: x\n");   // no duplicate of old.yml
    $this->write('a/none.yml', "content: x\n");
    $this->write('a/broken.yml', 'content: [broken');
    $this->write('a/empty.md', '');

    $issues = $this->issues();

    $this->assertSame(['no content', "id is still the template's (YYYY-MM-DD.01-V1)", 'file format version 2, the current one is 3', 'no short description'], $issues['old.yml']);
    $this->assertSame(["id is still the template's (YYYY-MM-DD.01-V1)"], $issues['blank.yml']);
    $this->assertSame(['no id', 'no file format version', 'no short description'], $issues['none.yml']);
    $this->assertSame(['does not parse as YAML'], $issues['broken.yml']);
    $this->assertSame(['no content'], $issues['empty.md']);
  }

  public function testBrokenIncludesAndDuplicates() : void
  {
    $this->snippet('a/one.yml', ['id' => 'same', 'sc' => 'rev', 'content' => "{{ include: \"gone\" }}\n"]);
    $this->snippet('b/sub/two.yml', ['id' => 'same', 'sc' => 'rev', 'content' => 'x']);

    $issues = $this->issues();

    $this->assertSame(['include not found: "gone"', 'sc "rev" is used by sub/two.yml too', 'id "same" is used by sub/two.yml too'], $issues['one.yml']);
    $this->assertSame(['sc "rev" is used by one.yml too', 'id "same" is used by one.yml too'], $issues['sub/two.yml']);

    // A folder is checked against the whole data set
    $this->assertSame(['sub/two.yml'], array_keys( $this->issues('sub')));
  }
}
