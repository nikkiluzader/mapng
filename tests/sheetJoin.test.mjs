// Heights across the join of two survey sheets (services/resamplerWorker.js sampleHeightAt).
import test from 'node:test';
import assert from 'node:assert/strict';

test('across two abutting sheets a slope stays one slope: no shelf at the join', async () => {
  const { sampleHeightAt } = await import('../services/resamplerWorker.js');
  // two sheets 100 x 100 samples a unit apart, side by side; the ground rises 0.3 a unit to the east
  const ground = (x, y) => 0.3 * x + 0.1 * y;
  const sheet = (x0) => { const raster = new Float32Array(100 * 100); for (let r = 0; r < 100; r++) for (let c = 0; c < 100; c++) raster[r * 100 + c] = ground(x0 + c, r); return { raster, width: 100, height: 100, originX: x0, originY: 0, resX: 1, resY: 1, noData: -99999 }; };
  const groups = [{ identity: true, converter: null, tiles: [sheet(0), sheet(100)], lastTile: null }];
  let worst = 0;
  for (const y of [10.2, 40.7, 80.5]) for (let x = 95; x <= 105; x += 0.05) {
    // (asked from either side: whichever sheet was read last)
    for (const first of [0, 1]) { groups[0].lastTile = groups[0].tiles[first]; worst = Math.max(worst, Math.abs(sampleHeightAt(x, y, groups, null, -99999) - ground(x, y))); }
  }
  assert.ok(worst < 0.01, `worst misfit at the join ${worst.toFixed(3)} (a shelf was 0.15)`);
  // a sheet with no neighbour: its outer value holds to its edge, as before
  const alone = [{ identity: true, converter: null, tiles: [sheet(0)], lastTile: null }];
  assert.ok(Math.abs(sampleHeightAt(99.4, 10, alone, null, -99999) - ground(99, 10)) < 1e-6);
});

test('sheets padded with no-data meet along a slanted line inside their rectangles: still one slope', async () => {
  const { sampleHeightAt } = await import('../services/resamplerWorker.js');
  const ground = (x, y) => 0.3 * x + 0.1 * y; const ND = -9999;
  // both rectangles cover x 0..199; the west sheet has data up to a line slanting east with y, the east sheet from there on
  const edge = (y) => 100 + Math.floor(y / 7);
  const sheet = (west) => { const raster = new Float32Array(200 * 100); for (let r = 0; r < 100; r++) for (let c = 0; c < 200; c++) raster[r * 200 + c] = (west ? c <= edge(r) : c > edge(r)) ? ground(c, r) : ND; return { raster, width: 200, height: 100, originX: 0, originY: 0, resX: 1, resY: 1, noData: ND }; };
  const groups = [{ identity: true, converter: null, tiles: [sheet(true), sheet(false)], lastTile: null }];
  let worst = 0;
  for (let y = 5.3; y < 95; y += 3.1) for (let x = 95; x <= 120; x += 0.1) {
    for (const first of [0, 1]) { groups[0].lastTile = groups[0].tiles[first]; const v = sampleHeightAt(x, y, groups, null, ND); if (v !== ND) worst = Math.max(worst, Math.abs(v - ground(x, y))); }
  }
  assert.ok(worst < 0.01, `worst misfit along the slanted join ${worst.toFixed(3)}`);
});
