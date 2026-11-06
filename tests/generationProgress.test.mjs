import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyGenerationStatus, createGenerationProgress } from '../services/generationProgress.js';

test('generation messages land in their stage', () => {
  assert.equal(classifyGenerationStatus('Downloading 361 terrain and 1296 satellite tiles (20x concurrent)...'), 'tiles');
  assert.equal(classifyGenerationStatus('Downloaded 120/1657 global tiles...'), 'tiles');
  assert.equal(classifyGenerationStatus('Fetching GPXZ tiles... 12/40'), 'source');
  assert.equal(classifyGenerationStatus('Fetching Mapterhorn lidar tiles (z16): 32/64...'), 'source');
  assert.equal(classifyGenerationStatus('Mapterhorn has no lidar here. Using the global 30 m elevation...'), 'source');
  // the ground filter is terrain work of its own, not road shaping
  assert.equal(classifyGenerationStatus('Finding the ground under buildings and trees...'), 'ground');
  assert.equal(classifyGenerationStatus('No Overpass answer in 45 s; using Overture Maps.'), 'osm');
  assert.equal(classifyGenerationStatus('Resampling heightmap to 1m/px...'), 'resample');
  assert.equal(classifyGenerationStatus('Downloaded 30/90 satellite tiles...'), 'satellite');
  assert.equal(classifyGenerationStatus('Fetching OpenStreetMap data from overpass-api.de (mirror 3/6)...'), 'osm');
  assert.equal(classifyGenerationStatus('Smoothing roads in heightmap...'), 'roads');
  assert.equal(classifyGenerationStatus('Smoothing 812 roads into the terrain (level across, smooth along, joined at junctions)...'), 'roads');
  assert.equal(classifyGenerationStatus('Bringing river water down to its banks (the 30 m data reads the tree tops along it)...'), 'ground');
  assert.equal(classifyGenerationStatus('Raw terrain: the elevation is kept exactly as downloaded (no ground filter, no road smoothing)...'), null);
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

test('raw terrain and lidar skip the shaping stages; the global 30 m has them', () => {
  const shaped = createGenerationProgress({ resolution: 2048, includeOSM: true, source: 'mapterhorn' }).weights;
  assert.ok(shaped.ground > 0 && shaped.roads > 0);
  const raw = createGenerationProgress({ resolution: 2048, includeOSM: true, source: 'mapterhorn', raw: true }).weights;
  assert.equal(raw.ground, 0);
  assert.equal(raw.roads, 0);
  const gpxz = createGenerationProgress({ resolution: 2048, includeOSM: true, source: 'gpxz' }).weights;
  assert.equal(gpxz.ground, 0, 'GPXZ is never ground-filtered');
  assert.ok(gpxz.roads > 0 && gpxz.source > 0);
});
