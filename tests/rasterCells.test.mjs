// Where a raster's samples lie (services/rasterCells.js): at the middle of
// their cells, half a cell in from the origin, unless the values are points.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cellIndex, geoTiffCellIsPoint, sampleOrigin } from '../services/rasterCells.js';
import { resampleToMeterGrid } from '../services/terrainResampler.js';

test('the first sample is half a cell in from a cell-area raster\'s origin', () => {
  assert.equal(sampleOrigin(1000, 1), 1000.5);
  assert.equal(sampleOrigin(5000, -1), 4999.5);          // (rows run down: half a cell south)
  assert.equal(sampleOrigin(1000, 1, true), 1000);       // (values at points: as given)
  assert.equal(geoTiffCellIsPoint({ GTRasterTypeGeoKey: 2 }), true);
  assert.equal(geoTiffCellIsPoint({ GTRasterTypeGeoKey: 1 }), false);
  assert.equal(geoTiffCellIsPoint({}), false);
});

test('a raster covers its whole area: the outer half cell takes the outer sample', () => {
  assert.equal(cellIndex(-0.5, 10), 0);
  assert.equal(cellIndex(-0.51, 10), null);
  assert.equal(cellIndex(-0.5 - 1e-9, 10), 0);           // (exactly on the edge, to rounding)
  assert.equal(cellIndex(3.25, 10), 3.25);
  assert.ok(cellIndex(9.5, 10) < 9 && cellIndex(9.5, 10) > 8.99);
  assert.equal(cellIndex(9.51, 10), null);
  assert.equal(cellIndex(NaN, 10), null);
  assert.equal(cellIndex(0.2, 1), 0);
});

test('a grid tile in degrees is sampled at its cells\' middles, to its edges', async () => {
  // 4 x 4 cells of 0.001° from (10, 50): value = column + 10 * row; the cell (c, r) is centred at
  // lng 10 + (c + 0.5) * 0.001, lat 50 - (r + 0.5) * 0.001
  const W = 4; const raster = new Float32Array(W * W);
  for (let r = 0; r < W; r++) for (let c = 0; c < W; c++) raster[r * W + c] = c + 10 * r;
  const tile = { raster, width: W, height: W, originX: 10, originY: 50, resX: 0.001, resY: -0.001, epsgCode: 4326, noData: -99999 };
  const bounds = { north: 50, south: 49.996, west: 10, east: 10.004 };
  // an 8 x 8 output grid over the same box
  const out = await resampleToMeterGrid({ type: 'grid', data: { tiles: [tile] } }, { lat: 49.998, lng: 10.002 }, 8, 8, 'bilinear', false, false, bounds, true);
  const at = (x, y) => out.heightMap[y * 8 + x];
  // (the output grid's own samples run edge to edge: pixel x is at x / 7 of the box)
  const expectCol = (x) => Math.min(3, Math.max(0, (x / 7) * 4 - 0.5));     // the cell index at output pixel x
  for (const [x, y] of [[0, 0], [1, 1], [3, 2], [4, 4], [6, 5], [7, 7]]) {
    const want = expectCol(x) + 10 * expectCol(y);
    assert.ok(Math.abs(at(x, y) - want) < 0.05, `(${x}, ${y}) ${at(x, y)} want ${want}`);
  }
  // nothing along the edges is left without data
  assert.ok(out.heightMap.every((v) => v > -1000));
});
