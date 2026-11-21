// services/tileLayout.js: tiles in step 1 as one grid.
import test from 'node:test';
import assert from 'node:assert/strict';
import { singleTile, nextTileSpot, placeTile, layoutGrid } from '../services/tileLayout.js';

test('one tile is the square of today, on a TerrainBlock', () => {
  const g = layoutGrid(singleTile(), 1024);
  assert.deepEqual([g.width, g.height, g.terrainBlock, g.areaPx], [1024, 1024, true, 1024 * 1024]);
  assert.deepEqual(g.centerOffset, { x: 0, y: -0 });
});

test('a new tile goes beside the last; two in a row are models, four in a square a TerrainBlock', () => {
  let t = singleTile(); t.push(nextTileSpot(t, 512));
  assert.deepEqual(t[1], { dx: 512, dy: 0 });
  let g = layoutGrid(t, 512); assert.deepEqual([g.width, g.height, g.terrainBlock], [1024, 512, false]);
  assert.deepEqual(g.centerOffset, { x: 256, y: -0 });
  t = [{ dx: 0, dy: 0 }, { dx: 512, dy: 0 }, { dx: 0, dy: -512 }, { dx: 512, dy: -512 }];
  g = layoutGrid(t, 512); assert.deepEqual([g.width, g.height, g.terrainBlock], [1024, 1024, true]);
});

test('three by three of 512 is square but not a power of two: models', () => {
  const t = []; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) t.push({ dx: a * 512, dy: b * 512 });
  const g = layoutGrid(t, 512); assert.deepEqual([g.width, g.terrainBlock, g.squareSide], [1536, false, 2048]);
});

test('overlaps are counted once; islands are found', () => {
  let g = layoutGrid([{ dx: 0, dy: 0 }, { dx: 300, dy: 0 }], 512);
  assert.equal(g.areaPx, 812 * 512); assert.equal(g.overlaps, true); assert.equal(g.islands, false);
  g = layoutGrid([{ dx: 0, dy: 0 }, { dx: 900, dy: 0 }], 512);
  assert.equal(g.islands, true); assert.equal(g.areaPx, 2 * 512 * 512);
});

test('together: a dragged tile lands on the nearest free grid spot', () => {
  const t = [{ dx: 0, dy: 0 }, { dx: 512, dy: 0 }];
  assert.deepEqual(placeTile(t, 1, { dx: 430, dy: -390 }, 512, { together: true }), { dx: 512, dy: -512 });
  assert.deepEqual(placeTile(t, 1, { dx: 40, dy: 20 }, 512, { together: true }).dx !== 0 || placeTile(t, 1, { dx: 40, dy: 20 }, 512, { together: true }).dy !== 0, true, 'never onto tile 0');
});

test('free with snap: an edge near a neighbour snaps to it; without snap it stays', () => {
  const t = [{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }];
  assert.deepEqual(placeTile(t, 1, { dx: 540, dy: 37 }, 512, { together: false, snap: true }), { dx: 512, dy: 0 });
  assert.deepEqual(placeTile(t, 1, { dx: 540, dy: 37 }, 512, { together: false, snap: false }), { dx: 540, dy: 37 });
  assert.deepEqual(placeTile(t, 1, { dx: 700, dy: 260 }, 512, { together: false, snap: true }), { dx: 700, dy: 260 }, 'too far to snap');
});

test('the web cap holds the export square, any shape', () => {
  const strip = Array.from({ length: 16 }, (_, i) => ({ dx: i * 1024, dy: 0 }));
  assert.equal(layoutGrid(strip, 1024).webOk, true);
  assert.equal(layoutGrid([...strip, { dx: 16 * 1024, dy: 0 }], 1024).webOk, false);
});
