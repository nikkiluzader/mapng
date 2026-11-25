import test from 'node:test';
import assert from 'node:assert/strict';
import { pathRailCrossings } from '../services/railTrack.js';
import { RAIL_DEPTH_M } from '../services/railways.js';

// a rail edge along x = 0 from y = -100 to 100, sampled every metre, as prepareRailEdges leaves it
const railEdge = (extra = {}) => {
  const n = 201; const s = new Float32Array(n); const x = new Float32Array(n); const y = new Float32Array(n);
  for (let i = 0; i < n; i++) { s[i] = i; y[i] = i - 100; }
  return { rail: 'rail', s, x, y, drop: new Float32Array(n).fill(RAIL_DEPTH_M), crossingAt: new Uint8Array(n), crossingZones: [], weight: new Float32Array(n).fill(0.2), ...extra };
};

test('a footpath crossing the line at grade: found by its line, its zone marked on the track (no ballast bed dug, the rails embedded)', () => {
  const g = { edges: [railEdge(), { rail: false }] };
  const out = pathRailCrossings(g, [{ xy: [[-20, 10], [-1, 10], [20, 10]], half: 1 }]);
  assert.equal(out.length, 1);
  assert.ok(Math.abs(out[0].y - 10) < 1e-6 && out[0].path);
  const e = g.edges[0];
  assert.equal(e.crossingZones.length, 1);
  const [a, b] = e.crossingZones[0];
  assert.ok(a < 110 && b > 110 && b - a < 4, `zone ${a}..${b}`);
  assert.equal(e.drop[110], 0, 'the formation up to the rails at the crossing');
  assert.ok(Math.abs(e.drop[0] - RAIL_DEPTH_M) < 1e-6, 'and dug in again away from it');
  // the crossing node shared with the rail: a path ending on the line counts too
  const g2 = { edges: [railEdge()] };
  assert.equal(pathRailCrossings(g2, [{ xy: [[-20, -30], [0, -30]], half: 1 }, { xy: [[0, -30], [20, -30]], half: 1 }]).length, 1, 'a path cut at its crossing node: one crossing');
});

test('path crossings: none over a rail bridge or in a tunnel, none for a path beside the line', () => {
  assert.equal(pathRailCrossings({ edges: [railEdge({ bridge: true })] }, [{ xy: [[-20, 10], [20, 10]], half: 1 }]).length, 0);
  assert.equal(pathRailCrossings({ edges: [railEdge({ tunnel: true })] }, [{ xy: [[-20, 10], [20, 10]], half: 1 }]).length, 0);
  assert.equal(pathRailCrossings({ edges: [railEdge()] }, [{ xy: [[5, -50], [5, 50]], half: 1 }]).length, 0);
});
