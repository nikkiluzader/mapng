import test from 'node:test';
import assert from 'node:assert/strict';
import { findTerrainSteps } from '../services/terrainSteps.js';

// a road on a shelf: ground 3 m higher on one side of a diagonal line, the shaping's doing (the survey flat)
function scene(W = 128) {
  const hm = new Float32Array(W * W); const src = new Float32Array(W * W);
  for (let r = 0; r < W; r++) for (let c = 0; c < W; c++) { const x = c - W / 2; const y = W - 1 - r - W / 2; hm[r * W + c] = (y > x * 0.6 + 4) ? 103 : 100; src[r * W + c] = 100; }
  return { hm, src, W };
}

test('a shaped step beside a road comes out as one straight wall line', () => {
  const { hm, src, W } = scene();
  const roads = [{ nodes: [[-40, -24], [40, 24]], half: 3 }];
  const lines = findTerrainSteps({ heightMap: hm, width: W, height: W, minHeight: 0 }, 1, roads, { source: src });
  assert.ok(lines.length >= 1);
  const long = lines.reduce((a, l) => (l.length && Math.hypot(l.at(-1)[0] - l[0][0], l.at(-1)[1] - l[0][1]) > Math.hypot(a.at(-1)[0] - a[0][0], a.at(-1)[1] - a[0][1]) ? l : a));
  assert.ok(Math.hypot(long.at(-1)[0] - long[0][0], long.at(-1)[1] - long[0][1]) > 30);
  assert.ok(long.length <= 6, `straightened (${long.length} points)`);
  for (const [x, y] of long) assert.ok(Math.abs(y - (x * 0.6 + 4)) < 1.2, `on the step (${x}, ${y})`);
});

test('a step already in the survey is not walled', () => {
  const { hm, W } = scene();
  const lines = findTerrainSteps({ heightMap: hm, width: W, height: W, minHeight: 0 }, 1, [{ nodes: [[-40, -24], [40, 24]], half: 3 }], { source: hm });
  assert.equal(lines.length, 0);
});

test('a step far from any road is not walled', () => {
  const { hm, src, W } = scene();
  const lines = findTerrainSteps({ heightMap: hm, width: W, height: W, minHeight: 0 }, 1, [{ nodes: [[-60, 50], [-50, 60]], half: 3 }], { source: src });
  assert.equal(lines.length, 0);
});
