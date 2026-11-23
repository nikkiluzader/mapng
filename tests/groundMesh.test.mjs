// services/groundMesh.js: the ground as simplified models, exact where it must be.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGroundTiles } from '../services/groundMesh.js';

const make = (W, H, f) => { const hm = new Float32Array(W * H); for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) hm[r * W + c] = f(c, H - 1 - r); return { width: W, height: H, heightMap: hm, minHeight: 0 }; };
const tris = (res) => res.tiles.flatMap((t) => t.groups.flatMap((g) => { const out = []; for (let v = 0; v < g.positions.length; v += 9) out.push([...g.positions.subarray(v, v + 9)]); return out; }));
const area = (t) => ((t[3] - t[0]) * (t[7] - t[1]) - (t[4] - t[1]) * (t[6] - t[0])) / 2;

test('a flat plane is a handful of triangles, faces up, covering the grid exactly', () => {
  const ter = make(257, 257, () => 5);
  const res = buildGroundTiles(ter, 1, { tile: 64 });
  const T = tris(res);
  let a = 0; for (const t of T) { const s = area(t); assert.ok(s > 0, 'counter-clockwise from above'); a += s; }
  assert.ok(Math.abs(a - 256 * 256) < 1e-6, `covers 256 x 256 m: ${a}`);
  assert.ok(res.summary.triangles < res.summary.fullTriangles / 5, JSON.stringify(res.summary));
  for (const t of T) for (const z of [t[2], t[5], t[8]]) assert.equal(z, 5);
});

test('bumpy ground stays within the error between kept points, exact at them', () => {
  const f = (i, j) => Math.sin(i * 0.21) * 3 + Math.cos(j * 0.13) * 2 + (i * j) % 7 * 0.01;
  const ter = make(129, 129, f);
  const res = buildGroundTiles(ter, 1, { tile: 64, maxError: 0.05 });
  let worst = 0;
  for (const t of tris(res)) {
    for (const v of [0, 3, 6]) assert.ok(Math.abs(t[v + 2] - f(t[v] + 64.5, t[v + 1] + 64.5)) < 1e-4, 'kept points exact');
    // the triangle's grid points: barycentric height vs measured
    const [x0, y0, , x1, y1, , x2, y2] = t; const d = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    for (let x = Math.min(x0, x1, x2); x <= Math.max(x0, x1, x2); x++) for (let y = Math.min(y0, y1, y2); y <= Math.max(y0, y1, y2); y++) {
      const l1 = ((x - x0) * (y2 - y0) - (x2 - x0) * (y - y0)) / d; const l2 = ((x1 - x0) * (y - y0) - (x - x0) * (y1 - y0)) / d; const l0 = 1 - l1 - l2;
      if (l0 < -1e-9 || l1 < -1e-9 || l2 < -1e-9) continue;
      const z = l0 * t[2] + l1 * t[5] + l2 * t[8];
      worst = Math.max(worst, Math.abs(z - f(x + 64.5, y + 64.5)));
    }
  }
  assert.ok(worst <= 0.05 + 1e-4, `worst ${worst}`);
  assert.ok(res.summary.triangles < res.summary.fullTriangles, JSON.stringify(res.summary));
});

test('holes are left open, surfaces change exactly at their squares, tiles share their edges', () => {
  const W = 129; const ter = make(W, W, () => 1);
  const layer = new Uint8Array(W * W);
  for (let j = 0; j < W; j++) for (let i = 40; i < 50; i++) layer[j * W + i] = 1;     // a road band
  layer[100 * W + 100] = 255;                                                            // one hole square
  const res = buildGroundTiles(ter, 1, { tile: 64, layerMap: layer, groundModelOf: (L) => (L === 1 ? 'ASPHALT' : 'GRASS') });
  assert.deepEqual([...res.groundModels].sort(), ['ASPHALT', 'GRASS']);
  let road = 0; let hole = false;
  for (const t of res.tiles) for (const g of t.groups) for (let v = 0; v < g.positions.length; v += 9) {
    const cx = (g.positions[v] + g.positions[v + 3] + g.positions[v + 6]) / 3 + 64.5; const cy = (g.positions[v + 1] + g.positions[v + 4] + g.positions[v + 7]) / 3 + 64.5;
    const inBand = cx > 40 && cx < 50;
    assert.equal(g.groundModel === 'ASPHALT', inBand, `surface at ${cx},${cy}`);
    if (inBand) road += Math.abs(area([...g.positions.subarray(v, v + 9)]));
    if (Math.floor(cx) === 100 && Math.floor(cy) === 100) hole = true;
  }
  assert.ok(Math.abs(road - 10 * 128) < 1e-6, `the road band's area ${road}`);
  assert.equal(hole, false); assert.equal(res.summary.holeTriangles, 2);
});

test('squares outside the kept area are left out', () => {
  const ter = make(129, 129, () => 0);
  const res = buildGroundTiles(ter, 1, { tile: 64, keepSquare: (i) => i < 64 });
  let a = 0; for (const t of tris(res)) a += area(t);
  assert.ok(Math.abs(a - 64 * 128) < 1e-6, `${a}`);
  assert.equal(res.tiles.length, 2);
});

test('the edge wall: under every side of the ground that faces outside the level, facing outward, and nowhere else', async () => {
  const { EDGE_SKIRT_M } = await import('../services/groundMesh.js');
  const W = 9; const H = 9; const hm = new Float32Array(W * H).fill(100);
  const ter = { width: W, height: H, heightMap: hm, minHeight: 90 };
  // a plain 8 x 8 square of ground: 4 sides of 8 squares, two triangles each
  const plain = buildGroundTiles(ter, 1, { tile: 8 });
  assert.equal(plain.summary.skirtTriangles, 4 * 8 * 2);
  const sk = plain.tiles[0].skirt;
  let zMin = Infinity; let zMax = -Infinity; for (let k = 2; k < sk.positions.length; k += 3) { zMin = Math.min(zMin, sk.positions[k]); zMax = Math.max(zMax, sk.positions[k]); }
  assert.equal(zMax, 10); assert.equal(zMin, 10 - EDGE_SKIRT_M);
  // each triangle faces the way its normal says, and that is away from the middle of the map
  for (let t = 0; t < sk.positions.length; t += 9) {
    const p = (k) => [sk.positions[t + k * 3], sk.positions[t + k * 3 + 1], sk.positions[t + k * 3 + 2]];
    const [a, b, c] = [p(0), p(1), p(2)]; const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2]];
    const given = [sk.normals[t], sk.normals[t + 1]];
    assert.ok(n[0] * given[0] + n[1] * given[1] > 0, 'winding and normal agree');
    const mid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
    assert.ok(mid[0] * given[0] + mid[1] * given[1] > 0, 'faces outward');
  }
  // an L (the north-east quarter missing): the cut gets a wall too
  const keepL = (i, j) => !(i >= 4 && j >= 4);
  const L = buildGroundTiles(ter, 1, { tile: 8, keepSquare: keepL });
  assert.equal(L.summary.skirtTriangles, (8 + 8 + 4 + 4 + 4 + 4) * 2);
  // a chunk's hand-over to its neighbour is no edge: the same cut, said to be another part's, has no wall
  const chunk = buildGroundTiles(ter, 1, { tile: 8, keepSquare: keepL, isLevelEdge: (i, j) => i < 0 || j < 0 || i >= W - 1 || j >= H - 1 });
  assert.equal(chunk.summary.skirtTriangles, (8 + 8 + 4 + 4) * 2);
  // switched off
  assert.equal(buildGroundTiles(ter, 1, { tile: 8, skirtM: 0 }).summary.skirtTriangles, 0);
  assert.equal(buildGroundTiles(ter, 1, { tile: 8, skirtM: 0 }).tiles[0].skirt, null);
});
