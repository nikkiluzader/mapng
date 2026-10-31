// Buildings standing on drawn roads (refs/output/earth-detail-plan.md, A0).
//
// BeamNG.Earth's most reported building fault (their issues #571, #543,
// #540, #523, #433): footprints on motorway and street carriageways, mostly
// machine-learned outlines (Microsoft / Google via Overture) traced off
// aerial photos where a bridge, a tree or a shadow looked like a roof. MapNG
// adds the same Overture outlines where OSM has none (overtureTiles.js marks
// them mapng:source=overture), so the export checks every footprint against
// the roads before anything is built on it:
//
//   - an ML / cadastre outline over a road's driving lanes (any real share
//     of its area, or the road's centre line running through it) is left out;
//   - an OSM building is a mapper's work and is never left out (a 1641
//     Amsterdam house a road line runs through is a road mapped through a
//     passage, not a building on a road): one reaching into the driving lanes
//     is cut back along the lanes' edge when that cut stays local (removes
//     little more than the overlap; the road's widths are estimates, often
//     wider than an old town's street, so never more than the lanes), else it
//     stays as mapped and is listed for checking.
//
// Roads that legitimately pass a building are never counted: tunnels,
// building passages, covered or underground ways, bridges over it, and the
// driveways and parking aisles that end inside garages. Raised buildings
// (layer >= 1, building=roof, canopies, bridges) stand over roads by design.
// Pure: features in, features out, plus the list of what was changed.

import { estimateRoadCrossSection, isOneWayRoad, NON_DRIVEABLE_HIGHWAYS } from './roadWidth.js';

// an ML outline with this share of its area on a road's driving lanes, or the
// road's centre line this far through it, is left out
const ML_SHARE = 0.05;
const ML_RUN_M = 2;
// an OSM building: cut back from this share on, when the cut removes at most
// the overlap plus CUT_SLACK of its area (a cut along a road segment's line
// reaches past the segment's ends: at a corner or a bend it would slice off
// walls nowhere near the road); listed for checking from LIST_SHARE
const OSM_CLIP_SHARE = 0.03;
const CUT_SLACK = 0.1;
const LIST_SHARE = 0.3;
const LANE_MARGIN_M = 0.3;       // the lanes' edge, out this far (a wall flush with the kerb stays)
const SAMPLE_TARGET = 4000;      // area samples per footprint (step at least SAMPLE_MIN_M)
const SAMPLE_MIN_M = 0.5;
const CELL_M = 24;               // road segment index cell
const MAX_CUTS = 3;

const SKIP_SERVICE = new Set(['driveway', 'parking_aisle', 'drive-through']);
const ROAD_SKIP = new Set([...NON_DRIVEABLE_HIGHWAYS, 'raceway', 'platform', 'bus_stop', 'elevator', 'services', 'rest_area']);

const isNo = (v) => v === undefined || v === null || v === '' || v === 'no';

/** Whether a road counts against the buildings it crosses. */
export function roadCountsAgainstBuildings(tags = {}) {
  const hw = tags.highway;
  if (!hw || ROAD_SKIP.has(hw) || tags.area === 'yes') return false;
  if (hw === 'service' && SKIP_SERVICE.has(tags.service)) return false;
  if (!isNo(tags.tunnel) || !isNo(tags.covered) || !isNo(tags.bridge)) return false;
  if (tags.location === 'underground' || tags.indoor === 'yes') return false;
  const layer = Number(tags.layer);
  if (Number.isFinite(layer) && layer !== 0) return false;
  return true;
}

/** Whether a building may stand over a road by design. */
export function buildingMayOverhang(tags = {}) {
  const layer = Number(tags.layer);
  if (Number.isFinite(layer) && layer >= 1) return true;
  if (['roof', 'canopy', 'carport', 'bridge'].includes(tags.building)) return true;
  if (tags.man_made === 'bridge' || tags['building:part'] || Number(tags.min_height) > 2 || Number(tags['building:min_level']) > 0) return true;
  return false;
}

const isMlOutline = (tags = {}) => tags['mapng:source'] === 'overture';

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a) / 2;
}
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inFootprint = (x, y, ring, holes) => inRing(x, y, ring) && !holes.some((h) => inRing(x, y, h));

// Sutherland-Hodgman: the part of `ring` on the side of the line through p
// with normal n where (q - p) . n >= 0
function clipHalfPlane(ring, p, n) {
  const side = (q) => (q[0] - p[0]) * n[0] + (q[1] - p[1]) * n[1];
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]; const b = ring[(i + 1) % ring.length];
    const sa = side(a); const sb = side(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/**
 * Check every building footprint against the roads' driving lanes.
 *   features: OSM features ({ type, tags, geometry: [{ lat, lng }], holes? })
 *   project(lat, lng) -> [x, y] in metres
 *   urbanAt(feature) -> bool (optional: the urban width rules)
 *   unproject(x, y) -> { lat, lng } (needed to write cut footprints back)
 * Returns { features, dropped: [{ id, source, share, run, reason }] (ML
 * outlines only), clipped: [{ id, share, kept }], flagged: [{ id, share,
 * run }] (OSM buildings kept as mapped though largely on a road) }.
 */
export function resolveBuildingRoadConflicts(features, { project, unproject, urbanAt = () => false } = {}) {
  const list = Array.isArray(features) ? features : [];
  // driving lanes: segments with their half width, in a grid
  const segs = [];
  const grid = new Map();
  const cellKey = (cx, cy) => `${cx},${cy}`;
  for (const f of list) {
    if (f?.type !== 'road' || !Array.isArray(f.geometry) || f.geometry.length < 2) continue;
    const tags = f.tags || {};
    if (!roadCountsAgainstBuildings(tags)) continue;
    const { drivingHalfWidth } = estimateRoadCrossSection(tags, tags.highway, isOneWayRoad(tags), { urban: urbanAt(f) });
    const half = drivingHalfWidth + LANE_MARGIN_M;
    const pts = f.geometry.map((p) => project(p.lat, p.lng));
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]; const b = pts[i + 1];
      const idx = segs.length;
      segs.push({ a, b, half, road: f });
      const x0 = Math.floor((Math.min(a[0], b[0]) - half) / CELL_M); const x1 = Math.floor((Math.max(a[0], b[0]) + half) / CELL_M);
      const y0 = Math.floor((Math.min(a[1], b[1]) - half) / CELL_M); const y1 = Math.floor((Math.max(a[1], b[1]) + half) / CELL_M);
      for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
        const k = cellKey(cx, cy);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(idx);
      }
    }
  }
  const nearSegs = (x0, y0, x1, y1) => {
    const out = new Set();
    for (let cx = Math.floor(x0 / CELL_M); cx <= Math.floor(x1 / CELL_M); cx++) {
      for (let cy = Math.floor(y0 / CELL_M); cy <= Math.floor(y1 / CELL_M); cy++) for (const i of grid.get(cellKey(cx, cy)) || []) out.add(i);
    }
    return [...out].map((i) => segs[i]);
  };
  // the segment whose lanes hold (x, y), or null
  const laneAt = (x, y, near) => {
    for (const s of near) {
      const vx = s.b[0] - s.a[0]; const vy = s.b[1] - s.a[1]; const L2 = vx * vx + vy * vy;
      const t = L2 > 1e-9 ? Math.max(0, Math.min(1, ((x - s.a[0]) * vx + (y - s.a[1]) * vy) / L2)) : 0;
      if (Math.hypot(s.a[0] + vx * t - x, s.a[1] + vy * t - y) <= s.half) return s;
    }
    return null;
  };

  const dropped = [];
  const clipped = [];
  const flagged = [];
  const out = [];
  for (const f of list) {
    if (f?.type !== 'building' || !Array.isArray(f.geometry) || f.geometry.length < 3 || buildingMayOverhang(f.tags || {}) || !segs.length) {
      out.push(f);
      continue;
    }
    const ring = f.geometry.map((p) => project(p.lat, p.lng));
    const holes = (f.holes || []).map((h) => h.map((p) => project(p.lat, p.lng)));
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const [x, y] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const near = nearSegs(x0, y0, x1, y1);
    if (!near.length) { out.push(f); continue; }
    const area = Math.max(1e-6, ringArea(ring) - holes.reduce((n, h) => n + ringArea(h), 0));
    // share of the footprint on driving lanes (sampled), and by which segments
    const step = Math.max(SAMPLE_MIN_M, Math.sqrt(area / SAMPLE_TARGET));
    let inside = 0; let onLanes = 0;
    const bySeg = new Map();
    for (let y = y0 + step / 2; y < y1; y += step) {
      for (let x = x0 + step / 2; x < x1; x += step) {
        if (!inFootprint(x, y, ring, holes)) continue;
        inside++;
        const s = laneAt(x, y, near);
        if (s) { onLanes++; bySeg.set(s, (bySeg.get(s) || 0) + 1); }
      }
    }
    if (!inside || !onLanes) { out.push(f); continue; }
    const share = onLanes / inside;
    // the longest run of one road's centre line through the footprint
    let run = 0;
    for (const s of near) {
      const L = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
      let r = 0;
      for (let d = 0; d <= L; d += 0.5) {
        const t = L > 0 ? d / L : 0;
        if (inFootprint(s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t, ring, holes)) r += 0.5;
      }
      run = Math.max(run, r);
    }
    const id = f.id ?? f.tags?.id ?? null;
    if (isMlOutline(f.tags)) {
      if (share >= ML_SHARE || run >= ML_RUN_M) { dropped.push({ id, source: 'overture', share, run, reason: 'an ML outline on a road' }); continue; }
      out.push(f);
      continue;
    }
    const keepAsMapped = () => { if (share >= LIST_SHARE) flagged.push({ id, share, run }); out.push(f); };
    // (largely on the road: a passage or a misplaced line, the mapper's to
    // fix; trimmed away it would be gone)
    if (share < OSM_CLIP_SHARE || share >= LIST_SHARE || !unproject || holes.length) { keepAsMapped(); continue; }
    // cut back along the edge of each road segment it reaches into, the most
    // overlapping first, keeping the side of the footprint's own centre
    let cut = ring.slice();
    const order = [...bySeg.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_CUTS);
    for (const [s] of order) {
      const vx = s.b[0] - s.a[0]; const vy = s.b[1] - s.a[1]; const L = Math.hypot(vx, vy);
      if (L < 1e-6) continue;
      const nx = -vy / L; const ny = vx / L;
      let cx = 0; let cy = 0;
      for (const [x, y] of cut) { cx += x; cy += y; }
      cx /= cut.length; cy /= cut.length;
      const sign = (cx - s.a[0]) * nx + (cy - s.a[1]) * ny >= 0 ? 1 : -1;
      cut = clipHalfPlane(cut, [s.a[0] + nx * sign * s.half, s.a[1] + ny * sign * s.half], [nx * sign, ny * sign]);
      if (cut.length < 3) break;
    }
    const kept = cut.length >= 3 ? ringArea(cut) / area : 0;
    if (cut.length < 3 || kept < 1 - share - CUT_SLACK) { keepAsMapped(); continue; }
    clipped.push({ id, share, kept });
    out.push({ ...f, geometry: cut.map(([x, y]) => unproject(x, y)), tags: { ...f.tags, 'mapng:clipped_from_road': 'yes' } });
  }
  return { features: out, dropped, clipped, flagged };
}
