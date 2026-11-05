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
