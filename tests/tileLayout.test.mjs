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

test('past one grid\'s square a shape is chunked; the web cap is its own area, any shape', () => {
  const strip = Array.from({ length: 16 }, (_, i) => ({ dx: i * 1024, dy: 0 }));
  assert.equal(layoutGrid(strip, 1024).chunked, false);
  const longer = layoutGrid([...strip, { dx: 16 * 1024, dy: 0 }], 1024);
  assert.equal(longer.chunked, true); assert.equal(longer.webOk, true);   // (17 tiles: 17 M px, far under 16384²)
  const big = Array.from({ length: 64 }, (_, i) => ({ dx: (i % 8) * 4096, dy: Math.floor(i / 8) * 4096 }));
  assert.equal(layoutGrid(big, 4096).webOk, false);   // (64 tiles of 4096²: four times the area)
});

test('a map\'s tiles read back checked; a single map has none', async () => {
  const { tilesFromTerrain, MAX_TILES } = await import('../services/tileLayout.js');
  assert.equal(tilesFromTerrain({}), null);
  assert.equal(tilesFromTerrain({ tiles: { list: [{ dx: 0, dy: 0 }] } }), null);
  const t = tilesFromTerrain({ tiles: { list: [{ dx: 3, dy: 1 }, { dx: 1, dy: 'x' }], tilePx: 512, anchor: { lat: 1, lng: 2 }, together: false } });
  assert.deepEqual(t, { list: [{ dx: 0, dy: 0 }, { dx: 1, dy: 0 }], tilePx: 512, anchor: { lat: 1, lng: 2 }, together: false, snap: true });
  const many = { tiles: { list: Array.from({ length: 200 }, (_, i) => ({ dx: i, dy: 0 })), tilePx: 256 } };
  assert.equal(tilesFromTerrain(many).list.length, MAX_TILES);
});
