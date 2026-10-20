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
  assert.equal(planBuilding({ building: 'house', 'building:material': 'brick' }, opts()).wall, 'brick');
  assert.equal(planBuilding({ building: 'house', 'roof:shape': 'flat' }, opts()).roof, 'flat');
  // US West houses lean stucco, US East siding/brick (over many seeds).
  const westStucco = [...Array(50)].filter((_, i) => planBuilding({ building: 'house' }, opts({ seed: `w${i}` })).wall === 'stucco').length;
  const eastStucco = [...Array(50)].filter((_, i) => planBuilding({ building: 'house' }, opts({ seed: `e${i}`, lat: 40, lon: -75 })).wall === 'stucco').length;
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
  const pos = meshes[0].geometry.getAttribute('position');
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3();
  let walls = 0; let roofs = 0;
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
      assert.ok(n.z > 0, 'roof faces up');
    }
  }
  assert.ok(walls > 20 && roofs > 4);

  const again = buildTexturedBuildings(feats, project).meshes[0].geometry.getAttribute('position').array;
  assert.deepEqual(Array.from(again), Array.from(pos.array), 'same input, same building');
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
