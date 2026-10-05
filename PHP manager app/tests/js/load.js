// Loads front-end scripts for the JS tests
//
// The app's scripts are plain browser scripts (globals, no modules), so they are run as they
// are in the test's own global scope. Running them in this context (not a separate vm context)
// keeps arrays and objects from the same realm, so assert.deepStrictEqual() works on results.
//
//   const { escapeHtml, FileTreeController } = load('lib/functions.js', 'controllers/file-tree.js');

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const appRoot = path.resolve(__dirname, '../..');
const loaded  = new Set();   // a script can only run once, its top-level classes can't be redeclared

function load( ...files )
{
  for( const file of files )
  {
    if( loaded.has(file) )
      continue;

    const code = fs.readFileSync(path.join(appRoot, file), 'utf8');
    vm.runInThisContext(code, { filename: file });
    loaded.add(file);
  }

  // Top-level classes and functions are global bindings, look them up by name
  return new Proxy({}, { get: ( target, name ) => vm.runInThisContext(name) });
}

// Shared test data, also used by the PHPUnit tests (see tests/fixtures)
function fixture(name)
{
  return JSON.parse( fs.readFileSync(path.join(appRoot, 'tests/fixtures', name), 'utf8'));
}

module.exports = { load, fixture };
