import test from 'node:test';
import assert from 'node:assert/strict';

import { miniRoundaboutTriangles, miniRoundaboutDiameter, MINI_ROUNDABOUT_DOME_M } from '../services/miniRoundabouts.js';
import { parseOverpassResponse } from '../services/osm.js';

test('a mini roundabout node is read, and its centre is a low dome flush with the road at its rim', () => {
  const f = parseOverpassResponse({ elements: [{ type: 'node', id: 5, lat: 0.5, lon: 0.5, tags: { highway: 'mini_roundabout' } }] }, { north: 1, south: 0, east: 1, west: 0 });
  assert.equal(f.filter((x) => x.type === 'mini_roundabout').length, 1);
  assert.equal(miniRoundaboutDiameter({}), 4); assert.equal(miniRoundaboutDiameter({ diameter: '3' }), 3); assert.equal(miniRoundaboutDiameter({ diameter: '40' }), 4);
  const tris = miniRoundaboutTriangles({ x: 10, y: 20, z: 5, diameter: 4 });
  const pts = tris.flat();
  const r = (p) => Math.hypot(p[0] - 10, p[1] - 20);
  assert.ok(pts.every((p) => r(p) <= 2 + 1e-6), 'within its 4 m');
  const rim = pts.filter((p) => r(p) > 1.99); const top = Math.max(...pts.map((p) => p[2]));
  assert.ok(rim.every((p) => p[2] < 5.02), 'flush with the road at its rim');
  assert.ok(Math.abs(top - (5 + 0.012 + MINI_ROUNDABOUT_DOME_M)) < 1e-6, 'domed in the middle');
  // facing up
  for (const [A, B, C] of tris) assert.ok((B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]) > 0);
});
