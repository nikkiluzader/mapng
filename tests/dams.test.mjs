import test from 'node:test';
import assert from 'node:assert/strict';
import { planDams, buildDam } from '../services/dams.js';

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
  assert.ok(m.tris.some(([mat]) => mat === 'smoothConcrete'), 'a crest top');
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
