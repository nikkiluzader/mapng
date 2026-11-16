import test from 'node:test';
import assert from 'node:assert/strict';
import { osmTilesShown } from '../services/osmTilesInUse.js';

test('OpenStreetMap\'s tiles are on the map only with its layer chosen and its server answering', () => {
  assert.equal(osmTilesShown('osm'), true);
  assert.equal(osmTilesShown('osm', true), false);   // refused: the topo map stands in
  for (const l of ['satellite', 'topo', 'dark', 'height', 'relief', 'slope']) assert.equal(osmTilesShown(l), false, l);
});
