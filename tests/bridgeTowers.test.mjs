import test from 'node:test';
import assert from 'node:assert/strict';
import { findBridgeTowers, towerHouseTags, towerPierGeometry } from '../services/bridgeTowers.js';

// a deck along x at y=0, road 8 m up, half width 3.5; the water under it at 0
const deck = { parts: [{ xy: [[-100, 0], [0, 0], [100, 0]], z: [8, 8, 8], half: 3.5 }] };
const square = (cx, cy, s = 4.5) => [[cx - s / 2, cy - s / 2], [cx + s / 2, cy - s / 2], [cx + s / 2, cy + s / 2], [cx - s / 2, cy + s / 2]];
const outline = { ring: [[-30, -12], [30, -12], [30, 12], [-30, 12]] };

test('a tower house beside the deck inside the bridge outline: at the deck height, on a pier', () => {
  const t = findBridgeTowers({ buildings: [{ f: { tags: { building: 'yes' } }, ring: square(0, 6.5) }], outlines: [outline], decks: [deck], groundAt: () => 0 });
  assert.equal(t.length, 1);
  assert.ok(Math.abs(t[0].top - 8) < 1e-6 && t[0].pier);
  const tags = towerHouseTags(t[0]);
  assert.equal(tags['mapng:base_z'], '8.00');
  assert.equal(tags['building:levels'], '2');
  assert.equal(tags['roof:shape'], 'pyramidal');
  // its mapped height and roof are kept
  const own = towerHouseTags({ ...t[0], f: { tags: { building: 'yes', height: '12', 'roof:shape': 'flat' } } });
  assert.equal(own.height, '12'); assert.equal(own['roof:shape'], 'flat'); assert.equal(own['building:levels'], undefined);
  // the pier: from under the ground up to the deck's road height
  const zs = []; const b = { quad: (...q) => q.slice(0, 4).forEach((p) => zs.push(p[2])) };
  towerPierGeometry(b, t, () => 0);
  assert.ok(Math.min(...zs) < 0 && Math.abs(Math.max(...zs) - 8) < 0.05);
});

test('not a bridge tower: a building beside a viaduct on land, one far off, a big block, a deck on the ground', () => {
  const b = (ring, tags = { building: 'yes' }) => ({ f: { tags }, ring });
  // on land beside the deck, no outline: left alone
  assert.equal(findBridgeTowers({ buildings: [b(square(50, 7))], outlines: [], decks: [deck], groundAt: () => 0 }).length, 0);
  // over water beside the deck (no outline): a tower
  assert.equal(findBridgeTowers({ buildings: [b(square(50, 7))], outlines: [], decks: [deck], groundAt: () => 0, wetAt: () => 1 }).length, 1);
  // inside the outline but 20 m off the deck
  assert.equal(findBridgeTowers({ buildings: [b(square(0, 20))], outlines: [{ ring: [[-30, -30], [30, -30], [30, 30], [-30, 30]] }], decks: [deck], groundAt: () => 0 }).length, 0);
  // a 30 x 30 m block
  assert.equal(findBridgeTowers({ buildings: [b(square(0, 6.5, 30))], outlines: [outline], decks: [deck], groundAt: () => 0 }).length, 0);
  // the deck only 1 m over the ground there
  assert.equal(findBridgeTowers({ buildings: [b(square(0, 6.5))], outlines: [outline], decks: [deck], groundAt: () => 7 }).length, 0);
});
