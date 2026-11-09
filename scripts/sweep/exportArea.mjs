#!/usr/bin/env node
// Export one test area headless, the way the app does (roads conditioned into
// the terrain as terrain.js does, then exportBeamNGLevel).
//
//   node scripts/sweep/exportArea.mjs <area> [gpxz|t30] [levelName] [--out dir] [--fix-stubs]
//
// Writes <out>/<levelName>.zip (default scratch/sweep) and, beside it,
// <levelName>.checks.json (the export's structure checks). EXPORT_OPTS (JSON)
// adds export options (structures, terrain shaping); PREPROCESSED=1 takes the OSM as the app's
// data step left it (an area made from the desktop app's terrain cache); RAW=1 skips the data
// pull's road snapping and smoothing (the app's raw terrain); NOWIDTH=1 skips
// the street widths measured between the buildings (an A/B check). --fix-stubs puts
// real images where the headless canvas left stubs, so the level loads clean
// in game. STRUCT=v1|v2|v2-terrain picks the structure solver.
// Spawn and quicktravel points go in EXPORT_OPTS too, as the app's step 1
// keeps them (services/spawnPoints.js): EXPORT_OPTS='{"points":[{"name":"Pit",
// "lat":..,"lng":..,"heading":90,"isDefault":true}]}'. SHIMS=1 draws with the
// desktop runner's real canvas (as BACKDROP=1 does) so their preview photos
// are real JPEGs, not stubs.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { exportBeamNGLevel } from '../../services/exportBeamNGLevel.js';
import { fetchTreeSpeciesMix } from '../../services/treeSpecies.js';
import { isGroundLevelRoad, smoothRoadsInHeightmap } from '../../services/roadSmoother.js';
import { snapRoadsToTerrain } from '../../services/roadSnap.js';
import { measureStreetWidths } from '../../services/streetWidths.js';
import { roundRoadCorners } from '../../services/roadCurves.js';
import { fitTwinCarriageways } from '../../services/twinCarriageways.js';
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
// (BACKDROP=1: the backdrop loads images, so the desktop export runner's browser shims, as the app)
if (process.env.BACKDROP === '1' || process.env.SHIMS === '1') {
  const { installBrowserShims } = await import('../../desktop/runner/browserShims.mjs');
  installBrowserShims({ assetsDir: new URL('../../public', import.meta.url).pathname });
}
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json')));
const osmFeatures = JSON.parse(fs.readFileSync(path.join(dir, 'osm.json')));
const heightMap = new Float32Array(fs.readFileSync(path.join(dir, `${dem}.f32`)).buffer.slice(0));
// as the app: fine terrain: roads onto its cut, then the light fine-mode
// smoothing; coarse (30 m): the full smoothing
// (RAW=1: as the app's raw terrain, the elevation left as fetched)
// (GPXZ outside its lidar: the app smooths it as 30 m, and it is coarse)
const fine = dem === 'gpxz' && !meta.gpxzSmooth;
const raw = !!process.env.RAW;
// (as the app's data pull: street widths from the buildings along them)
// (corners rounded into arcs first, as terrain.js shapeRoads: without it wide
// roads kinked at every OSM vertex and lost wedges of asphalt there)
// (PREPROCESSED=1: the OSM is the app's own data-step output, corners, widths and twin carriageways already done)
const rounded = process.env.PREPROCESSED ? osmFeatures : roundRoadCorners(osmFeatures).features;
let osmRoads = process.env.NOWIDTH || process.env.PREPROCESSED ? rounded : fitTwinCarriageways(measureStreetWidths(rounded).features).features;
if (fine && !raw) osmRoads = snapRoadsToTerrain(heightMap, meta.size, meta.size, meta.bounds, osmRoads, meta.mpp, isGroundLevelRoad).features;
if (!raw) smoothRoadsInHeightmap(heightMap, meta.size, meta.size, meta.bounds, osmRoads, meta.mpp, { skipTracks: fine, fine });
let minHeight = Infinity; let maxHeight = -Infinity;
for (const v of heightMap) { if (v < minHeight) minHeight = v; if (v > maxHeight) maxHeight = v; }
// (the land cover, as the app attaches at Generate: WorldCover, cached beside the area's data)
const landCoverFile = path.join(dir, 'landcover.bin');
const lcN = Math.ceil(meta.size * meta.mpp / 10);
if (!fs.existsSync(landCoverFile)) {
  try { const { fetchWorldCoverGrid } = await import('../../services/worldCover.js'); fs.writeFileSync(landCoverFile, await fetchWorldCoverGrid(meta.bounds, lcN, lcN)); } catch (e) { console.warn('no land cover:', e?.message || e); }
}
const landCover = fs.existsSync(landCoverFile) ? { grid: new Uint8Array(fs.readFileSync(landCoverFile)), n: lcN } : null;
const terrainData = {
  width: meta.size, height: meta.size, minHeight, maxHeight, bounds: meta.bounds, heightMap, osmFeatures: osmRoads,
  processingMetersPerPixel: meta.mpp, raw,
  coarseElevation: !fine && !raw,
  landCover,
};

// the base texture: the app's Game Texture (the recommended one users get),
// painted in Node by the app's own generateGameTexture (gametexnode.mjs, a
// real canvas: NAPI_CANVAS = @napi-rs/canvas) once per area, cached beside
// the area's data; BASE=none for none
const baseTexture = process.env.BASE || 'game';
if (baseTexture === 'game') {
  const png = path.join(dir, 'gametex.png');
  if (!fs.existsSync(png)) execFileSync('node', [path.join(REPO, 'scripts/sweep/gametexnode.mjs'), area, png], { stdio: 'inherit' });
  terrainData.gameTextureBlob = new Blob([fs.readFileSync(png)], { type: 'image/png' });
}

// the local tree mix (services/treeSpecies.js): asked of iNaturalist once
// per area, cached beside its data (the sweep stays offline and repeatable;
// TREEMIX=climate for the climate rule alone)
let treeSpeciesMix = null;
if (process.env.TREEMIX !== 'climate') {
  const cache = path.join(dir, 'tree_mix.json');
  if (fs.existsSync(cache)) treeSpeciesMix = JSON.parse(fs.readFileSync(cache, 'utf8'));
  else {
    treeSpeciesMix = await fetchTreeSpeciesMix(meta.bounds);
    if (treeSpeciesMix) fs.writeFileSync(cache, JSON.stringify(treeSpeciesMix, null, 1));
  }
}

const t0 = Date.now();
// (BACKDROP=1: the water round the map too, as the app's data step fetches it; cached beside the area)
let surroundingWater = null;
if (process.env.BACKDROP === '1') {
  const f = path.join(dir, 'backdrop_water.json');
  if (fs.existsSync(f)) surroundingWater = JSON.parse(fs.readFileSync(f, 'utf8'));
  else {
    try {
      const { fetchOsmWater } = await import('../../services/osm.js');
      const { backdropBounds } = await import('../../services/exportData.js');
      const { exportDataInputs } = await import('../../services/exportBeamNGLevel.js');
      surroundingWater = await fetchOsmWater(backdropBounds(exportDataInputs(terrainData).terrainData.bounds));
      fs.writeFileSync(f, JSON.stringify(surroundingWater));
    } catch (e) { console.warn('no backdrop water:', e?.message || e); }
  }
}
// (STEP_CACHE=<dir>: the desktop runner's step cache, so a second run reuses what it can)
const stepCache = process.env.STEP_CACHE ? (await import('../../desktop/runner/diskStepCache.mjs')).diskStepCache(process.env.STEP_CACHE) : null;
const { blob, structureChecks, steps: stepTimes } = await exportBeamNGLevel(terrainData, meta.center, {
  treeSpeciesMix, stepCache, ...(stepCache ? { stepCodeVersion: 'sweep' } : {}), ...(surroundingWater ? { surroundingWater } : {}),
  baseTexture, pbrSource: 'osm', roadType: 'decal', includeBackdrop: process.env.BACKDROP === '1',
  includeBuildings: true, includeWater: true, seaLevelOffset: 0,
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
  // (or EXPORT_OPTS=@file.json: the options in a file)
  ...(process.env.EXPORT_OPTS ? JSON.parse(process.env.EXPORT_OPTS.startsWith('@') ? fs.readFileSync(process.env.EXPORT_OPTS.slice(1), 'utf8') : process.env.EXPORT_OPTS) : {}),
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
// (STEPS=1: each export step's time)
if (process.env.STEPS === '1') for (const st of stepTimes || []) console.log(`step ${(st.ms / 1000).toFixed(2).padStart(7)} s  ${st.step.slice(0, 90)}`);
