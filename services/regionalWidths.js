// Road widths by where the map is. MapNG's usual lane widths and its paved edge strip were measured on
// BeamNG's own levels, which are North American roads: 3.5 m lanes on a main road and a metre of asphalt
// outside each edge line. Elsewhere roads with no width in OpenStreetMap came out too wide: a British A road
// about 6.5 m across was built 9 m (a BeamNG developer's Pennine map, looked at in game 2026-11-14).
//
// Each road with no width of its own is given its country's figures (services/roadWidthStandards.js: the
// library, and what stands in for a country it does not have), written into its tags so that everything that
// reads a road's width (Generate's smoothing, the textures, the export and its worker threads) reads the same
// ones (services/roadWidth.js: LANE_WIDTH_TAG, EDGE_STRIP_TAG).
import { resolveRoadRulesAt } from './countryRules.js';
import { LANE_WIDTH_TAG, EDGE_STRIP_TAG, SINGLE_LANE_TAG } from './roadWidth.js';
import { widthStandardFor, widthsForClass } from './roadWidthStandards.js';

/** A place with no figures of its own (the Americas outside the library, or a country not known): MapNG's usual widths. */
export const usualWidthsApply = (roadRules) => !widthStandardFor(roadRules);

/** The road features with their place's figures in their tags (in place; a road tagged before is left). Returns how many. */
export function applyRegionalWidths(features, roadRules) {
  const standard = widthStandardFor(roadRules);
  if (!Array.isArray(features) || !standard) return 0;
  let n = 0;
  for (const f of features) {
    if (f?.type !== 'road' || !f.tags || f.tags[EDGE_STRIP_TAG] !== undefined) continue;
    const { lane, edge, singleLane } = widthsForClass(standard, f.tags.highway);
    if (lane === undefined && edge === undefined) continue;
    f.tags = { ...f.tags, ...(lane ? { [LANE_WIDTH_TAG]: String(lane) } : {}), [EDGE_STRIP_TAG]: String(edge ?? 0), ...(singleLane ? { [SINGLE_LANE_TAG]: String(singleLane) } : {}) };
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
