import test from 'node:test';
import assert from 'node:assert/strict';
import { HOTSPOT_CELL_DEG, binHotspots, daysSince, hotspotCell, hotspotCellCenter, isHotspotCell } from '../services/exportHotspots.js';

test('a point maps to its ~5 km cell, and the cell centre lies inside it', () => {
  for (const [lat, lon] of [[29.8946, -81.3145], [-33.8688, 151.2093], [0, 0], [89.99, 179.99], [-90, -180], [90, 180]]) {
    const cell = hotspotCell(lat, lon);
    assert.ok(isHotspotCell(cell.y, cell.x), `${lat},${lon}`);
    const c = hotspotCellCenter(cell.y, cell.x);
    assert.ok(Math.abs(c.lat - lat) <= HOTSPOT_CELL_DEG / 2 + 1e-9 || Math.abs(lat) === 90);
    assert.ok(Math.abs(c.lon - lon) <= HOTSPOT_CELL_DEG / 2 + 1e-9 || Math.abs(lon) === 180);
  }
});

test('nearby points share a cell; the exact spot is not recoverable', () => {
  assert.deepEqual(hotspotCell(29.8901, -81.3101), hotspotCell(29.8999, -81.3499));
});

test('off-Earth and junk input is refused', () => {
  for (const [lat, lon] of [[91, 0], [0, 181], [NaN, 0], [0, Infinity], ['29', -81]]) {
    assert.equal(hotspotCell(lat, lon), null);
  }
  assert.equal(isHotspotCell(-1, 0), false);
  assert.equal(isHotspotCell(3600, 0), false);
  assert.equal(isHotspotCell(0, 7200), false);
  assert.equal(isHotspotCell(1.5, 2), false);
  assert.equal(isHotspotCell('1', 2), false);
});

test('cells close on screen merge into one dot that adds them up', () => {
  const project = (lat, lon) => ({ x: lon * 10, y: -lat * 10 });
  const a = hotspotCell(29.89, -81.31); const b = hotspotCell(29.95, -81.36); const far = hotspotCell(40.7, -74);
  const dots = binHotspots([{ ...a, total: 3, web: 2, desktop: 1 }, { ...b, total: 1, web: 1, desktop: 0 }, { ...far, total: 5, web: 5, desktop: 0 }], project);
  assert.equal(dots.length, 2);
  assert.deepEqual(dots.map((d) => d.total).sort(), [4, 5]);
});

test('a merged dot knows its cells, their extent and the newest day', () => {
  const project = (lat, lon) => ({ x: lon * 10, y: -lat * 10 });
  const a = hotspotCell(29.89, -81.31); const b = hotspotCell(29.95, -81.36);
  const [dot] = binHotspots([
    { ...a, total: 3, web: 2, desktop: 1, lastDay: '2026-10-01' },
    { ...b, total: 1, web: 1, desktop: 0, lastDay: '2026-11-04' },
  ], project);
  assert.equal(dot.cells, 2);
  assert.equal(dot.lastDay, '2026-11-04');
  const [[s, w], [n, e]] = dot.bounds;
  for (const c of [a, b]) {
    const { lat, lon } = hotspotCellCenter(c.y, c.x);
    assert.ok(lat > s && lat < n && lon > w && lon < e);
  }
});

test('days since an export day', () => {
  const now = Date.parse('2026-11-05T15:00:00Z');
  assert.equal(daysSince('2026-11-05', now), 0);
  assert.equal(daysSince('2026-11-04', now), 1);
  assert.equal(daysSince('2026-10-29', now), 7);
  assert.equal(daysSince(null, now), null);
  assert.equal(daysSince('junk', now), null);
});
