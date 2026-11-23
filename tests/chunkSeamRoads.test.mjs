// chunkSeamRoads.js: a finished chunk's solved road heights handed to the next chunk's solver.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seamRoadsOut, seamRoadLookup, seamRoadPins } from '../services/chunkSeamRoads.js';
import { joinSeamRoads } from '../services/chunkMerge.js';

// a straight road along x, stations every 4 m, climbing 5 % from z0
const edge = (wayId, x0, n, y = 0) => ({ wayId, seg: wayId, s: Float64Array.from({ length: n }, (_, i) => i * 4), x: Float64Array.from({ length: n }, (_, i) => x0 + i * 4), y: new Float64Array(n).fill(y) });
const graphOf = (edges, zOf) => ({ edges, profile: { z: edges.map((e) => Float64Array.from(e.x, zOf)) } });

test('a chunk hands on its solved heights as absolute metres, with the tunnel it built', () => {
  const g = graphOf([edge(7, 0, 5), { ...edge(null, 0, 5) }], (x) => x * 0.05);
  const out = seamRoadsOut(g, 100, (e) => (e.wayId === 7 ? 'bore' : ''));
  assert.equal(out.length, 1);                      // (a road with no OSM id cannot be matched: not handed on)
  assert.equal(out[0].tunnel, 'bore');
  assert.ok(Math.abs(out[0].z[4] - (100 + 16 * 0.05)) < 1e-9);
});

test('the next chunk reads the height between two stations, moved by the chunks’ offset, on the same way only', () => {
  const out = seamRoadsOut(graphOf([edge(7, 0, 50)], (x) => x * 0.05), 100);
  // (the neighbour's centre is 1792 m west of this chunk's)
  const look = seamRoadLookup([{ roads: out, dx: -1792, dy: 0 }]);
  const h = look.at(7, -1792 + 10, 0.5);
  assert.ok(Math.abs(h.z - 100.5) < 1e-9);
  assert.equal(look.at(8, -1792 + 10, 0.5), null);          // another road at the same place
  assert.equal(look.at(7, -1792 + 10, 3), null);            // 3 m beside it: not this road's line
  assert.equal(look.at(7, 10, 0), null);                    // where the neighbour is not
  assert.equal(seamRoadLookup([{ roads: [], dx: 0, dy: 0 }]), null);
});

test('stations in the seam’s band are pinned at the neighbour’s heights in this chunk’s datum, the rest left free', () => {
  const out = seamRoadsOut(graphOf([edge(7, 0, 50)], (x) => x * 0.05), 100);
  const look = seamRoadLookup([{ roads: out, dx: 0, dy: 0 }]);
  // this chunk's own cut of the same road, its stations 2 m off the neighbour's; the band is x < 40
  const mine = { edges: [edge(7, 2, 30), edge(9, 2, 30, 20)] };
  const fit = seamRoadPins(mine, look, (x) => (x < 40 ? 1 : 0.5), 90);
  assert.equal(fit.edges, 1);
  assert.equal(fit.pins.length, 10);                        // x = 2, 6 ... 38
  for (const [k, i, z] of fit.pins) { assert.equal(k, 0); assert.ok(Math.abs(z - (100 + mine.edges[0].x[i] * 0.05 - 90)) < 1e-9); }
});

test('the merge counts road ends that meet in plan and not in height', () => {
  const road = (name, nodes) => ({ o: { class: 'DecalRoad', name, material: 'm', nodes }, chunk: name });
  const a = road('a', [[0, 0, 5, 6], [10, 0, 5, 6]]); const b = road('b', [[10, 0, 7.5, 6], [20, 0, 8, 6]]);
  const res = joinSeamRoads([a, b]);
  assert.equal(res.joins, 0); assert.equal(res.stepped, 1); assert.ok(Math.abs(res.worstStep - 2.5) < 1e-9);
  const c = road('c', [[0, 0, 5, 6], [10, 0, 5, 6]]); const d = road('d', [[10, 0, 5.1, 6], [20, 0, 8, 6]]);
  const ok = joinSeamRoads([c, d]);
  assert.equal(ok.joins, 1); assert.equal(ok.stepped, 0);
});

test('where several finished chunks hold a stretch, the one that keeps the ground there has the say', () => {
  const road = (z0) => seamRoadsOut(graphOf([edge(7, 0, 50)], () => z0), 0);
  // chunk A keeps x < 100, chunk B saw the same stretch in its margin only (and solved it 4 m higher)
  const look = seamRoadLookup([{ key: 'B', roads: road(14), owns: () => false, dx: 0, dy: 0 }, { key: 'A', roads: road(10), owns: (x) => x < 100, dx: 0, dy: 0 }, { key: 'C', roads: road(14), owns: () => false, dx: 0, dy: 0 }]);
  assert.equal(look.at(7, 50, 0).z, 10); assert.equal(look.at(7, 50, 0).from, 'A');
  // past what any of them keeps: a copy is still handed on (a tunnel's tube runs on there)
  assert.equal(look.at(7, 150, 0).z, 14);
});
