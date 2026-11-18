#!/usr/bin/env node
/* Generates ./index.html, the web version of MD Studio served by GitHub Pages (main branch, folder "/ (root)").
 * The site root is the repository root, so editor.css, editor.js, core/, lib/ and icons/ are served as they are: the web app and the
 * extension run the same files. index.html is editor.html plus a Content-Security-Policy (the extension gets one from manifest.json).
 * It is not part of the extension package (release.yml copies an explicit file list).
 * `npm run build:pages` regenerates it; tests/pages.test.js fails when the committed copy is stale.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// Same restrictions as the extension's content_security_policy (script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'),
// plus: no network access from scripts (images in a document are still shown, as in any browser).
const CSP = "script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'";

function indexHtml() {
  const html = fs.readFileSync(path.join(ROOT, 'editor.html'), 'utf8');
  const marker = '<meta charset="utf-8">';
  if (!html.includes(marker)) throw new Error('editor.html: expected <meta charset="utf-8">');
  return html.replace(marker, `${marker}\n  <meta http-equiv="Content-Security-Policy" content="${CSP}">\n  <meta name="description" content="Read and edit Markdown with a live preview, tabs, outline, find, transforms and export. Runs entirely in your browser.">`);
}

function buildPages(rootDir) {
  const dir = rootDir || ROOT;
  fs.writeFileSync(path.join(dir, 'index.html'), indexHtml());
  return path.join(dir, 'index.html');
}

if (require.main === module) console.log(`wrote ${path.relative(process.cwd(), buildPages()) || 'index.html'}`);
module.exports = { buildPages, indexHtml, CSP };
