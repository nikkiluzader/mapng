// Street lamps along lit roads (plan B3, BeamNG.Earth: OSM maps few
// street_lamp nodes, so lit streets get poles at a steady spacing).
//
// Works on the drawn carriageways from generateDecalRoads (world space,
// nodes [x, y, z, width], `half` = half the paved width), so poles stand
// just beyond the asphalt that is actually there.

import { buildCarriagewayIndex, isOnCrossingCarriageway, isOnOtherCarriageway } from './roadMarkingCuts.js';

const LIT_VALUES = new Set(['yes', '24/7', 'automatic', 'sunset-sunrise', 'limited', 'interval']);
// Main roads in built-up areas are lit even when nobody tagged it.
const LIT_BY_DEFAULT_URBAN = new Set(['trunk', 'primary', 'secondary', 'tertiary']);
const SPACING_M = { trunk: 30, primary: 30, secondary: 35, tertiary: 35 };
const DEFAULT_SPACING_M = 40;
const KERB_SETBACK_M = 1.0;
// Wide roads (4+ lanes) are lit from both sides, staggered.
const BOTH_SIDES_MIN_HALF_M = 6;
// Keep junction mouths and crosswalk corners clear.
const JUNCTION_CLEAR_M = 10;
const ROAD_CLEAR_M = 0.5;
// Don't double up next to a mapped lamp.
const NEAR_MAPPED_FACTOR = 0.6;

const norm = (value) => String(value ?? '').trim().toLowerCase();

export function isLitRoad({ tags = {}, highway, urban }) {
  const lit = norm(tags.lit);
  if (lit === 'no' || lit === 'disused') return false;
  if (LIT_VALUES.has(lit)) return true;
  return !!urban && LIT_BY_DEFAULT_URBAN.has(String(highway ?? '').replace(/_link$/, ''));
}

// Deterministic 0..1 from a way id, so re-exports place poles identically.
function seededFraction(key) {
  let h = 2166136261;
  for (const ch of String(key)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

/**
 * Lamp spots: [{ x, y, facing }] with `facing` the yaw from the pole toward
 * the road (the lamp arm reaches over the carriageway).
 */
export function generateRoadLamps(carriageways, mappedLamps = [], budget = Infinity) {
  if (!carriageways.length || budget <= 0) return [];
  const index = buildCarriagewayIndex(carriageways);
  const lamps = [];
  const taken = mappedLamps.map(([x, y]) => ({ x, y, spacing: DEFAULT_SPACING_M }));
  const tooClose = (x, y, spacing) => taken.some((t) => Math.hypot(t.x - x, t.y - y) < Math.min(spacing, t.spacing) * NEAR_MAPPED_FACTOR);

  for (const cw of carriageways) {
    if (!isLitRoad(cw)) continue;
    const spacing = SPACING_M[String(cw.highway ?? '').replace(/_link$/, '')] ?? DEFAULT_SPACING_M;
    const sides = cw.half >= BOTH_SIDES_MIN_HALF_M ? [-1, 1] : [-1];
    const start = seededFraction(cw.wayId ?? cw.owner) * spacing;
    sides.forEach((side, sideIndex) => {
      // Staggered: the second side starts half a spacing later.
      let next = start + (sideIndex * spacing) / 2;
      let travelled = 0;
      for (let i = 0; i + 1 < cw.nodes.length && lamps.length < budget; i++) {
        const a = cw.nodes[i];
        const b = cw.nodes[i + 1];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 1e-6) continue;
        const dir = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        // side −1 = right of node order, +1 = left.
        const normal = [-dir[1] * side, dir[0] * side];
        while (next <= travelled + len && lamps.length < budget) {
          const t = next - travelled;
          next += spacing;
          const cx = a[0] + dir[0] * t;
          const cy = a[1] + dir[1] * t;
          if (isOnCrossingCarriageway(index, cx, cy, JUNCTION_CLEAR_M, dir)) continue;
          const x = cx + normal[0] * (cw.half + KERB_SETBACK_M);
          const y = cy + normal[1] * (cw.half + KERB_SETBACK_M);
          if (isOnOtherCarriageway(index, x, y, ROAD_CLEAR_M, () => false)) continue;
          if (tooClose(x, y, spacing)) continue;
          taken.push({ x, y, spacing });
          lamps.push({ x, y, facing: Math.atan2(-normal[1], -normal[0]), highway: cw.highway });
        }
        travelled += len;
      }
    });
  }
  return lamps;
}
