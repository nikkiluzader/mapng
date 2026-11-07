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
  for (const p of stacked) {
    // a straddle bent: a column each side of the lower deck, none in its lanes
    if (p.straddle) {
      for (const off of p.straddle) {
        const cy = p.y + p.u[0] * off;
        assert.ok(Math.abs(cy - 6) >= 4 + 1.5 + 0.8 - 1e-6, `bent column in the lower lanes at ${p.x.toFixed(0)}, ${cy.toFixed(1)}`);
      }
      continue;
    }
    assert.ok(Math.abs(p.y - 6) >= 4 + 1.5 + p.pierWidth / 2 - 1e-6, `pier in the lower lanes at ${p.x.toFixed(0)}, ${p.y.toFixed(1)}`);
  }
  // (the upper deck still stands on something: a double-deck bridge's upper deck floated)
  assert.ok(stacked.length > 3, 'the upper deck keeps its supports over a stacked deck');
  // a deck above the pier top is no obstacle (its own neighbour on top)
  const over = { ...lower, z: z.map(() => 30) };
  assert.equal(pierSites(upper, { groundAt, decks: [over] }).length, free.length);
});

test('piers: a deck stacked over a two-way street on the ground stands on columns between its lanes', () => {
  // an upper street 7 m up along x, 25 m wide (half 12); under it two
  // one-way carriageways on the ground (half 3.5) with a 5 m gap between them
  const xy = []; const z = [];
  for (let x = -150; x <= 150; x += 10) { xy.push([x, 0]); z.push(7); }
  const upper = { xy, z, half: 12 };
  const lane = (y) => { const l = xy.map(([x]) => [x, y, 0]); l.half = 3.5; return l; };
  const roadLines = [lane(-6), lane(6)];
  const sites = pierSites(upper, { groundAt: () => 0, roadLines });
  assert.ok(sites.length > 3, `the upper deck has supports (${sites.length})`);
  for (const p of sites) {
    assert.ok(p.straddle?.length >= 1, 'columns, not a wall pier');
    for (const off of p.straddle) {
      const cy = p.y + p.u[0] * off;
      for (const ly of [-6, 6]) assert.ok(Math.abs(cy - ly) >= 3.5 + 0.6 + 0.8 - 1e-6, `column in the lanes at y ${cy.toFixed(2)}`);
    }
  }
});
