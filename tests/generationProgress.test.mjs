import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyGenerationStatus, createGenerationProgress } from '../services/generationProgress.js';

test('generation messages land in their stage', () => {
  assert.equal(classifyGenerationStatus('Downloading 361 terrain and 1296 satellite tiles (20x concurrent)...'), 'elevation');
  assert.equal(classifyGenerationStatus('Downloaded 120/1657 global tiles...'), 'elevation');
  assert.equal(classifyGenerationStatus('Fetching GPXZ tiles... 12/40'), 'elevation');
  assert.equal(classifyGenerationStatus('Resampling heightmap to 1m/px...'), 'resample');
  assert.equal(classifyGenerationStatus('Downloaded 30/90 satellite tiles...'), 'satellite');
  assert.equal(classifyGenerationStatus('Fetching OpenStreetMap data from overpass-api.de (mirror 3/6)...'), 'osm');
  assert.equal(classifyGenerationStatus('Smoothing roads in heightmap...'), 'roads');
  assert.equal(classifyGenerationStatus('Blending satellite imagery with vector overlays...'), 'textures');
  assert.equal(classifyGenerationStatus('Rendering 3D view…'), null);
});

test('progress follows counts, never goes back, and reports finished stages', () => {
  let clock = 0;
  const p = createGenerationProgress({ resolution: 4096, includeOSM: true, now: () => clock });
  const a = p.update('Downloaded 100/1000 global tiles...').pct;
  clock += 1000;
  const b = p.update('Downloaded 900/1000 global tiles...').pct;
  assert.ok(b > a, `counts move the bar: ${a} -> ${b}`);
  clock += 1000;
  const r = p.update('Resampling heightmap to 1m/px...');
  assert.equal(r.completed?.step, 'Downloaded 100/1000 global tiles');
  assert.ok(r.pct >= b);
  // a message from an earlier stage keeps the bar where it is
  assert.ok(p.update('Downloaded 950/1000 global tiles...').pct >= r.pct);
  // a silent stage creeps with time
  const before = p.tick().pct;
  clock += 3000;
  assert.ok(p.tick().pct > before, 'silent resample creeps');
  // the mirror number is not progress
  const osm1 = p.update('Fetching OpenStreetMap data from lz4.overpass-api.de (mirror 2/6)...').pct;
  assert.ok(osm1 < 99);
});
