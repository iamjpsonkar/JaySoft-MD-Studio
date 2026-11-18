/* JSON Studio core: line diff (Myers O(ND)) aligned into side-by-side rows. */
(function (root) {
  'use strict';
  const JSS = root.JSS;

  function backtrack(trace, a, b, dEnd, off) {
    let x = a.length, y = b.length;
    const ops = [];
    for (let d = dEnd; d >= 0; d--) {
      const v = trace[d];
      const k = x - y;
      const prevK = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? k + 1 : k - 1;
      const prevX = v[off + prevK];
      const prevY = prevX - prevK;
      while (x > prevX && y > prevY) { ops.push(['eq', x - 1, y - 1]); x--; y--; }
      if (d > 0) ops.push(x === prevX ? ['add', -1, prevY] : ['del', prevX, -1]);
      x = prevX; y = prevY;
    }
    return ops.reverse();
  }

  /** Returns ops [['eq'|'del'|'add', aIndex, bIndex]] or null when more than maxD edits are needed. */
  function myers(a, b, maxD) {
    const n = a.length, m = b.length;
    if (n === 0) return b.map((_, j) => ['add', -1, j]);
    if (m === 0) return a.map((_, i) => ['del', i, -1]);
    const max = Math.min(n + m, maxD);
    const off = max + 1;
    let V = new Int32Array(2 * max + 3);
    const trace = [];
    for (let d = 0; d <= max; d++) {
      trace.push(V.slice());
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && V[off + k - 1] < V[off + k + 1]) ? V[off + k + 1] : V[off + k - 1] + 1;
        let y = x - k;
        while (x < n && y < m && a[x] === b[y]) { x++; y++; }
        V[off + k] = x;
        if (x >= n && y >= m) return backtrack(trace, a, b, d, off);
      }
    }
    return null;
  }

  /**
   * diffLines(aText, bText, {maxD}) -> {rows, stats, truncated}
   * rows: {kind:'eq'|'change'|'del'|'add', a:{n,text}|null, b:{n,text}|null}  (n is the 1-based line number)
   */
  function diffLines(aText, bText, opts) {
    const maxD = (opts && opts.maxD) || 3000;
    const A = aText.split('\n'), B = bText.split('\n');
    let pre = 0;
    while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
    let suf = 0;
    while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
    const midA = A.slice(pre, A.length - suf), midB = B.slice(pre, B.length - suf);

    let ops = myers(midA, midB, maxD);
    let truncated = false;
    if (!ops) { // too different: show the block as replaced
      truncated = true;
      ops = midA.map((_, i) => ['del', i, -1]).concat(midB.map((_, j) => ['add', -1, j]));
    }

    const rows = [];
    const L = (arr, i, base) => ({ n: base + i + 1, text: arr[i] });
    for (let i = 0; i < pre; i++) rows.push({ kind: 'eq', a: L(A, i, 0), b: L(B, i, 0) });
    let dels = [], adds = [];
    const flush = () => {
      const n = Math.max(dels.length, adds.length);
      for (let k = 0; k < n; k++) {
        const da = dels[k], ab = adds[k]; // indexes: 0 is valid, so compare with undefined
        rows.push({
          kind: da !== undefined && ab !== undefined ? 'change' : da !== undefined ? 'del' : 'add',
          a: da !== undefined ? L(midA, da, pre) : null, b: ab !== undefined ? L(midB, ab, pre) : null,
        });
      }
      dels = []; adds = [];
    };
    for (const [kind, i, j] of ops) {
      if (kind === 'eq') { flush(); rows.push({ kind: 'eq', a: L(midA, i, pre), b: L(midB, j, pre) }); }
      else if (kind === 'del') dels.push(i);
      else adds.push(j);
    }
    flush();
    for (let i = 0; i < suf; i++) {
      rows.push({ kind: 'eq', a: L(A, A.length - suf + i, 0), b: L(B, B.length - suf + i, 0) });
    }
    const stats = { added: 0, removed: 0, changed: 0 };
    rows.forEach((r) => { if (r.kind === 'add') stats.added++; else if (r.kind === 'del') stats.removed++; else if (r.kind === 'change') stats.changed++; });
    return { rows, stats, truncated };
  }

  JSS.textdiff = { diffLines, myers };
  if (typeof module !== 'undefined' && module.exports) module.exports = JSS;
})(typeof self !== 'undefined' ? self : globalThis);
