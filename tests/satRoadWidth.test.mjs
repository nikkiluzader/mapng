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
  const b = await measureRoadWidths(many, { loadTile: async (x, y) => paintedTile(45.01, 3.4)(x, y), maxTiles: 16 });
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
  // (comments and quoted text out first: a word like 'function' inside quotes opens nothing)
  const code = HERO_ROADS_LUA.replace(/--[^\n]*/g, '').replace(/'[^'\n]*'/g, "''");
  const count = (re) => (code.match(re) || []).length;
  assert.equal(count(/\b(function|if|for|while|do)\b/g) - count(/\bfor\b[^\n]*\bdo\b|\bwhile\b[^\n]*\bdo\b/g), count(/\bend\b/g));
});

test('lanes each way come from OpenStreetMap', async () => {
  const { laneSplit } = await import('../services/roadWidth.js');
  assert.deepEqual(laneSplit({ lanes: '2' }, 'secondary', false), { forward: 1, backward: 1, tagged: true });
  assert.deepEqual(laneSplit({ lanes: '3', 'lanes:forward': '2', 'lanes:backward': '1' }, 'primary', false), { forward: 2, backward: 1, tagged: true });
  assert.deepEqual(laneSplit({ lanes: '3', 'lanes:backward': '2' }, 'primary', false), { forward: 1, backward: 2, tagged: true });
  assert.deepEqual(laneSplit({ lanes: '3' }, 'primary', false), { forward: 2, backward: 1, tagged: true });
  assert.deepEqual(laneSplit({ lanes: '3' }, 'primary', true), { forward: 3, backward: 0, tagged: true });
  assert.deepEqual(laneSplit({ lanes: '1' }, 'unclassified', false), { forward: 1, backward: 0, tagged: true }, 'a single-lane two-way road');
  const usual = laneSplit({}, 'residential', false);
  assert.equal(usual.tagged, false); assert.ok(usual.forward >= 1 && usual.forward + usual.backward >= 1);
  assert.equal(laneSplit({}, 'residential', true).backward, 0);
});

test('a measurement wider than the class is not taken; a tagged lane count wins over the class', async () => {
  // (a primary road by its class: two lanes of 3.5 m; painted 9 m wide: verge the road's own grey)
  const wide = [eastWest(45, 7, 300, { highway: 'primary' })];
  const s = await measureRoadWidths(wide, { loadTile: async (x, y) => paintedTile(45, 4.5)(x, y) });
  assert.equal(s.measured, 0); assert.equal(s.wider, 1); assert.equal(wide[0].tags.width, undefined);
  const { estimateRoadHalfWidth } = await import('../services/roadWidth.js');
  // a single-track country lane: one lane for both directions
  assert.equal(2 * estimateRoadHalfWidth({ lanes: '1' }, 'unclassified', false), 3.5);
  assert.equal(2 * estimateRoadHalfWidth({}, 'unclassified', false), 6);
  // two lanes tagged on a two-way trunk road are two lanes, not the class's four
  assert.equal(2 * estimateRoadHalfWidth({ lanes: '2' }, 'trunk', false), 7.4);
  assert.equal(2 * estimateRoadHalfWidth({ lanes: '6' }, 'primary', false), 21);
});

test("the road width library: a country's figures, its region's where it has none, MapNG's usual ones last", async () => {
  const { applyRegionalWidths } = await import('../services/regionalWidths.js');
  const { ROAD_WIDTH_STANDARDS, widthStandardFor } = await import('../services/roadWidthStandards.js');
  const { estimateRoadHalfWidth, estimateRoadCrossSection } = await import('../services/roadWidth.js');
  const road = (tags) => ({ type: 'road', tags, geometry: [] });
  const lanes = (f) => 2 * estimateRoadHalfWidth(f.tags, f.tags.highway, false);
  const surface = (f) => { const cs = estimateRoadCrossSection(f.tags, f.tags.highway, false, { urban: false }); return 2 * cs.drivingHalfWidth + cs.leftExtra + cs.rightExtra; };
  const built = (code, region, tags) => { const f = road(tags); applyRegionalWidths([f], code ? { countryCode: code, region } : null); return f; };
  // a British A road: 9 m before any of this; the library gives 6 m (testers measured 5.5 to 6.5 m)
  assert.equal(surface(built('GB', 'Europe', { highway: 'primary' })), 6);
  assert.equal(lanes(built('GB', 'Europe', { highway: 'primary', width: '8' })), 8, 'a mapped width stays');
  // Poland: a voivodeship road 6.5 m of asphalt (measured 6.45 m), a national road wider
  assert.equal(surface(built('PL', 'Europe', { highway: 'secondary' })), 6.5);
  assert.equal(surface(built('PL', 'Europe', { highway: 'primary' })), 7.5);
  // Germany: RQ 11 is 8 m, a county road 6 m
  assert.equal(surface(built('DE', 'Europe', { highway: 'primary' })), 8);
  assert.equal(surface(built('DE', 'Europe', { highway: 'tertiary' })), 6);
  // a single-lane road: 3.5 m, Russia's 4.5 m
  assert.equal(lanes(built('PL', 'Europe', { highway: 'unclassified', lanes: '1' })), 3.5);
  assert.equal(lanes(built('RU', 'Europe', { highway: 'unclassified', lanes: '1' })), 4.5);
  // a country not in the library: its region's figures; the Americas outside it and an unknown place: as before
  assert.equal(surface(built('ES', 'Europe', { highway: 'primary' })), 6.5);
  assert.equal(surface(built('MX', 'Americas', { highway: 'primary' })), 9);
  assert.equal(surface(built(null, null, { highway: 'primary' })), 9);
  assert.equal(surface(built('US', 'Americas', { highway: 'primary' })), 9, 'the United States: MapNG\'s usual figures');
  assert.equal(widthStandardFor({ countryCode: 'ES', region: 'Europe' }).from, 'region');
  // every entry is whole: each class a lane, an edge default, a source
  for (const [code, e] of Object.entries(ROAD_WIDTH_STANDARDS)) {
    for (const c of ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential']) assert.ok(e.lanes[c] >= 2.5 && e.lanes[c] <= 3.75, `${code} ${c}`);
    assert.ok(e.edge.default >= 0 && e.sources.length && e.classes && ['high', 'medium', 'low'].includes(e.confidence), code);
  }
  // applied twice changes nothing more
  const twice = [built('GB', 'Europe', { highway: 'primary' })];
  assert.equal(applyRegionalWidths(twice, { countryCode: 'GB', region: 'Europe' }), 0);
});

test('with no tile budget every road is measured, a batch of pictures at a time', async () => {
  // forty roads 1.1 km apart: far more tiles than one batch holds
  const roads = Array.from({ length: 40 }, (_, i) => eastWest(45 + i * 0.01, 7, 1500, { highway: 'residential' }));
  let held = 0; let most = 0; const asked = new Set();
  const s = await measureRoadWidths(roads, { maxTiles: Infinity, loadTile: async (x, y) => { asked.add(`${x}/${y}`); held++; most = Math.max(most, held); return paintedTile(45 + Math.round((0) * 100) / 100, 3)(x, y); } });
  assert.equal(s.skippedForBudget, 0);
  assert.equal(s.tiles, asked.size);
  assert.ok(s.tiles > 1500, `tiles ${s.tiles}`);
  assert.ok(roads[0].tags.width, 'the road the picture shows is measured');
});
