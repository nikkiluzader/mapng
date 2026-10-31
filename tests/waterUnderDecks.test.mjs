import test from 'node:test';
import assert from 'node:assert/strict';
import { carveWaterUnderDecks } from '../services/beamngWater.js';

// a 101 x 101 grid, 1 m pixels, flat at 10 m (the dam a deck leaves): a canal along x at y 0, 8 m wide,
// its surface at 7; a deck covers x -6..6
const grid = (() => {
  const width = 101; const heightMap = new Float32Array(width * width).fill(10);
  return { heightMap, width, height: width, worldSize: 100, minHeight: 0 };
})();
const toIdx = (x, y) => Math.round(0.5 * 100 - y) * 101 + Math.round(x + 50);
const covered = (idx) => { const c = idx % 101; return c >= 44 && c <= 56; };

test('a river under a deck gets its bed carved there, and only there', () => {
  const rivers = [{ nodes: [[-40, 0, 7, 8, 1], [40, 0, 7, 8, 1]] }];
  const { pixels, apply } = carveWaterUnderDecks({ rivers }, grid, covered);
  assert.ok(pixels > 50);
  const out = new Float32Array(grid.heightMap); apply((i, v) => { out[i] = v; });
  assert.ok(Math.abs(out[toIdx(0, 0)] - 5.5) < 1e-6, `the bed under the deck's middle: ${out[toIdx(0, 0)]}`);
  assert.equal(out[toIdx(20, 0)], 10, 'not outside the deck');
  assert.equal(out[toIdx(0, 10)], 10, 'not outside the river');
  assert.ok(out[toIdx(0, 3.6)] > 5.5 && out[toIdx(0, 3.6)] < 7, 'sloping up at its edge');
});

test('a lake under a deck: its outline carved under the level', () => {
  const ring = [[-30, -10], [30, -10], [30, 10], [-30, 10]];
  const poly = { box: [-30, -10, 30, 10], outer: ring, holes: [], contains: (x, y) => x > -30 && x < 30 && y > -10 && y < 10 };
  const { apply } = carveWaterUnderDecks({ lakes: [{ poly, level: 7 }] }, grid, covered);
  const out = new Float32Array(grid.heightMap); apply((i, v) => { out[i] = v; });
  assert.ok(Math.abs(out[toIdx(0, 0)] - 5.5) < 1e-6);
  assert.equal(out[toIdx(0, 20)], 10);
});

test('a v2 deck\'s road: its carriageway split, the stretch on the deck a bridge', async () => {
  const { splitOnDecks } = await import('../services/exportBeamNGLevel.js');
  const nodes = []; for (let x = -50; x <= 50; x += 5) nodes.push([x, 0, 0]);
  const cws = [{ owner: 7, nodes, half: 4, bridge: false }, { owner: 8, nodes: [[0, 30, 0], [10, 30, 0]], half: 3, bridge: false }];
  const parts = [{ edge: 0, xy: [[-10, 0], [10, 0]], half: 4 }];
  const out = splitOnDecks(cws, parts, [{ seg: 7 }]);
  const own = out.filter((c) => c.owner === 7);
  assert.deepEqual(own.map((c) => c.bridge), [false, true, false]);
  assert.ok(own[1].nodes.every(([x]) => x >= -10 && x <= 15), JSON.stringify(own[1].nodes));
  assert.equal(out.filter((c) => c.owner === 8)[0].bridge, false, 'another road untouched');
});

test('an outlined river: a strip standing over its water carved, a high bank and a quay road kept', () => {
  const g = { ...grid, heightMap: new Float32Array(grid.heightMap.length).fill(9) };   // 2 m over the water
  for (let r = 0; r < 101; r++) for (let c = 80; c < 101; c++) g.heightMap[r * 101 + c] = 20;   // a high bank at x >= 30
  const rivers = [{ nodes: [[-45, 0, 7, 8, 1], [45, 0, 7, 8, 1]], outline: [true, true] }];
  const keep = (x) => x > -25 && x < -15;    // a road across at x -20
  const { apply } = carveWaterUnderDecks({ rivers }, g, () => false, keep);
  const out = new Float32Array(g.heightMap); apply((i, v) => { out[i] = v; });
  assert.ok(Math.abs(out[toIdx(0, 0)] - 5.5) < 1e-6, `the strip's bed: ${out[toIdx(0, 0)]}`);
  assert.equal(out[toIdx(40, 0)], 20, 'a bank 13 m over the water left');
  assert.equal(out[toIdx(-20, 0)], 9, 'the road kept');
  const plain = carveWaterUnderDecks({ rivers: [{ ...rivers[0], outline: [false, false] }] }, g, () => false);
  assert.equal(plain.pixels, 0, 'a river without an outline: only under decks');
});

test('levelling under a deck: the dam it left goes, its ends on their fill stay', async () => {
  const { levelUnderDecks } = await import('../services/beamngWater.js');
  const g = { ...grid, heightMap: new Float32Array(grid.heightMap.length).fill(3) };
  // a deck along x from -30 to 30 at y 0, half 4: the data holds it at 9 out to y +-6
  for (let r = 0; r < 101; r++) for (let c = 0; c < 101; c++) { const x = c - 50; const y = 50 - r; if (Math.abs(x) <= 30 && Math.abs(y) <= 6) g.heightMap[r * 101 + c] = 9; }
  const deck = { parts: [{ xy: [[-30, 0], [30, 0]], half: 4 }] };
  const wet = (x) => Math.abs(x) < 20;   // water under the middle; the ends on dry fill
  const { apply } = levelUnderDecks([deck], g, undefined, 0.4, wet);
  const out = new Float32Array(g.heightMap); apply((i, v) => { out[i] = v; });
  assert.ok(Math.abs(out[toIdx(0, 0)] - 3) < 0.6, `under the middle: ${out[toIdx(0, 0)]}`);
  assert.equal(out[toIdx(-28, 0)], 9, 'the last metres on the abutment stay');
  const allWet = levelUnderDecks([deck], g).pixels;
  assert.ok(allWet > levelUnderDecks([deck], g, undefined, 0.4, wet).pixels, 'an end with water both sides is levelled too');
});

test('a pixel left standing among lowered ones takes their median', async () => {
  const { fillRemnants } = await import('../services/beamngWater.js');
  const W = 5; const hm = new Float32Array(W * W).fill(10);
  const lowered = new Set();
  for (let i = 0; i < W * W; i++) if (i !== 12) { hm[i] = 5; lowered.add(i); }   // all but the centre lowered to 5
  const { pixels, apply } = fillRemnants(hm, W, W, lowered);
  assert.equal(pixels, 1);
  apply((i, v) => { hm[i] = v; });
  assert.equal(hm[12], 5);
  // an edge of a lowered strip (three lowered neighbours) is left
  const hm2 = new Float32Array(W * W).fill(10); const low2 = new Set([0, 1, 2, 3, 4].map((c) => c)); for (const i of low2) hm2[i] = 5;
  assert.equal(fillRemnants(hm2, W, W, low2).pixels, 0);
});
