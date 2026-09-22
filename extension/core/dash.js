import { resolveUrl } from './util.js';

function attrs(raw = '') {
  const out = {};
  for (const m of raw.matchAll(/([:\w-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

function tagText(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

function parseDurationIso8601(v) {
  if (!v) return null;
  const m = v.match(/^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!m) return null;
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}

function applyTemplate(tpl, repId, number, time) {
  return tpl
    .replace(/\$RepresentationID\$/g, repId)
    .replace(/\$Number(?:%0(\d+)d)?\$/g, (_, width) => String(number).padStart(Number(width || 0), '0'))
    .replace(/\$Time\$/g, String(time ?? 0))
    .replace(/\$\$/g, '$');
}

function parseTimeline(xml) {
  const body = tagText(xml, 'SegmentTimeline');
  if (!body) return null;
  const entries = [];
  let current = 0;
  for (const m of body.matchAll(/<S\b([^>]*)\/?>(?:<\/S>)?/gi)) {
    const a = attrs(m[1]);
    const d = Number(a.d || 0);
    if (!d) continue;
    if (a.t != null) current = Number(a.t);
    const r = Number(a.r || 0);
    const count = r >= 0 ? r + 1 : 1;
    for (let i = 0; i < count; i++) {
      entries.push({ time: current, duration: d });
      current += d;
    }
  }
  return entries;
}

function parseTemplateFromXml(xml) {
  const m = xml.match(/<SegmentTemplate\b([^>]*)(?:\/>|>([\s\S]*?)<\/SegmentTemplate>)/i);
  if (!m) return null;
  const a = attrs(m[1]);
  return {
    initialization: a.initialization || null,
    media: a.media || null,
    startNumber: Number(a.startNumber || 1),
    timescale: Number(a.timescale || 1),
    duration: Number(a.duration || 0),
    timeline: parseTimeline(m[0]),
  };
}

export function parseMPD(xml, mpdUrl) {
  const mpdOpen = xml.match(/<MPD\b([^>]*)>/i);
  if (!mpdOpen) throw new Error('Invalid MPD');
  const mpdAttrs = attrs(mpdOpen[1]);
  const isDynamic = (mpdAttrs.type || 'static') === 'dynamic';
  const durationSeconds = parseDurationIso8601(mpdAttrs.mediaPresentationDuration);
  const rootBase = tagText(xml, 'BaseURL');
  const baseUrl = rootBase ? resolveUrl(mpdUrl, rootBase) : mpdUrl;
  const adaptationSets = [];

  for (const am of xml.matchAll(/<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet>/gi)) {
    const aa = attrs(am[1]);
    const body = am[2];
    const inheritedTemplate = parseTemplateFromXml(body);
    const inheritedBase = tagText(body, 'BaseURL');
    const setBase = inheritedBase ? resolveUrl(baseUrl, inheritedBase) : baseUrl;
    const type = aa.contentType || (aa.mimeType || '').split('/')[0] || null;
    const reps = [];

    for (const rm of body.matchAll(/<Representation\b([^>]*)(?:\/>|>([\s\S]*?)<\/Representation>)/gi)) {
      const ra = attrs(rm[1]);
      const rbody = rm[2] || '';
      const template = parseTemplateFromXml(rbody) || inheritedTemplate;
      const repBaseText = tagText(rbody, 'BaseURL');
      const repBase = repBaseText ? resolveUrl(setBase, repBaseText) : setBase;
      reps.push({
        id: ra.id || String(reps.length + 1),
        bandwidth: Number(ra.bandwidth || 0),
        width: Number(ra.width || 0) || null,
        height: Number(ra.height || 0) || null,
        codecs: ra.codecs || aa.codecs || null,
        mimeType: ra.mimeType || aa.mimeType || null,
        baseUrl: repBase,
        template,
      });
    }
    if (reps.length) adaptationSets.push({ type, mimeType: aa.mimeType || null, representations: reps });
  }

  return { isDynamic, durationSeconds, baseUrl, adaptationSets };
}

export function chooseDashRepresentations(mpd) {
  const best = {};
  for (const set of mpd.adaptationSets) {
    const type = set.type || (set.mimeType || '').split('/')[0];
    const rep = [...set.representations].sort((a, b) => b.bandwidth - a.bandwidth)[0];
    if (!best[type] && rep) best[type] = rep;
  }
  return best;
}

export function buildDashSegmentUrls(rep, durationSeconds) {
  const t = rep.template;
  if (!t || !t.media) {
    return { init: null, segments: rep.baseUrl && !rep.baseUrl.endsWith('/') ? [rep.baseUrl] : [] };
  }
  const init = t.initialization ? resolveUrl(rep.baseUrl, applyTemplate(t.initialization, rep.id, t.startNumber, 0)) : null;
  const segments = [];
  if (t.timeline?.length) {
    let number = t.startNumber;
    for (const e of t.timeline) {
      segments.push(resolveUrl(rep.baseUrl, applyTemplate(t.media, rep.id, number++, e.time)));
    }
  } else if (t.duration && durationSeconds) {
    const count = Math.ceil(durationSeconds * t.timescale / t.duration) + 1;
    for (let i = 0; i < count; i++) {
      const number = t.startNumber + i;
      segments.push(resolveUrl(rep.baseUrl, applyTemplate(t.media, rep.id, number, i * t.duration)));
    }
  } else {
    throw new Error('Unsupported DASH SegmentTemplate');
  }
  return { init, segments };
}
