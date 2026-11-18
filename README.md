# MD Studio

A Chrome extension to read and edit any Markdown file, with a live preview you can edit in place, tabs, outline, find and replace, transforms, export, a diff view and light/dark themes.

## Use it in the browser

The same editor runs as a web app: **https://iamjpsonkar.github.io/JaySoft-MD-Studio/**. It is the extension's own code (the root `index.html`, generated from `editor.html` by `npm run build:pages`), runs entirely in your browser tab and makes no network requests. Chromium browsers open and save files in place; Firefox and Safari open files through a file picker and **Save downloads a copy**. On `github.io` every project shares one browser storage area, so the web version keeps your open documents in session storage (this tab only) rather than local storage. The extension adds opening the `.md` pages you are browsing and `file://` URLs.

## Install (unpacked)

1. Clone or download this repository.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the repository folder (the one containing `manifest.json`).
4. Click the MD Studio toolbar icon to open the editor.

After pulling updates, click the **reload** icon on the extension's card.

### Open local `file://` Markdown files directly

1. On `chrome://extensions`, open MD Studio's **Details**.
2. Turn on **Allow access to file URLs**.

After that, navigating to a local `.md` file (for example `file:///Users/you/notes/README.md`) opens it in the editor automatically.
Without this setting, use the **Open** button or drag and drop instead.

## Usage

- **Open:** the Open button (multi-select), drag and drop onto the page, the toolbar icon while viewing a `.md` URL, or navigating to a local `.md` file.
- **Views:** Edit, Split, Preview or Diff, remembered per tab (a new tab starts in the view you were in). `Ctrl/Cmd+E` cycles them.
- **Save:** `Ctrl/Cmd+S` saves, `Shift+Ctrl/Cmd+S` saves as. Files opened with Open or drag and drop are written back to the same file. Documents loaded from a URL have no file handle, so Save as asks where to write.
- **Editing:** formatting toolbar, `Ctrl/Cmd+B`, `I`, `K`, Tab to indent, list auto-continue. The editor has line numbers (kept level with wrapped lines), Markdown colours, **find and replace** (`Ctrl/Cmd+F`; regex, match case, highlighting) and bracket-pair highlighting. **View ▾** switches line numbers, word wrap and synced scrolling; the divider between editor and preview can be dragged (double-click resets it).
- **Edit in the preview:** double-click any block (paragraph, heading, list, table, code block, quote) to edit its Markdown right there: `Ctrl/Cmd+Enter` or clicking outside applies it, `Esc` cancels, an empty box deletes the block. Click a task-list checkbox to tick it. Only that part of the file changes, `Ctrl/Cmd+Z` / `Ctrl/Cmd+Y` step through preview edits, and it works in Preview and Split. Raw HTML blocks are shown as they are (not editable), and very large documents (over about 400 KB) are drawn without it. Turn it off in **View ▾**.
- **Copy a block:** hover any block in the preview for a small toolbar with **Copy** and **Edit**. Copy on a code block copies just the code (no fences); on anything else it copies that block's Markdown. Code blocks keep their Copy button even where click-to-edit is off or unavailable. From the keyboard, the palette command **Copy the block at the caret** does the same for the block the editor caret is in.
- **Rename and several documents:** double-click a tab to rename it (renaming a tab linked to a file detaches it after a confirmation, so Save will ask where to write).
- **Status bar:** line, column and selection size, word count, save state, and the line ending: click `LF` / `CRLF` to switch (it counts as an unsaved change and is applied when saving).
- **Command palette:** `Ctrl/Cmd+Shift+P` or `F1` lists every action (views, transforms, export, formatting, tabs, settings).
- **Every tab is its own workspace.** Each MD Studio tab keeps its own documents, views and unsaved text (in that tab's session storage, so a reload of the tab brings them back); nothing is shared with, or synced to, another MD Studio tab. Clicking the toolbar icon always opens a new tab, and navigating to a local `.md` file (with *Allow access to file URLs* on) turns the tab you navigate in into its own editor for that file, so the raw text is never shown in the browser. A new tab starts empty; if an earlier tab had documents, its welcome screen offers **Restore your last session** (an explicit choice, with a **Dismiss** button), which brings the documents back as copies, unsaved text included.
- **Other:** outline panel, full-width toggle, light/dark/auto theme, tabs, and unsaved text kept for the life of the tab (see above).

### Transform ▾

Runs on the selected lines, or on the whole document when nothing is selected, and through the browser's edit stack so `Ctrl/Cmd+Z` undoes it. Fenced code and front matter are never touched, and a step that would change nothing says so.

- **Format tables** (align the columns, keep `:--:` alignment) and **Sort table by column…** (numbers numerically, text in natural order).
- **Sort lines / list items** A→Z or Z→A (nested items travel with their parent; numbered lists stay 1, 2, 3) and **Remove duplicate lines** (select the lines first).
- **Renumber ordered lists**, **Use "-" for bullet lists**, **Reflow paragraphs…** to a width and **Unwrap paragraphs**, **Convert underlined headings to #**.
- **Trim trailing spaces** (a deliberate two-space line break is kept) and **Collapse extra blank lines**.
- **Insert / update table of contents…**: between `<!-- toc -->` and `<!-- tocstop -->`, or below the first heading; links use the same anchors as the preview.

### Export ▾

Copy as formatted text (paste into Docs or an email), as HTML or as plain text; save as a self-contained HTML page or a text file; **Print / Save as PDF** prints only the rendered document.

### Problems

The **Problems** button checks the Markdown as you type (heading level jumps, a second H1, `#Heading` without a space, an unclosed code fence, empty links, anchors that match no heading, undefined reference links, table rows with the wrong number of cells, missing image alt text, extra blank lines, trailing spaces) and lists them; click one to jump to it. The badge counts errors and warnings. Documents over 600 KB are not checked.

### Diff

**Diff** compares the current tab with its saved version (as opened or last saved) or with any other open tab, line by line, with added / removed / changed counts, a "hide unchanged" switch and next / previous change. Click a line to go to it in the editor.

## Releases

Pushing a tag that matches the manifest version runs the tests and then builds and publishes a GitHub release (`.github/workflows/release.yml`). The web app is not part of the release: GitHub Pages publishes the `main` branch (folder `/ (root)`), so the app is `index.html` at the root and the landing and privacy pages are under `/docs/`; after changing `editor.html` run `npm run build:pages` and commit `index.html` (a test fails if it is stale). Run the tests with `npm ci && npm test`. The files `core/find.js`, `core/editing.js` and `core/textdiff.js` are copies of JSON Studio's: `node scripts/sync-from-json-studio.js` re-copies them and a test checks they match when the sibling checkout is present.

```sh
# 1. bump "version" in manifest.json and commit it
# 2. tag and push
git tag v1.2.0
git push origin v1.2.0
```

The workflow fails if the tag and `manifest.json` version differ. The release contains:

- `md-studio-vX.Y.Z.zip`: the packed extension. Unzip it and use **Load unpacked**, or upload it to the Chrome Web Store.
- `md-studio-vX.Y.Z.crx`: a signed CRX, only if the `CRX_PRIVATE_KEY` repository secret is set.
- `SHA256SUMS.txt`: checksums for the files above.

Chrome on Windows and macOS generally refuses to install a `.crx` from outside the Web Store unless enterprise policy allows it, so the zip is the practical option for most people.

### Optional: signed CRX

```sh
openssl genrsa -out key.pem 2048
```

Add the contents of `key.pem` as a repository secret named `CRX_PRIVATE_KEY` (Settings, Secrets and variables, Actions), then store the file somewhere safe and never commit it. The extension ID is derived from this key, so losing it or switching keys changes the ID.

## Notes

- Saving checks whether the file changed on disk after you opened it and asks before overwriting. CRLF line endings are preserved. A leading BOM is dropped on save.
- Files over 10 MB, and binary files, are rejected.
- The preview is sanitized with DOMPurify. Access to http(s) sites is requested only when you click the icon on a `.md` URL there.
- Debug logging: in the editor tab's console run `localStorage['mdstudio.logLevel']='debug'`. Logs contain file names and sizes, never document content.

## Third-party libraries

Bundled in `lib/` (Manifest V3 forbids remote scripts): [marked](https://github.com/markedjs/marked), [DOMPurify](https://github.com/cure53/DOMPurify) and [highlight.js](https://highlightjs.org/). Their licenses are in `lib/`.
