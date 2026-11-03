import test from 'node:test';
import assert from 'node:assert/strict';

import { settleSigns } from '../services/exportBeamNGLevel.js';
import { buildCarriagewayIndex, carriagewaysAt } from '../services/roadMarkingCuts.js';

test('a sign on the drawn road goes off it to the side it stood on; one with no ground beside is left out', () => {
  // a road along x, drawn 5 m each side; a narrow one 13 m off, parallel
  const road = { owner: 1, half: 5, nodes: Array.from({ length: 21 }, (_, i) => [-100 + i * 10, 0, 2, 10]) };
  const index = buildCarriagewayIndex([road]);
  const groundAt = (x) => 3 + x * 0.01;
  const { signs, moved, dropped } = settleSigns([
    { kind: 'stop', shape: 's', position: [0, 3.8, 0], yaw: 0 },     // on the asphalt, right of centre
    { kind: 'stop', shape: 's', position: [10, -4.9, 0], yaw: 0 },   // on it, the other side
    { kind: 'speed', shape: 's', position: [20, 8, 0], yaw: 0 },     // on the verge already
  ], { index, groundAt });
  assert.equal(moved, 2); assert.equal(dropped, 0);
  for (const s of signs) assert.equal(carriagewaysAt(index, s.position[0], s.position[1], 0.59).length, 0, `off the road (${s.position.map((v) => v.toFixed(2))})`);
  assert.ok(signs[0].position[1] > 5 && signs[1].position[1] < -5, 'each to its own side');
  assert.deepEqual(signs[2].position.slice(0, 2), [20, 8], 'one off the road stays put');
  assert.ok(Math.abs(signs[2].position[2] - groundAt(20)) < 1e-9, 'on the ground');
  // a road with another right beside it: nowhere within reach
  const wide = buildCarriagewayIndex([road, { owner: 2, half: 5, nodes: road.nodes.map(([x, , z, w]) => [x, 10.5, z, w]) },
    { owner: 3, half: 5, nodes: road.nodes.map(([x, , z, w]) => [x, -10.5, z, w]) }]);
  assert.equal(settleSigns([{ kind: 'stop', shape: 's', position: [0, 1, 0], yaw: 0 }], { index: wide, groundAt }).dropped, 1);
});

test('parking spots go to the sites file with their turn the other way round (the game mirrors it)', async () => {
  const { siteRotation } = await import('../services/exportBeamNGLevel.js');
  const yaw = -0.5; const ours = [0, 0, Math.sin(yaw / 2), Math.cos(yaw / 2)];
  const out = siteRotation(ours);
  const read = 2 * Math.atan2(out[2], out[3]);
  assert.ok(Math.abs(read + yaw) < 1e-12, 'the game reads -yaw back as yaw');
  assert.deepEqual(siteRotation([0, 0, 0, 1]), [0, 0, 0, 1]);
});
