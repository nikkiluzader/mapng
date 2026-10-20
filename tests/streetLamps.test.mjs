import test from 'node:test';
import assert from 'node:assert/strict';

import { generateRoadLamps, isLitRoad } from '../services/streetLamps.js';

// East–west street along y = 0 from x = -200 to 200, nodes every 10 m.
const street = (overrides = {}) => ({
  owner: 1, wayId: 'w1', half: 4, highway: 'residential', urban: true, tags: { lit: 'yes' },
  nodes: Array.from({ length: 41 }, (_, i) => [-200 + i * 10, 0, 0, 8]),
  ...overrides,
});

test('which roads are lit', () => {
  assert.equal(isLitRoad({ tags: { lit: 'yes' }, highway: 'residential' }), true);
  assert.equal(isLitRoad({ tags: { lit: 'no' }, highway: 'primary', urban: true }), false);
  assert.equal(isLitRoad({ tags: {}, highway: 'primary', urban: true }), true, 'urban main road, untagged');
  assert.equal(isLitRoad({ tags: {}, highway: 'primary', urban: false }), false, 'rural, untagged');
  assert.equal(isLitRoad({ tags: {}, highway: 'residential', urban: true }), false);
});

test('lamps stand just off the asphalt at a steady spacing, arm toward the road', () => {
  const lamps = generateRoadLamps([street()]);
  assert.ok(lamps.length >= 9 && lamps.length <= 10, `${lamps.length} lamps over 400 m at 40 m`);
  for (const lamp of lamps) {
    assert.ok(Math.abs(Math.abs(lamp.y) - 5) < 1e-6, 'half width 4 m + 1 m setback');
    const arm = [Math.cos(lamp.facing), Math.sin(lamp.facing)];
    assert.ok(arm[1] * Math.sign(lamp.y) < -0.99, 'arm reaches over the road');
  }
  const xs = lamps.map((l) => l.x).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) assert.ok(Math.abs(xs[i] - xs[i - 1] - 40) < 1e-6);
  // Deterministic: the same way gets the same poles.
  assert.deepEqual(generateRoadLamps([street()]), lamps);
});

test('wide roads are lit from both sides; junction mouths and mapped lamps stay clear', () => {
  const wide = generateRoadLamps([street({ half: 7, highway: 'primary' })]);
  assert.ok(wide.some((l) => l.y > 0) && wide.some((l) => l.y < 0));

  const cross = { owner: 2, wayId: 'w2', half: 4, highway: 'residential', urban: true, tags: { lit: 'no' },
    nodes: [[0, -100, 0, 8], [0, 100, 0, 8]] };
  const lamps = generateRoadLamps([street(), cross]);
  assert.ok(lamps.every((l) => Math.abs(l.x) > 4 + 10 - 1e-6), 'no pole within 10 m of the cross street');

  const mapped = generateRoadLamps([street()], [[0, -5]]);
  assert.ok(mapped.every((l) => Math.hypot(l.x, l.y + 5) >= 24), 'no doubling up beside a mapped lamp');
});
