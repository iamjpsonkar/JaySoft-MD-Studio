'use strict';

(() => {
  // ---------------------------------------------------------------- logging
  // Set localStorage['mdstudio.logLevel'] = 'debug' in the page console for verbose output.
  // Only metadata (names, sizes, ids) is logged, never document content.
  const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
  const currentLogLevel = () => LOG_LEVELS[localStorage.getItem('mdstudio.logLevel')] ?? LOG_LEVELS.info;
  function log(level, event, ctx = {}) {
    if (LOG_LEVELS[level] < currentLogLevel()) return;
    console[level === 'debug' ? 'log' : level](`[md-studio] ${event}`, ctx);
  }

  // ---------------------------------------------------------------- constants
  const SESSION_KEY = 'mdstudio.session.v1';
  const PREFS_KEY = 'mdstudio.prefs.v1';
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const MD_NAME_RE = /\.(md|markdown|mdown|mkd|mdx|txt)$/i;
  const PICKER_TYPES = [{
    description: 'Markdown / text',
    accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.mkd', '.mdx'], 'text/plain': ['.txt'] },
  }];
  const VIEWS = ['edit', 'split', 'preview'];
  const THEMES = ['auto', 'light', 'dark'];

  const $ = (id) => document.getElementById(id);
  const el = {
    tabs: $('tabs'), editor: $('editor'), preview: $('preview'), previewBody: $('previewBody'),
    main: $('main'), welcome: $('welcome'), outline: $('outline'), outlineList: $('outlineList'),
    toast: $('toast'), dropOverlay: $('dropOverlay'), toolbar: $('toolbar'),
    stFile: $('stFile'), stPos: $('stPos'), stStats: $('stStats'), stSave: $('stSave'),
    btnSave: $('btnSave'), btnSaveAs: $('btnSaveAs'), btnTheme: $('btnTheme'), btnOutline: $('btnOutline'), btnWide: $('btnWide'),
    recentBox: $('recentBox'), recentList: $('recentList'),
  };

  const state = { docs: [], activeId: null, view: 'split', theme: 'auto', outline: false, wide: true };
  const activeDoc = () => state.docs.find((d) => d.id === state.activeId) || null;
  const isDirty = (d) => d.text !== d.saved;

  // ---------------------------------------------------------------- IndexedDB (file handles + recents)
  let dbPromise = null;
  function openDb() {
    dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open('md-studio', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('handles');
        req.result.createObjectStore('recent', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  async function idb(store, mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  const saveHandle = (id, handle) => idb('handles', 'readwrite', (s) => s.put(handle, id))
    .catch((err) => log('error', 'idb-save-handle-failed', { docId: id, error: String(err) }));
  const loadHandle = (id) => idb('handles', 'readonly', (s) => s.get(id))
    .catch((err) => { log('error', 'idb-load-handle-failed', { docId: id, error: String(err) }); return null; });
  const dropHandle = (id) => idb('handles', 'readwrite', (s) => s.delete(id))
    .catch((err) => log('warn', 'idb-drop-handle-failed', { docId: id, error: String(err) }));

  async function addRecent(handle) {
    try {
      const all = await idb('recent', 'readonly', (s) => s.getAll());
      for (const r of all) {
        if (await r.handle.isSameEntry(handle).catch(() => false)) {
          await idb('recent', 'readwrite', (s) => s.delete(r.id));
        }
      }
      await idb('recent', 'readwrite', (s) => s.put({ id: crypto.randomUUID(), name: handle.name, handle, ts: Date.now() }));
      const fresh = (await idb('recent', 'readonly', (s) => s.getAll())).sort((a, b) => b.ts - a.ts);
      for (const old of fresh.slice(8)) await idb('recent', 'readwrite', (s) => s.delete(old.id));
    } catch (err) {
      log('warn', 'add-recent-failed', { name: handle?.name, error: String(err) });
    }
  }

  async function renderRecent() {
    try {
      const all = (await idb('recent', 'readonly', (s) => s.getAll())).sort((a, b) => b.ts - a.ts);
      el.recentList.replaceChildren();
      el.recentBox.hidden = all.length === 0;
      for (const r of all) {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = r.name;
        const when = document.createElement('span');
        when.className = 'when';
        when.textContent = new Date(r.ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
        li.append(name, when);
        li.addEventListener('click', async () => {
          log('info', 'recent-click', { name: r.name });
          if (!(await ensurePermission(r.handle, 'read'))) return toast('Permission to read the file was denied.', 'error');
          await openHandle(r.handle);
        });
        el.recentList.append(li);
      }
    } catch (err) {
      log('warn', 'render-recent-failed', { error: String(err) });
    }
  }

  // ---------------------------------------------------------------- helpers
  let toastTimer = null;
  function toast(msg, kind = 'info') {
    el.toast.textContent = msg;
    el.toast.className = `toast${kind === 'error' ? ' error' : ''}`;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, kind === 'error' ? 6000 : 2600);
  }

  const debounce = (fn, ms) => {
    let t = null;
    const wrapped = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    wrapped.flush = (...a) => { clearTimeout(t); fn(...a); };
    return wrapped;
  };

  function detectEol(text) {
    const crlf = (text.match(/\r\n/g) || []).length;
    const lf = (text.match(/(?<!\r)\n/g) || []).length;
    return crlf > lf ? '\r\n' : '\n';
  }
  const normalize = (text) => text.replace(/\r\n?/g, '\n');
  const serialize = (doc) => (doc.eol === '\r\n' ? doc.text.replace(/\n/g, '\r\n') : doc.text);

  const slugify = (s) => s.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');

  async function ensurePermission(handle, mode) {
    try {
      const opts = { mode };
      if ((await handle.queryPermission(opts)) === 'granted') return true;
      const result = await handle.requestPermission(opts);
      log('info', 'permission-result', { name: handle.name, mode, result });
      return result === 'granted';
    } catch (err) {
      log('error', 'permission-check-failed', { name: handle?.name, mode, error: String(err) });
      return false;
    }
  }

  // ---------------------------------------------------------------- documents
  function newId() { return crypto.randomUUID(); }

  function addDoc({ name, text, handle = null, src = null, mtime = 0 }) {
    const eol = detectEol(text);
    const norm = normalize(text);
    const doc = { id: newId(), name, text: norm, saved: norm, eol, handle, src, mtime, sel: [0, 0], scroll: 0 };
    state.docs.push(doc);
    log('info', 'doc-added', { docId: doc.id, name, bytes: text.length, eol: eol === '\r\n' ? 'crlf' : 'lf', hasHandle: Boolean(handle), fromUrl: Boolean(src) });
    if (handle) saveHandle(doc.id, handle);
    switchDoc(doc.id);
    return doc;
  }

  function stashActiveViewState() {
    const d = activeDoc();
    if (!d) return;
    d.sel = [el.editor.selectionStart, el.editor.selectionEnd];
    d.scroll = el.editor.scrollTop;
  }

  function switchDoc(id) {
    stashActiveViewState();
    state.activeId = id;
    const d = activeDoc();
    log('debug', 'switch-doc', { docId: id });
    el.editor.value = d ? d.text : '';
    if (d) {
      el.editor.setSelectionRange(d.sel[0], d.sel[1]);
      el.editor.scrollTop = d.scroll;
    }
    renderAll();
    if (d && state.view !== 'preview') el.editor.focus({ preventScroll: true });
    persistSession();
  }

  async function closeDoc(id) {
    const d = state.docs.find((x) => x.id === id);
    if (!d) return;
    if (isDirty(d) && !confirm(`"${d.name}" has unsaved changes. Close without saving?`)) {
      log('info', 'close-cancelled', { docId: id });
      return;
    }
    const idx = state.docs.indexOf(d);
    state.docs.splice(idx, 1);
    dropHandle(id);
    log('info', 'doc-closed', { docId: id, name: d.name, remaining: state.docs.length });
    if (state.activeId === id) {
      const next = state.docs[Math.min(idx, state.docs.length - 1)];
      state.activeId = null;
      if (next) switchDoc(next.id); else { el.editor.value = ''; renderAll(); persistSession(); renderRecent(); }
    } else {
      renderAll();
      persistSession();
    }
  }

  let untitledCounter = 0;
  function newDoc() {
    untitledCounter += 1;
    const used = new Set(state.docs.map((d) => d.name));
    let name = 'Untitled.md';
    while (used.has(name)) name = `Untitled-${untitledCounter++}.md`;
    addDoc({ name, text: '' });
  }

  // ---------------------------------------------------------------- opening files
  async function readFileSafely(file) {
    if (file.size > MAX_FILE_BYTES) throw new Error(`File is too large (${(file.size / 1048576).toFixed(1)} MB, limit 10 MB).`);
    const text = await file.text();
    if (text.includes('\u0000')) throw new Error('This looks like a binary file, not text.');
    return text;
  }

  async function openHandle(handle) {
    log('info', 'open-handle', { name: handle.name });
    for (const d of state.docs) {
      if (d.handle && await d.handle.isSameEntry(handle).catch(() => false)) {
        log('info', 'open-handle-already-open', { docId: d.id });
        switchDoc(d.id);
        return d;
      }
    }
    try {
      const file = await handle.getFile();
      const text = await readFileSafely(file);
      const doc = addDoc({ name: handle.name, text, handle, mtime: file.lastModified });
      addRecent(handle);
      return doc;
    } catch (err) {
      log('error', 'open-handle-failed', { name: handle.name, error: String(err) });
      toast(`Could not open ${handle.name}: ${err.message || err}`, 'error');
      return null;
    }
  }

  async function openFiles() {
    if (!window.showOpenFilePicker) return toast('This browser does not support the File System Access API.', 'error');
    try {
      const handles = await window.showOpenFilePicker({ multiple: true, types: PICKER_TYPES, excludeAcceptAllOption: false });
      log('info', 'picker-selected', { count: handles.length });
      for (const h of handles) await openHandle(h);
    } catch (err) {
      if (err.name === 'AbortError') return log('debug', 'open-picker-cancelled');
      log('error', 'open-picker-failed', { error: String(err) });
      toast(`Open failed: ${err.message || err}`, 'error');
    }
  }

  async function openFromUrl(src) {
    let url;
    try { url = new URL(src); } catch { return toast('Invalid URL.', 'error'); }
    if (!['file:', 'http:', 'https:'].includes(url.protocol)) return toast('Unsupported URL scheme.', 'error');

    const existing = state.docs.find((d) => d.src === src);
    if (existing && isDirty(existing)) {
      log('info', 'open-url-already-open-dirty', { docId: existing.id });
      toast('Already open with unsaved edits, showing your version.');
      return switchDoc(existing.id);
    }
    log('info', 'open-url', { protocol: url.protocol, origin: url.origin, refresh: Boolean(existing) });
    try {
      const res = await fetch(src, { credentials: 'omit', cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.length > MAX_FILE_BYTES) throw new Error('File is larger than 10 MB.');
      if (text.includes('\u0000')) throw new Error('This looks like a binary file, not text.');
      if (existing) {
        existing.eol = detectEol(text);
        existing.text = existing.saved = normalize(text);
        log('info', 'doc-refreshed-from-url', { docId: existing.id, bytes: text.length });
        switchDoc(existing.id);
        el.editor.value = existing.text;
        renderAll();
        return;
      }
      const name = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || 'document.md');
      addDoc({ name, text, src });
      toast('Loaded. Use “Save as” to write it to disk.');
    } catch (err) {
      log('error', 'open-url-failed', { protocol: url.protocol, error: String(err) });
      let hint = '';
      if (url.protocol === 'file:') {
        const allowed = await chrome.extension?.isAllowedFileSchemeAccess?.().catch(() => undefined);
        if (allowed === false) hint = ' Enable “Allow access to file URLs” in chrome://extensions → MD Studio → Details, or use Open instead.';
      }
      toast(`Could not load the URL: ${err.message || err}.${hint}`, 'error');
    }
  }

  // ---------------------------------------------------------------- saving
  const typesFor = (name) => [{ description: 'Markdown', accept: { 'text/markdown': [MD_NAME_RE.test(name) ? name.slice(name.lastIndexOf('.')) : '.md'] } }];

  async function writeTo(handle, doc) {
    const payload = serialize(doc);
    log('info', 'write-start', { docId: doc.id, name: handle.name, bytes: payload.length });
    const writable = await handle.createWritable();
    try {
      await writable.write(payload);
    } catch (err) {
      await writable.abort().catch(() => {});
      throw err;
    }
    await writable.close();
    const file = await handle.getFile();
    doc.mtime = file.lastModified;
    doc.saved = doc.text;
    log('info', 'write-done', { docId: doc.id, name: handle.name });
  }

  async function saveDoc() {
    const doc = activeDoc();
    if (!doc) return false;
    if (!doc.handle) return saveDocAs();
    try {
      if (!(await ensurePermission(doc.handle, 'readwrite'))) {
        toast('Write permission was denied.', 'error');
        return false;
      }
      try {
        const current = await doc.handle.getFile();
        if (doc.mtime && current.lastModified > doc.mtime) {
          log('warn', 'save-conflict', { docId: doc.id, diskMtime: current.lastModified, knownMtime: doc.mtime });
          if (!confirm(`"${doc.name}" was changed on disk after you opened it.\n\nOverwrite it with your version?`)) return false;
        }
      } catch (err) {
        if (err.name === 'NotFoundError') {
          log('warn', 'save-target-missing', { docId: doc.id });
          return saveDocAs();
        }
        throw err;
      }
      await writeTo(doc.handle, doc);
      toast('Saved');
      renderAll();
      persistSession();
      return true;
    } catch (err) {
      log('error', 'save-failed', { docId: doc.id, error: String(err) });
      toast(`Save failed: ${err.message || err}`, 'error');
      return false;
    }
  }

  async function saveDocAs() {
    const doc = activeDoc();
    if (!doc) return false;
    if (!window.showSaveFilePicker) { toast('This browser does not support the File System Access API.', 'error'); return false; }
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: doc.name, types: typesFor(doc.name) });
      await writeTo(handle, doc);
      doc.handle = handle;
      doc.name = handle.name;
      doc.src = null;
      await saveHandle(doc.id, handle);
      addRecent(handle);
      toast(`Saved as ${handle.name}`);
      renderAll();
      persistSession();
      return true;
    } catch (err) {
      if (err.name === 'AbortError') { log('debug', 'save-as-cancelled'); return false; }
      log('error', 'save-as-failed', { docId: doc.id, error: String(err) });
      toast(`Save failed: ${err.message || err}`, 'error');
      return false;
    }
  }

  // ---------------------------------------------------------------- rendering
  marked.use({ gfm: true, breaks: false });
  hljs.configure({ ignoreUnescapedHTML: true });
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.hasAttribute('href') && !node.getAttribute('href').startsWith('#')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });

  let headings = []; // [{ level, text, offset }] from top-level heading tokens of the active doc

  function renderPreview() {
    const d = activeDoc();
    if (!d) { el.previewBody.replaceChildren(); headings = []; renderOutline(); return; }
    if (state.view === 'edit' && !state.outline) return; // nothing visible depends on it
    const t0 = performance.now();
    try {
      const tokens = marked.lexer(d.text);
      headings = [];
      let cursor = 0;
      for (const tok of tokens) {
        const at = d.text.indexOf(tok.raw, cursor);
        if (at !== -1) cursor = at + tok.raw.length;
        if (tok.type === 'heading') headings.push({ level: tok.depth, text: tok.text, offset: at });
      }
      const html = DOMPurify.sanitize(marked.parser(tokens), { USE_PROFILES: { html: true } });
      el.previewBody.innerHTML = html;

      const seen = new Map();
      const domHeadings = el.previewBody.querySelectorAll('h1,h2,h3,h4,h5,h6');
      // Top-level tokens and DOM headings only line up 1:1 when no heading sits inside a list/quote/HTML.
      const aligned = domHeadings.length === headings.length;
      if (!aligned) log('debug', 'heading-mismatch', { tokens: headings.length, dom: domHeadings.length });
      domHeadings.forEach((h, i) => {
        if (aligned) headings[i].label = h.textContent.trim();
        const base = slugify(h.textContent);
        const n = seen.get(base) || 0;
        seen.set(base, n + 1);
        h.dataset.slug = n ? `${base}-${n}` : base;
      });
      el.previewBody.querySelectorAll('pre code').forEach((block) => {
        const lang = [...block.classList].find((c) => c.startsWith('language-'))?.slice(9);
        if (lang && hljs.getLanguage(lang)) hljs.highlightElement(block);
      });
      log('debug', 'preview-rendered', { docId: d.id, ms: Math.round(performance.now() - t0), headings: headings.length });
    } catch (err) {
      log('error', 'preview-render-failed', { docId: d.id, error: String(err) });
      const p = document.createElement('p');
      p.className = 'render-error';
      p.textContent = `Preview failed: ${err.message || err}`;
      el.previewBody.replaceChildren(p);
    }
    renderOutline();
  }

  function renderOutline() {
    el.outlineList.replaceChildren();
    if (!headings.length) {
      const p = document.createElement('div');
      p.className = 'empty';
      p.textContent = 'No headings yet';
      el.outlineList.append(p);
      return;
    }
    const minLevel = Math.min(...headings.map((h) => h.level));
    headings.forEach((h, i) => {
      const a = document.createElement('a');
      const label = h.label || h.text;
      a.textContent = label;
      a.title = label;
      a.style.paddingLeft = `${8 + (h.level - minLevel) * 14}px`;
      a.addEventListener('click', () => goToHeading(i));
      el.outlineList.append(a);
    });
  }

  function goToHeading(i) {
    const h = headings[i];
    if (!h) return;
    log('debug', 'outline-click', { index: i });
    if (state.view !== 'preview' && h.offset >= 0) {
      el.editor.focus();
      el.editor.setSelectionRange(h.offset, h.offset);
      // Chrome only scrolls the caret into view on a fresh focus.
      el.editor.blur();
      el.editor.focus();
    }
    if (state.view !== 'edit') {
      const all = [...el.previewBody.querySelectorAll('h1,h2,h3,h4,h5,h6')];
      if (h.label && all.length === headings.length) {
        all[i].scrollIntoView({ block: 'start' });
      } else {
        const nth = headings.slice(0, i).filter((x) => x.text === h.text).length;
        const matches = all.filter((n) => n.textContent.trim() === h.text.trim());
        (matches[nth] || matches[0])?.scrollIntoView({ block: 'start' });
      }
    }
  }

  function updateStats() {
    const d = activeDoc();
    if (!d) {
      el.stFile.textContent = '—'; el.stPos.textContent = ''; el.stStats.textContent = ''; el.stSave.textContent = '';
      return;
    }
    const words = (d.text.trim().match(/\S+/g) || []).length;
    const mins = Math.max(1, Math.round(words / 220));
    el.stStats.textContent = `${words.toLocaleString()} words · ${d.text.length.toLocaleString()} chars · ${words ? `${mins} min read` : '0 min read'}`;
    el.stFile.textContent = d.handle ? d.name : d.src ? `${d.name} (from URL)` : `${d.name} (not saved to disk)`;
    const dirty = isDirty(d);
    el.stSave.textContent = dirty ? 'Unsaved changes' : 'Saved';
    el.stSave.classList.toggle('unsaved', dirty);
  }

  function updatePos() {
    const v = el.editor.value;
    const pos = el.editor.selectionStart;
    const before = v.slice(0, pos);
    const line = before.split('\n').length;
    const col = pos - (before.lastIndexOf('\n') + 1) + 1;
    el.stPos.textContent = `Ln ${line}, Col ${col}`;
  }

  function renderTabs() {
    el.tabs.replaceChildren();
    for (const d of state.docs) {
      const tab = document.createElement('div');
      tab.className = `tab${d.id === state.activeId ? ' active' : ''}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(d.id === state.activeId));
      tab.title = d.name;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = d.name;
      tab.append(name);
      if (isDirty(d)) {
        const dot = document.createElement('span');
        dot.className = 'dirty';
        dot.title = 'Unsaved changes';
        tab.append(dot);
      }
      const close = document.createElement('button');
      close.className = 'close';
      close.textContent = '×';
      close.title = 'Close';
      close.setAttribute('aria-label', `Close ${d.name}`);
      close.addEventListener('click', (e) => { e.stopPropagation(); closeDoc(d.id); });
      tab.append(close);
      tab.addEventListener('click', () => { if (d.id !== state.activeId) switchDoc(d.id); });
      tab.addEventListener('auxclick', (e) => { if (e.button === 1) closeDoc(d.id); });
      el.tabs.append(tab);
    }
    const act = el.tabs.querySelector('.tab.active');
    act?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    document.title = (activeDoc() ? `${isDirty(activeDoc()) ? '● ' : ''}${activeDoc().name} — ` : '') + 'MD Studio';
  }

  function renderChrome() {
    const has = Boolean(activeDoc());
    el.welcome.hidden = has;
    el.toolbar.querySelectorAll('.tb').forEach((b) => { if (b !== el.btnOutline) b.disabled = !has; });
    el.btnSave.disabled = !has;
    el.btnSaveAs.disabled = !has;
    el.main.dataset.view = state.view;
    el.main.dataset.wide = String(state.wide);
    el.btnWide.classList.toggle('active', state.wide);
    $('viewSwitch').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
    el.outline.hidden = !state.outline;
    el.btnOutline.classList.toggle('active', state.outline);
    el.btnTheme.textContent = state.theme[0].toUpperCase() + state.theme.slice(1);
  }

  const renderAllNow = () => { renderTabs(); renderChrome(); renderPreview(); updateStats(); updatePos(); };
  const renderAll = renderAllNow;
  const renderLight = debounce(() => { renderTabs(); renderPreview(); updateStats(); }, 120);

  // ---------------------------------------------------------------- theme / prefs
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    const dark = state.theme === 'dark' || (state.theme === 'auto' && darkQuery.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    $('hlLight').disabled = dark;
    $('hlDark').disabled = !dark;
    el.btnTheme.textContent = state.theme[0].toUpperCase() + state.theme.slice(1);
  }
  darkQuery.addEventListener('change', applyTheme);

  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ view: state.view, theme: state.theme, outline: state.outline, wide: state.wide })); }
    catch (err) { log('warn', 'prefs-save-failed', { error: String(err) }); }
  }
  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      if (VIEWS.includes(p.view)) state.view = p.view;
      if (THEMES.includes(p.theme)) state.theme = p.theme;
      state.outline = Boolean(p.outline);
      if (typeof p.wide === 'boolean') state.wide = p.wide;
    } catch (err) { log('warn', 'prefs-load-failed', { error: String(err) }); }
  }

  // ---------------------------------------------------------------- session persistence
  function persistSessionNow() {
    stashActiveViewState();
    const payload = {
      activeId: state.activeId,
      docs: state.docs.map((d) => ({
        id: d.id, name: d.name, text: d.text, saved: d.saved, eol: d.eol, src: d.src, mtime: d.mtime,
        hasHandle: Boolean(d.handle), sel: d.sel, scroll: d.scroll,
      })),
    };
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
      log('debug', 'session-persisted', { docs: payload.docs.length });
    } catch (err) {
      log('warn', 'session-persist-failed', { docs: payload.docs.length, error: String(err) });
    }
  }
  const persistSession = debounce(persistSessionNow, 400);

  async function restoreSession() {
    let raw;
    try { raw = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch (err) { log('warn', 'session-parse-failed', { error: String(err) }); return; }
    if (!raw?.docs?.length) return;
    for (const r of raw.docs) {
      const handle = r.hasHandle ? await loadHandle(r.id) : null;
      state.docs.push({
        id: r.id, name: r.name, text: r.text, saved: r.saved, eol: r.eol === '\r\n' ? '\r\n' : '\n',
        src: r.src || null, mtime: r.mtime || 0, handle, sel: r.sel || [0, 0], scroll: r.scroll || 0,
      });
    }
    state.activeId = state.docs.some((d) => d.id === raw.activeId) ? raw.activeId : state.docs[0].id;
    log('info', 'session-restored', { docs: state.docs.length });
    const d = activeDoc();
    el.editor.value = d.text;
    el.editor.setSelectionRange(d.sel[0], d.sel[1]);
    el.editor.scrollTop = d.scroll;
  }

  // ---------------------------------------------------------------- editing helpers
  function replaceRange(start, end, text, selStart, selEnd) {
    el.editor.focus();
    el.editor.setSelectionRange(start, end);
    // execCommand keeps the native undo stack intact; setRangeText is the fallback.
    const ok = text === '' ? document.execCommand('delete') : document.execCommand('insertText', false, text);
    if (!ok) {
      el.editor.setRangeText(text, start, end, 'end');
      el.editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const s = selStart ?? start + text.length;
    el.editor.setSelectionRange(s, selEnd ?? s);
  }

  function lineBounds() {
    const v = el.editor.value;
    const s = el.editor.selectionStart;
    const e = el.editor.selectionEnd;
    const start = v.lastIndexOf('\n', s - 1) + 1;
    const endRef = e > s && v[e - 1] === '\n' ? e - 1 : e;
    let end = v.indexOf('\n', endRef);
    if (end === -1) end = v.length;
    return { start, end };
  }

  function wrapSelection(before, after, placeholder) {
    const { selectionStart: s, selectionEnd: e, value: v } = el.editor;
    const sel = v.slice(s, e);
    if (sel && v.slice(s - before.length, s) === before && v.slice(e, e + after.length) === after) {
      return replaceRange(s - before.length, e + after.length, sel, s - before.length, s - before.length + sel.length);
    }
    const inner = sel || placeholder;
    replaceRange(s, e, before + inner + after, s + before.length, s + before.length + inner.length);
  }

  function toggleLinePrefix({ prefix, strip, same }) {
    const { start, end } = lineBounds();
    const lines = el.editor.value.slice(start, end).split('\n');
    const isSame = same || ((l) => strip.test(l));
    const nonEmpty = lines.filter((l) => l.trim());
    const remove = nonEmpty.length > 0 && nonEmpty.every(isSame);
    let n = 0;
    const out = lines.map((l) => {
      if (!l.trim() && lines.length > 1) return l;
      const bare = l.replace(strip, '');
      return remove ? bare : prefix(n++) + bare;
    }).join('\n');
    replaceRange(start, end, out, start, start + out.length);
  }

  function insertBlock(text, caretOffset) {
    const { selectionStart: s, selectionEnd: e, value: v } = el.editor;
    const lead = s > 0 && v[s - 1] !== '\n' ? '\n\n' : s > 0 && v[s - 2] !== '\n' && s > 1 ? '\n' : '';
    const full = lead + text + '\n';
    replaceRange(s, e, full, s + lead.length + (caretOffset ?? text.length));
  }

  const COMMANDS = {
    h1: () => toggleLinePrefix({ prefix: () => '# ', strip: /^#{1,6}\s+/, same: (l) => l.startsWith('# ') }),
    h2: () => toggleLinePrefix({ prefix: () => '## ', strip: /^#{1,6}\s+/, same: (l) => l.startsWith('## ') }),
    h3: () => toggleLinePrefix({ prefix: () => '### ', strip: /^#{1,6}\s+/, same: (l) => l.startsWith('### ') }),
    bold: () => wrapSelection('**', '**', 'bold text'),
    italic: () => wrapSelection('*', '*', 'italic text'),
    strike: () => wrapSelection('~~', '~~', 'strikethrough'),
    code: () => wrapSelection('`', '`', 'code'),
    ul: () => toggleLinePrefix({ prefix: () => '- ', strip: /^(\s*)([-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/ }),
    ol: () => toggleLinePrefix({ prefix: (i) => `${i + 1}. `, strip: /^(\s*)([-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/ }),
    task: () => toggleLinePrefix({ prefix: () => '- [ ] ', strip: /^(\s*)([-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/ }),
    quote: () => toggleLinePrefix({ prefix: () => '> ', strip: /^>\s?/ }),
    link: () => {
      const { selectionStart: s, selectionEnd: e, value: v } = el.editor;
      const label = v.slice(s, e) || 'link text';
      const text = `[${label}](https://)`;
      const urlStart = s + label.length + 3;
      replaceRange(s, e, text, urlStart, urlStart + 8);
    },
    image: () => {
      const { selectionStart: s, selectionEnd: e, value: v } = el.editor;
      const alt = v.slice(s, e) || 'alt text';
      const urlStart = s + alt.length + 4;
      replaceRange(s, e, `![${alt}](https://)`, urlStart, urlStart + 8);
    },
    codeblock: () => {
      const { selectionStart: s, selectionEnd: e, value: v } = el.editor;
      const sel = v.slice(s, e);
      const body = sel || 'code';
      const text = '```\n' + body + '\n```';
      const lead = s > 0 && v[s - 1] !== '\n' ? '\n' : '';
      replaceRange(s, e, lead + text, s + lead.length + 4, s + lead.length + 4 + body.length);
    },
    table: () => insertBlock('| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| Cell | Cell | Cell |\n| Cell | Cell | Cell |'),
    hr: () => insertBlock('---'),
  };

  function runCommand(name) {
    if (!activeDoc()) return;
    log('debug', 'command', { name });
    COMMANDS[name]?.();
  }

  function indentSelection(outdent) {
    const { selectionStart: s, selectionEnd: e } = el.editor;
    if (s === e && !outdent) return replaceRange(s, e, '  ');
    const { start, end } = lineBounds();
    const out = el.editor.value.slice(start, end).split('\n')
      .map((l) => (outdent ? l.replace(/^( {1,2}|\t)/, '') : `  ${l}`)).join('\n');
    replaceRange(start, end, out, start, start + out.length);
  }

  function continueList(ev) {
    const { selectionStart: s, selectionEnd: e, value: v } = el.editor;
    if (s !== e) return;
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    const before = v.slice(ls, s);
    const m = /^(\s*)([-*+]|\d+[.)])\s(\[[ xX]\]\s)?/.exec(before);
    if (!m) return;
    const atLineEnd = s === v.length || v[s] === '\n';
    if (!before.slice(m[0].length).trim() && atLineEnd) {
      ev.preventDefault();
      replaceRange(ls, s, '', ls, ls); // empty item: leave the list
      return;
    }
    let marker = m[2];
    if (/^\d/.test(marker)) marker = `${parseInt(marker, 10) + 1}${marker.slice(-1)}`;
    ev.preventDefault();
    replaceRange(s, s, `\n${m[1]}${marker} ${m[3] ? '[ ] ' : ''}`);
  }

  // ---------------------------------------------------------------- view switching
  function setView(view) {
    if (!VIEWS.includes(view)) return;
    state.view = view;
    log('debug', 'view-changed', { view });
    savePrefs();
    renderChrome();
    renderPreview();
    if (view !== 'preview') el.editor.focus({ preventScroll: true });
  }

  let scrollLock = null;
  let scrollLockTimer = null;
  function syncScroll(src, dst) {
    if (state.view !== 'split' || (scrollLock && scrollLock !== src)) return;
    scrollLock = src;
    clearTimeout(scrollLockTimer);
    scrollLockTimer = setTimeout(() => { scrollLock = null; }, 90);
    const ratio = src.scrollTop / Math.max(1, src.scrollHeight - src.clientHeight);
    dst.scrollTop = ratio * (dst.scrollHeight - dst.clientHeight);
  }

  // ---------------------------------------------------------------- events
  el.editor.addEventListener('input', () => {
    const d = activeDoc();
    if (!d) return;
    d.text = el.editor.value;
    renderLight();
    persistSession();
  });
  el.editor.addEventListener('keyup', updatePos);
  el.editor.addEventListener('click', updatePos);
  el.editor.addEventListener('select', updatePos);
  el.editor.addEventListener('scroll', () => syncScroll(el.editor, el.preview), { passive: true });
  el.preview.addEventListener('scroll', () => syncScroll(el.preview, el.editor), { passive: true });

  el.editor.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && !e.shiftKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); runCommand('bold'); return; }
      if (k === 'i') { e.preventDefault(); runCommand('italic'); return; }
      if (k === 'k') { e.preventDefault(); runCommand('link'); return; }
    }
    if (e.key === 'Tab' && !mod && !e.altKey) { e.preventDefault(); indentSelection(e.shiftKey); return; }
    if (e.key === 'Enter' && !mod && !e.shiftKey && !e.altKey && !e.isComposing) continueList(e);
  });

  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); (e.shiftKey ? saveDocAs : saveDoc)(); }
    else if (k === 'e' && !e.shiftKey) { e.preventDefault(); setView(VIEWS[(VIEWS.indexOf(state.view) + 1) % VIEWS.length]); }
  });

  el.toolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cmd]');
    if (btn) runCommand(btn.dataset.cmd);
  });
  $('viewSwitch').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (b) setView(b.dataset.view);
  });
  el.btnOutline.addEventListener('click', () => { state.outline = !state.outline; savePrefs(); renderChrome(); renderPreview(); });
  el.btnWide.addEventListener('click', () => {
    state.wide = !state.wide;
    log('debug', 'wide-changed', { wide: state.wide });
    savePrefs();
    renderChrome();
  });
  el.btnTheme.addEventListener('click', () => {
    state.theme = THEMES[(THEMES.indexOf(state.theme) + 1) % THEMES.length];
    log('debug', 'theme-changed', { theme: state.theme });
    savePrefs();
    applyTheme();
  });
  $('btnOpen').addEventListener('click', openFiles);
  $('btnNew').addEventListener('click', newDoc);
  el.btnSave.addEventListener('click', saveDoc);
  el.btnSaveAs.addEventListener('click', saveDocAs);
  $('welcomeOpen').addEventListener('click', openFiles);
  $('welcomeNew').addEventListener('click', newDoc);

  // In-page anchors (#heading) and external links in the preview.
  el.previewBody.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (href.startsWith('#')) {
      e.preventDefault();
      const slug = slugify(decodeURIComponent(href.slice(1)));
      el.previewBody.querySelector(`[data-slug="${CSS.escape(slug)}"]`)?.scrollIntoView({ block: 'start' });
    }
  });

  // Drag and drop (handles give us read-write access in Chrome; plain File is a read-only fallback).
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; el.dropOverlay.hidden = false; } });
  window.addEventListener('dragleave', (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; el.dropOverlay.hidden = true; } });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    el.dropOverlay.hidden = true;
    const items = [...e.dataTransfer.items].filter((i) => i.kind === 'file');
    log('info', 'drop', { count: items.length });
    // Handles must be requested synchronously within the event, before any await.
    const pending = items.map((i) => ({
      handle: i.getAsFileSystemHandle ? i.getAsFileSystemHandle() : Promise.resolve(null),
      file: i.getAsFile(),
    }));
    for (const p of pending) {
      try {
        const handle = await p.handle;
        if (handle && handle.kind === 'directory') { toast('Folders are not supported, drop files instead.', 'error'); continue; }
        const name = handle?.name || p.file?.name || '';
        if (!MD_NAME_RE.test(name)) { toast(`“${name}” does not look like a Markdown file.`, 'error'); continue; }
        if (handle) { await openHandle(handle); continue; }
        const text = await readFileSafely(p.file);
        addDoc({ name, text });
        toast('Opened read-only copy. Use “Save as” to write it.');
      } catch (err) {
        log('error', 'drop-open-failed', { error: String(err) });
        toast(`Could not open the file: ${err.message || err}`, 'error');
      }
    }
  });

  window.addEventListener('beforeunload', (e) => {
    persistSessionNow();
    if (state.docs.some(isDirty)) { e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) persistSessionNow(); });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'md-studio:open-src' && typeof msg.src === 'string') {
      log('info', 'message-open-src', {});
      openFromUrl(msg.src);
    }
  });

  // ---------------------------------------------------------------- boot
  (async function boot() {
    log('info', 'boot', {});
    loadPrefs();
    applyTheme();
    await restoreSession();
    renderAll();
    renderRecent();
    const params = new URLSearchParams(location.search);
    const src = params.get('src');
    if (src) {
      history.replaceState(null, '', location.pathname);
      await openFromUrl(src);
    }
  })();
})();
