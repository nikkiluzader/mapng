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
