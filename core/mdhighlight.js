/* MD Studio core: Markdown syntax colouring for the editor. Line based, with state for fenced code, front matter and HTML comments.
 * highlightLines(text) -> one array per line of pieces {t: text, c: class|null}; the pieces of a line concatenate to the line exactly,
 * so the colour layer always mirrors the textarea character for character. Colours only, never weight or style: that would change glyph widths.
 */
(function (root) {
  'use strict';
  const JSS = root.JSS;

  // inline tokens, tried in this order at each position (earliest match wins, ties go to the earlier entry)
  const INLINE = [
    ['icode', /(`+)(?:[^`]|(?!\1)`)+?\1(?!`)/g],
    ['image', /!\[[^\]\n]*\]\([^)\n]*\)/g],
    ['link', /\[[^\]\n]+\]\([^)\n]*\)/g],
    ['reflink', /\[[^\]\n]+\]\[[^\]\n]*\]/g],
    ['autolink', /<(?:https?:\/\/|mailto:)[^>\s]+>/g],
    ['url', /https?:\/\/[^\s<>)\]]+/g],
    ['strong', /(\*\*|__)(?!\s)(?:(?!\1).)+?(?<!\s)\1/g],
    ['strike', /~~(?!\s)(?:(?!~~).)+?(?<!\s)~~/g],
    ['em', /\*(?![\s*])[^*\n]+?(?<![\s*])\*|(?<!\w)_(?![\s_])[^_\n]+?(?<![\s_])_(?!\w)/g],
    ['tag', /<\/?[A-Za-z][^>\n]*>/g],
    ['entity', /&(?:[A-Za-z][A-Za-z0-9]*|#\d+|#[xX][0-9a-fA-F]+);/g],
  ];
  const LINK_PARTS = /^(!?\[)([^\]]*)(\]\()([^)]*)(\))$/;

  const push = (out, t, c) => { if (t) out.push({ t, c: c || null }); };

  function inline(s, base, out) {
    let pos = 0;
    while (pos < s.length) {
      let best = null;
      for (const [name, re] of INLINE) {
        re.lastIndex = pos;
        const m = re.exec(s);
        if (m && m[0].length && (!best || m.index < best.m.index)) best = { name, m };
      }
      if (!best) break;
      const { name, m } = best;
      push(out, s.slice(pos, m.index), base);
      const tok = m[0];
      if (name === 'link' || name === 'image') {
        const p = LINK_PARTS.exec(tok);
        if (p) { push(out, p[1], 'md-mark'); push(out, p[2], 'md-link-text'); push(out, p[3], 'md-mark'); push(out, p[4], 'md-link-url'); push(out, p[5], 'md-mark'); } else push(out, tok, 'md-link-text');
      } else {
        push(out, tok, { icode: 'md-icode', reflink: 'md-link-text', autolink: 'md-link-url', url: 'md-link-url', strong: 'md-strong', strike: 'md-strike', em: 'md-em', tag: 'md-tag', entity: 'md-entity' }[name]);
      }
      pos = m.index + tok.length;
    }
    push(out, s.slice(pos), base);
  }

  const FENCE = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;
  const HEADING = /^(#{1,6})(\s+|$)(.*)$/;
  const LIST = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s)?/;
  const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const SETEXT = /^\s{0,3}(=+|-+)\s*$/;
  const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/; // GFM delimiter row: hyphens with optional colons

  function highlightLines(text) {
    const lines = text.split('\n');
    const result = new Array(lines.length);
    // front matter needs a closing --- (or ...) further down, otherwise the first line is just a rule
    let fence = null, comment = false, front = lines[0] === '---' && lines.slice(1).some((l) => l === '---' || l === '...');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i], out = [];
      result[i] = out;
      if (front) { push(out, line, 'md-meta'); if (i > 0 && (line === '---' || line === '...')) front = false; continue; }
      if (comment) { push(out, line, 'md-comment'); if (line.includes('-->')) comment = false; continue; }
      if (fence) {
        const m = FENCE.exec(line);
        if (m && m[2][0] === fence.ch && m[2].length >= fence.len && !m[3].trim()) { push(out, line, 'md-fence'); fence = null; } else push(out, line, 'md-code');
        continue;
      }
      const f = FENCE.exec(line);
      if (f) { fence = { ch: f[2][0], len: f[2].length }; push(out, f[1] + f[2], 'md-fence'); push(out, f[3], 'md-fence-info'); continue; }
      if (line.trim().startsWith('<!--')) { push(out, line, 'md-comment'); if (!line.includes('-->')) comment = true; continue; }
      const h = HEADING.exec(line);
      if (h) { push(out, h[1] + h[2], 'md-hmark'); inline(h[3], 'md-h', out); continue; }
      if (SETEXT.test(line) && i > 0 && lines[i - 1].trim() && !/^\s*([-*+>]|\d+[.)]|#{1,6}\s|\|)/.test(lines[i - 1])) { push(out, line, 'md-hmark'); continue; }
      if (HR.test(line)) { push(out, line, 'md-hr'); continue; }
      let rest = line;
      const q = /^(\s{0,3}(?:>\s?)+)/.exec(rest);
      let base = null;
      if (q) { push(out, q[1], 'md-quote-mark'); rest = rest.slice(q[1].length); base = 'md-quote'; }
      const l = LIST.exec(rest);
      if (l) {
        push(out, l[1], base); push(out, l[2], 'md-list'); push(out, l[3], base);
        if (l[4]) push(out, l[4], 'md-task');
        rest = rest.slice(l[0].length);
      }
      if (!q && !l && TABLE_SEP.test(line) && line.includes('-') && line.includes('|')) { push(out, line, 'md-tsep'); continue; }
      if (!q && rest.includes('|') && /^\s*\|.*\|\s*$/.test(rest)) {
        rest.split(/(\|)/).forEach((part) => { if (part === '|') push(out, part, 'md-pipe'); else inline(part, base, out); });
        continue;
      }
      inline(rest, base, out);
    }
    return result;
  }

  JSS.mdhighlight = { highlightLines };
  if (typeof module !== 'undefined' && module.exports) module.exports = JSS;
})(typeof self !== 'undefined' ? self : globalThis);
