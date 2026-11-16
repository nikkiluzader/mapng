import test from 'node:test';
import assert from 'node:assert/strict';
import { fillRows, rowDirection } from '../services/areaRows.js';

test('rows fill a field along its longest side, each piece whole inside it', () => {
  // a 100 x 40 m field, turned 30 degrees
  const a = Math.PI / 6; const c = Math.cos(a); const s = Math.sin(a);
  const ring = [[0, 0], [100, 0], [100, 40], [0, 40]].map(([x, y]) => [x * c - y * s + 500, x * s + y * c - 200]);
  assert.ok(Math.abs(Math.sin(rowDirection(ring) - a)) < 1e-9, 'rows along the 100 m side');
  const pieces = fillRows(ring, { length: 5.6, pitch: 2.5, margin: 1 });
  // (rows: (40 - 2) / 2.5 = 15; pieces a row: floor(98 / 5.6) = 17)
  assert.ok(pieces.length >= 15 * 16 && pieces.length <= 15 * 17, `${pieces.length} pieces`);
  assert.ok(pieces.every((p) => Math.abs(Math.sin(p.yaw - a)) < 1e-9));
  // every piece's two ends inside the field, a metre clear of its edge
  for (const p of pieces) for (const k of [-2.8, 2.8]) {
    const x = p.x + k * Math.cos(p.yaw) - 500; const y = p.y + k * Math.sin(p.yaw) + 200;
    const u = x * c + y * s; const v = -x * s + y * c;
    assert.ok(u >= 1 - 1e-6 && u <= 99 + 1e-6 && v >= 1 - 1e-6 && v <= 39 + 1e-6, `${u}, ${v}`);
  }
});

test('a hole is left clear, a cap holds, and a field too small for a piece gets none', () => {
  const ring = [[0, 0], [60, 0], [60, 60], [0, 60]];
  const hole = [[20, 20], [40, 20], [40, 40], [20, 40]];
  const pieces = fillRows(ring, { holes: [hole], length: 4, pitch: 3, margin: 0.5 });
  assert.ok(pieces.length > 0);
  assert.ok(!pieces.some((p) => p.x > 19.5 && p.x < 40.5 && p.y > 19.5 && p.y < 40.5), 'none in the hole');
  assert.equal(fillRows(ring, { length: 4, pitch: 3, cap: 10 }).length, 10);
  assert.equal(fillRows([[0, 0], [3, 0], [3, 3], [0, 3]], { length: 5.6, pitch: 2.5 }).length, 0);
});
