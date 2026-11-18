import test from 'node:test';
import assert from 'node:assert/strict';
import { countMapPoints, estimateExportMemory, memoryFit } from '../services/memoryEstimate.js';

// The figures come from the desktop app measured whole (scratch/memprobe, 2026-11-18); these keep the formula's
// shape: the terrain's part grows with the pixels, the buildings' part with the map data, the larger one counts.
test('empty country: the terrain holds the peak, growing with the map', () => {
  const small = estimateExportMemory({ terrainPx: 2048, mapPoints: 3000 });
  const big = estimateExportMemory({ terrainPx: 16384, mapPoints: 250000 });
  assert.equal(small.step, 'terrain');
  assert.equal(big.step, 'terrain');
  assert.ok(big.gb > small.gb * 2.5, `${small.gb} -> ${big.gb}`);
  // (a 16 km mountain map measured 20.6 to 20.9 GB)
  assert.ok(big.gb > 15 && big.gb < 26, String(big.gb));
});

test('a town: the buildings step holds the peak; without buildings it does not', () => {
  const town = estimateExportMemory({ terrainPx: 4096, mapPoints: 240000 });
  assert.equal(town.step, 'buildings');
  assert.equal(estimateExportMemory({ terrainPx: 4096, mapPoints: 240000, includeBuildings: false }).step, 'terrain');
});

test('map points count every outline vertex', () => {
  assert.equal(countMapPoints([{ geometry: [1, 2, 3] }, { geometry: [1, 2] }, {}, null]), 5);
  assert.equal(countMapPoints(undefined), 0);
});

test('fit against the computer: fits, tight, too much', () => {
  const GB = 2 ** 30;
  assert.equal(memoryFit(10, 32 * GB), 'fits');
  assert.equal(memoryFit(22, 32 * GB), 'tight');
  assert.equal(memoryFit(30, 32 * GB), 'tooMuch');
  assert.equal(memoryFit(10, 0), null);
});
