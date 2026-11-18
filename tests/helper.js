// Drives the real editor.html + editor.js (+ core modules and bundled libraries) in jsdom.
// jsdom has no layout, IndexedDB, File System Access or Chrome APIs: those are stubbed, so this verifies behaviour and DOM output,
// not visual layout or real-Chrome integration.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LIBS = ['lib/purify.min.js', 'lib/marked.min.js', 'lib/highlight.min.js'];
function coreFiles() {
  const dir = path.join(ROOT, 'core');
  if (!fs.existsSync(dir)) return [];
  const order = ['ns.js', 'find.js', 'editing.js', 'textdiff.js', 'mdhighlight.js', 'mdtransform.js', 'mdlint.js', 'mdexport.js', 'editor-widget.js', 'ui.js'];
  return order.filter((f) => fs.existsSync(path.join(dir, f))).map((f) => `core/${f}`);
}

/** Opens editor.html (or another page) in jsdom = one browser tab. opts: {session (this tab's sessionStorage), local (shared localStorage), prefs, url, extension: true|false} */
async function boot(opts = {}) {
  const page = opts.page || 'editor.html';
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8').replace(/<script[^>]*src=[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: opts.url || `http://localhost/${page}`, pretendToBeVisual: true });
  const w = dom.window;
  const errors = [];
  w.console.error = (...a) => { const m = a.join(' '); if (!/\[md-studio\] (idb-|add-recent|render-recent)/.test(m)) errors.push(m); };
  w.console.warn = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.Element.prototype.scrollIntoView = function () { w.__scrolled = this; };
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async (t) => { (w.__copied = w.__copied || []).push(t); }, readText: async () => w.__clip || '' } });
  Object.assign(w, { TextDecoder, TextEncoder, Blob });
  if (!w.crypto || !w.crypto.randomUUID) Object.defineProperty(w, 'crypto', { value: require('crypto').webcrypto, configurable: true });
  w.confirm = () => true;
  w.document.execCommand = () => false; // jsdom has none; the editor then uses setRangeText
  if (opts.extension !== false) w.chrome = { runtime: { onMessage: { addListener(fn) { w.__onMessage = fn; } } }, extension: {} };
  if (opts.prefs) w.localStorage.setItem('mdstudio.prefs.v1', JSON.stringify(opts.prefs));
  if (opts.session) w.sessionStorage.setItem('mdstudio.session.v1', JSON.stringify(opts.session)); // this tab's own session
  if (opts.local) for (const [k, v] of Object.entries(opts.local)) w.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); // storage shared between tabs
  for (const f of [...LIBS, ...coreFiles()]) w.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  w.eval(fs.readFileSync(path.join(ROOT, opts.script || 'editor.js'), 'utf8'));
  await sleep(opts.wait || 80);

  const $ = (id) => w.document.getElementById(id);
  const click = (el) => (typeof el === 'string' ? $(el) || w.document.querySelector(el) : el).dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  const key = (el, k, o) => { const e = new w.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, o)); el.dispatchEvent(e); return e; };
  const editor = $('editor');
  const t = {
    w, $, click, key, errors, editor, sleep,
    q: (s) => w.document.querySelector(s),
    qa: (s) => [...w.document.querySelectorAll(s)],
    async type(text, wait) { editor.value = text; editor.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(wait || 200); },
    view: (v) => click(`#viewSwitch [data-view="${v}"]`),
    tabs: () => [...w.document.querySelectorAll('#tabs .tab .name')].map((n) => n.textContent),
    preview: () => $('previewBody'),
  };
  return t;
}

/** A fake File System Access handle backed by a string. */
function fakeHandle(name, content, log) {
  let data = content, mtime = 1000;
  const h = {
    name, kind: 'file', get data() { return data; },
    queryPermission: async () => 'granted', requestPermission: async () => 'granted',
    isSameEntry: async (o) => o === h,
    getFile: async () => ({ name, size: data.length, lastModified: mtime, text: async () => data }),
    createWritable: async () => ({ write: async (t) => { (log || []).push([name, t]); data = t; mtime += 5; }, close: async () => {}, abort: async () => {} }),
    touchOnDisk(t) { data = t; mtime += 100; },
  };
  return h;
}

module.exports = { boot, fakeHandle, sleep, ROOT };
