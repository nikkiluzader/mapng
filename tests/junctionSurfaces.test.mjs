import test from 'node:test';
import assert from 'node:assert/strict';

import { cutSurfaceAtOtherSurfaces } from '../services/exportBeamNGLevel.js';
import { buildCarriagewayIndex } from '../services/roadMarkingCuts.js';

// An asphalt street along y = 0 (8 m wide) and a brick lane coming in from
// the north at a slant, drawn as two side-by-side strips.
const line = (from, to, n = 20) => Array.from({ length: n + 1 }, (_, i) => [
  from[0] + (to[0] - from[0]) * (i / n), from[1] + (to[1] - from[1]) * (i / n), 0,
]);
const asphalt = { owner: 0, nodes: line([-40, 0], [40, 0]), half: 4, highway: 'residential', tags: { surface: 'asphalt' } };
const lane = { owner: 1, nodes: line([10, 40], [0, 0]), half: 3, highway: 'residential', tags: { surface: 'paving_stones' } };

function strip(offset) {
  const [a, b] = [lane.nodes[0], lane.nodes[lane.nodes.length - 1]];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const nx = -(b[1] - a[1]) / L; const ny = (b[0] - a[0]) / L;
  const decal = { name: `lane_${offset}`, nodes: lane.nodes.map(([x, y, z]) => [x + nx * offset, y + ny * offset, z, 3]) };
  Object.defineProperty(decal, '__layer', { value: 'paving', enumerable: false });
  return decal;
}

test('a brick lane stops square where its corners begin and its mouth takes the street\'s asphalt', () => {
  const group = { __items: [strip(-1.5), strip(1.5)] };
  const surfaceDecals = group.__items.map((decal) => ({ decal, group, owner: 1 }));
  const carriageways = [asphalt, lane];
  const mouths = cutSurfaceAtOtherSurfaces(surfaceDecals, carriageways, buildCarriagewayIndex(carriageways), { americas: true });

  assert.equal(group.__items.length, 2);
  // each strip's cut end, as a station along the lane (distance from its far end)
  const dir = [-10 / Math.hypot(10, 40), -40 / Math.hypot(10, 40)];
  const station = (p) => (p[0] - 10) * dir[0] + (p[1] - 40) * dir[1];
  const ends = group.__items.map((d) => station(d.nodes[d.nodes.length - 1]));
  assert.ok(Math.abs(ends[0] - ends[1]) < 0.05, `strips end on one line square to the lane (${ends})`);
  // the lane stops about a corner radius (3 m) clear of the asphalt edge (y = 4)
  const endY = group.__items.map((d) => d.nodes[d.nodes.length - 1][1]);
  for (const y of endY) assert.ok(y > 5.5 && y < 8.5, `cut near y = 7 (${y})`);

  assert.equal(mouths.length, 1);
  assert.match(mouths[0].material, /asphalt/);
  const [m0, m1] = [mouths[0].nodes[0], mouths[0].nodes[mouths[0].nodes.length - 1]];
  assert.ok(Math.abs(station(m0) - ends[0]) < 0.3 || Math.abs(station(m1) - ends[0]) < 0.3, 'the mouth starts where the brick stops');
});

test('two streets of one surface are left alone', () => {
  const brick = { ...asphalt, tags: { surface: 'paving_stones' } };
  const group = { __items: [strip(0)] };
  const before = group.__items[0].nodes.length;
  const mouths = cutSurfaceAtOtherSurfaces([{ decal: group.__items[0], group, owner: 1 }], [brick, lane], buildCarriagewayIndex([brick, lane]), { americas: true });
  assert.equal(mouths.length, 0);
  assert.equal(group.__items[0].nodes.length, before);
});
