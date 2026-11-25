// The official test levels (scripts/coverage, offered by /api/test-levels): built on made-up test scenes, not real
// places, so the levels list offers no "Show on map" for them. Named mapng_coverage_<region> and
// mapng_test_<theme>_<region> (the coverage level and the themed roads, structures and terrain levels).
const OFFICIAL = /^mapng_(coverage|test_(roads|structures|terrain))_[a-z][a-z0-9_]{0,40}$/;

/** True for one of the official test levels' level names. */
export function isOfficialTestLevel(levelName) {
  return OFFICIAL.test(String(levelName || ''));
}
