import test from 'node:test';
import assert from 'node:assert/strict';
import { findCarriagewaySplits, splitShiftAt } from '../services/carriagewaySplits.js';

// a two-way road from the south to (0, 0), splitting into a northbound branch (east) and a southbound one (west)
const line = (pts) => pts.map(([x, y]) => [x, y]);
const trunk = { xy: line([[0, -100], [0, -50], [0, 0]]), oneway: 0, half: 7 };
const north = { xy: line([[0, 0], [2, 20], [8, 40], [10, 100]]), oneway: 1, half: 3.5 };          // leaves the split
const south = { xy: line([[-10, 100], [-8, 40], [-2, 20], [0, 0]]), oneway: 1, half: 3.5 };       // comes to it

test('a two-way road dividing into two one-way carriageways is a split, each branch shifted to its driving side', () => {
  const { plans, points } = findCarriagewaySplits([trunk, north, south]);
  assert.equal(points.length, 1);
  const pn = plans.get(1); const ps = plans.get(2);
  // northbound (node order north): its right is east = right of node order: shift negative (left is +)
  assert.equal(pn.sign, -1); assert.ok(pn.atStart);
  // southbound drawn toward the split (node order south): its right is west = right of node order: negative too
  assert.equal(ps.sign, -1); assert.ok(!ps.atStart);
  // at the split each branch's line sits a half width off the centre, gone by the end of its run
  assert.ok(Math.abs(splitShiftAt(pn, 0, 0) + 3.5) < 1e-9);
  assert.equal(splitShiftAt(pn, 10, 100), 0);
  assert.ok(pn.L >= 12 && pn.L <= 60);
});

test('left-hand traffic shifts the other way; one-way branches both leaving, or a fork of two-way roads, are no split', () => {
  // (left-hand traffic: the northbound carriageway lies to the west, as mapped; each branch moves to the side its own
  // line goes to)
  const mirror = (w) => ({ ...w, xy: w.xy.map(([x, y]) => [-x, y]) });
  assert.equal(findCarriagewaySplits([trunk, mirror(north), mirror(south)], { leftHand: true }).plans.get(1).sign, 1);
  const bothLeave = { ...south, xy: [...south.xy].reverse() };
  assert.equal(findCarriagewaySplits([trunk, north, bothLeave]).points.length, 0);
  assert.equal(findCarriagewaySplits([trunk, { ...north, oneway: 0 }, { ...south, oneway: 0 }]).points.length, 0);
  // a side road at right angles is a junction, not a branch
  const side = { xy: line([[0, 0], [60, 0]]), oneway: 1, half: 3.5 };
  assert.equal(findCarriagewaySplits([trunk, side, south]).points.length, 0);
});

test('a side road joining at the split point keeps its junction; the split is still a split', () => {
  const side = { xy: [[0, 0], [-60, 10]], oneway: 0, half: 3 };
  const { points } = findCarriagewaySplits([trunk, north, south, side]);
  assert.equal(points.length, 1);
  assert.equal(points[0].branches.length, 2);
  // a fourth road carrying straight on is no side road: no split
  const straight = { xy: [[0, 0], [0, 80]], oneway: 0, half: 3 };
  assert.equal(findCarriagewaySplits([trunk, north, south, straight]).points.length, 0);
});

test('a trunk wider than its two branches together is narrowed to them at the split', async () => {
  const { splitTaperAt } = await import('../services/carriagewaySplits.js');
  const wide = { ...trunk, half: 10.5 };   // 6 lanes into 2 + 2
  const { tapers } = findCarriagewaySplits([wide, north, south]);
  const t = tapers.get(0);
  assert.ok(t && Math.abs(t.target - 7) < 1e-9);
  assert.ok(Math.abs(splitTaperAt(t, 0, 0, 10.5) - 7) < 1e-9, 'at the split: the branches\' width');
  assert.equal(splitTaperAt(t, 0, -90, 10.5), 10.5);
  assert.equal(findCarriagewaySplits([trunk, north, south]).tapers.size, 0, 'no taper where the widths agree');
});

test('a one-way road forking into two one-way roads shares out its lanes: the left branch on the left lanes', () => {
  const t4 = { xy: line([[0, -100], [0, 0]]), oneway: 1, half: 7, cls: 'primary' };                         // 4 lanes north
  const l2 = { xy: line([[0, 0], [-2, 20], [-9, 40], [-9, 100]]), oneway: 1, half: 3.5, cls: 'primary' };     // 2 lanes, left
  const r2 = { xy: line([[0, 0], [2, 20], [9, 40], [9, 100]]), oneway: 1, half: 3.5, cls: 'primary' };        // 2 lanes, right
  const { plans, points } = findCarriagewaySplits([t4, l2, r2]);
  assert.equal(points.length, 1);
  // at the fork the left branch's line sits (7 - 3.5) left of the axis (its node order runs north: left is +)
  assert.ok(Math.abs(splitShiftAt(plans.get(1), 0, 0) - 3.5) < 1e-9);
  assert.ok(Math.abs(splitShiftAt(plans.get(2), 0, 0) + 3.5) < 1e-9);
  // the same pair joining into one road going north
  const lj = { xy: line([[-9, -100], [-9, -40], [-2, -20], [0, 0]]), oneway: 1, half: 3.5, cls: 'primary' };
  const rj = { xy: line([[9, -100], [9, -40], [2, -20], [0, 0]]), oneway: 1, half: 3.5, cls: 'primary' };
  const out = { xy: line([[0, 0], [0, 100]]), oneway: 1, half: 7, cls: 'primary' };
  const m = findCarriagewaySplits([out, lj, rj]);
  assert.equal(m.points.length, 1);
  // drawn toward the point (node order north, the way on from the trunk is south): left of travel is west
  assert.ok(splitShiftAt(m.plans.get(1), 0, 0) * 1 > 0, 'the western branch moves west');
});

test('a motorway exit (a slip road leaving) is no lane share: left to the slip road rules', () => {
  const m = { xy: line([[0, -100], [0, 0]]), oneway: 1, half: 7, cls: 'motorway' };
  const on = { xy: line([[0, 0], [-2, 40], [-3, 100]]), oneway: 1, half: 5.5, cls: 'motorway' };
  const exit = { xy: line([[0, 0], [3, 40], [12, 100]]), oneway: 1, half: 3, cls: 'motorway_link' };
  assert.equal(findCarriagewaySplits([m, on, exit]).points.length, 0);
});


test('branches wider together than the trunk: each starts as its share, the seam held, the lane lines carried on', async () => {
  const { splitHalfAt } = await import('../services/carriagewaySplits.js');
  // a 6-lane two-way trunk (3.5 m lanes, 0.5 m edge strips: half 11) into two 3-lane carriageways each with edge strips
  // both sides (half 5.75): together 23 m against the trunk's 22
  const t6 = { xy: line([[0, -100], [0, 0]]), oneway: 0, half: 11, drive: 10.5, lanes: 6 };
  const n3 = { xy: line([[0, 0], [2, 20], [8, 40], [10, 100]]), oneway: 1, half: 5.75, drive: 5.25, lanes: 3 };
  const s3 = { xy: line([[-10, 100], [-8, 40], [-2, 20], [0, 0]]), oneway: 1, half: 5.75, drive: 5.25, lanes: 3 };
  const { plans } = findCarriagewaySplits([t6, n3, s3]);
  const pn = plans.get(1); const ps = plans.get(2);
  // each starts 11/2 wide: three trunk lanes and the trunk's outer strip; middles 5.5 m off the axis, the seam on it
  assert.ok(Math.abs(pn.s0 - 5.5) < 1e-9 && Math.abs(ps.s0 - 5.5) < 1e-9, `shares ${pn.s0} ${ps.s0}`);
  assert.ok(Math.abs(splitShiftAt(pn, 0, 0) + 5.5) < 1e-9, 'northbound middle 5.5 m east at the split');
  assert.ok(Math.abs(splitHalfAt(pn, 0, 0, 5.75) - 5.5) < 1e-9, 'its half there: its share');
  assert.equal(splitHalfAt(pn, 10, 100, 5.75), 5.75, 'its own width once apart');
  // the seam held: inner edge (middle minus half) never past the axis along the run
  for (let y = 0; y <= pn.L; y += 2) {
    const x = Math.min(10, y < 20 ? y * 0.1 : y < 40 ? 2 + (y - 20) * 0.3 : 8 + (y - 40) / 30);
    const mid = x - splitShiftAt(pn, x, y);
    const half = splitHalfAt(pn, x, y, 5.75);
    assert.ok(mid - half > -0.05, `seam crossed at y=${y}: ${mid - half}`);
  }
});
