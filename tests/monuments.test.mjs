import test from 'node:test';
import assert from 'node:assert/strict';
import { monumentKind, monumentHeight, monumentTriangles } from '../services/monuments.js';
import { placeBollards, BLOCK_SHAPE } from '../services/bollards.js';

test('monument kinds come from memorial=* and man_made=obelisk', () => {
  assert.equal(monumentKind({ man_made: 'obelisk' }), 'obelisk');
  assert.equal(monumentKind({ historic: 'memorial', memorial: 'stele' }), 'stele');
  assert.equal(monumentKind({ historic: 'memorial', memorial: 'stone' }), 'stone');
  assert.equal(monumentKind({ historic: 'memorial', memorial: 'statue' }), null);   // a model stands there
  assert.equal(monumentKind({ historic: 'memorial', memorial: 'plaque' }), null);   // on a wall
  assert.equal(monumentKind({ memorial: 'stone' }), null);
});

test('a monument height is its mapped one within its kind limits', () => {
  assert.equal(monumentHeight('obelisk', { height: '12' }), 12);
  assert.equal(monumentHeight('obelisk', { height: '300' }), 6);
  assert.equal(monumentHeight('stone', {}), 1.1);
});

test('every monument face points out of the monument', () => {
  for (const kind of ['obelisk', 'stele', 'stone']) {
    const m = { x: 10, y: -4, z: 2, kind, height: monumentHeight(kind, {}), yaw: 0.4 };
    const tris = monumentTriangles(m);
    assert.ok(tris.length > 8, kind);
    let top = -Infinity; for (const t of tris) for (const v of t) top = Math.max(top, v[2]);
    assert.ok(Math.abs(top - (m.z + m.height)) < 1e-6, `${kind} reaches its height`);
    const cz = m.z + m.height * 0.4;
    for (const [A, B, C] of tris) {
      const n = [(B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]), (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]), (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0])];
      const c = [(A[0] + B[0] + C[0]) / 3 - m.x, (A[1] + B[1] + C[1]) / 3 - m.y, (A[2] + B[2] + C[2]) / 3 - cz];
      // (sides out from the axis, tops up)
      const horiz = Math.hypot(n[0], n[1]) > Math.abs(n[2]);
      if (horiz) assert.ok(n[0] * c[0] + n[1] * c[1] > 0, `${kind} side faces out`);
      else assert.ok(n[2] > 0, `${kind} top faces up`);
    }
  }
});

test('a concrete block point stands as the precast blocks, off drawn roads', () => {
  const features = [
    { type: 'street_furniture', id: '17', tags: { barrier: 'block' }, geometry: [{ lat: 1, lng: 1 }] },
    { type: 'street_furniture', id: '18', tags: { barrier: 'block' }, geometry: [{ lat: 2, lng: 2 }] },
  ];
  const res = placeBollards({ features, toWorld: (lat, lng) => [lat, lng], heightAt: () => 3, onDrawnRoad: (x) => x === 2 });
  assert.equal(res.bollards.length, 1);
  assert.equal(res.bollards[0].shape, BLOCK_SHAPE);
  assert.equal(res.skipped.onRoad, 1);
});
