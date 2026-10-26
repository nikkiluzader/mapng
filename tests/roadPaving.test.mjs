import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateDecalRoads, pavingOf, pavingStrips, pedestrianSurfaceLayers, usedPavingMaterials, PAVING_MATERIALS,
} from '../services/exportBeamNGLevel.js';
import { fetchOSMData } from '../services/osm.js';

test('OSM surfaces map to their paving', () => {
  assert.equal(pavingOf('sett'), 'sett');
  assert.equal(pavingOf('cobblestone'), 'sett');
  assert.equal(pavingOf('unhewn_cobblestone'), 'cobble');
  assert.equal(pavingOf('paving_stones'), 'pavers');
  assert.equal(pavingOf('paving_stones:30'), 'pavers');
  assert.equal(pavingOf('paving_stones', { americas: true }), 'bricks', 'red brick in the Americas');
  assert.equal(pavingOf('bricks'), 'bricks');
  for (const s of ['asphalt', 'concrete', 'gravel', '', undefined]) assert.equal(pavingOf(s), null, String(s));
});

test('paving strips cover the width, about a tile each', () => {
  const strips = pavingStrips('pavers', 7);
  assert.equal(strips.length, 7);
  const left = strips[0].offset - strips[0].width / 2;
  const right = strips[strips.length - 1].offset + strips[strips.length - 1].width / 2;
  assert.ok(Math.abs(left + 3.5) < 0.05 && Math.abs(right - 3.5) < 0.05, 'edge to edge');
  for (let k = 1; k < strips.length; k++) {
    assert.ok(strips[k].offset - strips[k - 1].offset <= strips[k].width, 'strips overlap, no gap');
  }
  assert.ok(strips.every((s) => Math.abs(s.textureLength - 1) < 1e-9), 'square tiles');
  assert.ok(pavingStrips('sett', 60).length <= 10, 'a wide way grows its tiles instead');
  assert.equal(pavingStrips('bricks', 0.5).length, 1);
});

test('pedestrian street surfaces: paving in strips, concrete and gravel whole, untagged pavers', () => {
  assert.equal(pedestrianSurfaceLayers('paving_stones', 7).length, 7);
  assert.equal(pedestrianSurfaceLayers('concrete', 7)[0].material, 'road1_concrete');
  assert.equal(pedestrianSurfaceLayers('fine_gravel', 7)[0].material, 'm_dirt_road');
  assert.ok(pedestrianSurfaceLayers(undefined, 6).every((l) => l.material === PAVING_MATERIALS.pavers.material.name));
  assert.ok(pedestrianSurfaceLayers(undefined, 6, { americas: true }).every((l) => l.material === PAVING_MATERIALS.bricks.material.name));
});

// A 1 km flat map at (0, 0): one pedestrian street, one sett street for cars.
const deg = 1000 / 111320;
const bounds = { south: -deg / 2, north: deg / 2, west: -deg / 2, east: deg / 2 };
const line = (lat0, lng0, lat1, lng1) => [{ lat: lat0, lng: lng0 }, { lat: lat1, lng: lng1 }];
const terrain = (osmFeatures) => ({
  width: 512, height: 512, minHeight: 0, maxHeight: 10, heightMap: new Float32Array(512 * 512).fill(5),
  bounds, osmFeatures, roadRules: { countryCode: 'US', region: 'Americas' },
});
const decalsOf = (groups) => groups.flatMap((g) => g.__items || []).filter((d) => d.class === 'DecalRoad');

test('a pedestrian street is drawn in its paving (US: red brick), under the roads, off the AI graph', () => {
  const k = deg / 4;
  const groups = generateDecalRoads(terrain([
    { id: '1', type: 'road', geometry: line(-k, 0, k, 0), tags: { highway: 'pedestrian', name: 'Saint George Street', surface: 'paving_stones', width: '7' } },
    { id: '2', type: 'road', geometry: line(0, -k, 0, k), tags: { highway: 'residential', name: 'Cuna Street', surface: 'sett' } },
    { id: '3', type: 'road', geometry: line(-k, k / 2, k, k / 2), tags: { highway: 'pedestrian', area: 'yes' } },
  ]), 1000 / 511);
  const all = decalsOf(groups);
  const george = all.filter((d) => d.name.startsWith('dr_Saint_George_Street'));
  assert.ok(george.length > 0 && george.length % 5 === 0, `a 7 m brick street in 5 strips per piece (${george.length})`);
  assert.ok(george.every((d) => d.material === 'mapng_road_bricks' && !(d.drivability > 0)));
  assert.ok(george.every((d) => d.renderPriority > 14), 'under the roads');
  assert.equal(new Set(all.map((d) => d.name)).size, all.length, 'unique names');
  const cuna = all.filter((d) => d.name.startsWith('dr_Cuna_Street'));
  const setts = cuna.filter((d) => d.material === 'mapng_road_sett');
  assert.ok(setts.length >= 3, `${setts.length} sett strips`);
  assert.ok(setts.every((d) => !(d.drivability > 0)), 'strips carry no AI');
  const ai = cuna.filter((d) => d.drivability > 0);
  assert.ok(ai.length > 0 && ai.every((d) => d.material === 'road_invisible'), 'an invisible AI path per piece');
  assert.equal(setts.length % ai.length, 0);
  assert.ok(!cuna.some((d) => d.material === 'm_road_asphalt_edge_grass'), 'no asphalt edge blend on stone');
  assert.equal(groups.pedestrianStreets.length, george.length / 5, 'the area=yes plaza is not a street');
  assert.deepEqual(Object.keys(usedPavingMaterials(groups)).sort(), ['mapng_road_bricks', 'mapng_road_sett']);
});

test('a multipolygon plaza does not turn its outline ways into streets', async () => {
  const data = JSON.stringify({
    elements: [
      { type: 'node', id: 1, lat: 0, lon: 0 }, { type: 'node', id: 2, lat: 0, lon: 0.001 },
      { type: 'node', id: 3, lat: 0.001, lon: 0.001 },
      { type: 'way', id: 10, nodes: [1, 2, 3, 1], tags: { leisure: 'swimming_pool', name: 'Pool' } },
      { type: 'relation', id: 20, members: [{ type: 'way', ref: 10, role: 'outer' }], tags: { type: 'multipolygon', highway: 'pedestrian' } },
    ],
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => (String(url).includes('interpreter') ? new Response(data, { status: 200 }) : new Response('offline', { status: 503 }));
  try {
    const features = await fetchOSMData({ south: -0.001, west: -0.001, north: 0.002, east: 0.002 });
    assert.ok(!features.some((f) => f.type === 'road'), 'no road from the pool outline');
  } finally {
    globalThis.fetch = realFetch;
  }
});
