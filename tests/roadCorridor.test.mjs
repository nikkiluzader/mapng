// services/roadCorridor.js: a road stretch widened either side, as a grid and row runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { corridorGrid } from '../services/roadCorridor.js';
import { shapeArea } from '../services/batchShape.js';
import { frameBounds, gridPosition, vertexLatLng, offsetLatLng, metresPerDegree } from '../services/mapFrame.js';

const D = 1 / 111320;   // ~1 m of latitude near the equator
const P = (xm, ym) => ({ lat: ym * D, lng: xm * D });
// (a sample of Generate's grid stands for one square of the map: m x m metres)
const groundM2 = (g, m) => g.areaPx * m * m;

test('a straight 1 km road, 100 m either side: about 1000 x 200 m plus the round ends', () => {
  const g = corridorGrid([P(-500, 0), P(500, 0)], 100, 1);
  assert.ok(Math.abs(g.lengthM - 1000) < 2, `length ${g.lengthM}`);
  assert.ok(g.width >= 1200 && g.width <= 1220 && g.height >= 200 && g.height <= 220, `${g.width} x ${g.height}`);
  const expect = 1000 * 200 + Math.PI * 100 * 100;   // the band plus the two half discs
  assert.ok(Math.abs(groundM2(g, 1) - expect) / expect < 0.01, `ground ${groundM2(g, 1)} m2 vs ${expect}`);
  assert.equal(shapeArea({ runs: g.runs }, g.height, g.width), g.areaPx);
});

test('a hairpin: the overlapping bends counted once, never more than the box', () => {
  const g = corridorGrid([P(0, 0), P(300, 0), P(300, 60), P(0, 60)], 50, 1);
  assert.ok(g.areaPx < g.width * g.height);
  // the two arms 60 m apart with 50 m either side overlap: less than the two arms' sum
  assert.ok(g.areaPx < 2 * (300 * 100 + Math.PI * 2500), `${g.areaPx}`);
  // a middle row through both arms: one merged run
  const mid = g.runs.filter(([y]) => y === Math.floor(g.height / 2));
  assert.equal(mid.length, 1);
});

test('the width is held to its limits', () => {
  assert.equal(corridorGrid([P(0, 0), P(100, 0)], 1, 1).halfWidthM, 50);
  assert.equal(corridorGrid([P(0, 0), P(100, 0)], 1e6, 1).halfWidthM, 2000);
});

test('a coarser processing resolution: fewer pixels, same ground', () => {
  const a = corridorGrid([P(-500, 0), P(500, 0)], 100, 1); const b = corridorGrid([P(-500, 0), P(500, 0)], 100, 2);
  assert.ok(Math.abs(groundM2(b, 2) - groundM2(a, 1)) / groundM2(a, 1) < 0.01, `${groundM2(b, 2)} vs ${groundM2(a, 1)}`);
});


// The corridor's pixels are Generate's own: a height sample of the map's frame (services/mapFrame.js) is in the corridor
// exactly when its place in the world is within the half width of the road.
const frameOf = (g, m) => frameBounds(g.center, g.width * m, g.height * m);
const hasSample = (g, x, y) => g.runs.some(([ry, x0, x1]) => ry === y && x >= x0 && x < x1);
const metres = (a, b) => { const k = metresPerDegree((a.lat + b.lat) / 2); return Math.hypot((a.lng - b.lng) * k.lng, (a.lat - b.lat) * k.lat); };
const distToRoad = (p, pts) => {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]; const b = pts[i]; const k = metresPerDegree((a.lat + b.lat + 2 * p.lat) / 4);
    const bx = (b.lng - a.lng) * k.lng; const by = (b.lat - a.lat) * k.lat; const px = (p.lng - a.lng) * k.lng; const py = (p.lat - a.lat) * k.lat;
    const t = Math.max(0, Math.min(1, (px * bx + py * by) / (bx * bx + by * by || 1)));
    best = Math.min(best, Math.hypot(px - t * bx, py - t * by));
  }
  return best;
};

for (const [lat, km, mpp, half] of [[0, 4, 1, 100], [45, 16, 1, 250], [60, 30, 2, 50], [70, 20, 2, 50], [-52, 12, 1, 2000]]) {
  test(`at latitude ${lat}, a ${km} km L-shaped road lies in its own corridor (${half} m either side, ${mpp} m/px)`, () => {
    const c = { lat, lng: 11 }; const L = km * 500;
    // west leg north-south, then east along the south: the far corners of the box, where a frame error is largest
    const pts = [offsetLatLng(c, -L, L), offsetLatLng(c, -L, -L), offsetLatLng(c, L, -L)];
    const g = corridorGrid(pts, half, mpp); const b = frameOf(g, mpp);
    // every 200 m along the road: the sample nearest the road is in, as are samples well inside the width either side;
    // samples well outside are not
    let checked = 0;
    for (let i = 1; i < pts.length; i++) {
      const steps = Math.ceil(metres(pts[i - 1], pts[i]) / 200);
      for (let s = 0; s <= steps; s++) {
        const p = { lat: pts[i - 1].lat + ((pts[i].lat - pts[i - 1].lat) * s) / steps, lng: pts[i - 1].lng + ((pts[i].lng - pts[i - 1].lng) * s) / steps };
        const q = gridPosition(b, g.width, g.height, p.lat, p.lng);
        const x = Math.round(q.gx); const y = Math.round(q.gy) - 1;   // (sample (x, y) is the vertex at (x, y + 1))
        assert.ok(hasSample(g, x, y), `the road itself at step ${s} of leg ${i} (sample ${x}, ${y}) is outside the corridor`);
        checked++;
      }
    }
    assert.ok(checked > 20);
    // every sample of a few rows and columns: in the corridor exactly when within the width (2 px of slack at the edge)
    const slack = 2 * mpp; let seen = 0;
    const rows = [5, Math.floor(g.height / 3), Math.floor(g.height / 2), g.height - 6];
    for (const y of rows) {
      for (let x = 0; x < g.width; x += 7) {
        const v = vertexLatLng(b, g.width, g.height, x, y); const d = distToRoad(v, pts); const inRun = hasSample(g, x, y);
        if (d < half - slack) assert.ok(inRun, `sample ${x}, ${y} is ${d.toFixed(1)} m from the road but not in the corridor`);
        if (d > half + slack) assert.ok(!inRun, `sample ${x}, ${y} is ${d.toFixed(1)} m from the road but in the corridor`);
        seen++;
      }
    }
    assert.ok(seen > 100);
    // nothing outside the grid, runs in order
    for (const [y, x0, x1] of g.runs) assert.ok(y >= 0 && y < g.height && x0 >= 0 && x1 <= g.width && x1 > x0);
  });
}

import { corridorPieces } from '../services/roadCorridor.js';
import { chunkLayout } from '../services/chunkLayout.js';

// The road panel's warning counts the pieces from the corridor's rows; it must agree with the layout the export builds.
test('the piece count from the rows matches the chunk layout', () => {
  // a diagonal band 400 px wide across a 9000 x 6000 grid
  const W = 9000; const H = 6000; const runs = [];
  for (let y = 0; y < H; y++) { const x = Math.round((y / H) * (W - 400)); runs.push([y, x, x + 400]); }
  assert.equal(corridorPieces(runs), chunkLayout({ runs }, W, H).length);
  assert.equal(corridorPieces([]), 0);
});
