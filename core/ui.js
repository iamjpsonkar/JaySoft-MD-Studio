/* MD Studio core: small UI helpers shared by the editor: popup menu, modal form, draggable divider, command palette.
 * Everything builds DOM with createElement / textContent, never innerHTML. */
(function (root) {
  'use strict';
  const JSS = root.JSS;

  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return e;
  }

  // ---------------------------------------------------------------- popup menu
  let openMenu = null;
  /** items: [{label, run, title, checked}], {sep:true}, {note:true, label}. Closes on outside click or Escape. */
  function showMenu(anchor, items) {
    closeMenu();
    const r = anchor.getBoundingClientRect();
    const menu = h('div', { class: 'menu', role: 'menu', style: `left:${Math.max(4, Math.min(r.left, innerWidth - 260))}px;top:${r.bottom + 4}px` });
    for (const it of items) {
      if (it.sep) menu.append(h('div', { class: 'menu-sep', role: 'separator' }));
      else if (it.note) menu.append(h('div', { class: 'empty-item', text: it.label }));
      else menu.append(h('button', { role: it.checked === undefined ? 'menuitem' : 'menuitemcheckbox', 'aria-checked': it.checked === undefined ? null : String(it.checked), title: it.title || null, type: 'button',
        text: (it.checked === undefined ? '' : it.checked ? '✓ ' : ' ') + it.label, onclick: () => { closeMenu(); it.run(); } }));
    }
    document.body.append(menu);
    openMenu = menu;
    const first = menu.querySelector('button');
    if (first) first.focus();
    const outside = (e) => { if (!menu.contains(e.target)) closeMenu(); };
    setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
    menu.outside = outside;
    menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); anchor.focus(); } });
  }
  function closeMenu() {
    if (!openMenu) return;
    document.removeEventListener('mousedown', openMenu.outside, true);
    openMenu.remove();
    openMenu = null;
  }
  const menuOpen = () => Boolean(openMenu);

  // ---------------------------------------------------------------- modal form
  /** Resolves to {name: value} on submit, or null when cancelled (Esc, click outside, Cancel). fields: {name,label,type:'text'|'select'|'checkbox',options,value,placeholder,hint} */
  function askForm(title, fields, submitLabel) {
    return new Promise((resolve) => {
      const prev = document.activeElement;
      const controls = {};
      const rows = fields.map((f) => {
        let c;
        if (f.type === 'select') c = h('select', { class: 'field' }, f.options.map(([v, l]) => h('option', { value: v, selected: v === f.value, text: l })));
        else if (f.type === 'checkbox') c = h('input', { type: 'checkbox', checked: f.value ? true : null });
        else c = h('input', { class: 'field', type: 'text', value: f.value || '', placeholder: f.placeholder || null, spellcheck: 'false', autocomplete: 'off' });
        controls[f.name] = c;
        return h('label', { class: f.type === 'checkbox' ? 'modal-row check' : 'modal-row' }, f.type === 'checkbox' ? [c, h('span', { text: f.label })] : [h('span', { text: f.label }), c], f.hint ? h('small', { class: 'meta', text: f.hint }) : null);
      });
      const done = (vals) => { overlay.remove(); if (prev && prev.focus && document.contains(prev)) prev.focus(); resolve(vals); };
      const form = h('form', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('h2', { text: title }), ...rows,
        h('div', { class: 'modal-actions' }, h('button', { type: 'button', class: 'btn', text: 'Cancel', onclick: () => done(null) }), h('button', { type: 'submit', class: 'btn primary', text: submitLabel || 'OK' })));
      const overlay = h('div', { class: 'modal-overlay' }, form);
      form.addEventListener('submit', (e) => { e.preventDefault(); done(Object.fromEntries(Object.entries(controls).map(([k, c]) => [k, c.type === 'checkbox' ? c.checked : c.value]))); });
      overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } });
      overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) done(null); });
      document.body.append(overlay);
      Object.values(controls)[0].focus();
    });
  }

  // ---------------------------------------------------------------- draggable divider
  /** Pointer drag plus arrow keys (Shift = bigger steps, Home / double-click = reset). get/set work on a 0..1 ratio. */
  function makeSplitter(el, { ratioFrom, get, set, reset, dec, inc, commit, clamp }) {
    const lim = clamp || ((v) => Math.min(0.85, Math.max(0.15, v)));
    let drag = false;
    const finish = () => { if (!drag) return; drag = false; el.classList.remove('drag'); document.body.classList.remove('resizing'); if (commit) commit(); };
    el.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      drag = true; el.classList.add('drag'); document.body.classList.add('resizing');
      if (el.setPointerCapture && e.pointerId !== undefined) { try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events have no active pointer */ } }
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => { if (drag) set(lim(ratioFrom(e))); });
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    el.addEventListener('lostpointercapture', finish);
    el.addEventListener('dblclick', () => { reset(); if (commit) commit(); });
    el.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.02;
      if (e.key === dec) set(lim(get() - step));
      else if (e.key === inc) set(lim(get() + step));
      else if (e.key === 'Home') reset();
      else return;
      e.preventDefault();
      if (commit) commit();
    });
  }

  // ---------------------------------------------------------------- command palette
  /** overlay > .palette > input + ul. getCommands() -> [{title, hint, run, enabled}] is asked each time it opens and as you type. */
  class Palette {
    constructor(overlay, input, list, getCommands, log) {
      Object.assign(this, { overlay, input, list, getCommands, log, items: [], sel: 0, prev: null });
      input.addEventListener('input', () => { this.sel = 0; this.render(); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (this.items.length) { this.sel = (this.sel + (e.key === 'ArrowDown' ? 1 : -1) + this.items.length) % this.items.length; this.render(); } }
        else if (e.key === 'Enter') { e.preventDefault(); this.run(this.sel); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(true); }
      });
      overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) this.close(true); });
    }
    get isOpen() { return !this.overlay.hidden; }
    open() {
      this.prev = document.activeElement;
      this.sel = 0;
      this.overlay.hidden = false;
      this.input.value = '';
      this.render();
      this.input.focus();
    }
    close(refocus) {
      this.overlay.hidden = true;
      if (refocus && this.prev && this.prev.focus && document.contains(this.prev)) this.prev.focus();
    }
    toggle() { if (this.isOpen) this.close(true); else this.open(); }
    render() {
      const words = this.input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      this.items = this.getCommands().filter((c) => c.enabled !== false)
        .map((c) => ({ c, hay: `${c.title} ${c.hint || ''}`.toLowerCase() }))
        .filter((x) => words.every((w) => x.hay.includes(w)))
        .sort((a, b) => (words.length ? a.hay.indexOf(words[0]) - b.hay.indexOf(words[0]) : 0))
        .map((x) => x.c);
      this.sel = Math.min(this.sel, Math.max(0, this.items.length - 1));
      this.list.replaceChildren();
      if (!this.items.length) this.list.append(h('li', { class: 'none', text: 'No matching command' }));
      this.items.forEach((c, i) => {
        const li = h('li', { role: 'option', id: `pal-${i}`, 'aria-selected': String(i === this.sel), class: i === this.sel ? 'sel' : null }, h('span', { text: c.title }), h('span', { class: 'hint', text: c.hint || '' }));
        li.addEventListener('mousedown', (e) => { e.preventDefault(); this.run(i); });
        this.list.append(li);
      });
      this.input.setAttribute('aria-activedescendant', this.items.length ? `pal-${this.sel}` : '');
      const cur = this.list.querySelector('.sel');
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    }
    run(i) {
      const c = this.items[i];
      if (!c) return;
      this.close(true);
      if (this.log) this.log('info', 'palette-run', { command: c.title });
      try { c.run(); } catch (err) { if (this.log) this.log('error', 'palette-command-failed', { command: c.title, error: String(err) }); }
    }
  }

  JSS.ui = { h, showMenu, closeMenu, menuOpen, askForm, makeSplitter, Palette };
  if (typeof module !== 'undefined' && module.exports) module.exports = JSS;
})(typeof self !== 'undefined' ? self : globalThis);
