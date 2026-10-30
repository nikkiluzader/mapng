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
  const routes = buildRoutes(lines);
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
