#!/usr/bin/env node
// Fetch one test area: GPXZ (hires-raster, res_m=best) and the global 30 m
// Terrarium heightmap resampled the way fetchTerrainData does, plus OSM (through
// the custom Overpass endpoint TRACESTRACK_API_URL when set, as the app's
// custom-server option; the public mirrors otherwise).
//
//   node scripts/sweep/fetchArea.mjs <name> <lat> <lng> [size=1024]   (MPP=1)
//   node scripts/sweep/fetchArea.mjs --catalog [name...]   areas.json entries not yet fetched
//   OSM_ONLY=1 node scripts/sweep/fetchArea.mjs <name> <lat> <lng> [size]   osm.json again, elevation kept
//
// Writes <MAPNG_AREAS>/<name>/{gpxz.tif, gpxz.f32, t30.f32, osm.json, meta.json}.
// An area whose OSM came back near empty (an outage) is refused, not saved.
import fs from 'node:fs';
import path from 'node:path';
import { decode } from 'fast-png';
import * as GeoTIFF from 'geotiff';
import { createLocalToWGS84 } from '../../services/geoUtils.js';
import { resampleToMeterGrid } from '../../services/terrainResampler.js';
import { decodeTerrariumPixels, blendTerrariumTileSeams, sampleTerrariumHeights, wrapMosaicX } from '../../services/terrariumSampling.js';
import { AREAS_DIR, areas, key } from './env.mjs';

const MIN_OSM_FEATURES = 50;
const args = process.argv.slice(2);
let jobs;
if (args[0] === '--catalog') {
  const want = new Set(args.slice(1));
  jobs = areas().filter((a) => (!want.size || want.has(a.name)) && !fs.existsSync(path.join(AREAS_DIR, a.name, 'osm.json')));
} else {
  const [name, lat, lng, size] = args;
  if (!name || !Number.isFinite(+lat) || !Number.isFinite(+lng)) { console.error('usage: fetchArea.mjs <name> <lat> <lng> [size=1024] | --catalog [name...]'); process.exit(2); }
  jobs = [{ name, lat: +lat, lng: +lng, size: +(size || 1024) }];
}
const KEY = key('GPXZ_API_KEY');
if (!KEY) throw new Error('GPXZ_API_KEY missing (~/.config/mapng/mapng.env)');

const realFetchBase = globalThis.fetch;
// (merged through Headers: PMTiles passes a Headers object, which a spread empties, dropping its Range header)
globalThis.fetch = (url, init = {}) => { const headers = new Headers(init.headers || {}); if (!headers.has('User-Agent')) headers.set('User-Agent', 'MapNG-sweep/1.0 (local diagnostics)'); return realFetchBase(url, { ...init, headers }); };

async function fetchOne({ name, lat, lng, size }) {
  const center = { lat, lng }; const SIZE = size || 1024;
  // (a level's terrain is a power of two: 1536 quietly came out cut to 1024)
  if (Math.log2(SIZE) % 1) throw new Error(`size ${SIZE} is no power of two`); const MPP = +(process.env.MPP || 1); const NO_DATA = -99999;
  const OUT = path.join(AREAS_DIR, name);
  fs.mkdirSync(OUT, { recursive: true });

  // computeMetricFetchBounds (terrain.js)
  const toWGS84 = createLocalToWGS84(center.lat, center.lng);
  const hw = SIZE * MPP / 2 + 4;
  // (longitudes kept next to the centre's, as terrain.js unwrapLngNearRef: on
  // the date line 179.99 and -179.99 are neighbours, not a world apart)
  const unwrap = (x) => { let o = x; while (o - center.lng > 180) o -= 360; while (o - center.lng < -180) o += 360; return o; };
  const corners = [[-hw, hw], [hw, hw], [-hw, -hw], [hw, -hw]].map((c) => toWGS84.forward(c)).map(([x, y]) => [unwrap(x), y]);
  const bounds = {
    north: Math.max(...corners.map((c) => c[1])), south: Math.min(...corners.map((c) => c[1])),
    east: Math.max(...corners.map((c) => c[0])), west: Math.min(...corners.map((c) => c[0])),
  };

  // (OSM_ONLY=1: the elevation already fetched kept, only osm.json fetched again)
  if (!process.env.OSM_ONLY) {
  // ── GPXZ ──
  // (T30_ONLY=1: no GPXZ, whose raster stops at 10 km² an account; the global 30 m alone)
  let gpxzSmooth = false, resolutions = [], gpxz = null, image = null, rasterRes = null;
  if (!process.env.T30_ONLY) {
  {
    const latIn = (bounds.north - bounds.south) * 0.2, lngIn = (bounds.east - bounds.west) * 0.2;
    const cLat = (bounds.north + bounds.south) / 2, cLng = (bounds.east + bounds.west) / 2;
    const pts = [[cLat, cLng], [bounds.north - latIn, bounds.west + lngIn], [bounds.north - latIn, bounds.east - lngIn], [bounds.south + latIn, bounds.west + lngIn], [bounds.south + latIn, bounds.east - lngIn]];
    const r = await fetch(`https://api.gpxz.io/v1/elevation/points?latlons=${encodeURIComponent(pts.map((p) => p.join(',')).join('|'))}`, { headers: { 'x-api-key': KEY } });
    if (r.ok) {
      const j = await r.json();
      resolutions = j.results.map((x) => ({ res: Number(x.resolution), src: x.data_source }));
      // (as the app: water points left out where land was sampled too)
      const landRes = resolutions.filter((x) => !/bathymetry|gebco|emod/i.test(String(x.src || '')));
      const rs = landRes.map((x) => x.res).filter(Number.isFinite).sort((a, b) => a - b);
      const coarse = rs.filter((x) => x > 2).length;
      gpxzSmooth = coarse >= Math.ceil(rs.length / 2) && rs[Math.floor(rs.length / 2)] > 2;
    } else console.warn('points', r.status);
  }
  const B = 0.002;
  // (the raster API takes 10 km2 a request: a bigger area in a grid of overlapping tiles, as the app)
  const areaKm2 = (SIZE * MPP / 1000) ** 2 * 1.25;
  const nTiles = areaKm2 > 9 ? Math.ceil(Math.sqrt(areaKm2 / 8)) : 1;
  const tiles = [];
  const dLat = (bounds.north - bounds.south) / nTiles; const dLng = (bounds.east - bounds.west) / nTiles;
  for (let ty = 0; ty < nTiles; ty++) for (let tx = 0; tx < nTiles; tx++) {
    const n = bounds.north - ty * dLat + B; const sB = bounds.north - (ty + 1) * dLat - B;
    const w = bounds.west + tx * dLng - B; const e = bounds.west + (tx + 1) * dLng + B;
    const rurl = `https://api.gpxz.io/v1/elevation/hires-raster?bbox_top=${n}&bbox_bottom=${sB}&bbox_left=${w}&bbox_right=${e}&res_m=best&projection=best&tight_bounds=false`;
    const rr = await fetch(rurl, { headers: { 'x-api-key': KEY } });
    if (!rr.ok) throw new Error(`hires-raster ${rr.status} ${await rr.text()}`);
    const tiffBuf = await rr.arrayBuffer();
    fs.writeFileSync(nTiles > 1 ? `${OUT}/gpxz_${ty}_${tx}.tif` : `${OUT}/gpxz.tif`, Buffer.from(tiffBuf));
    const tiff = await GeoTIFF.fromArrayBuffer(tiffBuf);
    const img = await tiff.getImage();
    tiles.push({ image: img, raster: (await img.readRasters())[0] });
    image = img;
  }
  rasterRes = image.getResolution();
  if (nTiles > 1) console.log(name, 'gpxz in', tiles.length, 'tiles');
  gpxz = await resampleToMeterGrid({ type: 'geotiff', data: tiles }, center, SIZE, SIZE, 'bilinear', gpxzSmooth, true, bounds, true);
  fs.writeFileSync(`${OUT}/gpxz.f32`, Buffer.from(gpxz.heightMap.buffer));
  }

  // ── global 30 m (Terrarium z15), as fetchTerrainData ──
  const Z = 15, TS = 256;
  const proj = (lat, lng) => { const s = Math.sin(lat * Math.PI / 180), z = TS * 2 ** Z; return { x: (lng + 180) / 360 * z, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * z }; };
  const nw = proj(bounds.north, bounds.west), se = proj(bounds.south, bounds.east);
  const minTx = Math.floor(nw.x / TS), maxTx = Math.floor(se.x / TS), minTy = Math.floor(nw.y / TS), maxTy = Math.floor(se.y / TS);
  const MW = (maxTx - minTx + 1) * TS, MH = (maxTy - minTy + 1) * TS;
  const rgba = new Uint8Array(MW * MH * 4);
  for (let ty = minTy; ty <= maxTy; ty++) for (let tx = minTx; tx <= maxTx; tx++) {
    const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${((tx % 2 ** Z) + 2 ** Z) % 2 ** Z}/${ty}.png`);
    const png = decode(new Uint8Array(await res.arrayBuffer()));
    const ch = png.channels ?? png.data.length / (png.width * png.height);
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      const p = (y * TS + x) * ch, q = (((ty - minTy) * TS + y) * MW + (tx - minTx) * TS + x) * 4;
      rgba[q] = png.data[p]; rgba[q + 1] = png.data[p + 1]; rgba[q + 2] = png.data[p + 2]; rgba[q + 3] = 255;
    }
  }
  const th = decodeTerrariumPixels(rgba, MW, MH, NO_DATA);
  blendTerrariumTileSeams(th, MW, MH, NO_DATA);
  const sampler = (lat, lng) => { const p = proj(lat, lng); return sampleTerrariumHeights(th, MW, MH, wrapMosaicX(p.x - minTx * TS, Z, MW, TS), p.y - minTy * TS, NO_DATA); };
  const sigmaPx = 5 / MPP, smoothR = Math.round((Math.sqrt(6 * sigmaPx * sigmaPx + 1) - 1) / 2);
  const t30 = await resampleToMeterGrid({ type: 'sampler', sampler }, center, SIZE, SIZE, 'bilinear', smoothR >= 1 ? smoothR : false, true, bounds, true);
  fs.writeFileSync(`${OUT}/t30.f32`, Buffer.from(t30.heightMap.buffer));

  fs.writeFileSync(`${OUT}/meta.json`, JSON.stringify({ name, center, size: SIZE, mpp: MPP, fetchBounds: bounds, bounds: (gpxz || t30).bounds, gpxzSmooth, resolutions, rasterRes, rasterSize: image ? [image.getWidth(), image.getHeight()] : null }, null, 1));
  console.log(name, 'gpxz res', resolutions.map((r) => `${r.res}m ${r.src}`).join(', '), 'smooth', gpxzSmooth, 'raster', rasterRes, image?.getWidth(), image?.getHeight());
  }

  // ── OSM ──
  const url = key('TRACESTRACK_API_URL');
  if (url) {
    const store = new Map([['mapng_customOverpassUrl', url]]);
    globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  }
  globalThis.location ||= { protocol: 'https:' };
  const { fetchOSMData } = await import('../../services/osm.js');
  const features = await fetchOSMData(JSON.parse(fs.readFileSync(path.join(OUT, 'meta.json'))).bounds);
  if (features.length < MIN_OSM_FEATURES) {
    fs.rmSync(path.join(OUT, 'meta.json'));
    throw new Error(`${name}: only ${features.length} OSM features (an outage?): not saved, try again`);
  }
  fs.writeFileSync(path.join(OUT, 'osm.json'), JSON.stringify(features));
  console.log(name, 'osm features', features.length, 'roads', features.filter((x) => x.tags?.highway).length);
}

for (const job of jobs) {
  try { await fetchOne(job); } catch (err) { console.error(String(err?.message || err)); process.exitCode = 1; }
}
