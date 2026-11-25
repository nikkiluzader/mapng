import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRoadHeight } from '../services/pavedSidewalks.js';

test('the road lookup carries a road\'s own curb height (a cycleway\'s flush edge), NaN for the level\'s curb', () => {
  const road = makeRoadHeight([
    { nodes: [[0, 0, 5], [50, 0, 5]], half: 1.25, curbH: 0.03 },
    { nodes: [[0, 40, 6], [50, 40, 6]], half: 3 },
  ]);
  const a = road(25, 2.5); const b = road(25, 44);
  assert.equal(a.curb, 0.03);
  assert.ok(Number.isNaN(b.curb));
  assert.ok(Math.abs(a.d - 1.25) < 1e-9 && Math.abs(b.z - 6) < 1e-9);
});
