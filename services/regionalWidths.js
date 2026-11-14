// Road widths by where the map is. MapNG's usual lane widths and its paved edge strip were measured on
// BeamNG's own levels, which are North American roads: 3.5 m lanes on a main road and a metre of asphalt
// outside each edge line. Elsewhere roads with no width in OpenStreetMap came out too wide: a British A road
// about 6.5 m across was built 9 m (a BeamNG developer's Pennine map, looked at in game 2026-11-14).
//
// Outside the Americas each road with no width of its own is given narrower figures, written into its tags
// so that everything that reads a road's width (Generate's smoothing, the textures, the export and its
// worker threads) reads the same ones (services/roadWidth.js: LANE_WIDTH_TAG, EDGE_STRIP_TAG).
import { resolveRoadRulesAt } from './countryRules.js';
import { LANE_WIDTH_TAG, EDGE_STRIP_TAG } from './roadWidth.js';

const LANE_M = {
  primary: 3.0, primary_link: 3.0, secondary: 3.0, secondary_link: 3.0,
  tertiary: 2.75, tertiary_link: 2.75, unclassified: 2.75, residential: 2.75, living_street: 2.75,
};
const EDGE_STRIP_ELSEWHERE_M = 0.25;

/** Americas (or a place whose country is not known): MapNG's usual widths. */
export const usualWidthsApply = (roadRules) => !roadRules?.countryCode || roadRules.region === 'Americas';

/** The road features with the narrower figures in their tags (in place; a road tagged before is left). Returns how many. */
export function applyRegionalWidths(features, roadRules) {
  if (!Array.isArray(features) || usualWidthsApply(roadRules)) return 0;
  let n = 0;
  for (const f of features) {
    if (f?.type !== 'road' || !f.tags || f.tags[EDGE_STRIP_TAG] !== undefined) continue;
    const lane = LANE_M[f.tags.highway];
    f.tags = { ...f.tags, ...(lane ? { [LANE_WIDTH_TAG]: String(lane) } : {}), [EDGE_STRIP_TAG]: String(EDGE_STRIP_ELSEWHERE_M) };
    n++;
  }
  return n;
}

/** The same at Generate, the country looked up from the map's middle. Never fails a Generate. */
export async function withRegionalWidths(features, bounds) {
  try {
    if (!Array.isArray(features) || !features.length || !bounds) return features;
    const rules = await resolveRoadRulesAt((bounds.north + bounds.south) / 2, (bounds.east + bounds.west) / 2);
    applyRegionalWidths(features, rules);
  } catch (e) { console.warn('[Road widths] the regional widths were not applied:', e?.message || e); }
  return features;
}
