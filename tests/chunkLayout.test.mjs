// services/chunkLayout.js: chunks over a footprint, cores tiling it once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkLayout, chunkOwnerKey } from '../services/chunkLayout.js';
import { shapeArea } from '../services/batchShape.js';
import { corridorGrid } from '../services/roadCorridor.js';

const D = 1 / 111320; const P = (x, y) => ({ lat: y * D, lng: x * D });

test('a footprint inside one core: one chunk, all of it', () => {
  const ch = chunkLayout([[100, 100, 500, 500]], 1500, 1500);
  assert.equal(ch.length, 1); assert.equal(ch[0].area, 250000);
});

test('the cores split the footprint exactly once; chunks overlap by the overlap', () => {
  const W = 6000; const H = 1000;
  const ch = chunkLayout([[0, 0, W, H]], W, H);
  assert.equal(ch.reduce((n, c) => n + c.area, 0), W * H);
  const a = ch.find((c) => c.a === 0); const b = ch.find((c) => c.a === 1 && c.b === 0);
  assert.equal(a.x0 + a.size - b.x0, 256);
  assert.equal(chunkOwnerKey(1791, 10), '0_0'); assert.equal(chunkOwnerKey(1792, 10), '1_0');
});

test('a long diagonal road: few chunks against its box, the footprint kept once, each chunk its own part', () => {
  // ~23 km diagonal with bends, 275 m either side
  const pts = []; for (let k = 0; k <= 60; k++) pts.push(P(k * 220 + 400 * Math.sin(k / 5), k * 300));
  const g = corridorGrid(pts, 275, 1);
  const ch = chunkLayout({ runs: g.runs }, g.width, g.height);
  const total = ch.reduce((n, c) => n + c.area, 0);
  assert.equal(total, g.areaPx);
  const boxChunks = Math.ceil(g.width / 1792) * Math.ceil(g.height / 1792);
  assert.ok(ch.length < boxChunks / 2, `${ch.length} chunks of ${boxChunks} in the box`);
  // a chunk's own runs hold at least its core's part
  for (const c of ch) assert.ok(shapeArea({ runs: c.runs }, c.size) >= c.area);
});
