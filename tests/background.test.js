// background.js with a mocked chrome API: every opened Markdown file gets its own editor tab (tabs never share documents).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EDITOR = 'chrome-extension://abc/editor.html';
const FILE = 'file:///Users/me/notes/readme.md';
const target = (src) => `${EDITOR}?src=${encodeURIComponent(src)}`;

function load({ tabs = [] } = {}) {
  const calls = [];
  const listeners = { before: null, beforeFilter: null, click: null };
  const rec = (name, fn) => (...a) => { calls.push([name, ...a]); return fn ? fn(...a) : Promise.resolve(); };
  const chrome = {
    runtime: { getURL: (p) => `chrome-extension://abc/${p}` },
    action: { onClicked: { addListener: (fn) => { listeners.click = fn; } } },
    permissions: { request: rec('permissions.request', async () => true) },
    windows: { update: rec('windows.update') },
    tabs: { query: rec('tabs.query', async () => tabs), update: rec('tabs.update'), remove: rec('tabs.remove'), create: rec('tabs.create'), sendMessage: rec('tabs.sendMessage'), get: rec('tabs.get', async () => ({})) },
    webNavigation: { onBeforeNavigate: { addListener: (fn, filter) => { listeners.before = fn; listeners.beforeFilter = filter; } } },
  };
  const ctx = { chrome, console: { log() {}, info() {}, warn() {}, error() {} }, URL, encodeURIComponent, decodeURIComponent };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'), ctx);
  return { calls, listeners, names: () => calls.map((c) => c[0]), navigate: (tabId, url) => listeners.before({ frameId: 0, tabId, url }) };
}

test('only local Markdown files are watched', () => {
  const b = load();
  const suffixes = b.listeners.beforeFilter.url.map((f) => f.pathSuffix);
  assert.ok(['.md', '.markdown', '.mdx'].every((s) => suffixes.includes(s)));
  assert.ok(b.listeners.beforeFilter.url.every((f) => f.schemes.join() === 'file'));
});

test('opening a .md file: the tab you open it in becomes its own editor, whether or not other editor tabs exist', async () => {
  for (const tabs of [[], [{ id: 1, url: EDITOR, windowId: 9 }], [{ id: 1, url: EDITOR, windowId: 9 }, { id: 2, url: `${EDITOR}?src=x` }]]) {
    const b = load({ tabs });
    await b.navigate(7, FILE);
    assert.deepEqual(b.calls, [['tabs.update', 7, { url: target(FILE) }]], `${tabs.length} editor tab(s) already open`);
  }
});

test('typing a file URL into an editor tab turns that tab into an editor for the new file (nothing else is touched)', async () => {
  const b = load({ tabs: [{ id: 1, url: EDITOR, windowId: 9 }] });
  await b.navigate(1, FILE);
  assert.deepEqual(b.calls, [['tabs.update', 1, { url: target(FILE) }]]);
});

test('no editor tab is ever focused, messaged or reused, and no tab is closed', async () => {
  const b = load({ tabs: [{ id: 1, url: EDITOR, windowId: 9 }] });
  await b.navigate(7, FILE);
  await b.listeners.click({ id: 3, url: FILE });
  await b.listeners.click({ id: 4, url: 'https://example.com/' });
  for (const banned of ['windows.update', 'tabs.sendMessage', 'tabs.remove', 'tabs.query']) assert.ok(!b.names().includes(banned), banned);
});

test('the toolbar icon always opens a new editor tab: with the file on a local .md page, or empty elsewhere', async () => {
  const open = [{ id: 1, url: EDITOR, windowId: 9 }];
  const a = load({ tabs: open });
  await a.listeners.click({ id: 3, url: FILE });
  assert.deepEqual(a.calls, [['tabs.create', { url: target(FILE) }]]);
  const b = load({ tabs: open });
  await b.listeners.click({ id: 4, url: 'https://example.com/page' });
  assert.deepEqual(b.calls, [['tabs.create', { url: EDITOR }]], 'a normal page: a blank editor');
  const c = load({ tabs: open });
  await c.listeners.click({ id: 5, url: 'https://example.com/notes.md' });
  assert.deepEqual(c.names(), ['permissions.request', 'tabs.create'], 'a .md page on the web asks for that one site first');
  assert.deepEqual(c.calls[1], ['tabs.create', { url: target('https://example.com/notes.md') }]);
});
