// MD Studio UI behaviour added in the parity work: editor widget, find, tabs, status bar, palette, divider, transforms, export, problems, diff, web fallbacks.
const test = require('node:test');
const assert = require('node:assert');
const { boot, fakeHandle, sleep } = require('./helper');

const doc = async (t, text) => { t.click('btnNew'); await sleep(50); await t.type(text || ''); };
const menuItems = (t) => t.qa('.menu button').map((b) => b.textContent);
const pick = async (t, re, wait) => { t.click(t.qa('.menu button').find((b) => re.test(b.textContent))); await sleep(wait || 120); };
const ctrl = (t, k, o) => t.w.document.dispatchEvent(new t.w.KeyboardEvent('keydown', Object.assign({ key: k, ctrlKey: true, bubbles: true, cancelable: true }, o)));

// ====================================================================== editor widget
test('editor widget: one gutter number per line, colour layer mirrors the text, tokens are coloured, toggles work', async () => {
  const t = await boot();
  await doc(t, '# Title\n\nSome **bold** and `code` and [link](http://x.y)\n\n- [ ] task\n\n```js\nconst a = 1;\n```\n');
  const box = t.$('editorBox');
  const lines = t.editor.value.split('\n');
  assert.equal(box.querySelector('.ed-gutter').children.length, lines.length);
  assert.deepEqual([...box.querySelectorAll('.ed-gutter .n')].map((n) => n.textContent), lines.map((_, i) => String(i + 1)));
  const hl = box.querySelector('.ed-hl');
  assert.deepEqual([...hl.children].map((d) => d.textContent), lines, 'the colour layer is the text, line for line');
  for (const c of ['md-hmark', 'md-h', 'md-strong', 'md-icode', 'md-link-text', 'md-link-url', 'md-task', 'md-fence', 'md-code']) assert.ok(hl.querySelector(`.${c}`), c);
  assert.equal(hl.querySelectorAll('script, img, b').length, 0);
  await t.type('only one line');
  assert.equal(box.querySelector('.ed-gutter').children.length, 1, 'numbers follow the text');
  // toggles
  assert.equal(box.dataset.wrap, 'on'); assert.equal(box.dataset.lines, 'on');
  t.click('btnViewMenu');
  assert.deepEqual(menuItems(t).slice(0, 3), ['✓ Line numbers', '✓ Word wrap', '✓ Synced scrolling (split view)']);
  await pick(t, /Word wrap/);
  assert.equal(box.dataset.wrap, 'off');
  t.click('btnViewMenu'); await pick(t, /Line numbers/);
  assert.equal(box.dataset.lines, 'off');
  const prefs = JSON.parse(t.w.localStorage.getItem('mdstudio.prefs.v1'));
  assert.equal(prefs.wrap, false); assert.equal(prefs.lines, false);
  const t2 = await boot({ prefs });
  assert.equal(t2.$('editorBox').dataset.wrap, 'off', 'remembered');
  assert.deepEqual(t.errors, []);
});

test('editor widget: huge documents drop the layers and never wrap; bracket pair is marked (prose: apostrophes are not quotes)', async () => {
  const t = await boot();
  await doc(t, 'x');
  await t.type('a '.repeat(150000), 400);
  assert.ok(t.$('editorBox').classList.contains('plain'));
  assert.equal(t.$('editorBox').dataset.wrap, 'off', 'plain mode forces no wrapping so numbers stay level');
  assert.equal(t.q('.ed-hl').children.length, 0);
  await t.type("it's (see [the docs]) and don't");
  assert.ok(!t.$('editorBox').classList.contains('plain'));
  t.editor.focus();
  t.editor.setSelectionRange(5, 5);
  t.editor.dispatchEvent(new t.w.Event('keyup', { bubbles: true }));
  assert.deepEqual([...t.qa('.ed-brk mark')].map((m) => m.textContent), ['(', ')'], 'the apostrophes do not hide the brackets');
});

test('find and replace: marks, counts, regex, replace one / all, Ctrl/Cmd+F, Esc', async () => {
  const t = await boot();
  await doc(t, 'Ann met ann. Bob met Ann2.');
  t.view('edit');
  t.click('btnFind');
  const bar = t.q('#editorPane .findbar') || t.q('.findbar');
  assert.equal(bar.hidden, false);
  const [term, repl] = bar.querySelectorAll('input.field');
  const [rx, cs] = bar.querySelectorAll('input[type="checkbox"]');
  const set = (el, v) => { el.value = v; el.dispatchEvent(new t.w.Event('input', { bubbles: true })); };
  const count = () => bar.querySelector('.meta').textContent;
  set(term, 'ann');
  assert.equal(count(), '1 / 3');
  assert.equal(t.qa('.ed-find mark').length, 3);
  assert.equal(t.qa('.ed-find mark.cur').length, 1);
  assert.deepEqual([...t.q('.ed-find').children].map((d) => d.textContent), ['Ann met ann. Bob met Ann2.'], 'marks mirror the text');
  cs.checked = true; cs.dispatchEvent(new t.w.Event('change')); assert.equal(count(), '1 / 1');
  cs.checked = false; cs.dispatchEvent(new t.w.Event('change'));
  rx.checked = true; rx.dispatchEvent(new t.w.Event('change'));
  set(term, '(');
  assert.equal(count(), 'invalid regex');
  set(term, '(A)nn(\\d)?');
  set(repl, '$1_$2');
  t.click([...bar.querySelectorAll('button')].find((b) => b.textContent === 'Replace'));
  await sleep(120);
  assert.equal(t.editor.value, 'Ann met a_. Bob met Ann2.', 'the current match is the first one at or after the caret (the second "ann" was selected), with $1 filled in');
  rx.checked = false; rx.dispatchEvent(new t.w.Event('change'));
  set(term, 'met'); set(repl, 'saw');
  t.click([...bar.querySelectorAll('button')].find((b) => b.textContent === 'All'));
  await sleep(120);
  assert.equal(t.editor.value, 'Ann saw a_. Bob saw Ann2.');
  assert.match(t.$('toast').textContent, /Replaced 2 matches/);
  t.key(term, 'Escape');
  assert.equal(bar.hidden, true);
  assert.equal(t.qa('.ed-find mark').length, 0);
  // Ctrl+F from the editor, with a selected word
  t.editor.focus(); t.editor.setSelectionRange(0, 2);
  t.key(t.editor, 'f', { ctrlKey: true });
  assert.equal(bar.hidden, false);
  assert.equal(term.value, 'An');
  assert.deepEqual(t.errors, []);
});

// ====================================================================== tabs, status bar, line endings
test('each tab keeps its own view; names are numbered; double-click renames; a file-backed tab is detached after confirmation', async () => {
  const t = await boot();
  t.click('btnNew'); await sleep(50); t.view('edit');
  t.click('btnNew'); await sleep(50); t.view('preview');
  assert.equal(t.$('main').dataset.view, 'preview');
  t.click(t.q('#tabs .tab')); await sleep(60);
  assert.equal(t.$('main').dataset.view, 'edit', 'tab 1 is back in Edit');
  t.click(t.qa('#tabs .tab')[1]); await sleep(60);
  assert.equal(t.$('main').dataset.view, 'preview', 'tab 2 is back in Preview');
  t.w.dispatchEvent(new t.w.Event('beforeunload'));
  const s2 = JSON.parse(t.w.sessionStorage.getItem('mdstudio.session.v1'));
  assert.deepEqual(s2.docs.map((d) => d.view), ['edit', 'preview'], 'views are part of the session');
  // rename
  t.qa('#tabs .tab')[1].dispatchEvent(new t.w.MouseEvent('dblclick', { bubbles: true }));
  const input = t.q('#tabs input.tab-edit');
  assert.ok(input);
  input.value = 'a/b\\notes.md';
  t.key(input, 'Enter');
  assert.equal(t.tabs()[1], 'a-b-notes.md', 'path separators cannot sneak into a name');
  t.qa('#tabs .tab')[1].dispatchEvent(new t.w.MouseEvent('dblclick', { bubbles: true }));
  const box = t.q('#tabs input.tab-edit');
  box.value = 'nope'; t.key(box, 'Escape');
  assert.equal(t.tabs()[1], 'a-b-notes.md');
  // file-backed
  const log = [];
  t.w.showOpenFilePicker = async () => [fakeHandle('real.md', '# real\n', log)];
  t.click('btnOpen'); await sleep(200);
  t.w.confirm = () => false;
  t.qa('#tabs .tab')[2].dispatchEvent(new t.w.MouseEvent('dblclick', { bubbles: true }));
  let inp = t.q('#tabs input.tab-edit'); inp.value = 'copy.md'; t.key(inp, 'Enter');
  assert.equal(t.tabs()[2], 'real.md', 'declining keeps the file link and the name');
  t.w.confirm = () => true;
  t.qa('#tabs .tab')[2].dispatchEvent(new t.w.MouseEvent('dblclick', { bubbles: true }));
  inp = t.q('#tabs input.tab-edit'); inp.value = 'copy.md'; t.key(inp, 'Enter');
  assert.equal(t.tabs()[2], 'copy.md');
  assert.ok(t.qa('#tabs .tab')[2].querySelector('.dirty'), 'detached: the content is not on disk under the new name');
  let asked = null;
  t.w.showSaveFilePicker = async (o) => { asked = o.suggestedName; throw Object.assign(new Error('cancel'), { name: 'AbortError' }); };
  t.click('btnSave'); await sleep(100);
  assert.equal(asked, 'copy.md', 'Save now asks where, suggesting the new name');
  assert.deepEqual(log, [], 'the original file was never written');
  assert.deepEqual(t.errors, []);
});

test('status bar: selection count, line ending button; a line-ending change alone is an unsaved change and is saved', async () => {
  const t = await boot();
  const log = [];
  t.w.showOpenFilePicker = async () => [fakeHandle('win.md', 'one\r\ntwo\r\n', log)];
  t.click('btnOpen'); await sleep(200);
  assert.equal(t.$('stEol').textContent, 'CRLF');
  t.editor.focus(); t.editor.setSelectionRange(0, 7);
  t.editor.dispatchEvent(new t.w.Event('select', { bubbles: true }));
  assert.equal(t.$('stPos').textContent, 'Ln 1, Col 1 (7 selected)');
  assert.equal(t.$('stSave').textContent, 'Saved');
  t.click('stEol'); await sleep(60);
  assert.equal(t.$('stEol').textContent, 'LF');
  assert.equal(t.$('stSave').textContent, 'Unsaved changes', 'only the line ending changed, and that counts');
  assert.ok(t.q('#tabs .tab .dirty'));
  t.click('btnSave'); await sleep(200);
  assert.deepEqual(log, [['win.md', 'one\ntwo\n']], 'saved with the new line ending');
  assert.equal(t.$('stSave').textContent, 'Saved');
  assert.deepEqual(t.errors, []);
});

// ====================================================================== command palette, divider, synced scrolling
test('command palette: Ctrl+Shift+P, filter, run, Escape; commands follow the state', async () => {
  const t = await boot();
  const titles = () => [...t.w.document.querySelectorAll('#palList li')].map((l) => l.firstChild.textContent);
  ctrl(t, 'p', { shiftKey: true });
  assert.equal(t.$('palette').hidden, false);
  assert.ok(!titles().includes('View: Diff'), 'no document yet: nothing that needs one');
  assert.ok(titles().includes('New document'));
  const set = (v) => { t.$('palInput').value = v; t.$('palInput').dispatchEvent(new t.w.Event('input')); };
  set('new doc');
  t.key(t.$('palInput'), 'Enter'); await sleep(60);
  assert.deepEqual(t.tabs(), ['Untitled.md']);
  assert.equal(t.$('palette').hidden, true);
  ctrl(t, 'p', { shiftKey: true });
  set('view: diff'); assert.deepEqual(titles(), ['View: Diff']);
  t.key(t.$('palInput'), 'Enter'); await sleep(60);
  assert.equal(t.$('main').dataset.view, 'diff');
  t.click('btnPalette');
  set('format: bold');
  assert.deepEqual(titles(), ['Format: Bold']);
  t.key(t.$('palInput'), 'Escape');
  assert.equal(t.$('palette').hidden, true);
  t.w.document.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'F1', bubbles: true, cancelable: true }));
  assert.equal(t.$('palette').hidden, false);
  assert.deepEqual(t.errors, []);
});

test('divider between editor and preview: drag, keys, reset, remembered; only in split view; sync toggle', async () => {
  const t = await boot();
  await doc(t, '# x');
  t.view('split');
  const split = t.$('paneSplit');
  const rect = (l, r) => ({ left: l, right: r, width: r - l });
  t.$('editorPane').getBoundingClientRect = () => rect(0, 500);
  t.$('preview').getBoundingClientRect = () => rect(500, 1000);
  const ptr = (type, o) => split.dispatchEvent(new t.w.MouseEvent(type, Object.assign({ bubbles: true, cancelable: true, button: 0 }, o)));
  const flex = (el) => el.style.flex.replace(/ 0px$/, ' 0');
  ptr('pointerdown'); ptr('pointermove', { clientX: 300 });
  assert.equal(flex(t.$('editorPane')), '0.3 1 0');
  assert.equal(flex(t.$('preview')), '0.7 1 0');
  ptr('pointermove', { clientX: 5 });
  assert.equal(flex(t.$('editorPane')), '0.15 1 0', 'clamped');
  ptr('pointerup');
  assert.equal(JSON.parse(t.w.localStorage.getItem('mdstudio.prefs.v1')).split, 0.15);
  t.key(split, 'ArrowRight');
  assert.equal(Math.round(JSON.parse(t.w.localStorage.getItem('mdstudio.prefs.v1')).split * 100), 17);
  split.dispatchEvent(new t.w.MouseEvent('dblclick', { bubbles: true }));
  assert.equal(flex(t.$('editorPane')), '0.5 1 0');
  t.view('edit');
  assert.equal(t.$('editorPane').style.flex, '', 'the saved split only applies in split view');
  // synced scrolling can be switched off
  t.view('split');
  const dim = (el, sh, ch) => { Object.defineProperty(el, 'scrollHeight', { value: sh, configurable: true }); Object.defineProperty(el, 'clientHeight', { value: ch, configurable: true }); };
  dim(t.editor, 1000, 200); dim(t.$('preview'), 2000, 200);
  t.editor.scrollTop = 400; t.editor.dispatchEvent(new t.w.Event('scroll'));
  assert.equal(t.$('preview').scrollTop, 900, 'proportional');
  await sleep(120);
  t.click('btnViewMenu'); await pick(t, /Synced scrolling/);
  t.$('preview').scrollTop = 0;
  await sleep(120);
  t.editor.scrollTop = 800; t.editor.dispatchEvent(new t.w.Event('scroll'));
  assert.equal(t.$('preview').scrollTop, 0, 'off: the preview stays');
  assert.deepEqual(t.errors, []);
});

// ====================================================================== transforms
test('Transform menu: runs on the selection or the whole document, says when nothing changes, needs a selection where it must', async () => {
  const t = await boot();
  await doc(t, '| a | bb |\n|---|---|\n| 1 | 2 |\n\nzeta\nalpha\nmid\n');
  t.editor.focus(); t.editor.setSelectionRange(0, 0);
  t.click('btnTransform');
  assert.equal(menuItems(t).length, 13, 'every transform is listed');
  assert.equal(t.qa('.menu .menu-sep').length, 3, 'in groups');
  await pick(t, /Format tables/);
  assert.equal(t.editor.value.split('\n')[0], '| a   | bb  |');
  assert.match(t.$('toast').textContent, /formatted 1 table.*Undo with Ctrl\/Cmd\+Z/);
  t.click('btnTransform'); await pick(t, /Format tables/);
  assert.match(t.$('toast').textContent, /already aligned/);
  // sorting needs a selection
  t.click('btnTransform'); await pick(t, /Sort lines.*A → Z/);
  assert.match(t.$('toast').textContent, /select the lines first/);
  const v = t.editor.value;
  t.editor.setSelectionRange(v.indexOf('zeta'), v.indexOf('mid') + 3);
  t.click('btnTransform'); await pick(t, /Sort lines.*A → Z/);
  assert.equal(t.editor.value.slice(t.editor.value.indexOf('alpha')), 'alpha\nmid\nzeta\n');
  assert.equal(t.editor.value.slice(0, 11), '| a   | bb ', 'lines outside the selection are untouched');
  assert.equal(t.editor.value.slice(t.editor.selectionStart, t.editor.selectionEnd), 'alpha\nmid\nzeta', 'the transformed lines stay selected');
  // preview view: the editor is brought up first
  t.view('preview');
  t.click('btnTransform'); await pick(t, /Trim trailing/);
  assert.equal(t.$('main').dataset.view, 'split');
  assert.deepEqual(t.errors, []);
});

test('Transform dialogs: sort table by column, reflow width, table of contents', async () => {
  const t = await boot();
  await doc(t, '# Guide\n\n## B\n\n| Item | Price |\n|---|---|\n| b | 10 |\n| a | 9 |\n\nThe quick brown fox jumps over the lazy dog and keeps running far away.\n');
  const dlg = () => t.q('.modal');
  const submit = (fields) => { const sel = [...dlg().querySelectorAll('select, input[type="text"]')]; Object.entries(fields).forEach(([i, val]) => { sel[i].value = val; }); dlg().dispatchEvent(new t.w.Event('submit', { cancelable: true })); };
  // sort table: the caret must be in a table
  t.editor.focus(); t.editor.setSelectionRange(0, 0);
  t.click('btnTransform'); await pick(t, /Sort table/);
  assert.match(t.$('toast').textContent, /caret inside a table/);
  const at = t.editor.value.indexOf('| b |');
  t.editor.setSelectionRange(at + 2, at + 2);
  t.click('btnTransform'); await pick(t, /Sort table/);
  assert.ok(dlg());
  assert.deepEqual([...dlg().querySelectorAll('select')[0].options].map((o) => o.textContent), ['Item', 'Price']);
  submit({ 0: '2', 1: 'asc' }); await sleep(150);
  assert.equal(t.editor.value.split('\n').slice(6, 8).map((l) => l[2]).join(''), 'ab');
  // reflow
  t.editor.setSelectionRange(0, 0);
  t.click('btnTransform'); await pick(t, /Reflow/);
  submit({ 0: '30' }); await sleep(150);
  assert.match(t.editor.value, /The quick brown fox jumps over\nthe lazy dog and keeps running\nfar away\./);
  // table of contents
  t.click('btnTransform'); await pick(t, /table of contents/);
  submit({ 0: '2' }); await sleep(150);
  assert.match(t.editor.value, /<!-- toc -->\n\n- \[Guide\]\(#guide\)\n  - \[B\]\(#b\)\n\n<!-- tocstop -->/);
  t.key(dlg() || t.q('body'), 'Escape');
  assert.deepEqual(t.errors, []);
});

// ====================================================================== export
test('Export: copy as HTML / plain text, save as HTML through the file picker, print', async () => {
  const t = await boot();
  await doc(t, '# Title\n\nSome **bold** text <script>x</script>\n');
  t.view('edit'); // the preview is not drawn in Edit view: export must force it
  t.click('btnExport');
  assert.deepEqual(menuItems(t), ['Copy as formatted text', 'Copy as HTML', 'Copy as plain text', 'Save as HTML…', 'Save as plain text…', 'Print / Save as PDF…']);
  await pick(t, /Copy as HTML/, 60);
  const html = t.w.__copied.pop();
  assert.match(html, /<h1[^>]*>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.ok(!/<script/i.test(html), 'sanitised');
  t.click('btnExport'); await pick(t, /Copy as plain text/, 60);
  assert.equal(t.w.__copied.pop(), 'Title\n\nSome bold text x\n'.replace('x\n', 'x\n'));
  const log = [];
  let suggested;
  t.w.showSaveFilePicker = async (o) => { suggested = o.suggestedName; const h = fakeHandle(o.suggestedName, '', log); return h; };
  t.click('btnExport'); await pick(t, /Save as HTML/, 150);
  assert.equal(suggested, 'Untitled.html');
  assert.match(log[0][1], /^<!doctype html>/);
  assert.match(log[0][1], /<title>Untitled<\/title>/);
  assert.match(log[0][1], /<h1[^>]*>Title<\/h1>/);
  assert.ok(!/<script/i.test(log[0][1]), 'a static page');
  let printed = 0;
  t.w.print = () => { printed++; };
  t.click('btnExport'); await pick(t, /Print/, 60);
  assert.equal(printed, 1);
  assert.deepEqual(t.errors, []);
});

// ====================================================================== problems, diff
test('Problems: badge counts errors and warnings as you type; the panel lists them and jumps to the place', async () => {
  const t = await boot();
  await doc(t, '# A\n\n### C\n\n[x]()\n');
  await sleep(600);
  assert.equal(t.$('problemCount').hidden, false);
  assert.equal(t.$('problemCount').textContent, '2');
  t.click('btnProblems'); await sleep(60);
  assert.equal(t.$('problems').hidden, false);
  const rows = t.qa('#problemList .p-row').map((r) => r.querySelector('.p-rule').textContent);
  assert.deepEqual(rows, ['heading-increment', 'empty-link']);
  assert.match(t.$('problemSummary').textContent, /2 warnings/);
  t.view('preview');
  t.click(t.qa('#problemList .p-row')[1]);
  assert.equal(t.$('main').dataset.view, 'split', 'the editor is brought up');
  assert.equal(t.editor.selectionStart, t.editor.value.indexOf('[x]()'));
  await t.type('# A\n\n## B\n\n```\nunclosed');
  await sleep(600);
  assert.equal(t.$('problemCount').classList.contains('err'), true, 'an error turns the badge red');
  assert.equal(t.$('problemCount').textContent, '1');
  await t.type('# Fine\n\ntext\n');
  await sleep(600);
  assert.equal(t.$('problemCount').hidden, true);
  assert.match(t.$('problemList').textContent, /No problems found/);
  t.click('problemsClose');
  assert.equal(t.$('problems').hidden, true);
  assert.deepEqual(t.errors, []);
});

test('Diff view: against the saved version or another tab, stats, hide unchanged, jump to a line', async () => {
  const t = await boot();
  const log = [];
  t.w.showOpenFilePicker = async () => [fakeHandle('a.md', '# T\n\none\ntwo\nthree\nfour\nfive\nsix\nseven\n', log)];
  t.click('btnOpen'); await sleep(200);
  t.view('diff');
  assert.match(t.$('diffStats').textContent, /Identical/);
  t.view('edit');
  await t.type('# T\n\none\nTWO\nthree\nfour\nfive\nsix\nseven\nnew last\n');
  t.view('diff'); await sleep(60);
  assert.match(t.$('diffStats').textContent, /\+1 added/);
  assert.match(t.$('diffStats').textContent, /~1 changed/);
  const rows = () => t.qa('#diffBody .trow:not(.gap)');
  assert.ok(rows().some((r) => r.classList.contains('change') && r.querySelector('.a').textContent === 'two' && r.querySelector('.b').textContent === 'TWO'));
  assert.ok(t.qa('#diffBody .trow.gap').length >= 0);
  assert.match(t.q('.diff-hdr').textContent, /A · a\.md \(saved\)/);
  // hide unchanged off shows every line
  t.$('diffCollapse').checked = false; t.$('diffCollapse').dispatchEvent(new t.w.Event('change'));
  assert.equal(rows().length, 11);
  t.$('diffCollapse').checked = true; t.$('diffCollapse').dispatchEvent(new t.w.Event('change'));
  t.click('diffNext');
  assert.equal(t.$('diffPos').textContent, '1 / 2');
  // another tab
  t.click('btnNew'); await sleep(50);
  await t.type('# T\n\none\ntwo\n');
  t.view('diff'); await sleep(60);
  const opts = [...t.$('diffAgainst').options].map((o) => o.textContent);
  assert.deepEqual(opts, ['Saved version (as opened or last saved)', 'a.md']);
  t.$('diffAgainst').value = t.$('diffAgainst').options[1].value;
  t.$('diffAgainst').dispatchEvent(new t.w.Event('change'));
  assert.match(t.q('.diff-hdr').textContent, /A · a\.md/);
  assert.match(t.q('.diff-hdr').textContent, /B · Untitled\.md \(this tab\)/);
  assert.match(t.$('diffStats').textContent, /−\d+ removed/);
  // clicking a line goes to the editor
  const row = rows().find((r) => r.querySelector('.b').textContent === 'two');
  t.click(row);
  assert.equal(t.$('main').dataset.view, 'split');
  assert.equal(t.editor.value.slice(t.editor.selectionStart, t.editor.selectionStart + 3), 'two');
  assert.deepEqual(t.errors, []);
});

// ====================================================================== the web version
test('web version: no chrome APIs needed; Open uses a file input; Save downloads (CRLF kept); session stays out of localStorage on github.io', async () => {
  const t = await boot({ extension: false, url: 'https://someone.github.io/JaySoft-MD-Studio/' });
  assert.equal(t.$('webHint').hidden, false, 'the web hint is shown');
  assert.deepEqual(t.errors, []);
  const input = t.$('fileInput');
  const file = (name, text) => ({ name, size: text.length, lastModified: 1, text: async () => text });
  const choose = async (files) => { Object.defineProperty(input, 'files', { value: files, configurable: true }); await sleep(20); input.dispatchEvent(new t.w.Event('change')); await sleep(150); };
  t.click('btnOpen');
  await choose([file('a.md', '# A\r\ntext\r\n'), file('bin.md', 'x\u0000y'), file('b.md', '# B\n')]);
  assert.deepEqual(t.tabs(), ['a.md', 'b.md']);
  assert.match(t.$('toast').textContent, /Opened a copy/);
  t.click('btnOpen'); await sleep(20);
  input.dispatchEvent(new t.w.Event('cancel')); await sleep(60);
  assert.equal(t.tabs().length, 2, 'cancel opens nothing');
  // save = download, with the file's own line ending
  const dl = [];
  t.w.URL.createObjectURL = (blob) => { dl.push({ blob }); return 'blob:x'; };
  t.w.URL.revokeObjectURL = () => {};
  t.w.HTMLAnchorElement.prototype.click = function () { dl[dl.length - 1].name = this.getAttribute('download'); };
  t.click(t.qa('#tabs .tab')[0]); await sleep(60);
  await t.type('# A\nedited\n');
  t.click('btnSave'); await sleep(100);
  assert.equal(dl[0].name, 'a.md');
  assert.equal(await dl[0].blob.text(), '# A\r\nedited\r\n');
  assert.match(t.$('toast').textContent, /Downloaded a\.md/);
  assert.equal(t.$('stSave').textContent, 'Saved');
  // github.io: the session (document text) is never written to localStorage
  t.w.dispatchEvent(new t.w.Event('beforeunload'));
  assert.equal(t.w.localStorage.getItem('mdstudio.session.v1'), null);
  assert.equal(t.w.localStorage.getItem('mdstudio.recover.v1'), null, 'and no copy of the documents anywhere in shared storage');
  assert.ok(t.w.sessionStorage.getItem('mdstudio.session.v1'), 'kept for this tab only');
  assert.deepEqual(t.errors, []);
});

// ====================================================================== every tab is its own workspace
const snapshot = (t) => t.w.localStorage.getItem('mdstudio.recover.v1');

test('a tab keeps its own session in its own session storage; the last session is also kept for the welcome screen', async () => {
  const t = await boot();
  await doc(t, '# kept');
  t.w.dispatchEvent(new t.w.Event('beforeunload'));
  const own = JSON.parse(t.w.sessionStorage.getItem('mdstudio.session.v1'));
  assert.equal(own.docs[0].text, '# kept');
  assert.equal(t.w.localStorage.getItem('mdstudio.session.v1'), null, 'the live session is no longer shared through localStorage');
  assert.equal(JSON.parse(snapshot(t)).docs[0].text, '# kept', 'the last session is kept so it can be offered later');
});

test('two tabs are independent: a new tab starts empty (no documents pulled in from another tab) and only offers to restore the last session', async () => {
  const tab1 = await boot();
  await doc(tab1, '# From the first tab\n\ntext');
  tab1.w.dispatchEvent(new tab1.w.Event('beforeunload'));
  const shared = { 'mdstudio.recover.v1': snapshot(tab1) }; // what a second tab can see: localStorage is shared, sessionStorage is not
  const tab2 = await boot({ local: shared });
  assert.deepEqual(tab2.tabs(), [], 'nothing from tab 1 is opened');
  assert.equal(tab2.$('welcome').hidden, false);
  assert.equal(tab2.editor.value, '');
  assert.equal(tab2.$('restoreBox').hidden, false, 'but the last session is offered');
  assert.equal(tab2.$('btnRestore').textContent, 'Restore your last session (1 document)');
  // working in tab 2 does not touch tab 1
  await doc(tab2, '# Only in the second tab');
  assert.equal(tab1.editor.value, '# From the first tab\n\ntext');
  assert.deepEqual(tab1.tabs(), ['Untitled.md']);
  assert.notEqual(tab2.w.sessionStorage.getItem('mdstudio.session.v1'), tab1.w.sessionStorage.getItem('mdstudio.session.v1'));
  // the offer is hidden once the tab has a document
  assert.equal(tab2.$('restoreBox').hidden, true);
  assert.deepEqual(tab1.errors.concat(tab2.errors), []);
});

test('"Restore your last session" is an explicit action: documents come back as copies with their own ids, in this tab only', async () => {
  const src = { activeId: 'old-2', docs: [
    { id: 'old-1', name: 'a.md', text: '# A', saved: '# A', eol: '\n', view: 'edit', hasHandle: false, sel: [0, 0], scroll: 0 },
    { id: 'old-2', name: 'b.md', text: '# B edited', saved: '# B', eol: '\r\n', savedEol: '\r\n', view: 'preview', hasHandle: false, sel: [0, 0], scroll: 0 },
  ] };
  const t = await boot({ local: { 'mdstudio.recover.v1': src } });
  assert.equal(t.$('btnRestore').textContent, 'Restore your last session (2 documents)');
  t.click('btnRestore'); await sleep(250);
  assert.deepEqual(t.tabs(), ['a.md', 'b.md']);
  assert.equal(t.editor.value, '# B edited', 'the document that was active is active again');
  assert.equal(t.$('stSave').textContent, 'Unsaved changes', 'unsaved text is still unsaved');
  assert.equal(t.$('stEol').textContent, 'CRLF');
  const mine = JSON.parse(t.w.sessionStorage.getItem('mdstudio.session.v1') || 'null') || (t.w.dispatchEvent(new t.w.Event('beforeunload')), JSON.parse(t.w.sessionStorage.getItem('mdstudio.session.v1')));
  assert.ok(mine.docs.every((d) => !['old-1', 'old-2'].includes(d.id)), 'new ids: closing a document here never affects the same document in another tab');
  assert.match(t.$('toast').textContent, /Restored 2 documents/);
  assert.deepEqual(t.errors, []);
});

test('the restore offer can be dismissed; an empty tab never overwrites the last session; an old shared session is kept once as the last session', async () => {
  const one = { activeId: 'x', docs: [{ id: 'x', name: 'n.md', text: 'hi', saved: 'hi', eol: '\n', view: 'edit', hasHandle: false, sel: [0, 0], scroll: 0 }] };
  const t = await boot({ local: { 'mdstudio.recover.v1': one } });
  t.w.dispatchEvent(new t.w.Event('beforeunload')); // an empty tab closing
  assert.equal(JSON.parse(snapshot(t)).docs[0].text, 'hi', 'the last session survives an empty tab');
  t.click('btnDismissRestore'); await sleep(50);
  assert.equal(snapshot(t), null, 'dismissed means forgotten');
  assert.equal(t.$('restoreBox').hidden, true);
  // an old version kept one shared session under the old key
  const legacy = await boot({ local: { 'mdstudio.session.v1': one } });
  assert.equal(legacy.w.localStorage.getItem('mdstudio.session.v1'), null, 'moved out of the shared key');
  assert.equal(JSON.parse(snapshot(legacy)).docs[0].text, 'hi');
  assert.equal(legacy.$('restoreBox').hidden, false, 'and still restorable from the welcome screen');
  assert.deepEqual(legacy.tabs(), [], 'but not applied by itself');
});

// ====================================================================== editing in the preview
const blocks = (t) => t.qa('#previewBody .md-block');
const dbl = (t, el) => el.dispatchEvent(new t.w.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
const boxOf = (t) => t.q('#previewBody textarea.md-block-edit');

test('preview editing: every Markdown block remembers its exact source range, and nothing visible changes', async () => {
  const t = await boot();
  const src = '# Title\n\nPara one\nline two\n\n- a\n- b\n\n```js\nlet x = 1;\n```\n\n> quote\n';
  await doc(t, src);
  t.view('preview'); await sleep(250);
  const bs = blocks(t);
  assert.deepEqual(bs.map((b) => src.slice(Number(b.dataset.s), Number(b.dataset.e))), ['# Title\n\n', 'Para one\nline two', '- a\n- b', '```js\nlet x = 1;\n```', '> quote\n']);
  assert.equal(t.preview().dataset.edit, 'on');
  const plain = t.w.document.createElement('div');
  plain.innerHTML = t.w.DOMPurify.sanitize(t.w.marked.parse(src), { USE_PROFILES: { html: true } });
  assert.equal(t.preview().textContent, plain.textContent, 'the same text as an unwrapped render');
  assert.equal(t.preview().querySelectorAll('h1, p, ul, pre, blockquote').length, plain.querySelectorAll('h1, p, ul, pre, blockquote').length);
  assert.deepEqual(t.errors, []);
});

test('preview editing: double-click, edit, Ctrl/Cmd+Enter applies only that block; Escape cancels; clicking outside applies; empty deletes', async () => {
  const t = await boot();
  await doc(t, '# Title\n\nPara one\nline two\n\nLast paragraph\n');
  t.view('preview'); await sleep(250);
  const para = () => blocks(t)[1];
  dbl(t, para());
  const ta = boxOf(t);
  assert.ok(ta, 'a box opens in place');
  assert.equal(ta.value, 'Para one\nline two', 'the block\'s own Markdown, without the blank lines after it');
  assert.equal(t.w.document.activeElement, ta);
  ta.value = 'Edited **bold**\nstill two lines'; ta.dispatchEvent(new t.w.Event('input'));
  t.key(ta, 'Enter', { ctrlKey: true });
  await sleep(300);
  assert.equal(t.editor.value, '# Title\n\nEdited **bold**\nstill two lines\n\nLast paragraph\n', 'only that block changed, the spacing is intact');
  assert.match(para().innerHTML, /<strong>bold<\/strong>/, 'the preview shows the result');
  assert.ok(t.q('#tabs .tab .dirty'), 'the document is now unsaved');
  assert.equal(boxOf(t), null);
  // Escape cancels
  dbl(t, para());
  boxOf(t).value = 'discarded'; t.key(boxOf(t), 'Escape');
  await sleep(100);
  assert.equal(t.editor.value, '# Title\n\nEdited **bold**\nstill two lines\n\nLast paragraph\n');
  assert.equal(boxOf(t), null);
  // unchanged text is not an edit
  dbl(t, blocks(t)[2]); const same = boxOf(t); same.dispatchEvent(new t.w.Event('blur'));
  await sleep(100);
  assert.equal(t.editor.value, '# Title\n\nEdited **bold**\nstill two lines\n\nLast paragraph\n');
  // clicking outside (blur) applies
  dbl(t, blocks(t)[0]);
  boxOf(t).value = '## Smaller title';
  boxOf(t).dispatchEvent(new t.w.Event('blur'));
  await sleep(300);
  assert.equal(t.editor.value.split('\n')[0], '## Smaller title');
  assert.match(t.preview().innerHTML, /<h2[^>]*>Smaller title<\/h2>/);
  // an empty box deletes the block, with the blank lines that followed it
  dbl(t, blocks(t)[1]);
  boxOf(t).value = '  \n'; t.key(boxOf(t), 'Enter', { metaKey: true });
  await sleep(300);
  assert.equal(t.editor.value, '## Smaller title\n\nLast paragraph\n', 'the blank lines around it went too');
  // a blank line inside the box splits the paragraph into two blocks
  dbl(t, blocks(t)[1]);
  boxOf(t).value = 'First\n\nSecond'; t.key(boxOf(t), 'Enter', { ctrlKey: true });
  await sleep(300);
  assert.equal(blocks(t).length, 3);
  assert.equal(t.editor.value, '## Smaller title\n\nFirst\n\nSecond\n');
  // deleting the last block leaves a clean end of file
  dbl(t, blocks(t)[2]);
  boxOf(t).value = ''; t.key(boxOf(t), 'Enter', { ctrlKey: true });
  await sleep(300);
  assert.equal(t.editor.value, '## Smaller title\n\nFirst\n');
  assert.deepEqual(t.errors, []);
});

test('preview editing: lists, tables and code blocks; links and checkboxes are not mistaken for editing; Tab indents inside the box', async () => {
  const t = await boot();
  await doc(t, '- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```\ncode\n```\n\n[link](#x)\n');
  t.view('preview'); await sleep(250);
  dbl(t, blocks(t)[0]);
  const ta = boxOf(t);
  assert.equal(ta.value, '- one\n- two');
  ta.setSelectionRange(5, 5);
  t.key(ta, 'Tab');
  assert.equal(ta.value, '- one  \n- two', 'Tab inserts two spaces at the caret');
  ta.value = '- one\n- two\n  - nested'; ta.dispatchEvent(new t.w.Event('input'));
  t.key(ta, 'Enter', { ctrlKey: true });
  await sleep(300);
  assert.match(t.editor.value, /^- one\n- two\n {2}- nested\n\n\| a \| b \|/);
  assert.equal(t.preview().querySelectorAll('ul ul').length, 1);
  // table and code blocks edit as their full source
  dbl(t, blocks(t)[1]);
  assert.equal(boxOf(t).value, '| a | b |\n|---|---|\n| 1 | 2 |');
  boxOf(t).dispatchEvent(new t.w.Event('blur')); await sleep(100);
  dbl(t, blocks(t)[2]);
  assert.equal(boxOf(t).value, '```\ncode\n```');
  boxOf(t).dispatchEvent(new t.w.Event('blur')); await sleep(100);
  // double-clicking a link does not open the editor
  dbl(t, t.preview().querySelector('a'));
  assert.equal(boxOf(t), null);
  assert.deepEqual(t.errors, []);
});

test('preview editing: task checkboxes toggle the right box in the source; checkboxes in code or other lists are not touched', async () => {
  const t = await boot();
  const src = '- [ ] one\n- [x] two\n\ntext\n\n- [ ] three\n  - [ ] nested\n\n> - [ ] quoted\n\n```\n- [ ] not a task\n```\n';
  await doc(t, src);
  t.view('preview'); await sleep(250);
  const boxes = () => t.qa('#previewBody input[type="checkbox"]');
  assert.equal(boxes().length, 5);
  assert.ok(boxes().every((c) => !c.disabled), 'enabled for clicking');
  t.click(boxes()[0]); await sleep(300);
  assert.equal(t.editor.value, src.replace('- [ ] one', '- [x] one'));
  t.click(boxOfTask(t, 1)); await sleep(300);
  assert.equal(t.editor.value.split('\n')[1], '- [ ] two', 'a checked box is unchecked');
  t.click(boxes()[3]); await sleep(300);
  assert.match(t.editor.value, /- \[ \] three\n {2}- \[x\] nested/, 'nested items work');
  t.click(boxes()[4]); await sleep(300);
  assert.match(t.editor.value, /> - \[x\] quoted/, 'inside a block quote too');
  assert.match(t.editor.value, /```\n- \[ \] not a task\n```/, 'code is left alone');
  function boxOfTask(tt, i) { return [...tt.qa('#previewBody input[type="checkbox"]')][i]; }
  assert.deepEqual(t.errors, []);
});

test('preview editing: raw HTML blocks stay unwrapped and keep their nesting; the setting turns it off; huge documents are drawn without wrappers', async () => {
  const t = await boot();
  await doc(t, '<details>\n<summary>More</summary>\n\nHidden **text**\n\n</details>\n\nAfter\n');
  t.view('preview'); await sleep(250);
  assert.ok(t.preview().querySelector('details > .md-block strong'), 'the Markdown between the HTML tags is still inside <details>');
  assert.equal(t.preview().querySelector('details > summary').closest('.md-block'), null, 'HTML itself is not wrapped');
  assert.ok(t.preview().querySelector('.md-block p'));
  // setting
  t.click('btnViewMenu');
  const item = t.qa('.menu button').find((b) => /Click to edit in the preview/.test(b.textContent));
  assert.match(item.textContent, /^✓/);
  t.click(item); await sleep(150);
  assert.equal(blocks(t).length, 0);
  assert.equal(t.preview().dataset.edit, 'off');
  assert.equal(JSON.parse(t.w.localStorage.getItem('mdstudio.prefs.v1')).previewEdit, false);
  t.click('btnViewMenu'); t.click(t.qa('.menu button').find((b) => /Click to edit in the preview/.test(b.textContent))); await sleep(150);
  assert.ok(blocks(t).length > 0, 'back on');
  // huge document
  await t.type(`# T\n\n${'word '.repeat(170000)}\n`, 700);
  t.view('preview'); await sleep(500);
  assert.equal(t.preview().dataset.edit, 'off', 'past the size limit there are no wrappers (render time)');
  assert.match(t.q('#previewBody .preview-note').textContent, /Click-to-edit is unavailable here \(this document is large\)/, 'and the preview says so instead of silently not working');
  assert.equal(blocks(t).length, 0);
  assert.ok(t.preview().querySelector('h1'), 'but the preview itself is fine');
  assert.deepEqual(t.errors, []);
});

test('preview editing: Ctrl/Cmd+Z and Ctrl/Cmd+Y step through preview edits, and refuse when the text has changed since', async () => {
  const t = await boot();
  await doc(t, 'alpha\n\nbeta\n');
  t.view('preview'); await sleep(250);
  const edit = async (i, text) => { dbl(t, blocks(t)[i]); boxOf(t).value = text; t.key(boxOf(t), 'Enter', { ctrlKey: true }); await sleep(300); };
  await edit(0, 'ALPHA'); await edit(1, 'BETA');
  assert.equal(t.editor.value, 'ALPHA\n\nBETA\n');
  const press = (k, o) => t.w.document.dispatchEvent(new t.w.KeyboardEvent('keydown', Object.assign({ key: k, ctrlKey: true, bubbles: true, cancelable: true }, o)));
  press('z'); await sleep(250);
  assert.equal(t.editor.value, 'ALPHA\n\nbeta\n');
  assert.match(t.preview().textContent, /beta/);
  press('z'); await sleep(250);
  assert.equal(t.editor.value, 'alpha\n\nbeta\n');
  press('z');
  assert.match(t.$('toast').textContent, /Nothing to undo/);
  press('y'); await sleep(250);
  assert.equal(t.editor.value, 'ALPHA\n\nbeta\n');
  press('z', { shiftKey: true }); await sleep(250);
  assert.equal(t.editor.value, 'ALPHA\n\nBETA\n', 'Ctrl+Shift+Z redoes too');
  // text changed from the editor in between: refuse, never overwrite
  t.view('split');
  await t.type('ALPHA\n\nBETA, then typed in the editor\n');
  t.editor.blur();
  press('z');
  assert.match(t.$('toast').textContent, /text changed since/);
  assert.equal(t.editor.value, 'ALPHA\n\nBETA, then typed in the editor\n');
  assert.deepEqual(t.errors, []);
});


test('preview editing: a long document (more blocks than the old limit) is still editable and shows no "unavailable" note', async () => {
  const t = await boot();
  const src = Array.from({ length: 2600 }, (_, i) => `Paragraph ${i}`).join('\n\n') + '\n';
  await doc(t, '');
  await t.type(src, 600);
  t.view('preview'); await sleep(900);
  assert.equal(t.preview().dataset.edit, 'on', `editable (${blocks(t).length} blocks)`);
  assert.equal(t.q('#previewBody .preview-note'), null);
  assert.equal(blocks(t).length, 2600);
  dbl(t, blocks(t)[2599]);
  assert.ok(boxOf(t));
  boxOf(t).value = 'The very last paragraph, edited.'; t.key(boxOf(t), 'Enter', { ctrlKey: true });
  await sleep(900);
  assert.ok(t.editor.value.endsWith('\n\nThe very last paragraph, edited.\n'), JSON.stringify(t.editor.value.slice(-60)));
  assert.deepEqual(t.errors, []);
});

// ====================================================================== block toolbar: Copy and Edit
const over = (t, el) => el.dispatchEvent(new t.w.MouseEvent('mouseover', { bubbles: true }));
const tools = (t) => t.q('.block-tools');
const toolBtn = (t, name) => t.q(`.block-tools [data-bt="${name}"]`);

test('block toolbar: hovering a block shows Copy and Edit; Copy gives the block\'s Markdown, or just the code for a code block', async () => {
  const t = await boot();
  await doc(t, '# Title\n\nA paragraph with **bold** text.\n\n- one\n- two\n\n```js\nconst a = [1, 2];\nconsole.log(a);\n```\n');
  t.view('preview'); await sleep(250);
  assert.equal(tools(t).hidden, true, 'hidden until you hover a block');
  over(t, blocks(t)[1]);
  assert.equal(tools(t).hidden, false);
  assert.equal(toolBtn(t, 'edit').hidden, false);
  t.click(toolBtn(t, 'copy')); await sleep(40);
  assert.equal(t.w.__copied.pop(), 'A paragraph with **bold** text.', 'the block\'s own Markdown, without the blank lines after it');
  assert.equal(toolBtn(t, 'copy').textContent, 'Copied ✓');
  assert.match(t.$('toast').textContent, /Copied the block \(Markdown\)/);
  over(t, blocks(t)[2]);
  t.click(toolBtn(t, 'copy')); await sleep(40);
  assert.equal(t.w.__copied.pop(), '- one\n- two');
  // a code block: only the code, no fences, and the text of the highlighted spans together
  over(t, t.preview().querySelector('pre'));
  t.click(toolBtn(t, 'copy')); await sleep(40);
  assert.equal(t.w.__copied.pop(), 'const a = [1, 2];\nconsole.log(a);');
  assert.match(t.$('toast').textContent, /Copied the code/);
  // hovering away hides it
  t.$('preview').dispatchEvent(new t.w.MouseEvent('mouseleave'));
  assert.equal(tools(t).hidden, true);
  assert.deepEqual(t.errors, []);
});

test('block toolbar: a code block inside a list copies its own code; Edit opens the block and the toolbar gets out of the way', async () => {
  const t = await boot();
  await doc(t, '- step one\n\n  ```sh\n  npm ci\n  npm test\n  ```\n\n- step two\n');
  t.view('preview'); await sleep(250);
  over(t, t.preview().querySelector('pre'));
  t.click(toolBtn(t, 'copy')); await sleep(40);
  assert.equal(t.w.__copied.pop(), 'npm ci\nnpm test', 'the code, not the whole list');
  assert.equal(toolBtn(t, 'edit').hidden, false, 'editing from a code block edits the list that contains it');
  t.click(toolBtn(t, 'edit'));
  assert.ok(t.q('#previewBody textarea.md-block-edit'));
  assert.match(t.q('#previewBody textarea.md-block-edit').value, /^- step one/);
  assert.equal(tools(t).hidden, true, 'hidden while a block is open for editing');
  over(t, t.q('#previewBody textarea.md-block-edit'));
  assert.equal(tools(t).hidden, true);
  assert.deepEqual(t.errors, []);
});

test('block toolbar: code blocks keep a Copy button when click-to-edit is off or unavailable; other text has none then', async () => {
  const t = await boot();
  await doc(t, 'Plain paragraph.\n\n```\nsome code\n```\n');
  t.view('preview'); await sleep(250);
  t.click('btnViewMenu');
  t.click(t.qa('.menu button').find((b) => /Click to edit in the preview/.test(b.textContent))); await sleep(150);
  assert.equal(blocks(t).length, 0, 'no wrappers now');
  over(t, t.preview().querySelector('pre'));
  assert.equal(tools(t).hidden, false);
  assert.equal(toolBtn(t, 'edit').hidden, true, 'no Edit without wrappers');
  t.click(toolBtn(t, 'copy')); await sleep(40);
  assert.equal(t.w.__copied.pop(), 'some code');
  over(t, t.preview().querySelector('p'));
  assert.equal(tools(t).hidden, true, 'nothing to copy by block for a plain paragraph here');
  assert.deepEqual(t.errors, []);
});

test('copy the block at the caret (palette): the Markdown of the block the editor caret is in, or the code of a code block', async () => {
  const t = await boot();
  const src = '# Head\n\nfirst paragraph\nsecond line\n\n- a\n- b\n\n```py\nprint(1)\n```\n';
  await doc(t, src);
  t.view('edit');
  const run = async () => { t.w.document.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'p', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })); t.$('palInput').value = 'copy the block'; t.$('palInput').dispatchEvent(new t.w.Event('input')); t.key(t.$('palInput'), 'Enter'); await sleep(60); };
  t.editor.focus(); t.editor.setSelectionRange(src.indexOf('second'), src.indexOf('second'));
  await run();
  assert.equal(t.w.__copied.pop(), 'first paragraph\nsecond line');
  t.editor.setSelectionRange(src.indexOf('- b') + 1, src.indexOf('- b') + 1);
  await run();
  assert.equal(t.w.__copied.pop(), '- a\n- b');
  t.editor.setSelectionRange(src.indexOf('print'), src.indexOf('print'));
  await run();
  assert.equal(t.w.__copied.pop(), 'print(1)');
  assert.deepEqual(t.errors, []);
});
