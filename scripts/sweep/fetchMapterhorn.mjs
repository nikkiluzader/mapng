#!/usr/bin/env node
// Mapterhorn lidar for a test area already fetched (fetchArea.mjs): the
// elevation most people's levels are built from ("Best free"), resampled the
// way the app does, beside the area's GPXZ and 30 m grids.
//
//   node scripts/sweep/fetchMapterhorn.mjs <area>...
//
// Writes <MAPNG_AREAS>/<area>/mh.f32 (and "mh" into meta.json); export it with
//   node scripts/sweep/exportArea.mjs <area> mh
// Tiles come straight from tiles.mapterhorn.com (the app's /api/mapterhorn
// cache is the same tiles). Needs the desktop runner's canvas (desktop/node_modules).
import fs from 'node:fs';
import path from 'node:path';
import { AREAS_DIR } from './env.mjs';

const { installBrowserShims } = await import('../../desktop/runner/browserShims.mjs');
installBrowserShims({ assetsDir: new URL('../../public', import.meta.url).pathname });
const { fetchMapterhornRaw, MAPTERHORN_CACHE_URL, MAPTERHORN_TILE_URL } = await import('../../services/mapterhorn.js');
const { resampleToMeterGrid } = await import('../../services/terrainResampler.js');

const base = globalThis.fetch;
globalThis.fetch = (url, init = {}) => {
  const u = String(url?.url || url);
  const headers = new Headers(init.headers || {});
  if (!headers.has('User-Agent')) headers.set('User-Agent', 'MapNG-sweep/1.0 (local test tool)');
  return base(u.startsWith(MAPTERHORN_CACHE_URL) ? MAPTERHORN_TILE_URL + u.slice(MAPTERHORN_CACHE_URL.length) : url, { ...init, headers });
};

const names = process.argv.slice(2);
if (!names.length) { console.error('usage: fetchMapterhorn.mjs <area>...'); process.exit(2); }
for (const name of names) {
  const dir = path.join(AREAS_DIR, name);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json')));
  const mpp = meta.mpp || 1;
  const mh = await fetchMapterhornRaw(meta.fetchBounds || meta.bounds, { metersPerPixel: mpp });
  if (!mh?.tiles?.length) { console.warn(name, 'no Mapterhorn lidar here: nothing written'); continue; }
  const out = await resampleToMeterGrid({ type: 'grid', data: { tiles: mh.tiles } }, meta.center, meta.size, meta.size, 'bilinear', mh.metersPerPixel > 4, true, meta.bounds, true);
  fs.writeFileSync(path.join(dir, 'mh.f32'), Buffer.from(out.heightMap.buffer));
  meta.mh = { zoom: mh.zoom, metersPerPixel: mh.metersPerPixel, lidarFraction: mh.lidarFraction, tiles: mh.tilesFetched };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 1));
  let lo = Infinity; let hi = -Infinity; for (const v of out.heightMap) { if (v < lo) lo = v; if (v > hi) hi = v; }
  console.log(`${name}: mh.f32 ${meta.size}x${meta.size} from z${mh.zoom} (~${mh.metersPerPixel.toFixed(2)} m), lidar on ${Math.round(mh.lidarFraction * 100)} %, heights ${lo.toFixed(1)}..${hi.toFixed(1)} m`);
}
process.exit(0);
