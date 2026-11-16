import test from 'node:test';
import assert from 'node:assert/strict';
import { modelsByItem } from '../composables/useAssetThumbs.js';

test('the models of an item: one entry per model, the placed ones first, none without a photo', () => {
  const data = {
    tags: [
      { tag: 'amenity=bench', item: 'benches', assets: [{ shape: '/a.dae', used: false }, { shape: '/b.dae', used: true, is: 'A bench' }] },
      { tag: 'leisure=picnic_table', item: 'benches', assets: [{ shape: '/a.dae', used: true }, { shape: '/c.dae', used: true }] },
      { tag: 'x=y', item: '', assets: [{ shape: '/a.dae', used: true }] },
    ],
    models: { '/a.dae': { name: 'a', thumb: '1.jpg' }, '/b.dae': { name: 'b', thumb: '2.jpg' }, '/c.dae': { name: 'c', thumb: null } },
  };
  const out = modelsByItem(data);
  assert.deepEqual(Object.keys(out), ['benches']);
  assert.deepEqual(out.benches.map((m) => [m.name, m.used]), [['a', true], ['b', true]]);
  assert.equal(out.benches[1].is, 'A bench');
});
