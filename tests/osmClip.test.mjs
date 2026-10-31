import test from 'node:test';
import assert from 'node:assert/strict';

import { parseOverpassResponse } from '../services/osm.js';

test('a water outline crossing the map edge stays a closed ring after clipping', () => {
  const bounds = { north: 1, south: 0, east: 1, west: 0 };
  // a closed outline whose first and last node lie outside: the clip cuts its closing edge
  const pts = [[1.2, 0.5], [0.5, 0.5], [0.5, 0.2], [0.6, 0.2], [1.2, 0.3], [1.2, 0.5]];
  const data = { elements: [
    { type: 'way', id: 7, tags: { natural: 'water', water: 'river' }, geometry: pts.map(([lng, lat]) => ({ lat, lon: lng })) },
    { type: 'way', id: 8, tags: { barrier: 'wall' }, geometry: [[0.5, 0.8], [1.5, 0.8]].map(([lng, lat]) => ({ lat, lon: lng })) },
  ] };
  const features = parseOverpassResponse(data, bounds);
  const water = features.find((f) => f.id === '7');
  assert.ok(water, 'clipped outline kept');
  const g = water.geometry;
  assert.deepEqual(g[0], g[g.length - 1], 'first point repeated at the end');
  assert.ok(g.every((p) => p.lng <= 1 + 1e-9), 'inside the bounds');
});
