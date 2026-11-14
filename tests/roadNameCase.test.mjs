// Two roads whose names differ only in letter case must not share an object name: the game's names are not
// case-sensitive, and the second road's fields landed on the first (its 240 m of nodes moved 670 m across town).
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDecalRoads } from '../services/exportBeamNGLevel.js';

const deg = 1000 / 111320;
const bounds = { south: -deg / 2, north: deg / 2, west: -deg / 2, east: deg / 2 };
const line = (lat0, lng0, lat1, lng1) => [{ lat: lat0, lng: lng0 }, { lat: lat1, lng: lng1 }];
const terrain = (osmFeatures) => ({
  width: 512, height: 512, minHeight: 0, maxHeight: 10, heightMap: new Float32Array(512 * 512).fill(5),
  bounds, osmFeatures, roadRules: { countryCode: 'US', region: 'Americas' },
});

test('roads named alike but for letter case get object and folder names that differ without it', () => {
  const k = deg / 4;
  const groups = generateDecalRoads(terrain([
    { id: '1', type: 'road', geometry: line(-k, -k, -k, k), tags: { highway: 'primary', name: 'BRTS Bus Lane' } },
    { id: '2', type: 'road', geometry: line(0, -k, 0, k), tags: { highway: 'primary', name: 'BRTS Bus lane' } },
    { id: '3', type: 'road', geometry: line(k, -k, k, k), tags: { highway: 'primary', name: 'BRTS Bus lane' } },
    { id: '4', type: 'road', geometry: line(k / 2, -k, k / 2, k), tags: { highway: 'primary', name: 'brts bus lane' } },
  ]), 1000 / 511);
  const names = []; const folders = [];
  const walk = (items) => { for (const it of items || []) { if (it.class === 'SimGroup') folders.push(it.name); else if (it.name) names.push(it.name); walk(it.__items); } };
  walk(groups);
  assert.ok(names.length >= 4 && folders.length >= 4);
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length, 'object names');
  assert.equal(new Set(folders.map((n) => n.toLowerCase())).size, folders.length, 'folder names');
});
