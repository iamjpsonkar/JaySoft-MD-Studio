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
  const SESSION_KEY = 'mdstudio.session.v1'; // sessionStorage: this tab's own session, never shared with another tab
  const RECOVER_KEY = 'mdstudio.recover.v1'; // localStorage: the most recent session of any tab, offered (never applied) on the welcome screen
  const PREFS_KEY = 'mdstudio.prefs.v1';
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const MD_NAME_RE = /\.(md|markdown|mdown|mkd|mdx|txt)$/i;
  const PICKER_TYPES = [{
    description: 'Markdown / text',
    accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.mkd', '.mdx'], 'text/plain': ['.txt'] },
  }];
  const VIEWS = ['edit', 'split', 'preview', 'diff'];
  // github.io user pages share one browser origin across every project hosted there: nothing sensitive (document text) may be kept in localStorage on it.
  const SHARED_ORIGIN = /\.github\.io$/i.test(location.hostname);
  const IS_EXTENSION = location.protocol === 'chrome-extension:';
  const THEMES = ['auto', 'light', 'dark'];

  const $ = (id) => document.getElementById(id);
  const el = {
    tabs: $('tabs'), editor: $('editor'), preview: $('preview'), previewBody: $('previewBody'),
    main: $('main'), welcome: $('welcome'), outline: $('outline'), outlineList: $('outlineList'),
    toast: $('toast'), dropOverlay: $('dropOverlay'), toolbar: $('toolbar'),
    stFile: $('stFile'), stPos: $('stPos'), stStats: $('stStats'), stSave: $('stSave'),
    btnSave: $('btnSave'), btnSaveAs: $('btnSaveAs'), btnTheme: $('btnTheme'), btnOutline: $('btnOutline'), btnWide: $('btnWide'),
    recentBox: $('recentBox'), recentList: $('recentList'),
    editorBox: $('editorBox'), editorPane: $('editorPane'), paneSplit: $('paneSplit'), stEol: $('stEol'),
    diffAgainst: $('diffAgainst'), diffBody: $('diffBody'), diffStats: $('diffStats'), diffPos: $('diffPos'), diffCollapse: $('diffCollapse'),
    problems: $('problems'), problemList: $('problemList'), problemSummary: $('problemSummary'), problemCount: $('problemCount'),
  };
  const { h, showMenu, askForm, makeSplitter, Palette } = JSS.ui;
  const MT = JSS.mdtransform, ML = JSS.mdlint, MX = JSS.mdexport;

  const state = { docs: [], activeId: null, view: 'preview', theme: 'auto', outline: false, wide: true, wrap: true, lines: true, sync: true, split: 0.5, problems: false, previewEdit: true, diffAgainst: 'saved' };
  const activeDoc = () => state.docs.find((d) => d.id === state.activeId) || null;
  // a line-ending change alone also counts as an unsaved change
  const isDirty = (d) => d.text !== d.saved || (d.savedEol !== undefined && d.eol !== d.savedEol);

  // line numbers, Markdown colours, find and replace, bracket matching, word wrap (core/editor-widget.js)
  const widget = new JSS.EditorWidget($('editorBox'), el.editor, { highlight: JSS.mdhighlight.highlightLines, bracketStrings: false, toast: (m, k) => toast(m, k), log, onCaret: () => { updatePos(); } });
  function setEditorValue(v) { el.editor.value = v; widget.refresh(true); }

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
    const doc = { id: newId(), name, text: norm, saved: norm, eol, savedEol: eol, view: state.view, handle, src, mtime, sel: [0, 0], scroll: 0 };
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
    if (d && VIEWS.includes(d.view)) state.view = d.view; // every tab keeps its own view
    log('debug', 'switch-doc', { docId: id });
    setEditorValue(d ? d.text : '');
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
      if (next) switchDoc(next.id); else { setEditorValue(''); renderAll(); persistSession(); renderRecent(); }
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

  let fallbackPick = null;
  /** Browsers without the File System Access API: a plain <input type=file>. The documents have no file handle, so Save downloads a copy. */
  function openFilesFallback() {
    if (fallbackPick) fallbackPick(null); // a second click abandons the first dialog
    const input = $('fileInput');
    return new Promise((resolve) => {
      const finish = async (list) => {
        input.removeEventListener('change', onChange);
        input.removeEventListener('cancel', onCancel);
        fallbackPick = null;
        for (const file of (list || []).slice(0, 20)) {
          try {
            addDoc({ name: file.name, text: await readFileSafely(file) });
            log('info', 'file-picked', { name: file.name, bytes: file.size, via: 'input' });
          } catch (err) { toast(`Could not open ${file.name}: ${err.message || err}`, 'error'); }
        }
        if (list && list.length) toast('Opened a copy. This browser cannot write to the original, so Save downloads a file.');
        resolve();
      };
      const onChange = () => finish([...input.files]);
      const onCancel = () => finish(null);
      fallbackPick = finish;
      input.addEventListener('change', onChange);
      input.addEventListener('cancel', onCancel);
      input.value = '';
      input.click();
    });
  }
  async function openFiles() {
    if (!window.showOpenFilePicker) return openFilesFallback();
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
        existing.eol = existing.savedEol = detectEol(text);
        existing.text = existing.saved = normalize(text);
        log('info', 'doc-refreshed-from-url', { docId: existing.id, bytes: text.length });
        switchDoc(existing.id);
        setEditorValue(existing.text);
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
        const allowed = typeof chrome !== 'undefined' ? await chrome.extension?.isAllowedFileSchemeAccess?.().catch(() => undefined) : undefined;
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
    doc.savedEol = doc.eol;
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
    const suggested = MD_NAME_RE.test(doc.name) ? doc.name : `${doc.name}.md`;
    if (!window.showSaveFilePicker) { // no way to write a file in place here: hand over a download instead
      downloadText(suggested, serialize(doc), 'text/markdown');
      doc.saved = doc.text; doc.savedEol = doc.eol;
      toast(`Downloaded ${suggested}. This browser cannot save over the original file, so Save downloads a copy.`);
      renderAll();
      persistSession();
      return true;
    }
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: suggested, types: typesFor(suggested) });
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
  let blockEditing = null; // {start, end, raw, src, trail, docId} while a block is open for editing in the preview
  const MAX_EDIT_BLOCKS = 4000, MAX_EDIT_CHARS = 800000; // beyond this the preview is drawn without per-block wrappers (no click-to-edit), and says so

  function renderPreview(force) {
    const d = activeDoc();
    if (!d) { el.previewBody.replaceChildren(); headings = []; renderOutline(); return; }
    if ((state.view === 'edit' || state.view === 'diff') && !state.outline && !force) return; // nothing visible depends on it
    if (blockEditing) return; // a block is open in the preview: never replace it under the user's hands
    const t0 = performance.now();
    const keepScroll = el.preview.scrollTop;
    try {
      const tokens = marked.lexer(d.text);
      headings = [];
      let cursor = 0;
      for (const tok of tokens) {
        const at = d.text.indexOf(tok.raw, cursor);
        if (at !== -1) cursor = at + tok.raw.length;
        if (tok.type === 'heading') headings.push({ level: tok.depth, text: tok.text, offset: at });
      }
      // Click-to-edit: every top-level Markdown block is drawn inside a wrapper that remembers its exact range in the source. Raw HTML blocks stay
      // unwrapped (their tags may open or close across blocks), and tokens must add up to the text exactly, otherwise offsets cannot be trusted.
      const contiguous = tokens.map((t) => t.raw).join('') === d.text;
      const blockCount = tokens.reduce((n, t) => n + (t.type === 'space' ? 0 : 1), 0);
      const tooBig = blockCount > MAX_EDIT_BLOCKS || d.text.length > MAX_EDIT_CHARS;
      const editable = state.previewEdit && contiguous && !tooBig;
      let rendered;
      if (editable) {
        let off = 0;
        rendered = tokens.map((tok) => {
          const start = off;
          off += tok.raw.length;
          const chunk = marked.parser(Object.assign([tok], { links: tokens.links }));
          return chunk && !['html', 'space', 'def'].includes(tok.type) ? `<div class="md-block" data-s="${start}" data-e="${off}">${chunk}</div>` : chunk;
        }).join('');
      } else rendered = marked.parser(tokens);
      hideBlockTools();
      el.previewBody.dataset.edit = editable ? 'on' : 'off';
      el.previewBody.innerHTML = DOMPurify.sanitize(rendered, { USE_PROFILES: { html: true } });
      if (editable) el.previewBody.querySelectorAll('.md-block input[type="checkbox"]').forEach((c) => { c.disabled = false; c.title = 'Click to toggle'; });
      // never silently off: say why when the preference is on but this document cannot be edited in place
      if (state.previewEdit && !editable) {
        const why = tooBig ? 'this document is large' : 'its structure could not be mapped back to the source';
        el.previewBody.prepend(h('div', { class: 'preview-note', text: `Click-to-edit is unavailable here (${why}). Use Edit or Split to change the text.` }));
      }
      el.preview.scrollTop = keepScroll;

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
    const a = el.editor.selectionStart, b = el.editor.selectionEnd;
    const before = v.slice(0, a);
    const line = before.split('\n').length;
    const col = a - (before.lastIndexOf('\n') + 1) + 1;
    el.stPos.textContent = `Ln ${line}, Col ${col}${b > a ? ` (${(b - a).toLocaleString()} selected)` : ''}`;
    const d = activeDoc();
    el.stEol.hidden = !d;
    el.stEol.textContent = d && d.eol === '\r\n' ? 'CRLF' : 'LF';
  }

  let renaming = false;
  function renderTabs() {
    if (renaming) return; // keep the name box alive while it is open
    el.tabs.replaceChildren();
    for (const d of state.docs) {
      const tab = document.createElement('div');
      tab.className = `tab${d.id === state.activeId ? ' active' : ''}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(d.id === state.activeId));
      tab.title = `${d.name} (double-click to rename)`;
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
      tab.addEventListener('dblclick', (e) => { if (!e.target.closest('.close')) renameDoc(d.id); });
      el.tabs.append(tab);
    }
    const act = el.tabs.querySelector('.tab.active');
    act?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    document.title = (activeDoc() ? `${isDirty(activeDoc()) ? '● ' : ''}${activeDoc().name} — ` : '') + 'MD Studio';
  }

  /** Inline rename of a tab. A document linked to a file on disk is detached from it (after a confirmation): Save as will ask where. */
  function renameDoc(id) {
    const d = state.docs.find((x) => x.id === id);
    if (!d || renaming) return;
    if (state.activeId !== id) switchDoc(id);
    const tab = [...el.tabs.querySelectorAll('.tab')][state.docs.indexOf(d)];
    const nameEl = tab && tab.querySelector('.name');
    if (!nameEl) return;
    const input = h('input', { class: 'field tab-edit', value: d.name, 'aria-label': 'Document name', maxlength: '120', size: String(Math.max(8, Math.min(30, d.name.length + 2))) });
    renaming = true;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      renaming = false;
      const name = input.value.trim().replace(/[\\/\u0000-\u001f]/g, '-');
      if (commit && name && name !== d.name) {
        if (d.handle && !confirm(`"${d.name}" is linked to a file on disk. Renaming detaches this tab from it: Save will ask where to save "${name}".\n\nContinue?`)) { renderTabs(); return; }
        log('info', 'doc-renamed', { docId: d.id, detached: Boolean(d.handle) });
        if (d.handle) { d.handle = null; d.mtime = 0; d.saved = null; dropHandle(d.id); }
        d.name = name;
        persistSession();
      }
      renderAll();
    };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
    input.addEventListener('blur', () => finish(true));
  }

  function renderChrome() {
    const has = Boolean(activeDoc());
    el.welcome.hidden = has;
    if (!has) {
      const last = lastSession();
      $('restoreBox').hidden = !last;
      if (last) $('btnRestore').textContent = `Restore your last session (${last.docs.length} document${last.docs.length === 1 ? '' : 's'})`;
    } else $('restoreBox').hidden = true;
    el.toolbar.querySelectorAll('.tb').forEach((b) => { if (!b.hasAttribute('data-always')) b.disabled = !has; });
    el.btnSave.disabled = !has;
    el.btnSaveAs.disabled = !has;
    el.main.dataset.view = state.view;
    el.main.dataset.wide = String(state.wide);
    el.btnWide.classList.toggle('active', state.wide);
    $('viewSwitch').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
    el.outline.hidden = !state.outline;
    el.btnOutline.classList.toggle('active', state.outline);
    $('btnProblems').classList.toggle('active', state.problems);
    el.problems.hidden = !state.problems || !has;
    applySplit();
    el.btnTheme.textContent = state.theme[0].toUpperCase() + state.theme.slice(1);
  }

  const renderAllNow = () => { renderTabs(); renderChrome(); renderPreview(); updateStats(); updatePos(); renderDiff(); scheduleLint(); };
  const renderAll = renderAllNow;
  const renderLight = debounce(() => { renderTabs(); renderPreview(); updateStats(); renderDiff(); }, 120);

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
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ theme: state.theme, outline: state.outline, wide: state.wide, wrap: state.wrap, lines: state.lines, sync: state.sync, split: state.split, problems: state.problems, previewEdit: state.previewEdit })); }
    catch (err) { log('warn', 'prefs-save-failed', { error: String(err) }); }
  }
  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      if (THEMES.includes(p.theme)) state.theme = p.theme;
      state.outline = Boolean(p.outline);
      if (typeof p.wide === 'boolean') state.wide = p.wide;
      for (const k of ['wrap', 'lines', 'sync', 'problems', 'previewEdit']) if (typeof p[k] === 'boolean') state[k] = p[k];
      if (Number.isFinite(p.split)) state.split = Math.min(0.85, Math.max(0.15, p.split));
    } catch (err) { log('warn', 'prefs-load-failed', { error: String(err) }); }
  }

  // ---------------------------------------------------------------- session persistence
  function persistSessionNow() {
    stashActiveViewState();
    const payload = {
      activeId: state.activeId,
      docs: state.docs.map((d) => ({
        id: d.id, name: d.name, text: d.text, saved: d.saved, eol: d.eol, savedEol: d.savedEol, view: d.view, src: d.src, mtime: d.mtime,
        hasHandle: Boolean(d.handle), sel: d.sel, scroll: d.scroll,
      })),
    };
    try {
      const json = JSON.stringify(payload);
      sessionStorage.setItem(SESSION_KEY, json);
      // the last session with documents in it, for the welcome screen's "restore" button (not on github.io: that storage is shared with other pages)
      if (!SHARED_ORIGIN && payload.docs.length) { try { localStorage.setItem(RECOVER_KEY, json); } catch (err) { log('warn', 'recover-snapshot-failed', { error: String(err) }); } }
      log('debug', 'session-persisted', { docs: payload.docs.length });
    } catch (err) {
      log('warn', 'session-persist-failed', { docs: payload.docs.length, error: String(err) });
    }
  }
  const persistSession = debounce(persistSessionNow, 400);

  const readJson = (storage, key) => { try { return JSON.parse(storage.getItem(key) || 'null'); } catch (err) { log('warn', 'session-parse-failed', { key, error: String(err) }); return null; } };

  /** Documents from a stored session. fresh = give them new ids (and copy their file links), for a session that belongs to another tab. */
  async function docsFromSession(raw, fresh) {
    const docs = [];
    let activeId = null;
    for (const r of raw.docs) {
      const id = fresh ? newId() : r.id;
      const handle = r.hasHandle ? await loadHandle(r.id) : null;
      if (fresh && handle) await saveHandle(id, handle);
      if (r.id === raw.activeId) activeId = id;
      docs.push({
        id, name: r.name, text: r.text, saved: r.saved, eol: r.eol === '\r\n' ? '\r\n' : '\n',
        savedEol: r.savedEol === '\r\n' || r.savedEol === '\n' ? r.savedEol : (r.eol === '\r\n' ? '\r\n' : '\n'), view: VIEWS.includes(r.view) ? r.view : state.view,
        src: r.src || null, mtime: r.mtime || 0, handle, sel: r.sel || [0, 0], scroll: r.scroll || 0,
      });
    }
    return { docs, activeId: activeId || (docs[0] && docs[0].id) };
  }
  function showRestored(docs, activeId, source) {
    state.docs.push(...docs);
    state.activeId = docs.some((d) => d.id === activeId) ? activeId : docs[0].id;
    log('info', 'session-restored', { docs: docs.length, source });
    const d = activeDoc();
    state.view = d.view;
    setEditorValue(d.text);
    el.editor.setSelectionRange(d.sel[0], d.sel[1]);
    el.editor.scrollTop = d.scroll;
  }
  /** This tab's own session: it survives a reload of the tab and is not shared with any other tab. */
  async function restoreSession() {
    const raw = readJson(sessionStorage, SESSION_KEY);
    if (!raw?.docs?.length) return;
    const { docs, activeId } = await docsFromSession(raw, false);
    showRestored(docs, activeId, 'tab');
  }
  // Older versions kept one shared session in localStorage: keep it once as the "last session" so it can still be restored from the welcome screen.
  function migrateLegacySession() {
    try {
      const legacy = localStorage.getItem(SESSION_KEY);
      if (legacy === null) return;
      localStorage.removeItem(SESSION_KEY);
      if (!SHARED_ORIGIN && localStorage.getItem(RECOVER_KEY) === null) localStorage.setItem(RECOVER_KEY, legacy);
      log('info', 'legacy-session-migrated', {});
    } catch (err) { log('warn', 'legacy-session-migration-failed', { error: String(err) }); }
  }
  // The last session of any tab, offered on the welcome screen of an empty tab. Never applied automatically: a new tab starts empty.
  function lastSession() { if (SHARED_ORIGIN) return null; const raw = readJson(localStorage, RECOVER_KEY); return raw?.docs?.length ? raw : null; }
  async function restoreLastSession() {
    const raw = lastSession();
    if (!raw) return;
    const { docs, activeId } = await docsFromSession(raw, true);
    showRestored(docs, activeId, 'last-session');
    renderAll();
    persistSession();
    toast(`Restored ${docs.length} document${docs.length === 1 ? '' : 's'} from your last session`);
  }
  function dismissLastSession() {
    try { localStorage.removeItem(RECOVER_KEY); } catch (err) { log('warn', 'recover-clear-failed', { error: String(err) }); }
    renderChrome();
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
    if (state.view === 'preview') setView('split'); // formatting needs a visible editor
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
    const cur = activeDoc();
    if (cur) cur.view = view;
    log('debug', 'view-changed', { view });
    savePrefs();
    renderChrome();
    renderPreview();
    renderDiff();
    if (view !== 'preview') el.editor.focus({ preventScroll: true });
  }

  let scrollLock = null;
  let scrollLockTimer = null;
  function syncScroll(src, dst) {
    if (!state.sync || state.view !== 'split' || (scrollLock && scrollLock !== src)) return;
    scrollLock = src;
    clearTimeout(scrollLockTimer);
    scrollLockTimer = setTimeout(() => { scrollLock = null; }, 90);
    const ratio = src.scrollTop / Math.max(1, src.scrollHeight - src.clientHeight);
    dst.scrollTop = ratio * (dst.scrollHeight - dst.clientHeight);
  }

  // ---------------------------------------------------------------- events
  // ---------------------------------------------------------------- layout: divider between editor and preview, editor preferences
  function applySplit() {
    const on = state.view === 'split';
    el.editorPane.style.flex = on ? `${state.split} 1 0` : '';
    el.preview.style.flex = on ? `${1 - state.split} 1 0` : '';
    el.paneSplit.setAttribute('aria-valuenow', String(Math.round(state.split * 100)));
  }
  makeSplitter(el.paneSplit, {
    ratioFrom: (e) => { const a = el.editorPane.getBoundingClientRect(), b = el.preview.getBoundingClientRect(); return (e.clientX - a.left) / ((b.right - a.left) || 1); },
    get: () => state.split, set: (v) => { state.split = v; applySplit(); }, reset: () => { state.split = 0.5; applySplit(); },
    dec: 'ArrowLeft', inc: 'ArrowRight', commit: () => savePrefs(),
  });
  function applyEditorPrefs() {
    widget.setWrap(state.wrap);
    widget.setLines(state.lines);
  }
  function setPref(key, value) {
    state[key] = value;
    savePrefs();
    if (key === 'wrap' || key === 'lines') applyEditorPrefs();
    if (key === 'previewEdit') renderPreview(true);
    renderChrome();
    log('info', 'pref-changed', { key, value });
  }

  // ---------------------------------------------------------------- helpers: clipboard, downloads, going to a place in the text
  async function copyText(text, what) {
    try { await navigator.clipboard.writeText(text); } catch (err) {
      const ta = h('textarea', { style: 'position:fixed;left:-9999px' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      ta.remove();
      if (!ok) return toast('Could not copy to the clipboard.', 'error');
    }
    log('debug', 'copied', { what, chars: text.length });
    toast(`Copied ${what}`);
  }
  function downloadText(filename, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' }));
    const a = h('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    log('info', 'downloaded', { name: filename, chars: text.length });
  }
  const lineOfOffset = (offset) => { const v = el.editor.value; let n = 1; for (let i = v.indexOf('\n'); i !== -1 && i < offset; i = v.indexOf('\n', i + 1)) n++; return n; };
  function ensureEditorVisible() { if (state.view === 'preview' || state.view === 'diff') setView('split'); }
  function goToOffset(offset, length) {
    ensureEditorVisible();
    el.editor.focus();
    el.editor.setSelectionRange(offset, offset + (length || 0));
    widget.scrollToLine(lineOfOffset(offset), true);
    updatePos();
  }

  // ---------------------------------------------------------------- diff view: the document against its saved version or another tab
  let diffBlocks = [], diffCur = -1;
  function renderDiff() {
    if (state.view !== 'diff') return;
    const d = activeDoc();
    const body = el.diffBody;
    body.replaceChildren();
    el.diffStats.replaceChildren();
    el.diffPos.textContent = '';
    diffBlocks = [];
    // what to compare with: the saved version, or any other open tab
    const others = state.docs.filter((x) => x.id !== (d && d.id));
    if (state.diffAgainst !== 'saved' && !others.some((x) => x.id === state.diffAgainst)) state.diffAgainst = 'saved';
    const sel = el.diffAgainst;
    sel.replaceChildren(h('option', { value: 'saved', text: 'Saved version (as opened or last saved)' }), ...others.map((x) => h('option', { value: x.id, text: x.name })));
    sel.value = state.diffAgainst;
    if (!d) { body.append(h('div', { class: 'diff-empty', text: 'Open a document to compare it.' })); return; }
    const other = state.diffAgainst === 'saved' ? null : state.docs.find((x) => x.id === state.diffAgainst);
    const aText = other ? other.text : (typeof d.saved === 'string' ? d.saved : '');
    const aLabel = other ? other.name : d.handle ? `${d.name} (saved)` : 'Saved version';
    if (aText.length + d.text.length > 3000000) { body.append(h('div', { class: 'diff-empty', text: 'These documents are too large to compare line by line here.' })); return; }
    const t0 = performance.now();
    const diff = JSS.textdiff.diffLines(aText, d.text);
    const st = diff.stats;
    if (!st.added && !st.removed && !st.changed) el.diffStats.append(h('span', { class: 'chip ok', text: d.savedEol !== undefined && d.eol !== d.savedEol && state.diffAgainst === 'saved' ? 'Same text (line ending changed)' : 'Identical' }));
    else {
      if (st.added) el.diffStats.append(h('span', { class: 'chip add', text: `+${st.added} added` }));
      if (st.removed) el.diffStats.append(h('span', { class: 'chip del', text: `−${st.removed} removed` }));
      if (st.changed) el.diffStats.append(h('span', { class: 'chip warn', text: `~${st.changed} changed` }));
    }
    const keep = new Array(diff.rows.length).fill(!el.diffCollapse.checked);
    if (el.diffCollapse.checked) diff.rows.forEach((r, i) => { if (r.kind !== 'eq') for (let j = Math.max(0, i - 3); j <= Math.min(diff.rows.length - 1, i + 3); j++) keep[j] = true; });
    const grid = h('div', { class: 'tdiff' });
    let skipped = 0, prevChange = false, budget = 6000;
    const flush = () => { if (skipped) { grid.append(h('div', { class: 'trow gap' }, h('div', { class: 'n' }), h('div', { class: 't', text: `… ${skipped.toLocaleString()} unchanged line${skipped === 1 ? '' : 's'}` }), h('div', { class: 'n' }), h('div', { class: 't' }))); skipped = 0; } };
    for (let i = 0; i < diff.rows.length; i++) {
      const r = diff.rows[i];
      if (!keep[i]) { skipped++; prevChange = false; continue; }
      flush();
      if (budget-- <= 0) { grid.append(h('div', { class: 'diff-empty', text: 'Output limited to 6,000 lines. Narrow the comparison or turn on “hide unchanged”.' })); break; }
      const row = h('div', { class: `trow ${r.kind}`, title: r.b ? 'Go to this line in the editor' : null },
        h('div', { class: 'n', text: r.a ? r.a.n : '' }), h('div', { class: 't a', text: r.a ? r.a.text : '' }), h('div', { class: 'n', text: r.b ? r.b.n : '' }), h('div', { class: 't b', text: r.b ? r.b.text : '' }));
      if (r.b) row.addEventListener('click', () => { const v = el.editor.value; let off = 0; for (let k = 1; k < r.b.n; k++) off = v.indexOf('\n', off) + 1; goToOffset(off); setView('split'); });
      if (r.kind !== 'eq') { if (!prevChange) { row.dataset.block = String(diffBlocks.length); diffBlocks.push(row); } prevChange = true; } else prevChange = false;
      grid.append(row);
    }
    flush();
    body.append(h('div', { class: 'diff-hdr' }, h('div', { text: `A · ${aLabel}` }), h('div', { text: `B · ${d.name} (this tab)` })));
    if (diff.truncated) body.append(h('div', { class: 'diff-empty', text: 'The two versions differ too much for a line-by-line alignment; the changed region is shown as replaced.' }));
    body.append(grid);
    log('debug', 'diff-rendered', { rows: diff.rows.length, ms: Math.round(performance.now() - t0) });
  }
  function gotoDiff(delta) {
    if (!diffBlocks.length) return;
    diffCur = ((diffCur < 0 ? (delta > 0 ? -1 : 0) : diffCur) + delta + diffBlocks.length) % diffBlocks.length;
    diffBlocks.forEach((b) => b.classList.remove('current'));
    diffBlocks[diffCur].classList.add('current');
    diffBlocks[diffCur].scrollIntoView({ block: 'center' });
    el.diffPos.textContent = `${diffCur + 1} / ${diffBlocks.length}`;
  }
  el.diffAgainst.addEventListener('change', () => { state.diffAgainst = el.diffAgainst.value; diffCur = -1; renderDiff(); });
  el.diffCollapse.addEventListener('change', () => { diffCur = -1; renderDiff(); });
  $('diffNext').addEventListener('click', () => gotoDiff(1));
  $('diffPrev').addEventListener('click', () => gotoDiff(-1));

  // ---------------------------------------------------------------- problems panel (Markdown checks)
  let lintResult = { issues: [], counts: { error: 0, warning: 0, info: 0 } };
  const LINT_MAX_CHARS = 600000;
  function runLintNow() {
    const d = activeDoc();
    lintResult = !d ? { issues: [], counts: { error: 0, warning: 0, info: 0 } } : d.text.length > LINT_MAX_CHARS ? { issues: [], counts: { error: 0, warning: 0, info: 0 }, skipped: true } : ML.lint(d.text);
    renderProblems();
  }
  const scheduleLint = debounce(runLintNow, 450);
  function renderProblems() {
    const c = lintResult.counts, n = c.error + c.warning;
    el.problemCount.hidden = n === 0;
    el.problemCount.textContent = String(n);
    el.problemCount.classList.toggle('err', c.error > 0);
    if (!state.problems) return;
    el.problemList.replaceChildren();
    const parts = [];
    if (c.error) parts.push(`${c.error} error${c.error === 1 ? '' : 's'}`);
    if (c.warning) parts.push(`${c.warning} warning${c.warning === 1 ? '' : 's'}`);
    if (c.info) parts.push(`${c.info} suggestion${c.info === 1 ? '' : 's'}`);
    el.problemSummary.textContent = lintResult.skipped ? 'document too large to check' : parts.join(', ') || 'no problems';
    if (lintResult.skipped) { el.problemList.append(h('div', { class: 'problems-empty', text: `Documents over ${(LINT_MAX_CHARS / 1000).toLocaleString()} KB are not checked, to keep typing responsive.` })); return; }
    if (!lintResult.issues.length) { el.problemList.append(h('div', { class: 'problems-empty', text: 'No problems found.' })); return; }
    for (const it of lintResult.issues) {
      const row = h('div', { class: `p-row ${it.severity}`, title: 'Go to this place in the editor' }, h('span', { class: 'p-pos', text: `Ln ${it.line}, Col ${it.col}` }), h('span', { class: 'p-rule', text: it.rule }), h('span', { class: 'p-msg', text: it.message }));
      row.addEventListener('click', () => goToOffset(it.offset));
      el.problemList.append(row);
    }
  }
  function toggleProblems(on) {
    state.problems = on === undefined ? !state.problems : on;
    savePrefs();
    renderChrome();
    if (state.problems) runLintNow();
  }
  $('btnProblems').addEventListener('click', () => toggleProblems());
  $('problemsClose').addEventListener('click', () => toggleProblems(false));

  // ---------------------------------------------------------------- transforms (Markdown clean-up and structure)
  /** Replace only the part of the text that differs, so the caret, the scroll position and the undo step stay small. */
  function replaceChanged(oldText, newText) {
    const max = Math.min(oldText.length, newText.length);
    let pre = 0;
    while (pre < max && oldText[pre] === newText[pre]) pre++;
    let suf = 0;
    while (suf < max - pre && oldText[oldText.length - 1 - suf] === newText[newText.length - 1 - suf]) suf++;
    replaceRange(pre, oldText.length - suf, newText.slice(pre, newText.length - suf));
  }
  /**
   * Runs `fn(text)` on the selected lines, or on the whole document when nothing is selected (opts.wholeDoc: always the whole document;
   * opts.needSelection: refuse without a selection). The edit goes through the browser's edit stack, so Ctrl/Cmd+Z undoes it.
   */
  function runTransform(label, fn, opts = {}) {
    const d = activeDoc();
    if (!d) return toast('Open or create a document first.');
    ensureEditorVisible();
    const ta = el.editor, text = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    const useSel = s !== e && !opts.wholeDoc;
    if (opts.needSelection && !useSel) return toast(`${label}: select the lines first.`);
    let r;
    try { r = useSel ? MT.applyRange(text, s, e, fn) : fn(text); } catch (err) {
      log('error', 'transform-failed', { label, error: String(err) });
      return toast(`${label} failed: ${err.message || err}`, 'error');
    }
    if (r.error) return toast(r.error, 'error');
    if (!r.changes || r.text === text) return toast(`${label}: ${r.note || 'nothing to change'}.`);
    replaceChanged(text, r.text);
    if (useSel) ta.setSelectionRange(r.from, r.to); else { const c = Math.min(s, r.text.length); ta.setSelectionRange(c, c); }
    log('info', 'transform', { label, changes: r.changes });
    toast(`${label}: ${r.note}. Undo with Ctrl/Cmd+Z.`);
  }
  const caretLine = () => lineOfOffset(el.editor.selectionStart) - 1;
  async function sortTableDialog() {
    const text = el.editor.value;
    const line = caretLine();
    const t = MT.findTables(text).find((x) => line >= x.start && line < x.end);
    if (!t) return toast('Put the caret inside a table first.');
    const v = await askForm('Sort table', [
      { name: 'column', type: 'select', label: 'Sort by column', value: '1', options: t.header.map((c, i) => [String(i + 1), c || `Column ${i + 1}`]) },
      { name: 'order', type: 'select', label: 'Order', value: 'asc', options: [['asc', 'Ascending (A → Z, 1 → 9)'], ['desc', 'Descending (Z → A, 9 → 1)']] },
    ], 'Sort');
    if (!v) return;
    el.editor.focus();
    runTransform('Sort table', (txt) => MT.sortTable(txt, { line: Math.min(line, txt.split('\n').length - 1), column: Number(v.column), order: v.order }), { wholeDoc: true });
  }
  async function reflowDialog() {
    const v = await askForm('Reflow paragraphs', [{ name: 'width', label: 'Line width (columns)', value: String(state.reflowWidth || 80), hint: 'Plain paragraphs only: headings, lists, quotes, tables and code are left as they are. Applies to the selection, or the whole document.' }], 'Reflow');
    if (!v) return;
    const width = Math.max(20, Math.min(400, parseInt(v.width, 10) || 80));
    state.reflowWidth = width;
    el.editor.focus();
    runTransform('Reflow', (txt) => MT.reflow(txt, { width }));
  }
  async function tocDialog() {
    const v = await askForm('Table of contents', [{ name: 'maxLevel', type: 'select', label: 'Include headings down to level', value: '3', options: [1, 2, 3, 4, 5, 6].map((n) => [String(n), `H${n}`]) }], 'Insert or update');
    if (!v) return;
    el.editor.focus();
    runTransform('Table of contents', (txt) => MT.toc(txt, { maxLevel: Number(v.maxLevel) }), { wholeDoc: true });
  }
  const transformItems = () => [
    { label: 'Format tables', title: 'Align the columns of every table', run: () => runTransform('Format tables', (t) => MT.formatTables(t)) },
    { label: 'Sort table by column…', title: 'Sort the table the caret is in', run: sortTableDialog },
    { label: 'Sort lines / list items A → Z', title: 'Select the lines first. Nested list items travel with their parent.', run: () => runTransform('Sort', (t) => MT.sortLines(t, { order: 'asc' }), { needSelection: true }) },
    { label: 'Sort lines / list items Z → A', run: () => runTransform('Sort', (t) => MT.sortLines(t, { order: 'desc' }), { needSelection: true }) },
    { label: 'Remove duplicate lines', title: 'Select the lines first', run: () => runTransform('Remove duplicates', (t) => MT.dedupeLines(t), { needSelection: true }) },
    { sep: true },
    { label: 'Renumber ordered lists', run: () => runTransform('Renumber lists', (t) => MT.renumberLists(t)) },
    { label: 'Use "-" for bullet lists', run: () => runTransform('Bullets', (t) => MT.normalizeBullets(t, '-')) },
    { label: 'Reflow paragraphs…', run: reflowDialog },
    { label: 'Unwrap paragraphs (one line each)', run: () => runTransform('Unwrap', (t) => MT.unwrap(t)) },
    { label: 'Convert underlined headings to #', run: () => runTransform('Headings', (t) => MT.normalizeHeadings(t)) },
    { sep: true },
    { label: 'Trim trailing spaces', run: () => runTransform('Trim', (t) => MT.stripTrailing(t)) },
    { label: 'Collapse extra blank lines', run: () => runTransform('Blank lines', (t) => MT.collapseBlank(t)) },
    { sep: true },
    { label: 'Insert / update table of contents…', title: 'Between <!-- toc --> and <!-- tocstop -->, or below the first heading', run: tocDialog },
  ];

  // ---------------------------------------------------------------- export: HTML, plain text, print / PDF
  function previewHtml() { renderPreview(true); return el.previewBody.innerHTML; }
  async function saveTextAs(filename, text, mime, ext, description) {
    try {
      if (!window.showSaveFilePicker) { downloadText(filename, text, mime); return toast(`Downloaded ${filename}`); }
      const handle = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description, accept: { [mime]: [ext] } }] });
      const w = await handle.createWritable();
      try { await w.write(text); } catch (err) { await w.abort().catch(() => {}); throw err; }
      await w.close();
      toast(`Saved ${handle.name}`);
    } catch (err) {
      if (err.name === 'AbortError') return;
      log('error', 'export-failed', { error: String(err) });
      toast(`Export failed: ${err.message || err}`, 'error');
    }
  }
  async function copyRich() {
    const d = activeDoc();
    const html = previewHtml(), plain = MX.toPlainText(d.text);
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard && navigator.clipboard.write) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })]);
        return toast('Copied formatted text: paste it into a document or an email');
      } catch (err) { log('warn', 'rich-copy-failed', { error: String(err) }); }
    }
    copyText(html, 'the HTML (formatted copy is not available here)');
  }
  const exportItems = () => {
    const d = activeDoc();
    const title = d ? d.name.replace(/\.[^.]*$/, '') : 'document';
    return [
      { label: 'Copy as formatted text', title: 'Paste into Docs, Word or an email', run: copyRich },
      { label: 'Copy as HTML', run: () => copyText(previewHtml(), 'the HTML') },
      { label: 'Copy as plain text', run: () => copyText(MX.toPlainText(d.text), 'plain text') },
      { sep: true },
      { label: 'Save as HTML…', title: 'A self-contained page with its own styles', run: () => saveTextAs(MX.exportName(d.name, 'html'), MX.standaloneHtml(title, previewHtml()), 'text/html', '.html', 'HTML page') },
      { label: 'Save as plain text…', run: () => saveTextAs(MX.exportName(d.name, 'txt'), MX.toPlainText(d.text), 'text/plain', '.txt', 'Text') },
      { sep: true },
      { label: 'Print / Save as PDF…', title: 'Prints the rendered document; choose "Save as PDF" as the destination', run: () => { previewHtml(); window.print(); } },
    ];
  };

  // ---------------------------------------------------------------- menus and the command palette
  const need = (fn) => () => { if (!activeDoc()) return toast('Open or create a document first.'); fn(); };
  $('btnTransform').addEventListener('click', (e) => showMenu(e.currentTarget, transformItems()));
  $('btnExport').addEventListener('click', (e) => showMenu(e.currentTarget, exportItems()));
  $('btnViewMenu').addEventListener('click', (e) => showMenu(e.currentTarget, [
    { label: 'Line numbers', checked: state.lines, run: () => setPref('lines', !state.lines) },
    { label: 'Word wrap', checked: state.wrap, run: () => setPref('wrap', !state.wrap) },
    { label: 'Synced scrolling (split view)', checked: state.sync, run: () => setPref('sync', !state.sync) },
    { label: 'Click to edit in the preview', checked: state.previewEdit, title: 'Double-click a block to edit its Markdown; click a task checkbox to toggle it', run: () => setPref('previewEdit', !state.previewEdit) },
    { sep: true },
    { label: 'Reset editor / preview sizes', run: () => { state.split = 0.5; applySplit(); savePrefs(); } },
  ]));
  $('btnFind').addEventListener('click', need(() => { ensureEditorVisible(); widget.openFind(); }));
  function stepDoc(delta) {
    if (state.docs.length < 2) return;
    const i = state.docs.findIndex((d) => d.id === state.activeId);
    switchDoc(state.docs[(i + delta + state.docs.length) % state.docs.length].id);
  }
  function toggleEol() {
    const d = activeDoc();
    if (!d) return;
    d.eol = d.eol === '\r\n' ? '\n' : '\r\n';
    log('info', 'eol-changed', { docId: d.id, eol: d.eol === '\r\n' ? 'crlf' : 'lf' });
    toast(`Lines will be saved with ${d.eol === '\r\n' ? 'CRLF' : 'LF'} endings`);
    persistSession();
    renderAll();
  }
  el.stEol.addEventListener('click', toggleEol);

  function paletteCommands() {
    const d = activeDoc();
    const has = Boolean(d);
    const cmds = [];
    const add = (title, run, o) => cmds.push(Object.assign({ title, run }, o));
    for (const [v, name] of [['edit', 'Edit'], ['split', 'Split'], ['preview', 'Preview'], ['diff', 'Diff']]) add(`View: ${name}`, () => setView(v), { hint: 'view', enabled: has && state.view !== v });
    add('Find and replace', () => { ensureEditorVisible(); widget.openFind(); }, { hint: 'Ctrl/Cmd+F', enabled: has });
    for (const it of transformItems()) if (!it.sep) add(`Transform: ${it.label.replace(/…$/, '')}`, it.run, { hint: 'transform', enabled: has });
    for (const it of exportItems()) if (!it.sep) add(`Export: ${it.label.replace(/…$/, '')}`, it.run, { hint: 'export', enabled: has });
    add(state.problems ? 'Problems: hide' : 'Problems: show', () => toggleProblems(), { hint: 'check', enabled: has });
    add(`Line numbers: turn ${state.lines ? 'off' : 'on'}`, () => setPref('lines', !state.lines), { hint: 'view' });
    add(`Word wrap: turn ${state.wrap ? 'off' : 'on'}`, () => setPref('wrap', !state.wrap), { hint: 'view' });
    add(`Synced scrolling: turn ${state.sync ? 'off' : 'on'}`, () => setPref('sync', !state.sync), { hint: 'view' });
    add(`Click to edit in the preview: turn ${state.previewEdit ? 'off' : 'on'}`, () => setPref('previewEdit', !state.previewEdit), { hint: 'view' });
    add('Copy the block at the caret', copyBlockAtCaret, { hint: 'copy', enabled: has });
    add('Preview: undo edit', () => stepPreviewHistory(-1), { hint: 'preview', enabled: has });
    add('Preview: redo edit', () => stepPreviewHistory(1), { hint: 'preview', enabled: has });
    add(state.outline ? 'Outline: hide' : 'Outline: show', () => el.btnOutline.click(), { hint: 'view' });
    add(state.wide ? 'Full width: turn off' : 'Full width: turn on', () => el.btnWide.click(), { hint: 'view' });
    add('Theme: cycle auto / light / dark', () => el.btnTheme.click(), { hint: 'theme' });
    add('Reset editor / preview sizes', () => { state.split = 0.5; applySplit(); savePrefs(); }, { hint: 'view' });
    add('New document', newDoc, { hint: 'file' });
    add('Open file…', openFiles, { hint: 'file' });
    add('Save', saveDoc, { hint: 'Ctrl/Cmd+S', enabled: has });
    add('Save as…', saveDocAs, { hint: 'file', enabled: has });
    add('Rename tab…', () => renameDoc(state.activeId), { hint: 'tabs', enabled: has });
    add('Next tab', () => stepDoc(1), { hint: 'tabs', enabled: state.docs.length > 1 });
    add('Previous tab', () => stepDoc(-1), { hint: 'tabs', enabled: state.docs.length > 1 });
    add('Close tab', () => closeDoc(state.activeId), { hint: 'tabs', enabled: has });
    add(d && d.eol === '\r\n' ? 'Line ending: switch to LF' : 'Line ending: switch to CRLF', toggleEol, { hint: 'file', enabled: has });
    for (const [name, label] of [['bold', 'Bold'], ['italic', 'Italic'], ['strike', 'Strikethrough'], ['code', 'Inline code'], ['link', 'Link'], ['image', 'Image'], ['codeblock', 'Code block'], ['table', 'Insert table'],
      ['ul', 'Bullet list'], ['ol', 'Numbered list'], ['task', 'Task list'], ['quote', 'Quote'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['hr', 'Horizontal rule']]) add(`Format: ${label}`, () => runCommand(name), { hint: 'format', enabled: has });
    return cmds;
  }
  const palette = new Palette($('palette'), $('palInput'), $('palList'), paletteCommands, log);
  $('btnPalette').addEventListener('click', () => palette.open());

  el.editor.addEventListener('input', () => {
    widget.refresh();
    const d = activeDoc();
    if (!d) return;
    d.text = el.editor.value;
    scheduleLint();
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
    if (e.key === 'F1' || (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p')) { e.preventDefault(); palette.toggle(); return; }
    if (!mod || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'z' || k === 'y') {
      const typing = document.activeElement && document.activeElement.matches && document.activeElement.matches('textarea, input, select');
      if (!typing && !blockEditing && state.view !== 'edit' && state.view !== 'diff' && activeDoc()) { e.preventDefault(); stepPreviewHistory(k === 'y' || e.shiftKey ? 1 : -1); return; }
    }
    if (k === 'f' && !e.shiftKey) { if (activeDoc() && !e.defaultPrevented) { e.preventDefault(); ensureEditorVisible(); widget.openFind(); } return; }
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
  $('btnRestore').addEventListener('click', restoreLastSession);
  $('btnDismissRestore').addEventListener('click', dismissLastSession);
  $('welcomeOpen').addEventListener('click', openFiles);
  $('welcomeNew').addEventListener('click', newDoc);

  // ---------------------------------------------------------------- editing in the preview (click-to-edit blocks, task checkboxes)
  const pvHistory = (d) => (d.pvHistory ??= { undo: [], redo: [] });
  /** Replace [start,end) of the document from the preview: the editor text, the session, the checks and the preview all follow through its input event. */
  function applyPreviewEdit(start, end, replacement, label) {
    const d = activeDoc();
    if (!d) return;
    const before = d.text;
    const after = before.slice(0, start) + replacement + before.slice(end);
    if (after === before) return;
    const h = pvHistory(d);
    h.undo.push({ before, after });
    if (h.undo.length > 100) h.undo.shift();
    h.redo.length = 0;
    setEditorValue(after);
    el.editor.dispatchEvent(new Event('input', { bubbles: true })); // d.text, lint, preview, session
    log('info', 'preview-edit', { label, docId: d.id, chars: replacement.length });
  }
  function stepPreviewHistory(direction) {
    const d = activeDoc();
    if (!d) return;
    const h = pvHistory(d);
    const entry = direction < 0 ? h.undo[h.undo.length - 1] : h.redo[h.redo.length - 1];
    if (!entry) return toast(direction < 0 ? 'Nothing to undo in the preview.' : 'Nothing to redo in the preview.');
    if (d.text !== (direction < 0 ? entry.after : entry.before)) return toast('The text changed since that edit. Use Undo in the editor instead.', 'error');
    const target = direction < 0 ? entry.before : entry.after;
    (direction < 0 ? h.undo : h.redo).pop();
    (direction < 0 ? h.redo : h.undo).push(entry);
    setEditorValue(target);
    el.editor.dispatchEvent(new Event('input', { bubbles: true }));
    toast(direction < 0 ? 'Undid the last preview edit' : 'Redid the preview edit');
  }
  const autosize = (ta) => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; };
  function startBlockEdit(blk) {
    const d = activeDoc();
    if (!d || blockEditing || !blk) return;
    const start = Number(blk.dataset.s), end = Number(blk.dataset.e);
    const raw = d.text.slice(start, end);
    const trail = /\s*$/.exec(raw)[0]; // the blank lines after the block belong to the document, not to the text being edited
    const src = raw.slice(0, raw.length - trail.length);
    hideBlockTools();
    blockEditing = { start, end, raw, src, trail, docId: d.id };
    const ta = h('textarea', { class: 'md-block-edit', spellcheck: 'false', 'aria-label': 'Edit this block as Markdown. Ctrl or Cmd plus Enter, or clicking outside, applies it. Escape cancels.' });
    ta.value = src;
    blk.classList.add('editing');
    blk.replaceChildren(ta);
    autosize(ta);
    ta.focus();
    ta.setSelectionRange(src.length, src.length);
    ta.addEventListener('input', () => autosize(ta));
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finishBlockEdit(false, ta); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); finishBlockEdit(true, ta); }
      else if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { // keep indentation usable in lists; Escape then Tab leaves the box
        e.preventDefault();
        ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
        autosize(ta);
      }
    });
    ta.addEventListener('blur', () => finishBlockEdit(true, ta));
    log('debug', 'block-edit-start', { docId: d.id, chars: src.length });
  }
  function finishBlockEdit(commit, ta) {
    const be = blockEditing;
    if (!be) return;
    blockEditing = null;
    const d = activeDoc();
    const next = ta.value.replace(/\s+$/, '');
    const still = d && d.id === be.docId && d.text.slice(be.start, be.end) === be.raw;
    if (commit && still && next !== be.src) {
      if (next) applyPreviewEdit(be.start, be.end, next + be.trail, 'block');
      else { // an empty box deletes the block together with the blank lines around it (keeping one newline if it was the last block)
        let s0 = be.start, e0 = be.end;
        while (e0 < d.text.length && /\s/.test(d.text[e0])) e0++;
        let rep = '';
        if (e0 >= d.text.length) { while (s0 > 0 && /\s/.test(d.text[s0 - 1])) s0--; rep = s0 > 0 ? '\n' : ''; }
        applyPreviewEdit(s0, e0, rep, 'delete block');
      }
    }
    if (!(commit && still && next !== be.src)) renderPreview(true); // cancelled or unchanged: draw the block again
  }
  function toggleTask(cb) {
    const blk = cb.closest('.md-block'), d = activeDoc();
    if (!blk || !d) return;
    const start = Number(blk.dataset.s), end = Number(blk.dataset.e);
    const raw = d.text.slice(start, end);
    const n = [...blk.querySelectorAll('input[type="checkbox"]')].indexOf(cb);
    const lines = raw.split('\n'), prot = MT.protectedLines(lines);
    let off = 0, i = 0, pos = -1;
    for (let k = 0; k < lines.length && pos < 0; k++) {
      const m = !prot[k] && /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])\]/.exec(lines[k]);
      if (m) { if (i === n) pos = off + m[1].length; i++; }
      off += lines[k].length + 1;
    }
    if (pos < 0) return toast('Could not find that checkbox in the source. Use the editor.', 'error');
    applyPreviewEdit(start + pos, start + pos + 1, raw[pos] === ' ' ? 'x' : ' ', 'task');
  }
  // ---------------------------------------------------------------- block toolbar in the preview: Copy and Edit
  const blockTools = h('div', { class: 'block-tools', hidden: true },
    h('button', { type: 'button', class: 'tb', 'data-bt': 'copy', title: 'Copy this block: the code for a code block, the Markdown for anything else', text: 'Copy' }),
    h('button', { type: 'button', class: 'tb', 'data-bt': 'edit', title: 'Edit this block as Markdown (or double-click it)', text: 'Edit' }));
  el.preview.append(blockTools);
  let toolTarget = null; // the <pre> or .md-block the toolbar currently belongs to
  const hideBlockTools = () => { blockTools.hidden = true; toolTarget = null; };
  function showBlockTools(target) {
    if (blockEditing || !target) return hideBlockTools();
    toolTarget = target;
    const blk = target.closest('.md-block');
    blockTools.querySelector('[data-bt="edit"]').hidden = !(state.previewEdit && blk);
    blockTools.hidden = false;
    const pr = el.preview.getBoundingClientRect(), r = target.getBoundingClientRect();
    blockTools.style.top = `${Math.max(0, r.top - pr.top + el.preview.scrollTop - 4)}px`;
    blockTools.style.left = `${Math.max(0, r.right - pr.left + el.preview.scrollLeft - blockTools.offsetWidth - 6)}px`;
  }
  /** What "copy" means for a block: the code of a code block, otherwise the block's own Markdown. */
  function blockCopy(target) {
    const d = activeDoc();
    if (!d || !target) return null;
    if (target.tagName === 'PRE') return { text: (target.querySelector('code') || target).textContent.replace(/\n$/, ''), what: 'the code' };
    const blk = target.closest('.md-block');
    if (!blk) return null;
    const only = blk.children.length === 1 && blk.firstElementChild.tagName === 'PRE' ? blk.firstElementChild : null;
    if (only) return { text: (only.querySelector('code') || only).textContent.replace(/\n$/, ''), what: 'the code' };
    return { text: d.text.slice(Number(blk.dataset.s), Number(blk.dataset.e)).replace(/\s+$/, ''), what: 'the block (Markdown)' };
  }
  el.previewBody.addEventListener('mouseover', (e) => {
    if (blockEditing) return;
    const pre = e.target.closest && e.target.closest('pre');
    const target = pre || (e.target.closest && e.target.closest('.md-block'));
    if (target) { if (target !== toolTarget) showBlockTools(target); } else hideBlockTools();
  });
  el.preview.addEventListener('mouseleave', hideBlockTools);
  el.preview.addEventListener('scroll', () => { if (toolTarget) showBlockTools(toolTarget); }, { passive: true });
  blockTools.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-bt]');
    if (!btn || !toolTarget) return;
    if (btn.dataset.bt === 'copy') {
      const c = blockCopy(toolTarget);
      if (!c) return;
      await copyText(c.text, c.what);
      const old = btn.textContent; btn.textContent = 'Copied ✓';
      setTimeout(() => { btn.textContent = old; }, 1200);
    } else if (btn.dataset.bt === 'edit') {
      const blk = toolTarget.closest('.md-block');
      hideBlockTools();
      if (blk) startBlockEdit(blk);
    }
  });
  /** Keyboard route: copy the Markdown block the editor caret is in. */
  function copyBlockAtCaret() {
    const d = activeDoc();
    if (!d) return;
    const pos = el.editor.selectionStart;
    let off = 0, hit = null;
    for (const tok of marked.lexer(d.text)) {
      const start = off;
      off += tok.raw.length;
      if (tok.type === 'space') continue;
      if (pos >= start && pos <= off) { hit = { tok, start, end: off }; break; }
    }
    if (!hit) return toast('No block at the caret.');
    const src = d.text.slice(hit.start, hit.end).replace(/\s+$/, '');
    if (hit.tok.type === 'code') copyText(hit.tok.text, 'the code'); else copyText(src, 'the block (Markdown)');
  }
  el.previewBody.addEventListener('dblclick', (e) => {
    if (!state.previewEdit || e.target.closest('a, input, textarea')) return;
    const blk = e.target.closest('.md-block');
    if (blk && !blk.classList.contains('editing')) { window.getSelection()?.removeAllRanges(); startBlockEdit(blk); }
  });

  // In-page anchors (#heading) and external links in the preview.
  el.previewBody.addEventListener('click', (e) => {
    const cb = e.target.closest('.md-block input[type="checkbox"]');
    if (cb && state.previewEdit) { e.preventDefault(); toggleTask(cb); return; }
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

  // ---------------------------------------------------------------- boot
  (async function boot() {
    log('info', 'boot', {});
    migrateLegacySession();
    loadPrefs();
    applyEditorPrefs();
    if (!IS_EXTENSION) $('webHint').hidden = false;
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
