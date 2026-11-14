// Road surfaces > Mesh Roads (experimental): a MeshRoad deck under each paved ground road, services/meshRoads.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMeshRoads, MESH_ROAD_MATERIAL } from '../services/meshRoads.js';

const road = (name, pts, { width = 6, material = 'road_asphalt_2lane', z = () => 10, extra = {} } = {}) => ({ class: 'DecalRoad', name, material, nodes: pts.map(([x, y]) => [x, y, z(x, y), width]), ...extra });
const line = (x0, y0, x1, y1, step = 2) => { const n = Math.round(Math.hypot(x1 - x0, y1 - y0) / step); return Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]); };
const flat = () => 10;

test('a paved ground road gets one deck in the documented node format, a little over the ground', () => {
  const a = road('dr_a_s1_b', line(0, 0, 80, 0));
  const cl = road('dr_a_s1_cl', line(0, 0, 80, 0), { width: 0.15, material: 'm_line_white' });
  const ai = road('dr_a_s1_ai', line(0, 0, 80, 0), { material: 'road_invisible' });
  const { meshRoads, stats } = buildMeshRoads([{ __items: [a, cl, ai] }], flat);
  assert.equal(meshRoads.length, 1);
  const m = meshRoads[0];
  assert.equal(m.class, 'MeshRoad');
  assert.equal(m.topMaterial, MESH_ROAD_MATERIAL);
  assert.ok(m.sideMaterial && m.bottomMaterial);
  for (const nd of m.nodes) {
    assert.equal(nd.length, 8);                       // x, y, z, width, depth, normal
    assert.deepEqual(nd.slice(5), [0, 0, 1]);          // level across
    assert.ok(nd[2] > 10 && nd[2] < 10.06, `deck at ${nd[2]}`);
    assert.equal(nd[3], 6);
    assert.ok(nd[4] >= 0.3);
  }
  // reasonably even spacing, few nodes (the docs' authoring advice)
  for (let i = 1; i < m.nodes.length; i++) assert.ok(Math.hypot(m.nodes[i][0] - m.nodes[i - 1][0], m.nodes[i][1] - m.nodes[i - 1][1]) <= 5.01);
  // MapNG's surface and line are drawn on the deck; the AI path is left on the ground
  assert.equal(a.overObjects, true); assert.equal(cl.overObjects, true);
  assert.ok(cl.nodes.every((nd) => nd[2] > 10.03));
  assert.equal(ai.overObjects, undefined); assert.ok(ai.nodes.every((nd) => nd[2] === 10));
  assert.equal(stats.decks, 1);
});

test('no deck for an unpaved or narrow road, one on a structure, or one off the ground', () => {
  const groups = [{ __items: [
    road('dr_dirt_s1_b', line(0, 0, 40, 0), { material: 'road_dirt' }),
    road('dr_path_s1_b', line(0, 20, 40, 20), { width: 2 }),
    road('dr_bridge_s1_b', line(0, 40, 40, 40), { extra: { overObjects: true } }),
    road('dr_ramp_s1_b', line(0, 60, 40, 60), { z: () => 12 }),
  ] }];
  const { meshRoads, stats } = buildMeshRoads(groups, flat);
  assert.equal(meshRoads.length, 0);
  assert.equal(stats.skipped, 4);
});

test('two pieces of one road are one deck: no open wedge at the bend between them', () => {
  const groups = [{ __items: [road('dr_a_s1_b', line(0, 0, 40, 0)), road('dr_a_s2_b', line(40, 0, 76, 16))] }];
  const { meshRoads, stats } = buildMeshRoads(groups, flat);
  assert.equal(meshRoads.length, 1);
  assert.equal(stats.joined, 1);
});

test('at a junction the through road is one deck and the side road ends inside it, at its height', () => {
  const hill = (x, y) => 10 + 0.08 * y;             // the side road climbs away from the through road
  const groups = [{ __items: [
    road('dr_main_s1_b', line(-40, 0, 0, 0), { width: 8, z: hill }),
    road('dr_main_s2_b', line(0, 0, 40, 0), { width: 8, z: hill }),
    road('dr_side_s1_b', line(0, 0, 0, 40), { z: hill }),
  ] }];
  const { meshRoads } = buildMeshRoads(groups, hill);
  assert.equal(meshRoads.length, 2);
  const main = meshRoads.find((m) => m.name === 'mr_main_s1'); const side = meshRoads.find((m) => m.name === 'mr_side_s1');
  assert.ok(main && side);
  // the side road runs on into the junction (no wedge) ...
  assert.ok(Math.min(...side.nodes.map((nd) => nd[1])) < -1);
  // ... and every node of it inside the main deck is at the main deck's height
  // (the through deck where the side road meets it: its middle; its own two ends come down to the road, below)
  const mainZ = main.nodes[main.nodes.length >> 1][2];
  for (const nd of side.nodes) if (Math.abs(nd[1]) < 3.9) assert.ok(Math.abs(nd[2] - mainZ) < 0.005, `side node at y ${nd[1]}: ${nd[2]} vs ${mainZ}`);
  // a node stands on the main deck's edge
  assert.ok(side.nodes.some((nd) => Math.abs(nd[1] - 4) < 0.05));
});

test('a deck does not close into a ring through a junction it already crossed', () => {
  const sq = [[0, 0], [40, 0], [40, 40], [0, 40]];
  const items = sq.map((p, i) => road(`dr_ring_s${i + 1}_b`, line(p[0], p[1], sq[(i + 1) % 4][0], sq[(i + 1) % 4][1])));
  const { meshRoads } = buildMeshRoads([{ __items: items }], flat);
  for (const m of meshRoads) { const a = m.nodes[0]; const b = m.nodes[m.nodes.length - 1]; assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) > 1); }
});

test('the through road keeps its own height where a wider side street ends in it', () => {
  // the ground rises away from the through road, across the side street's mouth
  // (beyond the through road's own edge, 3 m from its line)
  const ground = (x, y) => 10 + (y > 3.2 ? 0.05 * y + 0.04 * Math.abs(x) : 0);
  const groups = [{ __items: [
    road('dr_main_s1_b', line(-60, 0, 0, 0), { width: 6, z: () => 10 }),
    road('dr_main_s2_b', line(0, 0, 60, 0), { width: 6, z: () => 10 }),
    road('dr_side_s1_b', line(0, 0, 0, 20), { width: 11, z: (x, y) => 10 + 0.05 * y }),
  ] }];
  const { meshRoads } = buildMeshRoads(groups, ground);
  const main = meshRoads.find((m) => m.name === 'mr_main_s1');
  const zs = main.nodes.map((nd) => nd[2]);
  assert.ok(Math.max(...zs) - Math.min(...zs) < 0.01, `the through road's deck is level: ${Math.min(...zs)}..${Math.max(...zs)}`);
});

test('a side road ending in a climbing through road takes its tilt there', () => {
  const climb = (x) => 10 + 0.06 * x;                // the through road climbs 6 % to the east
  const groups = [{ __items: [
    road('dr_main_s1_b', line(-40, 0, 0, 0), { width: 8, z: climb }),
    road('dr_main_s2_b', line(0, 0, 40, 0), { width: 8, z: climb }),
    road('dr_side_s1_b', line(0, 0, 0, 40), { z: () => 10 }),
  ] }];
  const { meshRoads } = buildMeshRoads(groups, (x, y) => (Math.abs(y) < 4 ? climb(x) : 10));
  const side = meshRoads.find((m) => m.name === 'mr_side_s1');
  const inMain = side.nodes.filter((nd) => Math.abs(nd[1]) <= 4.05);   // (its run-on end, its end, the node on the edge)
  assert.ok(inMain.length >= 2);
  // the normal leans back down the climb: the deck's cross-section then rises to the east as the through road does
  for (const nd of inMain) { assert.ok(nd[5] < -0.055 && nd[5] > -0.065, `normal x ${nd[5]}`); assert.ok(Math.abs(Math.hypot(nd[5], nd[6], nd[7]) - 1) < 1e-3); }
  assert.deepEqual(side.nodes[side.nodes.length - 1].slice(5), [0, 0, 1]);
});

test('a deck is tilted across its own width only, and never by more than lifts its edge a quarter metre', () => {
  // a 20 m wide road crossed by a ramp climbing 12 %: tilted to it, its edge would stand 1.2 m up
  const ramp = (x, y) => 10 + 0.12 * y;
  const groups = [{ __items: [
    road('dr_ramp_s1_b', line(0, -60, 0, 0), { width: 6, z: ramp }), road('dr_ramp_s2_b', line(0, 0, 0, 60), { width: 6, z: ramp }),
    road('dr_wide_s1_b', line(0, 0, 60, 0), { width: 20, z: () => 10 }),
  ] }];
  const { meshRoads } = buildMeshRoads(groups, (x, y) => (Math.abs(x) < 3 ? ramp(x, y) : 10));
  const wide = meshRoads.find((m) => m.name === 'mr_wide_s1');
  for (const nd of wide.nodes) assert.ok(Math.hypot(nd[5], nd[6]) * (nd[3] / 2) <= 0.2501, `edge lift ${Math.hypot(nd[5], nd[6]) * nd[3] / 2}`);
  // the next piece of the same road, straight on: no tilt at all where they meet
  const straight = [{ __items: [road('dr_a_s1_b', line(0, 0, 300, 0), { z: (x) => 10 + 0.1 * x }), road('dr_a_s2_b', line(300, 0, 600, 0), { z: (x) => 10 + 0.1 * x })] }];
  for (const m of buildMeshRoads(straight, (x) => 10 + 0.1 * x).meshRoads) for (const nd of m.nodes) assert.ok(Math.hypot(nd[5], nd[6]) < 1e-6, `${m.name} normal ${nd.slice(5)}`);
});

test('two pieces of one climbing road too long to join meet without a step', () => {
  const up = (x) => 10 + 0.1 * x;
  const groups = [{ __items: [road('dr_a_s1_b', line(0, 0, 300, 0), { z: up }), road('dr_a_s2_b', line(300, 0, 600, 0), { z: up })] }];
  const { meshRoads } = buildMeshRoads(groups, up);
  assert.equal(meshRoads.length, 2);   // (600 m: past what is joined into one deck)
  for (const m of meshRoads) for (const nd of m.nodes) assert.ok(Math.abs(nd[2] - up(nd[0])) < 0.09, `${m.name} at x ${nd[0]}: ${nd[2]} over a road at ${up(nd[0])}`);
});

test('a deck\'s end with no deck beyond it comes down to the road', () => {
  // (ground a little over the road's line across its width, as a terrain's grid leaves it)
  const { meshRoads } = buildMeshRoads([{ __items: [road('dr_a_s1_b', line(0, 0, 80, 0))] }], (x, y) => 10 + 0.05 * Math.abs(y));
  const n = meshRoads[0].nodes;
  assert.ok(n[0][2] <= 10.051 && n[n.length - 1][2] <= 10.051, `ends ${n[0][2]}, ${n[n.length - 1][2]}`);
  assert.ok(n[n.length >> 1][2] > 10.1, `middle ${n[n.length >> 1][2]}`);
});
