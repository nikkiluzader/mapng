// services/footprintClip.js: a shaped level's map data kept to its footprint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { footprintClipper } from '../services/footprintClip.js';

// a 100 x 100 px grid over 0..1 degrees; the footprint: the west half (x < 50)
const bounds = { west: 0, east: 1, south: 0, north: 1 };
const shape = { size: 100, rects: [[0, 0, 50, 100]] };
const P = (x, y) => ({ lat: 1 - y / 100, lng: x / 100 });

test('a road across the edge is cut there, the outside dropped', () => {
  const c = footprintClipper(bounds, shape);
  const { features, stats } = c.clip([{ id: 'r1', type: 'road', tags: { highway: 'residential' }, geometry: [P(10, 50), P(40, 50), P(80, 50)] }]);
  assert.equal(features.length, 1); assert.equal(stats.cut, 1);
  const g = features[0].geometry;
  assert.equal(g.length, 3);
  assert.ok(Math.abs(g[2].lng - 0.5) < 0.002, `cut at the edge: ${g[2].lng}`);
});

test('a road leaving and coming back becomes two pieces with their own ids', () => {
  const c = footprintClipper(bounds, shape);
  const { features } = c.clip([{ id: 'r2', type: 'road', geometry: [P(10, 20), P(80, 20), P(80, 80), P(10, 80)] }]);
  assert.deepEqual(features.map((f) => f.id), ['r2~0', 'r2~1']);
});

test('buildings by their centre, areas by overlap, points by position', () => {
  const c = footprintClipper(bounds, shape);
  const sq = (x0, y0, x1, y1) => [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1), P(x0, y0)];
  const { features } = c.clip([
    { id: 'b-in', type: 'building', geometry: sq(30, 30, 45, 40) },
    { id: 'b-straddle-out', type: 'building', geometry: sq(45, 30, 70, 40) },
    { id: 'forest', type: 'landuse', geometry: sq(40, 10, 90, 90) },
    { id: 'far-lake', type: 'water', geometry: sq(60, 10, 90, 30) },
    { id: 'tree-in', type: 'vegetation', geometry: [P(20, 20)] },
    { id: 'tree-out', type: 'vegetation', geometry: [P(70, 20)] },
  ]);
  assert.deepEqual(features.map((f) => f.id).sort(), ['b-in', 'forest', 'tree-in']);
});

test('a rectangular grid: the footprint read on its own width and height', () => {
  // 200 x 100 px over 0..2 x 0..1 degrees; the footprint: the west quarter (x < 50)
  const c = footprintClipper({ west: 0, east: 2, south: 0, north: 1 }, { width: 200, height: 100, rects: [[0, 0, 50, 100]] });
  assert.equal(c.inside(0.5, 0.2), true); assert.equal(c.inside(0.5, 0.6), false);
});
