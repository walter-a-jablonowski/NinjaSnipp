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
  }
}
