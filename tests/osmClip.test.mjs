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

test('a pier mapped as an open line stays an open line: two-node jetties kept, longer ones not closed', () => {
  const bounds = { north: 1, south: 0, east: 1, west: 0 };
  const data = { elements: [
    { type: 'way', id: 21, tags: { man_made: 'pier' }, geometry: [[0.2, 0.5], [0.4, 0.5]].map(([lng, lat]) => ({ lat, lon: lng })) },
    { type: 'way', id: 22, tags: { man_made: 'pier' }, geometry: [[0.5, 0.5], [0.6, 0.5], [0.6, 0.6]].map(([lng, lat]) => ({ lat, lon: lng })) },
    // (crossing the map edge: cut at it, as a line)
    { type: 'way', id: 23, tags: { man_made: 'pier' }, geometry: [[0.8, 0.2], [1.3, 0.2]].map(([lng, lat]) => ({ lat, lon: lng })) },
  ] };
  const piers = parseOverpassResponse(data, bounds).filter((f) => f.type === 'pier');
  const byWay = (id) => piers.filter((f) => String(f.id).split('_')[0] === id);
  assert.equal(byWay('21').length, 1, 'the two-node jetty is kept');
  assert.equal(byWay('21')[0].geometry.length, 2);
  const bent = byWay('22')[0];
  assert.equal(bent.geometry.length, 3, 'the bent pier keeps its three nodes, not closed back to its start');
  const cut = byWay('23')[0];
  assert.ok(cut && cut.geometry.every((p) => p.lng <= 1 + 1e-9), 'the pier over the edge is cut at the bounds');
});

test('a single mapped shrub (natural=shrub node) is kept as vegetation, as a tree is', () => {
  const bounds = { north: 1, south: 0, east: 1, west: 0 };
  const data = { elements: [
    { type: 'node', id: 31, lat: 0.5, lon: 0.5, tags: { natural: 'shrub' } },
    { type: 'node', id: 32, lat: 0.6, lon: 0.5, tags: { natural: 'tree' } },
  ] };
  const veg = parseOverpassResponse(data, bounds).filter((f) => f.type === 'vegetation');
  assert.deepEqual(veg.map((f) => f.tags.natural).sort(), ['shrub', 'tree']);
});

test('a railway platform mapped as an open line is kept as a platform line', () => {
  const bounds = { north: 1, south: 0, east: 1, west: 0 };
  const data = { elements: [
    { type: 'way', id: 41, tags: { railway: 'platform' }, geometry: [[0.2, 0.5], [0.4, 0.5]].map(([lng, lat]) => ({ lat, lon: lng })) },
  ] };
  const pf = parseOverpassResponse(data, bounds).filter((f) => f.type === 'platform');
  assert.equal(pf.length, 1);
  assert.equal(pf[0].geometry.length, 2, 'still an open line of two nodes');
});

test('breakwaters and groynes mapped as lines are read (coverage level, 2026-11-24)', async () => {
  const { parseOverpassResponse } = await import('../services/osm.js');
  const b = { north: 40.01, south: 39.99, east: -74.99, west: -75.01 };
  const els = [];
  for (const [id, mm] of [[1, 'breakwater'], [2, 'groyne']]) {
    const g = [{ lat: 40, lon: -75 + id * 0.001 }, { lat: 40.002, lon: -75 + id * 0.001 }];
    els.push({ type: 'way', id, nodes: [id * 10, id * 10 + 1], geometry: g, tags: { man_made: mm } });
  }
  const f = parseOverpassResponse({ elements: els }, b).filter((x) => x.type === 'breakwater');
  assert.deepEqual(f.map((x) => x.tags.man_made).sort(), ['breakwater', 'groyne']);
  assert.ok(f.every((x) => x.geometry.length === 2), 'kept as lines');
});
