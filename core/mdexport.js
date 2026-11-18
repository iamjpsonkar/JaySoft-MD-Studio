/* MD Studio core: export helpers. standaloneHtml wraps already sanitised preview HTML in a self-contained page;
 * toPlainText strips Markdown syntax; exportName builds a file name. */
(function (root) {
  'use strict';
  const JSS = root.JSS;

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const CSS = `:root{color-scheme:light dark;--bg:#fff;--fg:#1f2328;--muted:#6b7280;--border:#e2e5ea;--code:#f3f4f7;--accent:#5b5bd6}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--fg:#e6e8ec;--muted:#8b93a1;--border:#272c36;--code:#1a1e27;--accent:#8b8bf5}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Arial,sans-serif}
main{max-width:820px;margin:0 auto;padding:32px 24px 80px}
h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.6em 0 .6em}h1,h2{padding-bottom:.3em;border-bottom:1px solid var(--border)}
a{color:var(--accent)}code{font:.88em ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--code);padding:.15em .4em;border-radius:6px}
pre{background:var(--code);border:1px solid var(--border);border-radius:10px;padding:14px 16px;overflow:auto}pre code{background:none;padding:0}
blockquote{margin:0 0 1em;padding:.2em 1em;color:var(--muted);border-left:4px solid var(--border)}img{max-width:100%}hr{border:0;border-top:1px solid var(--border)}
table{border-collapse:collapse;display:block;overflow:auto}th,td{padding:7px 13px;border:1px solid var(--border)}th{text-align:left}
@media print{body{background:#fff;color:#000}main{max-width:none;padding:0}a{color:inherit}pre{white-space:pre-wrap}}`;

  /** A complete HTML document. `bodyHtml` must already be sanitised (it comes from DOMPurify in the editor). */
  function standaloneHtml(title, bodyHtml) {
    return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(title)}</title>\n<style>${CSS}</style>\n</head>\n<body>\n<main>\n${bodyHtml}\n</main>\n</body>\n</html>\n`;
  }

  /** Markdown source -> readable plain text (links keep their address in brackets, code keeps its text, tables stay as written). */
  function toPlainText(md) {
    const lines = md.split('\n'), out = [];
    let fence = null;
    for (const raw of lines) {
      const f = /^\s{0,3}(`{3,}|~{3,})/.exec(raw);
      if (fence) { if (f && f[1][0] === fence.ch && f[1].length >= fence.len) fence = null; else out.push(raw); continue; }
      if (f) { fence = { ch: f[1][0], len: f[1].length }; continue; }
      let l = raw.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/\s+#+\s*$/, '').replace(/^(\s*)>\s?/, '$1');
      l = l.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (m0, t, u) => (t === u ? t : `${t} (${u})`));
      l = l.replace(/<[^>]+>/g, '').replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g, '$1').replace(/(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)/g, '$1').replace(/~~(.+?)~~/g, '$1').replace(/`([^`]+)`/g, '$1');
      if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(l) || /^\s*(=+)\s*$/.test(l)) continue;
      out.push(l);
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n');
  }

  /** "notes.md" + "html" -> "notes.html"; names without an extension just get it. */
  function exportName(name, ext) {
    const base = String(name || 'document').replace(/\.(md|markdown|mdown|mkd|mdx|txt)$/i, '') || 'document';
    return `${base}.${ext}`;
  }

  JSS.mdexport = { standaloneHtml, toPlainText, exportName, esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = JSS;
})(typeof self !== 'undefined' ? self : globalThis);
