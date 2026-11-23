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
  // (the footprint's pixels are height samples 0..49: the ground between them ends at sample 49)
  assert.ok(Math.abs(g[2].lng - 0.49) < 1e-9, `cut at the edge of the ground: ${g[2].lng}`);
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

// Lines are cut where the ground ends, wherever their own points are.
test('a line crossing the footprint between two of its points keeps its crossing', () => {
  // a corridor 20 px wide down the middle (x 40..59); a railway from far west to far east with no point inside it
  const c = footprintClipper(bounds, { size: 100, rects: [[40, 0, 20, 100]] });
  const { features, stats } = c.clip([{ id: 'rail', type: 'railway', geometry: [P(5, 30.5), P(95, 30.5)] }]);
  assert.equal(features.length, 1); assert.equal(stats.dropped, 0);
  const g = features[0].geometry;
  assert.equal(g.length, 2);
  assert.ok(Math.abs(g[0].lng - 0.40) < 1e-9 && Math.abs(g[1].lng - 0.59) < 1e-9, `${g[0].lng} .. ${g[1].lng}`);
  // a diagonal one, the same
  const d = c.clip([{ id: 'wire', type: 'power_line', geometry: [P(10, 10), P(90, 90)] }]).features;
  assert.equal(d.length, 1);
  assert.ok(d[0].geometry.every((p) => p.lng >= 0.40 - 1e-9 && p.lng <= 0.59 + 1e-9));
});

test('a segment with both ends on ground is cut at a gap between them', () => {
  // two island tiles with a gap (x 0..29 and x 60..99); a road with one point on each
  const c = footprintClipper(bounds, { size: 100, rects: [[0, 0, 30, 100], [60, 0, 40, 100]] });
  const { features } = c.clip([{ id: 'r', type: 'road', geometry: [P(10, 50.5), P(80, 50.5)] }]);
  assert.deepEqual(features.map((f) => f.id), ['r~0', 'r~1']);
  assert.ok(Math.abs(features[0].geometry[1].lng - 0.29) < 1e-9 && Math.abs(features[1].geometry[0].lng - 0.60) < 1e-9);
  // nothing of the road lies over the gap
  for (const f of features) for (const p of f.geometry) assert.ok(c.inside(p.lat, p.lng - 1e-7) || c.inside(p.lat, p.lng + 1e-7));
});

test('a roundabout cut by the edge stays one stretch, not split at its first point', () => {
  const c = footprintClipper(bounds, shape);   // the west half
  // a ring round (40, 50), radius 15: its east part is outside; its first point is on the west, inside
  const ring = Array.from({ length: 25 }, (_, k) => { const a = Math.PI + (k / 24) * 2 * Math.PI; return P(40 + 15 * Math.cos(a), 50 + 15 * Math.sin(a)); });
  ring[24] = ring[0];
  const { features } = c.clip([{ id: 'rb', type: 'road', tags: { junction: 'roundabout' }, geometry: ring }]);
  assert.equal(features.length, 1, `pieces: ${features.map((f) => f.id)}`);
  assert.equal(features[0].id, 'rb');
  // and a ring wholly inside is untouched
  const small = Array.from({ length: 13 }, (_, k) => { const a = (k / 12) * 2 * Math.PI; return P(20 + 5 * Math.cos(a), 50 + 5 * Math.sin(a)); }); small[12] = small[0];
  const kept = c.clip([{ id: 'in', type: 'road', geometry: small }]);
  assert.equal(kept.stats.kept, 1); assert.equal(kept.features[0].geometry, small);
});

test('a line wholly outside, or only touching a corner, is dropped', () => {
  const c = footprintClipper(bounds, shape);
  assert.equal(c.clip([{ id: 'x', type: 'road', geometry: [P(60, 10), P(90, 90)] }]).features.length, 0);
});
