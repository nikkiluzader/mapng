// The official test levels (scripts/coverage, offered by /api/test-levels): built on made-up test scenes, not real
// places, so the levels list offers no "Show on map" for them. Named mapng_coverage_<region> and
// mapng_test_<theme>_<region> (the coverage level and the themed roads, structures, terrain and sidewalks levels).
const OFFICIAL = /^mapng_(coverage|test_(roads|structures|terrain|sidewalks))_[a-z][a-z0-9_]{0,40}$/;

/** True for one of the official test levels' level names. */
export function isOfficialTestLevel(levelName) {
  return OFFICIAL.test(String(levelName || ''));
}
