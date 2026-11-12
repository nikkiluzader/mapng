// services/terrain.js terrainZoomForBounds: the 30 m tile mosaic stays within what a drawing surface takes
import test from 'node:test';
import assert from 'node:assert/strict';
import { terrainZoomForBounds, project, MAX_TERRAIN_MOSAIC_PX, TERRAIN_ZOOM } from '../services/terrain.js';

const box = (lat, lng, km) => { const dLat = km / 2 / 111.32; const dLng = dLat / Math.cos(lat * Math.PI / 180); return { north: lat + dLat, south: lat - dLat, west: lng - dLng, east: lng + dLng }; };
const side = (b, z) => (Math.floor(project(b.south, b.east, z).x / 256) - Math.floor(project(b.north, b.west, z).x / 256) + 1) * 256;

test('maps as they were: zoom 15 up to the widest that fits', () => {
  for (const km of [0.5, 2, 8, 20, 40]) assert.equal(terrainZoomForBounds(box(45.3, 35.9, km)), TERRAIN_ZOOM, `${km} km`);
  assert.equal(terrainZoomForBounds(box(0, 10, 60)), TERRAIN_ZOOM);
});

test('the map of report MR-SNPMZ7 (16,384 px at 6.5 m: 106 km) no longer asks for a 31,700 px surface', () => {
  const b = box(45.32028874948921, 35.95825195312501, 16384 * 6.5 / 1000);
  assert.ok(side(b, 15) > 23170, 'zoom 15 was past what Skia takes');
  const z = terrainZoomForBounds(b);
  assert.equal(z, 14);
  assert.ok(side(b, z) <= MAX_TERRAIN_MOSAIC_PX);
});

test('wider still: lower again, never over the limit', () => {
  for (const km of [150, 300, 800, 2000]) { const b = box(40, 10, km); const z = terrainZoomForBounds(b); assert.ok(side(b, z) <= MAX_TERRAIN_MOSAIC_PX && side(b, z + 1) > MAX_TERRAIN_MOSAIC_PX, `${km} km at zoom ${z}`); }
});
