import { addCandidate, candidateFrom, clearCandidates, listCandidates } from './core/media.js';
import { cleanupHeaderRules, prepareHeaderRule, releaseHeaderRule, rememberRequestHeaders } from './core/headers.js';
import { createJob, getJob, listJobs, recoverJobs, updateJob } from './core/jobs.js';

async function ensureOffscreen() {
  const url = chrome.runtime.getURL('offscreen/factory.html');
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
    if (contexts.length) return;
  }
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen/factory.html',
      reasons: ['WORKERS', 'BLOBS'],
      justification: 'Long-running media downloads and exporting OPFS files to browser downloads.',
    });
  } catch (error) {
    if (!String(error).includes('Only a single offscreen')) throw error;
  }
}

function contentTypeFromHeaders(headers = []) {
  return headers.find(h => h.name?.toLowerCase() === 'content-type')?.value || '';
}

chrome.runtime.onInstalled.addListener(() => {
  cleanupHeaderRules().catch(console.warn);
  recoverJobs().catch(console.warn);
});

chrome.runtime.onStartup.addListener(() => {
  cleanupHeaderRules().catch(console.warn);
  recoverJobs().catch(console.warn);
});

chrome.tabs.onRemoved.addListener(tabId => clearCandidates(tabId).catch(() => {}));

chrome.webRequest.onSendHeaders.addListener(
  details => { rememberRequestHeaders(details).catch(() => {}); },
  { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other'] },
  ['requestHeaders', 'extraHeaders'],
);

chrome.webRequest.onHeadersReceived.addListener(
  details => {
    if (details.tabId < 0) return;
    const contentType = contentTypeFromHeaders(details.responseHeaders);
    const candidate = candidateFrom(details.url, details.tabId, { contentType, source: 'network' });
    if (candidate) addCandidate(details.tabId, candidate).catch(() => {});
  },
  { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other'] },
  ['responseHeaders', 'extraHeaders'],
);

chrome.webRequest.onBeforeRequest.addListener(
  details => {
    if (details.tabId < 0) return;
    const candidate = candidateFrom(details.url, details.tabId, { source: 'request-url' });
    if (candidate?.kind === 'hls' || candidate?.kind === 'dash') addCandidate(details.tabId, candidate).catch(() => {});
  },
  { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other'] },
);

async function getExportEntries() {
  const all = await chrome.storage.session.get(null);
  return Object.entries(all)
    .filter(([k]) => k.startsWith('export:'))
    .map(([k, v]) => ({ key: k, ...v }));
}

chrome.downloads.onChanged.addListener(async delta => {
  if (!delta.state) return;
  const key = `export:${delta.id}`;
  const obj = await chrome.storage.session.get(key);
  const meta = obj[key];
  if (!meta) return;
  await chrome.storage.session.remove(key);
  chrome.runtime.sendMessage({ type: 'offscreen:revoke', jobId: meta.jobId, url: meta.url }).catch(() => {});

  const remaining = (await getExportEntries()).some(x => x.jobId === meta.jobId);
  if (delta.state.current === 'interrupted') {
    await updateJob(meta.jobId, { state: 'FAILED_FINAL', error: 'Browser download export was interrupted.' });
    if (!remaining) chrome.runtime.sendMessage({ type: 'offscreen:cleanup', jobId: meta.jobId }).catch(() => {});
    return;
  }
  if (!remaining) {
    const job = await getJob(meta.jobId);
    if (job?.state !== 'FAILED_FINAL') {
      await updateJob(meta.jobId, { state: 'COMPLETED', error: null });
    }
    chrome.runtime.sendMessage({ type: 'offscreen:cleanup', jobId: meta.jobId }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type?.startsWith('offscreen:')) return false;
  const run = async () => {
    if (!message || typeof message.type !== 'string') throw new Error('Invalid message');

    switch (message.type) {
      case 'content:media': {
        if (sender.tab?.id == null || typeof message.url !== 'string') return { ok: false };
        const candidate = candidateFrom(message.url, sender.tab.id, {
          source: 'dom',
          title: sender.tab.title || '',
          contentType: message.contentType || '',
        });
        if (candidate) await addCandidate(sender.tab.id, candidate);
        return { ok: true };
      }

      case 'popup:getState': {
        const tabId = Number(message.tabId);
        return { candidates: await listCandidates(tabId), jobs: await listJobs(30) };
      }

      case 'popup:clear': {
        await clearCandidates(Number(message.tabId));
        return { ok: true };
      }

      case 'popup:start': {
        const tabId = Number(message.tabId);
        const candidates = await listCandidates(tabId);
        const candidate = candidates.find(x => x.id === message.candidateId);
        if (!candidate) throw new Error('Media candidate no longer exists');
        const job = await createJob(candidate, tabId);
        await ensureOffscreen();
        await updateJob(job.id, { state: 'ACQUIRING', error: null });
        chrome.runtime.sendMessage({ type: 'offscreen:start', job: { ...job, state: 'ACQUIRING' } });
        return { ok: true, jobId: job.id };
      }

      case 'popup:retry': {
        const job = await getJob(message.jobId);
        if (!job) throw new Error('Job not found');
        await ensureOffscreen();
        await updateJob(job.id, { state: 'ACQUIRING', error: null });
        chrome.runtime.sendMessage({ type: 'offscreen:start', job: { ...job, state: 'ACQUIRING' } });
        return { ok: true };
      }

      case 'popup:cancel': {
        const job = await getJob(message.jobId);
        if (!job) return { ok: false };
        await ensureOffscreen();
        chrome.runtime.sendMessage({ type: 'offscreen:cancel', jobId: job.id });
        await updateJob(job.id, { state: 'CANCELLED' });
        return { ok: true };
      }

      case 'worker:export': {
        if (!message.jobId || !Array.isArray(message.items) || !message.items.length) throw new Error('Invalid export request');
        const ids = [];
        for (const item of message.items) {
          if (typeof item.url !== 'string' || !item.url.startsWith('blob:')) throw new Error('Export URL must be a Blob URL');
          const downloadId = await chrome.downloads.download({
            url: item.url,
            filename: item.filename,
            conflictAction: 'uniquify',
            saveAs: false,
          });
          await chrome.storage.session.set({ [`export:${downloadId}`]: { jobId: message.jobId, url: item.url } });
          ids.push(downloadId);
        }
        await updateJob(message.jobId, { state: 'FINALIZING', outputs: message.outputs || [] });
        return { ids };
      }

      case 'worker:event': {
        const { jobId, event } = message;
        if (!jobId || !event) return { ok: false };
        const patch = { state: event.state || undefined, error: event.error || null };
        if (event.progress) patch.progress = event.progress;
        if (event.outputs) patch.outputs = event.outputs;
        Object.keys(patch).forEach(k => patch[k] === undefined && delete patch[k]);
        await updateJob(jobId, patch);
        return { ok: true };
      }

      case 'worker:headerPrepare': {
        if (typeof message.url !== 'string') throw new Error('Missing URL');
        const ruleId = await prepareHeaderRule(Number(message.tabId), message.url);
        return { ruleId };
      }

      case 'worker:headerRelease': {
        await releaseHeaderRule(Number(message.ruleId));
        return { ok: true };
      }

      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  };

  run().then(sendResponse).catch(error => sendResponse({ error: error.message || String(error) }));
  return true;
});
