import { baseNameFromUrl, now, parseMimeKind, stableId } from './util.js';

const MAX_PER_TAB = 80;

function key(tabId) { return `candidates:${tabId}`; }

export function candidateFrom(url, tabId, meta = {}) {
  const kind = meta.kind || parseMimeKind(url, meta.contentType || '');
  if (!kind) return null;
  return {
    id: stableId(`${tabId}|${kind}|${url}`),
    url,
    kind,
    contentType: meta.contentType || '',
    source: meta.source || 'network',
    title: meta.title || '',
    label: meta.label || baseNameFromUrl(url, kind.toUpperCase()),
    createdAt: now(),
  };
}

export async function addCandidate(tabId, candidate) {
  if (tabId < 0 || !candidate?.url || candidate.url.startsWith('blob:')) return;
  const k = key(tabId);
  const obj = await chrome.storage.session.get(k);
  const list = obj[k] || [];
  const next = [candidate, ...list.filter(x => x.id !== candidate.id)].slice(0, MAX_PER_TAB);
  await chrome.storage.session.set({ [k]: next });
}

export async function listCandidates(tabId) {
  const k = key(tabId);
  return (await chrome.storage.session.get(k))[k] || [];
}

export async function clearCandidates(tabId) {
  await chrome.storage.session.remove(key(tabId));
}
