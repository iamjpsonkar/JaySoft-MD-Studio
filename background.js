'use strict';

const EDITOR_PAGE = 'editor.html';
const MD_PATH_RE = /\.(md|markdown|mdown|mkd|mdx)$/i;

function log(level, event, ctx = {}) {
  // URLs can carry tokens in the query string, so only origin/protocol are ever logged.
  console[level](`[md-studio:bg] ${event}`, ctx);
}

function isMarkdownUrl(raw) {
  try {
    const url = new URL(raw);
    if (!['file:', 'http:', 'https:'].includes(url.protocol)) return false;
    return MD_PATH_RE.test(decodeURIComponent(url.pathname));
  } catch (err) {
    log('warn', 'url-parse-failed', { error: String(err) });
    return false;
  }
}

/** Every call opens its own editor tab: tabs never share documents or sessions (each keeps its own in the tab's session storage). */
async function openEditor(src) {
  const editorUrl = chrome.runtime.getURL(EDITOR_PAGE);
  const target = src ? `${editorUrl}?src=${encodeURIComponent(src)}` : editorUrl;
  log('info', 'create-editor-tab', { hasSrc: Boolean(src) });
  await chrome.tabs.create({ url: target });
}

chrome.action.onClicked.addListener(async (tab) => {
  let src = null;
  try {
    if (tab?.url && isMarkdownUrl(tab.url)) {
      const url = new URL(tab.url);
      if (url.protocol === 'file:') {
        src = tab.url;
        log('info', 'markdown-tab-detected', { protocol: 'file:' });
      } else {
        // Must be requested straight from the click so the user gesture is still valid.
        // Resolves true without a prompt when the origin was already granted.
        const granted = await chrome.permissions.request({ origins: [`${url.origin}/*`] });
        log('info', 'origin-permission-result', { origin: url.origin, granted });
        if (granted) src = tab.url;
      }
    } else {
      log('debug', 'active-tab-not-markdown', {});
    }
  } catch (err) {
    log('error', 'action-click-failed', { error: String(err) });
  }

  try {
    await openEditor(src);
  } catch (err) {
    log('error', 'open-editor-failed', { error: String(err) });
  }
});

// Navigating straight to a local Markdown file (typed URL, bookmark, link) opens it in the editor: the tab you navigate in becomes its
// own editor tab, so the raw file is never shown as plain text and nothing is shared with other editor tabs.
// Requires "Allow access to file URLs" for this extension; without it Chrome never fires this for file:// pages.
const FILE_SUFFIXES = ['.md', '.MD', '.markdown', '.mdown', '.mkd', '.mdx'];
const FILE_FILTER = { url: FILE_SUFFIXES.map((pathSuffix) => ({ schemes: ['file'], pathSuffix })) };

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;
  log('info', 'file-navigation-detected', { tabId: details.tabId });
  try {
    const editorUrl = chrome.runtime.getURL(EDITOR_PAGE);
    await chrome.tabs.update(details.tabId, { url: `${editorUrl}?src=${encodeURIComponent(details.url)}` });
  } catch (err) {
    log('error', 'file-navigation-redirect-failed', { tabId: details.tabId, error: String(err) });
  }
}, FILE_FILTER);
