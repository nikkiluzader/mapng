import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { addSourceData, SOURCE_DATA_DIR } from '../services/exportBeamNGLevel.js';

// The map data a level was built from, bundled for bug reports: the sweep's test-area format (osm.json + meta.json,
// scripts/sweep/exportArea.mjs) with the ODbL notice, in a folder the game never reads.
test('the map data goes into the level as a test area, with its licence notice', async () => {
  const zip = new JSZip();
  const features = [
    { id: '1_seg_0', type: 'road', tags: { highway: 'residential' }, geometry: [{ lat: 45.5, lng: 6.9 }, { lat: 45.501, lng: 6.901 }] },
    { id: '2', type: 'building', tags: { building: 'yes' }, geometry: [{ lat: 45.5, lng: 6.9 }, { lat: 45.5, lng: 6.9001 }, { lat: 45.5001, lng: 6.9001 }] },
  ];
  const bounds = { north: 45.51, south: 45.49, east: 6.91, west: 6.89 };
  const out = addSourceData(zip, 'levels/t', { features, terrainData: { width: 2048, processingMetersPerPixel: 1, bounds }, center: { lat: 45.5, lng: 6.9 }, levelName: 't', sessionCode: 'mapng:1:abc' });
  assert.equal(out.features, 2);
  // (a checksum of the file as written: the same data, the same checksum; other data, another)
  assert.match(out.checksum, /^[0-9a-f]{14}$/);
  assert.equal(addSourceData(new JSZip(), 'levels/u', { features, terrainData: { width: 2048, bounds }, center: { lat: 45.5, lng: 6.9 }, levelName: 'u' }).checksum, out.checksum);
  assert.notEqual(addSourceData(new JSZip(), 'levels/u', { features: features.slice(1), terrainData: { width: 2048, bounds }, center: {}, levelName: 'u' }).checksum, out.checksum);
  const osm = JSON.parse(await zip.file(`levels/t/${SOURCE_DATA_DIR}/osm.json`).async('string'));
  assert.deepEqual(osm, features);
  const meta = JSON.parse(await zip.file(`levels/t/${SOURCE_DATA_DIR}/meta.json`).async('string'));
  assert.equal(meta.size, 2048); assert.equal(meta.mpp, 1); assert.deepEqual(meta.bounds, bounds);
  assert.deepEqual(meta.center, { lat: 45.5, lng: 6.9 }); assert.equal(meta.preprocessed, true); assert.equal(meta.sessionCode, 'mapng:1:abc');
  assert.match(await zip.file(`levels/t/${SOURCE_DATA_DIR}/LICENSE.txt`).async('string'), /Open Database\s+License/);
});

test('no map data, nothing bundled', () => {
  const zip = new JSZip();
  assert.equal(addSourceData(zip, 'levels/t', { features: [], terrainData: {}, center: {}, levelName: 't' }), null);
  assert.equal(Object.keys(zip.files).length, 0);
});
