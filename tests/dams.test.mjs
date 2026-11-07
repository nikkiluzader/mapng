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
