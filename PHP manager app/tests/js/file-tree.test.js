const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { load } = require('./load.js');

const { FileTreeController } = load('lib/functions.js', 'controllers/file-tree.js');

const tree = new FileTreeController({});

// Tree nodes as listFiles returns them (folder paths without, file paths with extension)
const folder = ( dir, name, extra = {} ) => ({ type: 'folder', name, path: dir ? `${dir}/${name}` : name, basePath: '/a', ...extra });
const file   = ( dir, name, extra = {} ) => {
  const [, base, extension] = name.match(/^(.*)\.(\w+)$/);
  return { type: 'file', name: base, extension, path: dir ? `${dir}/${name}` : name, basePath: '/a', ...extra };
};


// Tree state

test('buildTreeNodes fills in defaults', () => {
  const [dir, snippet] = tree.buildTreeNodes([
    { type: 'folder', name: 'docs', path: 'docs' },
    { type: 'file', name: 'x', path: 'link/x.yml', fsPath: 'docs/x.yml', extension: 'yml', isIncluded: true }
  ]);

  assert.equal( dir.fsPath, 'docs');           // falls back to the tree path
  assert.equal( dir.children, null);           // folder, not loaded yet
  assert.equal( dir.isOpen, false);
  assert.equal( snippet.fsPath, 'docs/x.yml');
  assert.equal( snippet.children, undefined);  // files have no children
  assert.equal( snippet.isIncluded, true);
  assert.equal( snippet.color, null);
});

test('findNodeInTree searches loaded subfolders, also closed ones', () => {
  const deep  = file('a/b', 'c.yml');
  const nodes = [folder('', 'a', { children: [folder('a', 'b', { children: [deep] })] })];

  assert.equal( tree.findNodeInTree(nodes, 'a/b/c.yml'), deep);
  assert.equal( tree.findNodeInTree(nodes, 'a/missing'), null);
});

test('flattenTree lists the visible rows with their depth', () => {
  const nodes = [
    folder('', 'open', { isOpen: true, children: [
      file('open', 'x.yml'),
      folder('open', 'closed', { isOpen: false, children: [file('open/closed', 'hidden.yml')] })
    ]}),
    file('', 'y.md')
  ];

  assert.deepEqual( tree.flattenTree(nodes).map(n => `${n._depth} ${n.path}`), [
    '0 open', '1 open/x.yml', '1 open/closed', '0 y.md'
  ]);
});


// planReorder: drag & drop renumbers the 2-digit prefixes of one level

const level = () => [
  folder('docs', '01 Alpha'),
  file('docs', '02 Beta.yml'),
  file('docs', '03 Gamma.md'),
  file('docs', 'Zeta.yml')
];

const renames = plan => plan.ops.map(op => `${op.oldName} > ${op.newName}`);

test('planReorder renumbers the moved item and the ones it passed', () => {
  const plan = tree.planReorder(level(), 'docs', 'docs/03 Gamma.md', 'docs/01 Alpha', 'before');

  assert.deepEqual( plan.ops, [
    { base: '/a', oldName: '03 Gamma.md', newName: '01 Gamma.md', type: 'file' },
    { base: '/a', oldName: '01 Alpha', newName: '02 Alpha', type: 'folder' },
    { base: '/a', oldName: '02 Beta.yml', newName: '03 Beta.yml', type: 'file' }
  ]);
  assert.deepEqual( plan.folderRenames, { 'docs/01 Alpha': 'docs/02 Alpha' });
  assert.equal( plan.draggedFilePath, 'docs/01 Gamma.md');
});

test('planReorder gives an unprefixed item a prefix, unprefixed bystanders stay as they are', () => {
  const siblings = [...level(), file('docs', 'Omega.yml')];
  const plan     = tree.planReorder(siblings, 'docs', 'docs/Zeta.yml', 'docs/01 Alpha', 'after');

  assert.deepEqual( renames(plan), ['Zeta.yml > 02 Zeta.yml', '02 Beta.yml > 03 Beta.yml', '03 Gamma.md > 04 Gamma.md']);
});

test('planReorder appends when the target is unknown', () => {
  const plan = tree.planReorder(level(), 'docs', 'docs/01 Alpha', 'docs/gone.yml', 'before');

  assert.deepEqual( renames(plan), ['02 Beta.yml > 01 Beta.yml', '03 Gamma.md > 02 Gamma.md', '01 Alpha > 04 Alpha']);
  assert.equal( plan.draggedFilePath, null);   // a folder
});

test('planReorder has nothing to rename if the order did not change', () => {
  const plan = tree.planReorder(level(), 'docs', 'docs/02 Beta.yml', 'docs/03 Gamma.md', 'before');

  assert.deepEqual( plan.ops, []);
  assert.equal( plan.draggedFilePath, 'docs/02 Beta.yml');
});

test('planReorder normalizes other prefix separators to a blank', () => {
  const siblings = [file('', '01_First.yml'), file('', '02-Second.yml')];
  const plan     = tree.planReorder(siblings, '', '02-Second.yml', '01_First.yml', 'before');

  assert.deepEqual( renames(plan), ['02-Second.yml > 01 Second.yml', '01_First.yml > 02 First.yml']);
  assert.equal( plan.draggedFilePath, '01 Second.yml');   // root level: no leading slash
});

test('planReorder renames a merged folder in every source', () => {
  const siblings = [folder('', '01 A', { mergedBases: ['/a', '/b'] }), file('', '02 B.yml')];
  const plan     = tree.planReorder(siblings, '', '02 B.yml', '01 A', 'before');

  assert.deepEqual( plan.ops.filter(op => op.type === 'folder').map(op => op.base), ['/a', '/b']);
});

test('planReorder neither moves nor renames included items', () => {
  const siblings = [file('', '01 A.yml'), file('', '02 Linked.yml', { isIncluded: true }), file('', '03 C.yml')];

  assert.equal( tree.planReorder(siblings, '', '02 Linked.yml', '01 A.yml', 'before'), null);
  assert.deepEqual( renames(tree.planReorder(siblings, '', '03 C.yml', '01 A.yml', 'before')),
    ['03 C.yml > 01 C.yml', '01 A.yml > 02 A.yml']);   // the link keeps its name and its slot (03)
});

test('planReorder returns null for an unknown dragged item', () => {
  assert.equal( tree.planReorder(level(), 'docs', 'docs/gone.yml', 'docs/01 Alpha', 'before'), null);
});


// _remapPaths: stored paths follow renumbered folders

test('_remapPaths rewrites expanded folders and the current paths', () => {
  const app  = {
    expandedFolders: new Set(['docs/01 A', 'docs/01 A/sub', 'docs/01 AB', 'other']),
    currentPath:     'docs/01 A/sub',
    currentTreePath: 'docs/01 A/sub/x.yml'
  };

  new FileTreeController(app)._remapPaths({ 'docs/01 A': 'docs/02 A' });

  assert.deepEqual( [...app.expandedFolders], ['docs/02 A', 'docs/02 A/sub', 'docs/01 AB', 'other']);   // 01 AB only shares the prefix
  assert.equal( app.currentPath, 'docs/02 A/sub');
  assert.equal( app.currentTreePath, 'docs/02 A/sub/x.yml');
});
