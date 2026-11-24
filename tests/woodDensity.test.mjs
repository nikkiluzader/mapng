import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOverpassResponse } from '../services/osm.js';

// a square wood of side s metres at 40 N, as Overpass returns it
const LAT = 40; const LNG = -75; const kx = 111000 * Math.cos((LAT * Math.PI) / 180); const ky = 111000;
const wood = (id, s, tags = { natural: 'wood' }) => {
  const pts = [[0, 0], [s, 0], [s, s], [0, s], [0, 0]].map(([x, y]) => ({ lat: LAT + y / ky, lon: LNG + x / kx }));
  return [{ type: 'way', id, nodes: pts.map((_, i) => id * 10 + (i % 4)), geometry: pts, tags }];
};
const bounds = { north: LAT + 0.01, south: LAT - 0.01, east: LNG + 0.01, west: LNG - 0.01 };
const treesOf = (els) => parseOverpassResponse({ elements: els }, bounds).filter((f) => f.tags?.procedurally_generated === 'yes').length;

test('a mapped wood is planted about 10 m apart over its whole outline (coverage level, 2026-11-24)', () => {
  const n = treesOf(wood(1, 100));
  assert.ok(n >= 80 && n <= 120, `100 m square: ${n} trees (about 100)`);
  assert.ok(treesOf(wood(2, 24)) >= 4, 'a 24 m square: more than the 2 it had');
  // a big wood: capped
  assert.ok(treesOf(wood(3, 800)) <= 2000);
  // scrub sparser
  assert.ok(treesOf(wood(4, 100, { natural: 'scrub' })) < n);
});
