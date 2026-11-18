/* JSON Studio core: small text-editing helpers for the Raw / Preview editors (pure functions over strings). */
(function (root) {
  'use strict';
  const JSS = root.JSS;
  const INDENT = '  ';
  const OPEN = '{[(', CLOSE = '}])';

  /**
   * Enter key: keep the current line's indentation, add one level after an opener, and when the caret sits
   * between a bracket pair put the closer on its own line. Returns {text, caret} for the whole new value.
   */
  function enter(text, start, end) {
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const indent = /^[ \t]*/.exec(text.slice(lineStart, start))[0];
    const prev = text[start - 1], next = text[end];
    const opens = prev && OPEN.includes(prev);
    const between = opens && next && CLOSE[OPEN.indexOf(prev)] === next;
    const head = text.slice(0, start);
    if (between) {
      const ins = `\n${indent}${INDENT}\n${indent}`;
      return { text: head + ins + text.slice(end), caret: start + 1 + indent.length + INDENT.length };
    }
    const ins = `\n${indent}${opens ? INDENT : ''}`;
    return { text: head + ins + text.slice(end), caret: start + ins.length };
  }

  /** Tab / Shift+Tab. With a multi-line selection indents/outdents every line; otherwise inserts/removes one level. */
  function tab(text, start, end, shift) {
    const multi = text.slice(start, end).includes('\n');
    if (!shift && !multi) return { text: text.slice(0, start) + INDENT + text.slice(end), start: start + INDENT.length, end: start + INDENT.length };
    const from = text.lastIndexOf('\n', start - 1) + 1;
    const lines = text.slice(from, end).split('\n');
    let firstDelta = 0, total = 0;
    const out = lines.map((ln, i) => {
      let next = ln, d;
      if (shift) { const m = /^( {1,2}|\t)/.exec(ln); next = m ? ln.slice(m[0].length) : ln; d = next.length - ln.length; } else { next = INDENT + ln; d = INDENT.length; }
      if (i === 0) firstDelta = d;
      total += d;
      return next;
    });
    return { text: text.slice(0, from) + out.join('\n') + text.slice(end), start: Math.max(from, start + firstDelta), end: end + total };
  }

  const STRING_RE = /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g;
  /**
   * Index of the bracket matching the one at `pos`, or -1. Brackets inside "..." / '...' strings are skipped unless
   * opts.strings === false (prose, where an apostrophe is not a quote).
   */
  function matchBracket(text, pos, opts) {
    const ch = text[pos];
    let dir, open, close;
    if (OPEN.includes(ch)) { dir = 1; open = ch; close = CLOSE[OPEN.indexOf(ch)]; }
    else if (CLOSE.includes(ch)) { dir = -1; close = ch; open = OPEN[CLOSE.indexOf(ch)]; }
    else return -1;
    const strings = [];
    let m;
    STRING_RE.lastIndex = 0;
    if (!opts || opts.strings !== false) while ((m = STRING_RE.exec(text))) strings.push([m.index, m.index + m[0].length]);
    const inString = (i) => { let lo = 0, hi = strings.length - 1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (i < strings[mid][0]) hi = mid - 1; else if (i >= strings[mid][1]) lo = mid + 1; else return true; } return false; };
    if (inString(pos)) return -1;
    let depth = 0;
    for (let i = pos; i >= 0 && i < text.length; i += dir) {
      if (inString(i)) continue;
      const c = text[i];
      if (c === open) depth += dir === 1 ? 1 : -1;
      else if (c === close) depth += dir === 1 ? -1 : 1;
      if (depth === 0) return i;
    }
    return -1;
  }

  /** The bracket pair to highlight for a caret position: checks the char before the caret, then the one after. */
  function bracketPair(text, caret, opts) {
    for (const p of [caret - 1, caret]) {
      if (p < 0 || p >= text.length) continue;
      const q = matchBracket(text, p, opts);
      if (q !== -1) return [Math.min(p, q), Math.max(p, q)];
    }
    return null;
  }

  /**
   * Visual rows each logical line takes when soft-wrapped at `cols` columns in a monospace font
   * (a hard break at the column, tabs advance to the next tab stop). Returns an array, one entry per line.
   */
  function displayWidth(line, tabSize) {
    const ts = tabSize || 2;
    if (line.indexOf('\t') === -1) return line.length;
    let w = 0;
    for (let j = 0; j < line.length; j++) w += line[j] === '\t' ? ts - (w % ts) : 1;
    return w;
  }
  function wrapRows(text, cols, tabSize) {
    const lines = text.split('\n');
    const rows = new Array(lines.length);
    for (let i = 0; i < lines.length; i++) {
      const w = displayWidth(lines[i], tabSize);
      rows[i] = cols < 1 || w === 0 ? 1 : Math.max(1, Math.ceil(w / cols));
    }
    return rows;
  }

  JSS.editing = { enter, tab, matchBracket, bracketPair, wrapRows, displayWidth };
  if (typeof module !== 'undefined' && module.exports) module.exports = JSS;
})(typeof self !== 'undefined' ? self : globalThis);
