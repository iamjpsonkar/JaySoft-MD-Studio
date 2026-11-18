// The web version served by GitHub Pages (main branch, folder "/ (root)") is index.html at the repository root, generated from editor.html.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { indexHtml, CSP } = require('../scripts/build-pages');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('index.html is up to date: regenerate with `npm run build:pages` if this fails', () => {
  assert.equal(read('index.html'), indexHtml(), 'index.html differs from editor.html + CSP');
});

test('the web page loads only its own files, has a strict CSP, and the site is not run through Jekyll', () => {
  const html = read('index.html');
  assert.ok(html.includes(`content="${CSP}"`), 'CSP meta tag');
  assert.match(CSP, /script-src 'self'/);
  assert.match(CSP, /connect-src 'none'/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, 'no inline scripts (the CSP would block them)');
  const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((m) => m[1]).filter((u) => !/^https?:/.test(u));
  assert.ok(refs.length >= 12, 'finds the scripts, stylesheets and icon');
  for (const r of refs) assert.ok(fs.existsSync(path.join(ROOT, r)), `${r} exists next to index.html`);
  assert.ok(refs.every((r) => !r.startsWith('/') && !r.startsWith('..')), 'relative paths only, so it works under /JaySoft-MD-Studio/');
  assert.ok(fs.existsSync(path.join(ROOT, '.nojekyll')), '.nojekyll at the root');
});

test('every core script editor.html loads exists, and the extension package ships them (release.yml copies an explicit list)', () => {
  const scripts = [...read('editor.html').matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(scripts.includes('core/editor-widget.js') && scripts.includes('editor.js'));
  for (const s of scripts) assert.ok(fs.existsSync(path.join(ROOT, s)), s);
  const wf = read('.github/workflows/release.yml');
  const cp = /cp -r ([^\n]+) build\/md-studio\//.exec(wf);
  assert.ok(cp, 'finds the staging command');
  const staged = cp[1].split(/\s+/);
  for (const need of ['manifest.json', 'background.js', 'editor.html', 'editor.css', 'editor.js', 'icons', 'lib', 'core']) assert.ok(staged.includes(need), `${need} is packaged`);
  assert.ok(!staged.includes('index.html'), 'the web page is not in the extension package');
});

test('the landing page (at /docs/) links to the web app at the site root', () => {
  assert.match(read('docs/index.html'), /href="\.\.\/"/);
});
