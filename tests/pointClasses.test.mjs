import test from 'node:test';
import assert from 'node:assert/strict';
import { classPixels, intensityPixels, POINT_CLASS_KEYS } from '../services/pointClasses.js';

// The 2D preview's point cloud views: class codes to colours (255 = empty, transparent), brightness to grey.
test('point cloud preview pixels: classes coloured, empty cells transparent; brightness grey, 0 transparent', () => {
  const cls = classPixels(new Uint8Array([2, 6, 255, 42]), 4, 1);
  assert.deepEqual([...cls.slice(0, 4)], [0xc9, 0xb4, 0x8a, 255]);     // ground
  assert.deepEqual([...cls.slice(4, 8)], [0xd9, 0x53, 0x4f, 255]);     // buildings
  assert.equal(cls[11], 0);                                            // empty
  assert.equal(cls[15], 255);                                          // an unnamed class still shows (grey)
  const br = intensityPixels(new Uint8Array([0, 200]), 2, 1);
  assert.equal(br[3], 0); assert.deepEqual([...br.slice(4, 8)], [200, 200, 200, 255]);
  assert.equal(POINT_CLASS_KEYS[12], 'overlap');
});
