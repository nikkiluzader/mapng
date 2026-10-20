import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCarriagewayIndex,
  cutNodes,
  isInZone,
  isOnCrossingCarriageway,
  isOnOtherCarriageway,
  parallelRoadAt,
} from '../services/roadMarkingCuts.js';
import { generateDecalRoads } from '../services/exportBeamNGLevel.js';

// East–west road (self) crossed by a 10 m north–south road (cross) at x = 0.
const index = buildCarriagewayIndex([
  { owner: 'cross', half: 5, nodes: [[0, -60, 0, 10], [0, 60, 0, 10]] },
  { owner: 'self', half: 4, nodes: [[-60, 0, 0, 8], [60, 0, 0, 8]] },
]);
const line = [[-50, 1, 0, 0.15], [0, 1, 0, 0.15], [50, 1, 0, 0.15]];

test('a line stops margin metres outside the crossing carriageway', () => {
  const runs = cutNodes(line, (x, y) => isOnOtherCarriageway(index, x, y, 2, (o) => o === 'self'));
  assert.equal(runs.length, 2);
  const ends = [runs[0][runs[0].length - 1][0], runs[1][0][0]];
  assert.ok(ends[0] <= -7 && ends[0] > -7.6, `west piece ends at ${ends[0]}`);
  assert.ok(ends[1] >= 7 && ends[1] < 7.6, `east piece starts at ${ends[1]}`);
  // Original vertices are kept and z / width interpolate.
  assert.deepEqual(runs[0][0], [-50, 1, 0, 0.15]);
});

test('short pieces are dropped; a fully covered line disappears', () => {
  const stub = [[-6, 1, 0, 0.15], [6, 1, 0, 0.15]];
  assert.equal(cutNodes(stub, (x, y) => isOnOtherCarriageway(index, x, y, 2, (o) => o === 'self')).length, 0);
});

test('direction-aware lookups tell crossing roads from the road itself', () => {
  assert.equal(isOnCrossingCarriageway(index, 0, 1, 0, [1, 0]), true, 'inside the N–S road, heading east');
  assert.equal(isOnCrossingCarriageway(index, 20, 1, 0, [1, 0]), false, 'own road only');
  const own = parallelRoadAt(index, 20, 1, [-1, 0]);
  assert.equal(own.half, 4);
  assert.ok(own.dir[0] === -1 && Math.abs(own.dir[1]) < 1e-12, 'direction sign follows the query');
});

test('crosswalk zones cut lines along the road', () => {
  const zones = [{ x: 20, y: 0, ux: 1, uy: 0, halfLength: 2, halfWidth: 5 }];
  assert.equal(isInZone(zones, 21, 1), true);
  assert.equal(isInZone(zones, 25, 1), false);
  const runs = cutNodes([[10, 1, 0, 0.15], [30, 1, 0, 0.15]], (x, y) => isInZone(zones, x, y));
  assert.equal(runs.length, 2);
});

test('exported crossroads: no painted line enters the other road, the asphalt is untouched', () => {
  // Two primaries crossing in a ~1.1 km box, sharing their junction vertex.
  const J = 0.005;
  const road = (id, coords) => ({ id, type: 'road', tags: { highway: 'primary', lanes: '4', name: id }, geometry: coords.map(([lat, lng]) => ({ lat, lng })) });
  const size = 64;
  const td = {
    width: size, height: size, minHeight: 0, maxHeight: 50,
    heightMap: new Float32Array(size * size).fill(10),
    bounds: { north: 0.01, south: 0, west: 0, east: 0.01 },
    metersPerPixel: (0.01 * 111320) / size,
    osmFeatures: [road('ns', [[0.009, J], [J, J], [0.001, J]]), road('ew', [[J, 0.001], [J, J], [J, 0.009]])],
  };
  const decals = [];
  const walk = (items) => items.forEach((it) => { if (it.class === 'DecalRoad') decals.push(it); if (it.__items) walk(it.__items); });
  walk(generateDecalRoads(td, td.metersPerPixel));

  const lines = decals.filter((d) => /^m_line/.test(d.material) && !/^jm_/.test(d.name));
  assert.ok(lines.length > 0);
  // J is the world origin. A 4-lane primary is ≥ 6.5 m half width; lines of
  // one road must stay ≥ that + 2 m away along the other road's axis.
  for (const d of lines) {
    for (const [x, y] of d.nodes) {
      assert.ok(Math.min(Math.abs(x), Math.abs(y)) > 1 || Math.max(Math.abs(x), Math.abs(y)) > 8.5,
        `${d.name} node (${x.toFixed(1)}, ${y.toFixed(1)}) inside the junction`);
    }
  }
  const asphalt = decals.filter((d) => d.material === 'DefaultDecalRoadMaterial');
  assert.ok(asphalt.some((d) => d.nodes.some(([x, y]) => Math.hypot(x, y) < 2)), 'asphalt still covers the junction');
  // The paint pass's internal layer tag never reaches the level files.
  assert.ok(decals.every((d) => !JSON.stringify(d).includes('__layer')));
});
