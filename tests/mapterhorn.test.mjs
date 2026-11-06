import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchMapterhornRaw, mapterhornZoomFor } from '../services/mapterhorn.js';

// a 1 km box near Zurich
const B = { north: 47.3745, south: 47.3655, west: 8.5334, east: 8.5466 };

// Fake tiles: every tile decodes to height = zoom * 100 (the decoder is stubbed through a fake canvas).
function fakeEnv({ maxZoomAt = () => 16 } = {}) {
  const requested = [];
  globalThis.document = {
    createElement: () => {
      let img = null;
      return {
        width: 0, height: 0,
        getContext: () => ({
          imageSmoothingEnabled: false,
          drawImage: (i) => { img = i; },
          getImageData: (x, y, w, h) => {
            const data = new Uint8ClampedArray(w * h * 4);
            const v = img.zoom * 100 + 32768;               // Terrarium: R*256 + G + B/256 - 32768
            for (let i = 0; i < w * h; i++) { data[i * 4] = v >> 8; data[i * 4 + 1] = v & 255; data[i * 4 + 3] = 255; }
            return { data };
          },
        }),
      };
    },
  };
  const loadImage = async (url) => {
    const [z, x, y] = url.match(/(\d+)\/(\d+)\/(\d+)\.webp$/).slice(1).map(Number);
    requested.push(z);
    return z <= maxZoomAt(x, y, z) ? { zoom: z } : null;
  };
  return { loadImage, requested };
}

test('zoom: the coarsest level still as fine as the map, within the memory budget', () => {
  // at 47 deg a z15 pixel is ~1.6 m, z16 ~0.8 m
  assert.equal(mapterhornZoomFor(B, 2), 15);
  assert.equal(mapterhornZoomFor(B, 1), 16);
  assert.equal(mapterhornZoomFor(B, 0.5), 17);
  // a 40 km box at 0.5 m would not fit in memory: zoomed out
  assert.ok(mapterhornZoomFor({ north: 47.55, south: 47.19, west: 8.27, east: 8.80 }, 0.5) < 17);
});

test('no tile deeper than z12 (no lidar): null, the standard 30 m fills in', async () => {
  const { loadImage } = fakeEnv({ maxZoomAt: () => 12 });
  assert.equal(await fetchMapterhornRaw(B, { metersPerPixel: 1, loadImage }), null);
});

test('lidar everywhere: overlapping 3857 chunks at the deepest zoom, pixel-centre origins', async () => {
  const { loadImage } = fakeEnv();
  const r = await fetchMapterhornRaw(B, { metersPerPixel: 1, loadImage });
  assert.equal(r.zoom, 16);
  assert.equal(r.lidarFraction, 1);
  assert.ok(r.tiles.length >= 1);
  const t = r.tiles[0];
  assert.equal(t.epsgCode, 3857);
  assert.ok(t.resY < 0 && Math.abs(t.resX + t.resY) < 1e-9);
  assert.equal(t.raster[0], 1600);
});

test('a missing deep tile at a lidar edge comes from its lidar ancestor, never from z12', async () => {
  // z16 only for even x; the rest of the area has z14
  const { loadImage } = fakeEnv({ maxZoomAt: (x, y, z) => (z === 16 ? (x % 2 === 0 ? 16 : 0) : 14) });
  const r = await fetchMapterhornRaw(B, { metersPerPixel: 1, loadImage });
  assert.equal(r.zoom, 16);
  const vals = new Set(); for (const t of r.tiles) for (let i = 0; i < t.raster.length; i += 997) vals.add(t.raster[i]);
  assert.ok(vals.has(1600) && vals.has(1400), [...vals].join(','));
  assert.ok(!vals.has(1200));
});

test('the stitched-heights budget: a 16 km area at 1 m gets ~0.8 m lidar on desktop, ~3.3 m in a browser', async () => {
  const { mapterhornMosaicBudget, mapterhornMetersPerPixel } = await import('../services/mapterhorn.js');
  const c = { lat: 45.5, lng: 6.94 }; const dLat = 8192 / 111320; const dLng = 8192 / (111320 * Math.cos((c.lat * Math.PI) / 180));
  const B = { north: c.lat + dLat, south: c.lat - dLat, east: c.lng + dLng, west: c.lng - dLng };
  assert.equal(mapterhornZoomFor(B, 1, { budget: mapterhornMosaicBudget(true) }), 16);
  assert.equal(mapterhornZoomFor(B, 1, { budget: mapterhornMosaicBudget(false) }), 14);
  assert.ok(Math.abs(mapterhornMetersPerPixel(16, c.lat) - 0.84) < 0.02);
});
