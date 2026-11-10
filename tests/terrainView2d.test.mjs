// The 2D preview's terrain views (services/terrainView2d.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleHeights, shadeTerrain, contourPixels, slopeColour, elevationColour } from '../services/terrainView2d.js';

const grid = (w, hgt, f) => { const h = new Float32Array(w * hgt); for (let r = 0; r < hgt; r++) for (let c = 0; c < w; c++) h[r * w + c] = f(c, r); return { h, w, hgt, cell: 1 }; };
const px = (img, w, c, r) => [...img.slice((r * w + c) * 4, (r * w + c) * 4 + 4)];

test('slope colours: flat ground green, a 45° face purple', () => {
  const flat = slopeColour(0); const cliff = slopeColour(45);
  assert.ok(flat[1] > flat[0] && flat[1] > flat[2], 'green');
  assert.ok(cliff[2] > cliff[1] && cliff[0] > cliff[1], 'purple');
  const g = grid(8, 8, (c) => c);            // 45° up to the east
  const img = shadeTerrain(g, 'slope');
  const p = px(img, 8, 4, 4);
  assert.ok(p[2] > p[1], `a 45° slope reads purple, got ${p}`);
});

test('relief: the sun in the north-west: a slope facing it is lighter than one facing away', () => {
  // a ridge running north-south: its west face looks at the sun
  const g = grid(21, 21, (c) => 10 - Math.abs(c - 10));
  const img = shadeTerrain(g, 'relief');
  assert.ok(px(img, 21, 5, 10)[0] > px(img, 21, 15, 10)[0] + 30, 'west face lighter than east face');
  // and a north face lighter than a south one (rows run north to south)
  const g2 = grid(21, 21, (c, r) => 10 - Math.abs(r - 10));
  const img2 = shadeTerrain(g2, 'relief');
  assert.ok(px(img2, 21, 10, 5)[0] > px(img2, 21, 10, 15)[0] + 30, 'north face lighter than south face');
});

test('height: the lowest ground green, the highest near white', () => {
  assert.ok(elevationColour(0)[1] > elevationColour(0)[0]);
  assert.ok(elevationColour(1).every((v) => v > 230));
  const g = grid(4, 4, (c, r) => (r === 0 ? 100 : 0));
  const img = shadeTerrain(g, 'elevation', { minHeight: 0, maxHeight: 100 });
  assert.ok(px(img, 4, 2, 3)[1] > px(img, 4, 2, 3)[0], 'valley green');
});

test('contours: a line wherever the ground crosses the interval, each fifth bold, none on the flat', () => {
  const g = grid(60, 4, (c) => c);           // 1 m a pixel eastward
  const img = contourPixels(g, 10);
  const alpha = (c) => img[(1 * 60 + c) * 4 + 3];
  assert.ok(alpha(9) > 0 && alpha(19) > 0, 'lines at 10 m and 20 m');
  assert.equal(alpha(5), 0); assert.equal(alpha(14), 0);
  assert.ok(alpha(49) > alpha(9), 'the 50 m line is bold');
  assert.ok(contourPixels(grid(8, 8, () => 3), 10).every((v) => v === 0), 'flat ground: no line');
});

test('a large terrain is sampled down by block means', () => {
  const big = new Float32Array(16 * 16).fill(0); for (let i = 0; i < 16 * 16; i++) big[i] = (i % 16) < 8 ? 0 : 8;
  const s = sampleHeights(big, 16, 16, 1, 4);
  assert.equal(s.w, 4); assert.equal(s.cell, 4);
  assert.deepEqual([...s.h.slice(0, 4)], [0, 0, 8, 8]);
  assert.equal(sampleHeights(big, 16, 16, 2, 2048).h, big, 'small enough: used as it is');
});
