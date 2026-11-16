import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingsUnderDecks } from '../services/buildingsUnderDecks.js';

// world metres = (lng, lat)
const toXY = (p) => [p.lng, p.lat];
const box = (id, x0, y0, x1, y1, tags = {}) => ({ id, type: 'building', tags: { building: 'yes', ...tags }, geometry: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => ({ lat: y, lng: x })) });
// a viaduct along y = 0, its underside 7 m up
const deck = { xy: [[-100, 0], [0, 0], [100, 0]], z: [7, 7, 7] };
const run = (b, decks = [deck], groundAt = () => 0) => buildingsUnderDecks(b, decks, { toXY, groundAt });

test('a building a deck runs over is held under it, its roof flat', () => {
  const b = box('arch', -10, -6, 10, 6, { 'building:levels': '5', 'roof:shape': 'gabled' });
  const { replace, capped, left } = run([b]);
  assert.equal(capped, 1); assert.equal(left, 0);
  const r = replace.get(b);
  assert.equal(r.tags.height, '6.7'); assert.equal(r.tags['roof:shape'], 'flat'); assert.equal(r.tags['building:levels'], undefined);
  assert.equal(b.tags['building:levels'], '5', 'the mapped feature is not changed');
});

test('one already lower than the deck, one beside it and one the deck only clips stay as mapped', () => {
  const low = box('shed', -10, -6, 10, 6, { height: '4' });
  const beside = box('beside', -10, 10, 10, 30, { 'building:levels': '8' });
  const clipped = box('corner', 40, -20, 42, 20, { 'building:levels': '8' });   // 2 m of the line inside
  const { replace } = run([low, beside, clipped]);
  assert.equal(replace.size, 0);
});

test('no room for a storey under the deck: left out', () => {
  const b = box('pier', -10, -6, 10, 6);
  const { replace, left } = run([b], [{ xy: deck.xy, z: [2, 2, 2] }]);
  assert.equal(left, 1); assert.equal(replace.get(b).type, 'under_deck');
});

test('the lowest deck over it counts, from the ground the building stands on', () => {
  const b = box('b', -10, -6, 10, 6, { 'building:levels': '6' });
  const { replace } = run([b], [deck, { xy: [[0, -50], [0, 50]], z: [15, 15] }], () => 1);
  assert.equal(replace.get(b).tags.height, '5.7');
});

test('a hall mapped over the tracks (min_height over the deck) stays', () => {
  const b = box('hall', -10, -6, 10, 6, { min_height: '9', height: '16' });
  assert.equal(run([b]).replace.size, 0);
});
