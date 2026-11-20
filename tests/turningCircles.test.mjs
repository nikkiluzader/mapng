import test from 'node:test';
import assert from 'node:assert/strict';
import { planTurningCircles, turningCircleCarriageway, gradeTurningCircle, bulbHeight, turningCircleRadius, TC_MIN_R, TC_MAX_R } from '../services/turningCircles.js';

// a street along +x ending at (100, 0), climbing 3 %, 4.5 m half width; another street crossing at x = 0
const street = (over = {}) => ({ owner: 7, highway: 'residential', half: 4.5, tags: { highway: 'residential' }, nodes: Array.from({ length: 51 }, (_, i) => [i * 2, 0, i * 2 * 0.03, 4.5]), ...over });
const cross = { owner: 8, highway: 'residential', half: 4, tags: {}, nodes: [[0, -50, 0, 4], [0, 50, 0, 4]] };

test('a turning circle at a dead end becomes a bulb; one at a junction or far from any end does not', () => {
  const cws = [street(), cross];
  const plan = planTurningCircles([{ id: 'a', x: 101, y: 1, tags: { highway: 'turning_circle' } }, { id: 'b', x: 0, y: 0, tags: { highway: 'turning_circle' } }, { id: 'c', x: 50, y: 30, tags: {} }], cws);
  assert.equal(plan.length, 1);
  const tc = plan[0];
  assert.equal(tc.id, 'a');
  assert.deepEqual(tc.c, [100, 0]);
  assert.ok(Math.abs(tc.grade - 0.03) < 1e-9, `grade ${tc.grade}`);
  assert.ok(Math.abs(tc.dir[0] - 1) < 1e-9 && Math.abs(tc.dir[1]) < 1e-9);
  assert.ok(tc.r >= TC_MIN_R && tc.r <= TC_MAX_R, `r ${tc.r}`);
  // a mapped diameter wins
  assert.equal(turningCircleRadius({ diameter: '30' }, 4), 15);
  // the street's grade held to 8 %
  const steep = planTurningCircles([{ id: 's', x: 100, y: 0, tags: {} }], [street({ nodes: Array.from({ length: 51 }, (_, i) => [i * 2, 0, i * 2 * 0.2, 4.5]) })]);
  assert.ok(Math.abs(steep[0].grade - 0.08) < 1e-9);
});

test('the ring covers the disc, runs counter-clockwise from the mouth, and keeps sidewalks to its outer side', () => {
  const [tc] = planTurningCircles([{ id: 'a', x: 100, y: 0, tags: { highway: 'turning_circle' } }], [street({ tags: { highway: 'residential', sidewalk: 'both' } })]);
  const ring = turningCircleCarriageway(tc);
  assert.equal(ring.turningCircle, true);
  assert.equal(ring.owner, 'tc:a');
  assert.equal(ring.tags.sidewalk, 'right');
  // centre line at r/2, half r/2: from the centre to the curb
  for (const nd of ring.nodes) {
    assert.ok(Math.abs(Math.hypot(nd[0] - 100, nd[1]) - tc.r / 2) < 1e-6);
    assert.ok(Math.abs(nd[3] - tc.r / 2) < 1e-9);
    assert.ok(Math.abs(nd[2] - bulbHeight(tc, nd[0], nd[1])) < 1e-9);
  }
  // closed, starting at the mouth (back along the street), turning counter-clockwise
  const [a, b] = ring.nodes; const last = ring.nodes[ring.nodes.length - 1];
  assert.ok(Math.hypot(a[0] - last[0], a[1] - last[1]) < 1e-6);
  assert.ok(a[0] < 100);
  const cross2 = (a[0] - 100) * (b[1] - 0) - (a[1] - 0) * (b[0] - 100);
  assert.ok(cross2 > 0, 'counter-clockwise');
  // a street without sidewalks: none round the bulb
  const [tc2] = planTurningCircles([{ id: 'n', x: 100, y: 0, tags: {} }], [street({ tags: { sidewalk: 'no' } })]);
  assert.equal(turningCircleCarriageway(tc2).tags.sidewalk, 'no');
  // a loop: a ring round an island
  const [tl] = planTurningCircles([{ id: 'l', x: 100, y: 0, tags: { highway: 'turning_loop', diameter: '30' } }], [street()]);
  assert.ok(tl.loop && tl.ri > 0 && tl.ri < tl.r);
  const lr = turningCircleCarriageway(tl);
  assert.ok(Math.abs(Math.hypot(lr.nodes[0][0] - 100, lr.nodes[0][1]) - (tl.r + tl.ri) / 2) < 1e-6);
});

test('the ground under a bulb goes to its plane and blends back to the ground round it', () => {
  const W = 300; const H = 300; const sq = 1; const minHeight = 100;
  const heights = new Float32Array(W * H).fill(minHeight + 5);   // ground 5 m over the bulb's centre
  const hm = { at: (i) => heights[i], set: (i, v) => { heights[i] = v; } };
  const [tc] = planTurningCircles([{ id: 'a', x: 100, y: 0, tags: {} }], [street({ nodes: Array.from({ length: 51 }, (_, i) => [i * 2, 0, 0, 4.5]) })]);
  const n = gradeTurningCircle(tc, { hm, W, H, sq, minHeight });
  assert.ok(n > 0);
  const at = (x, y) => heights[(H - 1 - (y + H / 2)) * W + (x + W / 2)] - minHeight;
  assert.ok(Math.abs(at(100, 0)) < 1e-6, `centre ${at(100, 0)}`);
  assert.ok(Math.abs(at(100 + Math.floor(tc.r), 0)) < 1e-6, 'flat to the curb');
  const mid = at(100 + Math.ceil(tc.r) + 4, 0);
  assert.ok(mid > 0 && mid < 5, `blend ${mid}`);
  assert.ok(Math.abs(at(100 + Math.ceil(tc.r) + 14, 0) - 5) < 1e-6, 'ground left past the blend');
  // a point kept (another road's ground) is left
  heights.fill(minHeight + 5);
  gradeTurningCircle(tc, { hm, W, H, sq, minHeight, keep: (x) => x > 100 + tc.r + 1 });
  assert.equal(at(100 + Math.ceil(tc.r) + 4, 0), 5);
});

test('a bulb with its sidewalk mapped round it (footway=sidewalk) gets none of its own', () => {
  const [tc] = planTurningCircles([{ id: 'a', x: 100, y: 0, tags: {} }], [street({ tags: { highway: 'residential' } })]);
  const loop = Array.from({ length: 24 }, (_, i) => [100 + 16 * Math.cos(i / 4), 16 * Math.sin(i / 4)]);
  assert.equal(turningCircleCarriageway(tc, { mappedWalks: [loop] }).tags.sidewalk, 'no');
  assert.equal(turningCircleCarriageway(tc, { mappedWalks: [[[400, 400], [410, 400]]] }).tags.sidewalk, 'right');
});
