// exportBeamNGLevel.js cutNodesTo: a chunk's lines cut exactly at its core's edge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cutNodesTo } from '../services/exportBeamNGLevel.js';

const owns = (x) => x < 100;
test('a road across the edge ends exactly on it, its height carried', () => {
  const p = cutNodesTo([[0, 0, 10, 6], [80, 0, 12, 6], [140, 0, 15, 6]], owns);
  assert.equal(p.length, 1); const last = p[0].at(-1);
  assert.ok(Math.abs(last[0] - 100) < 0.01, `${last[0]}`); assert.ok(Math.abs(last[2] - 13) < 0.01, `z ${last[2]}`); assert.equal(last[3], 6);
});
test('in, out, in: two pieces; wholly outside: none', () => {
  assert.equal(cutNodesTo([[0, 0, 0], [150, 0, 0], [150, 50, 0], [0, 50, 0]], owns).length, 2);
  assert.equal(cutNodesTo([[120, 0, 0], [150, 0, 0]], owns).length, 0);
});
