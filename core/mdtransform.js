/* MD Studio core: Markdown transforms. Pure functions over text, each returning {text, changes, note}; `changes` is 0 when nothing
 * would change, so the caller can say so instead of rewriting the document. Fenced code and front matter are never touched.
 * applyRange(text, start, end, fn) runs one on the whole lines covered by a selection.
 */
(function (root) {
  'use strict';
  const JSS = root.JSS;

  const plural = (n, w) => `${n.toLocaleString()} ${n === 1 ? w : w.endsWith('y') ? `${w.slice(0, -1)}ies` : `${w}s`}`;
  const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
  const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
  const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const result = (text, changes, note) => ({ text, changes, note: note || (changes ? '' : 'nothing to change') });

  /** protectedLines(lines) -> boolean per line: inside a fenced code block (fence lines included) or front matter. */
  function protectedLines(lines) {
    const out = new Array(lines.length).fill(false);
    let fence = null;
    let front = lines[0] === '---' && lines.slice(1).some((l) => l === '---' || l === '...');
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (front) { out[i] = true; if (i > 0 && (l === '---' || l === '...')) front = false; continue; }
      const m = FENCE.exec(l);
      if (fence) {
        out[i] = true;
        if (m && m[1][0] === fence.ch && m[1].length >= fence.len && !l.slice(m[0].length).trim()) fence = null;
      } else if (m) { out[i] = true; fence = { ch: m[1][0], len: m[1].length }; }
    }
    return out;
  }

  /** Run `fn(subText)` on the whole lines covered by [start, end); returns {text, changes, note, from, to} with the new range of those lines. */
  function applyRange(text, start, end, fn) {
    const from = text.lastIndexOf('\n', start - 1) + 1;
    const endRef = end > start && text[end - 1] === '\n' ? end - 1 : end;
    let to = text.indexOf('\n', endRef);
    if (to === -1) to = text.length;
    const r = fn(text.slice(from, to));
    return Object.assign({}, r, { text: text.slice(0, from) + r.text + text.slice(to), from, to: from + r.text.length });
  }

  // ------------------------------------------------------------------ tables
  /** Split a table row into trimmed cells; pipes inside `code` or escaped as \| do not split. */
  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    const cells = [];
    let cur = '', inCode = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\\' && s[i + 1] === '|') { cur += '\\|'; i++; continue; }
      if (c === '`') inCode = !inCode;
      if (c === '|' && !inCode) { cells.push(cur.trim()); cur = ''; } else cur += c;
    }
    cells.push(cur.trim());
    return cells;
  }
  const alignOf = (cell) => (/^:-+:$/.test(cell) ? 'center' : /^-+:$/.test(cell) ? 'right' : /^:-+$/.test(cell) ? 'left' : 'none');

  /** Finds the GFM tables: [{start, end (exclusive), header:[cells], align:[..], rows:[[cells]]}] (line indexes). */
  function findTables(text) {
    const lines = text.split('\n'), prot = protectedLines(lines), tables = [];
    for (let i = 0; i + 1 < lines.length; i++) {
      if (prot[i] || prot[i + 1] || !lines[i].includes('|') || !TABLE_SEP.test(lines[i + 1]) || !lines[i + 1].includes('-')) continue;
      const header = splitRow(lines[i]), sep = splitRow(lines[i + 1]);
      if (header.length !== sep.length) continue;
      let j = i + 2;
      const rows = [];
      while (j < lines.length && !prot[j] && lines[j].trim() && lines[j].includes('|')) { rows.push(splitRow(lines[j])); j++; }
      tables.push({ start: i, end: j, header, align: sep.map(alignOf), rows });
      i = j - 1;
    }
    return tables;
  }
  const cpLen = (s) => [...s].length;
  function renderTable(t) {
    const n = Math.max(t.header.length, ...t.rows.map((r) => r.length));
    const pad = (arr) => Array.from({ length: n }, (_, i) => arr[i] || '');
    const header = pad(t.header), rows = t.rows.map(pad), align = Array.from({ length: n }, (_, i) => t.align[i] || 'none');
    const width = header.map((h, i) => Math.max(3, cpLen(h), ...rows.map((r) => cpLen(r[i]))));
    const cell = (s, i) => {
      const gap = width[i] - cpLen(s);
      if (align[i] === 'right') return ' '.repeat(gap) + s;
      if (align[i] === 'center') return ' '.repeat(Math.floor(gap / 2)) + s + ' '.repeat(Math.ceil(gap / 2));
      return s + ' '.repeat(gap);
    };
    const line = (cells) => `| ${cells.map(cell).join(' | ')} |`;
    const sep = align.map((a, i) => {
      const w = width[i];
      return a === 'center' ? `:${'-'.repeat(w - 2)}:` : a === 'right' ? `${'-'.repeat(w - 1)}:` : a === 'left' ? `:${'-'.repeat(w - 1)}` : '-'.repeat(w);
    });
    return [line(header), `| ${sep.join(' | ')} |`, ...rows.map(line)];
  }
  function replaceTables(text, tables, build) {
    if (!tables.length) return result(text, 0, 'no tables found');
    const lines = text.split('\n');
    let changed = 0;
    for (const t of [...tables].reverse()) {
      const next = build(t);
      const before = lines.slice(t.start, t.end);
      if (next.length !== before.length || next.some((l, k) => l !== before[k])) changed++;
      lines.splice(t.start, t.end - t.start, ...next);
    }
    return result(lines.join('\n'), changed, changed ? `formatted ${plural(changed, 'table')}` : 'the tables are already aligned');
  }
  /** Align the columns of every table (cell padding, alignment colons kept). */
  function formatTables(text) { return replaceTables(text, findTables(text), renderTable); }

  const numOf = (s) => { const v = s.replace(/[\s,$€£%]/g, ''); return v !== '' && /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(v) ? Number(v) : NaN; };
  /**
   * Sort the body of the table that contains line `opts.line` (0-based) by a column (1-based number or header text).
   * Numbers sort numerically, text in natural order; empty cells go last. opts: {line, column, order:'asc'|'desc'}
   */
  function sortTable(text, opts) {
    const o = Object.assign({ order: 'asc', column: 1 }, opts);
    const t = findTables(text).find((x) => o.line >= x.start && o.line < x.end);
    if (!t) return Object.assign(result(text, 0), { error: 'The caret is not inside a table.' });
    let col = typeof o.column === 'number' ? o.column - 1 : t.header.findIndex((h) => h.toLowerCase() === String(o.column).trim().toLowerCase());
    if (typeof o.column === 'string' && /^\d+$/.test(o.column.trim())) col = Number(o.column) - 1;
    if (col < 0 || col >= t.header.length) return Object.assign(result(text, 0), { error: `The table has no column "${o.column}". It has: ${t.header.join(', ')}.` });
    const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const dir = o.order === 'desc' ? -1 : 1;
    const idx = t.rows.map((r, i) => [r, i]);
    idx.sort((a, b) => {
      const x = a[0][col] || '', y = b[0][col] || '';
      if (!x && !y) return a[1] - b[1];
      if (!x) return 1;
      if (!y) return -1;
      const nx = numOf(x), ny = numOf(y);
      const c = !Number.isNaN(nx) && !Number.isNaN(ny) ? nx - ny : coll.compare(x, y);
      return dir * c || a[1] - b[1];
    });
    const sorted = idx.map((p) => p[0]);
    if (sorted.every((r, i) => r === t.rows[i])) return result(text, 0, `the table is already sorted by ${t.header[col]}`);
    const lines = text.split('\n');
    lines.splice(t.start, t.end - t.start, ...renderTable(Object.assign({}, t, { rows: sorted })));
    return result(lines.join('\n'), 1, `sorted ${plural(sorted.length, 'row')} by ${t.header[col]}`);
  }

  // ------------------------------------------------------------------ lists and lines
  const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/;
  /**
   * Sort lines A→Z. When the text is a list (items and their indented continuations), the top-level items are sorted and
   * keep their nested lines. opts: {order, natural:true, caseInsensitive:true}
   */
  function sortLines(text, opts) {
    const o = Object.assign({ order: 'asc', natural: true, caseInsensitive: true }, opts);
    const coll = new Intl.Collator(undefined, { numeric: o.natural !== false, sensitivity: o.caseInsensitive ? 'base' : 'variant' });
    const dir = o.order === 'desc' ? -1 : 1;
    const lines = text.split('\n');
    const nonBlank = lines.filter((l) => l.trim());
    if (nonBlank.length < 2) return result(text, 0, 'select at least two lines to sort');
    const indentOf = (l) => /^\s*/.exec(l)[0].length;
    const items = lines.map((l) => LIST_ITEM.exec(l));
    const isList = items.some(Boolean) && lines.every((l, i) => !l.trim() || items[i] || indentOf(l) > 0);
    let blocks;
    if (isList) {
      const top = Math.min(...lines.map((l, i) => (items[i] ? indentOf(l) : Infinity)));
      blocks = [];
      lines.forEach((l, i) => {
        if (items[i] && indentOf(l) === top) blocks.push({ lines: [l], key: items[i][5], marker: items[i][2] });
        else if (blocks.length) blocks[blocks.length - 1].lines.push(l);
      });
      // blank lines between items stay attached to the item above; trailing blanks of the last item stay last
    } else blocks = lines.filter((l) => l.trim()).map((l) => ({ lines: [l], key: l.trim() }));
    const sorted = blocks.map((b, i) => [b, i]).sort((a, b) => dir * coll.compare(a[0].key, b[0].key) || a[1] - b[1]).map((p) => p[0]);
    if (isList) { // markers belong to positions, not to items: a numbered list stays 1, 2, 3 after sorting
      const markers = blocks.map((b) => b.marker);
      sorted.forEach((b, k) => { b.lines = [b.lines[0].replace(/^(\s*)(?:[-*+]|\d+[.)])/, (m0, ind) => ind + markers[k]), ...b.lines.slice(1)]; });
    }
    const out = sorted.flatMap((b) => b.lines);
    const same = out.length === (isList ? lines.length : nonBlank.length) && (isList ? out.every((l, i) => l === lines[i]) : out.every((l, i) => l === nonBlank[i]));
    if (same) return result(text, 0, 'already in that order');
    const next = isList ? out : [...out, ...lines.filter((l) => !l.trim())];
    return result(next.join('\n'), 1, `sorted ${plural(blocks.length, isList ? 'list item' : 'line')}`);
  }

  /** Remove repeated lines (the first of each is kept; blank lines are never removed). */
  function dedupeLines(text) {
    const seen = new Set(), out = [];
    let removed = 0;
    for (const l of text.split('\n')) {
      const k = l.replace(/\s+$/, '');
      if (k.trim() && seen.has(k)) { removed++; continue; }
      seen.add(k);
      out.push(l);
    }
    return result(out.join('\n'), removed, removed ? `removed ${plural(removed, 'duplicate line')}` : 'no duplicate lines');
  }

  /** Renumber ordered lists 1, 2, 3… (the first number of each list is kept; nested lists count on their own). */
  function renumberLists(text) {
    const lines = text.split('\n'), prot = protectedLines(lines);
    const stack = [];
    let changed = 0;
    lines.forEach((l, i) => {
      if (prot[i]) { stack.length = 0; return; }
      const m = /^(\s*)(\d+)([.)])(\s+)/.exec(l);
      const indent = /^\s*/.exec(l)[0].length;
      if (!l.trim()) return;
      if (!m) {
        if (/^\s*([-*+])\s/.test(l)) { while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop(); } else if (indent === 0) stack.length = 0;
        return;
      }
      while (stack.length && stack[stack.length - 1].indent > indent) stack.pop();
      let top = stack[stack.length - 1];
      if (!top || top.indent < indent || top.delim !== m[3]) { top = { indent, delim: m[3], next: Number(m[2]) }; stack.push(top); }
      const want = top.next++;
      if (String(want) !== m[2]) { lines[i] = `${m[1]}${want}${m[3]}${m[4]}${l.slice(m[0].length)}`; changed++; }
    });
    return result(lines.join('\n'), changed, changed ? `renumbered ${plural(changed, 'list item')}` : 'the numbering is already correct');
  }

  /** Use "-" for every bullet list marker (* and + become -). */
  function normalizeBullets(text, marker) {
    const mk = marker || '-';
    const lines = text.split('\n'), prot = protectedLines(lines);
    let changed = 0;
    lines.forEach((l, i) => {
      if (prot[i] || HR.test(l)) return;
      const m = /^(\s*)([-*+])(\s+)/.exec(l);
      if (m && m[2] !== mk) { lines[i] = `${m[1]}${mk}${m[3]}${l.slice(m[0].length)}`; changed++; }
    });
    return result(lines.join('\n'), changed, changed ? `changed ${plural(changed, 'bullet')} to "${mk}"` : `every bullet already uses "${mk}"`);
  }

  // ------------------------------------------------------------------ whitespace
  /** Remove trailing spaces and tabs. A deliberate line break (two or more spaces before a text line) is kept as exactly two spaces. */
  function stripTrailing(text) {
    const lines = text.split('\n'), prot = protectedLines(lines);
    let changed = 0;
    lines.forEach((l, i) => {
      const bare = l.replace(/[ \t]+$/, '');
      if (bare === l) return;
      let next = bare;
      const hard = !prot[i] && bare.trim() && / {2,}$/.test(l) && !/\t/.test(l.slice(bare.length)) && lines[i + 1] !== undefined && lines[i + 1].trim();
      if (hard) next = `${bare}  `;
      if (next !== l) { lines[i] = next; changed++; }
    });
    return result(lines.join('\n'), changed, changed ? `trimmed ${plural(changed, 'line')}` : 'no trailing whitespace');
  }

  /** Collapse runs of blank lines to one (outside fenced code) and end the text with a single newline if it had one. */
  function collapseBlank(text) {
    const lines = text.split('\n'), prot = protectedLines(lines);
    const out = [];
    let removed = 0;
    lines.forEach((l, i) => {
      if (!prot[i] && !l.trim() && out.length && !out[out.length - 1].trim() && !prot[i - 1] && i < lines.length - 1) { removed++; return; }
      out.push(l);
    });
    while (out.length > 2 && !out[out.length - 1].trim() && !out[out.length - 2].trim()) { out.pop(); removed++; }
    return result(out.join('\n'), removed, removed ? `removed ${plural(removed, 'blank line')}` : 'no extra blank lines');
  }

  // ------------------------------------------------------------------ paragraphs
  const NOT_PLAIN = /^\s{0,3}(#{1,6}(\s|$)|>|[-*+]\s|\d+[.)]\s|\||<|\[[^\]]+\]:\s|[-*_]{3,}\s*$|=+\s*$)|^( {4}|\t)/;
  /** Paragraph runs of plain text lines: [{from, to (exclusive)}], never fenced code, headings, lists, quotes, tables, HTML or setext headings. */
  function paragraphs(lines) {
    const prot = protectedLines(lines), out = [];
    let i = 0;
    while (i < lines.length) {
      const plain = (k) => k < lines.length && !prot[k] && lines[k].trim() && !NOT_PLAIN.test(lines[k]);
      if (!plain(i)) { i++; continue; }
      let j = i;
      while (plain(j)) j++;
      const nextSetext = j < lines.length && /^\s{0,3}(=+|-+)\s*$/.test(lines[j]);
      if (!nextSetext || j - i > 1) out.push({ from: i, to: nextSetext ? j - 1 : j }); // the last line of a run followed by === / --- is a heading
      i = j;
    }
    return out.filter((p) => p.to > p.from);
  }
  const breakMark = (l) => (/ {2,}$/.test(l) ? '  ' : /\\$/.test(l) ? '\\' : '');
  function groups(lines, p) {
    const gs = [];
    let cur = [];
    for (let k = p.from; k < p.to; k++) {
      cur.push(lines[k]);
      if (breakMark(lines[k])) { gs.push(cur); cur = []; }
    }
    if (cur.length) gs.push(cur);
    return gs;
  }
  const wordsOf = (s) => { const out = []; let cur = '', inCode = false; for (const ch of s) { if (ch === '`') inCode = !inCode; if (/\s/.test(ch) && !inCode) { if (cur) out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out; };
  function rebuild(text, make) {
    const lines = text.split('\n'), ps = paragraphs(lines);
    let changed = 0;
    for (const p of [...ps].reverse()) {
      const next = groups(lines, p).flatMap((g) => make(g));
      const before = lines.slice(p.from, p.to);
      if (next.length !== before.length || next.some((l, k) => l !== before[k])) { changed++; lines.splice(p.from, p.to - p.from, ...next); }
    }
    return { lines, changed };
  }
  /** Re-break paragraphs at `width` columns (default 80). Code spans stay in one piece, deliberate line breaks are kept. */
  function reflow(text, opts) {
    const width = Math.max(20, Math.floor((opts && opts.width) || 80));
    const { lines, changed } = rebuild(text, (g) => {
      const last = g[g.length - 1], mark = breakMark(last);
      const indent = /^\s*/.exec(g[0])[0];
      const words = g.flatMap((l) => wordsOf(l.replace(/ {2,}$|\\$/, '')));
      const out = [];
      let cur = indent;
      for (const w of words) {
        if (cur.trim() && cpLen(cur) + 1 + cpLen(w) > width) { out.push(cur); cur = indent + w; } else cur += (cur.trim() ? ' ' : '') + w;
      }
      if (cur.trim()) out.push(cur);
      if (out.length) out[out.length - 1] += mark;
      return out;
    });
    return result(lines.join('\n'), changed, changed ? `reflowed ${plural(changed, 'paragraph')} to ${width} columns` : `the paragraphs already fit ${width} columns`);
  }
  /** Join each paragraph into one long line (deliberate line breaks are kept). */
  function unwrap(text) {
    const { lines, changed } = rebuild(text, (g) => {
      const mark = breakMark(g[g.length - 1]);
      const indent = /^\s*/.exec(g[0])[0];
      return [indent + g.map((l) => l.trim().replace(/\\$/, '').trimEnd()).join(' ') + mark];
    });
    return result(lines.join('\n'), changed, changed ? `joined ${plural(changed, 'paragraph')} into single lines` : 'every paragraph is already one line');
  }

  // ------------------------------------------------------------------ headings and table of contents
  const slugify = (s) => s.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');
  /** Heading text as it renders: links, images, code marks and emphasis stripped. */
  function plainHeading(s) {
    return s.replace(/\s+#+\s*$/, '').replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '')
      .replace(/[`*_~]/g, '').trim();
  }
  function headingsOf(lines, prot) {
    const out = [];
    lines.forEach((l, i) => {
      if (prot[i]) return;
      const m = /^(#{1,6})\s+(.*?)\s*$/.exec(l);
      if (m) out.push({ line: i, level: m[1].length, text: plainHeading(m[2]) });
      else if (i > 0 && /^(=+|-+)\s*$/.test(l) && lines[i - 1].trim() && !prot[i - 1] && !NOT_PLAIN.test(lines[i - 1]) && !/^\s*$/.test(lines[i - 1])) {
        out.push({ line: i - 1, level: l[0] === '=' ? 1 : 2, text: plainHeading(lines[i - 1]), setext: true });
      }
    });
    return out;
  }
  /** Setext headings (Title / =====) become ATX (# Title). */
  function normalizeHeadings(text) {
    const lines = text.split('\n'), prot = protectedLines(lines);
    const hs = headingsOf(lines, prot).filter((h) => h.setext).reverse();
    for (const h of hs) lines.splice(h.line, 2, `${'#'.repeat(h.level)} ${lines[h.line].trim()}`);
    return result(lines.join('\n'), hs.length, hs.length ? `converted ${plural(hs.length, 'heading')} to # style` : 'no underlined headings found');
  }

  const TOC_START = '<!-- toc -->', TOC_END = '<!-- tocstop -->';
  /**
   * Build a table of contents from the headings. Between <!-- toc --> and <!-- tocstop --> it is replaced; without those markers
   * a new block is inserted below the first heading (or at the top). opts: {minLevel:1, maxLevel:3, bullet:'-'}
   */
  function toc(text, opts) {
    const o = Object.assign({ minLevel: 1, maxLevel: 3, bullet: '-' }, opts);
    const lines = text.split('\n'), prot = protectedLines(lines);
    const a = lines.findIndex((l, i) => !prot[i] && l.trim() === TOC_START);
    const b = a === -1 ? -1 : lines.findIndex((l, i) => i > a && !prot[i] && l.trim() === TOC_END);
    const hs = headingsOf(lines, prot).filter((h) => h.level >= o.minLevel && h.level <= o.maxLevel && !(a !== -1 && h.line > a && h.line < b));
    if (!hs.length) return result(text, 0, `no headings between levels ${o.minLevel} and ${o.maxLevel}`);
    const seen = new Map();
    const base = Math.min(...hs.map((h) => h.level));
    const items = hs.map((h) => {
      const slug = slugify(h.text);
      const n = seen.get(slug) || 0;
      seen.set(slug, n + 1);
      return `${'  '.repeat(h.level - base)}${o.bullet} [${h.text.replace(/([[\]])/g, '\\$1')}](#${n ? `${slug}-${n}` : slug})`;
    });
    const block = [TOC_START, '', ...items, '', TOC_END];
    let next;
    if (a !== -1 && b !== -1) next = [...lines.slice(0, a), ...block, ...lines.slice(b + 1)];
    else {
      const first = headingsOf(lines, prot)[0];
      const at = first ? first.line + (first.setext ? 2 : 1) : 0;
      next = [...lines.slice(0, at), ...(at > 0 && lines[at - 1].trim() ? [''] : []), ...block, ...(lines[at] !== undefined && lines[at].trim() ? [''] : []), ...lines.slice(at)];
    }
    const out = next.join('\n');
    return result(out, out === text ? 0 : 1, out === text ? 'the table of contents is already up to date' : `${a !== -1 ? 'updated' : 'inserted'} a table of contents with ${plural(items.length, 'entry')}`);
  }

  JSS.mdtransform = {
    applyRange, protectedLines, findTables, formatTables, sortTable, sortLines, dedupeLines, renumberLists, normalizeBullets,
    stripTrailing, collapseBlank, reflow, unwrap, normalizeHeadings, toc, slugify, plainHeading, headingsOf, splitRow,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = JSS;
})(typeof self !== 'undefined' ? self : globalThis);
