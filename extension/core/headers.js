import { escapeRegex, now } from './util.js';

const SAFE_HEADERS = new Set(['cookie', 'origin', 'referer']);

function contextKey(tabId, url) {
  try { return `hdr:${tabId}:${new URL(url).origin}`; } catch { return null; }
}

export async function rememberRequestHeaders(details) {
  if (details.tabId < 0 || !details.requestHeaders) return;
  const key = contextKey(details.tabId, details.url);
  if (!key) return;
  const headers = {};
  for (const h of details.requestHeaders) {
    const name = h.name.toLowerCase();
    if (SAFE_HEADERS.has(name) && typeof h.value === 'string') headers[name] = h.value;
  }
  if (!Object.keys(headers).length) return;
  await chrome.storage.session.set({ [key]: { headers, url: details.url, ts: now() } });
}

export async function prepareHeaderRule(tabId, url) {
  const key = contextKey(tabId, url);
  if (!key) return null;
  const obj = await chrome.storage.session.get(key);
  const ctx = obj[key];
  if (!ctx || now() - ctx.ts > 30 * 60_000) return null;
  const requestHeaders = Object.entries(ctx.headers).map(([header, value]) => ({ header, operation: 'set', value }));
  if (!requestHeaders.length) return null;

  if (url.length > 1600) return null;
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  const used = new Set(rules.map(r => r.id));
  let id = 12000;
  while (used.has(id) && id <= 29000) id++;
  if (id > 29000) throw new Error('No free temporary DNR rule ids');
  const regexFilter = `^${escapeRegex(url)}$`;
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [id],
    addRules: [{
      id,
      priority: 100,
      action: { type: 'modifyHeaders', requestHeaders },
      condition: { regexFilter, resourceTypes: ['xmlhttprequest'] },
    }],
  });
  return id;
}

export async function releaseHeaderRule(ruleId) {
  if (!ruleId) return;
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
}

export async function cleanupHeaderRules() {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  const ids = rules.filter(r => r.id >= 12000 && r.id <= 29000).map(r => r.id);
  if (ids.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids });
}
