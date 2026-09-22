import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseBestVariant, parseM3U8 } from '../extension/core/hls.js';

test('parses master playlist and chooses highest bandwidth', () => {
  const p = parseM3U8(`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\na.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080\nb.m3u8`, 'https://cdn.example/master.m3u8');
  assert.equal(p.isMaster, true);
  assert.equal(chooseBestVariant(p.variants).url, 'https://cdn.example/b.m3u8');
});

test('parses media sequence, byte ranges and AES key', () => {
  const p = parseM3U8(`#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:10\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:4,\n#EXT-X-BYTERANGE:100@20\nseg.ts\n#EXTINF:4,\n#EXT-X-BYTERANGE:100\nseg.ts\n#EXT-X-ENDLIST`, 'https://x.test/a/index.m3u8');
  assert.equal(p.segments[0].sequence, 10);
  assert.deepEqual(p.segments[0].byteRange, { length: 100, offset: 20, end: 120 });
  assert.equal(p.segments[1].byteRange.offset, 120);
  assert.equal(p.segments[0].key.uri, 'https://x.test/a/key.bin');
  assert.equal(p.endList, true);
});
