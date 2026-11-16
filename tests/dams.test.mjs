import test from 'node:test';
import assert from 'node:assert/strict';
import { planDams, buildDam, damTopGeometry } from '../services/dams.js';

// a gorge along y (floor 0 m, walls rising to 100 m past |x| = 30), a lake
// south of the dam: the survey removed the dam, its gap the gorge
const ground = (x) => (Math.abs(x) > 30 ? 100 : Math.abs(x) * 0.5);
const project = (lat, lng) => [lng, lat];
const feat = (pts, tags) => ({ type: 'water', id: '1', tags, geometry: pts.map(([x, y]) => ({ lat: y, lng: x })) });
const recorder = () => { const tris = []; return { tris, tri: (mat, ...v) => tris.push([mat, v.slice(0, 3)]), quad: (mat, a, b, c, d) => { tris.push([mat, [a, b, c]]); tris.push([mat, [a, c, d]]); } }; };

test('dams: an outline over a gap in the data is built to its crest; the ground is never touched', () => {
  const dam = feat([[-40, -5], [40, -5], [40, 5], [-40, 5], [-40, -5]], { waterway: 'dam', name: 'Test dam' });
  const [d] = planDams([dam], project, { groundAt: ground });
  assert.ok(d, 'planned');
  assert.equal(d.crest, 100, 'the crest where it meets the rock');
  const m = recorder();
  assert.equal(buildDam(m, d, ground), 'dam');
  const zs = m.tris.flatMap(([, v]) => v.map((p) => p[2]));
  assert.ok(Math.max(...zs) <= 100 + 1e-9 && Math.min(...zs) < 0, 'from under the gorge floor to the crest');
  const top = damTopGeometry(d);
  assert.ok(top.positions.length >= 9 && top.positions.every((v, k) => k % 3 !== 2 || (v <= 100 && v >= 99)), 'a flat crest top with a 1 m skirt, its own object');
  for (let k = 0; k < top.positions.length; k += 9) {
    if ([0, 1, 2].some((j) => top.positions[k + 3 * j + 2] !== 100)) continue;   // (the skirt)
    const P = (j) => [top.positions[k + 3 * j], top.positions[k + 3 * j + 1]];
    const [a, b, c] = [P(0), P(1), P(2)];
    assert.ok(Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - b[0], c[1] - b[1]), Math.hypot(a[0] - c[0], a[1] - c[1])) <= 4 + 1e-9, 'small triangles (decals clip onto them)');
  }
});

test('dams: a height tag caps the crest; a dam the data shows already, or a low weir, is left', () => {
  const dam = feat([[-40, -5], [40, -5], [40, 5], [-40, 5], [-40, -5]], { waterway: 'dam', height: '60' });
  assert.equal(planDams([dam], project, { groundAt: ground })[0].crest, 60);
  const shown = planDams([dam], project, { groundAt: () => 100 });
  assert.equal(shown.length, 0, 'no gap: the ground is the dam');
  const weir = feat([[-10, 50], [10, 50]], { waterway: 'dam' });
  assert.equal(planDams([weir], project, { groundAt: (x, y) => 5 + (y > 50 ? 0.5 : 0) }).length, 0);
});

test('dams: a dam drawn as a line gets its width', () => {
  const line = feat([[-40, 0], [40, 0]], { waterway: 'dam', width: '12' });
  const [d] = planDams([line], project, { groundAt: ground });
  const ys = d.ring.map((p) => p[1]);
  assert.ok(Math.abs(Math.max(...ys) - 6) < 1e-9 && Math.abs(Math.min(...ys) + 6) < 1e-9);
});

test('damAt and damGuardrails: a road stretch on a dam gets a rail each side at its height', async () => {
  const { damAt, damGuardrails } = await import('../services/dams.js');
  const dams = [{ ring: [[-40, -5], [40, -5], [40, 5], [-40, 5]], crest: 100 }];
  assert.equal(damAt(dams, 0, 0), dams[0]);
  assert.equal(damAt(dams, 0, 20), null);
  const n = 41;
  const edge = { x: Float64Array.from({ length: n }, (_, i) => -60 + i * 3), y: new Float64Array(n), s: Float64Array.from({ length: n }, (_, i) => i * 3), half: 3.5 };
  const graph = {
    edges: [edge],
    profile: { z: [Array.from({ length: n }, () => 100)] },
    classes: { segments: [{ edge: 0, i0: 7, i1: 33, s0: 21, s1: 99, kind: 'dam' }, { edge: 0, i0: 0, i1: 6, s0: 0, s1: 18, kind: 'ground' }] },
  };
  const rails = damGuardrails(graph);
  assert.equal(rails.length, 2);
  for (const r of rails) {
    assert.ok(r.pts.every(([, y]) => Math.abs(Math.abs(y) - 4.1) < 1e-9), 'the road edge + 0.6 m');
    assert.ok(r.z.every((z) => z === 100));
  }
  assert.notEqual(Math.sign(rails[0].pts[0][1]), Math.sign(rails[1].pts[0][1]), 'one each side');
});

test('splitAtDams: a road is cut into its own piece where it runs on a dam', async () => {
  const { splitAtDams } = await import('../services/exportBeamNGLevel.js');
  const dams = [{ ring: [[-40, -5], [40, -5], [40, 5], [-40, 5]], crest: 100 }];
  const pts = Array.from({ length: 41 }, (_, i) => ({ x: -100 + i * 5 }));
  const pieces = splitAtDams(pts, dams, (p) => [p.x, 0]);
  assert.equal(pieces.length, 3);
  assert.equal(pieces[0].at(-1), pieces[1][0], 'pieces share their joint node');
  assert.ok(pieces[1].slice(1, -1).every((p) => Math.abs(p.x) <= 40), 'the middle piece on the dam');
  assert.equal(splitAtDams(pts, [], (p) => [p.x, 0]).length, 1);
});

test('a dam with a road takes that road as its axis; no wider on the map than its crest, the air side batters out with depth, the water side stays straight', async () => {
  const { planDams, buildDam, damTopGeometry } = await import('../services/dams.js');
  // gorge along y; the lake south (bed at 60 m), the valley north (floor 0 m)
  const ground = (x, y) => (Math.abs(x) > 30 ? 100 : y < -6 ? 60 : Math.abs(x) * 0.5);
  const [d] = planDams([feat([[-40, -6], [40, -6], [40, 6], [-40, 6], [-40, -6]], { waterway: 'dam' })], project, { groundAt: ground });
  d.axis = Array.from({ length: 21 }, (_, i) => [-40 + i * 4, 0]);
  d.half = 3.5;
  const m = recorder();
  assert.equal(buildDam(m, d, ground), 'concrete dam');
  const pts = m.tris.flatMap(([, v]) => v);
  const low = pts.filter((p) => p[2] < 20);
  assert.ok(low.some((p) => p[1] > 5), 'deep down, the dam reaches out on the valley side');
  assert.ok(Math.max(...low.map((p) => p[1])) > 15, 'and flares: thicker at the foot than at the crest');
  assert.ok(pts.every((p) => p[1] >= -5 - 1e-6), 'the water side straight down from the crest edge');
  const top = damTopGeometry(d);
  const zs = top.positions.filter((_, k) => k % 3 === 2);
  assert.ok(zs.some((z) => z === 100) && zs.every((z) => z >= 99), 'the crest top: a strip over the axis at the crest, with its skirt');
});

// ── the shapes of dams ────────────────────────────────────────────────────────────
const gorge = (x, y) => (Math.abs(x) > 60 ? 100 : y < 0 ? 70 : Math.abs(x) * 0.3);   // lake to the south at 70 m, the valley north
const axisOf = (d, n = 31) => { d.axis = Array.from({ length: n }, (_, i) => [-60 + (i * 120) / (n - 1), 0]); d.half = 2; return d; };
const built = (d, g = gorge) => { const m = recorder(); const kind = buildDam(m, d, g); return { kind, pts: m.tris.flatMap(([, v]) => v), mats: new Set(m.tris.map(([mat]) => mat)) }; };

test('a gravity dam mapped as its footprint: the air face runs straight from the crest edge to the footprint\'s edge', async () => {
  const { planDams } = await import('../services/dams.js');
  // 120 m long, its footprint from 4 m on the water side to 60 m on the air side
  const [d] = planDams([feat([[-60, -4], [60, -4], [60, 60], [-60, 60], [-60, -4]], { waterway: 'dam' })], project, { groundAt: gorge });
  const { kind, pts } = built(axisOf(d));
  assert.equal(kind, 'concrete dam');
  assert.equal(d.crest, 70, 'the crest at the lake side\'s ground');
  const mid = pts.filter((p) => Math.abs(p[0]) < 6);
  assert.ok(Math.max(...mid.map((p) => p[1])) > 50, 'its foot out near the footprint\'s edge');
  // (half way down, about half way out: a straight batter, no hollow curve)
  const half = mid.filter((p) => Math.abs(p[2] - 35) < 2 && p[1] > 5).map((p) => p[1]);
  assert.ok(half.length && Math.min(...half) > 27 && Math.max(...half) < 36, `half way down ${[...new Set(half.map((v) => v.toFixed(0)))]}`);
  assert.ok(pts.every((p) => p[1] > -4.5), 'the water side at the crest edge');
});

test('a fill dam: several times as wide as high, a slope on both sides, not concrete', async () => {
  const { planDams, damKind } = await import('../services/dams.js');
  const low = (x, y) => (Math.abs(x) >= 60 ? 20 : y < 0 ? 8 : 0);   // a 20 m dam, the lake's bed 8 m up
  const [d] = planDams([feat([[-60, -45], [60, -45], [60, 55], [-60, 55], [-60, -45]], { waterway: 'dam' })], project, { groundAt: low });
  const { kind, pts, mats } = built(axisOf(d), low);
  assert.equal(kind, 'fill dam'); assert.deepEqual([...mats], ['stone']);
  assert.ok(pts.some((p) => p[1] < -30) && pts.some((p) => p[1] > 40), 'slopes out to both edges of the footprint');
  assert.equal(damKind({ tags: { material: 'earth' }, gap: 30 }), 'fill');
  assert.equal(damKind({ tags: { start_date: '1912' }, gap: 60 }), 'masonry');
  assert.equal(damKind({ tags: {}, gap: 60 }), 'concrete');
});

test('a dam nothing crosses gets a crest line: its own line, or the middle of its footprint', async () => {
  const { planDams, assignDamAxes, ringCentreline } = await import('../services/dams.js');
  const line = planDams([feat([[-60, 0], [0, 6], [60, 0]], { waterway: 'dam' })], project, { groundAt: gorge });
  const area = planDams([feat([[-60, -4], [60, -4], [60, 30], [-60, 30], [-60, -4]], { waterway: 'dam' })], project, { groundAt: gorge });
  const graph = { dams: [...line, ...area], classes: { segments: [] }, edges: [] };
  assignDamAxes(graph);
  assert.equal(line[0].axisFrom, 'line'); assert.equal(line[0].axis.length, 3);
  assert.equal(area[0].axisFrom, 'outline');
  assert.ok(area[0].axis.every(([, y]) => Math.abs(y - 13) < 0.5), 'down the middle of the footprint');
  assert.ok(area[0].half > 0 && area[0].half <= 4);
  // a curved footprint: a curved line
  const arc = []; for (let a = 30; a <= 150; a += 10) arc.push([100 * Math.cos((a * Math.PI) / 180), 100 * Math.sin((a * Math.PI) / 180)]);
  const ring = [...arc, ...arc.slice().reverse().map(([x, y]) => [x * 0.9, y * 0.9])];
  const c = ringCentreline(ring);
  assert.ok(c.length > 5 && c.every(([x, y]) => Math.abs(Math.hypot(x, y) - 95) < 4), 'follows the arc');
});

test('a path over a dam is its crest when it runs most of the dam\'s length', async () => {
  const { planDams, assignDamAxes } = await import('../services/dams.js');
  const [d] = planDams([feat([[-60, -4], [60, -4], [60, 30], [-60, 30], [-60, -4]], { waterway: 'dam' })], project, { groundAt: gorge });
  const graph = { dams: [d], classes: { segments: [] }, edges: [] };
  assignDamAxes(graph, [{ nodes: [[-80, 0], [-50, 0], [0, 0], [50, 0], [80, 0]], half: 1.2 }, { nodes: [[0, -20], [0, 0], [0, 50]], half: 1 }]);
  assert.equal(d.axisFrom, 'way'); assert.equal(d.half, 1.2);
  assert.ok(d.axis.every(([, y]) => y === 0));
});

test('a crest comes to its banks\' ground at both ends: no kerb across the road', async () => {
  const { planDams, assignDamAxes, settleDamEnds, crestZAlong, damTopGeometry } = await import('../services/dams.js');
  const [d] = planDams([feat([[-60, -4], [60, -4], [60, 30], [-60, 30], [-60, -4]], { waterway: 'dam' })], project, { groundAt: gorge });
  assignDamAxes({ dams: [d], classes: { segments: [] }, edges: [] }, [{ nodes: [[-80, 0], [-58, 0], [0, 0], [58, 0], [80, 0]], half: 2 }]);
  d.crest = 100.3;   // (the banks 0.3 m under the crest)
  const bank = (x, y) => (Math.abs(x) > 55 ? 100 : gorge(x, y));
  settleDamEnds([d], bank);
  assert.ok(Math.abs(d.endZ[0] - 99.96) < 1e-6 && Math.abs(d.endZ[1] - 99.96) < 1e-6, 'the ends just under the ground');
  assert.equal(crestZAlong(d, 58, 116), 100.3, 'the crest in the middle');
  let last = d.endZ[0];
  for (let s = 0; s <= 10; s += 0.5) { const z = crestZAlong(d, s, 116); assert.ok(z >= last - 1e-9 && z - last < 0.05, 'a gentle ramp'); last = z; }
  const top = damTopGeometry(d); const zs = top.positions.filter((_, k) => k % 3 === 2);
  assert.ok(Math.max(...zs) === 100.3 && zs.some((z) => Math.abs(z - 99.96) < 1e-6), 'the top follows it');
  // an end far from the crest's height is no bank: left at the crest
  settleDamEnds([d], gorge); assert.deepEqual(d.endZ, [100.3, 100.3]);
});

test('a face from a ragged footprint is one smooth batter along the dam', async () => {
  const { planDams } = await import('../services/dams.js');
  // the footprint's air edge jumps between 40 and 60 m out every 12 m
  const edge = []; for (let x = 60; x >= -60; x -= 12) edge.push([x, (x / 12) % 2 ? 40 : 60]);
  const [d] = planDams([feat([[-60, -4], [60, -4], ...edge, [-60, -4]], { waterway: 'dam' })], project, { groundAt: gorge });
  const { pts } = built(axisOf(d, 61));
  // half way down, between the abutments: the face's distance out changes little from slice to slice
  const row = new Map();
  for (const q of pts) if (Math.abs(q[2] - 49) < 1.6 && q[1] > 5 && Math.abs(q[0]) < 30) row.set(Math.round(q[0] / 2), Math.max(row.get(Math.round(q[0] / 2)) || 0, q[1]));
  const ys = [...row.entries()].sort((a, b) => a[0] - b[0]).map(([, y]) => y);
  assert.ok(ys.length > 20);
  for (let i = 1; i < ys.length; i++) assert.ok(Math.abs(ys[i] - ys[i - 1]) < 0.6, `no crease: ${ys.map((v) => v.toFixed(1))}`);
});
