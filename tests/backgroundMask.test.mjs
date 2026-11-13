import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyMask, maskHasAreas, makeProjector, rasterizeMask, snapLineEnds, openLines,
  backgroundLookup, backgroundFraction, boxAllBackground, sameBounds,
} from '../services/backgroundMask.js';

const bounds = { north: 1, south: 0, east: 1, west: 0 }; // 1° square; lat up, lng right
const N = 128;
const P = makeProjector(bounds, N);
const ll = (x, y) => P.toLatLng([x, y]);
const line = (pts) => pts.map(([x, y]) => ll(x, y));
const mask = (over) => ({ ...emptyMask(), bounds, ...over });

test('an edge-to-edge line splits the square; the bucket shades one side', () => {
  // vertical line at x = 64 from the top edge to the bottom edge
  const m = mask({ lines: [line([[64, -1], [64, N + 1]])], shade: [ll(100, 64)] });
  const r = rasterizeMask(m, N);
  assert.equal(r.count, 2);
  assert.deepEqual(r.open, [false]);
  const f = backgroundFraction(r);
  assert.ok(f > 0.45 && f < 0.52, `right half shaded, got ${f}`);
  assert.equal(r.bg[64 * N + 100], 1);
  assert.equal(r.bg[64 * N + 20], 0);
});

test('a loop closes its inside; a dangling line closes nothing and gets flagged open', () => {
  const loop = [];
  for (let k = 0; k <= 64; k++) { const a = (k / 64) * Math.PI * 2; loop.push([40 + Math.cos(a) * 15, 40 + Math.sin(a) * 15]); }
  const dangling = [[80, 90], [100, 95], [110, 100]];
  const cell = [loop, dangling];
  assert.deepEqual(openLines(cell, N), [false, true]);
  const m = mask({ lines: [line(loop), line(dangling)], shade: [ll(40, 40)] });
  const r = rasterizeMask(m, N);
  assert.equal(r.bg[40 * N + 40], 1);
  assert.equal(r.bg[100 * N + 20], 0);
});

test('the bucket never shades the whole square', () => {
  const m = mask({ lines: [line([[80, 90], [100, 95]])], shade: [ll(10, 10)] }); // open line only
  assert.equal(backgroundFraction(rasterizeMask(m, N)), 0);
});

test('line ends near the edge snap to it and close the area', () => {
  const pts = snapLineEnds([[64, 5], [64, 60], [64, 122]], [], N, 8);
  assert.ok(pts[0][1] < 0 && pts[pts.length - 1][1] > N, 'both ends reach past the edges');
  assert.equal(openLines([pts], N)[0], false);
});

test('kept roads: everything farther than the width is background, unshade carves an area back', () => {
  // a road along y = 64, square 12.8 km across → 100 m per cell; 1 km width = 10 cells
  const roads = [{ id: 1, name: 'r', pts: line([[0, 64], [N, 64]]) }];
  const m = mask({ roads, widthM: 1000 });
  const r = rasterizeMask(m, N, { metersAcross: 12800 });
  assert.equal(r.bg[64 * N + 50], 0);
  assert.equal(r.bg[70 * N + 50], 0);
  assert.equal(r.bg[90 * N + 50], 1);
  // a line across the top part, and unshade the strip above it
  const m2 = mask({ roads, widthM: 1000, lines: [line([[-1, 30], [N + 1, 30]])], unshade: [ll(50, 10)] });
  const r2 = rasterizeMask(m2, N, { metersAcross: 12800 });
  assert.equal(r2.bg[10 * N + 50], 0);
  assert.equal(r2.bg[45 * N + 50], 1);
});

test('lookup, box test, bounds', () => {
  assert.equal(backgroundLookup(emptyMask()), null);
  assert.equal(maskHasAreas(mask({ lines: [line([[1, 1], [2, 2]])] })), false);
  const at = backgroundLookup(mask({ lines: [line([[64, -1], [64, N + 1]])], shade: [ll(100, 64)] }), { n: N });
  assert.equal(at(0.9, 0.5), true);
  assert.equal(at(0.1, 0.5), false);
  assert.equal(boxAllBackground(at, 0.6, 0, 1, 1), true);
  assert.equal(boxAllBackground(at, 0.3, 0, 1, 1), false);
  assert.ok(sameBounds(bounds, { ...bounds }));
  assert.ok(!sameBounds(bounds, { ...bounds, east: 1.001 }));
});

test('features: buildings in background go, roads only when wholly inside, water stays', async () => {
  const { filterFeaturesByBackground } = await import('../services/backgroundMask.js');
  const at = backgroundLookup(mask({ lines: [line([[64, -1], [64, N + 1]])], shade: [ll(100, 64)] }), { n: N });
  const pt = (x, y) => { const [lat, lng] = ll(x, y); return { lat, lng }; };
  const feats = [
    { id: 'b1', type: 'building', geometry: [pt(100, 60), pt(104, 60), pt(104, 64)] },
    { id: 'b2', type: 'building', geometry: [pt(20, 60), pt(24, 60), pt(24, 64)] },
    { id: 'r1', type: 'road', geometry: [pt(90, 10), pt(110, 100)] },
    { id: 'r2', type: 'road', geometry: [pt(30, 50), pt(110, 50)] },
    { id: 'w1', type: 'water', geometry: [pt(100, 100), pt(110, 100), pt(110, 110)] },
  ];
  const kept = filterFeaturesByBackground(feats, at, bounds).map((f) => f.id);
  assert.deepEqual(kept, ['b2', 'r2', 'w1']);
});

test('kept boxes and tile skipping', async () => {
  const { keptBoxes, makeSkipBox } = await import('../services/backgroundMask.js');
  const at = backgroundLookup(mask({ lines: [line([[64, -1], [64, N + 1]])], shade: [ll(100, 64)] }), { n: N });
  const boxes = keptBoxes(at, bounds, 8);
  assert.equal(boxes.length, 8);                       // one per row: the west half (+ the cells the line crosses)
  assert.ok(boxes.every((b) => b.west === 0 && b.east > 0.49 && b.east < 0.7));
  const skip = makeSkipBox(at, bounds);
  assert.equal(skip({ north: 0.9, south: 0.6, west: 0.7, east: 0.95 }), true);
  assert.equal(skip({ north: 0.9, south: 0.6, west: 0.3, east: 0.95 }), false);
  assert.equal(skip({ north: 0.9, south: 0.6, west: 0.8, east: 1.5 }), true);   // the part inside the square
  assert.equal(keptBoxes(backgroundLookup(mask({ roads: [{ id: 1, name: 'x', pts: line([[0, 0], [N, N]]) }], widthM: 1e9 }), { n: N }), bounds), null);
});

test('unmask strokes: a brush and a box carve kept ground out of the road mask, a later background stroke wins', () => {
  // road along y = 64, 12.8 km square → 100 m per cell; 500 m width = 5 cells
  const roads = [{ id: 1, name: 'r', pts: line([[0, 64], [N, 64]]) }];
  const base = { roads, widthM: 500 };
  const r0 = rasterizeMask(mask(base), N, { metersAcross: 12800 });
  assert.equal(r0.bg[20 * N + 20], 1);
  assert.equal(r0.bg[100 * N + 100], 1);
  const paint = [
    { keep: true, kind: 'brush', r: 800, pts: [ll(20, 20), ll(40, 20)] },                       // 8 cells each side
    { keep: true, kind: 'poly', pts: [ll(90, 90), ll(120, 90), ll(120, 120), ll(90, 120)] },
    { keep: false, kind: 'poly', pts: [ll(100, 100), ll(110, 100), ll(110, 110), ll(100, 110)] },
  ];
  const r = rasterizeMask(mask({ ...base, paint }), N, { metersAcross: 12800 });
  assert.equal(r.bg[20 * N + 20], 0);
  assert.equal(r.bg[26 * N + 30], 0);   // 6 cells off the stroke
  assert.equal(r.bg[32 * N + 30], 1);   // 12 cells off
  assert.equal(r.bg[95 * N + 95], 0);   // inside the box
  assert.equal(r.bg[105 * N + 105], 1); // the background square drawn after it
  assert.equal(r.bg[125 * N + 125], 1);
  // background strokes alone make a mask with areas; keep strokes alone don't
  assert.ok(maskHasAreas(mask({ paint: [paint[2]] })));
  assert.ok(!maskHasAreas(mask({ paint: [paint[0]] })));
  assert.ok(backgroundFraction(rasterizeMask(mask({ paint: [paint[2]] }), N)) > 0);
});

test('No smoothing strokes: their own raster, eased edges, smooth-again strokes, and no background', async () => {
  const { rasterizeRaw, rawWeightLookup, maskHasRaw } = await import('../services/backgroundMask.js');
  // a box over the middle quarter, then a "smooth again" box over its top-left corner
  const raw = [
    { on: true, kind: 'poly', pts: [ll(32, 32), ll(96, 32), ll(96, 96), ll(32, 96)] },
    { on: false, kind: 'poly', pts: [ll(32, 32), ll(48, 32), ll(48, 48), ll(32, 48)] },
  ];
  const m = mask({ raw });
  assert.ok(maskHasRaw(m));
  assert.ok(!maskHasAreas(m), 'no background from No smoothing strokes');
  assert.equal(backgroundLookup(m), null);
  const r = rasterizeRaw(m, N);
  assert.equal(r[64 * N + 64], 1);
  assert.equal(r[40 * N + 40], 0, 'smoothed again');
  assert.equal(r[10 * N + 10], 0);
  // 12.8 km square: 100 m a cell; 300 m feather = 3 cells
  const w = rawWeightLookup(m, { n: N, metersAcross: 12800, featherM: 300 });
  assert.equal(w(64 / N, 64 / N), 1);
  assert.ok(w.full(64 / N, 64 / N) && !w.full(20 / N, 64 / N));
  const edge = w((96 + 1.5) / N, 64 / N);
  assert.ok(edge > 0.05 && edge < 0.95, `eased at the edge: ${edge}`);
  assert.equal(w((96 + 10) / N, 64 / N), 0);
  assert.equal(rawWeightLookup(mask({ raw: [{ ...raw[0], on: false }] })), null);
});

test('a line that closes an area too small to count is told apart from one that closes nothing', async () => {
  const { closesOnlySliver, openLines, snapLineEnds, MIN_AREA_CELLS_ACROSS } = await import('../services/backgroundMask.js');
  const N = 512;
  // glitter_shitter's loop on a 16 km map (2026-11-13): out from the box's edge, round 350 m by 250 m, back to the edge
  const px = [[575, 622], [632, 622], [690, 580], [810, 500], [990, 410], [1130, 465], [1235, 625], [1130, 632], [975, 680], [870, 740], [632, 812], [575, 815]];
  const dense = [];
  for (let i = 0; i + 1 < px.length; i++) { const [a, b] = [px[i], px[i + 1]]; const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4); for (let k = 0; k < n; k++) dense.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]); }
  const loop = (scale) => snapLineEnds(dense.map(([x, y]) => [Math.max(-1, ((x - 632) / 52) * scale), ((y - 622) / 52) * scale + 200]), [], N, 2);
  assert.equal(openLines([loop(1)], N).pop(), true, 'not counted as an area');
  assert.equal(closesOnlySliver([loop(1)], N), true, 'but it does close one');
  // the same loop three times the size is an area
  assert.equal(openLines([loop(3)], N).pop(), false);
  assert.equal(closesOnlySliver([loop(3)], N), false);
  // a line that ends in the open closes nothing, small or not
  const stray = [[100, 100], [140, 120], [180, 100]];
  assert.equal(openLines([stray], N).pop(), true);
  assert.equal(closesOnlySliver([stray], N), false);
  assert.ok(MIN_AREA_CELLS_ACROSS >= 6 && MIN_AREA_CELLS_ACROSS <= 8);
});
