/* JSON Studio core: find and replace over plain text (used by the Raw and Preview editors). */
(function (root) {
  'use strict';
  const JSS = root.JSS;
  const MAX_MATCHES = 5000;
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function build(term, o) {
    const flags = o.caseSensitive ? 'g' : 'gi';
    return new RegExp(o.regex ? term : escapeRe(term), flags);
  }

  /** {matches:[{start,end}], truncated, error?}. Empty matches (e.g. /a*\/) are skipped. */
  function findAll(text, term, opts) {
    const o = opts || {};
    if (!term) return { matches: [], truncated: false };
    let re;
    try { re = build(term, o); } catch (err) { return { matches: [], truncated: false, error: String(err.message || err) }; }
    const matches = [];
    let m;
    while ((m = re.exec(text))) {
      if (m[0] === '') { re.lastIndex++; continue; }
      matches.push({ start: m.index, end: m.index + m[0].length });
      if (matches.length >= MAX_MATCHES) return { matches, truncated: true };
    }
    return { matches, truncated: false };
  }

  /** Replacement text for one match. In regex mode `$1`, `$&` etc. work; in plain mode the replacement is literal. */
  function replacementFor(matchText, term, repl, o) {
    if (!o.regex) return repl;
    return matchText.replace(build(term, Object.assign({}, o, { caseSensitive: o.caseSensitive })), repl);
  }

  /** Replace the single match `m` (as returned by findAll) -> {text, caret}. */
  function replaceOne(text, m, term, repl, opts) {
    const o = opts || {};
    const r = replacementFor(text.slice(m.start, m.end), term, repl, o);
    return { text: text.slice(0, m.start) + r + text.slice(m.end), caret: m.start + r.length };
  }

  /** Replace every match -> {text, count}. */
  function replaceAll(text, term, repl, opts) {
    const o = opts || {};
    const found = findAll(text, term, o);
    if (found.error || !found.matches.length) return { text, count: 0, error: found.error };
    let out = '', last = 0;
    for (const m of found.matches) {
      out += text.slice(last, m.start) + replacementFor(text.slice(m.start, m.end), term, repl, o);
      last = m.end;
    }
    return { text: out + text.slice(last), count: found.matches.length, truncated: found.truncated };
  }

  JSS.find = { findAll, replaceOne, replaceAll, MAX_MATCHES };
  if (typeof module !== 'undefined' && module.exports) module.exports = JSS;
})(typeof self !== 'undefined' ? self : globalThis);
