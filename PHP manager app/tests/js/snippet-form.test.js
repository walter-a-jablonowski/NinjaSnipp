const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { load, fixture } = require('./load.js');

const { SnippetForm } = load('lib/functions.js', 'lib/snippet-form.js');

const form = new SnippetForm({});

// buildInlineHtmlFromComposed() gets the composed text from the PHP Renderer: includes are resolved
// and MAYBE blocks are marked as <<<MAYBE:START:name>>>...<<<MAYBE:END>>> (see RendererTest)

const inline = text => form.buildInlineHtmlFromComposed(text);

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


// Copy output: soft wrapped lines are joined

test('unwrapBlock joins soft wrapped lines and squeezes blanks', () => {
  assert.equal( form.unwrapBlock('one   two\nthree\n four'), 'one two three\n four');
});

test('unwrapBlock keeps structured lines', () => {
  const block = '# Title\n- a\n* b\n+ c\n• d\n1. e\n2) f\n> quote\n| table |\n```\n  indented';
  assert.equal( form.unwrapBlock(block), block);
});

test('unwrapBlock keeps the indent of nested list items', () => {
  assert.equal( form.unwrapBlock('- a\n  - b   c'), '- a\n  - b c');
});

test('unwrapBlock does not join text onto a list item or heading', () => {
  assert.equal( form.unwrapBlock('# Title\ntext\nmore\n- item\nnext'), '# Title\ntext more\n- item\nnext');
});

test('unwrapBlock drops blank lines', () => {
  assert.equal( form.unwrapBlock('one\n\n   \ntwo\n'), 'one two');
});

// The PHP side has its own copy (Renderer::unwrap), RendererTest runs the same cases
test('unwrap: shared cases', () => {
  for( const c of fixture('unwrap.json') )
    assert.equal( form.unwrap(c.text), c.unwrapped, c.description);
});


// Var rows: a row is hidden when all of its placeholders are in switched off MAYBE blocks

// Minimal stand-in for the DOM elements updateVarRowVisibility() uses,
// closest() understands selectors like 'tr', '.cls' and '.cls[data-name="value"]'
function el( tag, cls, data = {}, children = [] )
{
  const node = { tagName: tag, className: cls, dataset: data, style: {}, parentElement: null };

  node.closest = selector => {
    const [, t, c, key, value] = selector.match(/^(\w*)(?:\.([\w-]+))?(?:\[data-([\w-]+)="([^"]*)"\])?$/);
    for( let n = node; n; n = n.parentElement )
      if( (! t || n.tagName === t) && (! c || n.className.split(' ').includes(c)) && (! key || n.dataset[key] === value))
        return n;
    return null;
  };

  children.forEach(child => child.parentElement = node);
  return node;
}

const ph    = name => el('span', 'ph ph-text', { ph: name });
const maybe = ( name, enabled, children ) => el('div', 'maybe-block', { maybe: name, enabled: String(enabled) }, children);

// Runs updateVarRowVisibility() for a var row per name and returns the names of the hidden rows
function hiddenVars( names, phs )
{
  const inputs = names.map(name => el('input', 'var-input', { varName: name }));
  inputs.forEach(input => el('tr', '', {}, [input]));

  const container = items => ({ querySelectorAll: selector => items[selector] || [] });
  new SnippetForm({ inline: container({ '.ph': phs }), usage: container({ '.var-input': inputs }) }).updateVarRowVisibility();

  return inputs.filter(input => input.parentElement.style.display === 'none').map(input => input.dataset.varName);
}

test('a var row is hidden when all its placeholders are in disabled MAYBE blocks', () => {
  const phs = [ph('only'), ph('both'), ph('both'), ph('on')];
  maybe('Off', false, [phs[0], phs[1]]);
  maybe('On', true, [phs[3]]);

  assert.deepEqual( hiddenVars(['only', 'both', 'on'], phs), ['only']);
});

test('a placeholder in an enabled MAYBE block inside a disabled one is hidden', () => {
  const phs = [ph('inner')];
  maybe('Outer', false, [maybe('Inner', true, phs)]);

  assert.deepEqual( hiddenVars(['inner'], phs), ['inner']);
});

test('a var row without placeholders in the content stays visible', () => {
  assert.deepEqual( hiddenVars(['unused'], []), []);
});
