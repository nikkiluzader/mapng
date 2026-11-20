// services/batchShape.js: a shaped combined level's layout, overlap ownership and footprint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { snapTileOffsets, shapedLayout, pixelOwner, footprintRows, inFootprint, keepSquareFor, fillOutsideFootprint } from '../services/batchShape.js';

test('offsets snap to whole pixels', () => {
  assert.deepEqual(snapTileOffsets([{ index: 1, offsetX: 10.6, offsetY: -3.2 }], 2).map((o) => [o.offsetX, o.offsetY]), [[10, -4]]);
});

test('three tiles in a row: a 1536 x 512 footprint centred in a 2048 square', () => {
  const tiles = [0, 1, 2].map((c) => ({ row: 0, col: c, index: c }));
  const L = shapedLayout(tiles, { cols: 3, rows: 1, tilePx: 512, mpp: 1 });
  assert.equal(L.size, 2048); assert.deepEqual(L.extent, { w: 1536, h: 512 });
  assert.deepEqual(L.tiles.map((t) => [t.x, t.y]), [[256, 768], [768, 768], [1280, 768]]);
  // the square's centre is the job's centre (the row is centred)
  assert.deepEqual(L.centerOffsetM, { x: 0, y: -0 });
});

test('a moved tile goes where it was moved; the square grows to hold it', () => {
  const tiles = [{ row: 0, col: 0, index: 0 }, { row: 0, col: 1, index: 1, offsetX: 0, offsetY: 300 }];
  const L = shapedLayout(tiles, { cols: 2, rows: 1, tilePx: 512, mpp: 1 });
  assert.equal(L.tiles[1].y, L.tiles[0].y - 300);
  assert.equal(L.tiles[1].x - L.tiles[0].x, 512);
  assert.deepEqual(L.extent, { w: 1024, h: 812 });
  assert.equal(L.size, 1024);
});

test('overlapping tiles: each pixel from exactly one tile, the nearer centre', () => {
  // tile 1 moved 200 px back over tile 0
  const tiles = [{ row: 0, col: 0, index: 0 }, { row: 0, col: 1, index: 1, offsetX: -200 }];
  const L = shapedLayout(tiles, { cols: 2, rows: 1, tilePx: 512, mpp: 1 });
  const own = L.tiles.map((t) => pixelOwner(L, t));
  let both = 0; let none = 0; let n0 = 0; let n1 = 0;
  for (let y = L.tiles[0].y; y < L.tiles[0].y + 512; y += 7) {
    for (let x = L.tiles[0].x; x < L.tiles[1].x + 512; x++) {
      const in0 = x < L.tiles[0].x + 512; const in1 = x >= L.tiles[1].x;
      const a = in0 && own[0](x, y); const b = in1 && own[1](x, y);
      if (a && b) both++; if (!a && !b) none++; if (a) n0++; if (b) n1++;
    }
  }
  assert.equal(both, 0); assert.equal(none, 0);
  // the overlap (312 px wide) splits at its middle
  const mid = (L.tiles[0].cx + L.tiles[1].cx) / 2;
  assert.equal(own[0](Math.floor(mid) - 1, L.tiles[0].y), true); assert.equal(own[1](Math.ceil(mid) + 1, L.tiles[0].y), true);
  // the footprint is the union, not two full tiles' worth
  assert.deepEqual(L.extent, { w: 824, h: 512 });
});

test('the footprint: squares inside and between touching tiles kept, past the edge not', () => {
  const tiles = [0, 1].map((c) => ({ row: 0, col: c, index: c }));
  const L = shapedLayout(tiles, { cols: 2, rows: 1, tilePx: 64, mpp: 1 });
  const keep = keepSquareFor({ size: L.size, rects: L.rects });
  const N = L.size; const t0 = L.tiles[0];
  const j = (y) => N - 1 - y;   // terrain j of the square whose south row is y
  assert.equal(keep(t0.x + 5, j(t0.y + 5)), true);
  assert.equal(keep(t0.x + 63, j(t0.y + 5)), true, 'the square between the two tiles');
  assert.equal(keep(t0.x - 1, j(t0.y + 5)), false, 'west of the footprint');
  assert.equal(keep(t0.x + 5, j(t0.y)), false, 'its north row half outside');
  const rows = footprintRows(L.rects, N);
  assert.equal(inFootprint(rows, t0.x, t0.y), true); assert.equal(inFootprint(rows, t0.x + 128, t0.y), false);
});

test('outside the footprint the heights stretch out from its edge', () => {
  const N = 8; const h = new Float32Array(N * N).fill(-1);
  const rows = footprintRows([[2, 2, 2, 2], [6, 2, 2, 2]], N);
  for (let y = 2; y < 4; y++) for (let x = 0; x < N; x++) if (inFootprint(rows, x, y)) h[y * N + x] = x * 10 + y;
  fillOutsideFootprint(h, rows, N);
  assert.equal(h[2 * N + 0], 22); assert.equal(h[2 * N + 7], 72);
  assert.equal(h[2 * N + 4], 32, 'the gap: its west half from the west run');
  assert.equal(h[2 * N + 5], 62, 'its east half from the east run');
  assert.deepEqual([...h.subarray(0, N)], [...h.subarray(2 * N, 3 * N)], 'rows above copy the nearest row');
  assert.deepEqual([...h.subarray(7 * N, 8 * N)], [...h.subarray(3 * N, 4 * N)]);
  assert.ok(!h.includes(-1));
});
