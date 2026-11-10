// Roads are drawn to about 15 m from the map's edge whatever the map's size
// (as a fixed 1.5 % share, a 16 km level lost the last 250 m of every road).
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage ??= { getItem: () => null, setItem() {} };
const { roadEdgeMarginFor } = await import('../services/exportBeamNGLevel.js');

test('the road edge margin is a distance, not a share of the map', () => {
  for (const size of [2048, 4096, 8192, 16384]) {
    const metres = roadEdgeMarginFor(size) * size;
    assert.ok(Math.abs(metres - 15) < 1e-9, `${size} m map: ${metres} m`);
  }
  // (small maps keep the 1.5 % they had)
  assert.equal(roadEdgeMarginFor(1000), 0.015);
  assert.equal(roadEdgeMarginFor(512), 0.015);
  assert.equal(roadEdgeMarginFor(0), 0.015);
});
