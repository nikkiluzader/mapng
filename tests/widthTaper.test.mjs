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

test('unnamed pieces of one road, or pieces sharing a ref, taper too (coverage level, 2026-11-24)', () => {
  const wide = { name: '', cls: 'primary', half: 7, xy: line(-100, 0) };
  const narrow = { name: '', cls: 'primary', half: 5.5, xy: line(0, 100) };
  assert.ok(findWidthTapers([wide, narrow]).has(0), 'two unnamed pieces of the same class');
  assert.equal(findWidthTapers([wide, { ...narrow, cls: 'service' }]).size, 0, 'not between an unnamed road and a different class');
  assert.equal(findWidthTapers([wide, { ...narrow, name: 'Main' }]).size, 0, 'not between an unnamed piece and a named street');
  assert.ok(findWidthTapers([{ ...wide, name: 'A', ref: 'SR 9' }, { ...narrow, name: 'B', ref: 'SR 9' }]).has(0), 'a numbered road changing name keeps its taper');
});

test('a lane drop on a fast road eases over far longer than a street\'s curb jog', () => {
  const mk = (cls) => findWidthTapers([{ name: 'R', cls, half: 7, xy: line(-300, 0, 61) }, { name: 'R', cls, half: 5.3, xy: line(0, 300, 61) }]).get(0);
  const reach = (at) => { let x = 0; while (x > -300 && at(x, 0, 7) < 6.99) x -= 1; return -x; };
  // (the eased width is within 1 cm of full a little before the run's end: within 8 % of it)
  const near = (got, want) => Math.abs(got - want) < 0.08 * want + 1;
  assert.ok(near(reach(mk('residential')), 8 * 1.7), 'a street: 8 m per metre');
  assert.ok(near(reach(mk('primary')), 30 * 1.7), 'a primary road: 30 m per metre (MUTCD merge taper)');
  assert.ok(near(reach(mk('motorway')), 50 * 1.7), 'a motorway: 50 m per metre');
});

test('in a taper the lines follow the road: edges onto the narrow edges, the centre line onto the narrow one (coverage level)', () => {
  // a 4-lane piece (line edges +-6.7, centre line at 0) narrowing into a 3-lane piece (line edges +-4.95, its centre
  // line 1.65 m off: two lanes one way, one the other)
  const tapers = findWidthTapers([
    { name: 'R', cls: 'residential', half: 7, lineBase: 0, lineEdge: 6.7, lineCentre: 0, xy: line(-100, 0) },
    { name: 'R', cls: 'residential', half: 5.5, lineBase: 0, lineEdge: 4.95, lineCentre: -1.65, xy: line(0, 100) },
  ]);
  const t = tapers.get(0);
  assert.equal(typeof t.mapOffset, 'function');
  assert.ok(Math.abs(t.mapOffset(0, 0, -6.7) - -4.95) < 1e-6, 'right edge line onto the narrow one');
  assert.ok(Math.abs(t.mapOffset(0, 0, 6.7) - 4.95) < 1e-6, 'left edge line onto the narrow one');
  assert.ok(Math.abs(t.mapOffset(0, 0, 0) - -1.65) < 1e-6, 'centre line onto the narrow centre line');
  assert.ok(Math.abs(t.mapOffset(-60, 0, 3.35) - 3.35) < 1e-6, 'before the taper: unchanged');
  const mid = t.mapOffset(-6, 0, 0);
  assert.ok(mid < 0 && mid > -1.65, 'part way: in between');
});

test('a lane drop: the closing lane\'s divider is cut back by the taper, the kept one lands on the next piece\'s (the user, 2026-11-24)', () => {
  // 4 lanes (2 each way, 3.4 m) narrowing to 3 (1 forward on the negative side, 2 back): a forward lane closes
  const E4 = 6.8; const E3 = 5.1;
  const ways = [
    { name: 'Main', cls: 'primary', half: 7, lineBase: 0, lineEdge: E4, lineCentre: 0, lanes: 4, nF: 2, xy: line(-200, 0) },
    { name: 'Main', cls: 'primary', half: 5.3, lineBase: 0, lineEdge: E3, lineCentre: -E3 + (2 * E3) / 3, lanes: 3, nF: 1, xy: line(0, 200) },
  ];
  const t = findWidthTapers(ways).get(0);
  const div = (E, n, k) => -E + (2 * E * k) / n;
  // the forward divider (k = 1 of 4) closes: cut back at the joint end by the run, never moved
  const drop = t.dropTrim(div(E4, 4, 1));
  assert.ok(drop.end > 20 && drop.start === 0, `cut back ${drop.end} m`);
  assert.equal(t.mapOffset(-1, 0, div(E4, 4, 1)), div(E4, 4, 1));
  // the backward divider (k = 3 of 4) goes on: onto the narrow piece's k = 2 of 3 at the joint, not cut
  assert.deepEqual(t.dropTrim(div(E4, 4, 3)), { start: 0, end: 0 });
  assert.ok(Math.abs(t.mapOffset(0, 0, div(E4, 4, 3)) - div(E3, 3, 2)) < 1e-6);
  // edges and centre: as before (not dividers)
  assert.deepEqual(t.dropTrim(E4), { start: 0, end: 0 });
});
