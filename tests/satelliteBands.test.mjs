// The desktop app samples the satellite texture in lattice row bands on every
// core (services/resamplerWorker.js): the bands must make exactly the texture
// the one-pass sampler makes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleSatelliteTexture, satelliteLatticeRows } from '../services/satelliteImageSampler.js';

test('the satellite texture sampled in bands equals the one-pass texture', () => {
  for (const [W, H, outW, outH] of [[300, 257, 300, 257], [200, 200, 400, 400], [129, 65, 129, 65]]) {
    const mw = 520; const mh = 480;
    const pixels = new Uint8ClampedArray(mw * mh * 4);
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 2654435761) >>> 24;
    const gridToMosaic = (gx, gy) => [gx * 1.13 + 3 + 0.0004 * gy * gy, gy * 1.21 + 5 + 0.0003 * gx * gx];
    const mosaic = { pixels, width: mw, height: mh };
    const full = sampleSatelliteTexture({ width: W, height: H, outWidth: outW, outHeight: outH, mosaic, gridToMosaic });
    const out = new Uint8ClampedArray(outW * outH * 4);
    const rows = satelliteLatticeRows(outH);
    for (let j = 0; j < rows; j += 3) sampleSatelliteTexture({ width: W, height: H, outWidth: outW, outHeight: outH, mosaic, gridToMosaic, out, latticeRows: [j, j + 3] });
    assert.deepEqual(out, full, `${outW}x${outH}`);
  }
});
