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
  // 16k at 4 m/px: 65.5 km across, corners ~46 km out
  const far = estimateLevelWeight({ terrainPx: 16384, metersPerPixel: 4, buildings: 0 });
  assert.equal(far.rating, 'veryHeavy');
  assert.ok(keys(far).includes('farEdge'));
  // 16k at 2.5 m/px: corners ~29 km out, close to the limit
  const near = estimateLevelWeight({ terrainPx: 16384, metersPerPixel: 2.5, buildings: 0 });
  assert.ok(keys(near).includes('nearEdge'));
  // 32k at 1 m/px: ~23 km, inside it
  assert.ok(!keys(estimateLevelWeight({ terrainPx: 32768, metersPerPixel: 1, buildings: 0 })).some((k) => k.endsWith('Edge')));
});
