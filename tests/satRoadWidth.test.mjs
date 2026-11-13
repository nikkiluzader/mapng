import test from 'node:test';
import assert from 'node:assert/strict';
import { widthOfSection, agreedWidth, roadsToMeasure, measureRoadWidths, sectionsOf } from '../services/satRoadWidth.js';

const ASPHALT = [70, 72, 75], SOIL = [190, 140, 100];
const section = (leftM, rightM, noise = 0) => { const out = []; for (let o = -12; o <= 12 + 1e-9; o += 0.25) { const c = (o >= -leftM && o <= rightM) ? ASPHALT : SOIL; const j = noise ? ((Math.abs(Math.round(o * 4)) * 7) % 5 - 2) * noise : 0; out.push([c[0] + j, c[1] + j, c[2] + j]); } return out; };

test('a cross-section: the width is where the colour leaves the road\'s own, both ways', () => {
  assert.ok(Math.abs(widthOfSection(section(3, 3)) - 6) <= 0.5);
  assert.ok(Math.abs(widthOfSection(section(2, 4, 2)) - 6) <= 0.5, 'centre line off the middle, speckled asphalt');
  // an edge line (15 cm of white paint) is not the edge
  const lined = section(3.5, 3.5); lined[48 + 12] = [240, 240, 240];
  assert.ok(Math.abs(widthOfSection(lined) - 7) <= 0.5);
  // no edge found within reach (a car park), and a missing tile
  assert.equal(widthOfSection(section(12, 12)), null);
  const hole = section(3, 3); hole[10] = null; assert.equal(widthOfSection(hole), null);
});

test('a road\'s width is kept only where its cross-sections agree', () => {
  assert.deepEqual(agreedWidth([6, 6.2, 5.8, 6, 6.1, 5.9, 6]), { width: 6, sections: 7, spread: 0.1 });
  assert.equal(agreedWidth([6, 6, 6]), null, 'too few');
  assert.equal(agreedWidth([3, 9, 4, 12, 6, 15, 5, 10]), null, 'trees, shadows, parked cars');
});

test('which roads are measured: paved classes on the ground with no width given, main roads first', () => {
  const g = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }];
  const road = (tags) => ({ type: 'road', tags, geometry: g });
  const picked = roadsToMeasure([
    road({ highway: 'residential' }), road({ highway: 'secondary' }), road({ highway: 'tertiary', width: '5.5' }),
    road({ highway: 'primary', bridge: 'yes' }), road({ highway: 'track' }), road({ highway: 'unclassified', surface: 'gravel' }),
    { type: 'building', tags: {}, geometry: g },
  ]);
  assert.deepEqual(picked.map((f) => f.tags.highway), ['secondary', 'residential']);
});

// a synthetic world: an east-west road 6 m wide along lat 45, painted into tiles on demand
const paintedTile = (roadLat, halfM, shade = () => false) => (x, y) => {
  const data = new Uint8ClampedArray(256 * 256 * 4); const n = 2 ** 19 * 256;
  for (let py = 0; py < 256; py++) {
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y * 256 + py + 0.5)) / n))) * 180) / Math.PI;
    const onRoad = Math.abs((lat - roadLat) * 111320) <= halfM;
    for (let px = 0; px < 256; px++) { const c = shade(x * 256 + px, y * 256 + py) ? [20 + ((px * 13 + py * 7) % 200), 60, 20] : (onRoad ? ASPHALT : SOIL); data.set([c[0], c[1], c[2], 255], (py * 256 + px) * 4); }
  }
  return data;
};
const eastWest = (lat, lng0, metres, tags) => ({ type: 'road', tags, geometry: Array.from({ length: 9 }, (_, i) => ({ lat, lng: lng0 + (i * metres) / 8 / (111320 * Math.cos((lat * Math.PI) / 180)) })) });

test('measured end to end on a painted road: 6 m written as width, marked as measured', async () => {
  const features = [eastWest(45, 7, 300, { highway: 'unclassified' })];
  const lines = [];
  const s = await measureRoadWidths(features, { loadTile: async (x, y) => paintedTile(45, 3)(x, y), onProgress: (m) => lines.push(m) });
  assert.equal(s.measured, 1);
  assert.ok(Math.abs(Number(features[0].tags.width) - 6) <= 0.5, features[0].tags.width);
  assert.equal(features[0].tags['mapng:width_source'], 'satellite');
  assert.match(lines.at(-1), /^Measuring road widths from the satellite picture: \d+\/\d+ tiles\.\.\.$/);
  assert.ok(sectionsOf(features[0].geometry).length >= 50);
});

test('a road under trees keeps its width; missing tiles and the tile budget leave roads alone', async () => {
  const noisy = [eastWest(45, 7, 300, { highway: 'residential' })];
  const s = await measureRoadWidths(noisy, { loadTile: async (x, y) => paintedTile(45, 3, (px, py) => (Math.floor(px / 37) + Math.floor(py / 11)) % 2 === 0)(x, y) });
  assert.equal(s.measured, 0); assert.equal(noisy[0].tags.width, undefined);
  const dark = [eastWest(45, 7, 300, { highway: 'residential' })];
  assert.equal((await measureRoadWidths(dark, { loadTile: async () => null })).measured, 0);
  const many = [eastWest(45, 7, 300, { highway: 'residential' }), eastWest(45.01, 7, 300, { highway: 'primary' })];
  const b = await measureRoadWidths(many, { loadTile: async (x, y) => paintedTile(45.01, 4)(x, y), maxTiles: 16 });
  assert.equal(b.skippedForBudget, 1); assert.ok(many[1].tags.width, 'the main road is the one measured'); assert.equal(many[0].tags.width, undefined);
});

test('pieces of one named road take one width', async () => {
  const a = eastWest(45, 7, 200, { highway: 'tertiary', name: 'Mill Road' }); const b = eastWest(45, 7.003, 200, { highway: 'tertiary', name: 'Mill Road' });
  await measureRoadWidths([a, b], { loadTile: async (x, y) => paintedTile(45, 3.2)(x, y) });
  assert.ok(a.tags.width && a.tags.width === b.tags.width);
});

test('the Hero Roads level script: plain Lua text with the hooks the level script calls', async () => {
  const { HERO_ROADS_LUA, HERO_ROADS_FILE } = await import('../services/heroRoadsLua.js');
  assert.equal(HERO_ROADS_FILE, 'mapngHeroRoads.lua');
  for (const need of ['M.onUpdate = function()', 'M.remove = remove', 'M.status = function()', "require, 'editor/heroRoadEditor/groupMgr'", 'return M']) assert.ok(HERO_ROADS_LUA.includes(need), need);
  // (every block opened is closed: a script that does not parse would leave the level without its roads' upgrade, silently)
  const count = (re) => (HERO_ROADS_LUA.replace(/--[^\n]*/g, '').match(re) || []).length;
  assert.equal(count(/\b(function|if|for|while|do)\b/g) - count(/\bfor\b[^\n]*\bdo\b|\bwhile\b[^\n]*\bdo\b/g), count(/\bend\b/g));
});
