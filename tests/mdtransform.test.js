const test = require('node:test');
const assert = require('node:assert');
require('../core/ns.js');
require('../core/mdtransform.js');
const T = globalThis.JSS.mdtransform;

test('formatTables aligns columns, keeps alignment colons, ignores code fences, pads short rows', () => {
  const src = '| Name | Qty |\n|---|--:|\n| apple | 3 |\n| kiwi | 12345 |\n';
  const r = T.formatTables(src);
  assert.equal(r.text, '| Name  |   Qty |\n| ----- | ----: |\n| apple |     3 |\n| kiwi  | 12345 |\n');
  assert.equal(r.changes, 1);
  assert.equal(T.formatTables(r.text).changes, 0, 'idempotent');
  assert.equal(T.formatTables('```\n| a |b|\n|-|-|\n```\n').changes, 0, 'a table inside a fence is code');
  assert.equal(T.formatTables('| a | b |\n|:-:|:--|\n| 1 |\n').text, '|  a  | b   |\n| :-: | :-- |\n|  1  |     |\n');
  assert.equal(T.formatTables('| `a|b` | c \\| d |\n|-|-|\n').text.split('\n')[0], '| `a|b` | c \\| d |', 'pipes in code spans and escaped pipes do not split cells');
  assert.equal(T.formatTables('no table here').note, 'no tables found');
  assert.equal(T.findTables('a | b\n---|---\n1 | 2').length, 1, 'tables without outer pipes');
  const two = T.formatTables('| a |\n|-|\n| 1 |\n\ntext\n\n| b | c |\n|-|-|\n| 22 | 3 |');
  assert.equal(two.changes, 2);
  assert.match(two.note, /2 tables/);
});

test('sortTable: by column number or name, numbers numerically, text naturally, empty last, desc, errors', () => {
  const src = '| Item | Price |\n|---|---|\n| b | 10 |\n| a | 9 |\n| c |  |\n| d | $100 |\n';
  assert.equal(T.sortTable(src, { line: 2, column: 2 }).text, '| Item | Price |\n| ---- | ----- |\n| a    | 9     |\n| b    | 10    |\n| d    | $100  |\n| c    |       |\n');
  assert.deepEqual(T.sortTable(src, { line: 2, column: 'item', order: 'desc' }).text.split('\n').slice(2, 6).map((l) => l[2]), ['d', 'c', 'b', 'a']);
  assert.match(T.sortTable(src, { line: 0, column: 'nope' }).error, /no column "nope"/);
  assert.match(T.sortTable('text\n', { line: 0, column: 1 }).error, /not inside a table/);
  const sorted = T.sortTable(src, { line: 2, column: 1 });
  assert.equal(T.sortTable(sorted.text, { line: 2, column: 1 }).changes, 0, 'already sorted');
  assert.equal(T.sortTable('| v |\n|-|\n| x10 |\n| x9 |\n| x2 |', { line: 1, column: 1 }).text.split('\n').slice(2).join(','), '| x2  |,| x9  |,| x10 |', 'natural order');
});

test('sortLines: plain lines and lists (nested items travel with their parent)', () => {
  assert.equal(T.sortLines('pear\nApple\nfig').text, 'Apple\nfig\npear');
  assert.equal(T.sortLines('b\na\nc', { order: 'desc' }).text, 'c\nb\na');
  assert.equal(T.sortLines('item10\nitem2\nitem1').text, 'item1\nitem2\nitem10', 'natural');
  assert.equal(T.sortLines('b\n\na').text, 'a\nb\n', 'blank lines go last');
  assert.equal(T.sortLines('a\nb').changes, 0);
  assert.equal(T.sortLines('only one').changes, 0);
  const list = '- pear\n  - green\n  - yellow\n- apple\n  - red\n- fig';
  assert.equal(T.sortLines(list).text, '- apple\n  - red\n- fig\n- pear\n  - green\n  - yellow');
  assert.equal(T.sortLines('1. b\n2. a').text, '1. a\n2. b', 'a numbered list stays 1, 2 after sorting');
  assert.equal(T.sortLines('- [ ] zeta\n- [x] alpha').text, '- [x] alpha\n- [ ] zeta', 'task boxes do not take part in the order');
});

test('dedupeLines keeps the first of each and never removes blank lines', () => {
  assert.equal(T.dedupeLines('a\nb\na\n\nb\n\nc').text, 'a\nb\n\n\nc');
  assert.equal(T.dedupeLines('a\nb').changes, 0);
  assert.equal(T.dedupeLines('x  \nx').changes, 1, 'trailing spaces do not make lines different');
});

test('renumberLists: continues, nests, keeps the first number, ignores fences and bullets', () => {
  assert.equal(T.renumberLists('1. a\n1. b\n5. c').text, '1. a\n2. b\n3. c');
  assert.equal(T.renumberLists('3. a\n9. b').text, '3. a\n4. b', 'the first number is the list start');
  assert.equal(T.renumberLists('1. a\n   1. x\n   1. y\n2. b').text, '1. a\n   1. x\n   2. y\n2. b', 'nested lists number themselves');
  assert.equal(T.renumberLists('1. a\n\ntext\n\n1. again\n3. b').text, '1. a\n\ntext\n\n1. again\n2. b', 'a paragraph at the margin ends the list');
  assert.equal(T.renumberLists('```\n1. a\n7. b\n```').changes, 0);
  assert.equal(T.renumberLists('1. a\n2) b\n3) c').text, '1. a\n2) b\n3) c', 'a different delimiter is another list');
  assert.equal(T.renumberLists('1. a\n2. b').changes, 0);
  assert.equal(T.renumberLists('1. a\n\n   para\n\n3. b').text, '1. a\n\n   para\n\n2. b', 'indented paragraphs keep the list going');
});

test('normalizeBullets', () => {
  assert.equal(T.normalizeBullets('* a\n  + b\n- c\n* * *\n**bold**\n*em*').text, '- a\n  - b\n- c\n* * *\n**bold**\n*em*');
  assert.equal(T.normalizeBullets('- a\n- b').changes, 0);
  assert.equal(T.normalizeBullets('- a\n+ b', '*').text, '* a\n* b');
  assert.equal(T.normalizeBullets('```\n* x\n```').changes, 0);
});

test('stripTrailing keeps deliberate line breaks as two spaces; collapseBlank leaves code alone', () => {
  assert.equal(T.stripTrailing('a   \nb \t\nc  \nd').text, 'a  \nb\nc  \nd', 'two or more spaces before a text line = a break');
  assert.equal(T.stripTrailing('last   ').text, 'last', 'no break after the last line');
  assert.equal(T.stripTrailing('a\n  \nb').text, 'a\n\nb');
  assert.equal(T.stripTrailing('```\ncode   \n```').text, '```\ncode\n```', 'trailing spaces in code are removed too, but never kept as a break');
  assert.equal(T.stripTrailing('clean').changes, 0);
  assert.equal(T.collapseBlank('a\n\n\n\nb\n').text, 'a\n\nb\n');
  assert.equal(T.collapseBlank('a\n\n\nb\n\n\n\n').text, 'a\n\nb\n');
  assert.equal(T.collapseBlank('```\nx\n\n\n\ny\n```').changes, 0, 'blank lines inside a fence are kept');
  assert.equal(T.collapseBlank('a\n\nb').changes, 0);
});

test('reflow and unwrap: paragraphs only; code spans, breaks, lists, headings, tables and code stay', () => {
  const para = 'The quick brown fox jumps over the lazy dog and keeps running far away.';
  assert.equal(T.reflow(para, { width: 30 }).text, 'The quick brown fox jumps over\nthe lazy dog and keeps running\nfar away.');
  const wrapped = T.reflow(para, { width: 30 }).text;
  assert.equal(T.unwrap(wrapped).text, para);
  assert.equal(T.reflow(wrapped, { width: 30 }).changes, 0, 'idempotent');
  assert.equal(T.reflow('see `a very long code span` here ok', { width: 20 }).text, 'see\n`a very long code span`\nhere ok', 'a code span is one word');
  assert.equal(T.reflow('# A heading that is much longer than twenty columns\n\n- a list item that is also much longer than twenty columns\n\n| a | b |\n|---|---|\n\n```\nlong code line long code line long code line\n```', { width: 20 }).changes, 0);
  assert.equal(T.reflow('one two three four five  \nsix seven eight', { width: 20 }).text, 'one two three four\nfive  \nsix seven eight', 'a hard break ends the group');
  assert.equal(T.reflow('a\nb\n\nc\nd', { width: 80 }).text, 'a b\n\nc d', 'short paragraphs are joined up to the width');
  assert.equal(T.reflow('Heading\n=======\ntext words go here', { width: 80 }).text, 'Heading\n=======\ntext words go here', 'a setext heading is not a paragraph');
  assert.equal(T.unwrap('line one\nline two\n\nnext para\nmore').text, 'line one line two\n\nnext para more');
  assert.equal(T.unwrap('single').changes, 0);
  assert.equal(T.unwrap('> quoted\n> lines').changes, 0, 'block quotes are left alone');
});

test('normalizeHeadings converts setext headings, not rules, tables or list items', () => {
  assert.equal(T.normalizeHeadings('Title\n=====\n\nSub\n---\n\ntext').text, '# Title\n\n## Sub\n\ntext');
  assert.equal(T.normalizeHeadings('text\n\n---\n\nmore').changes, 0, 'a rule after a blank line is a rule');
  assert.equal(T.normalizeHeadings('- item\n---').changes, 0);
  assert.equal(T.normalizeHeadings('| a |\n|---|').changes, 0);
  assert.equal(T.normalizeHeadings('```\nA\n=\n```').changes, 0);
});

test('toc: inserts below the first heading, updates between markers, github slugs, duplicates, levels, ignores code', () => {
  const doc = '# Guide\n\n## Install\ntext\n\n## Use `it`\n\n### Install\n\n```\n# not a heading\n```\n\n#### Deep\n';
  const r = T.toc(doc);
  assert.equal(r.text, '# Guide\n\n<!-- toc -->\n\n- [Guide](#guide)\n  - [Install](#install)\n  - [Use it](#use-it)\n    - [Install](#install-1)\n\n<!-- tocstop -->\n\n## Install\ntext\n\n## Use `it`\n\n### Install\n\n```\n# not a heading\n```\n\n#### Deep\n');
  assert.match(r.note, /inserted a table of contents with 4 entries/);
  assert.equal(T.toc(r.text).changes, 0, 'up to date');
  const updated = T.toc(r.text.replace('## Install\ntext', '## Setup\ntext'));
  assert.match(updated.text, /\[Setup\]\(#setup\)/);
  assert.ok(!updated.text.includes('#install-1'), 'with one Install renamed, the other is now the first and takes the plain slug');
  assert.equal((updated.text.match(/<!-- toc -->/g) || []).length, 1, 'the block is replaced, not duplicated');
  assert.match(updated.note, /updated/);
  assert.equal(T.toc(doc, { maxLevel: 2, bullet: '*' }).text.split('\n').filter((l) => l.includes('](#')).join('|'), '* [Guide](#guide)|  * [Install](#install)|  * [Use it](#use-it)');
  assert.equal(T.toc('no headings here').changes, 0);
  assert.match(T.toc('Title\n=====\n\ntext').text, /^Title\n=====\n\n<!-- toc -->/, 'after a setext heading too');
  assert.equal(T.toc('# A\n## [Link](http://x) and **bold**').text.includes('[Link and bold](#link-and-bold)'), true, 'inline markup is stripped like the preview does');
});

test('applyRange runs a transform on the whole lines of a selection', () => {
  const text = 'keep\nc\na\nb\nkeep too';
  const r = T.applyRange(text, 6, 10, (sub) => T.sortLines(sub));
  assert.equal(r.text, 'keep\na\nb\nc\nkeep too');
  assert.equal(text.slice(r.from, r.to), 'c\na\nb');
  assert.equal(r.text.slice(r.from, r.to), 'a\nb\nc');
  assert.equal(T.applyRange('a\nb', 0, 3, (s) => ({ text: s.toUpperCase(), changes: 1 })).text, 'A\nB');
  assert.equal(T.applyRange('a\nb\n', 0, 2, (s) => ({ text: s + '!', changes: 1 })).text, 'a!\nb\n', 'a selection ending in a newline does not take the next line');
});
