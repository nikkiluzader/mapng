import test from 'node:test';
import assert from 'node:assert/strict';
import { pierSites } from '../services/beamngBridges.js';

test('piers: none through a lower deck\'s lanes (stacked ramps)', () => {
  // an upper deck 20 m up along x; a lower deck 8 m up beside it, 6 m off,
  // whose lanes (half 4) reach under the upper deck's pier feet
  const xy = []; const z = [];
  for (let x = -150; x <= 150; x += 10) { xy.push([x, 0]); z.push(20); }
  const upper = { xy, z, half: 5 };
  const lower = { xy: xy.map(([x]) => [x, 6]), z: z.map(() => 8), half: 4 };
  const groundAt = () => 0;
  const free = pierSites(upper, { groundAt });
  assert.ok(free.length > 3, 'piers when nothing is under it');
  const stacked = pierSites(upper, { groundAt, decks: [lower] });
  for (const p of stacked) assert.ok(Math.abs(p.y - 6) >= 4 + 1.5 + p.pierWidth / 2 - 1e-6, `pier in the lower lanes at ${p.x.toFixed(0)}, ${p.y.toFixed(1)}`);
  // a deck above the pier top is no obstacle (its own neighbour on top)
  const over = { ...lower, z: z.map(() => 30) };
  assert.equal(pierSites(upper, { groundAt, decks: [over] }).length, free.length);
});
