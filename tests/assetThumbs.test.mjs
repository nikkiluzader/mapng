import test from 'node:test';
import assert from 'node:assert/strict';
import { modelsByItem, modelsInUse, tagsPresent } from '../composables/useAssetThumbs.js';

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

test('a sign model is listed with the signs, not with its tag\'s road item', () => {
  const data = {
    tags: [
      { tag: 'highway=raceway', item: 'roadSurfaces', assets: [{ shape: '/sign.dae', used: true }, { shape: '/kerb.dae', used: true }] },
      { tag: 'advertising=billboard', item: 'billboards', assets: [{ shape: '/board.dae', used: true }] },
    ],
    models: { '/sign.dae': { name: 'sign', thumb: '1.jpg', sign: true }, '/kerb.dae': { name: 'kerb', thumb: '2.jpg' }, '/board.dae': { name: 'board', thumb: '3.jpg', sign: true } },
  };
  const out = modelsByItem(data);
  assert.deepEqual(out.roadSurfaces.map((m) => m.name), ['kerb']);
  assert.deepEqual(out.signs.map((m) => m.name), ['sign']);
  assert.deepEqual(out.billboards.map((m) => m.name), ['board']);
});

test('only the models this area\'s export can place are shown', () => {
  const data = {
    tags: [
      { tag: 'amenity=bench', item: 'benches', assets: [{ shape: '/bench.dae', used: true }, { shape: '/other-bench.dae', used: false }] },
      { tag: 'leisure=picnic_table', item: 'benches', assets: [{ shape: '/table.dae', used: true }] },
      { tag: 'traffic_sign=*', item: 'signs', assets: [{ shape: '/sign.dae', used: true }] },
    ],
    models: Object.fromEntries(['/bench.dae', '/other-bench.dae', '/table.dae', '/sign.dae'].map((s, i) => [s, { name: s, thumb: `${i}.jpg` }])),
  };
  const by = modelsByItem(data);
  const present = tagsPresent([{ tags: { amenity: 'bench' } }, { tags: { traffic_sign: 'US:R1-1' } }, { tags: { leisure: 'no' } }]);
  assert.deepEqual(modelsInUse(by.benches, present).map((m) => m.shape), ['/bench.dae']);   // no picnic table mapped here; the other bench is only a candidate
  assert.deepEqual(modelsInUse(by.signs, present).map((m) => m.shape), ['/sign.dae']);
  assert.deepEqual(modelsInUse(by.benches, tagsPresent([])), []);
});

test('a tag with models of the area\'s own region shows those; else the ones for everywhere', () => {
  const data = {
    tags: [
      { tag: 'highway=bus_stop', item: 'busStops', assets: [{ shape: '/any.dae', used: true, region: 'any' }, { shape: '/us.dae', used: true, region: 'north-america' }] },
      { tag: 'amenity=bench', item: 'busStops', assets: [{ shape: '/bench.dae', used: true, region: 'any' }, { shape: '/eu-bench.dae', used: true, region: 'europe' }] },
    ],
    models: Object.fromEntries(['/any.dae', '/us.dae', '/bench.dae', '/eu-bench.dae'].map((s, i) => [s, { name: s, thumb: `${i}.jpg` }])),
  };
  const list = modelsByItem(data).busStops; const present = () => true;
  assert.deepEqual(modelsInUse(list, present, 'north-america').map((m) => m.shape), ['/us.dae', '/bench.dae']);
  assert.deepEqual(modelsInUse(list, present, 'europe').map((m) => m.shape), ['/any.dae', '/eu-bench.dae']);
  assert.deepEqual(modelsInUse(list, present, 'any').map((m) => m.shape), ['/any.dae', '/bench.dae']);
});
