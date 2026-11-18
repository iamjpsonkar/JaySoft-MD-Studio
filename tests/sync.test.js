// find.js, editing.js and textdiff.js are copies of JSON Studio's. When the sibling checkout is present they must be identical.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { SHARED, source } = require('../scripts/sync-from-json-studio');

const ROOT = path.join(__dirname, '..');
const haveSibling = fs.existsSync(path.join(source, 'core'));

test('shared core modules are identical to JSON Studio\'s (run scripts/sync-from-json-studio.js if not)', { skip: haveSibling ? false : `no JSON Studio checkout at ${source}` }, () => {
  for (const f of SHARED) {
    assert.ok(fs.readFileSync(path.join(ROOT, 'core', f)).equals(fs.readFileSync(path.join(source, 'core', f))), `core/${f} differs from ${path.join(source, 'core', f)}`);
  }
});

test('the shared modules are all present and load without a DOM', () => {
  globalThis.JSS = undefined;
  require('../core/ns.js');
  for (const f of SHARED) require(`../core/${f}`);
  assert.equal(typeof globalThis.JSS.find.findAll, 'function');
  assert.equal(typeof globalThis.JSS.editing.bracketPair, 'function');
  assert.equal(typeof globalThis.JSS.textdiff.diffLines, 'function');
});
