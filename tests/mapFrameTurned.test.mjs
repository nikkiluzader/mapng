import test from 'node:test';
import assert from 'node:assert/strict';
import { frameBounds, frameUV, frameLatLngAt, gridLngLat, gridPosition, offsetMetres } from '../services/mapFrame.js';
import { geoToWorldPoint } from '../services/terrainLookup.js';
import { createGridProjector } from '../services/geoUtils.js';

const C = { lat: 54.9235, lng: 23.9762 };

test('an unturned frame is exactly the old one (angle 0, missing or 360)', () => {
  const a = frameBounds(C, 1024, 1024); const b = frameBounds(C, 1024, 1024, 0); const c = frameBounds(C, 1024, 1024, 360);
  assert.deepEqual(a, b); assert.deepEqual(a, c);
  assert.equal(a.angle, undefined);
  const p = { lat: 54.925, lng: 23.97 };
  const { u, v } = frameUV(a, p.lat, p.lng);
  assert.equal(u, (p.lng - a.west) / (a.east - a.west)); assert.equal(v, (a.north - p.lat) / (a.north - a.south));
});

test('a turned frame: corners, centre and round trips', () => {
  const b = frameBounds(C, 1024, 512, 30);
  assert.equal(b.angle, 30);
  // the centre at the middle
  const m = frameUV(b, C.lat, C.lng); assert.ok(Math.abs(m.u - 0.5) < 1e-12 && Math.abs(m.v - 0.5) < 1e-12);
  // the map's top-left corner: 512 m left and 256 m up along its turned axes
  const tl = frameLatLngAt(b, 0, 0); const o = offsetMetres(C, tl);
  const t = (30 * Math.PI) / 180;
  const want = { x: -512 * Math.cos(t) + 256 * Math.sin(t), y: 512 * Math.sin(t) + 256 * Math.cos(t) };
  assert.ok(Math.abs(o.x - want.x) < 1e-6 && Math.abs(o.y - want.y) < 1e-6, `top-left ${o.x.toFixed(3)}, ${o.y.toFixed(3)}`);
  // every corner inside the north-up box round it
  for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const q = frameLatLngAt(b, u, v); assert.ok(q.lat <= b.north + 1e-12 && q.lat >= b.south - 1e-12 && q.lng <= b.east + 1e-12 && q.lng >= b.west - 1e-12); }
  // round trips: grid <-> lat/lng
  for (const [gx, gy] of [[0, 0], [100.5, 37.25], [1024, 512]]) {
    const [lng, lat] = gridLngLat(b, 1024, 512, gx, gy); const back = gridPosition(b, 1024, 512, lat, lng);
    assert.ok(Math.abs(back.gx - gx) < 1e-6 && Math.abs(back.gy - gy) < 1e-6);
  }
});

test('a turned frame in the projectors: a point east of the centre lands along the turned axes of the map', () => {
  // a map turned 90 degrees: its "up" points east; a point 100 m east of the centre is 100 m up the level (y = +100)
  const b = frameBounds(C, 1024, 1024, 90);
  const td = { bounds: b, width: 1024, height: 1024, heightMap: new Float32Array(1024 * 1024), minHeight: 0 };
  const k = 1 / ((offsetMetres(C, { lat: C.lat, lng: C.lng + 0.001 }).x) / 0.001);   // degrees per metre east
  const [x, y] = geoToWorldPoint(C.lat, C.lng + 100 * k, td, 1);
  assert.ok(Math.abs(x) < 1e-6 && Math.abs(y - 100) < 1e-6, `world ${x.toFixed(4)}, ${y.toFixed(4)}`);
  const pj = createGridProjector(b, 1024, 1024)(C.lat, C.lng + 100 * k);
  assert.ok(Math.abs(pj.x - 512) < 1e-6 && Math.abs(pj.y - (412 - 1)) < 1e-6, `grid ${pj.x.toFixed(3)}, ${pj.y.toFixed(3)}`);
});

test('clipFeaturesToBounds on a turned map: features clipped to the turned square, not the north-up box round it', async () => {
  const { clipFeaturesToBounds } = await import('../services/osm.js');
  const { frameLatLngAt } = await import('../services/mapFrame.js');
  const b = frameBounds(C, 1000, 1000, 45);
  const at = (u, v) => frameLatLngAt(b, u, v);
  // a point inside the turned square, and one in the north-up box's corner but outside the turned square
  const inside = at(0.5, 0.5); const corner = { lat: b.north - 1e-6, lng: b.west + 1e-6 };
  // a road across the whole box: kept only between the turned square's edges
  const road = { id: 'r', type: 'road', tags: { highway: 'residential' }, geometry: [{ lat: C.lat, lng: b.west }, { lat: C.lat, lng: b.east }] };
  const out = clipFeaturesToBounds([
    { id: 'p1', type: 'tree', tags: {}, geometry: [inside] },
    { id: 'p2', type: 'tree', tags: {}, geometry: [corner] },
    road,
  ], b);
  assert.deepEqual(out.filter((f) => f.type === 'tree').map((f) => f.id), ['p1']);
  const seg = out.find((f) => f.type === 'road');
  assert.ok(seg, 'the road kept inside');
  // its ends on the turned square's edge: u or v at 0 or 1
  for (const p of [seg.geometry[0], seg.geometry[seg.geometry.length - 1]]) {
    const q = frameUV(b, p.lat, p.lng);
    assert.ok([q.u, q.v].some((x) => Math.abs(x) < 1e-6 || Math.abs(x - 1) < 1e-6), `end at u ${q.u.toFixed(4)}, v ${q.v.toFixed(4)}`);
  }
});
