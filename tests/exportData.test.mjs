import test from 'node:test';
import assert from 'node:assert/strict';
import { isDataRequest, dataCacheKey, withDownloadGuard, noteGuardMiss, guardMisses } from '../services/dataCache.js';

test('the download cache keeps map data, not the app or its live services', () => {
  const origin = 'https://mapng.com';
  assert.equal(isDataRequest('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/1/2.png', 'GET', origin), true);
  assert.equal(isDataRequest('/api/osm-tiles/12/3/4', 'GET', origin), true);
  assert.equal(isDataRequest('https://overpass.example/api/interpreter', 'POST', origin), true);
  assert.equal(isDataRequest('/cubemap/skybox0.hdr.dds', 'GET', origin), false, 'the app\'s own files');
  assert.equal(isDataRequest('https://mapng.com/assets/x.js', 'GET', origin), false);
  for (const live of ['/api/usage', '/api/share/ABC', '/api/crash', 'https://api.github.com/repos/x/releases/latest', '/api/nominatim-geocode/search?q=x']) {
    assert.equal(isDataRequest(live, 'GET', origin), false, live);
  }
  assert.equal(isDataRequest('https://example.com/upload', 'POST', origin), false, 'only Overpass posts');
  assert.equal(isDataRequest('blob:https://mapng.com/123', 'GET', origin), false);
});

test('cache keys: keys and tokens out of the URL, the Range asked for and a POST body in', () => {
  const a = dataCacheKey('https://api.example/raster?x=1&key=SECRET');
  assert.ok(!a.includes('SECRET'));
  assert.equal(a, dataCacheKey('https://api.example/raster?x=1&key=OTHER'));
  assert.notEqual(dataCacheKey('https://x/ept.laz', { headers: { Range: 'bytes=0-99' } }), dataCacheKey('https://x/ept.laz', { headers: { Range: 'bytes=100-199' } }));
  assert.notEqual(dataCacheKey('https://o/api/interpreter', { method: 'POST', body: 'a' }), dataCacheKey('https://o/api/interpreter', { method: 'POST', body: 'b' }));
});

test('the download guard counts what the export still downloads, and refuses it when strict', async () => {
  await withDownloadGuard(async () => { noteGuardMiss('https://x/1'); noteGuardMiss('https://x/2'); }, { strict: false });
  assert.deepEqual(guardMisses(), ['https://x/1', 'https://x/2']);
  await assert.rejects(withDownloadGuard(async () => { noteGuardMiss('https://x/3'); }, { strict: true }), /tried to download/);
  noteGuardMiss('https://x/4');   // (guard off: nothing)
  await withDownloadGuard(async () => {}, { strict: false });
  assert.deepEqual(guardMisses(), []);
});

const terrain = (w, h, extra = {}) => ({
  width: w, height: h, minHeight: 0, maxHeight: 10, heightMap: new Float32Array(w * h).fill(5),
  bounds: { north: 1, south: 0, west: 0, east: 1.5 },
  osmFeatures: [{ id: 'b', type: 'road', tags: { highway: 'primary', bridge: 'yes' }, geometry: [{ lat: 0.5, lng: 0.4 }, { lat: 0.5, lng: 0.6 }] }],
  ...extra,
});

test('the data step: what it needs, cropped exactly as the export crops', async () => {
  const { exportDataNeeds } = await import('../services/exportData.js');
  const { exportDataInputs } = await import('../services/exportBeamNGLevel.js');
  const { prepareCroppedTerrainData } = await import('../services/cropTerrain.js');
  const td = terrain(48, 32);
  assert.equal(exportDataNeeds(td, { includeBackdrop: false, roadType: 'none' }), null, 'nothing to download');
  const n = exportDataNeeds(td, { includeBackdrop: true, backdropElevationSource: 'global30m' });
  assert.ok(n.backdrop && n.lidar && n.key);
  assert.equal(exportDataNeeds(td, { includeBackdrop: false, lidarDecks: false }), null);
  assert.equal(exportDataNeeds(terrain(48, 32, { osmFeatures: [] }), { includeBackdrop: false }), null, 'no bridges: no survey');
  const { terrainData: inp } = exportDataInputs(td);
  const cropped = await prepareCroppedTerrainData({ ...td, exportCropSize: 32 });
  assert.equal(inp.width, 32); assert.equal(inp.height, 32);
  assert.deepEqual(inp.bounds, cropped.bounds);
  assert.equal(inp.minHeight, cropped.minHeight); assert.equal(inp.maxHeight, cropped.maxHeight);
});

test('the data step runs once per area and options: the panel and the export share it', async () => {
  const { ensureExportData, exportDataState, resetExportData } = await import('../services/exportData.js');
  resetExportData();
  const td = terrain(32, 32);
  const opts = { includeBackdrop: true, backdropElevationSource: 'global30m', lidarDecks: false };
  let runs = 0;
  const run = async (_td, _o, onProgress) => { runs++; onProgress('half', 0.5); await new Promise((r) => setTimeout(r, 20)); return { backdrop: true }; };
  const a = ensureExportData(td, opts, { run });
  assert.equal(exportDataState(td, opts).status, 'running');
  const b = ensureExportData(td, opts, { run });
  await Promise.all([a, b]);
  assert.equal(runs, 1);
  assert.equal(exportDataState(td, opts).status, 'done');
  // another backdrop source: its own step
  await ensureExportData(td, { ...opts, backdropElevationSource: 'usgs1m' }, { run });
  assert.equal(runs, 2);
  // a failed step is tried again
  const bad = { ...opts, backdropElevationSource: 'gpxz' };
  await assert.rejects(ensureExportData(td, bad, { run: async () => { throw new Error('offline'); } }));
  assert.equal(exportDataState(td, bad).status, 'failed');
  await ensureExportData(td, bad, { run });
  assert.equal(exportDataState(td, bad).status, 'done');
});
