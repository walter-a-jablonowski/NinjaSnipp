const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { load } = require('./load.js');

const { lineDiff, AiController } = load('lib/functions.js', 'controllers/ai.js');


// lineDiff

test('lineDiff keeps common lines and marks the changed ones', () => {
  assert.deepEqual( lineDiff("a\nb\nc", "a\nB\nc\nd"), [
    { type: 'same', text: 'a' },
    { type: 'del',  text: 'b' },
    { type: 'add',  text: 'B' },
    { type: 'same', text: 'c' },
    { type: 'add',  text: 'd' }
  ]);
});

test('lineDiff of a new or removed text', () => {
  assert.deepEqual( lineDiff('', "x\ny"), [{ type: 'add', text: 'x' }, { type: 'add', text: 'y' }]);
  assert.deepEqual( lineDiff('x', ''), [{ type: 'del', text: 'x' }]);
  assert.deepEqual( lineDiff('', ''), []);
});


// diffHunks: changed lines with context, the rest folded

test('diffHunks folds unchanged stretches', () => {
  const before = Array.from({ length: 12 }, (v, i) => `line ${i}`).join('\n');
  const after  = before.replace('line 6', 'line six');

  const hunks = AiController.diffHunks( lineDiff(before, after), 2);

  assert.deepEqual( hunks.map(l => l.type === 'gap' ? '⋯' : l.text), ['⋯', 'line 4', 'line 5', 'line 6', 'line six', 'line 7', 'line 8', '⋯']);
});

test('diffHunks without a change is one gap, a full change has none', () => {
  assert.deepEqual( AiController.diffHunks( lineDiff('a\nb', 'a\nb'), 2), [{ type: 'gap' }]);
  assert.deepEqual( AiController.diffHunks( lineDiff('a', 'b'), 2).map(l => l.type), ['del', 'add']);
});


// modelMessages: what the model gets of a session

test('modelMessages tells the model what became of its last answer', () => {
  const messages = [
    { role: 'user', content: 'Improve x' },
    { role: 'assistant', content: 'I propose two changes.', proposals: [
      { id: 'c1', label: 'Edit *x*: content', state: 'accepted' },
      { id: 'c2', label: 'Update *x*: short', state: 'rejected', note: 'keep it short' },
      { id: 'c3', label: 'Delete *y*', state: 'failed', error: 'Changed since it was proposed' }
    ], clientCalls: [{ tool: 'form_fill', path: 'x.yml' }, { tool: 'show_items', items: [] }] },
    { role: 'user', content: 'Thanks' }
  ];

  assert.deepEqual( AiController.modelMessages(messages), [
    { role: 'user', content: 'Improve x' },
    { role: 'assistant', content: 'I propose two changes.' },
    { role: 'user', content: '[What happened to your last answer: "Edit *x*: content" accepted and applied; '
      + '"Update *x*: short" rejected, the user\'s note: keep it short; '
      + '"Delete *y*" accepted, but applying it failed (Changed since it was proposed); '
      + 'the form of x.yml was filled]\n\nThanks' }
  ]);
});

test('modelMessages tells about an undo', () => {
  const messages = [
    { role: 'user', content: 'Fix x' },
    { role: 'assistant', content: 'Done.', proposals: [{ id: 'c1', label: 'Edit *x*: content', state: 'undone' }] },
    { role: 'user', content: 'Why?' }
  ];

  assert.equal( AiController.modelMessages(messages)[2].content,
    '[What happened to your last answer: "Edit *x*: content" accepted, then undone by the user]\n\nWhy?');
});

test('newCheckpoint makes unique ids the server accepts', () => {
  const a = AiController.newCheckpoint(), b = AiController.newCheckpoint();

  assert.match(a, /^cp_[a-z0-9]+$/);
  assert.notEqual(a, b);
});

test('modelMessages adds nothing for an answer without proposals', () => {
  const messages = [
    { role: 'user', content: 'Hi' },
    { role: 'assistant', content: 'Hello', proposals: [], clientCalls: [] },
    { role: 'user', content: 'Next' }
  ];

  assert.equal( AiController.modelMessages(messages)[2].content, 'Next');
});


// sent: a proposal goes back to the server without the sidebar's state

test('sent drops the sidebar state of a proposal', () => {
  const proposal = { id: 'c1', tool: 'snippet_edit', args: { path: 'x.yml' }, hash: null, state: 'open', note: 'n', error: 'e' };

  assert.deepEqual( AiController.sent(proposal), { id: 'c1', tool: 'snippet_edit', args: { path: 'x.yml' }, hash: null });
});
