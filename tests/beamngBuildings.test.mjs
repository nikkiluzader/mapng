import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  BUILDING_MATERIALS,
  buildTexturedBuildings,
  getBuildingMaterialDefs,
  orientedBox,
  planBuilding,
} from '../services/beamngBuildings.js';

// Local metric frame around Flagstaff: 1e-5 deg ≈ 1.1 m; flat ground at z = 100.
const LAT0 = 35.2;
const LNG0 = -111.6;
const M_LAT = 111320;
const M_LNG = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const project = (lat, lng) => [(lng - LNG0) * M_LNG, (lat - LAT0) * M_LAT, 100];
const rect = (id, x, y, w, h, tags) => ({
  id, type: 'building', tags,
  geometry: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
    .map(([px, py]) => ({ lat: LAT0 + py / M_LAT, lng: LNG0 + px / M_LNG })),
});
const opts = (extra = {}) => ({ area: 100, seed: 's', lat: LAT0, lon: LNG0, rectFill: 1, ...extra });

test('planBuilding: classes, tags and region decide the look', () => {
  const house = planBuilding({ building: 'house' }, opts());
  assert.equal(house.kind, 'house');
  assert.ok(['gabled', 'hipped'].includes(house.roof), 'box-shaped houses get pitched roofs');
  assert.ok(house.windows && house.wall, 'plain wall with laid-over windows');

  assert.equal(planBuilding({ building: 'house' }, opts({ rectFill: 0.6 })).roof, 'flat', 'L-shaped: flat');
  assert.equal(planBuilding({ building: 'apartments', 'building:levels': '7' }, opts({ area: 900 })).floors, 7);
  assert.equal(planBuilding({ building: 'yes', height: '30' }, opts({ area: 900 })).eaveH, 30);
  assert.equal(planBuilding({ building: 'office', 'building:levels': '30' }, opts({ area: 2000 })).office, true, 'towers are glass');
  assert.equal(planBuilding({ building: 'retail' }, opts({ area: 600 })).shopFloor, true, 'shopfront ground floor');
  assert.equal(planBuilding({ building: 'warehouse' }, opts({ area: 5000 })).kind, 'industrial');
  assert.equal(planBuilding({ building: 'house', 'building:material': 'brick' }, opts()).wallFamily, 'brick');
  assert.equal(planBuilding({ building: 'house', 'roof:shape': 'flat' }, opts()).roof, 'flat');
  // US West houses lean stucco, US East siding/brick (over many seeds).
  const westStucco = [...Array(50)].filter((_, i) => planBuilding({ building: 'house' }, opts({ seed: `w${i}` })).wallFamily === 'stucco').length;
  const eastStucco = [...Array(50)].filter((_, i) => planBuilding({ building: 'house' }, opts({ seed: `e${i}`, lat: 40, lon: -75 })).wallFamily === 'stucco').length;
  assert.ok(westStucco > 20 && eastStucco === 0, `west ${westStucco}, east ${eastStucco}`);
});

test('orientedBox finds the long axis of a rotated rectangle', () => {
  const c = Math.cos(0.5); const s = Math.sin(0.5);
  const ring = [[0, 0], [20, 0], [20, 8], [0, 8]].map(([x, y]) => [x * c - y * s, x * s + y * c]);
  const box = orientedBox(ring);
  assert.ok(Math.abs(box.length - 20) < 1e-6 && Math.abs(box.width - 8) < 1e-6);
  assert.ok(Math.abs(Math.abs(box.ux * c + box.uy * s) - 1) < 1e-6, 'axis along the 20 m side');
});

test('buildTexturedBuildings: textured, outward-facing, deterministic geometry', () => {
  const feats = [
    rect('1', 0, 0, 12, 9, { building: 'house' }),
    rect('2', 40, 0, 30, 20, { building: 'apartments', 'building:levels': '4', shop: 'bakery' }),
    rect('3', 100, 0, 60, 40, { building: 'warehouse' }),
  ];
  const { meshes, count } = buildTexturedBuildings(feats, project);
  assert.equal(count, 3);
  const names = new Set(Object.values(BUILDING_MATERIALS));
  const used = new Set();
  for (const mesh of meshes) {
    for (const m of mesh.material) { assert.ok(names.has(m.name), m.name); used.add(m.name); }
    const pos = mesh.geometry.getAttribute('position');
    const uv = mesh.geometry.getAttribute('uv');
    const col = mesh.geometry.getAttribute('color');
    assert.equal(uv.count, pos.count);
    assert.equal(col.count, pos.count);
    for (let i = 0; i < pos.array.length; i++) assert.ok(Number.isFinite(pos.array[i]));
  }
  for (const want of ['mapng_bld_facade', 'mapng_bld_shop']) assert.ok(used.has(want), `uses ${want}`);
  assert.ok([...used].some((n) => /roof/.test(n)), 'has roofs');

  // Every wall triangle faces away from its building's centre; roofs face up.
  const centres = [[6, 4.5], [55, 10], [130, 20]];
  // (indexed geometry: walk its triangles on a de-indexed copy)
  const pos = meshes[0].geometry.toNonIndexed().getAttribute('position');
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3();
  let walls = 0; let roofs = 0;
  const ups = []; const downs = [];
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (n.length() < 1e-9) continue;
    n.normalize();
    const m = new THREE.Vector3().add(a).add(b).add(c).divideScalar(3);
    const centre = centres.reduce((best, cc) => (Math.hypot(m.x - cc[0], m.y - cc[1]) < Math.hypot(m.x - best[0], m.y - best[1]) ? cc : best));
    if (Math.abs(n.z) < 0.01) {
      walls++;
      assert.ok(n.x * (m.x - centre[0]) + n.y * (m.y - centre[1]) > 0, `wall faces out at ${m.x.toFixed(1)},${m.y.toFixed(1)}`);
    } else {
      roofs++;
      (n.z > 0 ? ups : downs).push([a.clone(), b.clone(), c.clone(), m]);
    }
  }
  assert.ok(walls > 20 && roofs > 4);
  // faces turned down are a pitched roof's underside: tiles over each of them
  const zOver = ([p, q, r], x, y) => {
    const d = (q.y - r.y) * (p.x - r.x) + (r.x - q.x) * (p.y - r.y);
    if (Math.abs(d) < 1e-9) return null;
    const l1 = ((q.y - r.y) * (x - r.x) + (r.x - q.x) * (y - r.y)) / d;
    const l2 = ((r.y - p.y) * (x - r.x) + (p.x - r.x) * (y - r.y)) / d;
    const l3 = 1 - l1 - l2;
    return l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6 ? l1 * p.z + l2 * q.z + l3 * r.z : null;
  };
  assert.ok(downs.length > 0, 'pitched roofs have an underside');
  for (const [, , , m] of downs) {
    assert.ok(ups.some((t) => { const z = zOver(t, m.x, m.y); return z !== null && z > m.z + 0.05 && z < m.z + 0.5; }), `underside at ${m.x.toFixed(1)},${m.y.toFixed(1)} has tiles over it`);
  }

  const again = buildTexturedBuildings(feats, project).meshes[0].geometry.getAttribute('position').array;
  assert.deepEqual(Array.from(again), Array.from(meshes[0].geometry.getAttribute('position').array), 'same input, same building');
});

test('material defs: v1.5, vertex-coloured, one per material name', () => {
  const defs = getBuildingMaterialDefs();
  for (const name of Object.values(BUILDING_MATERIALS)) {
    assert.equal(defs[name]?.version, 1.5, name);
    assert.equal(defs[name].Stages[0].vertColor, true);
    assert.ok(defs[name].Stages[0].baseColorMap.startsWith('/assets/'), 'only global /assets textures');
  }
  assert.ok(defs.mapng_bld_facade.Stages[0].emissiveMap, 'lit windows at night');
});

test('a whole neighbourhood builds (regression: spread into push() overflowed the stack)', () => {
  const feats = [];
  for (let i = 0; i < 600; i++) feats.push(rect(`n${i}`, (i % 30) * 25, Math.floor(i / 30) * 25, 14, 10, { building: i % 3 ? 'house' : 'apartments' }));
  const { meshes, count } = buildTexturedBuildings(feats, project);
  assert.equal(count, 600);
  assert.ok(meshes.length >= 2, 'batched into several meshes');
  // BeamNG treats trailing digits in a node name as a detail level; several
  // "buildings_1", "buildings_2" nodes made the shape invalid in-game.
  for (const m of meshes) assert.doesNotMatch(m.name, /\d$/, `mesh name ${m.name} must not end in a digit`);
  assert.equal(new Set(meshes.map((m) => m.name)).size, meshes.length, 'unique names');
  // (indexed: three corners per triangle, as many as unshared vertices were)
  const corners = meshes.reduce((n, m) => n + m.geometry.index.count, 0);
  assert.ok(corners > 100000, `${corners} triangle corners`);
});

test('unmapped heights follow the tagged buildings of their kind nearby', async () => {
  const { neighbourLevels, planBuilding } = await import('../services/beamngBuildings.js');
  const P = (x, y) => ({ lat: y / 1e5, lng: x / 1e5 });
  const sq = (x, y, s, tags) => ({ type: 'building', tags, geometry: [P(x, y), P(x + s, y), P(x + s, y + s), P(x, y + s)] });
  const project = (lat, lng) => [lng * 1e5, lat * 1e5];
  // a block of tagged 6-floor apartment buildings, one untagged among them,
  // one untagged house (other group), one untagged block far away
  const feats = [
    ...[0, 30, 60, 90, 120].map((x) => sq(x, 0, 20, { building: 'apartments', 'building:levels': '6' })),
    sq(150, 0, 20, { building: 'apartments' }),
    sq(150, 40, 9, { building: 'house' }),
    sq(2000, 0, 20, { building: 'apartments' }),
  ];
  const hints = neighbourLevels(feats, project);
  assert.equal(hints.get(feats[5]), 6);
  assert.equal(hints.has(feats[6]), false, 'a house never takes the flats\' height');
  assert.equal(hints.has(feats[7]), false, 'too far from any tagged building');
  const plan = planBuilding({ building: 'apartments' }, { area: 400, seed: 'x', lat: 0, lon: 0, rectFill: 1, levelsHint: 6 });
  assert.ok(plan.floors >= 5 && plan.floors <= 7);
  assert.equal(plan.heightSource, 'neighbours');
  assert.equal(planBuilding({ building: 'apartments', 'building:levels': '9' }, { area: 400, seed: 'x', lat: 0, lon: 0, rectFill: 1, levelsHint: 6 }).floors, 9);
});
