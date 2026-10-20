import test from 'node:test';
import assert from 'node:assert/strict';

import { chooseTreeGroup, chooseTreeItem, treeHintFromTags } from '../services/beamngTrees.js';
import { TREE_GROUPS, TREE_ITEMS } from '../services/beamngTreeLibrary.js';

const pick = (opts, n = 300) => {
  const groups = {}; const types = {};
  for (let i = 0; i < n; i++) {
    const seed = `${opts.lat}:${opts.lon}:${i}`;
    const g = chooseTreeGroup({ kind: 'tree', ...opts, seed });
    const it = chooseTreeItem(g, { lat: opts.lat, lon: opts.lon, tags: opts.tags || {}, seed });
    groups[g] = (groups[g] || 0) + 1;
    types[it.type] = (types[it.type] || 0) + 1;
  }
  return { groups, types };
};
const share = (counts, key, n = 300) => (counts[key] || 0) / n;
const has = (types, re) => Object.keys(types).some((t) => re.test(t));

test('Phoenix streets: palms and broadleaves, no aspens, firs or redwoods', () => {
  const { groups, types } = pick({ lat: 33.5167, lon: -111.9774, urban: true });
  assert.ok(share(groups, 'palm') > 0.25 && share(groups, 'palm') < 0.45, `palms ${share(groups, 'palm')}`);
  assert.ok(!has(types, /douglasfir|redwood/), Object.keys(types).join(','));
  const top = Math.max(...Object.values(types));
  assert.ok(top < 40, `no single model dominates (max ${top}/300)`);
});

test('open desert: junipers; Flagstaff forest: pines', () => {
  assert.ok(share(pick({ lat: 33.6, lon: -111.7, urban: false }).groups, 'juniper') > 0.8);
  const forest = pick({ lat: 35.2, lon: -111.6, urban: false, area: true, tags: { leaf_type: 'needleleaved' } });
  assert.equal(share(forest.groups, 'pine_west'), 1);
  assert.ok(!has(forest.types, /redwood/), 'no redwoods in Arizona');
});

test('California coast: pines and oaks; redwoods only in the north; palms in LA', () => {
  const la = pick({ lat: 34.05, lon: -118.25, urban: true });
  assert.ok(share(la.groups, 'palm') > 0.45, `LA palms ${share(la.groups, 'palm')}`);
  assert.ok(la.groups.oak_west > 0);
  const sf = pick({ lat: 37.77, lon: -122.42, urban: false, tags: { leaf_type: 'needleleaved' } });
  assert.equal(share(sf.groups, 'pine_west'), 1);
  assert.ok(has(sf.types, /redwood/), 'redwoods in Northern California');
  assert.ok(!has(pick({ lat: 34.05, lon: -118.25, urban: false, tags: { leaf_type: 'needleleaved' } }).types, /redwood/));
});

test('the East: eastern broadleaves and firs, no palms', () => {
  const { groups } = pick({ lat: 42.36, lon: -71.06, urban: true });
  assert.equal(groups.palm || 0, 0);
  assert.ok(groups.deciduous > 150 && (groups.conifer || 0) > 0);
});

test('OSM tags win: genus, leaf type', () => {
  assert.equal(treeHintFromTags({ genus: 'Washingtonia' }), 'palm');
  assert.equal(chooseTreeGroup({ tags: { genus: 'Washingtonia' }, lat: 42.36, lon: -71.06, seed: 'x' }), 'palm');
  assert.equal(chooseTreeGroup({ tags: { leaf_type: 'needleleaved' }, lat: 42.36, lon: -71.06, seed: 'x' }), 'conifer');
  assert.equal(chooseTreeGroup({ tags: { leaf_type: 'broadleaved' }, lat: 42.36, lon: -71.06, seed: 'x' }), 'deciduous');
});

test('a mapped height picks the nearest model and scales to it', () => {
  const t = chooseTreeItem('palm', { tags: { height: '20' }, lat: 33.5, lon: -112, seed: 'h' });
  assert.equal(t.type, 'fanpalm_slim');
  assert.ok(Math.abs(t.scale - 20 / 20.8) < 1e-9);
  assert.equal(chooseTreeItem('palm', { tags: { height: '60' }, lat: 33.5, lon: -112, seed: 'h' }).scale, 1.4, 'clamped');
  assert.equal(chooseTreeItem('palm', { tags: { height: '30 ft' }, lat: 33.5, lon: -112, seed: 'h' }).type, 'palm_small');
});

test('deterministic, and every grouped model has a template', () => {
  const a = chooseTreeItem('oak_west', { lat: 34, lon: -118, seed: 'same' });
  const b = chooseTreeItem('oak_west', { lat: 34, lon: -118, seed: 'same' });
  assert.deepEqual(a, b);
  for (const members of Object.values(TREE_GROUPS)) {
    for (const [name, h] of members) {
      assert.ok(TREE_ITEMS[name]?.shapeFile?.endsWith('.dae'), name);
      assert.ok(h > 0);
    }
  }
});
