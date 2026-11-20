// services/uploadBounds.js nativeSquareAt: the native-mode square follows the map's centre, held inside the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeSquareAt, nativeExportSquare } from '../services/uploadBounds.js';

// a 1000 x 600 m file near the equator (degrees ~ metres / 111320)
const D = 1 / 111320;
const meta = { nativeWidth: 1000, nativeHeight: 600, bounds: { north: 300 * D, south: -300 * D, west: -500 * D, east: 500 * D } };

test('the square starts in the middle, follows the centre inside the file, and stops at its edges', () => {
  const mid = nativeExportSquare(meta, 1);
  assert.equal(mid.sizePx, 512);
  // centre in the middle: the same square as before
  const a = nativeSquareAt(meta, 1, { lat: 0, lng: 0 });
  for (const k of ['north', 'south', 'east', 'west']) assert.ok(Math.abs(a.bounds[k] - mid.bounds[k]) < 1e-9, k);
  // moved east: the square moves with it, its size unchanged
  const b = nativeSquareAt(meta, 1, { lat: 0, lng: 150 * D });
  assert.ok(b.bounds.west > mid.bounds.west + 100 * D);
  assert.ok(Math.abs((b.bounds.east - b.bounds.west) - (mid.bounds.east - mid.bounds.west)) < 1e-9);
  // pushed to the east edge: held inside the file
  const c = nativeSquareAt(meta, 1, { lat: 250 * D, lng: 480 * D });
  assert.ok(c.bounds.east <= meta.bounds.east + 1e-12 && c.bounds.north <= meta.bounds.north + 1e-12);
  assert.equal(c.sizePx, 512);
  // the centre past the east edge: held against that edge, not back in the middle
  const d = nativeSquareAt(meta, 1, { lat: 0, lng: 2000 * D });
  assert.ok(Math.abs(d.bounds.east - meta.bounds.east) < 1e-12, 'against the east edge');
  // no centre: the middle
  const e = nativeSquareAt(meta, 1, null);
  for (const k of ['north', 'south', 'east', 'west']) assert.ok(Math.abs(e.bounds[k] - mid.bounds[k]) < 1e-9, k);
});
