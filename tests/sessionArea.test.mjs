// services/sessionConfig.js: the area (tiles or a road) in share codes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeArea, buildSessionConfig, describeSessionConfig, sanitizeSessionConfig } from '../services/sessionConfig.js';

const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const D = 1 / 111320;

test('one tile is no area; tiles and roads are kept, checked', () => {
  assert.equal(sanitizeArea({ mode: 'tiles', tiles: { list: [{ dx: 0, dy: 0 }] } }), null);
  const t = sanitizeArea({ mode: 'tiles', tiles: { list: [{ dx: 5, dy: 5 }, { dx: 1, dy: 'x' }], together: false } });
  assert.deepEqual(t, { mode: 'tiles', tiles: { list: [{ dx: 0, dy: 0 }, { dx: 1, dy: 0 }], together: false, snap: true } });
  const many = sanitizeArea({ mode: 'tiles', tiles: { list: Array.from({ length: 500 }, (_, i) => ({ dx: i, dy: 0 })) } });
  assert.equal(many.tiles.list.length, 64);
});

test('a road: its points simplified, its ends and width held in range', () => {
  // a straight road of 3000 points: the middle ones dropped
  const pts = Array.from({ length: 3000 }, (_, i) => ({ lat: 0, lng: i * D }));
  const r = sanitizeArea({ mode: 'road', road: { pts, startM: -5, endM: 1e9, halfWidthM: 9999, names: ['Main St'], refs: ['SR 16'] } });
  assert.equal(r.road.pts.length, 2);
  assert.equal(r.road.startM, 0); assert.ok(r.road.endM > 2990 && r.road.endM < 3001);
  assert.equal(r.road.halfWidthM, 2000);
  assert.equal(sanitizeArea({ mode: 'road', road: { pts: [{ lat: 'a' }] } }), null);
});

test('the area goes into the config, its description, and through sanitizing', () => {
  const area = { mode: 'road', road: { pts: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1000 * D }], startM: 0, endM: 1000, halfWidthM: 300, names: ['Main St'] } };
  const c = buildSessionConfig({ center: { lat: 0, lng: 0 }, resolution: 1024 }, store(), { area });
  assert.equal(c.area.mode, 'road');
  const rows = describeSessionConfig(c);
  assert.ok(rows.some((r) => r.label === 'config.road' && r.params.name === 'Main St' && r.params.m === 300));
  assert.equal(sanitizeSessionConfig({ ...c, area: { mode: 'tiles', tiles: { list: [] } } }).area, undefined);
  assert.equal(buildSessionConfig({ center: { lat: 0, lng: 0 } }, store(), { area: { mode: 'tiles', tiles: { list: [{ dx: 0, dy: 0 }] } } }).area, undefined);
});

test("a road's ends come back where they were, and only the stretch is carried", () => {
  // a road with a bend, 3000 m; the stretch from 400 m to 2100 m
  const pts = [...Array.from({ length: 201 }, (_, i) => ({ lat: 0, lng: i * 10 * D })), ...Array.from({ length: 100 }, (_, i) => ({ lat: (i + 1) * 10 * D, lng: 2000 * D }))];
  const r = sanitizeArea({ mode: 'road', road: { pts, startM: 400, endM: 2100, halfWidthM: 200 } }).road;
  const first = r.pts[0]; const last = r.pts[r.pts.length - 1];
  // (within 3 m: the test's metres are 1 / 111,320 of a degree, the app's distances are on a sphere, 0.1 % apart)
  assert.ok(Math.abs(first.lng / D - 400) < 3 && Math.abs(first.lat) < 1e-9, `start at ${first.lng / D} m`);
  assert.ok(Math.abs(last.lat / D - 100) < 3 && Math.abs(last.lng / D - 2000) < 1, `end at ${last.lat / D} m up the second leg`);
  assert.equal(r.startM, 0); assert.ok(Math.abs(r.endM - 1700) < 2, `length ${r.endM}`);
  // the code has the stretch, not the 3 km it was cut from: the bend and the two ends
  assert.equal(r.pts.length, 3);
  // through a config and back: the same stretch
  const c = buildSessionConfig({ center: { lat: 0, lng: 0 }, resolution: 1024 }, store(), { area: { mode: 'road', road: { pts, startM: 400, endM: 2100, halfWidthM: 200 } } });
  const again = sanitizeSessionConfig(JSON.parse(JSON.stringify(c))).area.road;
  assert.ok(Math.abs(again.endM - 1700) < 2 && Math.abs(again.pts[0].lng / D - 400) < 3);
});

test('a hostile road is refused, not worked through', () => {
  const road = (pts, more = {}) => sanitizeArea({ mode: 'road', road: { pts, ...more } });
  // null or missing coordinates are not 0, 0
  assert.equal(road([{ lat: null, lng: null }, { lat: 1, lng: 1 }]), null);
  assert.equal(road([{ lat: 0, lng: 0 }, {}]), null);
  assert.equal(road([{ lat: true, lng: '' }, { lat: 1, lng: 1 }]), null);
  // far more points than the app ever makes
  assert.equal(road(Array.from({ length: 100000 }, (_, i) => ({ lat: 0, lng: i * D }))), null);
  // thousands of kilometres
  assert.equal(road([{ lat: 0, lng: 0 }, { lat: 40, lng: 60 }]), null);
  // a point with numbers as text is still a point
  assert.ok(road([{ lat: '0', lng: '0' }, { lat: '0', lng: String(500 * D) }]));
});
