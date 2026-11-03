import test from 'node:test';
import assert from 'node:assert/strict';

import { findWidthTapers } from '../services/exportBeamNGLevel.js';
import { buildSidewalkRuns } from '../services/beamngSidewalks.js';

const line = (x0, x1, n = 21) => Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), 0]);

test('a street wider on one way narrows to the next way over the wider one\'s end', () => {
  const ways = [
    { name: 'Main', half: 7, xy: line(-100, 0) },
    { name: 'Main', half: 5.5, xy: line(0, 100) },
  ];
  const tapers = findWidthTapers(ways);
  assert.ok(tapers.has(0) && !tapers.has(1), 'the wider way only');
  const at = tapers.get(0);
  assert.ok(Math.abs(at(0, 0, 7) - 5.5) < 1e-6, 'the narrower width at the joint');
  assert.ok(Math.abs(at(-12, 0, 7) - 7) < 1e-6, 'its own width 8 m per metre of step back');
  const mid = at(-6, 0, 7);
  assert.ok(mid > 5.5 && mid < 7);
  // not across a junction, under another name, or round a corner
  assert.equal(findWidthTapers([...ways, { name: 'Side', half: 4, xy: [[0, 0], [0, 50]] }]).size, 0);
  assert.equal(findWidthTapers([ways[0], { ...ways[1], name: 'Other' }]).size, 0);
  assert.equal(findWidthTapers([ways[0], { ...ways[1], xy: [[0, 0], [0, 100]] }]).size, 0);
});

test('the curb follows a taper: one run across the joint, no jog', () => {
  const tapers = findWidthTapers([
    { name: 'Main', half: 7, xy: line(-100, 0) },
    { name: 'Main', half: 5.5, xy: line(0, 100) },
  ]);
  const nodes = (x0, x1) => line(x0, x1).map(([x, y]) => [x, y, 5, 0]);
  const wide = { owner: 1, half: 7, highway: 'residential', urban: true, tags: { name: 'Main', sidewalk: 'both' }, continuations: [], nodes: nodes(-100, 0) };
  wide.halfAt = wide.nodes.map(([x, y]) => tapers.get(0)(x, y, 7));
  const narrow = { owner: 2, half: 5.5, highway: 'residential', urban: true, tags: { name: 'Main', sidewalk: 'both' }, continuations: [], nodes: nodes(0, 100) };
  const left = buildSidewalkRuns([wide, narrow]).filter((r) => r.side === 1);
  const across = left.find((r) => r.points.some((p) => p[0] < -5) && r.points.some((p) => p[0] > 5));
  assert.ok(across, `one curb across the joint (${left.length} runs)`);
  const pts = across.points.filter((p) => Math.abs(p[0]) < 30);
  for (let i = 1; i < pts.length; i++) {
    const slope = Math.abs(pts[i][1] - pts[i - 1][1]) / Math.max(1e-6, Math.abs(pts[i][0] - pts[i - 1][0]));
    assert.ok(slope < 0.25, `no jog: (${pts[i - 1][0].toFixed(1)}, ${pts[i - 1][1].toFixed(2)}) -> (${pts[i][0].toFixed(1)}, ${pts[i][1].toFixed(2)})`);
  }
});
