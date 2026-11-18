import test from 'node:test';
import assert from 'node:assert/strict';
import { makePolygon } from '../services/beamngWater.js';

// The lake beds test a lake's pixels row by row (makePolygon().row(y)): the outline's crossings with the row
// found once. It must say exactly what contains(x, y) says, short outlines and long (banded) ones, holes too.
test('row(y) answers as contains(x, y)', () => {
  let seed = 11; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const blob = (cx, cy, r0, n) => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2; const r = r0 * (0.6 + 0.4 * rnd());
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
  for (const n of [5, 12, 23, 24, 200, 3000]) {
    const outer = blob(0, 0, 100, n);
    const poly = makePolygon(outer, [blob(10, -5, 20, Math.max(5, n >> 3)), blob(-40, 30, 15, 9)]);
    for (let k = 0; k < 300; k++) {
      // (rows through vertices too: a row at a vertex's own height is where a crossing test can go wrong)
      const y = k % 7 === 0 ? outer[k % n][1] : (rnd() - 0.5) * 240;
      const inRow = poly.row(y);
      for (let j = 0; j < 60; j++) {
        const x = j % 9 === 0 ? outer[(k + j) % n][0] : (rnd() - 0.5) * 240;
        assert.equal(inRow(x), poly.contains(x, y), `n ${n} at ${x}, ${y}`);
      }
    }
  }
});

test('a joined outline (unionOutline) has the same row test', async () => {
  const { unionOutline } = await import('../services/beamngWater.js');
  const a = makePolygon([[0, 0], [10, 0], [10, 10], [0, 10]]);
  const b = makePolygon([[10, 0], [20, 0], [20, 10], [10, 10]], [[[14, 4], [16, 4], [16, 6], [14, 6]]]);
  const u = unionOutline([a, b]);
  for (let y = -1; y <= 11; y += 0.37) {
    const inRow = u.row(y);
    for (let x = -1; x <= 21; x += 0.29) assert.equal(inRow(x), u.contains(x, y), `${x}, ${y}`);
  }
});
