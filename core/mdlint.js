/* MD Studio core: Markdown checks. lint(text) -> {issues, counts}; each issue is {line (1-based), col, offset, rule, severity, message}.
 * Fenced code, front matter and HTML comments are never checked, and `code spans` are blanked out before links are looked for.
 * Severities: error (the document is broken), warning (probably a mistake), info (style).
 */
(function (root) {
  'use strict';
  const JSS = root.JSS;
  const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

  function lint(text) {
    const T = JSS.mdtransform;
    const lines = text.split('\n'), prot = T.protectedLines(lines);
    const issues = [];
    const starts = [];
    { let o = 0; for (const l of lines) { starts.push(o); o += l.length + 1; } }
    const add = (i, col, rule, severity, message) => issues.push({ line: i + 1, col: col + 1, offset: starts[i] + col, rule, severity, message });

    // HTML comments hide content from every rule
    let comment = false;
    const hidden = lines.map((l, i) => {
      if (prot[i]) return true;
      if (comment) { if (l.includes('-->')) comment = false; return true; }
      if (l.trim().startsWith('<!--')) { if (!l.includes('-->')) comment = true; return true; }
      return false;
    });

    // unclosed fence (the protection logic treats the rest of the document as code)
    let fence = null;
    lines.forEach((l, i) => {
      const m = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(l);
      if (!m) return;
      if (!fence) fence = { ch: m[1][0], len: m[1].length, line: i };
      else if (m[1][0] === fence.ch && m[1].length >= fence.len && !m[2].trim()) fence = null;
    });
    if (fence) add(fence.line, 0, 'unclosed-fence', 'error', 'This code fence is never closed, so everything below it is treated as code.');

    // headings
    const headings = T.headingsOf(lines, prot).filter((h) => !hidden[h.line]);
    let prev = 0, h1s = 0;
    for (const h of headings) {
      if (prev && h.level > prev + 1) add(h.line, 0, 'heading-increment', 'warning', `Heading level jumps from ${prev} to ${h.level}; use level ${prev + 1}.`);
      if (h.level === 1 && ++h1s === 2) add(h.line, 0, 'multiple-h1', 'warning', 'There is more than one top-level heading.');
      prev = h.level;
    }
    lines.forEach((l, i) => { if (!hidden[i] && /^#{1,6}[^#\s]/.test(l)) add(i, 0, 'heading-space', 'warning', 'Add a space after the # for this to be a heading.'); });

    // anchors and reference definitions
    const seen = new Map(), slugs = new Set();
    for (const h of headings) { const s = T.slugify(h.text); const n = seen.get(s) || 0; seen.set(s, n + 1); slugs.add(n ? `${s}-${n}` : s); }
    const defs = new Set();
    lines.forEach((l, i) => { const m = !hidden[i] && /^\s{0,3}\[([^\]]+)\]:\s*\S/.exec(l); if (m) defs.add(m[1].toLowerCase()); });

    lines.forEach((l, i) => {
      if (hidden[i]) return;
      const bare = l.replace(/`+[^`]*`+/g, (c) => ' '.repeat(c.length)); // code spans do not contain links
      let m;
      const link = /(!?)\[([^\]\n]*)\]\(([^)\n]*)\)/g;
      while ((m = link.exec(bare))) {
        const [all, bang, label, dest] = m;
        const target = dest.trim().split(/\s+/)[0];
        if (!target || target === '<>') add(i, m.index, 'empty-link', 'warning', `The ${bang ? 'image' : 'link'} "${label || '…'}" has no destination.`);
        else if (!bang && !label.trim()) add(i, m.index, 'empty-link', 'warning', 'This link has no text.');
        if (bang && !label.trim()) add(i, m.index, 'image-alt', 'info', 'This image has no alt text.');
        if (!bang && target.startsWith('#') && target.length > 1) {
          let id = target.slice(1);
          try { id = decodeURIComponent(id); } catch (e) { /* keep as written */ }
          if (!slugs.has(T.slugify(id)) && !slugs.has(id.toLowerCase())) add(i, m.index + all.indexOf('(') + 1, 'broken-anchor', 'warning', `No heading matches the anchor "${target}".`);
        }
      }
      const ref = /(?<!\])\[([^\]\n]+)\]\[([^\]\n]*)\]/g;
      while ((m = ref.exec(bare))) {
        const key = (m[2] || m[1]).toLowerCase();
        if (!defs.has(key)) add(i, m.index, 'undefined-reference', 'warning', `The reference "${m[2] || m[1]}" has no definition (a line like [${m[2] || m[1]}]: https://…).`);
      }
    });

    // tables
    for (const t of T.findTables(text)) {
      if (hidden[t.start]) continue;
      t.rows.forEach((r, k) => { if (r.length !== t.header.length) add(t.start + 2 + k, 0, 'table-columns', 'warning', `This row has ${r.length} cell${r.length === 1 ? '' : 's'}, the header has ${t.header.length}.`); });
    }

    // style
    let blank = 0;
    lines.forEach((l, i) => {
      if (prot[i]) { blank = 0; return; }
      if (!l.trim()) { if (++blank === 2) add(i, 0, 'blank-lines', 'info', 'More than one blank line in a row.'); } else blank = 0;
      if (/[ \t]+$/.test(l) && l.trim() && !(/ {2,}$/.test(l) && !/\t/.test(l) && lines[i + 1] !== undefined && lines[i + 1].trim())) add(i, l.replace(/[ \t]+$/, '').length, 'trailing-spaces', 'info', 'Trailing whitespace.');
    });

    issues.sort((a, b) => a.offset - b.offset || a.rule.localeCompare(b.rule));
    const counts = { error: 0, warning: 0, info: 0 };
    for (const x of issues) counts[x.severity]++;
    return { issues, counts };
  }

  JSS.mdlint = { lint };
  if (typeof module !== 'undefined' && module.exports) module.exports = JSS;
})(typeof self !== 'undefined' ? self : globalThis);
