import { now, stableId } from './util.js';

const INDEX_KEY = 'jobs:index';

async function index() {
  const obj = await chrome.storage.local.get(INDEX_KEY);
  return obj[INDEX_KEY] || [];
}

export async function createJob(candidate, tabId) {
  const id = `${now().toString(36)}-${stableId(candidate.url + Math.random())}`;
  const job = {
    id,
    tabId,
    candidate,
    state: 'PLANNED',
    progress: { bytes: 0, total: 0, segmentsDone: 0, segmentsTotal: 0 },
    createdAt: now(),
    updatedAt: now(),
    error: null,
  };
  await chrome.storage.local.set({ [`job:${id}`]: job, [INDEX_KEY]: [id, ...(await index()).filter(x => x !== id)].slice(0, 100) });
  return job;
}

export async function updateJob(id, patch) {
  const key = `job:${id}`;
  const obj = await chrome.storage.local.get(key);
  if (!obj[key]) return null;
  const next = { ...obj[key], ...patch, updatedAt: now() };
  if (patch.progress) next.progress = { ...obj[key].progress, ...patch.progress };
  await chrome.storage.local.set({ [key]: next });
  return next;
}

export async function getJob(id) {
  const key = `job:${id}`;
  return (await chrome.storage.local.get(key))[key] || null;
}

export async function listJobs(limit = 20) {
  const ids = (await index()).slice(0, limit);
  if (!ids.length) return [];
  const obj = await chrome.storage.local.get(ids.map(id => `job:${id}`));
  return ids.map(id => obj[`job:${id}`]).filter(Boolean);
}

export async function recoverJobs() {
  const jobs = await listJobs(100);
  for (const job of jobs) {
    if (['ACQUIRING', 'PROCESSING', 'FINALIZING'].includes(job.state)) {
      await updateJob(job.id, { state: 'RECOVERABLE', error: 'Browser/background restarted. Retry to resume from source.' });
    }
  }
}
