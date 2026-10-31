#!/usr/bin/env node
// Export one test area headless, the way the app does (roads conditioned into
// the terrain as terrain.js does, then exportBeamNGLevel).
//
//   node scripts/sweep/exportArea.mjs <area> [gpxz|t30] [levelName] [--out dir] [--fix-stubs]
//
// Writes <out>/<levelName>.zip (default scratch/sweep) and, beside it,
// <levelName>.checks.json (the export's structure checks). EXPORT_OPTS (JSON)
// adds export options (structures, terrain shaping); RAW=1 skips the data
// pull's road snapping and smoothing (the app's raw terrain); NOWIDTH=1 skips
// the street widths measured between the buildings (an A/B check). --fix-stubs puts
// real images where the headless canvas left stubs, so the level loads clean
// in game. STRUCT=v1|v2|v2-terrain picks the structure solver.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { exportBeamNGLevel } from '../../services/exportBeamNGLevel.js';
import { isGroundLevelRoad, smoothRoadsInHeightmap } from '../../services/roadSmoother.js';
import { snapRoadsToTerrain } from '../../services/roadSnap.js';
import { measureStreetWidths } from '../../services/streetWidths.js';
import { installCanvasPolyfill } from './polyfill.mjs';
import { AREAS_DIR, OUT_DIR, REPO } from './env.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
const [area, dem = 'gpxz', levelName = `sw_${area}`] = pos;
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : OUT_DIR;
if (!area) { console.error('usage: exportArea.mjs <area> [gpxz|t30] [levelName] [--out dir] [--fix-stubs]'); process.exit(2); }
const dir = path.join(AREAS_DIR, area);
if (!fs.existsSync(path.join(dir, `${dem}.f32`))) { console.error(`no ${dem}.f32 in ${dir} (fetch it: scripts/sweep/fetchArea.mjs)`); process.exit(2); }

installCanvasPolyfill();
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json')));
const osmFeatures = JSON.parse(fs.readFileSync(path.join(dir, 'osm.json')));
const heightMap = new Float32Array(fs.readFileSync(path.join(dir, `${dem}.f32`)).buffer.slice(0));
// as the app: fine terrain: roads onto its cut, then the light fine-mode
// smoothing; coarse (30 m): the full smoothing
// (RAW=1: as the app's raw terrain, the elevation left as fetched)
const fine = dem === 'gpxz';
const raw = !!process.env.RAW;
// (as the app's data pull: street widths from the buildings along them)
let osmRoads = process.env.NOWIDTH ? osmFeatures : measureStreetWidths(osmFeatures).features;
if (fine && !raw) osmRoads = snapRoadsToTerrain(heightMap, meta.size, meta.size, meta.bounds, osmRoads, meta.mpp, isGroundLevelRoad).features;
if (!raw) smoothRoadsInHeightmap(heightMap, meta.size, meta.size, meta.bounds, osmRoads, meta.mpp, { skipTracks: fine, fine });
let minHeight = Infinity; let maxHeight = -Infinity;
for (const v of heightMap) { if (v < minHeight) minHeight = v; if (v > maxHeight) maxHeight = v; }
const terrainData = {
  width: meta.size, height: meta.size, minHeight, maxHeight, bounds: meta.bounds, heightMap, osmFeatures: osmRoads,
  processingMetersPerPixel: meta.mpp, raw,
};

const t0 = Date.now();
const { blob, structureChecks } = await exportBeamNGLevel(terrainData, meta.center, {
  baseTexture: 'none', pbrSource: 'osm', roadType: 'decal', includeBackdrop: false,
  includeBuildings: true, applyFoundations: false, includeWater: true, seaLevelOffset: 0,
  includeTrees: true, includeRocks: false, includeNativeBarriers: true,
  ...(process.env.STRUCT ? { structureSolver: process.env.STRUCT } : {}),
  // measured bridge heights (US lidar): LIDAR=1 (off by default: the sweep stays offline and repeatable);
  // survey downloads cached under the sweep output's ept-cache
  lidarDecks: process.env.LIDAR === '1',
  ...(process.env.LIDAR === '1' ? { lidarProvider: async () => {
    const { createLazPerf } = await import('laz-perf');
    const cache = path.join(OUT_DIR, 'ept-cache');
    const fetchImpl = async (url) => {
      const file = path.join(cache, String(url).replace(/^https?:\/\//, '').replace(/[^\w.\-/]/g, '_'));
      if (fs.existsSync(file)) { const b = fs.readFileSync(file); return { ok: true, json: async () => JSON.parse(b), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }; }
      const r = await fetch(url);
      if (!r.ok) return r;
      const b = Buffer.from(await r.arrayBuffer());
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, b);
      return { ok: true, json: async () => JSON.parse(b), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) };
    };
    const index = JSON.parse(fs.readFileSync(path.join(REPO, 'public/ept-index.json'))).datasets;
    return { index, lp: await createLazPerf(), fetchImpl };
  } } : {}),
  // extra export options as JSON, e.g. EXPORT_OPTS='{"shapeTerrain":false}'
  ...(process.env.EXPORT_OPTS ? JSON.parse(process.env.EXPORT_OPTS) : {}),
  levelName, elevationSource: 'upload', requestedResolution: meta.size, requestedProcessingMetersPerPixel: meta.mpp,
  onProgress: ({ step, pct }) => { if (process.stderr.isTTY) process.stderr.write(`\r[${pct}%] ${String(step).slice(0, 70).padEnd(70)}`); },
});
if (process.stderr.isTTY) process.stderr.write('\n');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `${levelName}.zip`);
fs.writeFileSync(out, Buffer.from(await blob.arrayBuffer()));
if (structureChecks) fs.writeFileSync(out.replace(/\.zip$/, '.checks.json'), JSON.stringify(structureChecks, null, 1));
if (args.includes('--fix-stubs')) execFileSync('node', [new URL('./fixStubs.mjs', import.meta.url).pathname, out], { stdio: 'inherit' });
console.log(`exported ${area} (${dem}) in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${out}`);
