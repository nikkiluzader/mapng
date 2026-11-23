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

// A chunk is a map in the level's own frame: its samples are the level's samples.
test("a chunk's height samples are the level's, at any latitude", async () => {
  const { levelLattice, chunkLayout } = await import('../services/chunkLayout.js');
  const { frameBounds, vertexLatLng, metresPerDegree } = await import('../services/mapFrame.js');
  for (const lat of [0, 34.7, 60, -70]) {
    const center = { lat, lng: 10.7 }; const W = 6000; const H = 3000; const mpp = 1;
    const L = levelLattice(center, mpp, W, H);
    const level = frameBounds(center, W * mpp, H * mpp);
    const chunks = chunkLayout([[0, 0, W, H]], W, H, { size: 2048, overlap: 256 });
    assert.ok(chunks.length >= 6);
    for (const c of chunks) {
      const b = L.chunkBounds(c);
      for (const [i, j] of [[0, 0], [5, 9], [c.size - 1, c.size - 1], [1024, 77]]) {
        const mine = vertexLatLng(b, c.size, c.size, i, j); const levels = vertexLatLng(level, W, H, c.x0 + i, c.y0 + j);
        assert.ok(Math.abs(mine.lat - levels.lat) < 1e-10 && Math.abs(mine.lng - levels.lng) < 1e-10, `lat ${lat} chunk ${c.key} sample ${i},${j}`);
      }
      // where the merge puts the chunk: its centre's offset in metres is its centre's place in the level's frame
      const o = L.chunkOffsetM(c); const cc = L.chunkCenter(c); const k = metresPerDegree(center.lat);
      assert.ok(Math.abs((cc.lng - center.lng) * k.lng - o.x) < 1e-6 && Math.abs((cc.lat - center.lat) * k.lat - o.y) < 1e-6);
    }
    // two neighbours share the samples of their overlap
    const a = chunks[0]; const n = chunks.find((c) => c !== a && c.y0 === a.y0 && c.x0 > a.x0 && c.x0 < a.x0 + a.size);
    const pa = vertexLatLng(L.chunkBounds(a), a.size, a.size, n.x0 - a.x0 + 10, 100); const pn = vertexLatLng(L.chunkBounds(n), n.size, n.size, 10, 100);
    assert.ok(Math.abs(pa.lat - pn.lat) < 1e-10 && Math.abs(pa.lng - pn.lng) < 1e-10);
  }
});
