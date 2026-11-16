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

async function openEditor(src) {
  const editorUrl = chrome.runtime.getURL(EDITOR_PAGE);
  const existing = await chrome.tabs.query({ url: `${editorUrl}*` });

  if (existing.length > 0) {
    const tab = existing[0];
    log('info', 'focus-existing-editor', { tabId: tab.id, hasSrc: Boolean(src) });
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    if (src) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'md-studio:open-src', src });
      } catch (err) {
        log('error', 'send-open-src-failed', { tabId: tab.id, error: String(err) });
      }
    }
    return;
  }

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

// Navigating straight to a local Markdown file (typed URL, bookmark, link) opens it in the editor.
// Requires "Allow access to file URLs" for this extension; without it Chrome never fires this for file:// pages.
const FILE_SUFFIXES = ['.md', '.MD', '.markdown', '.mdown', '.mkd', '.mdx'];
const isBlankTab = (tab) => !tab?.url || tab.url === 'about:blank' || tab.url.startsWith('chrome://newtab');

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;
  log('info', 'file-navigation-detected', { tabId: details.tabId });
  try {
    const editorUrl = chrome.runtime.getURL(EDITOR_PAGE);
    const existing = await chrome.tabs.query({ url: `${editorUrl}*` });
    if (existing.length === 0) {
      // Reuse the navigating tab so no extra blank tab is left behind.
      await chrome.tabs.update(details.tabId, { url: `${editorUrl}?src=${encodeURIComponent(details.url)}` });
      return;
    }
    // One editor tab at a time: its session lives in that page's storage.
    await openEditor(details.url);
    const navTab = await chrome.tabs.get(details.tabId).catch(() => null);
    if (navTab && navTab.id !== existing[0].id && isBlankTab(navTab)) {
      log('info', 'closing-blank-navigation-tab', { tabId: details.tabId });
      await chrome.tabs.remove(details.tabId);
    }
  } catch (err) {
    log('error', 'file-navigation-redirect-failed', { tabId: details.tabId, error: String(err) });
  }
}, { url: FILE_SUFFIXES.map((pathSuffix) => ({ schemes: ['file'], pathSuffix })) });
