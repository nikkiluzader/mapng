import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchTreeSpeciesMix, kindFromMix, speciesKind, treeMixFromCounts } from '../services/treeSpecies.js';
import { chooseTreeGroup, chooseTreeItem, treeHintFromTags } from '../services/beamngTrees.js';

test('scientific names sort into the kinds of tree the library shows', () => {
  assert.equal(speciesKind('Sabal palmetto'), 'palm');
  assert.equal(speciesKind('Quercus virginiana'), 'live_oak', 'an evergreen oak: broad and spreading');
  assert.equal(speciesKind('Quercus rubra'), 'oak');
  assert.equal(speciesKind('Juniperus virginiana'), 'juniper');
  assert.equal(speciesKind('Magnolia grandiflora'), 'broadleaf');
  assert.equal(speciesKind('Pinus elliottii'), 'conifer');
  assert.equal(speciesKind('Eucalyptus globulus'), 'eucalyptus');
  assert.equal(speciesKind('Avicennia germinans'), 'mangrove');
  assert.equal(treeMixFromCounts([{ name: 'Avicennia germinans', count: 50 }, { name: 'Sabal palmetto', count: 20 }]).shares.palm, 1, 'mangroves left out of a town\'s mix');
  assert.equal(speciesKind('Bidens alba'), null, 'not a tree');
  assert.equal(speciesKind('Acer'), 'broadleaf', 'a genus alone');
});

test('the local mix: tree records only, in shares, nothing from a handful', () => {
  // as iNaturalist's species counts round downtown St. Augustine
  const mix = treeMixFromCounts([
    { name: 'Tillandsia usneoides', count: 75 }, { name: 'Sabal palmetto', count: 39 }, { name: 'Quercus virginiana', count: 15 },
    { name: 'Juniperus virginiana', count: 13 }, { name: 'Magnolia grandiflora', count: 12 }, { name: 'Bidens alba', count: 61 },
    { name: 'Persea borbonia', count: 1 },
  ]);
  assert.equal(mix.records, 80, 'the moss and the beggarticks left out');
  assert.ok(Math.abs(Object.values(mix.shares).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(mix.shares.palm > 0.45 && mix.shares.palm < 0.5);
  assert.ok(!('broadleaf' in mix.shares) || mix.shares.broadleaf > 0.1, 'magnolia counted, the one stray bay merged in or dropped');
  assert.equal(treeMixFromCounts([{ name: 'Sabal palmetto', count: 5 }]), null, 'too few records');
  assert.equal(kindFromMix({ shares: { palm: 0.5, oak: 0.5 } }, 0.2), 'palm');
  assert.equal(kindFromMix({ shares: { palm: 0.5, oak: 0.5 } }, 0.7), 'oak');
});

test('the mix is asked for the export box (grown to ~3 km), and nothing breaks offline', async () => {
  let asked = null;
  const fetchImpl = async (url) => {
    asked = new URL(url);
    return { ok: true, json: async () => ({ results: [{ taxon: { name: 'Sabal palmetto' }, count: 30 }, { taxon: { name: 'Quercus virginiana' }, count: 20 }] }) };
  };
  const mix = await fetchTreeSpeciesMix({ north: 29.9, south: 29.899, east: -81.31, west: -81.311 }, { fetchImpl });
  assert.deepEqual(Object.keys(mix.shares).sort(), ['live_oak', 'palm']);
  assert.equal(asked.hostname, 'api.inaturalist.org');
  assert.ok(Number(asked.searchParams.get('nelat')) - Number(asked.searchParams.get('swlat')) >= 0.029, 'a tiny export looks over ~3 km');
  assert.equal(asked.searchParams.get('quality_grade'), 'research');
  assert.equal(await fetchTreeSpeciesMix({ north: 1, south: 0, east: 1, west: 0 }, { fetchImpl: async () => { throw new Error('offline'); } }), null);
  assert.equal(await fetchTreeSpeciesMix({ north: 1, south: 0, east: 1, west: 0 }, { fetchImpl: async () => ({ ok: false }) }), null);
});

test('untagged trees follow the local mix; a tagged one keeps its own kind', () => {
  const mix = { shares: { palm: 0.5, live_oak: 0.3, juniper: 0.2 } };
  const count = {};
  for (let i = 0; i < 600; i++) {
    const g = chooseTreeGroup({ tags: {}, lat: 29.89, lon: -81.31, urban: true, seed: `t${i}`, mix });
    count[g] = (count[g] || 0) + 1;
  }
  assert.deepEqual(Object.keys(count).sort(), ['juniper', 'live_oak', 'palm'], 'no aspens, beeches or Douglas firs');
  assert.ok(count.palm > 240 && count.palm < 360, `about half palms (${count.palm})`);
  assert.equal(chooseTreeGroup({ tags: { species: 'Pinus elliottii' }, lat: 29.89, lon: -81.31, seed: 'x', mix }), 'conifer');
  assert.equal(treeHintFromTags({ genus: 'Quercus', species: 'Quercus virginiana' }), 'live_oak');
  // each group has its models
  for (const g of ['live_oak', 'oak', 'eucalyptus', 'cypress', 'olive', 'juniper', 'tropical']) {
    const item = chooseTreeItem(g, { lat: 29.89, lon: -81.31, seed: 's' });
    assert.ok(item?.type, `${g} has a model`);
  }
  assert.match(chooseTreeItem('live_oak', { lat: 29.89, lon: -81.31, seed: 's' }).type, /oak_[a-d]$/);
  // no mix: the climate rule as before
  assert.ok(['palm', 'deciduous', 'conifer'].includes(chooseTreeGroup({ tags: {}, lat: 29.89, lon: -81.31, urban: true, seed: 'z' })));
});
