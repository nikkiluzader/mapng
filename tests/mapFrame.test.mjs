// services/mapFrame.js: the one definition of where a map's pixels are.
import test from 'node:test';
import assert from 'node:assert/strict';
import proj4 from 'proj4';
import { metresPerDegree, frameBounds, gridLngLat, vertexLatLng, gridPosition, offsetLatLng, offsetMetres } from '../services/mapFrame.js';
import { createGridProjector } from '../services/geoUtils.js';
import { getTerrainHeightWorld } from '../services/terrainLookup.js';

const geod = (a, b) => {   // metres between two close points, through a local transverse Mercator at their middle
  const def = `+proj=tmerc +lat_0=${(a.lat + b.lat) / 2} +lon_0=${(a.lng + b.lng) / 2} +k=1 +datum=WGS84 +units=m +no_defs`;
  const p = proj4('EPSG:4326', def); const A = p.forward([a.lng, a.lat]); const B = p.forward([b.lng, b.lat]);
  return Math.hypot(A[0] - B[0], A[1] - B[1]);
};

test('a degree in metres follows the ellipsoid, not a flat 111,320', () => {
  for (const lat of [0, 30, 45, 60, 70]) {
    const k = metresPerDegree(lat);
    const d = 0.001;
    assert.ok(Math.abs(geod({ lat: lat - d / 2, lng: 10 }, { lat: lat + d / 2, lng: 10 }) / d / k.lat - 1) < 1e-6, `lat ${lat} north-south`);
    assert.ok(Math.abs(geod({ lat, lng: 10 - d / 2 }, { lat, lng: 10 + d / 2 }) / d / k.lng - 1) < 1e-6, `lat ${lat} east-west`);
  }
  assert.ok(Math.abs(metresPerDegree(0).lat - 110574.3) < 1); assert.ok(Math.abs(metresPerDegree(0).lng - 111319.5) < 1);
});

test("a map's bounds are exactly its size through the centre: no padding", () => {
  for (const [lat, w, h] of [[0, 512, 512], [45, 4096, 2048], [60, 30000, 216], [-33, 16384, 16384]]) {
    const c = { lat, lng: 20 }; const b = frameBounds(c, w, h);
    assert.ok(Math.abs(geod({ lat, lng: b.west }, { lat, lng: b.east }) / w - 1) < 2e-5, `${lat} width`);
    assert.ok(Math.abs(geod({ lat: b.south, lng: 20 }, { lat: b.north, lng: 20 }) / h - 1) < 2e-5, `${lat} height`);
    assert.ok(Math.abs((b.north + b.south) / 2 - lat) < 1e-12 && Math.abs((b.east + b.west) / 2 - 20) < 1e-12);
  }
});

test('a height sample is where the game draws it, and where the map data is placed', () => {
  const W = 300; const H = 120; const mpp = 2; const c = { lat: 47, lng: 8 };
  const bounds = frameBounds(c, W * mpp, H * mpp);
  const project = createGridProjector(bounds, W, H);
  // vertex (col, row): the projector gives the same column and row back
  for (const [col, row] of [[0, 0], [17, 5], [W - 1, H - 1], [150, 60]]) {
    const p = vertexLatLng(bounds, W, H, col, row); const q = project(p.lat, p.lng);
    assert.ok(Math.abs(q.x - col) < 1e-6 && Math.abs(q.y - row) < 1e-6, `${col},${row} -> ${q.x},${q.y}`);
  }
  // the game: sample (i, j from the south) at ((i - W/2) sq, (j - H/2) sq) metres from the centre
  for (const [col, row] of [[0, H - 1], [W - 1, 0], [42, 77]]) {
    const p = vertexLatLng(bounds, W, H, col, row); const m = offsetMetres(c, p);
    const j = H - 1 - row;
    assert.ok(Math.abs(m.x - (col - W / 2) * mpp) < 1e-6 && Math.abs(m.y - (j - H / 2) * mpp) < 1e-6);
  }
  // a height written at each vertex's own position is read back there exactly
  const f = (lat, lng) => 100 + (lat - bounds.south) * 5000 + (lng - bounds.west) * 3000;
  const heightMap = new Float32Array(W * H);
  for (let r = 0; r < H; r++) for (let x = 0; x < W; x++) { const p = vertexLatLng(bounds, W, H, x, r); heightMap[r * W + x] = f(p.lat, p.lng); }
  const td = { bounds, width: W, height: H, heightMap, minHeight: 0 };
  for (const [gx, gy] of [[10.5, 20.25], [200.2, 99.9], [1, 2]]) {
    const [lng, lat] = gridLngLat(bounds, W, H, gx, gy);
    assert.ok(Math.abs(getTerrainHeightWorld(lat, lng, td) - f(lat, lng)) < 2e-3, `at ${gx},${gy}`);
  }
});

test('positions in squares and offsets in metres go there and back', () => {
  const c = { lat: 60, lng: -3 }; const b = frameBounds(c, 1000, 400);
  const g = gridPosition(b, 500, 200, c.lat, c.lng);
  assert.ok(Math.abs(g.gx - 250) < 1e-9 && Math.abs(g.gy - 100) < 1e-9);
  const p = offsetLatLng(c, 250, -80); const m = offsetMetres(c, p);
  assert.ok(Math.abs(m.x - 250) < 1e-9 && Math.abs(m.y + 80) < 1e-9);
  const [lng, lat] = gridLngLat(b, 500, 200, 500, 200);
  assert.ok(Math.abs(lng - b.east) < 1e-12 && Math.abs(lat - b.south) < 1e-12);
});

test('a height read by fractions of the map lands on the samples where the game has them', async () => {
  const { heightAtFraction } = await import('../services/mapFrame.js');
  const W = 8; const H = 4;
  // sample (c, r) stands at u = c / W, v = (r + 1) / H; a ground that is a plane in (u, v) is read back exactly
  const plane = (u, v) => 100 + 40 * u - 24 * v;
  const hm = new Float32Array(W * H); for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) hm[r * W + c] = plane(c / W, (r + 1) / H);
  for (const [u, v] of [[0, 0.25], [0.5, 0.5], [0.31, 0.77], [7 / 8, 1]]) assert.ok(Math.abs(heightAtFraction(hm, W, H, u, v) - plane(u, v)) < 1e-4, `${u}, ${v}`);
  assert.equal(heightAtFraction(hm, W, H, 3 / W, 2 / H), hm[1 * W + 3]);          // on a sample: that sample
  // past the outermost samples (the east strip, the north strip): the edge value holds
  assert.equal(heightAtFraction(hm, W, H, 1, 0.5), heightAtFraction(hm, W, H, 7 / 8, 0.5));
  assert.equal(heightAtFraction(hm, W, H, 0.5, 0), heightAtFraction(hm, W, H, 0.5, 1 / H));
  // no-data samples are left out; nothing valid: the fallback
  const holes = Float32Array.from(hm); holes[1 * W + 3] = -32768;
  assert.ok(Number.isFinite(heightAtFraction(holes, W, H, 3.2 / W, 2.1 / H)) && heightAtFraction(holes, W, H, 3.2 / W, 2.1 / H) > 0);
  assert.equal(heightAtFraction(new Float32Array(W * H).fill(-32768), W, H, 0.5, 0.5, { fallback: 7 }), 7);
});
