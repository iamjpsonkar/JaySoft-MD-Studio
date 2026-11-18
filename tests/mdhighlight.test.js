const test = require('node:test');
const assert = require('node:assert');
require('../core/ns.js');
require('../core/mdhighlight.js');
const { highlightLines } = globalThis.JSS.mdhighlight;

const classes = (line) => highlightLines(line)[0].filter((p) => p.c).map((p) => `${p.c}:${p.t}`);
const text = (lines) => lines.map((l) => l.map((p) => p.t).join('')).join('\n');

test('pieces always concatenate back to the exact text (the colour layer must mirror the textarea)', () => {
  const samples = [
    '# Title\n\nSome **bold**, *it*, `code`, [link](http://x.y "t") and ![img](a.png)\n\n- [ ] task\n  - nested\n1. one\n\n> quote **b**\n\n| a | b |\n|---|:-:|\n| 1 | 2 |\n\n```js\nconst a = `x`;\n```\n\n---\ntext\n===\n<!-- c\nmore -->\n<div class="x">&amp;</div>\nhttps://example.com/a_b_c  snake_case_word  2*3*4\n',
    '', '\n\n', '   ', '***', '`', '[unclosed](', '**', '~~~~\nstill code', '---\ntitle: x\n---\n# After front matter',
  ];
  for (const s of samples) assert.equal(text(highlightLines(s)), s, JSON.stringify(s));
  assert.equal(highlightLines('a\nb\n').length, 3, 'one entry per line, including the empty last one');
});

test('block syntax: headings, lists, tasks, quotes, rules, setext, tables', () => {
  assert.deepEqual(classes('## Hello *x*'), ['md-hmark:## ', 'md-h:Hello ', 'md-em:*x*']);
  assert.deepEqual(classes('#nospace'), [], 'not a heading without a space');
  assert.deepEqual(classes('- [x] done'), ['md-list:-', 'md-task:[x] ']);
  assert.deepEqual(classes('  12. item'), ['md-list:12.']);
  assert.deepEqual(classes('> **q**'), ['md-quote-mark:> ', 'md-strong:**q**']);
  assert.deepEqual(classes('---'), ['md-hr:---']);
  assert.deepEqual(classes('* * *'), ['md-hr:* * *']);
  assert.deepEqual(highlightLines('Title\n=====')[1].map((p) => p.c), ['md-hmark']);
  assert.deepEqual(highlightLines('- item\n---')[1].map((p) => p.c), ['md-hr'], 'a rule under a list item is a rule, not a heading underline');
  assert.deepEqual(classes('| a | b |'), ['md-pipe:|', 'md-pipe:|', 'md-pipe:|']);
  assert.deepEqual(classes('|---|:-:|'), ['md-tsep:|---|:-:|']);
});

test('fenced code, front matter and comments carry state across lines', () => {
  const l = highlightLines('```js\n# not a heading\n**not bold**\n```\n# real');
  assert.deepEqual(l.map((x) => x[0].c), ['md-fence', 'md-code', 'md-code', 'md-fence', 'md-hmark']);
  assert.deepEqual(highlightLines('````\n```\nstill code\n````\nafter').map((x) => x[0].c), ['md-fence', 'md-code', 'md-code', 'md-fence', null], 'a longer fence is only closed by an equally long one');
  assert.deepEqual(highlightLines('~~~\ncode\n```\n~~~').map((x) => x[0].c), ['md-fence', 'md-code', 'md-code', 'md-fence'], 'and only by the same character');
  assert.deepEqual(highlightLines('```\nunclosed\n# still code').map((x) => x[0].c), ['md-fence', 'md-code', 'md-code']);
  assert.deepEqual(highlightLines('---\ntitle: a\n---\n# H').map((x) => x[0].c), ['md-meta', 'md-meta', 'md-meta', 'md-hmark']);
  assert.deepEqual(highlightLines('a\n---\nb').map((x) => x[0].c), [null, 'md-hmark', null], '--- after the first line is not front matter');
  assert.deepEqual(highlightLines('<!-- one\ntwo\nthree -->\n# h').map((x) => x[0].c), ['md-comment', 'md-comment', 'md-comment', 'md-hmark']);
});

test('inline syntax: code, links, images, emphasis, urls, tags; underscores inside words are left alone', () => {
  assert.deepEqual(classes('a `x*y*` b'), ['md-icode:`x*y*`'], 'nothing inside a code span is emphasis');
  assert.deepEqual(classes('[t](http://u)'), ['md-mark:[', 'md-link-text:t', 'md-mark:](', 'md-link-url:http://u', 'md-mark:)']);
  assert.deepEqual(classes('![alt](p.png)').slice(0, 2), ['md-mark:![', 'md-link-text:alt']);
  assert.deepEqual(classes('see https://a.b/c.'), ['md-link-url:https://a.b/c.']);
  assert.deepEqual(classes('snake_case_word and 2*3*4'), ['md-em:*3*'], 'asterisks may emphasise inside a word (CommonMark), underscores may not');
  assert.ok(!classes('snake_case_word').length, 'underscores inside a word are not emphasis');
  assert.deepEqual(classes('__b__ _i_ ~~s~~'), ['md-strong:__b__', 'md-em:_i_', 'md-strike:~~s~~']);
  assert.deepEqual(classes('<b>x</b> &amp;'), ['md-tag:<b>', 'md-tag:</b>', 'md-entity:&amp;']);
  assert.deepEqual(classes('a * b * c'), [], 'spaced asterisks are not emphasis');
});

test('large input stays fast enough to run on every keystroke', () => {
  const big = Array.from({ length: 3000 }, (_, i) => `## Heading ${i}\n\nSome **bold** and *it* text with a [link](http://x/${i}) and \`code\`.\n\n- item ${i}\n`).join('');
  const t0 = Date.now();
  highlightLines(big);
  const ms = Date.now() - t0;
  console.log(`      perf: ${(big.length / 1024).toFixed(0)} KB highlighted in ${ms} ms`);
  assert.ok(ms < 1500, `${ms} ms`);
});
