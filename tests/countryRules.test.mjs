import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { findCountry, getCountryRoadRules, __test } from '../services/countryRules.js';

const countries = __test.decodeCountries(JSON.parse(fs.readFileSync(new URL('../public/country_rules.json', import.meta.url), 'utf8')));
const at = (lat, lng) => getCountryRoadRules(findCountry(countries, lat, lng));

test('driving side follows the location, including at left/right borders', () => {
  assert.equal(at(51.507, -0.128).leftHandTraffic, true);     // London
  assert.equal(at(54.597, -5.93).countryCode, 'GB');          // Belfast
  assert.equal(at(53.35, -6.26).countryCode, 'IE');           // Dublin
  assert.equal(at(22.282, 114.158).countryCode, 'HK');        // Hong Kong
  assert.equal(at(22.543, 114.06).countryCode, 'CN');         // Shenzhen, across the border
  assert.equal(at(22.543, 114.06).leftHandTraffic, false);
  assert.equal(at(6.80, -58.16).leftHandTraffic, true);       // Georgetown, Guyana
  assert.equal(at(35.2, -111.65).leftHandTraffic, false);     // Flagstaff
});

test('signal cycle and turn on red follow the region', () => {
  assert.equal(at(40.628, 14.485).euroSignals, true);         // Positano
  assert.equal(at(40.628, 14.485).beamngCountry, 'levels.common.country.italy');
  assert.equal(at(35.2, -111.65).euroSignals, false);
  assert.equal(at(35.2, -111.65).turnOnRed, true);
  assert.equal(at(35.68, 139.69).turnOnRed, false);           // Tokyo
});

test('offshore points snap to a nearby coast; open ocean is unknown', () => {
  assert.equal(at(3.99, -81.6)?.countryCode, 'CO');           // Malpelo
  assert.equal(at(30, -40), null);                            // mid-Atlantic
});
