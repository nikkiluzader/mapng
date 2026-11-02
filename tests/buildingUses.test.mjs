import test from 'node:test';
import assert from 'node:assert/strict';

import { buildingUse, businessTagsByBuilding, isHistoricBuilding } from '../services/buildingUses.js';
import { planBuilding } from '../services/beamngBuildings.js';

const ll = (x, y) => ({ lat: y * 1e-5, lng: x * 1e-5 });
const project = (lat, lng) => [lng * 1e5, lat * 1e5];
const sq = (x0, y0, s) => [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s], [x0, y0]].map(([x, y]) => ll(x, y));

test('a building takes the use of a restaurant or hotel point inside it', () => {
  const shop = { id: 'b1', type: 'building', tags: { building: 'yes' }, geometry: sq(0, 0, 20) };
  const other = { id: 'b2', type: 'building', tags: { building: 'yes' }, geometry: sq(40, 0, 20) };
  const pub = { id: 'n1', type: 'business', tags: { amenity: 'pub', name: 'The Lion' }, geometry: [ll(10, 10)] };
  const cafe = { id: 'n2', type: 'business', tags: { amenity: 'cafe' }, geometry: [ll(12, 12)] };
  const map = businessTagsByBuilding([shop, other, pub, cafe], project);
  assert.equal(buildingUse(map.get(shop)), 'pub', 'the pub outranks the café');
  assert.equal(map.get(shop).name, 'The Lion');
  assert.equal(map.has(other), false);
  assert.equal(buildingUse({ building: 'hotel' }), 'hotel');
  assert.equal(buildingUse({ building: 'yes', tourism: 'guest_house' }), 'guest');
  assert.ok(isHistoricBuilding({ historic: 'building' }));
  assert.ok(!isHistoricBuilding({ historic: 'memorial' }));
});

test('hotels, pubs and historic buildings get their own look, not the window sheet', () => {
  const at = { area: 900, seed: 's1', lat: 29.9, lon: -81.3, rectFill: 0.95 };   // Florida: a warm region
  const block = planBuilding({ building: 'yes' }, { ...at, area: 900 });
  const hotel = planBuilding({ building: 'hotel' }, at);
  assert.equal(hotel.use, 'hotel');
  assert.equal(hotel.band, null, 'masonry, not the window sheet');
  assert.ok(hotel.windows, 'windows laid over its walls');
  assert.equal(hotel.shopFloor, false, 'a lobby, not shopfronts');
  assert.ok(hotel.floors >= 3, `at least three floors when unmapped (got ${hotel.floors})`);
  assert.equal(hotel.wallFamily, 'stucco', 'stucco in Florida');
  assert.equal(hotel.roof, 'hipped', 'a clay-tile roof where the footprint takes one');
  const pub = planBuilding({ building: 'yes', amenity: 'pub' }, at);
  assert.equal(pub.shopFloor, true);
  assert.equal(pub.band, null);
  const old = planBuilding({ building: 'yes', historic: 'building' }, at);
  assert.ok(old.historic && old.band === null && old.windows);
  assert.ok(block.band !== null || block.kind === 'house', 'an ordinary block keeps its window sheet');
});
