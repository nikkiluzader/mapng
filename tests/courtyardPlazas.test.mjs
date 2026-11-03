import test from 'node:test';
import assert from 'node:assert/strict';

import { courtyardPassages, inRing } from '../services/buildingDetails.js';
import { buildPlazaMeshes, courtyardLayout, courtyardPathHalf, courtyardPaved, isCourtyard, isPlaza, plazaSurface } from '../services/plazas.js';

// world metres as lat/lng: 1e-5 degrees = 1 m both ways (the projection below)
const ll = (x, y) => ({ lat: y * 1e-5, lng: x * 1e-5 });
const project = (lat, lng) => [lng * 1e5, lat * 1e5];
const ring = (pts) => [...pts, pts[0]].map(([x, y]) => ll(x, y));

// a hall round a courtyard: 40 × 40 m, the courtyard 20 × 20 in the middle
const hall = (tags = { building: 'university' }) => ({
  id: 'b1', type: 'building', tags,
  geometry: ring([[-20, -20], [20, -20], [20, 20], [-20, 20]]),
  holes: [ring([[-10, -10], [10, -10], [10, 10], [-10, 10]])],
});
const way = (id, pts, tags = { highway: 'footway' }) => ({ id, type: 'road', tags, geometry: pts.map(([x, y]) => ll(x, y)) });

test('an enclosed courtyard gets an archway from the walk that ends at the hall', () => {
  // a walk up to the south wall at x = 5, a path in the courtyard
  const walk = way('w1', [[5, -40], [5, -21]]);
  const inside = way('w2', [[4, -9], [4, 9]]);
  const out = courtyardPassages([hall(), walk, inside], project);
  assert.equal(out.length, 1);
  const [p, q] = out[0].line;
  assert.ok(!inRing(p, [[-20, -20], [20, -20], [20, 20], [-20, 20]]), 'starts outside the hall');
  assert.ok(inRing(q, [[-10, -10], [10, -10], [10, 10], [-10, 10]]), 'ends in the courtyard');
  assert.ok(Math.abs(p[0] - 5) < 1.5 && p[1] < -20, `through the south wing by the walk (from ${p.map((v) => v.toFixed(1))})`);
});

test('no archway where one is mapped, into a fort, or into a light well', () => {
  const walk = way('w1', [[5, -40], [5, -21]]);
  const mapped = way('w3', [[0, -30], [0, 0]], { highway: 'footway', tunnel: 'building_passage' });
  const passage = { line: mapped.geometry.map((p) => project(p.lat, p.lng)), half: 1.4 };
  assert.equal(courtyardPassages([hall(), walk], project, [passage]).length, 0, 'a mapped passage reaches it');
  assert.equal(courtyardPassages([hall({ building: 'yes', historic: 'fort' }), walk], project).length, 0, 'a fort keeps its own gate');
  const well = { ...hall(), holes: [ring([[-2, -2], [2, -2], [2, 2], [-2, 2]])] };
  assert.equal(courtyardPassages([well, walk], project).length, 0, 'a 16 m² light well is no courtyard');
});

test('a courtyard with no way to it opens on the wall facing the street', () => {
  const facing = (a, b) => (Math.abs(a[1] - 20) < 0.1 && Math.abs(b[1] - 20) < 0.1 ? 8 : null);   // a street north
  const out = courtyardPassages([hall()], project, [], facing);
  assert.equal(out.length, 1);
  assert.ok(out[0].line[0][1] > 20, 'from the north side');
});

test('pedestrian squares pave in their mapped surface, round buildings and roads', () => {
  assert.equal(plazaSurface('bricks'), 'bricks');
  assert.equal(plazaSurface('sett'), 'sett');
  assert.equal(plazaSurface('concrete'), 'concrete');
  assert.equal(plazaSurface(undefined), 'pavers', 'untagged: concrete pavers');
  assert.ok(isPlaza({ tags: { highway: 'pedestrian', area: 'yes' }, geometry: ring([[0, 0], [1, 0], [1, 1]]) }));
  assert.ok(!isPlaza({ tags: { highway: 'pedestrian' }, geometry: ring([[0, 0], [1, 0], [1, 1]]) }), 'a pedestrian street is not a square');

  const square = { ring: [[0, 0], [30, 0], [30, 30], [0, 30]], surface: 'bricks' };
  const kiosk = [[12, 12], [18, 12], [18, 18], [12, 18]];
  const road = { nodes: [[-5, 25], [35, 25]], half: 3 };
  const drape = { drapeAt: (x) => 2 + x * 0.01, grid: { sq: 1, ox: -512, oy: -512 } };
  const { meshes, count, triangles } = buildPlazaMeshes([square], { drape, buildings: [kiosk], roads: [road] });
  assert.equal(count, 1);
  assert.ok(triangles > 100, `draped in pieces (${triangles} triangles)`);
  assert.equal(meshes[0].material.name, 'mapng_plaza_bricks');
  const pos = meshes[0].geometry.getAttribute('position').array;
  let inKiosk = 0; let onRoad = 0; let off = 0;
  for (let i = 0; i < pos.length; i += 9) {
    const cx = (pos[i] + pos[i + 3] + pos[i + 6]) / 3; const cy = (pos[i + 1] + pos[i + 4] + pos[i + 7]) / 3;
    if (inRing([cx, cy], kiosk)) inKiosk++;
    if (Math.abs(cy - 25) < 3) onRoad++;
    for (let k = 0; k < 9; k += 3) if (Math.abs(pos[i + k + 2] - (2 + pos[i + k] * 0.01 + 0.04)) > 1e-3) off++;
  }
  assert.equal(inKiosk, 0, 'none in the building');
  assert.equal(onRoad, 0, 'none on the road');
  assert.equal(off, 0, 'every vertex on the ground, 4 cm over it');
});

test('a square fronting the hall puts the archway in the middle of where it meets the wall, straight through', () => {
  // a half-round square whose flat top lies along the south wall from x = 0
  // to 10, its curved sides coming within reach of the wall well to the left
  const sq = { id: 's1', type: 'road', tags: { highway: 'pedestrian', area: 'yes' }, geometry: ring([[0, -20], [10, -20], [12, -23], [8, -28], [-6, -28], [-9, -23], [-7, -21]]) };
  const inside = way('w2', [[-8, -9], [-8, 9]]);   // a courtyard path off to the side
  const out = courtyardPassages([hall(), sq, inside], project);
  assert.equal(out.length, 1);
  const [p, q] = out[0].line;
  assert.ok(Math.abs(p[0] - 5) < 0.6, `entered mid-frontage (x ${p[0].toFixed(2)})`);
  assert.ok(Math.abs(q[0] - p[0]) < 0.1, 'square to the wall, not off to the path');
});

test('a crossing ending beside an untagged street, joined to nothing, puts a sidewalk on that side', async () => {
  const { inferCrossingSidewalks } = await import('../services/beamngSidewalks.js');
  const proj = (p) => project(p.lat, p.lng);
  // a street along x; a crossing across a side street ends 5 m south of it, loose
  const street = way('s', [[-50, 0], [50, 0]], { highway: 'residential' });
  const crossing = way('c', [[10, -5], [10, -12]], { highway: 'footway', footway: 'crossing' });
  const out = inferCrossingSidewalks([street, crossing], proj);
  assert.equal(out[0].tags.sidewalk, 'right', 'south of a west-to-east way: its right');
  assert.equal(out[1], crossing);
  // tagged streets keep their tags; a crossing end joined to a footway is not loose
  const tagged = { ...street, tags: { highway: 'residential', sidewalk: 'no' } };
  assert.equal(inferCrossingSidewalks([tagged, crossing], proj)[0], tagged);
  const walk = way('w', [[10, -5], [30, -5]]);
  assert.equal(inferCrossingSidewalks([street, crossing, walk], proj)[0], street, 'the walk is mapped: nothing to infer');
});

test('walks mapped in brick or stone are laid in it, others stay concrete', async () => {
  const { pavedWalkZones } = await import('../services/beamngSidewalks.js');
  // a street along x, 3.5 m half width, brick sidewalk on its left (north)
  const cw = { nodes: [[-50, 0, 0], [50, 0, 0]], half: 3.5, tags: { highway: 'residential', sidewalk: 'both', 'sidewalk:left:surface': 'bricks' } };
  const walk = { nodes: [[0, -40], [0, -20]], half: 1, surface: 'sett' };
  const plain = { nodes: [[20, -40], [20, -20]], half: 1, surface: 'concrete' };
  const at = pavedWalkZones([cw], [walk, plain]);
  assert.equal(at(0, 4.5), 'bricks', 'on the left sidewalk');
  assert.equal(at(0, -4.5), null, 'the right one untagged: concrete');
  assert.equal(at(0, 0), null, 'not on the road');
  assert.equal(at(0.5, -30), 'sett', 'on the mapped sett walk');
  assert.equal(at(20, -30), null, 'a concrete walk stays the slab');
  assert.equal(pavedWalkZones([{ ...cw, tags: { highway: 'residential' } }], []), null, 'nothing paved: no zones');
});

test('a short piece of a town street is judged with the street it is cut from', async () => {
  const { buildUrbanRoadClassifier } = await import('../services/roadWidth.js');
  // buildings along x = 0..200 on both sides, none round x = 200..215 (a park), then more
  const houses = [];
  for (let x = 0; x <= 400; x += 20) {
    if (x > 140 && x < 280) continue;
    for (const y of [-15, 15]) houses.push({ id: `h${x}_${y}`, type: 'building', tags: { building: 'yes' }, geometry: ring([[x, y], [x + 8, y], [x + 8, y + 8], [x, y + 8]]) });
  }
  const st = (id, x0, x1) => way(id, [[x0, 0], [x1, 0]], { highway: 'residential', name: 'Main Street' });
  const a = st('a', 0, 200); const piece = st('b', 200, 215); const c = st('c', 215, 400);
  const urban = buildUrbanRoadClassifier([...houses, a, piece, c]);
  assert.equal(urban(piece), true, 'the piece by the park is still the town street');
  const alone = buildUrbanRoadClassifier([...houses, { ...piece, tags: { highway: 'residential' } }]);
  assert.equal(alone({ ...piece, tags: { highway: 'residential' } }), false, 'judged alone it is not');
});

test('a courtyard is paved in flagstone inside its hall, its paths in bordered herringbone brick', () => {
  assert.ok(isCourtyard({ tags: { man_made: 'courtyard' }, geometry: ring([[0, 0], [1, 0], [1, 1]]) }));
  assert.ok(!isCourtyard({ tags: { man_made: 'courtyard', indoor: 'yes' }, geometry: ring([[0, 0], [1, 0], [1, 1]]) }));
  assert.equal(courtyardPathHalf({}), 0.9);
  assert.equal(courtyardPathHalf({ width: '3' }), 1.5);
  // the hall's outline holds the courtyard (its hole): it isn't cut away
  const hallRing = [[-20, -20], [20, -20], [20, 20], [-20, 20]];
  const court = { ring: [[-10, -10], [10, -10], [10, 10], [-10, 10]], surface: 'flagstone',
    paths: [{ nodes: [[-12, 0], [12, 0]], half: 0.9 }, { nodes: [[0, -12], [0, 12]], half: 0.9 }] };
  const drape = { drapeAt: () => 2, grid: { sq: 1, ox: -512, oy: -512 } };
  const { meshes, count } = buildPlazaMeshes([court], { drape, buildings: [hallRing] });
  assert.equal(count, 1, 'paved, not cut away round the hall');
  const byName = Object.fromEntries(meshes.map((m) => [m.material.name, m]));
  assert.deepEqual(Object.keys(byName).sort(), ['mapng_plaza_border', 'mapng_plaza_flagstone', 'mapng_plaza_herringbone']);
  const at = (name, x, y) => {
    const pos = byName[name].geometry.getAttribute('position').array;
    for (let i = 0; i < pos.length; i += 9) {
      const t = [[pos[i], pos[i + 1]], [pos[i + 3], pos[i + 4]], [pos[i + 6], pos[i + 7]]];
      if (inRing([x, y], t)) return true;
    }
    return false;
  };
  assert.ok(at('mapng_plaza_herringbone', 5, 0.2), 'brick down the path');
  assert.ok(at('mapng_plaza_border', 5, 1.05), 'setts along its edge');
  assert.ok(at('mapng_plaza_flagstone', 5, 5), 'flagstone between the paths');
  assert.ok(!at('mapng_plaza_flagstone', 5, 0.2) && !at('mapng_plaza_border', 5, 0.2), 'nothing laid twice');
  // the layout: the three fill the courtyard exactly
  const area = (mp) => mp.reduce((s, poly) => s + poly.reduce((a, r, k) => { let v = 0; for (let i = 0; i + 1 < r.length; i++) v += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return a + (k ? -Math.abs(v / 2) : Math.abs(v / 2)); }, 0), 0);
  const layers = courtyardLayout([[[...court.ring, court.ring[0]]]], court.paths);
  const total = layers.reduce((s, l) => s + area(l.shape), 0);
  assert.ok(Math.abs(total - 400) < 0.5, `the courtyard covered once (${total.toFixed(2)} m²)`);
});

test('an open courtyard with trees is a garden: only its paths laid, in pale stone with setts', () => {
  assert.equal(courtyardPaved({}, true), false, 'untagged, trees in it: a garden');
  assert.equal(courtyardPaved({}, false), true, 'untagged, nothing green: a patio');
  assert.equal(courtyardPaved({ surface: 'paving_stones' }, true), true, 'tagged paved');
  assert.equal(courtyardPaved({ surface: 'grass' }, false), false, 'tagged grass');
  const court = { ring: [[-10, -10], [10, -10], [10, 10], [-10, 10]], surface: 'flagstone', paved: false,
    paths: [{ nodes: [[-12, 0], [12, 0]], half: 0.9 }] };
  const drape = { drapeAt: () => 2, grid: { sq: 1, ox: -512, oy: -512 } };
  const { meshes } = buildPlazaMeshes([court], { drape });
  const byName = Object.fromEntries(meshes.map((m) => [m.material.name, m]));
  assert.deepEqual(Object.keys(byName).sort(), ['mapng_plaza_border', 'mapng_plaza_flagstone']);
  const at = (name, x, y) => {
    const pos = byName[name].geometry.getAttribute('position').array;
    for (let i = 0; i < pos.length; i += 9) if (inRing([x, y], [[pos[i], pos[i + 1]], [pos[i + 3], pos[i + 4]], [pos[i + 6], pos[i + 7]]])) return true;
    return false;
  };
  assert.ok(at('mapng_plaza_flagstone', 5, 0.2), 'the path in stone');
  assert.ok(!at('mapng_plaza_flagstone', 5, 5), 'the ground left as it is');
  // a courtyard paved in brick: its paths in flagstone
  const brick = courtyardLayout([[[...court.ring, court.ring[0]]]], court.paths, { groundSet: 'bricks' });
  assert.deepEqual(brick.map((l) => l.set), ['bricks', 'border', 'flagstone']);
});
