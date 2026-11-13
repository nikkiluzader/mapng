import test from 'node:test';
import assert from 'node:assert/strict';
import { clampArea, squareOfDrag, tileRects, tilesNeeded, partOffset, samplePosition } from '../services/modelArea.js';

const level = (W, H, m, col, row) => ({ x: (col - W / 2) * m, z: -((H / 2 - 1 - row) * m) });

test('a part of the map keeps its samples where the level has them', () => {
  for (const [W, m] of [[512, 1], [2048, 2], [4096, 0.5]]) {
    const full = { width: W, height: W, metersPerPixel: m, minHeight: 100 };
    for (const rect of [{ c0: 0, r0: 0, size: W }, { c0: 37, r0: 200, size: 129 }, { c0: W - 64, r0: W - 64, size: 64 }]) {
      for (const [c, r] of [[0, 0], [rect.size - 1, 0], [0, rect.size - 1], [rect.size >> 1, rect.size >> 2]]) {
        const got = samplePosition(full, rect, c, r); const want = level(W, W, m, rect.c0 + c, rect.r0 + r);
        assert.ok(Math.abs(got.x - want.x) < 1e-9 && Math.abs(got.z - want.z) < 1e-9, `${W} @${m}: sample ${c},${r} of ${JSON.stringify(rect)}`);
      }
    }
    // heights: a part's own lowest point over the map's
    assert.equal(partOffset(full, { c0: 0, r0: 0, size: 64 }, 112.5).y, 12.5);
  }
});

test('tiles cover the area, are square, and neighbours share a row or column of samples', () => {
  for (const [size, k] of [[512, 2], [2048, 4], [1000, 4], [513, 2], [8192, 8]]) {
    const area = { c0: 10, r0: 20, size }; const tiles = tileRects(area, k);
    assert.equal(tiles.length, k * k);
    const covered = new Uint8Array(size);
    for (const t of tiles) {
      assert.ok(t.c0 >= area.c0 && t.r0 >= area.r0 && t.c0 + t.size <= area.c0 + size && t.r0 + t.size <= area.r0 + size, `inside: ${JSON.stringify(t)}`);
      if (t.j === 0) for (let c = t.c0 - area.c0; c < t.c0 - area.c0 + t.size; c++) covered[c] = 1;
    }
    assert.ok(covered.every((v) => v === 1), `${size} in ${k}: every column covered`);
    for (const t of tiles) {
      const right = tiles.find((u) => u.j === t.j && u.i === t.i + 1);
      // (the joint: the neighbour starts on or before this tile's last column)
      if (right) assert.ok(right.c0 <= t.c0 + t.size - 1, `${size} in ${k}: tiles ${t.i} and ${right.i} share a column`);
    }
  }
  assert.deepEqual(tileRects({ c0: 0, r0: 0, size: 512 }, 1), [{ i: 0, j: 0, c0: 0, r0: 0, size: 512 }]);
});

test('how many tiles a mesh too big for one file needs', () => {
  assert.equal(tilesNeeded(2048, 1, 1), 1);
  assert.equal(tilesNeeded(8192, 1, 1), 2);       // 4097 x 4097 a tile
  assert.equal(tilesNeeded(16384, 1, 1), 4);
  assert.equal(tilesNeeded(16384, 1, 4), 1);
  assert.equal(tilesNeeded(131072, 1, 1), null);  // even 16 x 16 are too big
});

test('a dragged area becomes a square inside the map', () => {
  assert.deepEqual(squareOfDrag({ c: 100, r: 100 }, { c: 300, r: 200 }, 512, 512), { c0: 100, r0: 50, size: 200 });
  assert.deepEqual(squareOfDrag({ c: 400, r: 400 }, { c: 700, r: 900 }, 512, 512), { c0: 12, r0: 12, size: 500 });
  assert.equal(clampArea({ c0: 5, r0: 5, size: 3 }, 512, 512).size, 16);
  assert.equal(clampArea(null, 512, 512), null);
});
