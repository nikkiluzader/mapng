// How many GPXZ calls a map's elevation takes (services/terrain.js gpxzCallsFor): the number on the comparison's
// "Add GPXZ" button, and the area asked for is the one Generate asks for.
import test from 'node:test';
import assert from 'node:assert/strict';

test('the call count is the raster tiles (10 km2 each at most) and one resolution check', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const { gpxzMapBounds, gpxzCallsFor } = await import('../services/terrain.js');
  const at = { lat: 40.6, lng: -111.8 };
  assert.equal(gpxzCallsFor(gpxzMapBounds(at, 512)), 2);     // one tile
  assert.equal(gpxzCallsFor(gpxzMapBounds(at, 2048)), 2);
  assert.equal(gpxzCallsFor(gpxzMapBounds(at, 4096)), 5);    // four tiles
  assert.ok(gpxzCallsFor(gpxzMapBounds(at, 16384)) > 30);
  // the bounds are the map's own: a little over its width, centred on it
  const b = gpxzMapBounds(at, 4096);
  assert.ok(Math.abs((b.north + b.south) / 2 - at.lat) < 1e-4 && Math.abs((b.east + b.west) / 2 - at.lng) < 1e-4);
  assert.ok(Math.abs((b.north - b.south) * 111320 - 4104) < 30);
});
