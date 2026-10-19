<?php

namespace SnippetManager\Tests;

class RendererTest extends TestCase
{
  private function render( string $content, array $values = [], array $settings = [] ) : string
  {
    return $this->manager($settings)->renderer->render(['content' => $content], $values);
  }

  private function compose( string $content, array $settings = [] ) : string
  {
    return $this->manager($settings)->renderer->compose(['content' => $content]);
  }

  public function testPlaceholders() : void
  {
    $this->assertSame('Hi Bob, GET /', $this->render('Hi {{ name }}, {{ method=GET|POST }} {{path=/}}', ['name' => 'Bob']));
    $this->assertSame('Hi {{name}}', $this->render('Hi {{ name }}'));             // no value, no default
    $this->assertSame('POST', $this->render('{{ method=GET|POST }}', ['method' => 'POST']));
    $this->assertSame('{{ not a placeholder! }}', $this->render('{{ not a placeholder! }}'));
  }

  public function testMissingContent() : void
  {
    $renderer = $this->manager()->renderer;

    $this->assertSame('', $renderer->render([]));
    $this->assertSame('', $renderer->compose([]));
  }

  public function testExtractPlaceholders() : void
  {
    $placeholders = $this->manager()->renderer->extractPlaceholders(
      "{{ name }} {{ method=GET | POST }} {{ path=/x }}\n{{ MAYBE: Extra }}x{{ END-MAYBE }}{{ include: \"y\" }}"
    );

    $this->assertSame([
      'name'   => ['type' => 'text', 'default' => ''],
      'method' => ['type' => 'choice', 'choices' => ['GET', 'POST'], 'default' => 'GET'],
      'path'   => ['type' => 'text', 'default' => '/x']
    ], $placeholders);
  }

  // The front-end has its own copy of this parser (extractContentVars in lib/functions.js),
  // tests/js/functions.test.js runs the same cases against it
  public function testExtractPlaceholdersSharedCases() : void
  {
    $renderer = $this->manager()->renderer;
    $cases    = json_decode( file_get_contents(__DIR__ . '/fixtures/placeholders.json'), true);

    foreach( $cases as $case )
      $this->assertSame( $case['placeholders'], $renderer->extractPlaceholders($case['content']), $case['description']);
  }

  public function testMaybeBlocks() : void
  {
    $content = "Start\n  {{ MAYBE: Extra }}\n  optional\n  {{ END-MAYBE }}\nEnd";

    $this->assertSame("Start\n  optional\nEnd", $this->render($content));
    $this->assertSame("Start\n<<<MAYBE:START:Extra>>>  optional<<<MAYBE:END>>>End", $this->compose($content));
  }

  public function testIncludes() : void
  {
    $this->write('a/sub/footer.yml', "content: |\n  line 1\n  line 2\n");

    $this->assertSame("Top\n  line 1\n  line 2\nEnd", $this->render("Top\n  {{ include: \"footer\" }}\nEnd"));
    $this->assertSame("Top\nline 1\nline 2", $this->render("Top\n  {{ include: 'footer' }}", [], ['render' => ['includedSameIndent' => false]]));
    $this->assertSame('<<<INC:START:footer>>>line 1' . "\n" . 'line 2<<<INC:END>>>',
      $this->compose('{{ include: "footer" }}', ['render' => ['highlightInclude' => true]]));
    $this->assertSame('{{ include: "missing" }}', $this->render('{{ include: "missing" }}'));
  }

  public function testIncludedPlaceholdersAreFilled() : void
  {
    $this->write('a/greet.yml', 'content: "Hello {{ name=World }}"');

    $this->assertSame('Hello Bob', $this->render('{{ include: "greet" }}', ['name' => 'Bob']));
  }

  public function testCircularIncludesStop() : void
  {
    $this->write('a/one.yml', "content: |\n  one\n  {{ include: \"two\" }}\n");
    $this->write('a/two.yml', "content: |\n  two\n  {{ include: \"one\" }}\n");

    $this->assertSame("one\ntwo\n{{ include: \"one\" }}", $this->render('{{ include: "one" }}', [], ['render' => ['includedSameIndent' => false]]));
  }

  public function testIncludeSkipsBrokenFileWithSameName() : void
  {
    $this->write('a/1/part.yml', 'content: [broken');
    $this->write('a/2/part.yml', 'content: ok');

    $this->assertSame('ok', $this->render('{{ include: "part" }}'));
    $this->assertSame('2/part.yml', $this->manager()->renderer->findInclude('part')['path']);
  }

  public function testIncludeNextToAMaybeBlockInline() : void
  {
    $this->write('a/style.yml', 'content: STYLE');

    $this->assertSame('<<<MAYBE:START:X>>>more<<<MAYBE:END>>>STYLE',
      $this->compose("{{ MAYBE: X }}\nmore\n{{ END-MAYBE }}\n{{ include: \"style\" }}"));
    $this->assertSame('<<<MAYBE:START:X>>>STYLE<<<MAYBE:END>>>',
      $this->compose("{{ MAYBE: X }}\n{{ include: \"style\" }}\n{{ END-MAYBE }}\n"));
  }

  public function testMaybeBlocksLeftOut() : void
  {
    $this->write('a/footer.yml', "content: |\n  {{ MAYBE: Extra }}\n  footer extra\n  {{ END-MAYBE }}\n  footer\n");
    $content  = "Start\n{{ MAYBE: Extra }}\noptional\n{{ END-MAYBE }}\n{{ MAYBE: Other }}\nother\n{{ END-MAYBE }}\n{{ include: \"footer\" }}";
    $renderer = $this->manager()->renderer;

    $this->assertSame("Start\nother\nfooter", $renderer->render(['content' => $content], [], ['Extra']));
    $this->assertSame("Start\noptional\nother\nfooter extra\nfooter", $renderer->render(['content' => $content]));
  }

  public function testExtractMaybesSharedCases() : void
  {
    $renderer = $this->manager()->renderer;
    $cases    = json_decode( file_get_contents(__DIR__ . '/fixtures/maybes.json'), true);

    foreach( $cases as $case )
      $this->assertSame( $case['maybes'], $renderer->extractMaybes($case['content']), $case['description']);
  }

  public function testIncludeNamesAndIncludedBy() : void
  {
    $this->write('a/style.yml', 'content: style');
    $this->write('a/post.yml', "content: |\n  post\n  {{ include: \"style\" }}\n  {{ include: 'style' }}\n");
    $this->write('b/sub/mail.yml', "content: |\n  {{ include: \"style\" }}\n  {{ include: \"sign\" }}\n");
    $this->write('a/other.yml', 'content: "inline {{ include: \"style\" }} is no include"');
    $renderer = $this->manager()->renderer;

    $this->assertSame(['style', 'sign'], $renderer->includeNames("{{ include: \"style\" }}\n  {{ include: 'sign' }}\n{{ include: \"style\" }}"));
    $this->assertSame(
      [['path' => 'post.yml', 'basePath' => $this->a], ['path' => 'sub/mail.yml', 'basePath' => $this->b]],
      $renderer->includedBy('style')
    );
  }

  // The front-end has its own copy (SnippetForm.unwrap in lib/snippet-form.js),
  // tests/js/snippet-form.test.js runs the same cases against it
  public function testUnwrapSharedCases() : void
  {
    $renderer = $this->manager()->renderer;
    $cases    = json_decode( file_get_contents(__DIR__ . '/fixtures/unwrap.json'), true);

    foreach( $cases as $case )
      $this->assertSame( $case['unwrapped'], $renderer->unwrap($case['text']), $case['description']);
  }
}
