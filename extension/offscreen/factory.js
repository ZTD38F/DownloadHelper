const worker = new Worker(chrome.runtime.getURL('worker/download-worker.js'), { type: 'module' });
const objectUrls = new Set();

async function sendToService(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (result?.error) throw new Error(result.error);
  return result;
}

async function getJobDir(jobId) {
  const root = await navigator.storage.getDirectory();
  const jobs = await root.getDirectoryHandle('jobs', { create: true });
  return jobs.getDirectoryHandle(jobId, { create: true });
}

async function createExportItems(jobId, outputs) {
  const dir = await getJobDir(jobId);
  const items = [];
  for (const output of outputs) {
    const handle = await dir.getFileHandle(output.opfsName);
    const file = await handle.getFile();
    const url = URL.createObjectURL(file);
    objectUrls.add(url);
    items.push({ url, filename: output.filename });
  }
  return items;
}

async function cleanupJob(jobId) {
  try {
    const root = await navigator.storage.getDirectory();
    const jobs = await root.getDirectoryHandle('jobs', { create: true });
    await jobs.removeEntry(jobId, { recursive: true });
  } catch {}
}

worker.onmessage = async event => {
  const msg = event.data || {};
  try {
    if (msg.type === 'header:prepare') {
      const result = await sendToService({ type: 'worker:headerPrepare', tabId: msg.tabId, url: msg.url });
      worker.postMessage({ type: 'rpc:reply', requestId: msg.requestId, result });
      return;
    }
    if (msg.type === 'header:release') {
      const result = await sendToService({ type: 'worker:headerRelease', ruleId: msg.ruleId });
      worker.postMessage({ type: 'rpc:reply', requestId: msg.requestId, result });
      return;
    }
    if (msg.type === 'event') {
      await sendToService({ type: 'worker:event', jobId: msg.jobId, event: msg.event });
      return;
    }
    if (msg.type === 'complete') {
      const items = await createExportItems(msg.jobId, msg.outputs || []);
      await sendToService({ type: 'worker:export', jobId: msg.jobId, items, outputs: msg.outputs || [] });
      return;
    }
  } catch (error) {
    if (msg.requestId) worker.postMessage({ type: 'rpc:reply', requestId: msg.requestId, error: error.message || String(error) });
    else if (msg.jobId) sendToService({ type: 'worker:event', jobId: msg.jobId, event: { state: 'FAILED_FINAL', error: error.message || String(error) } }).catch(() => {});
  }
};

chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'offscreen:start') worker.postMessage({ type: 'start', job: message.job });
  if (message?.type === 'offscreen:cancel') worker.postMessage({ type: 'cancel', jobId: message.jobId });
  if (message?.type === 'offscreen:revoke' && message.url) {
    URL.revokeObjectURL(message.url);
    objectUrls.delete(message.url);
  }
  if (message?.type === 'offscreen:cleanup' && message.jobId) cleanupJob(message.jobId);
});
