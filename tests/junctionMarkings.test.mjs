import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { generateJunctionMarkingDecals, generateTurnArrowDecals } from '../services/exportBeamNGLevel.js';

const W = 256;
const SQUARE_SIZE = 2; // 512 m world
const CENTER_LAT = 30.0;
const CENTER_LNG = -81.5;

function makeTerrainData(osmFeatures) {
  const halfM = (W * SQUARE_SIZE) / 2;
  const dLat = halfM / 111320;
  const dLng = halfM / (111320 * Math.cos((CENTER_LAT * Math.PI) / 180));
  return {
    width: W,
    height: W,
    heightMap: new Float32Array(W * W).fill(5),
    minHeight: 5,
    bounds: {
      north: CENTER_LAT + dLat,
      south: CENTER_LAT - dLat,
      east: CENTER_LNG + dLng,
      west: CENTER_LNG - dLng,
    },
    osmFeatures,
  };
}

const point = (lat, lng, tags) => ({ id: 'n1', type: 'poi', geometry: [{ lat, lng }], tags });

test('stop node paints a bar on the approach half; crossing paints two lines', () => {
  const lat = CENTER_LAT;
  const dLng = 0.001; // ~96 m steps along x
  // A cross street 0.2 · dLng (~19 m) past the stop: the stop applies there.
  const junctionLng = CENTER_LNG + 1.2 * dLng;
  const road = {
    id: 'w1', type: 'road',
    tags: { highway: 'residential' },
    geometry: [...[-2, -1, 0, 1].map((k) => ({ lat, lng: CENTER_LNG + k * dLng })), { lat, lng: junctionLng }, { lat, lng: CENTER_LNG + 2 * dLng }],
  };
  const cross = {
    id: 'w2', type: 'road', tags: { highway: 'secondary' },
    geometry: [{ lat: lat - 0.001, lng: junctionLng }, { lat, lng: junctionLng }, { lat: lat + 0.001, lng: junctionLng }],
  };
  const stop = point(lat, CENTER_LNG + dLng, { highway: 'stop', direction: 'forward' });
  const crossing = point(lat, CENTER_LNG - dLng, { highway: 'crossing', crossing: 'marked' });

  const decals = generateJunctionMarkingDecals(makeTerrainData([road, cross, stop, crossing]), SQUARE_SIZE);

  const bars = decals.filter((d) => d.name.startsWith('jm_stopline'));
  const cw = decals.filter((d) => d.name.startsWith('jm_crosswalk'));
  assert.equal(bars.length, 1);
  assert.equal(cw.length, 2, 'transverse crosswalk = two lines');

  const bar = bars[0];
  assert.equal(bar.class, 'DecalRoad');
  assert.equal(bar.material, 'm_line_white');
  assert.equal(bar.nodes.length, 2);
  assert.equal(bar.nodes[0][3], 0.45, 'stop bar thickness');
  // Road runs west→east; forward approach right side is south (negative world Y).
  assert.ok(bar.nodes.every((n) => n[1] <= 0.01), 'bar on the approach (south) half');
  const span = Math.hypot(bar.nodes[1][0] - bar.nodes[0][0], bar.nodes[1][1] - bar.nodes[0][1]);
  assert.ok(span > 1 && span < 4, `bar spans the approach lanes (got ${span.toFixed(2)} m)`);

  // Crosswalk lines are perpendicular to the road (constant x per line) and
  // straddle the crossing node 2.4 m apart along it.
  const xs = cw.map((d) => (d.nodes[0][0] + d.nodes[1][0]) / 2).sort((a, b) => a - b);
  assert.ok(Math.abs(xs[1] - xs[0] - 2.4) < 0.05, `lines 2.4 m apart (got ${(xs[1] - xs[0]).toFixed(2)})`);
});

test('a signal on the junction node paints a bar on every approach, outside the junction', () => {
  const lat = CENTER_LAT;
  const dLng = 0.001;
  const dLat = 0.001;
  const roadA = {
    id: 'wa', type: 'road', tags: { highway: 'residential' },
    geometry: [-1, 0, 1].map((k) => ({ lat, lng: CENTER_LNG + k * dLng })),
  };
  const roadB = {
    id: 'wb', type: 'road', tags: { highway: 'residential' },
    geometry: [-1, 0, 1].map((k) => ({ lat: lat + k * dLat, lng: CENTER_LNG })),
  };
  // Signal mapped on the junction node itself (common older mapping).
  const junctionSignal = point(lat, CENTER_LNG, { highway: 'traffic_signals' });
  // Unmarked crossing → no crosswalk.
  const unmarked = point(lat, CENTER_LNG + dLng, { highway: 'crossing', crossing: 'unmarked' });

  const decals = generateJunctionMarkingDecals(
    makeTerrainData([roadA, roadB, junctionSignal, unmarked]),
    SQUARE_SIZE,
  );
  const bars = decals.filter((d) => d.name.startsWith('jm_stopline'));
  assert.equal(bars.length, 4, 'one stop bar per approach');
  assert.equal(decals.filter((d) => d.name.startsWith('jm_crosswalk')).length, 0);
  for (const bar of bars) {
    const mid = [(bar.nodes[0][0] + bar.nodes[1][0]) / 2, (bar.nodes[0][1] + bar.nodes[1][1]) / 2];
    assert.ok(Math.hypot(...mid) >= 6, 'bar stands outside the junction (world origin)');
  }
});

test('turn:lanes places one arrow per lane, ordered left-to-right across travel', () => {
  const lat = CENTER_LAT;
  const dLng = 0.001;
  // West→east one-way approach ending at a junction with a cross road.
  const approach = {
    id: 'w1', type: 'road',
    tags: { highway: 'primary', oneway: 'yes', lanes: '3', 'turn:lanes': 'left|through|right' },
    geometry: [-2, -1, 0].map((k) => ({ lat, lng: CENTER_LNG + k * dLng })),
  };
  const cross = {
    id: 'w2', type: 'road', tags: { highway: 'residential' },
    geometry: [{ lat: lat - 0.001, lng: CENTER_LNG }, { lat, lng: CENTER_LNG }, { lat: lat + 0.001, lng: CENTER_LNG }],
  };

  const arrows = generateTurnArrowDecals(makeTerrainData([approach, cross]), SQUARE_SIZE);
  assert.equal(arrows.length, 3);

  // Travel is +x; driver-right is -y (south). Leftmost lane (left arrow)
  // sits at the largest y.
  const sorted = [...arrows].sort((a, b) => b[4] - a[4]); // by world Y desc
  assert.deepEqual(sorted.map((a) => a[0]), [0, 2, 1], 'left, through, right across the roadway');
  // All set back from the junction end (junction at x=0).
  assert.ok(arrows.every((a) => a[3] < -2), 'arrows sit before the junction');
  // Tangent = driver-LEFT = +y (the stencil renders its "up" along
  // −(normal × tangent); driver-right tangents drew arrows 180° rotated).
  assert.ok(arrows.every((a) => a[10] > 0.99), 'tangent points driver-left');

  // No arrows when the tagged end is a dead end.
  const deadEnd = { ...approach, id: 'w3', geometry: approach.geometry.map((p) => ({ ...p, lat: p.lat + 0.01 })) };
  assert.equal(generateTurnArrowDecals(makeTerrainData([deadEnd]), SQUARE_SIZE).length, 0);
});

// Smoke test against whatever real OSM snapshot is parked in
// refs/mapng_exports (gitignored — the fixture rotates as the user tests new
// areas; skip cleanly when absent).
const FIXTURE_DIR = new URL('../refs/mapng_exports/', import.meta.url);
const fixtureFile = (() => {
  try {
    const name = fs.readdirSync(FIXTURE_DIR)
      .filter((f) => f.startsWith('osm_features_') && f.endsWith('.geojson'))
      .sort()
      .pop();
    return name ? new URL(name, FIXTURE_DIR) : null;
  } catch {
    return null;
  }
})();
test('real-world OSM snapshot produces plausible junction markings + turn arrows', { skip: !fixtureFile }, () => {
  const g = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
  const features = [];
  for (const f of g.features) {
    const p = f.properties || {};
    const tags = { ...p };
    delete tags._mapngType;
    delete tags._mapngId;
    const geomType = f.geometry?.type;
    if (geomType === 'Point') {
      const [lng, lat] = f.geometry.coordinates;
      features.push({ id: p._mapngId, type: p._mapngType || 'poi', geometry: [{ lat, lng }], tags });
    } else if (geomType === 'LineString') {
      features.push({
        id: p._mapngId,
        type: p._mapngType || (tags.highway ? 'road' : 'other'),
        geometry: f.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
        tags,
      });
    }
  }
  const lats = features.flatMap((f) => f.geometry.map((pt) => pt.lat));
  const lngs = features.flatMap((f) => f.geometry.map((pt) => pt.lng));
  const bounds = {
    north: Math.max(...lats), south: Math.min(...lats),
    east: Math.max(...lngs), west: Math.min(...lngs),
  };
  const terrainData = {
    width: 1024, height: 1024,
    heightMap: new Float32Array(1024 * 1024).fill(3),
    minHeight: 3,
    bounds,
    osmFeatures: features,
  };

  const decals = generateJunctionMarkingDecals(terrainData, 8);
  const bars = decals.filter((d) => d.name.startsWith('jm_stopline')).length;
  const cwLines = decals.filter((d) => d.name.startsWith('jm_crosswalk')).length;
  const arrows = generateTurnArrowDecals(terrainData, 8);
  console.log(`  ${String(fixtureFile).split('/').pop()}: ${bars} stop bars, ${cwLines / 2} crosswalks, ${arrows.length} turn arrows`);
  assert.ok(bars + cwLines > 0, 'expected some junction markings from a real urban snapshot');
  for (const d of decals) {
    assert.ok(d.nodes.every((n) => n.every(Number.isFinite)), 'all nodes finite');
  }
  for (const a of arrows) {
    assert.equal(a.length, 13, 'decal instance arity');
    assert.ok(a.every(Number.isFinite), 'all instance fields finite');
    assert.ok([0, 1, 2].includes(a[0]), 'rect index is an arrow frame');
    assert.ok(Math.abs(Math.hypot(a[9], a[10], a[11]) - 1) < 0.01, 'tangent is unit length');
  }
});
