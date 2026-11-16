# MD Studio

A Chrome extension to read and edit any Markdown file, with a live preview, tabs, outline and light/dark themes.

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
- **Views:** Preview (default on every launch), Edit, or Split. `Ctrl/Cmd+E` cycles them.
- **Save:** `Ctrl/Cmd+S` saves, `Shift+Ctrl/Cmd+S` saves as. Files opened with Open or drag and drop are written back to the same file. Documents loaded from a URL have no file handle, so Save as asks where to write.
- **Editing:** formatting toolbar, `Ctrl/Cmd+B`, `I`, `K`, Tab to indent, list auto-continue.
- **Other:** outline panel, full-width toggle, light/dark/auto theme, tabs, and unsaved text restored when you reopen the editor.

## Notes

- Saving checks whether the file changed on disk after you opened it and asks before overwriting. CRLF line endings are preserved. A leading BOM is dropped on save.
- Files over 10 MB, and binary files, are rejected.
- The preview is sanitized with DOMPurify. Access to http(s) sites is requested only when you click the icon on a `.md` URL there.
- Debug logging: in the editor tab's console run `localStorage['mdstudio.logLevel']='debug'`. Logs contain file names and sizes, never document content.

## Third-party libraries

Bundled in `lib/` (Manifest V3 forbids remote scripts): [marked](https://github.com/markedjs/marked), [DOMPurify](https://github.com/cure53/DOMPurify) and [highlight.js](https://highlightjs.org/). Their licenses are in `lib/`.
