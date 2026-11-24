import test from 'node:test';
import assert from 'node:assert/strict';
import { levelCrossingBarriers, buildLevelCrossingMeshes } from '../services/levelCrossingBarriers.js';

// a road along x through a crossing at the origin, split at the node into two edges; a railway along y
const edge = (pts, extra) => {
  const s = [0]; for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { x: pts.map((p) => p[0]), y: pts.map((p) => p[1]), s, half: 3.5, ...extra };
};
const graph = {
  edges: [
    edge([[0, 0], [10, 0], [30, 0]], { from: 'n', to: 'e', highway: 'secondary' }),
    edge([[-30, 0], [-10, 0], [0, 0]], { from: 'w', to: 'n', highway: 'secondary' }),
    edge([[0, -40], [0, 40]], { from: 'a', to: 'b', rail: 'rail', seg: 0 }),
  ],
  profile: { z: [new Float32Array(3).fill(5), new Float32Array(3).fill(5), new Float32Array(2).fill(5)] },
};

test('a barrier on each road approach, on the right of the traffic coming in, its arm raised over its half of the road', () => {
  const items = levelCrossingBarriers(graph, [{ node: 'n', x: 0, y: 0, rail: [2], road: [0, 1], half: 3.5, path: false }]);
  assert.equal(items.length, 2);
  const east = items.find((b) => b.x > 0); const west = items.find((b) => b.x < 0);
  // from the east traffic drives west (-x): its right is north (+y); from the west, south
  assert.ok(east.y > 3.5 && west.y < -3.5, `posts on the verge, right-hand side: ${east.y.toFixed(1)}, ${west.y.toFixed(1)}`);
  assert.ok(Math.abs(east.x - 3.5) < 0.01, 'set back from the track');
  assert.equal(east.z, 5);
  // left-hand traffic: the other side
  const lh = levelCrossingBarriers(graph, [{ node: 'n', x: 0, y: 0, rail: [2], road: [0, 1], half: 3.5, path: false }], { leftHand: true });
  assert.ok(lh.find((b) => b.x > 0).y < -3.5);
  // the arm stands upright: every arm vertex over the post's top, within its section of the pivot
  const { meshes } = buildLevelCrossingMeshes(items);
  assert.deepEqual(meshes.map((m) => m.name).sort(), ['level_crossing_metal', 'level_crossing_red', 'level_crossing_white']);
  const red = meshes.find((m) => m.name === 'level_crossing_red').geometry.attributes.position.array;
  let zMax = 0; for (let i = 2; i < red.length; i += 3) zMax = Math.max(zMax, red[i]);
  assert.ok(zMax > 5 + 1 + 3, `raised: its top ${zMax.toFixed(1)} m`);
});

test('a path over the line gets none; a road through the line with no shared node gets one each way', () => {
  assert.equal(levelCrossingBarriers(graph, [{ node: 'n', rail: [2], road: [0, 1], path: true }]).length, 0);
  const one = { edges: [edge([[-30, 0], [30, 0]], { from: 'w', to: 'e', highway: 'tertiary' }), graph.edges[2]], profile: { z: [new Float32Array(2).fill(5), new Float32Array(2).fill(5)] } };
  const items = levelCrossingBarriers(one, [{ x: 0, y: 0, rail: 1, road: 0 }], { pathClasses: new Set(['footway']) });
  assert.equal(items.length, 2);
  assert.ok(items.some((b) => b.x > 3) && items.some((b) => b.x < -3));
});

test('a crossing mapped crossing:barrier=no gets none', () => {
  const c = [{ node: 'n', x: 0, y: 0, rail: [2], road: [0, 1], path: false }];
  assert.equal(levelCrossingBarriers(graph, c, { nodes: [{ x: 0.5, y: 0, tags: { railway: 'level_crossing', 'crossing:barrier': 'no' } }] }).length, 0);
  assert.equal(levelCrossingBarriers(graph, c, { nodes: [{ x: 0.5, y: 0, tags: { railway: 'level_crossing', 'crossing:barrier': 'half' } }] }).length, 2);
});
