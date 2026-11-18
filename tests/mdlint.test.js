const test = require('node:test');
const assert = require('node:assert');
require('../core/ns.js');
require('../core/mdtransform.js');
require('../core/mdlint.js');
require('../core/mdexport.js');
const { lint } = globalThis.JSS.mdlint;
const X = globalThis.JSS.mdexport;
const rules = (text) => lint(text).issues.map((i) => `${i.line}:${i.rule}`);

test('headings: level jumps, a second H1, a missing space after #', () => {
  assert.deepEqual(rules('# A\n\n### C\n\n## B\n'), ['3:heading-increment']);
  assert.deepEqual(rules('# A\n## B\n### C\n'), [], 'steps of one are fine, and going back up is fine');
  assert.deepEqual(rules('# A\n\n# B\n'), ['3:multiple-h1']);
  assert.deepEqual(rules('#Nope\n'), ['1:heading-space']);
  assert.deepEqual(rules('## A\n#### B\n'), ['2:heading-increment'], 'a document may start below H1');
  assert.deepEqual(rules('Title\n=====\n\n### x\n'), ['4:heading-increment'], 'setext headings count');
});

test('links: empty destination or text, broken anchors (GitHub slugs, duplicates), undefined references, image alt', () => {
  assert.deepEqual(rules('# Intro\n\n[a](#intro) [b](#nowhere) [c]() [](http://x)\n'), ['3:broken-anchor', '3:empty-link', '3:empty-link']);
  assert.deepEqual(rules('# Same\n## Same\n\n[x](#same-1) [y](#same) [z](#same-2)\n'), ['4:broken-anchor']);
  assert.deepEqual(rules('# Héllo Wörld!\n\n[x](#héllo-wörld)\n'), [], 'unicode and punctuation follow the same slug rules as the preview');
  assert.deepEqual(rules('# T\n\n[a][ref] [b][] [c][missing]\n\n[ref]: http://x\n[b]: http://y\n'), ['3:undefined-reference']);
  assert.deepEqual(rules('![](a.png) ![ok](b.png)\n'), ['1:image-alt']);
  assert.deepEqual(rules('see `[x](#nope)` in code\n'), [], 'code spans are not links');
  assert.deepEqual(rules('```\n[x](#nope)\n```\n'), [], 'nor fenced code');
  assert.deepEqual(rules('<!-- [x](#nope)\n[y]() -->\n'), [], 'nor HTML comments');
  assert.deepEqual(rules('[a](#)\n'), [], 'a bare # is the top of the page');
});

test('fences, tables, blank lines and trailing spaces', () => {
  assert.deepEqual(rules('text\n\n```js\ncode\n'), ['3:unclosed-fence']);
  assert.deepEqual(rules('```\nok\n```\n'), []);
  assert.deepEqual(rules('| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |\n'), ['3:table-columns', '4:table-columns']);
  assert.deepEqual(rules('a\n\n\nb\n'), ['3:blank-lines']);
  assert.deepEqual(rules('a  \nb   \nc\n'), [], 'two or more spaces before a text line is a deliberate break');
  assert.deepEqual(rules('a\nlast   \n'), ['2:trailing-spaces'], 'but not on a line with no text after it');
  assert.deepEqual(rules('word \n'), ['1:trailing-spaces']);
});

test('positions and counts: line, column, offset, severity totals', () => {
  const text = 'ok\n\n#Bad\n\n[x]()\n';
  const { issues, counts } = lint(text);
  const bad = issues.find((i) => i.rule === 'heading-space');
  assert.equal(text.slice(bad.offset, bad.offset + 4), '#Bad', 'offset points at the problem');
  assert.deepEqual([bad.line, bad.col], [3, 1]);
  const link = issues.find((i) => i.rule === 'empty-link');
  assert.equal(text.slice(link.offset, link.offset + 3), '[x]');
  assert.deepEqual(counts, { error: 0, warning: 2, info: 0 });
  assert.deepEqual(lint('```\nx').counts, { error: 1, warning: 0, info: 0 });
  assert.deepEqual(lint('').issues, []);
  assert.deepEqual(lint('---\ntitle: #x\n---\n# A\n').issues, [], 'front matter is not Markdown');
});

test('export: standalone HTML escapes the title and keeps the body; plain text strips syntax; names', () => {
  const html = X.standaloneHtml('A <b> & "c"', '<h1>Hi</h1>');
  assert.match(html, /<title>A &lt;b&gt; &amp; &quot;c&quot;<\/title>/);
  assert.match(html, /<main>\n<h1>Hi<\/h1>\n<\/main>/);
  assert.match(html, /^<!doctype html>/);
  assert.ok(!/<script/i.test(html), 'a static page: no script');
  const plain = X.toPlainText('# Title\n\nSome **bold**, *em*, `code`, ~~gone~~ and [a link](http://x.y) or ![alt](i.png).\n\n> quote\n\n```js\nlet a = **1**;\n```\n\n---\n\n- item\n<span>raw</span>\n');
  assert.equal(plain, 'Title\n\nSome bold, em, code, gone and a link (http://x.y) or alt.\n\nquote\n\nlet a = **1**;\n\n- item\nraw\n'.replace('\n\n\n', '\n\n'));
  assert.equal(X.toPlainText('[http://a.b](http://a.b)'), 'http://a.b');
  assert.equal(X.exportName('notes.md', 'html'), 'notes.html');
  assert.equal(X.exportName('README.markdown', 'txt'), 'README.txt');
  assert.equal(X.exportName('', 'pdf'), 'document.pdf');
  assert.equal(X.exportName('a.b.md', 'html'), 'a.b.html');
});
