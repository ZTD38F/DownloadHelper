export function now() { return Date.now(); }

export function stableId(input) {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function sanitizeFilename(name, fallback = 'download') {
  const cleaned = String(name || fallback)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return cleaned || fallback;
}

export function extensionFromUrl(url, fallback = '') {
  try {
    const p = new URL(url).pathname;
    const m = p.match(/\.([a-z0-9]{1,8})$/i);
    return m ? m[1].toLowerCase() : fallback;
  } catch {
    return fallback;
  }
}

export function baseNameFromUrl(url, fallback = 'media') {
  try {
    const p = decodeURIComponent(new URL(url).pathname);
    const last = p.split('/').filter(Boolean).pop() || fallback;
    return sanitizeFilename(last.replace(/\.[a-z0-9]{1,8}$/i, '') || fallback);
  } catch {
    return fallback;
  }
}

export function resolveUrl(base, relative) {
  return new URL(relative, base).href;
}

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseMimeKind(url, contentType = '') {
  const u = url.toLowerCase();
  const c = contentType.toLowerCase().split(';')[0].trim();
  if (c.includes('mpegurl') || u.includes('.m3u8')) return 'hls';
  if (c.includes('dash+xml') || u.includes('.mpd')) return 'dash';
  if (c.startsWith('video/') || /\.(mp4|webm|mov|mkv|m4v)(?:$|[?#])/i.test(url)) return 'video';
  if (c.startsWith('audio/') || /\.(mp3|m4a|aac|ogg|opus|wav)(?:$|[?#])/i.test(url)) return 'audio';
  return null;
}
