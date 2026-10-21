import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveRegionalBiome, dryCoverShare } from '../services/beamngRegion.js';

const at = (lat, lon, meanHeightM = null, features = [], mapAreaM2 = 0) => (
  resolveRegionalBiome({ lat, lon, meanHeightM, features, mapAreaM2 }).biomeId
);

test('North America follows the climate and the ground height', () => {
  assert.equal(at(33.45, -112.07, 340), 'johnson_valley', 'Phoenix');
  assert.equal(at(36.17, -115.14, 610), 'johnson_valley', 'Las Vegas');
  assert.equal(at(35.20, -111.65, 2100), 'utah', 'Flagstaff: high desert, not Johnson Valley');
  assert.equal(at(40.60, -111.71, 2400), 'utah', 'Cottonwood canyons (the report)');
  assert.equal(at(34.05, -118.24, 90), 'west_coast_usa', 'Los Angeles');
  assert.equal(at(37.77, -122.42, 30), 'west_coast_usa', 'San Francisco');
  assert.equal(at(40.71, -74.01, 10), 'east_coast_usa', 'New York');
  assert.equal(at(29.90, -81.31, 5), 'east_coast_usa', 'St. Augustine');
});

test('the rest of the world: Mediterranean, tropics, temperate', () => {
  assert.equal(at(40.63, 14.48, 100), 'italy', 'Positano');
  assert.equal(at(41.39, 2.17, 20), 'italy', 'Barcelona');
  assert.equal(at(-3.12, -60.02, 50), 'jungle_rock_island', 'Manaus');
  assert.equal(at(51.51, -0.13, 20), 'east_coast_usa', 'London');
  assert.equal(at(52.52, 13.40, 40), 'east_coast_usa', 'Berlin');
});

const square = (lat, lon, d, tags) => ({
  type: 'landuse',
  tags,
  geometry: [
    { lat, lng: lon }, { lat, lng: lon + d }, { lat: lat + d, lng: lon + d }, { lat: lat + d, lng: lon },
  ],
});

test('OSM land cover finds the deserts coordinates miss', () => {
  const lat = 24.45;
  const lon = 54.37; // Abu Dhabi: not Mediterranean, not North America
  const sand = [square(lat, lon, 0.01, { natural: 'sand' }), square(lat + 0.01, lon, 0.01, { natural: 'scrub' })];
  const area = 2000 * 2000;
  assert.equal(at(lat, lon, 10, sand, area), 'johnson_valley', 'mostly sand and scrub → desert');
  assert.equal(at(lat, lon, 10, [], area), 'east_coast_usa', 'nothing mapped → temperate default');

  const green = [square(lat, lon, 0.02, { landuse: 'forest' }), square(lat, lon, 0.005, { natural: 'scrub' })];
  assert.ok(dryCoverShare(green, lat, area) < 0.6, 'a forest map is not dry');
  assert.equal(dryCoverShare([square(lat, lon, 0.0001, { natural: 'sand' })], lat, 4e6), null, 'a speck of land cover says nothing');
});
