import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseDrive, buildRoutes } from '../scripts/lib/driveAnalysis.mjs';

const straight = (x0, x1, y, z, step = 8) => { const p = []; for (let x = x0; x < x1; x += step) p.push([x, y, z]); p.push([x1, y, z]); return p; };

test('routes: a deck with the road continuing it at both ends, a tunnel, a steep street', () => {
  const lines = [
    { k: 'road', hw: 4, road: 'primary', p: straight(-200, -50, 0, 10) },
    { k: 'deck', hw: 4, road: 'primary', p: straight(-50, 50, 0, 10) },
    { k: 'road', hw: 4, road: 'primary', p: straight(50, 200, 0, 10) },
    { k: 'tunnel', hw: 4, road: 'secondary', p: straight(-100, 100, 300, -5) },
    { k: 'road', hw: 3, road: 'residential', p: straight(-100, 0, -300, 0).map(([x, y], i) => [x, y, i * 1.2]) },
    { k: 'sidewalk', w: 2, p: straight(-50, 50, 6, 10) },
  ];
  const routes = buildRoutes(lines, { kinds: ['deck', 'tunnel', 'steep'] });
  const deck = routes.find((r) => r.kind === 'deck');
  assert.ok(deck, 'deck route');
  assert.ok(deck.points[0][0] <= -110 && deck.points[deck.points.length - 1][0] >= 110, 'approaches either side');
  assert.equal(deck.speed, 16);
  assert.ok(routes.some((r) => r.kind === 'tunnel'), 'tunnel route');
  assert.ok(routes.some((r) => r.kind === 'steep'), 'steep street (15 %)');
});

test('drive analysis: a smooth drive passes; a step, a fall and getting stuck are caught', () => {
  const route = { points: straight(0, 200, 0, 10), half: 4 };
  const smooth = [];
  for (let t = 0; t <= 14; t += 0.02) smooth.push({ t, x: t * 15, y: 0, z: 10.5, vx: 15, vy: 0, vz: 0 });
  const ok = analyseDrive(route, smooth);
  assert.equal(ok.completed, true);
  assert.deepEqual(ok.events, []);
  // a 0.4 m step at x 100: the car is thrown up, then lands
  const step = smooth.map((s) => ({ ...s }));
  for (const s of step) if (s.x >= 100 && s.x < 101.5) s.vz = 6;
  const bumpy = analyseDrive(route, step);
  assert.ok(bumpy.events.some((e) => e.type === 'bump' && Math.abs(e.x - 100) < 5), JSON.stringify(bumpy.events));
  // fell through at x 120, stopped there
  const fall = smooth.filter((s) => s.x < 120).concat(Array.from({ length: 400 }, (_, i) => ({ t: 8 + i * 0.02, x: 120, y: 0, z: 2, vx: 0, vy: 0, vz: 0 })));
  const fell = analyseDrive(route, fall);
  assert.ok(fell.events.some((e) => e.type === 'fell'));
  assert.ok(fell.events.some((e) => e.type === 'stuck'));
  assert.equal(fell.completed, false);
});

test('impact side: from the sharpest change of velocity, in the car\'s frame', async () => {
  const { impactOf } = await import('../scripts/lib/driveAnalysis.mjs');
  // driving north at 12 m/s, then stopped dead (front), shoved east (hit on
  // its left), thrown up (underside)
  const run = (after) => {
    const out = [];
    for (let t = 0; t < 3; t += 0.02) out.push({ t, x: 0, y: t * 12, z: 0, vx: 0, vy: 12, vz: 0 });
    for (let t = 3; t < 4; t += 0.02) out.push({ t, x: 0, y: 36, z: 0, ...after });
    return out;
  };
  assert.equal(impactOf(run({ vx: 0, vy: 0, vz: 0 })).where, 'front');
  assert.equal(impactOf(run({ vx: 9, vy: 12, vz: 0 })).where, 'left side');
  assert.equal(impactOf(run({ vx: -9, vy: 12, vz: 0 })).where, 'right side');
  assert.equal(impactOf(run({ vx: 0, vy: 12, vz: 6 })).where, 'underside');
  assert.equal(impactOf(run({ vx: 0, vy: 12, vz: 0 })), null, 'no impact');
});

test('routes stay clear of the map edge (room to stop)', () => {
  const lines = [
    { k: 'road', hw: 4, road: 'primary', p: [[-100, 0, 10], [-50, 0, 10]] },
    { k: 'deck', hw: 4, road: 'primary', p: [[-50, 0, 10], [0, 0, 10], [50, 0, 10]] },
    { k: 'road', hw: 4, road: 'primary', p: [[50, 0, 10], [80, 0, 10], [110, 0, 10], [128, 0, 10]] },
  ];
  const [r] = buildRoutes(lines, { worldSize: 256 });
  assert.ok(r.points.every((q) => Math.abs(q[0]) <= 128 - 60), JSON.stringify(r.points.map((q) => q[0])));
  assert.ok(r.points.some((q) => q[0] <= -50) && r.points.some((q) => q[0] >= 50), 'the deck kept whole');
});

test('turn routes: through a street grid, turning at junctions, slower through each turn', () => {
  // a 100 m grid of residential streets, one line per block side
  const lines = [];
  for (let i = -3; i <= 3; i++) for (let j = -3; j < 3; j++) {
    lines.push({ k: 'road', hw: 3, road: 'residential', p: [[i * 100, j * 100, 0], [i * 100, j * 100 + 50, 0], [i * 100, (j + 1) * 100, 0]] });
    lines.push({ k: 'road', hw: 3, road: 'residential', p: [[j * 100, i * 100, 0], [j * 100 + 50, i * 100, 0], [(j + 1) * 100, i * 100, 0]] });
  }
  const routes = buildRoutes(lines, { kinds: ['turns'], max: 6 });
  assert.ok(routes.length >= 2, `turn routes: ${routes.length}`);
  for (const r of routes) {
    assert.equal(r.kind, 'turns');
    assert.ok(r.turns >= 2, `turns ${r.turns}`);
    assert.ok(r.speeds.some((v) => v < r.speed), 'slower through the turns');
  }
  // spread apart
  const mids = routes.map((r) => r.points[r.points.length >> 1]);
  for (let a = 0; a < mids.length; a++) for (let b = a + 1; b < mids.length; b++) assert.ok(Math.hypot(mids[a][0] - mids[b][0], mids[a][1] - mids[b][1]) >= 150);
});

test('tunnels: driven both ways, twin bores each', () => {
  const lines = [
    { k: 'tunnel', hw: 4, road: 'motorway', p: [[-100, 0, 0], [0, 0, 0], [100, 0, 0]] },
    { k: 'tunnel', hw: 4, road: 'motorway', p: [[100, 20, 0], [0, 20, 0], [-100, 20, 0]] },
  ];
  const routes = buildRoutes(lines, { kinds: ['tunnel'], max: 8 });
  assert.equal(routes.length, 4, routes.map((r) => r.points[0][0]).join(' '));
});
