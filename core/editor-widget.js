/* MD Studio core: the editor widget. A transparent <textarea> sits over a colour layer, a find-match layer and a bracket layer,
 * next to a line-number gutter; all of them scroll together.
 *
 * Every layer is built as one block per logical line with the same font, padding and wrapping rules as the textarea, so a long line wraps to
 * the same rows in all of them. The gutter then takes each number's height from the measured height of its line (a wrapped line keeps its
 * number on the first row), which also works for prose, where wrapping happens at word boundaries.
 *
 * Options: highlight(text) -> per line [{t, c}] pieces (see mdhighlight.js); bracketStrings (false for prose); onCaret(); toast(msg, kind); log(level, event, ctx).
 */
(function (root) {
  'use strict';
  const JSS = root.JSS;
  const MAX_HL_CHARS = 200000; // beyond this (or MAX_LINES) the layers are dropped, the textarea shows plain text and never wraps
  const MAX_LINES = 30000;

  function el(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return e;
  }
  const countLines = (text) => { let n = 1; for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) n++; return n; };

  class EditorWidget {
    constructor(box, ta, opts) {
      this.box = box; this.ta = ta; this.opts = opts || {};
      this.gutter = box.querySelector('.ed-gutter');
      this.hl = box.querySelector('.ed-hl');
      this.findLayer = box.querySelector('.ed-find');
      this.brkLayer = box.querySelector('.ed-brk');
      this.layers = [this.hl, this.findLayer, this.brkLayer];
      this.text = null; this.plain = false; this.wrap = true; this.lines = true;
      this.lineEls = []; this.heights = null; this.gutterStyled = false; this.measureQueued = false;
      this.find = { open: false, matches: [], idx: -1, regex: false, cs: false };
      this.buildFindBar();
      ta.addEventListener('scroll', () => this.sync());
      ta.addEventListener('keydown', (e) => this.onKey(e));
      for (const ev of ['keyup', 'mouseup', 'focus', 'select']) ta.addEventListener(ev, () => { this.drawBracket(); if (this.opts.onCaret) this.opts.onCaret(); });
      ta.addEventListener('blur', () => this.brkLayer.replaceChildren());
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.scheduleMeasure()).observe(ta);
      this.applyAttrs();
    }

    applyAttrs() {
      this.box.dataset.wrap = this.wrap && !this.plain ? 'on' : 'off';
      this.box.dataset.lines = this.lines ? 'on' : 'off';
    }
    setWrap(on) { this.wrap = on; this.heights = null; this.applyAttrs(); this.scheduleMeasure(); }
    setLines(on) { this.lines = on; this.applyAttrs(); this.scheduleMeasure(); }

    sync() {
      const top = this.ta.scrollTop, left = this.ta.scrollLeft;
      this.gutter.scrollTop = top;
      for (const l of this.layers) { l.scrollTop = top; l.scrollLeft = left; }
    }

    /** Re-colour and renumber from the textarea value. Call after any change of the text; a no-op when it did not change (unless forced). */
    refresh(force) {
      const text = this.ta.value;
      if (!force && text === this.text) return;
      this.text = text;
      const count = countLines(text);
      this.plain = text.length > MAX_HL_CHARS || count > MAX_LINES;
      this.box.classList.toggle('plain', this.plain);
      this.applyAttrs();
      this.syncGutter(count);
      if (this.plain) { this.hl.replaceChildren(); this.lineEls = []; } else this.renderHl(text);
      if (this.find.open) this.runFind(false);
      this.drawBracket();
      this.scheduleMeasure();
      this.sync();
      if (this.opts.onCaret) this.opts.onCaret();
    }

    syncGutter(count) {
      const g = this.gutter;
      if (this.heights) this.heights.length = Math.min(this.heights.length, count);
      while (g.childElementCount > count) g.lastChild.remove();
      if (g.childElementCount < count) {
        const frag = document.createDocumentFragment();
        for (let i = g.childElementCount; i < count; i++) frag.append(el('div', { class: 'n', text: String(i + 1) }));
        g.append(frag);
      }
    }

    renderHl(text) {
      const lines = this.opts.highlight ? this.opts.highlight(text) : text.split('\n').map((l) => [{ t: l, c: null }]);
      const frag = document.createDocumentFragment();
      for (const pieces of lines) {
        const d = document.createElement('div');
        d.className = 'l';
        for (const p of pieces) d.append(p.c ? el('span', { class: p.c, text: p.t }) : document.createTextNode(p.t));
        frag.append(d);
      }
      this.hl.replaceChildren(frag);
      this.lineEls = [...this.hl.children];
    }

    scheduleMeasure() {
      if (this.measureQueued) return;
      this.measureQueued = true;
      const run = () => this.measure();
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else setTimeout(run, 0);
    }
    /** Reads the real layout: scrollbar sizes (so the layers wrap at the textarea's width) and each line's height (so numbers stay level with wrapped lines). */
    measure() {
      this.measureQueued = false;
      const ta = this.ta;
      this.box.style.setProperty('--sbw', `${Math.max(0, ta.offsetWidth - ta.clientWidth)}px`);
      this.box.style.setProperty('--sbh', `${Math.max(0, ta.offsetHeight - ta.clientHeight)}px`);
      const kids = this.gutter.children;
      if (!(this.wrap && !this.plain) || !this.lineEls.length) {
        if (this.gutterStyled) { for (const k of kids) k.style.height = ''; this.gutterStyled = false; } // numbers go back to one row each
        this.heights = null;
        this.sync();
        return;
      }
      const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
      const hs = this.lineEls.map((e) => e.offsetHeight); // all reads first, then all writes
      const prev = this.heights || [];
      const want = new Array(hs.length);
      for (let i = 0; i < hs.length && i < kids.length; i++) {
        want[i] = hs[i] > lh * 1.5 ? hs[i] : 0;
        if ((prev[i] || 0) !== want[i]) { kids[i].style.height = want[i] ? `${want[i]}px` : ''; if (want[i]) this.gutterStyled = true; }
      }
      this.heights = want;
      this.sync();
    }

    scrollToLine(line, center) {
      const lh = parseFloat(getComputedStyle(this.ta).lineHeight) || 20;
      const e = this.lineEls[line - 1];
      const top = e ? e.offsetTop : (line - 1) * lh;
      this.ta.scrollTop = Math.max(0, center ? top - this.ta.clientHeight / 2 : top - 3 * lh);
    }
    lineOf(pos) { let n = 1; const v = this.ta.value; for (let i = v.indexOf('\n'); i !== -1 && i < pos; i = v.indexOf('\n', i + 1)) n++; return n; }

    // ------------------------------------------------------------ marks (find matches, bracket pair)
    /** ranges: sorted [{start, end, cls}]; draws the text again with <mark>s so the layer wraps exactly like the textarea. */
    renderMarks(layer, ranges) {
      if (!ranges.length || this.plain) { layer.replaceChildren(); return; }
      const lines = this.ta.value.split('\n');
      const frag = document.createDocumentFragment();
      let offset = 0, ri = 0;
      for (const line of lines) {
        const end = offset + line.length;
        const d = document.createElement('div');
        d.className = 'l';
        while (ri < ranges.length && ranges[ri].end <= offset) ri++;
        let pos = offset;
        for (let j = ri; j < ranges.length && ranges[j].start < end; j++) {
          const s = Math.max(ranges[j].start, pos), e = Math.min(ranges[j].end, end);
          if (e <= s) continue;
          if (s > pos) d.append(document.createTextNode(line.slice(pos - offset, s - offset)));
          d.append(el('mark', { class: ranges[j].cls || null, text: line.slice(s - offset, e - offset) }));
          pos = e;
        }
        if (pos < end) d.append(document.createTextNode(line.slice(pos - offset)));
        frag.append(d);
        offset = end + 1;
      }
      layer.replaceChildren(frag);
    }

    drawBracket() {
      const ta = this.ta, text = ta.value;
      if (this.plain || document.activeElement !== ta || ta.selectionStart !== ta.selectionEnd) { this.brkLayer.replaceChildren(); return; }
      const pair = JSS.editing.bracketPair(text, ta.selectionStart, { strings: this.opts.bracketStrings !== false });
      if (!pair) { this.brkLayer.replaceChildren(); return; }
      this.renderMarks(this.brkLayer, [{ start: pair[0], end: pair[0] + 1 }, { start: pair[1], end: pair[1] + 1 }]);
    }

    // ------------------------------------------------------------ keys
    /** Replace [from,to) through the browser's edit stack (native undo), falling back to setRangeText. Keeps focus where it was. */
    insert(from, to, ins) {
      const ta = this.ta, prev = document.activeElement;
      if (prev !== ta) ta.focus({ preventScroll: true }); // execCommand edits the focused element
      ta.setSelectionRange(from, to);
      const done = document.execCommand && document.execCommand('insertText', false, ins) && ta.value.slice(from, from + ins.length) === ins;
      if (!done) {
        ta.setRangeText(ins, from, to, 'end');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (prev && prev !== ta && prev.focus) prev.focus({ preventScroll: true });
    }
    onKey(e) {
      if (e.isComposing) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); this.openFind(); return; }
      if (e.key === 'Escape' && this.find.open) { e.stopPropagation(); this.closeFind(); }
    }

    // ------------------------------------------------------------ find / replace
    buildFindBar() {
      const f = this.find;
      const term = el('input', { type: 'text', class: 'field', placeholder: 'Find', 'aria-label': 'Find', spellcheck: 'false' });
      const repl = el('input', { type: 'text', class: 'field', placeholder: 'Replace with', 'aria-label': 'Replace with', spellcheck: 'false' });
      const rx = el('input', { type: 'checkbox', 'aria-label': 'Regular expression' });
      const cs = el('input', { type: 'checkbox', 'aria-label': 'Match case' });
      const count = el('span', { class: 'meta', role: 'status' });
      const btn = (text, title, fn) => el('button', { class: 'tb', type: 'button', text, title, onclick: fn });
      this.fb = { term, repl, count };
      this.bar = el('div', { class: 'findbar', hidden: true },
        term, el('label', { class: 'check', title: 'Regular expression' }, rx, '.*'), el('label', { class: 'check', title: 'Match case' }, cs, 'Aa'), count,
        btn('↑', 'Previous match (Shift+Enter)', () => this.step(-1)), btn('↓', 'Next match (Enter)', () => this.step(1)),
        repl, btn('Replace', 'Replace the current match', () => this.replaceCurrent()), btn('All', 'Replace every match', () => this.replaceEvery()),
        btn('✕', 'Close (Esc)', () => this.closeFind()));
      this.box.before(this.bar);
      term.addEventListener('input', () => this.runFind(true));
      rx.addEventListener('change', () => { f.regex = rx.checked; this.runFind(true); });
      cs.addEventListener('change', () => { f.cs = cs.checked; this.runFind(true); });
      for (const input of [term, repl]) input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); if (input === repl) this.replaceCurrent(); else this.step(e.shiftKey ? -1 : 1); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeFind(); }
      });
    }
    openFind() {
      const sel = this.ta.value.slice(this.ta.selectionStart, this.ta.selectionEnd);
      this.find.open = true;
      this.bar.hidden = false;
      if (sel && !sel.includes('\n') && sel.length < 200) this.fb.term.value = sel;
      this.fb.term.focus();
      this.fb.term.select();
      this.runFind(true);
      if (this.opts.log) this.opts.log('debug', 'find-open', {});
    }
    closeFind() {
      this.find.open = false;
      this.bar.hidden = true;
      this.findLayer.replaceChildren();
      this.ta.focus();
    }
    runFind(jump) {
      const f = this.find, text = this.ta.value, termText = this.fb.term.value;
      const r = JSS.find.findAll(text, termText, { regex: f.regex, caseSensitive: f.cs });
      f.matches = r.matches;
      this.fb.term.classList.toggle('bad', Boolean(r.error));
      if (jump || f.idx >= f.matches.length || f.idx < 0) {
        const at = this.ta.selectionStart;
        const i = f.matches.findIndex((m) => m.start >= at);
        f.idx = f.matches.length ? (i === -1 ? 0 : i) : -1;
      }
      this.drawFind(jump && f.idx >= 0);
      this.fb.count.textContent = r.error ? 'invalid regex' : !termText ? '' : f.matches.length ? `${f.idx + 1} / ${f.matches.length}${r.truncated ? '+' : ''}` : 'no matches';
    }
    drawFind(reveal) {
      const f = this.find;
      this.renderMarks(this.findLayer, f.matches.map((m, i) => ({ start: m.start, end: m.end, cls: i === f.idx ? 'cur' : null })));
      if (reveal && f.idx >= 0) {
        const m = f.matches[f.idx];
        this.ta.setSelectionRange(m.start, m.end);
        const e = this.lineEls[this.lineOf(m.start) - 1];
        const top = e ? e.offsetTop : 0, lh = parseFloat(getComputedStyle(this.ta).lineHeight) || 20;
        if (top < this.ta.scrollTop || top > this.ta.scrollTop + this.ta.clientHeight - 3 * lh) this.ta.scrollTop = Math.max(0, top - this.ta.clientHeight / 2);
      }
      this.sync();
    }
    step(d) {
      const f = this.find;
      if (!f.matches.length) return;
      f.idx = (f.idx + d + f.matches.length) % f.matches.length;
      this.drawFind(true);
      this.fb.count.textContent = `${f.idx + 1} / ${f.matches.length}`;
    }
    replaceCurrent() {
      const f = this.find;
      if (f.idx < 0 || !f.matches[f.idx]) return;
      const m = f.matches[f.idx];
      const r = JSS.find.replaceOne(this.ta.value, m, this.fb.term.value, this.fb.repl.value, { regex: f.regex, caseSensitive: f.cs });
      this.insert(m.start, m.end, r.text.slice(m.start, r.caret));
      this.ta.setSelectionRange(r.caret, r.caret);
      this.refresh();
      this.runFind(true);
    }
    replaceEvery() {
      const f = this.find;
      const r = JSS.find.replaceAll(this.ta.value, this.fb.term.value, this.fb.repl.value, { regex: f.regex, caseSensitive: f.cs });
      if (!r.count) return;
      this.insert(0, this.ta.value.length, r.text);
      this.refresh();
      this.runFind(true);
      if (this.opts.toast) this.opts.toast(`Replaced ${r.count.toLocaleString()} ${r.count === 1 ? 'match' : 'matches'}${r.truncated ? ` (the first ${JSS.find.MAX_MATCHES})` : ''}`);
    }
  }

  JSS.EditorWidget = EditorWidget;
  if (typeof module !== 'undefined' && module.exports) module.exports = JSS;
})(typeof self !== 'undefined' ? self : globalThis);
