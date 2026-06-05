// Counts a website once when you arrive on it, not for every page/route within it.
//
// Strategy: remember the current host for each tab. A visit is recorded only when
// a tab's host CHANGES to a new site. Navigating within the same domain (route
// changes, clicking internal links) keeps the host the same, so it isn't counted.
// Leaving the site and coming back — or opening it in a fresh tab — counts again.
//
// Each visit is stored as { host, ts } in chrome.storage.local under "visits".
// Per-tab host state lives in chrome.storage.session so it survives the service
// worker being suspended, and clears when the browser closes.

const STORAGE_KEY = "visits";
const TAB_KEY = "tabHosts";

function getHost(url) {
  try {
    const u = new URL(url);
    // Only track normal web pages, skip chrome://, about:, file://, extension pages, etc.
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function recordVisit(host) {
  const { [STORAGE_KEY]: visits = [] } = await chrome.storage.local.get(STORAGE_KEY);
  visits.push({ host, ts: Date.now() });
  await chrome.storage.local.set({ [STORAGE_KEY]: visits });
}

chrome.webNavigation.onCommitted.addListener(async (details) => {
  // frameId 0 = the main frame (the actual page), ignore iframes.
  if (details.frameId !== 0) return;

  const host = getHost(details.url); // may be null for non-web pages
  const { [TAB_KEY]: tabHosts = {} } = await chrome.storage.session.get(TAB_KEY);
  const prev = tabHosts[details.tabId] ?? null;

  // Same site as before in this tab → it's an internal route change, don't count.
  if (host === prev) return;

  tabHosts[details.tabId] = host;
  await chrome.storage.session.set({ [TAB_KEY]: tabHosts });

  if (host) recordVisit(host);
});

// Forget a tab's host when it closes, so reopening the same site counts again.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { [TAB_KEY]: tabHosts = {} } = await chrome.storage.session.get(TAB_KEY);
  if (tabId in tabHosts) {
    delete tabHosts[tabId];
    await chrome.storage.session.set({ [TAB_KEY]: tabHosts });
  }
});
