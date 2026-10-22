import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRoadNameZones, roadLabel } from '../services/roadNameZones.js';

test('a road is labelled by its name, else its refs', () => {
  assert.equal(roadLabel({ name: 'Butler Boulevard', ref: 'SR 202' }), 'Butler Boulevard');
  assert.equal(roadLabel({ ref: 'I 295;US 1' }), 'I 295 / US 1');
  assert.equal(roadLabel({ highway: 'motorway_link' }), null);
});

test('named roads become strips the minimap can name, the deck above the road below', () => {
  const line = (z, y = 0) => Array.from({ length: 101 }, (_, i) => [i * 4, y, z, 8]);   // 400 m
  const zones = buildRoadNameZones([
    { nodes: line(10), half: 6, tags: { name: 'Ground Road' } },
    { nodes: line(18), half: 5, tags: { name: 'Deck Road' }, bridge: true },
    { nodes: line(10, 50), half: 4, tags: { highway: 'service' } },        // unnamed: none
  ]);
  const ground = zones.filter((z) => z.name === 'Ground Road');
  const deck = zones.filter((z) => z.name === 'Deck Road');
  assert.equal(zones.length, ground.length + deck.length);
  assert.ok(ground.length >= 2, 'split into strips');
  assert.equal(new Set(zones.map((z) => z.oldId)).size, zones.length, 'every zone has its own oldId');
  const g = ground[0];
  const d = deck[0];
  // a camera riding over the ground road (z 10 + 3) is in its zone and under the deck's floor
  assert.ok(g.bot.pos[2] < 13 && 13 < g.top.pos[2]);
  assert.ok(13 < d.bot.pos[2], 'not in the deck road under it');
  // on the deck (18 + 3): the deck road, above the ground road's ceiling
  assert.ok(d.bot.pos[2] < 21 && 21 < d.top.pos[2] && 21 > g.top.pos[2]);
  assert.ok(d.customFields.values.priority > g.customFields.values.priority);
  // the strip covers the carriageway: 6 m half + margin each side
  const ys = g.vertices.map((v) => v[1]);
  assert.ok(Math.max(...ys) > 6 && Math.min(...ys) < -6);
});
