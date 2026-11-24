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
