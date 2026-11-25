import test from 'node:test';
import assert from 'node:assert/strict';
import { isOfficialTestLevel } from '../services/officialTestLevels.js';

test('the official test levels are told apart from the user\'s own levels', () => {
  for (const n of ['mapng_coverage_na_east', 'mapng_test_roads_na_east', 'mapng_test_structures_na_east', 'mapng_test_terrain_eu']) assert.ok(isOfficialTestLevel(n), n);
  for (const n of ['mapng_flagstaff', 'mapng_test_mytown', 'mapng_coverage', 'my_level', '', undefined, 'mapng_test_roads_na_east/../x']) assert.ok(!isOfficialTestLevel(n), String(n));
});
