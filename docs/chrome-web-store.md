# Chrome Web Store submission kit

Copy-paste material for the Developer Dashboard. Listing text, screenshots and permission
justifications are entered in the dashboard by hand. See "Publishing steps" below.

## Listing

**Name:** MD Studio

**Summary (short description):**
Read and edit any Markdown file with a live preview, tabs, outline and dark mode.

**Category:** Developer Tools (or Productivity)

**Detailed description:**

MD Studio is a fast, private Markdown reader and editor that runs entirely in your browser.

- Open local .md files from disk, by drag and drop, or just navigate to file:///path/to/notes.md
- Preview, Edit or Split view with synced scrolling
- Save straight back to the original file (File System Access API), with a warning if the file changed on disk
- Tabs, document outline, full-width reading, light/dark/auto themes
- GitHub-style rendering: tables, task lists, syntax-highlighted code blocks
- Formatting toolbar and shortcuts, list auto-continue, unsaved work restored on reopen
- Safe preview: content is sanitized, nothing is executed

Your files never leave your computer. No accounts, no analytics, no tracking.

To open local files by URL, enable "Allow access to file URLs" for MD Studio on chrome://extensions.

**Single purpose:** View and edit Markdown files.

## Permission justifications

| Permission | Justification |
| --- | --- |
| `activeTab` | When the user clicks the toolbar icon, read the active tab's URL to detect whether it is a Markdown file and open it in the editor. |
| `webNavigation` | Detect when the user navigates to a local `file://` URL ending in `.md`/`.markdown`/`.mdx` and open it in the editor instead of showing raw text. Only top-level `file:` navigations with those suffixes are handled. |
| Host `file:///*` | Read the local Markdown file the user opened so it can be rendered and edited. Nothing is read until the user opens or navigates to a file. |
| Optional hosts `http://*/*`, `https://*/*` | Not granted at install. Requested for a single origin only when the user clicks the icon on a `.md` URL there, to fetch that file for display. |

**Remote code:** none. All scripts (including marked, DOMPurify, highlight.js) are packaged in the extension.

**Data usage disclosure (suggested answers):** collects no user data; does not sell or transfer data; no data used for unrelated purposes.

## Privacy policy (host this at a public URL, for example GitHub Pages or the repo's rendered file)

**MD Studio privacy policy**

MD Studio does not collect, transmit, sell or share personal data. It has no servers, accounts, analytics or advertising.

What is stored, on your device only:
- Open documents and unsaved text, in the extension page's local storage, so your session can be restored.
- Handles to files you opened or saved, and a short recent-files list, in the extension's IndexedDB.
- Interface preferences (theme, full-width, outline).

Network access: the extension only requests a Markdown URL when you open it from that URL, and only from the origin you approved. It makes no other network requests.

You can remove all stored data by removing the extension or clearing its site data.

Contact: jsonkar@gofynd.com
(Replace with the contact you want to publish.)

## Publishing steps

1. Register at the Chrome Web Store Developer Dashboard. Per the official docs a one-time registration fee ($5 at time of writing) is required, and you must accept the developer terms. Verify the current fee on the registration page.
2. Create a new item and upload `md-studio-vX.Y.Z.zip` from the GitHub release (the zip, not the crx).
3. Fill in the listing from this file. You need a 128x128 icon (`icons/icon128.png`), at least one screenshot (1280x800 or 640x400 are the commonly used sizes, check the official image requirements), and optionally a 440x280 promo tile.
4. Paste the permission justifications, privacy-practices answers and privacy policy URL.
5. Submit for review. Review time varies, and I found no authoritative figure.

Review risk (my assessment, not a documented rule): `file:///*` plus `webNavigation` is a broad-looking combination, so expect scrutiny. The justifications above are written to address that.

## Automating later uploads (optional)

After the first manual upload, updates can be uploaded and published through the Chrome Web Store API using OAuth credentials (client ID, client secret, refresh token) or a service account, stored as GitHub secrets. Sources disagree on whether the API can create a brand-new item, so plan on creating the first version by hand. Not wired into `release.yml` yet.
