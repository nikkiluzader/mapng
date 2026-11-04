import test from 'node:test';
import assert from 'node:assert/strict';
import { mapngLevelStamp } from '../services/exportBeamNGLevel.js';

// levels/<name>/mapng.json: the desktop app lists MapNG levels by it and
// rebuilds them from it, so it must carry the area and settings, never keys
test('mapng.json names the maker, the area and plain settings only', () => {
  const stamp = mapngLevelStamp({
    terrainData: { width: 2048, processingMetersPerPixel: 1, bounds: { north: 1, south: 0, east: 1, west: 0 } },
    center: { lat: 29.89, lng: -81.31 },
    levelName: 'spanish_street',
    worldSize: 2048,
    options: {
      appVersion: '0.1.0', platform: 'desktop', baseTexture: 'game', safeCaps: false,
      backdropGpxzApiKey: 'secret', onProgress: () => {}, treeSpeciesMix: [{ big: 'data' }], levelName: 'spanish_street',
    },
  });
  assert.equal(stamp.generator, 'MapNG');
  assert.equal(stamp.appVersion, '0.1.0');
  assert.equal(stamp.platform, 'desktop');
  assert.equal(stamp.resolution, 2048);
  assert.equal(stamp.sizeMeters, 2048);
  assert.deepEqual(stamp.center, { lat: 29.89, lng: -81.31 });
  assert.deepEqual(stamp.options, { baseTexture: 'game', safeCaps: false, levelName: 'spanish_street' });
  assert.ok(!JSON.stringify(stamp).includes('secret'));
});
