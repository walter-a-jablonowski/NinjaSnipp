const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { load } = require('./load.js');

const { RenderController } = load('lib/functions.js', 'controllers/render.js');

const render = new RenderController({});

// buildInlineHtmlFromComposed() gets the composed text from the PHP Renderer: includes are resolved
// and MAYBE blocks are marked as <<<MAYBE:START:name>>>...<<<MAYBE:END>>> (see RendererTest)

const inline = text => render.buildInlineHtmlFromComposed(text);

const unescape = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attr     = ( tag, name ) => { const m = tag.match(new RegExp(` ${name}="([^"]*)"|${name}='([^']*)'`)); return m ? unescape(m[1] ?? m[2]) : undefined; };

// The placeholder elements as { name, type, default, choices? }
function placeholders(html)
{
  return [...html.matchAll(/<span class="ph ph-(text|choice)"[^>]*>/g)].map(([tag, type]) => {
    const ph = { name: attr(tag, 'data-ph'), type, default: attr(tag, 'data-default') };
    if( type === 'choice' ) ph.choices = JSON.parse(attr(tag, 'data-choices'));
    return ph;
  });
}

// The text the user sees: defaults and literal text, without the MAYBE checkbox labels
function visibleText(html)
{
  return unescape( html.replace(/<div class="maybe-header">.*?<\/div>/g, '').replace(/<[^>]+>/g, ''));
}

// Only the block elements (MAYBE blocks, includes), to check how they nest
function structure(html)
{
  return html
    .replace(/<span class="ph[ -][^"]*"[^>]*>[^<]*<\/span>/g, '')
    .replace(/<div class="maybe-header">.*?<\/div>/g, '')
    .replace(/ data-enabled="true"/g, '');
}


// Placeholders

test('placeholders become editable elements with their defaults', () => {
  const html = inline('Hi {{ name }}, {{ method=GET | POST }} {{path=/x}}!');

  assert.deepEqual( placeholders(html), [
    { name: 'name',   type: 'text',   default: '' },
    { name: 'method', type: 'choice', default: 'GET', choices: ['GET', 'POST'] },
    { name: 'path',   type: 'text',   default: '/x' }
  ]);
  assert.equal( visibleText(html), 'Hi , GET /x!');
});

test('every use of a placeholder gets its own element', () => {
  assert.deepEqual( placeholders(inline('{{ a }}{{ a=x }}')).map(ph => ph.default), ['', 'x']);
});

test('invalid tokens and unresolved includes stay visible as text', () => {
  const html = inline('{{ not valid! }} {{ include: "missing" }}');

  assert.deepEqual( placeholders(html), []);
  assert.equal( visibleText(html), '{{ not valid! }} {{ include: "missing" }}');
});

test('text and defaults are escaped, also inside attributes', () => {
  const html = inline(`<b>{{ who=O'Brien & "Sons" | Smith }}</b>`);

  assert.ok( ! html.includes('<b>'));
  assert.deepEqual( placeholders(html), [
    { name: 'who', type: 'choice', default: `O'Brien & "Sons"`, choices: [`O'Brien & "Sons"`, 'Smith'] }
  ]);
  assert.equal( visibleText(html), `<b>O'Brien & "Sons"</b>`);
});


// MAYBE blocks and includes

test('a MAYBE block becomes an enabled block with a checkbox', () => {
  const html = inline('A <<<MAYBE:START:Extra>>>opt {{ x }}<<<MAYBE:END>>> B');

  assert.match( html, /<div class="maybe-header"><input type="checkbox" class="maybe-checkbox" checked> <span class="maybe-label">Extra<\/span><\/div>/);
  assert.equal( structure(html), '<div class="maybe-block" data-maybe="Extra"><div class="maybe-content"></div><div class="maybe-end"></div></div>');
  assert.equal( visibleText(html), 'A opt  B');
  assert.deepEqual( placeholders(html).map(ph => ph.name), ['x']);
});

test('MAYBE blocks and includes nest', () => {
  const html = inline('<<<MAYBE:START:Outer>>>a<<<INC:START:footer>>>b<<<MAYBE:START:Inner>>>c<<<MAYBE:END>>><<<INC:END>>><<<MAYBE:END>>>');

  assert.equal( structure(html),
    '<div class="maybe-block" data-maybe="Outer"><div class="maybe-content">'
    + '<span class="inc-block" data-inc="footer">'
    + '<div class="maybe-block" data-maybe="Inner"><div class="maybe-content"></div><div class="maybe-end"></div></div>'
    + '</span>'
    + '</div><div class="maybe-end"></div></div>');
  assert.equal( visibleText(html), 'abc');
});

test('stray end markers are dropped, an unclosed include is closed', () => {
  assert.equal( structure(inline('a<<<MAYBE:END>>>b<<<INC:END>>>c')), '');
  assert.equal( structure(inline('<<<INC:START:x>>>a')), '<span class="inc-block" data-inc="x"></span>');
});

test('MAYBE and include names are escaped', () => {
  const html = inline(`<<<MAYBE:START:"Tom's" & co>>>x<<<MAYBE:END>>>`);
  assert.match( html, /data-maybe="&quot;Tom&#39;s&quot; &amp; co"/);
});


// unwrapBlock: copy output joins soft wrapped lines

test('unwrapBlock joins soft wrapped lines and squeezes blanks', () => {
  assert.equal( render.unwrapBlock('one   two\nthree\n four'), 'one two three\n four');
});

test('unwrapBlock keeps structured lines', () => {
  const block = '# Title\n- a\n* b\n+ c\n• d\n1. e\n2) f\n> quote\n| table |\n```\n  indented';
  assert.equal( render.unwrapBlock(block), block);
});

test('unwrapBlock keeps the indent of nested list items', () => {
  assert.equal( render.unwrapBlock('- a\n  - b   c'), '- a\n  - b c');
});

test('unwrapBlock does not join text onto a list item or heading', () => {
  assert.equal( render.unwrapBlock('# Title\ntext\nmore\n- item\nnext'), '# Title\ntext more\n- item\nnext');
});

test('unwrapBlock drops blank lines', () => {
  assert.equal( render.unwrapBlock('one\n\n   \ntwo\n'), 'one two');
});
