import test from 'node:test';
import assert from 'node:assert/strict';
import { passageOpenings, passageCrossings, streetIndex, insetRing, inRing } from '../services/buildingDetails.js';
import { buildTexturedBuildings } from '../services/beamngBuildings.js';

const K = 1 / 111320;
const P = (x, y) => ({ lat: y * K, lng: x * K });
const project = (lat, lng) => [lng / K, lat / K, 10];
const rect = (id, x, y, w, h, tags) => ({ id, type: 'building', tags, geometry: [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)] });
const road = (id, pts, tags) => ({ id, type: 'road', tags, geometry: pts.map(([x, y]) => P(x, y)) });

test('a passage road opens each wall it crosses for its width, and runs inside between them', () => {
  const ring = [[0, 0], [20, 0], [20, 12], [0, 12]];
  const passages = [{ line: [[10, -10], [10, 22]], half: 2 }];
  const front = passageOpenings([0, 0], [20, 0], passages);
  assert.equal(front.length, 1);
  assert.ok(Math.abs(front[0][0] * 20 - 7.75) < 1e-6 && Math.abs(front[0][1] * 20 - 12.25) < 1e-6, JSON.stringify(front));
  assert.equal(passageOpenings([20, 0], [20, 12], passages).length, 0, 'a side wall it does not cross');
  const inside = passageCrossings(ring, passages);
  assert.equal(inside.length, 1);
  assert.deepEqual(inside[0].p.map(Math.round), [10, 0]);
  assert.deepEqual(inside[0].q.map(Math.round), [10, 12]);
});

test('streets: a wall faces the street in front of it, not the one behind', () => {
  const s = streetIndex([road('r', [[-50, -6], [50, -6]], { highway: 'residential' })], project);
  assert.ok(Math.abs(s.facing([0, 0], [10, 0]) - 6) < 1e-6, 'the front wall (its outside to the south)');
  assert.equal(s.facing([10, 8], [0, 8]), null, 'the back wall faces away');
  // passage roads are kept apart, not as streets
  const s2 = streetIndex([road('p', [[5, -5], [5, 15]], { highway: 'service', tunnel: 'building_passage' })], project);
  assert.equal(s2.passages.length, 1);
  assert.equal(s2.facing([0, 0], [10, 0]), null);
});

test('insetRing moves a counter-clockwise ring inward', () => {
  const r = insetRing([[0, 0], [10, 0], [10, 10], [0, 10]], 1);
  assert.deepEqual(r.map((p) => p.map((v) => Math.round(v * 1000) / 1000)), [[1, 1], [9, 1], [9, 9], [1, 9]]);
  assert.ok(inRing([5, 5], r));
});

const MAT_DEFS = (mesh) => mesh.material.map((m) => m.name);

test('shopfronts only on the walls facing a street; a church gets its tower; a silo is round', () => {
  const feats = [
    road('main', [[-100, -8], [100, -8]], { highway: 'tertiary' }),
    rect('shop', 0, 0, 24, 14, { building: 'retail', 'building:levels': '3' }),
    rect('church', 60, 0, 14, 30, { building: 'church', amenity: 'place_of_worship', religion: 'christian' }),
    { id: 'silo', type: 'building', tags: { man_made: 'silo', building: 'silo' }, geometry: Array.from({ length: 16 }, (_, i) => P(150 + 4 * Math.cos((i / 16) * 2 * Math.PI), 4 * Math.sin((i / 16) * 2 * Math.PI))) },
  ];
  const { stats, meshes } = buildTexturedBuildings(feats, project);
  assert.ok(stats.details.shopfronts >= 2, `shopfronts on the street wall: ${stats.details.shopfronts}`);
  assert.equal(stats.details.towers, 1);
  assert.equal(stats.details.silos, 1);
  assert.equal(stats.details.parapets, 1, 'the 3-storey shop block has a parapet');
  const used = new Set(meshes.flatMap(MAT_DEFS));
  assert.ok(used.has('mapng_bld_metal_white') && used.has('mapng_bld_concrete'), [...used].join(','));
  // the shopfronts stand in front of the south (street) wall only: nothing of them north of the block
  const pos = meshes[0].geometry.getAttribute('position');
  let northMost = -Infinity;
  for (let i = 0; i < pos.count; i++) if (pos.getX(i) > 0 && pos.getX(i) < 24 && pos.getY(i) > 14.01 && pos.getZ(i) < 14) northMost = Math.max(northMost, pos.getY(i));
  assert.ok(northMost < 14.5, `nothing out from the back wall below the roof: ${northMost}`);
});

test('a building over a passage road: its front wall open at street level, the passage walled inside', () => {
  const feats = [
    road('p', [[10, -10], [10, 30]], { highway: 'service', tunnel: 'building_passage' }),
    rect('blk', 0, 0, 20, 14, { building: 'apartments', 'building:levels': '4' }),
  ];
  const { stats, meshes } = buildTexturedBuildings(feats, project);
  assert.equal(stats.details.passages, 2, 'front and back walls opened');
  // no wall triangle at street level across the opening (x 7.5..12.5 on y = 0, z under the opening's top)
  const pos = meshes[0].geometry.toNonIndexed().getAttribute('position');
  for (let i = 0; i < pos.count; i += 3) {
    const xs = [pos.getX(i), pos.getX(i + 1), pos.getX(i + 2)]; const ys = [pos.getY(i), pos.getY(i + 1), pos.getY(i + 2)]; const zs = [pos.getZ(i), pos.getZ(i + 1), pos.getZ(i + 2)];
    const onFront = ys.every((y) => Math.abs(y) < 0.01);
    const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
    if (onFront && midX > 8 && midX < 12 && Math.min(...zs) < 12 && Math.max(...zs) <= 13.2) assert.fail(`a wall across the passage at x ${midX.toFixed(1)}, z ${Math.min(...zs).toFixed(1)}..${Math.max(...zs).toFixed(1)}`);
  }
});

test('castles and forts: stone and battlements, no windows; sentry boxes on a star fort\'s points, towers on a castle\'s corners', async () => {
  const { fortKind, planBuilding } = await import('../services/beamngBuildings.js');
  const { castleCorners, mappedTower } = await import('../services/buildingDetails.js');
  assert.equal(fortKind({ historic: 'castle', castle_type: 'fortress' }), 'fortress');
  assert.equal(fortKind({ historic: 'castle', castle_type: 'defensive' }), 'castle');
  assert.equal(fortKind({ building: 'castle' }), 'castle');
  assert.equal(fortKind({ historic: 'castle', castle_type: 'palace' }), null, 'a palace keeps the ordinary look');
  assert.equal(fortKind({ historic: 'building', name: 'Ravelin' }), 'fortress', 'an outwork by its name');
  assert.equal(fortKind({ name: 'Ravelin' }), null, 'only a historic building');
  const plan = planBuilding({ building: 'yes', historic: 'castle', castle_type: 'fortress', 'building:levels': '2' }, { area: 20000, seed: 's', lat: 30, lon: -81, rectFill: 0.5 });
  assert.ok(!plan.band && !plan.office && !plan.windows && !plan.shopFloor && plan.roof === 'flat' && /stone/i.test(plan.wall), JSON.stringify(plan));
  assert.ok(plan.eaveH >= 8, `a fort's walls stand tall: ${plan.eaveH}`);

  // a four-bastion star fort: a square's curtains, each corner a bastion (flank, face, point at 63
  // degrees, face, flank; its shoulders at 103-104)
  const fortRing = [];
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const rot = ([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
    for (const p of [[-15, -30], [15, -30], [15, -38], [45, -45], [38, -15], [30, -15]]) fortRing.push(rot(p));
  }
  const feats = [
    road('main', [[-200, -70], [200, -70]], { highway: 'primary' }),
    { id: 'fort', type: 'building', tags: { building: 'yes', historic: 'castle', castle_type: 'fortress', 'building:levels': '2' }, geometry: fortRing.map(([x, y]) => P(x, y)) },
  ];
  const { stats } = buildTexturedBuildings(feats, project);
  assert.equal(stats.details.forts, 1);
  assert.equal(stats.details.sentryBoxes, 4, 'one on each bastion point, none on the shoulders');
  assert.ok(stats.details.merlons > 20, `merlons: ${stats.details.merlons}`);
  assert.equal(stats.details.gates, 1);
  assert.ok(!stats.details.roofPlant, 'no roof plant on a fort');

  // a castle: a 50 m square with a round tower (r 4.5) drawn into each corner of its outline
  const ring = [];
  const corners = [[25, -25], [25, 25], [-25, 25], [-25, -25]];
  corners.forEach(([cx, cy], k) => {
    const a0 = (k - 1) * (Math.PI / 2);   // each tower's outer arc
    for (let j = 0; j <= 12; j++) { const a = a0 - Math.PI / 4 + (j / 12) * Math.PI; ring.push([cx - Math.sign(cx) * 2 + 4.5 * Math.cos(a), cy - Math.sign(cy) * 2 + 4.5 * Math.sin(a)]); }
  });
  const hull = castleCorners(ring, 135, 0.08 * 50);
  assert.equal(hull.length, 4, `a tower at each corner: ${hull.length}`);
  for (const c of hull) {
    const t = mappedTower(ring, c, 10);
    assert.ok(t && Math.abs(t.r - 4.5) < 0.6, `the mapped tower's radius: ${t?.r}`);
  }
  const castle = buildTexturedBuildings([{ id: 'c', type: 'building', tags: { building: 'castle', historic: 'castle', castle_type: 'defensive' }, geometry: ring.map(([x, y]) => P(x, y)) }], project);
  assert.equal(castle.stats.details.cornerTowers, 4);
});
