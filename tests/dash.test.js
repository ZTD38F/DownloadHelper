import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashSegmentUrls, chooseDashRepresentations, parseMPD } from '../extension/core/dash.js';

test('parses basic static SegmentTemplate MPD', () => {
  const xml = `<?xml version="1.0"?><MPD type="static" mediaPresentationDuration="PT10S"><Period><AdaptationSet contentType="video" mimeType="video/mp4"><SegmentTemplate timescale="1" duration="2" startNumber="1" initialization="init-$RepresentationID$.mp4" media="seg-$Number%03d$.m4s"/><Representation id="v1" bandwidth="1000" width="640" height="360"/><Representation id="v2" bandwidth="3000" width="1920" height="1080"/></AdaptationSet></Period></MPD>`;
  const mpd = parseMPD(xml, 'https://cdn.example/path/manifest.mpd');
  const reps = chooseDashRepresentations(mpd);
  assert.equal(reps.video.id, 'v2');
  const urls = buildDashSegmentUrls(reps.video, mpd.durationSeconds);
  assert.equal(urls.init, 'https://cdn.example/path/init-v2.mp4');
  assert.equal(urls.segments[0], 'https://cdn.example/path/seg-001.m4s');
  assert.ok(urls.segments.length >= 5);
});
