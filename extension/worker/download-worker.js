import { parseM3U8, chooseBestVariant } from '../core/hls.js';
import { buildDashSegmentUrls, chooseDashRepresentations, parseMPD } from '../core/dash.js';
import { baseNameFromUrl, extensionFromUrl, sanitizeFilename, sleep } from '../core/util.js';

const running = new Map();
let rpcCounter = 0;
const rpcPending = new Map();

function rpc(type, payload = {}) {
  const requestId = ++rpcCounter;
  return new Promise((resolve, reject) => {
    rpcPending.set(requestId, { resolve, reject });
    postMessage({ type, requestId, ...payload });
  });
}

function emit(jobId, event) { postMessage({ type: 'event', jobId, event }); }

async function withHeaders(job, url, fn) {
  let ruleId = null;
  try {
    const prepared = await rpc('header:prepare', { tabId: job.tabId, url });
    ruleId = prepared?.ruleId || null;
    return await fn();
  } finally {
    if (ruleId) await rpc('header:release', { ruleId }).catch(() => {});
  }
}

async function fetchContext(job, url, init = {}) {
  return withHeaders(job, url, () => fetch(url, {
    cache: 'no-store',
    credentials: 'include',
    redirect: 'follow',
    ...init,
    signal: running.get(job.id)?.controller.signal,
  }));
}

async function fetchText(job, url) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetchContext(job, url);
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (running.get(job.id)?.controller.signal.aborted) throw error;
      await sleep(300 * (2 ** attempt));
    }
  }
  throw lastError;
}

async function ensureJobDir(jobId) {
  const root = await navigator.storage.getDirectory();
  const jobs = await root.getDirectoryHandle('jobs', { create: true });
  return jobs.getDirectoryHandle(jobId, { create: true });
}

async function openWriter(jobId, name, { append = false } = {}) {
  const dir = await ensureJobDir(jobId);
  const file = await dir.getFileHandle(name, { create: true });
  const handle = await file.createSyncAccessHandle();
  let offset = append ? handle.getSize() : 0;
  if (!append && handle.getSize()) handle.truncate(0);
  return {
    get size() { return offset; },
    write(bytes) {
      const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const written = handle.write(arr, { at: offset });
      offset += written;
      return written;
    },
    flush() { handle.flush(); },
    close() { try { handle.flush(); } finally { handle.close(); } },
    truncate(size) { handle.truncate(size); offset = size; },
  };
}

async function pipeResponse(job, response, writer, progress) {
  let lastEmit = 0;
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    writer.write(bytes);
    progress.bytes += bytes.byteLength;
    return;
  }
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value?.byteLength) {
      writer.write(value);
      progress.bytes += value.byteLength;
      const ts = Date.now();
      if (ts - lastEmit >= 250) {
        lastEmit = ts;
        emit(job.id, { state: 'ACQUIRING', progress: { ...progress } });
      }
    }
  }
}

function outputName(job, ext) {
  const title = sanitizeFilename(job.candidate.title || job.candidate.label || baseNameFromUrl(job.candidate.url));
  return `${title}.${ext}`;
}

async function downloadDirect(job) {
  const ext = extensionFromUrl(job.candidate.url, job.candidate.kind === 'audio' ? 'bin' : 'mp4');
  const opfsName = `output.${ext}`;
  const writer = await openWriter(job.id, opfsName, { append: true });
  const existing = writer.size;
  const headers = existing > 0 ? { Range: `bytes=${existing}-` } : {};
  let response = await fetchContext(job, job.candidate.url, { headers });
  if (existing > 0 && response.status !== 206) {
    writer.truncate(0);
    response = await fetchContext(job, job.candidate.url);
  }
  if (!response.ok) { writer.close(); throw new Error(`HTTP ${response.status}`); }
  const contentLength = Number(response.headers.get('content-length') || 0);
  const progress = { bytes: writer.size, total: contentLength ? writer.size + contentLength : 0, segmentsDone: 0, segmentsTotal: 0 };
  try {
    await pipeResponse(job, response, writer, progress);
  } finally {
    writer.close();
  }
  return [{ opfsName, filename: outputName(job, ext), mime: response.headers.get('content-type') || 'application/octet-stream' }];
}

function rangeHeader(br) {
  return br ? { Range: `bytes=${br.offset}-${br.offset + br.length - 1}` } : {};
}

async function fetchBytes(job, url, byteRange = null) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetchContext(job, url, { headers: rangeHeader(byteRange) });
      if (!response.ok && response.status !== 206) throw new Error(`HTTP ${response.status} for segment`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (running.get(job.id)?.controller.signal.aborted) throw error;
      await sleep(300 * (2 ** attempt));
    }
  }
  throw lastError;
}

function ivForSequence(sequence) {
  const iv = new Uint8Array(16);
  let n = BigInt(sequence);
  for (let i = 15; i >= 0; i--) { iv[i] = Number(n & 0xffn); n >>= 8n; }
  return iv;
}

function parseIv(raw, sequence) {
  if (!raw) return ivForSequence(sequence);
  const hex = raw.replace(/^0x/i, '').padStart(32, '0').slice(-32);
  return new Uint8Array(hex.match(/../g).map(x => parseInt(x, 16)));
}

async function decryptSegment(job, segment, bytes, keyCache) {
  if (!segment.key || segment.key.method === 'NONE') return bytes;
  if (segment.key.method !== 'AES-128' || !segment.key.uri) throw new Error(`Unsupported HLS encryption: ${segment.key.method}`);
  let rawKey = keyCache.get(segment.key.uri);
  if (!rawKey) {
    rawKey = await fetchBytes(job, segment.key.uri);
    keyCache.set(segment.key.uri, rawKey);
  }
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-CBC' }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: parseIv(segment.key.iv, segment.sequence) }, key, bytes);
  return new Uint8Array(plain);
}

async function resolveHls(job, startUrl) {
  let url = startUrl;
  for (let depth = 0; depth < 4; depth++) {
    const text = await fetchText(job, url);
    const parsed = parseM3U8(text, url);
    if (!parsed.isMaster) return { url, text, parsed };
    const best = chooseBestVariant(parsed.variants);
    if (!best) throw new Error('HLS master has no variants');
    url = best.url;
  }
  throw new Error('HLS master nesting too deep');
}

function hlsExt(parsed) {
  const first = parsed.segments[0];
  if (first?.map || /\.(m4s|mp4)(?:$|[?#])/i.test(first?.url || '')) return 'mp4';
  return 'ts';
}

async function downloadHls(job) {
  const firstResolved = await resolveHls(job, job.candidate.url);
  const ext = hlsExt(firstResolved.parsed);
  const opfsName = `output.${ext}`;
  const requestedResume = Number(job.progress?.segmentsDone || 0) > 0;
  const writer = await openWriter(job.id, opfsName, { append: requestedResume });
  const resume = requestedResume && writer.size > 0;
  if (requestedResume && !resume) writer.truncate(0);
  const keyCache = new Map();
  const seen = new Set();
  let segmentsDone = resume ? Number(job.progress?.segmentsDone || 0) : 0;
  let lastSequence = resume ? Number(job.progress?.lastSequence ?? -1) : -1;
  let initWritten = writer.size > 0;
  let playlistUrl = firstResolved.url;
  let parsed = firstResolved.parsed;
  let idlePolls = 0;
  let lastEmit = 0;

  try {
    while (true) {
      const available = parsed.segments.filter(s => s.sequence > lastSequence && !seen.has(s.sequence));
      const progress = { bytes: writer.size, total: 0, segmentsDone, segmentsTotal: parsed.endList ? segmentsDone + available.length : 0, lastSequence };

      if (!initWritten) {
        const map = available[0]?.map;
        if (map) {
          writer.write(await fetchBytes(job, map.uri, map.byteRange));
          initWritten = true;
        }
      }

      for (let i = 0; i < available.length; i += 4) {
        const batch = available.slice(i, i + 4);
        const downloaded = await Promise.all(batch.map(async seg => {
          const raw = await fetchBytes(job, seg.url, seg.byteRange);
          return decryptSegment(job, seg, raw, keyCache);
        }));
        for (let j = 0; j < batch.length; j++) {
          writer.write(await downloaded[j]);
          seen.add(batch[j].sequence);
          lastSequence = batch[j].sequence;
          segmentsDone++;
          progress.bytes = writer.size;
          progress.segmentsDone = segmentsDone;
          progress.lastSequence = lastSequence;
          const ts = Date.now();
          if (ts - lastEmit >= 250) {
            lastEmit = ts;
            emit(job.id, { state: 'ACQUIRING', progress: { ...progress } });
          }
        }
      }

      if (parsed.endList) break;
      await sleep(Math.max(1000, Math.min(8000, parsed.targetDuration * 750)));
      const text = await fetchText(job, playlistUrl);
      const next = parseM3U8(text, playlistUrl);
      const hasNew = next.segments.some(s => s.sequence > lastSequence);
      parsed = next;
      if (hasNew) idlePolls = 0;
      else if (++idlePolls >= 20) throw new Error('Live HLS stopped producing new segments');
    }
  } finally {
    writer.close();
  }

  return [{ opfsName, filename: outputName(job, ext), mime: ext === 'mp4' ? 'video/mp4' : 'video/mp2t' }];
}

async function downloadDashTrack(job, rep, durationSeconds, suffix, ext) {
  const { init, segments } = buildDashSegmentUrls(rep, durationSeconds);
  const opfsName = `${suffix}.${ext}`;
  const writer = await openWriter(job.id, opfsName, { append: false });
  const progress = { bytes: 0, total: 0, segmentsDone: 0, segmentsTotal: segments.length };
  let lastEmit = 0;
  try {
    if (init) writer.write(await fetchBytes(job, init));
    for (let i = 0; i < segments.length; i += 4) {
      const batch = segments.slice(i, i + 4);
      const chunks = await Promise.all(batch.map(url => fetchBytes(job, url)));
      for (const chunk of chunks) {
        writer.write(chunk);
        progress.bytes = writer.size;
        progress.segmentsDone++;
        const ts = Date.now();
        if (ts - lastEmit >= 250) {
          lastEmit = ts;
          emit(job.id, { state: 'ACQUIRING', progress: { ...progress } });
        }
      }
    }
  } finally { writer.close(); }
  return { opfsName, filename: outputName(job, suffix === 'video' ? ext : `audio.${ext}`), mime: rep.mimeType || 'application/octet-stream' };
}

async function downloadDash(job) {
  const xml = await fetchText(job, job.candidate.url);
  const mpd = parseMPD(xml, job.candidate.url);
  if (mpd.isDynamic) throw new Error('Live DASH is not supported yet');
  const reps = chooseDashRepresentations(mpd);
  const outputs = [];
  if (reps.video) outputs.push(await downloadDashTrack(job, reps.video, mpd.durationSeconds, 'video', 'mp4'));
  if (reps.audio) outputs.push(await downloadDashTrack(job, reps.audio, mpd.durationSeconds, 'audio', 'm4a'));
  if (!outputs.length) throw new Error('No downloadable DASH representation found');
  return outputs;
}

async function startJob(job) {
  if (running.has(job.id)) return;
  const controller = new AbortController();
  running.set(job.id, { controller });
  try {
    emit(job.id, { state: 'ACQUIRING', progress: job.progress || {} });
    let outputs;
    if (job.candidate.kind === 'hls') outputs = await downloadHls(job);
    else if (job.candidate.kind === 'dash') outputs = await downloadDash(job);
    else outputs = await downloadDirect(job);
    emit(job.id, { state: 'PROCESSING', outputs });
    postMessage({ type: 'complete', jobId: job.id, outputs });
  } catch (error) {
    if (controller.signal.aborted) emit(job.id, { state: 'CANCELLED' });
    else emit(job.id, { state: 'FAILED_RETRYABLE', error: error.message || String(error) });
  } finally {
    running.delete(job.id);
  }
}

self.onmessage = event => {
  const msg = event.data || {};
  if (msg.type === 'rpc:reply') {
    const pending = rpcPending.get(msg.requestId);
    if (!pending) return;
    rpcPending.delete(msg.requestId);
    if (msg.error) pending.reject(new Error(msg.error)); else pending.resolve(msg.result);
    return;
  }
  if (msg.type === 'start' && msg.job) startJob(msg.job);
  if (msg.type === 'cancel' && msg.jobId) running.get(msg.jobId)?.controller.abort();
};
