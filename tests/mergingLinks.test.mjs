import test from 'node:test';
import assert from 'node:assert/strict';
import { mergingLinks, keptThroughMerge } from '../services/mergingLinks.js';

// a four-lane street along +y, 20 m wide, drawn as one line down its middle (as OSM maps it)
const street = { owner: 1, highway: 'primary', oneWay: false, half: 10, nodes: [[0, -100, 0], [0, 100, 0]] };
const link = (nodes, extra = {}) => ({ owner: 2, highway: 'primary_link', oneWay: true, half: 3, nodes, ...extra });

test('a slip road joining a wider street at a shallow angle merges into it', () => {
  // from the east, curving north, ending on the street's centre line at 20 degrees to it
  const m = mergingLinks([street, link([[40, -60, 0], [20, -30, 0], [7, 0, 0], [0, 20, 0]])]);
  assert.deepEqual([...m.get(1)], [2]);
  // the same link leaving the street (its first point on the centre line)
  const out = mergingLinks([street, link([[0, 20, 0], [7, 40, 0], [20, 70, 0]])]);
  assert.deepEqual([...out.get(1)], [2]);
});

test('a link that meets the street square on, or a road that is no link, is a junction as ever', () => {
  assert.equal(mergingLinks([street, link([[60, 0, 0], [0, 0, 0]])]).size, 0, 'at 90 degrees: it crosses the lanes');
  assert.equal(mergingLinks([street, link([[40, -60, 0], [7, 0, 0], [0, 20, 0]], { highway: 'tertiary' })]).size, 0, 'a side street');
  assert.equal(mergingLinks([street, link([[40, -60, 0], [7, 0, 0], [0, 20, 0]], { oneWay: false })]).size, 0, 'a two-way link');
  assert.equal(mergingLinks([street, link([[40, -60, 0], [7, 0, 0], [0, 20, 0]], { half: 12 })]).size, 0, 'wider than the street');
  assert.equal(mergingLinks([street, link([[80, -60, 0], [60, 0, 0], [50, 20, 0]])]).size, 0, 'ends off the street');
});

test('only the lines between lanes are kept through a merge', () => {
  assert.equal(keptThroughMerge('line_sep_2'), true);
  assert.equal(keptThroughMerge('line_center'), true);
  assert.equal(keptThroughMerge('line_right'), false, 'the edge line is cut at the slip road\'s mouth');
  assert.equal(keptThroughMerge('edge_left'), false);
});

import { mergingLinkEnds, cutAtOuterLane } from '../services/mergingLinks.js';

test('a merging slip road\'s surface ends at the outer lane; the rest to the mapped node is the hidden part', () => {
  const slip = link([[40, -60, 0, 6], [20, -30, 0, 6], [7, 0, 0, 6], [0, 20, 0, 6]]);
  const ends = mergingLinkEnds([street, slip]);
  assert.deepEqual(ends.map((e) => [e.link, e.road, e.end, e.atRoadEnd]), [[2, 1, 1, false]]);
  const parts = cutAtOuterLane(slip.nodes, 1, [street.nodes], street.half - slip.half);
  // the cut is where the slip road's centre is 7 m from the street's centre line: at the point (7, 0)
  const P = parts.visible[parts.visible.length - 1];
  assert.ok(Math.abs(P[0] - 7) < 0.3, `cut at x ${P[0].toFixed(2)}`);
  assert.deepEqual(parts.hidden[parts.hidden.length - 1].slice(0, 2), [0, 20], 'the hidden part reaches the mapped node');
  assert.deepEqual(parts.hidden[0].slice(0, 2), P.slice(0, 2), 'and starts where the surface ends');
  assert.equal(parts.visible[0][0], 40, 'the surface keeps its own start');
  // a slip road leaving the street (its first point on the centre line): the same, mirrored
  const out = link([[0, 20, 0, 6], [7, 40, 0, 6], [20, 70, 0, 6]]);
  const po = cutAtOuterLane(out.nodes, 0, [street.nodes], 7);
  assert.deepEqual(po.hidden[0].slice(0, 2), [0, 20]); assert.ok(Math.abs(po.visible[0][0] - 7) < 0.3);
});

test('a link meeting the street at the street\'s own end is marked: nothing to cut there', () => {
  const stub = { owner: 1, highway: 'tertiary', oneWay: false, half: 8, nodes: [[0, 0, 0], [0, 80, 0]] };
  const slip = link([[30, -40, 0, 6], [8, -12, 0, 6], [0, 0, 0, 6]]);
  const ends = mergingLinkEnds([stub, slip]);
  assert.equal(ends.length, 1); assert.equal(ends[0].atRoadEnd, true);
  // the same street mapped as two ways end to end at that point: no end of the street, a merge part-way along it
  const before = { owner: 3, highway: 'tertiary', oneWay: false, half: 8, nodes: [[0, -80, 0], [0, 0, 0]] };
  const mid = mergingLinkEnds([stub, before, slip]);
  assert.equal(mid.length, 1); assert.equal(mid[0].atRoadEnd, false);
  // a narrower road carrying on from there (the wide street starts at the point): still its end
  const narrow = { owner: 4, highway: 'tertiary', oneWay: false, half: 4, nodes: [[0, -80, 0], [0, 0, 0]] };
  assert.equal(mergingLinkEnds([stub, narrow, slip])[0].atRoadEnd, true);
});

import { fanInShift } from '../services/mergingLinks.js';

// Where links fan in to a wide street's end, each one swings out to the street's outer lane on its own side: its end
// lands (street half - link half) off the centre line, and far from the street nothing moves.
test('a link meeting a wide street at its end is moved out to the outer lane, fading out along the link', () => {
  const streetNodes = [[0, 0, 0], [0, 80, 0]];                         // the street runs north from the meeting point
  const east = [[40, -50, 0], [20, -30, 0], [6, -12, 0], [0, 0, 0]];   // a link arriving from the south-east
  const move = fanInShift(east, 1, streetNodes, 5);
  const end = move(0, 0);
  assert.ok(Math.abs(end[0] - 5) < 1e-6 && Math.abs(end[1]) < 1e-6, `the end lands 5 m out on the link's own side: ${end}`);
  const far = move(40, -50);
  assert.ok(Math.abs(far[0] - 40) < 1e-6 && Math.abs(far[1] + 50) < 1e-6, 'past the ease length nothing moves');
  const mid = move(6, -12);
  assert.ok(mid[0] > 6 && mid[0] < 11, `part-way, part of the move: ${mid[0].toFixed(2)}`);
  // the mirror image arrives from the south-west and goes the other way
  const west = east.map(([x, y, z]) => [-x, y, z]);
  assert.ok(Math.abs(fanInShift(west, 1, streetNodes, 5)(0, 0)[0] + 5) < 1e-6);
  // a link coming in along the street's own axis has no side to take
  assert.equal(fanInShift([[0, -60, 0], [0, 0, 0]], 1, streetNodes, 5), null);
});
