const { test }    = require('node:test');
const assert      = require('node:assert/strict');
const { load, fixture } = require('./load.js');

const { escapeHtml, extractContentVars, extractContentMaybes, timeAgo } = load('lib/functions.js');


// escapeHtml

test('escapeHtml escapes markup and both quote types', () => {
  assert.equal( escapeHtml(`<a href="x">Tom's & Jerry</a>`), '&lt;a href=&quot;x&quot;&gt;Tom&#39;s &amp; Jerry&lt;/a&gt;');
});

test('escapeHtml turns null and numbers into strings', () => {
  assert.equal( escapeHtml(null), '');
  assert.equal( escapeHtml(undefined), '');
  assert.equal( escapeHtml(0), '0');
});


// extractContentVars: same cases as the PHP parser (RendererTest::testExtractPlaceholdersSharedCases)

for( const { description, content, placeholders } of fixture('placeholders.json'))
{
  test(`extractContentVars matches PHP: ${description}`, () => {
    assert.deepEqual( [...extractContentVars(content)], Object.keys(placeholders));
  });
}


// extractContentMaybes: same cases as the PHP parser (RendererTest::testExtractMaybesSharedCases)

for( const { description, content, maybes } of fixture('maybes.json'))
{
  test(`extractContentMaybes matches PHP: ${description}`, () => {
    assert.deepEqual( [...extractContentMaybes(content)], maybes);
  });
}


// timeAgo

test('timeAgo uses the largest unit', t => {
  const now = 1_000_000_000_000;
  t.mock.method( Date, 'now', () => now);

  assert.equal( timeAgo(now - 59 * 1000), 'Just now');
  assert.equal( timeAgo(now - 60 * 1000), '1m ago');
  assert.equal( timeAgo(now - 59 * 60 * 1000), '59m ago');
  assert.equal( timeAgo(now - 60 * 60 * 1000), '1h ago');
  assert.equal( timeAgo(now - 47 * 60 * 60 * 1000), '1d ago');
});
