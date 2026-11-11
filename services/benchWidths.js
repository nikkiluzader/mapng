// Road widths from the bench the survey holds.
//
// A mountain road is a bench cut into its hillside, and 1 m lidar shows it:
// a flat strip the road's real width, the slope rising on one side and
// falling on the other. OSM rarely tags the width, so every road of a class
// got the same default: a 4 m village lane climbing in hairpins came out 8 m
// wide (two 3 m lanes and shoulders), cut 2 m into the hill above and filled
// 2 m over the slope below, all along; where two arms of a hairpin lie close,
// the upper arm's fill met the lower arm's cut in a wall of ground between
// them (Tignes: Montée de la Trinité, a tester's "undrivable hairpins").
//
// Every STEP_M along a road with no width or lane count in the map, on a
// hillside (the same test as roadSnap.js: a bench exists only there), the
// widest level strip near the line is found: the ground within LEVEL_M (plus
// CROSSFALL per metre out) of the strip's middle, the same distance each
// side. The road's width is the lower-middle of those (PERCENTILE: a lay-by
// or a junction's apron widens some sections, nothing narrows one), written
// as mapng:carriageway_width (roadWidth.js fits it onto the default lanes:
// the shoulders give way first, then the lanes) when the sections agree and
// it is clearly narrower than the default. Never wider: flat ground beside a
// road is not road. No sidewalk is drawn along a lane the bench leaves no
// room for.
//
// Only for rasters fine enough to show a bench (as roadSnap.js). Pure:
// features in, features out.
import { createGridProjector } from './geoUtils.js';
import { estimateRoadCrossSection, isOneWayRoad } from './roadWidth.js';

const NO_DATA_VALUE = -99999;
const MAX_GRID_MPP = 2;
const STEP_M = 6;
const END_SKIP_M = 8;            // clear of a road's ends (junctions: wider aprons)
const SEARCH_M = 8;              // the bench's middle looked for this far off the line
const SEARCH_STEP_M = 0.5;
const REACH_M = 12;              // a strip followed at most this far each side
const LEVEL_M = 0.25;            // ground within this of the strip's middle is on it ...
const CROSSFALL = 0.03;          // ... plus this per metre out (a road's crossfall, a banked bend)
const HILLSIDE_REACH_M = 16;
const HILLSIDE_MIN_SLOPE = 0.08;
const MIN_SAMPLES = 5;
const HILLSIDE_SHARE = 0.6;      // of a road's sections on a hillside: a hillside road
const PERCENTILE = 0.35;
const AGREE_M = 2.5;             // the sections' widths agree: their quartiles within this
const NARROWER_M = 1;            // only a bench this much narrower than the default counts
export const BENCH_MIN_M = 3;    // no road narrower than this
const SIDEWALK_ROOM_M = 1.5;     // room past the carriageway a sidewalk needs, each side
const MEASURED = new Set(['residential', 'living_street', 'unclassified', 'tertiary', 'secondary', 'primary', 'service', 'track']);

const hasOwnWidth = (t) => !!(t.width || t['width:carriageway'] || t.lanes || t['lanes:forward'] || t['lanes:backward'] || t['mapng:carriageway_width']);
const isStructure = (t) => (t.bridge && t.bridge !== 'no') || (t.tunnel && t.tunnel !== 'no') || t.covered === 'yes' || t.junction === 'roundabout';

/**
 * features with mapng:carriageway_width on the hillside roads whose bench is
 * narrower than their default. heightMap: the fetched elevation (row-major,
 * width x height), bounds its lat/lng box, metersPerPixel its grid.
 * Returns { features, stats: { roads, measured, medianM } }.
 */
export function measureBenchWidths(heightMap, width, height, bounds, osmFeatures, metersPerPixel) {
  const stats = { roads: 0, measured: 0, medianM: 0 };
  if (!osmFeatures?.length || !(metersPerPixel > 0) || metersPerPixel > MAX_GRID_MPP || !heightMap) return { features: osmFeatures, stats };
  const project = createGridProjector(bounds, width, height);
  const px = 1 / metersPerPixel;
  const at = (x, y) => {
    if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return NaN;
    const x0 = Math.min(width - 2, Math.floor(x)); const y0 = Math.min(height - 2, Math.floor(y));
    const fx = x - x0; const fy = y - y0; const i = y0 * width + x0;
    const a = heightMap[i]; const b = heightMap[i + 1]; const c = heightMap[i + width]; const d = heightMap[i + width + 1];
    if (a <= NO_DATA_VALUE || b <= NO_DATA_VALUE || c <= NO_DATA_VALUE || d <= NO_DATA_VALUE) return NaN;
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
  // every eligible way's sections; then one width per road (the ways of one
  // name and class joined end to end: OSM cuts a road at every junction and
  // tag change, and the road smoothing takes the widest of the pieces it
  // merges, so a width on some pieces only was no width)
  const keyOf = (g) => `${g.lat.toFixed(7)},${g.lng.toFixed(7)}`;
  const ways = [];
  osmFeatures.forEach((f, index) => {
    const t = f?.tags || {};
    if (f?.type !== 'road' || !MEASURED.has(t.highway) || !Array.isArray(f.geometry) || f.geometry.length < 2) return;
    if (hasOwnWidth(t) || isStructure(t) || t.area === 'yes') return;
    stats.roads++;
    const pts = f.geometry.map((g) => project(g.lat, g.lng));
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) * metersPerPixel;
    const found = [];
    let sections = 0; let hill = 0;
    let run = 0; let next = Math.min(END_SKIP_M, total / 2);
    const last = Math.max(next, total - END_SKIP_M);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]; const b = pts[i];
      const L = Math.hypot(b.x - a.x, b.y - a.y) * metersPerPixel;
      if (!(L > 1e-6)) continue;
      const tx = (b.x - a.x) / (L * px); const ty = (b.y - a.y) / (L * px);   // unit, in pixels per pixel
      const nx = -ty; const ny = tx;
      for (; next <= run + L && next <= last; next += STEP_M) {
        const s = (next - run) * px;
        const cx = a.x + tx * s; const cy = a.y + ty * s;
        sections++;
        // a hillside: the ground falls across the road, measured wide
        const zl = at(cx + nx * HILLSIDE_REACH_M * px, cy + ny * HILLSIDE_REACH_M * px);
        const zr = at(cx - nx * HILLSIDE_REACH_M * px, cy - ny * HILLSIDE_REACH_M * px);
        if (!Number.isFinite(zl) || !Number.isFinite(zr)) continue;
        if (Math.abs(zl - zr) / (2 * HILLSIDE_REACH_M) < HILLSIDE_MIN_SLOPE) continue;
        hill++;
        let best = 0;
        for (let o = -SEARCH_M; o <= SEARCH_M + 1e-9; o += SEARCH_STEP_M) {
          const z0 = at(cx + nx * o * px, cy + ny * o * px);
          if (!Number.isFinite(z0)) continue;
          let half = 0;
          for (let u = SEARCH_STEP_M; u <= REACH_M; u += SEARCH_STEP_M) {
            const tol = LEVEL_M + CROSSFALL * u;
            const zp = at(cx + nx * (o + u) * px, cy + ny * (o + u) * px);
            const zm = at(cx + nx * (o - u) * px, cy + ny * (o - u) * px);
            if (!(Math.abs(zp - z0) < tol) || !(Math.abs(zm - z0) < tol)) break;
            half = u;
          }
          if (2 * half > best + 1e-9) best = 2 * half;
        }
        if (best > 0) found.push(best);
      }
      run += L;
    }
    ways.push({ index, f, t, found, sections, hill, a: keyOf(f.geometry[0]), b: keyOf(f.geometry[f.geometry.length - 1]), road: `${t.highway}|${t.name || t.ref || ''}` });
  });
  const parent = ways.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const ends = new Map();
  ways.forEach((w, i) => { for (const k of [w.a, w.b]) { const key = `${w.road}@${k}`; if (ends.has(key)) parent[find(i)] = find(ends.get(key)); else ends.set(key, i); } });
  const chains = new Map();
  ways.forEach((w, i) => { const r = find(i); if (!chains.has(r)) chains.set(r, []); chains.get(r).push(w); });
  const widths = [];
  const out = osmFeatures.slice();
  for (const chain of chains.values()) {
    const found = chain.flatMap((w) => w.found).sort((p, q) => p - q);
    const sections = chain.reduce((n, w) => n + w.sections, 0); const hill = chain.reduce((n, w) => n + w.hill, 0);
    if (found.length < MIN_SAMPLES || hill < sections * HILLSIDE_SHARE) continue;
    const q = (share) => found[Math.min(found.length - 1, Math.floor(found.length * share))];
    if (q(0.5) - q(0.15) > AGREE_M) continue;
    const bench = Math.max(BENCH_MIN_M, q(PERCENTILE));
    for (const w of chain) {
      const standard = 2 * (estimateRoadCrossSection(w.t, w.t.highway, isOneWayRoad(w.t))?.carriagewayHalfWidth || 0);
      if (!(standard > 0) || bench > standard - NARROWER_M) continue;
      stats.measured++;
      widths.push(bench);
      const tags = { ...w.t, 'mapng:carriageway_width': bench.toFixed(1), 'mapng:width_source': 'bench' };
      // (no room for a sidewalk the map does not name: the bench is the road)
      if (!w.t.sidewalk && !w.t['sidewalk:left'] && !w.t['sidewalk:right'] && !w.t['sidewalk:both'] && q(0.5) < bench + 2 * SIDEWALK_ROOM_M) tags.sidewalk = 'no';
      out[w.index] = { ...w.f, tags };
    }
  }
  const features = out;
  if (widths.length) { widths.sort((p, q) => p - q); stats.medianM = widths[widths.length >> 1]; }
  return { features, stats };
}
