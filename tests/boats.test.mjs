import test from 'node:test';
import assert from 'node:assert/strict';

import { placeBoats, BOAT_TYPES } from '../services/boats.js';

test('boats moor alongside piers in deep enough water, never on land, a pier or each other', () => {
  // sea level 0; land north of y = 0, water deepening south to -4 m; piers running out south
  const groundAt = (x, y) => (y > 0 ? 2 : Math.max(-4, y * 0.1));
  const piers = Array.from({ length: 12 }, (_, i) => ({ nodes: [[i * 40, 0], [i * 40, -90]], half: 1.2 }));
  const onPier = (x, y) => piers.some((p) => Math.abs(x - p.nodes[0][0]) < p.half + 0.1 && y < 0 && y > -90);
  const boats = placeBoats({ piers, groundAt, seaZ: 0, blocked: onPier });
  assert.ok(boats.length > 0 && boats.length <= 10, `a few (${boats.length})`);
  for (const b of boats) {
    const t = BOAT_TYPES.find((k) => k.shape === b.shape);
    assert.ok(groundAt(b.x, b.y) < -Math.min(t.draft, 0.5), 'over water');
    assert.ok(Math.abs(b.z + t.draft) < 1e-9, 'sunk to its draft');
    assert.ok(!onPier(b.x, b.y), 'not on the pier');
    for (const o of boats) if (o !== b) assert.ok(Math.hypot(o.x - b.x, o.y - b.y) > 2, 'apart');
  }
  const perPier = new Map(); for (const b of boats) { const k = Math.round(b.x / 40); perPier.set(k, (perPier.get(k) || 0) + 1); }
  assert.ok([...perPier.values()].every((n) => n <= 2), 'two at a pier at most');
  assert.equal(placeBoats({ piers, groundAt: () => 1, seaZ: 0 }).length, 0, 'none where there is no water');
});
