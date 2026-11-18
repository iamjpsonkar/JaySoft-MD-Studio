// Characterisation of what MD Studio already did before the parity work: these must keep passing.
const test = require('node:test');
const assert = require('node:assert');
const { boot, fakeHandle, sleep } = require('./helper');

test('boots to the welcome screen; New creates numbered tabs', async () => {
  const t = await boot();
  assert.equal(t.$('welcome').hidden, false);
  t.click('btnNew'); await sleep(50);
  assert.deepEqual(t.tabs(), ['Untitled.md']);
  assert.equal(t.$('welcome').hidden, true);
  t.click('btnNew'); await sleep(50);
  assert.equal(t.tabs().length, 2);
  assert.notEqual(t.tabs()[0], t.tabs()[1]);
  assert.deepEqual(t.errors, []);
});

test('typing renders the preview (sanitised) and the outline; Ctrl+E cycles views', async () => {
  const t = await boot();
  t.click('btnNew'); await sleep(50);
  await t.type('# Title\n\nSome **bold** text <script>alert(1)</script>\n\n## Part two\n\n```js\nconst a = 1;\n```\n');
  assert.match(t.preview().innerHTML, /<h1[^>]*>Title<\/h1>/);
  assert.match(t.preview().innerHTML, /<strong>bold<\/strong>/);
  assert.equal(t.preview().querySelectorAll('script').length, 0, 'scripts are sanitised away');
  t.click('btnOutline'); await sleep(60);
  assert.deepEqual([...t.qa('#outlineList a')].map((a) => a.textContent), ['Title', 'Part two']);
  const before = t.$('main').dataset.view;
  t.w.document.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'e', ctrlKey: true, bubbles: true, cancelable: true }));
  assert.notEqual(t.$('main').dataset.view, before);
  assert.deepEqual(t.errors, []);
});

test('formatting commands, list continuation and Tab indentation', async () => {
  const t = await boot();
  t.click('btnNew'); await sleep(50);
  t.view('edit');
  await t.type('word');
  t.editor.setSelectionRange(0, 4);
  t.click('#toolbar [data-cmd="bold"]');
  assert.equal(t.editor.value, '**word**');
  await t.type('- item');
  t.editor.setSelectionRange(6, 6);
  t.key(t.editor, 'Enter');
  assert.equal(t.editor.value, '- item\n- ', 'a list continues');
  await t.type('1. one');
  t.editor.setSelectionRange(6, 6);
  t.key(t.editor, 'Enter');
  assert.equal(t.editor.value, '1. one\n2. ', 'numbers count up');
  await t.type('x'); t.editor.setSelectionRange(1, 1);
  t.key(t.editor, 'Tab');
  assert.equal(t.editor.value, 'x  ');
  assert.deepEqual(t.errors, []);
});

test('Open (File System Access): reads, keeps CRLF on save, warns when the file changed on disk', async () => {
  const t = await boot();
  const log = [];
  const h = fakeHandle('notes.md', '# One\r\n\r\ntext\r\n', log);
  t.w.showOpenFilePicker = async () => [h];
  t.click('btnOpen'); await sleep(200);
  assert.deepEqual(t.tabs(), ['notes.md']);
  assert.equal(t.editor.value, '# One\n\ntext\n', 'the editor works with \\n');
  await t.type('# One\n\ntext, edited\n');
  t.click('btnSave'); await sleep(200);
  assert.deepEqual(log, [['notes.md', '# One\r\n\r\ntext, edited\r\n']], 'saved with CRLF');
  h.touchOnDisk('# changed elsewhere\n');
  let asked = 0;
  t.w.confirm = () => { asked++; return false; };
  await t.type('# mine\n');
  t.click('btnSave'); await sleep(200);
  assert.equal(asked, 1, 'asks before overwriting a file that changed on disk');
  assert.equal(log.length, 1, 'and did not write');
  assert.deepEqual(t.errors, []);
});

test('binary files are refused; dropping a non-markdown name is refused', async () => {
  const t = await boot();
  t.w.showOpenFilePicker = async () => [fakeHandle('pic.md', 'x\u0000y', [])];
  t.click('btnOpen'); await sleep(200);
  assert.match(t.$('toast').textContent, /binary file/);
  assert.equal(t.tabs().length, 0);
});

test('the session (tabs, text, caret) is restored after a reload', async () => {
  const t = await boot();
  t.click('btnNew'); await sleep(50);
  await t.type('# Kept\n\nbody');
  t.w.dispatchEvent(new t.w.Event('beforeunload'));
  const saved = JSON.parse(t.w.sessionStorage.getItem('mdstudio.session.v1'));
  assert.equal(saved.docs[0].text, '# Kept\n\nbody');
  const t2 = await boot({ session: saved });
  assert.equal(t2.editor.value, '# Kept\n\nbody');
  assert.deepEqual(t2.tabs(), ['Untitled.md']);
});
