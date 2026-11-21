// services/roadPick.js: pick the road nearest a click and follow it by name or number.
import test from 'node:test';
import assert from 'node:assert/strict';
import { drivableRoads, nearestRoad, followRoad, stretchBetween, distanceAlong, cumulative } from '../services/roadPick.js';

const D = 1 / 111320; const P = (x, y) => ({ lat: y * D, lng: x * D });
const way = (id, name, ref, highway, ...xy) => ({ id, type: 'road', tags: { highway, ...(name ? { name } : {}), ...(ref ? { ref } : {}) }, geometry: xy.map(([x, y]) => P(x, y)) });

// Main St runs west to east in three ways (the middle one drawn backwards); at x = 1000 it becomes "Oak Rd" (a new
// name: the follow stops); a side street joins at x = 500; SR 16 carries on by its ref through a name change
const net = drivableRoads([
  way('a', 'Main St', '', 'secondary', [0, 0], [500, 0]),
  way('b', 'Main St', '', 'secondary', [800, 0], [500, 0]),
  way('c', 'Main St', '', 'secondary', [800, 0], [1000, 0]),
  way('d', 'Oak Rd', '', 'secondary', [1000, 0], [1500, 0]),
  way('side', 'Elm St', '', 'residential', [500, 0], [500, 400]),
  way('e', 'Bay Rd', 'SR 16', 'primary', [0, 2000], [600, 2000]),
  way('f', 'Coast Hwy', 'SR 16', 'primary', [600, 2000], [1200, 2100]),
  { id: 'path', type: 'road', tags: { highway: 'footway' }, geometry: [P(0, 5), P(900, 5)] },
]);

test('only drivable roads; the nearest one to a click, none when too far', () => {
  assert.ok(!net.some((r) => r.id === 'path'));
  assert.equal(nearestRoad(net, P(300, 20)).id, 'a');
  assert.equal(nearestRoad(net, P(300, 900)), null);
});

test('follows the same name through reversed ways and stops at a new name', () => {
  const f = followRoad(net, net.find((r) => r.id === 'b'));
  assert.deepEqual(f.ids.sort(), ['a', 'b', 'c']);
  const xs = f.pts.map((p) => Math.round(p.lng / D));
  assert.equal(Math.min(...xs), 0); assert.equal(Math.max(...xs), 1000);
  // one continuous line, west to east or east to west
  assert.ok(xs.every((x, i) => i === 0 || Math.abs(x - xs[i - 1]) <= 500));
});

test('a road number carries on through a name change', () => {
  const f = followRoad(net, net.find((r) => r.id === 'e'));
  assert.deepEqual(f.ids.sort(), ['e', 'f']);
});

test('the stretch between two distances, cut exactly; a point projects onto the line', () => {
  const f = followRoad(net, net.find((r) => r.id === 'a'));
  const total = cumulative(f.pts).at(-1);
  assert.ok(Math.abs(total - 1000) < 2, `${total}`);   // (the test's degrees are 111,320 m; the Earth's mean radius gives 111,195)
  const s = stretchBetween(f.pts, 200, 700);
  assert.ok(Math.abs(cumulative(s).at(-1) - 500) < 1);
  assert.ok(Math.abs(distanceAlong(f.pts, P(350, 30)) - (f.pts[0].lng < f.pts.at(-1).lng ? 350 : 650) * 0.99888) < 1);
});

test('names and numbers match loosely', async () => {
  const { sameRoad } = await import('../services/roadPick.js');
  assert.ok(sameRoad({ ref: 'I 95' }, { ref: 'I 95;US 1' }));
  assert.ok(sameRoad({ ref: 'I-95' }, { ref: 'I 95' }));
  assert.ok(sameRoad({ name: 'Main St' }, { name: ' main  st' }));
  assert.ok(!sameRoad({ ref: 'I 95' }, { ref: 'I 295' }));
});

test('a dropped handle is reached along the roads, keeping to the picked road over a shortcut', async () => {
  const { routeAlongRoads } = await import('../services/roadPick.js');
  // I 95 in four pieces (one tagged "I 95;US 1"), bending north at x = 1000; a residential shortcut cuts the corner
  const roads = drivableRoads([
    way('m1', '', 'I 95', 'motorway', [0, 0], [500, 0]),
    way('m2', '', 'I 95;US 1', 'motorway', [500, 0], [1000, 0]),
    way('m3', '', 'I 95', 'motorway', [1000, 0], [1000, 600]),
    way('m4', '', 'I 95', 'motorway', [1000, 600], [1000, 1200]),
    way('cut', 'Short Ln', '', 'residential', [500, 0], [1000, 600]),
  ]);
  const path = routeAlongRoads(roads, P(0, 0), P(1000, 1180), { ref: 'I 95', highway: 'motorway' });
  assert.ok(path, 'a route');
  const xs = path.map((p) => Math.round(p.lng / D)); const ys = path.map((p) => Math.round(p.lat / D));
  // through the corner at (1000, 0), not the shortcut
  assert.ok(xs.some((x, i) => x === 1000 && ys[i] === 0), JSON.stringify(xs.map((x, i) => [x, ys[i]])));
  assert.equal(routeAlongRoads(roads, P(0, 0), P(5000, 5000), { ref: 'I 95' }), null, 'too far from any road');
});
