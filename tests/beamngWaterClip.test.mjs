import test from 'node:test';
import assert from 'node:assert/strict';

import { solveTunnel } from '../services/beamngTunnels.js';
import { tunnelDryZones, tunnelsBelow, planSeaBlocks, clipRiverNodes, clipLakeTile, waterFloorIn } from '../services/beamngWaterClip.js';

// A cut-and-cover tunnel under a river at sea level: the ground at 2 m on
// the banks, the water surface (0 m) across |y| < 60.
const ground = (x, y) => (Math.abs(y) < 60 ? 0 : 2);
const tunnel = () => solveTunnel({ xy: [[0, -200], [0, 200]], half: 4 }, {
  groundAt: ground, approaches: [{ xy: [[0, -200], [0, -600]] }, { xy: [[0, 200], [0, 600]] }],
});

test('dry zones: water over the tube stops at its roof, none over its trenches', () => {
  const t = tunnel();
  assert.equal(t.ok, true, t.reason);
  const zones = tunnelDryZones([t]);
  const roof = waterFloorIn(zones, -1, -1, 1, 1);
  const mid = t.line[(t.iS + t.iN) >> 1];
  assert.ok(roof > mid.z + t.crown && roof < 0, `water may reach ${roof.toFixed(2)} (road ${mid.z.toFixed(2)})`);
  const trench = t.line[Math.max(0, t.iS - 10)];
  assert.equal(waterFloorIn(zones, trench.x - 1, trench.y - 1, trench.x + 1, trench.y + 1), Infinity, 'no water in a trench');
  assert.equal(waterFloorIn(zones, 300, 0, 302, 2), -Infinity, 'away from it: any depth');
  assert.equal(tunnelsBelow([t], 0), true);
});

test('the sea as blocks: over the river, none in the trench, shallow over the tube', () => {
  const t = tunnel();
  const zones = tunnelDryZones([t]);
  const blocks = planSeaBlocks({ size: 1024, seaZ: 0.5, heightAt: ground, zones, minZ: -20 });
  assert.ok(blocks.length > 0);
  const at = (x, y) => blocks.filter((b) => Math.abs(x - b.cx) <= b.sx / 2 && Math.abs(y - b.cy) <= b.sy / 2);
  // the river far from the tunnel: full depth
  assert.ok(at(300, 0).some((b) => b.depth > 10), 'deep sea away from the tunnel');
  // over the tube: no deeper than to its roof
  const over = at(0, 0);
  assert.ok(over.length > 0 && over.every((b) => 0.5 - b.depth >= waterFloorIn(zones, -1, -1, 1, 1) - 0.11), 'held over the roof');
  // the banks are dry ground (2 m > sea): no block, and none in the trench
  assert.equal(at(300, 150).length, 0);
  const trench = t.line[Math.max(0, t.iS - 10)];
  assert.equal(at(trench.x, trench.y).length, 0, 'the trench is dry');
});

test('the sea fills only ground the open water reaches, not a hollow inland', () => {
  // the river across the map (|y| < 60, joined to its edges) and a sunk road
  // cutting at (300, 300), both under sea level; dry ground between
  const ground = (x, y) => (Math.abs(y) < 60 || Math.hypot(x - 300, y - 300) < 30 ? -1 : 2);
  const blocks = planSeaBlocks({ size: 1024, seaZ: 0, heightAt: ground, zones: [], minZ: -20 });
  const at = (x, y) => blocks.filter((b) => Math.abs(x - b.cx) <= b.sx / 2 && Math.abs(y - b.cy) <= b.sy / 2);
  assert.ok(at(-300, 0).length > 0, 'the river is sea');
  assert.equal(at(300, 300).length, 0, 'the cutting stays dry');
});

test('rivers and lakes over a tunnel are held over its roof', () => {
  const t = tunnel();
  const zones = tunnelDryZones([t]);
  const { nodes, clipped } = clipRiverNodes([[-100, 0, 0, 20, 4], [0, 0, 0, 20, 4], [100, 0, 0, 20, 4]], zones);
  assert.equal(clipped, 1);
  assert.equal(nodes[0][4], 4);
  assert.ok(nodes[1][4] < 4 && 0 - nodes[1][4] >= waterFloorIn(zones, -10, -10, 10, 10) - 1e-6);
  assert.ok(clipLakeTile({ cx: 0, cy: 0, sx: 10, sy: 10, z: 0 }, 6, zones) < 6);
  assert.equal(clipLakeTile({ cx: 300, cy: 0, sx: 10, sy: 10, z: 0 }, 6, zones), 6);
});

test('a polder behind its dyke stays dry; the sea in front of it is water', async () => {
  const { planSeaBlocks, hasInlandBelowSea } = await import('../services/beamngWaterClip.js');
  // 512 m map, x from -256: sea (-5 m) west of x = -100, a 40 m dyke (+3 m), a polder (-4 m) east of it
  const ground = (x) => (x < -100 ? -5 : x < -60 ? 3 : -4);
  // (open water only out west: the polder runs off the map's other edges, as real ones do)
  const blocks = planSeaBlocks({ size: 512, seaZ: 0, heightAt: (x) => ground(x), zones: [], minZ: -5, seaAt: (x) => x < -100 });
  const wetAt = (x, y) => blocks.some((b) => Math.abs(x - b.cx) <= b.sx / 2 && Math.abs(y - b.cy) <= b.sy / 2);
  assert.ok(wetAt(-200, 0), 'the sea is water');
  assert.ok(!wetAt(0, 0) && !wetAt(200, 100), 'the polder is dry');
  assert.ok(!wetAt(-40, 0), 'no water within ~16 m behind the dyke');
  // the heightmap test: 128 x 128 at 4 m
  const W = 128; const hm = new Float32Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) hm[y * W + x] = ground(-256 + x * 4);
  const seaAt = (u) => u < 156 / 512;
  assert.equal(hasInlandBelowSea(hm, W, W, 0, 4, { seaAt }), true);
  assert.equal(hasInlandBelowSea(hm, W, W, 0, 4), false);   // (without knowing the sea, every edge is: as before)
  // no polder (all the low ground joins the sea), or nothing below sea level: one plane will do
  for (let i = 0; i < hm.length; i++) if (hm[i] === -4) hm[i] = 2;
  assert.equal(hasInlandBelowSea(hm, W, W, 0, 4, { seaAt }), false);
  assert.equal(hasInlandBelowSea(new Float32Array(W * W).fill(5), W, W, 0, 4), false);
});

test('open water at the map edge: the sea in long runs, not a polder ditch', async () => {
  const { openWaterAtEdge } = await import('../services/worldCover.js');
  const n = 100; const grid = new Uint8Array(n * n).fill(40);   // fields, 1 km square: 10 m cells
  for (let r = 0; r < n; r++) for (let c = 0; c < 30; c++) grid[r * n + c] = 80;    // the sea along the west, 300 m deep
  grid[50] = 80; grid[51] = 80;                                                       // a 20 m ditch crossing the north edge
  const at = openWaterAtEdge({ grid, n }, 1000);
  assert.equal(at(0, 0.5), true);        // west edge: the sea
  assert.equal(at(0.1, 0), true);        // north edge over the sea
  assert.equal(at(0.505, 0), false);     // the ditch
  assert.equal(at(1, 0.5), false);       // east edge: fields
  assert.equal(openWaterAtEdge(null, 1000), null);
});

test('a long lake strip is cut where a trench crosses it, not left out whole', async () => {
  const { splitLakeTile, clipLakeTile } = await import('../services/beamngWaterClip.js');
  // a trench zone along x = 300 (north–south), 10 m each side (no grid: every zone is checked)
  const zones = [{ a: [300, -100], b: [300, 100], half: 10, top: Infinity, box: [290, -100, 310, 100] }];
  const strip = { cx: 0, cy: 0, sx: 960, sy: 4.5, z: 10 };
  assert.equal(clipLakeTile(strip, 6, zones), 0, 'whole, the strip is left out');
  const pieces = splitLakeTile(strip, zones);
  const kept = pieces.filter((p) => clipLakeTile(p, 6, zones) > 0);
  const keptLen = kept.reduce((sum, p) => sum + p.sx, 0);
  assert.ok(keptLen > 900, `most of the strip kept: ${keptLen} m`);
  assert.ok(kept.every((p) => p.cx + p.sx / 2 <= 290 || p.cx - p.sx / 2 >= 310), 'nothing kept over the trench');
  assert.ok(pieces.length <= 20, `only cut near the trench: ${pieces.length} pieces`);
  const far = { cx: 0, cy: 500, sx: 960, sy: 4.5, z: 10 };
  assert.deepEqual(splitLakeTile(far, zones), [far]);
});

test('no land cover and no mapped sea: an inland basin below sea level gets no sea from its edge', async () => {
  const { planSeaBlocks } = await import('../services/beamngWaterClip.js');
  // a 512 m map, all of it 6 m under sea level (a polder), nothing open water
  const size = 512;
  const r = planSeaBlocks({ size, seaZ: 0, heightAt: () => -6, zones: [], minZ: -6, seaAt: () => false });
  const area = (r.blocks || r).reduce?.((a, b) => a + (b.sx || 0) * (b.sy || 0), 0) ?? 0;
  assert.ok(area < size * size * 0.01, `flooded ${area} m²`);
});
