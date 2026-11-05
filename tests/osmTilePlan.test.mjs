import test from 'node:test';
import assert from 'node:assert/strict';
import { planTileSources, tilesCovering } from '../services/osmTiles.js';

// zoom-3 tile rectangles, as planet.py merge publishes them
const z3 = (x, y) => {
  const n = 8; const lat = (yy) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * yy) / n))) * 180) / Math.PI;
  return [(x / n) * 360 - 180, lat(y + 1), ((x + 1) / n) * 360 - 180, lat(y)];
};
const planet = (x, y, built) => ({ region: `planet-3-${x}-${y}`, key: `osm/planet-3-${x}-${y}.pmtiles`, bounds: z3(x, y), built_at: built });
const flagstaff = { south: 35.18, west: -111.66, north: 35.21, east: -111.62 };
const arizona = { region: 'arizona', key: 'osm/arizona.pmtiles', bounds: [-114.82, 31.33, -109.04, 37.01], built_at: '2026-10-23T00:00:00Z' };

test('every tile comes from the newest archive covering it', () => {
  const p = planTileSources([arizona, planet(1, 3, '2026-11-06T00:00:00Z')], flagstaff);
  assert.equal(p.length, 1);
  assert.equal(p[0].key, 'osm/planet-3-1-3.pmtiles');
  assert.equal(p[0].tiles.length, tilesCovering(flagstaff, 13).length);
  // without the planet piece the state archive still serves it
  assert.equal(planTileSources([arizona], flagstaff)[0].key, 'osm/arizona.pmtiles');
});

test('an area across two planet pieces reads both', () => {
  // x = -135 is the edge between zoom-3 columns 0 and 1
  const across = { south: 58.0, west: -135.02, north: 58.02, east: -134.98 };
  const p = planTileSources([planet(0, 2, '2026-11-06'), planet(1, 2, '2026-11-06')], across);
  assert.deepEqual(p.map((s) => s.key).sort(), ['osm/planet-3-0-2.pmtiles', 'osm/planet-3-1-2.pmtiles']);
  const all = p.flatMap((s) => s.tiles.map((t) => `${t.x}/${t.y}`));
  assert.equal(new Set(all).size, all.length);               // each tile once
  assert.equal(all.length, tilesCovering(across, 13).length);
});

test('an area with any uncovered tile falls back (null)', () => {
  const across = { south: 58.0, west: -135.02, north: 58.02, east: -134.98 };
  assert.equal(planTileSources([planet(1, 2, '2026-11-06')], across), null);
  assert.equal(planTileSources([], flagstaff), null);
});
