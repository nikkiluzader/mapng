import test from 'node:test';
import assert from 'node:assert/strict';

import { fountainKind, planFountains, buildFountain, FOUNTAIN_KINDS } from '../services/fountains.js';

// world metres = (lng, lat); ground 10 m everywhere
const project = (lat, lng) => [lng, lat, 10];
const node = (id, x, y, tags) => ({ id, type: 'fountain', tags, geometry: [{ lat: y, lng: x }] });
const area = (id, pts, tags) => ({ id, type: 'water', tags, geometry: [...pts, pts[0]].map(([x, y]) => ({ lat: y, lng: x })) });

function recorder() {
  const tris = [];
  const add = (mat, pts) => {
    for (const p of pts) assert.ok(p.every(Number.isFinite), `finite vertex ${p}`);
    tris.push({ mat, pts });
  };
  return {
    tris,
    tri: (mat, a, b, c) => add(mat, [a, b, c]),
    quad: (mat, a, b, c, d) => { add(mat, [a, b, c]); add(mat, [a, c, d]); },
  };
}
const normalZ = ([a, b, c]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

test('fountain kinds from tags and shape', () => {
  assert.equal(fountainKind({ amenity: 'fountain' }), 'tiered');
  assert.equal(fountainKind({ amenity: 'fountain', fountain: 'nozzle' }), 'jets');
  assert.equal(fountainKind({ amenity: 'fountain', fountain: 'toroidal' }), 'obelisk');
  assert.equal(fountainKind({ amenity: 'fountain', fountain: 'birdbath' }), 'bowl');
  assert.equal(fountainKind({ amenity: 'fountain', fountain: 'bubbler' }), 'bubbler');
  assert.equal(fountainKind({ amenity: 'drinking_water' }), 'bubbler');
  assert.equal(fountainKind({ amenity: 'fountain', support: 'wall_mounted' }), 'wall');
  assert.equal(fountainKind({ amenity: 'fountain', fountain: 'splash_pad' }), 'splash');
  assert.equal(fountainKind({ amenity: 'fountain' }, { area: 900, node: false }), 'pool', 'a large outline: a pool');
  assert.equal(fountainKind({ amenity: 'fountain' }, { area: 80, aspect: 4, node: false }), 'pool', 'a long one too');
  assert.equal(fountainKind({ amenity: 'fountain' }, { area: 80, aspect: 1.1, node: false }), 'tiered');
});

test('planFountains: a mapped basin, nodes by kind, a node inside a basin is that basin', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const feats = [
    area('a1', sq, { amenity: 'fountain', natural: 'water' }),
    node('n1', 5, 5, { amenity: 'fountain' }),            // inside a1
    node('n2', 50, 50, { amenity: 'fountain', fountain: 'nozzle', diameter: '9' }),
    node('n3', 80, 80, { amenity: 'drinking_water' }),
    // indoors: a drinking fountain inside a school
    { id: 'b1', type: 'building', tags: { building: 'school' }, geometry: [[100, 0], [130, 0], [130, 20], [100, 20], [100, 0]].map(([x, y]) => ({ lat: y, lng: x })) },
    node('n4', 110, 10, { amenity: 'drinking_water' }),
    node('n5', 120, 10, { amenity: 'drinking_water', indoor: 'no' }),
  ];
  const fs = planFountains(feats, project);
  assert.equal(fs.length, 4);
  assert.ok(!fs.some((f) => f.id === 'n4'), 'the indoor drinking fountain is left out');
  assert.ok(fs.some((f) => f.id === 'n5'), 'one tagged outdoors kept');
  const a = fs.find((f) => f.id === 'a1');
  assert.equal(a.kind, 'tiered');
  assert.ok(Math.abs(a.room - 5) < 0.3, `room at the middle: ${a.room}`);
  const j = fs.find((f) => f.id === 'n2');
  assert.equal(j.kind, 'jets');
  const r = Math.max(...j.ring.map(([x, y]) => Math.hypot(x - 50, y - 50)));
  assert.ok(Math.abs(r - 4.5) < 0.6, `basin of its diameter tag: ${r}`);
  assert.equal(fs.find((f) => f.id === 'n3').kind, 'bubbler');
});

test('every kind builds: stone in both levels, water facing up inside the basin, no water or spray in the collision', () => {
  const tags = { tiered: {}, jets: { fountain: 'nozzle' }, obelisk: { fountain: 'sculpture' }, bowl: { fountain: 'stone' },
    bubbler: { fountain: 'drinking' }, wall: { fountain: 'wall' }, splash: { fountain: 'splash_pad' } };
  const built = new Set();
  for (const [kind, t] of Object.entries(tags)) {
    const [fo] = planFountains([node(`k_${kind}`, 0, 0, { amenity: 'fountain', ...t })], project);
    assert.equal(fo.kind, kind);
    const stone = recorder(); const full = recorder();
    const tee = { tri: (...a) => { stone.tri(...a); full.tri(...a); }, quad: (...a) => { stone.quad(...a); full.quad(...a); } };
    assert.ok(buildFountain(tee, full, fo), kind);
    built.add(kind);
    assert.ok(stone.tris.length > 0, `${kind}: stonework`);
    assert.ok(stone.tris.every((x) => !/fountain/.test(x.mat)), `${kind}: no water or spray in the collision`);
    const water = full.tris.filter((x) => x.mat === 'fountainWater');
    if (kind !== 'splash' && kind !== 'bubbler') assert.ok(water.length > 0, `${kind}: water`);
    assert.ok(water.every((x) => normalZ(x.pts) > 0), `${kind}: water faces up`);
    if (fo.ring) {
      const R = Math.max(...fo.ring.map(([x, y]) => Math.hypot(x, y)));
      assert.ok(full.tris.every((x) => x.pts.every((p) => Math.hypot(p[0], p[1]) <= R + 0.3)), `${kind}: within its basin`);
    }
    // water above the ground, the lowest under the basin's rim (0.45 m) or in a raised bowl
    for (const w of water) for (const p of w.pts) assert.ok(p[2] > 10 && p[2] < 16, `${kind}: water height ${p[2]}`);
    if (fo.ring && water.length) assert.ok(Math.min(...water.flatMap((w) => w.pts.map((p) => p[2]))) < 10.45, `${kind}: basin water under the rim`);
  }
  // pools from a long outline, jets along it
  const [pool] = planFountains([area('p', [[0, 0], [40, 0], [40, 8], [0, 8]], { amenity: 'fountain', fountain: 'nozzle' })], project);
  assert.equal(pool.kind, 'pool');
  const full = recorder();
  assert.equal(buildFountain(full, full, pool), 'pool');
  assert.ok(full.tris.some((x) => x.mat === 'fountainSpray'), 'jets along the pool');
  built.add('pool');
  assert.deepEqual([...built].sort(), [...FOUNTAIN_KINDS].sort());
});
