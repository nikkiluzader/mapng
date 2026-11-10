// The backdrop's satellite imagery quality (services/backdropImagery.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { backdropImageryPlan, backdropImageryFetch, backdropImageryId, WEB_STITCH_LIMIT_PX, DESKTOP_STITCH_LIMIT_PX } from '../services/backdropImagery.js';

// a square map `km` across at 35° N
const box = (km) => { const lat = km / 111.32; const lng = km / (111.32 * Math.cos((35 * Math.PI) / 180)); return { south: 35, north: 35 + lat, west: -111, east: -111 + lng }; };

test('standard is the imagery the backdrop has always had: no change to its downloads', () => {
  assert.deepEqual(backdropImageryFetch({ quality: 'standard', bounds: box(1) }), {});
  assert.equal(backdropImageryId('nonsense'), 'standard');
  const p = backdropImageryPlan({ quality: 'standard', bounds: box(1) });
  assert.equal(p.zoom, 15); assert.ok(p.metresPerPixel > 3.5 && p.metresPerPixel < 4.5, `${p.metresPerPixel} m per pixel`);
});

test('finer qualities: a higher zoom, more tiles, textures no finer than their source', () => {
  const std = backdropImageryPlan({ quality: 'standard', bounds: box(1) });
  const high = backdropImageryPlan({ quality: 'high', bounds: box(1) });
  const very = backdropImageryPlan({ quality: 'veryhigh', bounds: box(1) });
  assert.ok(high.zoom === 16 && very.zoom === 17);
  assert.ok(std.tiles < high.tiles && high.tiles < very.tiles, `${std.tiles} ${high.tiles} ${very.tiles}`);
  assert.ok(very.metresPerPixel < 1.2);
  // (a 1 km tile at about 1 m a pixel is about 1000 px across: a 1024 texture, not 4096)
  assert.equal(very.textureSize, 1024);
  assert.equal(backdropImageryPlan({ quality: 'veryhigh', bounds: box(4) }).textureSize, 4096);
  assert.deepEqual(Object.keys(backdropImageryFetch({ quality: 'high', bounds: box(1), stitchLimit: WEB_STITCH_LIMIT_PX })).sort(), ['maxStitchPx', 'satelliteSize', 'satelliteZoom']);
});

test('a large area is stepped down to what the stitched picture can hold: sooner in a browser tab than on the desktop', () => {
  const web = backdropImageryPlan({ quality: 'veryhigh', bounds: box(8), stitchLimit: WEB_STITCH_LIMIT_PX });
  const desk = backdropImageryPlan({ quality: 'veryhigh', bounds: box(8), stitchLimit: DESKTOP_STITCH_LIMIT_PX });
  assert.ok(web.limited && web.zoom < 17, `web zoom ${web.zoom}`);
  assert.ok(web.stitchPx <= WEB_STITCH_LIMIT_PX && desk.stitchPx <= DESKTOP_STITCH_LIMIT_PX);
  assert.ok(desk.zoom > web.zoom, `desktop ${desk.zoom} vs web ${web.zoom}`);
  assert.equal(backdropImageryPlan({ quality: 'veryhigh', bounds: box(1), stitchLimit: WEB_STITCH_LIMIT_PX }).limited, false, 'a small map is not limited');
  assert.equal(backdropImageryFetch({ quality: 'veryhigh', bounds: box(8), stitchLimit: WEB_STITCH_LIMIT_PX }).satelliteZoom, web.zoom);
});
