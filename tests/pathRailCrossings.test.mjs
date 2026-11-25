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

test('crossing pads: the bed across the line over the path\'s width, a strip over each pair of rails kept clear', async () => {
  const { pathCrossingPads, PAD_PAST_PATH_M, PAD_STRIP_PAST_M } = await import('../services/railTrack.js');
  const g = { edges: [railEdge()] };
  g.railPathCrossings = pathRailCrossings(g, [{ xy: [[-20, 10], [20, 10]], half: 1 }]);
  const [pd] = pathCrossingPads(g, { tagsOf: () => ({ gauge: '1067' }), bedHalf: () => 2.5 });
  const xs = pd.pad.map((p) => p[0]); const ys = pd.pad.map((p) => p[1]);
  assert.ok(Math.abs(Math.max(...xs) - 2.5) < 1e-6 && Math.abs(Math.min(...xs) + 2.5) < 1e-6, 'across: the bed');
  assert.ok(Math.abs(Math.max(...ys) - (10 + 1 + PAD_PAST_PATH_M)) < 1e-6, 'along: the path\'s width');
  assert.equal(pd.strips.length, 1);
  assert.ok(Math.abs(pd.strips[0].half - (1.067 / 2 + PAD_STRIP_PAST_M)) < 1e-6, 'the strip: gauge and rail heads');
});

test('the paved worker keeps a path\'s paving on a crossing pad, off the rail strip and off the rest of the bed', async () => {
  const { pavedTile } = await import('../services/pavedWorker.js');
  const { WALK } = await import('../services/pavedArea.js');
  const bed = [[-2.5, -20], [2.5, -20], [2.5, 20], [-2.5, 20]];
  const pad = [[-2.5, 8.95], [2.5, 8.95], [2.5, 11.05], [-2.5, 11.05]];
  const item = { box: [-10, 0, 10, 20], roads: [], cornerArcs: [], walks: [{ pts: [[-10, 10], [10, 10]], half: 1, sidewalk: false }], streetWalks: [], greenery: [], buildings: [], pockets: [], water: [], rivers: [], houses: [],
    railBeds: [bed], pads: [{ pad, strips: [{ pts: [[0, 5], [0, 15]], half: 0.65 }] }] };
  const { cells, g } = pavedTile(item);
  const at = (x, y) => cells[Math.floor((g.y1 - y) / g.res) * g.w + Math.floor((x - g.x0) / g.res)];
  assert.ok(at(-6, 10) & WALK, 'the path off the bed');
  assert.ok(at(-1.5, 10) & WALK, 'paved over the bed on the pad');
  assert.ok(!(at(0, 10) & WALK), 'never over the rails');
  assert.ok(at(1.5, 10) & WALK, 'and on the far side of them');
});
