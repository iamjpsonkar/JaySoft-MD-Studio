#!/usr/bin/env node
/* Copies the shared core modules from the sibling JSON Studio checkout (default ../json-studio) into core/.
 * They are meant to stay byte-identical; tests/sync.test.js fails when they drift apart.
 * Usage: node scripts/sync-from-json-studio.js [path-to-json-studio]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SHARED = ['find.js', 'editing.js', 'textdiff.js'];
const ROOT = path.join(__dirname, '..');
const source = path.resolve(process.argv[2] || path.join(ROOT, '..', 'json-studio'));

if (require.main === module) {
  if (!fs.existsSync(path.join(source, 'core'))) { console.error(`No core/ folder in ${source}`); process.exit(1); }
  for (const f of SHARED) {
    fs.copyFileSync(path.join(source, 'core', f), path.join(ROOT, 'core', f));
    console.log(`synced core/${f}`);
  }
}
module.exports = { SHARED, source };
