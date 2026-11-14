import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateLevelWeight } from '../services/levelWeight.js';

const keys = (w) => w.notes.map((n) => n.key);

test('a small level is light with nothing to warn about', () => {
  const w = estimateLevelWeight({ terrainPx: 2048, metersPerPixel: 1, buildings: 3000, safeCaps: true });
  assert.equal(w.rating, 'light');
  assert.deepEqual(keys(w), []);
  assert.ok(Math.abs(w.farthestKm - 1.448) < 0.01);
});

test('16k is heavy; capped buildings are noted, not rated', () => {
  const w = estimateLevelWeight({ terrainPx: 16384, metersPerPixel: 1, buildings: 60000, safeCaps: true });
  assert.equal(w.rating, 'heavy');
  assert.deepEqual(keys(w), ['bigTerrain', 'buildingsCapped']);
  assert.equal(w.builtBuildings, 20000);
});

test('Build everything with a hundred thousand buildings is very heavy', () => {
  const w = estimateLevelWeight({ terrainPx: 16384, metersPerPixel: 1, buildings: 100000, safeCaps: false });
  assert.equal(w.rating, 'veryHeavy');
  assert.ok(keys(w).includes('manyBuildings'));
  assert.ok(keys(w).includes('uncapped'));
  assert.equal(w.builtBuildings, 100000);
});

test('corners past about 30 km from the centre warn about precision', () => {
  // 16k at 3 m/px: 49 km across, corners ~35 km out (at 4 m/px it is past what MapNG was tried on: the next test)
  const far = estimateLevelWeight({ terrainPx: 16384, metersPerPixel: 3, buildings: 0 });
  assert.equal(far.rating, 'veryHeavy');
  assert.ok(keys(far).includes('farEdge'));
  // 16k at 2.5 m/px: corners ~29 km out, close to the limit
  const near = estimateLevelWeight({ terrainPx: 16384, metersPerPixel: 2.5, buildings: 0 });
  assert.ok(keys(near).includes('nearEdge'));
  // 32k at 1 m/px: ~23 km, inside it
  assert.ok(!keys(estimateLevelWeight({ terrainPx: 32768, metersPerPixel: 1, buildings: 0 })).some((k) => k.endsWith('Edge')));
});

test('past anything MapNG was tried on: the top rating, a warning and still no block', () => {
  // a 16384 px map at 4 m/px over a city of four million buildings
  const tokyo = estimateLevelWeight({ terrainPx: 16384, metersPerPixel: 4, buildings: 4144896 });
  assert.equal(tokyo.rating, 'extreme');
  assert.equal(tokyo.notes[0].key, 'extremeSize');
  assert.deepEqual(tokyo.notes[0].params, { km: '66', count: (4144896).toLocaleString() });
  // by building count alone, and by size alone
  assert.equal(estimateLevelWeight({ terrainPx: 8192, metersPerPixel: 2, buildings: 1200000 }).rating, 'extreme');
  assert.equal(estimateLevelWeight({ terrainPx: 16384, metersPerPixel: 4, buildings: 10 }).rating, 'extreme');
  // a big but ordinary job stays where it was
  assert.equal(estimateLevelWeight({ terrainPx: 16384, metersPerPixel: 2, buildings: 300000 }).rating, 'heavy');
  assert.equal(estimateLevelWeight({ terrainPx: 16384, metersPerPixel: 3, buildings: 300000 }).rating, 'veryHeavy');
});
