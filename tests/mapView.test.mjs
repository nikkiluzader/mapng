import test from 'node:test';
import assert from 'node:assert/strict';
import { minZoomForWidth, formatSelectionSize, formatLatLng, clampLng } from '../services/mapView.js';

test('the furthest-out zoom still fills the map width with one world', () => {
  assert.equal(minZoomForWidth(200), 0);
  assert.equal(minZoomForWidth(512), 1);
  assert.equal(minZoomForWidth(1057), 3);   // 1440-wide window minus the sidebar
  assert.equal(minZoomForWidth(2560), 4);
  for (const w of [300, 900, 1900, 3840]) assert.ok(256 * 2 ** minZoomForWidth(w) >= w);
});

test('selection size labels', () => {
  assert.equal(formatSelectionSize(2048), '2.05 × 2.05 km');
  assert.equal(formatSelectionSize(1024), '1.02 × 1.02 km');
  assert.equal(formatSelectionSize(4000), '4 × 4 km');
  assert.equal(formatSelectionSize(16384), '16.4 × 16.4 km');
  assert.equal(formatSelectionSize(512), '512 × 512 m');
  assert.equal(formatSelectionSize(0), '');
});

test('coordinates as people paste them, longitudes kept on one world', () => {
  assert.equal(formatLatLng(29.897731, -81.311549), '29.89773, -81.31155');
  assert.equal(formatLatLng(NaN, 1), '');
  assert.equal(clampLng(-180.00001), -180);
  assert.equal(clampLng(181), 180);
  assert.equal(clampLng(12.5), 12.5);
});

test('a date-line box splits into its two halves on the globe', async () => {
  const { splitAtDateLine } = await import('../services/osm.js');
  assert.equal(splitAtDateLine({ south: 0, north: 1, west: 10, east: 11 }), null);
  assert.deepEqual(splitAtDateLine({ south: 0, north: 1, west: 179.9, east: 180.2 }).map((b) => [b.west, +b.east.toFixed(6)]), [[179.9, 180], [-180, -179.8]]);
  assert.deepEqual(splitAtDateLine({ south: 0, north: 1, west: -180.3, east: -179.9 }).map((b) => [+b.west.toFixed(6), b.east]), [[179.7, 180], [-180, -179.9]]);
});

test('date-line halves join: longitudes next to each other, OSM ways once, Overture kept apart', async () => {
  const { mergeAcrossDateLine } = await import('../services/osm.js');
  const way = { type: 'way', id: 5, geometry: [{ lat: 0, lon: 179.99 }, { lat: 0, lon: -179.99 }] };
  const east = { elements: [way, { type: 'node', id: 9, lat: 0, lon: 179.95 }] };
  const west = { elements: [way, { type: 'node', id: 10, lat: 0, lon: -179.95 }] };
  const osm = mergeAcrossDateLine([{ data: east, osmIds: true }, { data: west, osmIds: true }], 180);
  assert.equal(osm.elements.length, 3);
  assert.deepEqual(osm.elements[0].geometry.map((p) => +p.lon.toFixed(2)), [179.99, 180.01]);
  assert.equal(+osm.elements[2].lon.toFixed(2), 180.05);
  const a = { elements: [{ type: 'way', id: 1, geometry: [{ lat: 0, lon: 179.99 }] }] };
  const b = { elements: [{ type: 'way', id: 1, geometry: [{ lat: 0, lon: -179.99 }] }] };
  const ov = mergeAcrossDateLine([{ data: a, osmIds: false }, { data: b, osmIds: false }], 180);
  assert.equal(ov.elements.length, 2);
});

test('longitude ranges stay continuous across the date line', async () => {
  const { continuousLngRange } = await import('../services/lngRange.js');
  assert.deepEqual(continuousLngRange(10, 11), { west: 10, east: 11 });
  const a = continuousLngRange(179.99, -179.99);
  assert.equal(a.west, 179.99); assert.ok(Math.abs(a.east - 180.01) < 1e-9);
  const b = continuousLngRange(-180.01, -179.99);
  assert.ok(Math.abs(b.west - 179.99) < 1e-9); assert.ok(Math.abs(b.east - 180.01) < 1e-9);
  const { splitAtDateLine } = await import('../services/osm.js');
  assert.equal(splitAtDateLine({ south: 0, north: 1, west: 179.9, east: -179.8 }).length, 2);
});

test('a flat Terrarium tile is a placeholder only when its ancestor disagrees', async () => {
  const { flatTerrariumHeight, isFlatTerrariumPlaceholder } = await import('../services/terrain.js');
  assert.equal(flatTerrariumHeight(new Float32Array(16).fill(344)), 344);
  const hill = new Float32Array(16).fill(344); hill[3] = 345;
  assert.equal(flatTerrariumHeight(hill), null);
  const slope = Float32Array.from({ length: 16 }, (_, i) => 200 + i * 20);
  assert.equal(isFlatTerrariumPlaceholder(344, slope), true);            // hillside flattened
  assert.equal(isFlatTerrariumPlaceholder(371, new Float32Array(16).fill(372)), false);   // a lake
  assert.equal(isFlatTerrariumPlaceholder(0, Float32Array.from({ length: 16 }, () => -15)), false); // sea floor
  assert.equal(isFlatTerrariumPlaceholder(0, slope), true);              // coast lost to a flat-0 tile
  const edge = new Float32Array(16).fill(0); edge[15] = 40;              // one bled pixel
  assert.equal(isFlatTerrariumPlaceholder(0, edge), false);
});

test('two refilled tiles meet without a step', async () => {
  const { blendTileEdge } = await import('../services/terrain.js');
  const size = 8; const a = new Float32Array(64).fill(100); const b = new Float32Array(64).fill(160);
  blendTileEdge(a, b, true, 2, size);
  const row = [...a.slice(0, 8), ...b.slice(0, 8)].map((v) => Math.round(v));
  assert.deepEqual(row, [100, 100, 100, 100, 100, 100, 112, 124, 136, 148, 160, 160, 160, 160, 160, 160]);
});
