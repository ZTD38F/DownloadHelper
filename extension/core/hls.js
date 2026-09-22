import { resolveUrl } from './util.js';

export function parseAttributeList(input = '') {
  const out = {};
  let cur = '', quoted = false;
  const parts = [];
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') quoted = !quoted;
    if (ch === ',' && !quoted) { parts.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur) parts.push(cur);
  for (const p of parts) {
    const idx = p.indexOf('=');
    if (idx < 0) continue;
    let value = p.slice(idx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    out[p.slice(0, idx).trim()] = value;
  }
  return out;
}

function parseByteRange(raw, previousEnd = 0) {
  if (!raw) return null;
  const [lenRaw, offRaw] = raw.split('@');
  const length = Number(lenRaw);
  const offset = offRaw == null ? previousEnd : Number(offRaw);
  return { length, offset, end: offset + length };
}

export function parseM3U8(text, baseUrl) {
  const lines = text.replace(/\r/g, '').split('\n').map(x => x.trim());
  const variants = [];
  const segments = [];
  const media = [];
  let pendingStream = null;
  let pendingDuration = null;
  let pendingRange = null;
  let pendingDiscontinuity = false;
  let currentKey = null;
  let currentMap = null;
  let mediaSequence = 0;
  let targetDuration = 6;
  let endList = false;
  let lastRangeEnd = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      pendingStream = parseAttributeList(line.slice('#EXT-X-STREAM-INF:'.length));
      continue;
    }
    if (line.startsWith('#EXT-X-MEDIA:')) {
      media.push(parseAttributeList(line.slice('#EXT-X-MEDIA:'.length)));
      continue;
    }
    if (line.startsWith('#EXTINF:')) {
      pendingDuration = Number(line.slice('#EXTINF:'.length).split(',')[0]) || 0;
      continue;
    }
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      mediaSequence = Number(line.slice('#EXT-X-MEDIA-SEQUENCE:'.length)) || 0;
      continue;
    }
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDuration = Number(line.slice('#EXT-X-TARGETDURATION:'.length)) || targetDuration;
      continue;
    }
    if (line.startsWith('#EXT-X-BYTERANGE:')) {
      pendingRange = line.slice('#EXT-X-BYTERANGE:'.length);
      continue;
    }
    if (line.startsWith('#EXT-X-DISCONTINUITY')) {
      pendingDiscontinuity = true;
      continue;
    }
    if (line.startsWith('#EXT-X-KEY:')) {
      const a = parseAttributeList(line.slice('#EXT-X-KEY:'.length));
      currentKey = a.METHOD === 'NONE' ? null : {
        method: a.METHOD,
        uri: a.URI ? resolveUrl(baseUrl, a.URI) : null,
        iv: a.IV || null,
      };
      continue;
    }
    if (line.startsWith('#EXT-X-MAP:')) {
      const a = parseAttributeList(line.slice('#EXT-X-MAP:'.length));
      currentMap = {
        uri: resolveUrl(baseUrl, a.URI),
        byteRange: a.BYTERANGE ? parseByteRange(a.BYTERANGE, 0) : null,
      };
      continue;
    }
    if (line === '#EXT-X-ENDLIST') {
      endList = true;
      continue;
    }
    if (line.startsWith('#')) continue;

    if (pendingStream) {
      variants.push({
        url: resolveUrl(baseUrl, line),
        bandwidth: Number(pendingStream.BANDWIDTH || 0),
        averageBandwidth: Number(pendingStream['AVERAGE-BANDWIDTH'] || 0),
        resolution: pendingStream.RESOLUTION || null,
        codecs: pendingStream.CODECS || null,
        audioGroup: pendingStream.AUDIO || null,
      });
      pendingStream = null;
      continue;
    }

    const byteRange = pendingRange ? parseByteRange(pendingRange, lastRangeEnd) : null;
    if (byteRange) lastRangeEnd = byteRange.end;
    else lastRangeEnd = 0;
    segments.push({
      url: resolveUrl(baseUrl, line),
      duration: pendingDuration ?? 0,
      sequence: mediaSequence + segments.length,
      byteRange,
      key: currentKey,
      map: currentMap,
      discontinuity: pendingDiscontinuity,
    });
    pendingDuration = null;
    pendingRange = null;
    pendingDiscontinuity = false;
  }

  return { isMaster: variants.length > 0, variants, media, segments, mediaSequence, targetDuration, endList };
}

export function chooseBestVariant(variants) {
  return [...variants].sort((a, b) => (b.averageBandwidth || b.bandwidth) - (a.averageBandwidth || a.bandwidth))[0] || null;
}
