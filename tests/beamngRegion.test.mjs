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

test('regional look from WorldCover: desert, high rock, open grassland; the West Coast and woods keep theirs', async () => {
  const { resolveRegionalBiome, landCoverShares } = await import('../services/beamngRegion.js');
  // a land cover grid with these class shares
  const lc = (mix) => {
    const n = 100; const grid = new Uint8Array(n * n); let i = 0;
    for (const [cls, share] of Object.entries(mix)) for (let k = 0; k < share * n * n; k++) grid[i++] = Number(cls);
    return { grid, n };
  };
  assert.equal(landCoverShares(lc({ 80: 0.9, 30: 0.1 })), null, 'mostly water: says nothing');
  // Sahara-like, low and warm
  assert.equal(resolveRegionalBiome({ lat: 25, lon: 10, meanHeightM: 300, landCover: lc({ 60: 0.85, 20: 0.15 }) }).biomeId, 'johnson_valley');
  // a glacier summit in the Alps (inside the Mediterranean box)
  assert.equal(resolveRegionalBiome({ lat: 45.43, lon: 6.9, meanHeightM: 3000, landCover: lc({ 60: 0.75, 70: 0.15, 100: 0.1 }) }).biomeId, 'utah');
  // Montana prairie
  const prairie = resolveRegionalBiome({ lat: 47.43, lon: -111.02, meanHeightM: 1100, landCover: lc({ 30: 0.76, 40: 0.23, 10: 0.01 }) });
  assert.equal(prairie.biomeId, 'utah');
  assert.match(prairie.reason, /grassland/);
  // Iowa corn: fields, not steppe
  assert.equal(resolveRegionalBiome({ lat: 42, lon: -93.5, meanHeightM: 300, landCover: lc({ 40: 0.8, 30: 0.15, 10: 0.05 }) }).biomeId, 'east_coast_usa');
  // a wooded East Coast map
  assert.equal(resolveRegionalBiome({ lat: 40, lon: -75, meanHeightM: 100, landCover: lc({ 10: 0.6, 30: 0.2, 50: 0.2 }) }).biomeId, 'east_coast_usa');
  // Los Angeles stays West Coast even if WorldCover says scrub
  assert.equal(resolveRegionalBiome({ lat: 34.05, lon: -118.25, meanHeightM: 100, landCover: lc({ 20: 0.5, 50: 0.4, 60: 0.1 }) }).biomeId, 'west_coast_usa');
  // without land cover: as before
  assert.equal(resolveRegionalBiome({ lat: 47.43, lon: -111.02, meanHeightM: 1100 }).biomeId, 'east_coast_usa');
});
