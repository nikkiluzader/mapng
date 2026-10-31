// Street widths from the buildings that line them (refs/output/earth-detail-plan.md, A0b; the method of
// BeamNG.Earth's server/roadwidth.py, MIT).
//
// OSM rarely tags a street's width, so every street of a class got the same default: Tokyo's 4 m lanes
// came out 8 m wide, their asphalt over the houses' fronts (the building check then cut 798 houses back),
// while an old town's 25 m square came out a 10 m street. In a built-up street the buildings stand at the
// back of the sidewalks, so the distance between the building faces across it is its right-of-way:
//
//   every STEP_M along the street (END_SKIP_M clear of its ends: junctions), a ray each way up to REACH_M
//   to the first building wall. The street is walled when both rays hit in at least WALLED of the
//   cross-sections and the face-to-face distances agree (IQR within AGREE of the median); that median is
//   then split into two sidewalks (WALK_SHARE of it, WALK_MIN..WALK_MAX, down to WALK_NARROW_MIN on very
//   narrow streets) and the carriageway between (at least CARRIAGE_MIN). A street walled only at its
//   pinches has its drawn road capped to fit between the closest walls (PINCH_SEEN, below).
//
// The measured carriageway is written as mapng:carriageway_width (roadWidth.js fits it onto the default
// lanes and parking / shoulders: those give way first, the lanes keep their class width as long as they
// can) and its sidewalks' width; streets with no room for a sidewalk get sidewalk=no. Never where OSM says: a width or lane count, sidewalk widths, a divided road's one
// carriageway (the buildings span both), a roundabout. Measured widths outside MEASURE_MIN..MEASURE_MAX
// times the class default are not trusted. Pure: features in, features out.

import { estimateRoadCrossSection, isOneWayRoad } from './roadWidth.js';

const STEP_M = 6;
const END_SKIP_M = 10;
const REACH_M = 25;
const MIN_SAMPLES = 4;
const WALLED = 0.6;
const AGREE = 0.3;
const AGREE_M = 2.5;            // ... or within this many metres (a narrow street of small houses, uneven setbacks)
const WALK_SHARE = 0.2;
const WALK_MIN = 1.8;
const WALK_MAX = 4.5;
const WALK_NARROW_MIN = 0.6;
export const CARRIAGE_MIN = 3;
const SIDEWALK_MIN_M = 1.2;     // a measured sidewalk narrower than this: no sidewalk (the wall is at the kerb)
// a measured carriageway at most the class default x WIDEN_SHARE or + WIDEN_M,
// whichever is more (San Francisco's 12 m streets over a 10.6 m default; not
// a square's or a canal's width: theirs, MEASURE_MAX 3x, made plazas roads)
const WIDEN_SHARE = 1.3;
const WIDEN_M = 2;
const MEASURE_MIN_MAJOR = 0.6;  // ... at least this share of it on the bigger classes (tertiary and minor: CARRIAGE_MIN)
const BUCKET_M = 16;
// not walled consistently (front yards, parking spaces, gaps: Tokyo's suburbs, 8-18 m wall to wall along
// one street) but walled at its pinches: the drawn road capped to fit between the closest walls (the
// narrower quarter of the cross-sections seeing both, in at least PINCH_SEEN of them), PINCH_CLEAR m off
// each; never wider than the default. (Not in BeamNG.Earth's method: there such a street kept a
// default wider than its narrowest gaps, over the houses' fronts.)
const PINCH_SEEN = 0.4;
const PINCH_CLEAR_M = 0.3;
const MEASURED = new Set(['residential', 'tertiary', 'secondary', 'primary', 'unclassified', 'living_street', 'service']);
// service roads: alleys and plain ones (Tokyo maps half its lanes so), never
// parking aisles, driveways or drive-throughs (their far walls are a lot's)
const SERVICE_MEASURED = new Set([undefined, '', 'alley']);
const MINOR = new Set(['residential', 'living_street', 'unclassified', 'tertiary']);

const M_PER_DEG = 111320;

/** (carriageway m, sidewalk m) of a right-of-way, or null when the carriageway would be implausible. */
export function splitRightOfWay(row) {
  let walk = Math.min(WALK_MAX, Math.max(WALK_MIN, WALK_SHARE * row));
  walk = Math.min(walk, Math.max(WALK_NARROW_MIN, (row - CARRIAGE_MIN) / 2));
  const cw = row - 2 * walk;
  return cw < CARRIAGE_MIN ? null : { carriageway: cw, sidewalk: walk };
}

/** Building walls as segments in a bucket index, with a ray cast. pts: [x, y] metres; open: lines, not rings. */
export function buildWalls(rings, { open = false } = {}) {
  const segs = [];
  const buckets = new Map();
  for (const ring of rings) {
    for (let i = 0; i < (open ? ring.length - 1 : ring.length); i++) {
      const a = ring[i]; const b = ring[(i + 1) % ring.length];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      const k = segs.length;
      segs.push([a[0], a[1], b[0], b[1]]);
      for (let bx = Math.floor(Math.min(a[0], b[0]) / BUCKET_M); bx <= Math.floor(Math.max(a[0], b[0]) / BUCKET_M); bx++) {
        for (let by = Math.floor(Math.min(a[1], b[1]) / BUCKET_M); by <= Math.floor(Math.max(a[1], b[1]) / BUCKET_M); by++) {
          const key = `${bx},${by}`;
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(k);
        }
      }
    }
  }
  // distance from p along unit d to the first wall within reach, or null
  const ray = (p, d, reach = REACH_M) => {
    const q = [p[0] + d[0] * reach, p[1] + d[1] * reach];
    let best = Infinity;
    const seen = new Set();
    for (let bx = Math.floor(Math.min(p[0], q[0]) / BUCKET_M); bx <= Math.floor(Math.max(p[0], q[0]) / BUCKET_M); bx++) {
      for (let by = Math.floor(Math.min(p[1], q[1]) / BUCKET_M); by <= Math.floor(Math.max(p[1], q[1]) / BUCKET_M); by++) {
        for (const k of buckets.get(`${bx},${by}`) || []) {
          if (seen.has(k)) continue;
          seen.add(k);
          const [x0, y0, x1, y1] = segs[k];
          const ex = x1 - x0; const ey = y1 - y0;
          const den = d[0] * ey - d[1] * ex;
          if (Math.abs(den) < 1e-12) continue;
          const t = ((x0 - p[0]) * ey - (y0 - p[1]) * ex) / den;          // along the ray
          const u = ((x0 - p[0]) * d[1] - (y0 - p[1]) * d[0]) / den;      // along the wall
          if (t > 0 && t <= reach && u >= 0 && u <= 1 && t < best) best = t;
        }
      }
    }
    return Number.isFinite(best) ? best : null;
  };
  return { ray, count: segs.length };
}

/**
 * The right-of-way (m) of a street (centreline [[x, y]...]) between the building walls, or null. water
 * (optional, as walls): a side whose ray meets water before a wall is not walled (a canal street's far
 * walls stand across the canal).
 */
export function measureRightOfWay(line, walls, water = null) {
  const m = sampleRightOfWay(line, walls, water);
  return m ? m.row : null;
}

/** { row (or null), pinch (or null) } of a street, or null when too short to sample. */
export function sampleRightOfWay(line, walls, water = null) {
  const s = [0];
  for (let i = 1; i < line.length; i++) s.push(s[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const L = s[s.length - 1];
  if (L < 2 * END_SKIP_M + STEP_M) return null;
  const rows = [];
  let samples = 0;
  let j = 0;
  for (let at = END_SKIP_M; at <= L - END_SKIP_M; at += STEP_M) {
    while (j + 1 < line.length - 1 && s[j + 1] < at) j++;
    const seg = s[j + 1] - s[j] || 1;
    const t = (at - s[j]) / seg;
    const p = [line[j][0] + (line[j + 1][0] - line[j][0]) * t, line[j][1] + (line[j + 1][1] - line[j][1]) * t];
    const dx = (line[j + 1][0] - line[j][0]) / seg; const dy = (line[j + 1][1] - line[j][1]) / seg;
    samples++;
    const side = (d) => {
      const w = walls.ray(p, d);
      if (w === null || !water) return w;
      const h = water.ray(p, d, w);
      return h === null ? w : null;
    };
    const left = side([-dy, dx]); const right = side([dy, -dx]);
    if (left !== null && right !== null) rows.push(left + right);
  }
  if (samples < MIN_SAMPLES) return null;
  rows.sort((a, b) => a - b);
  const q = (f) => rows[Math.min(rows.length - 1, Math.floor(f * rows.length))];
  const pinch = rows.length >= Math.max(3, PINCH_SEEN * samples) ? q(0.25) : null;
  if (rows.length < WALLED * samples) return { row: null, pinch };
  const median = q(0.5);
  const spread = q(0.75) - q(0.25);
  if (spread <= AGREE * median) return { row: median, pinch };
  // uneven (small houses, setbacks): the narrow end, so the road fits between the closest walls
  return { row: spread <= AGREE_M ? q(0.25) : null, pinch };
}

const has = (v) => v !== undefined && v !== null && v !== '';

/** Whether a road may take a width measured between the buildings. */
export function measurable(tags = {}) {
  if (!MEASURED.has(tags.highway) || tags.area === 'yes') return false;
  if (tags.highway === 'service' && !SERVICE_MEASURED.has(tags.service)) return false;
  if (has(tags.width) || has(tags['width:carriageway']) || has(tags.lanes)) return false;
  if (tags.junction === 'roundabout' || tags.junction === 'circular') return false;
  if (has(tags.bridge) && tags.bridge !== 'no') return false;
  if (has(tags.tunnel) && tags.tunnel !== 'no') return false;
  // one carriageway of a divided road (the buildings stand beyond both): a one-way major road
  if (isOneWayRoad(tags) && !MINOR.has(tags.highway)) return false;
  return true;
}

/**
 * Features with the widths measured between the buildings written into their roads' tags. Returns
 * { features, measured: [{ id, highway, row, carriageway, sidewalk, before }] }.
 */
export function measureStreetWidths(features) {
  const list = Array.isArray(features) ? features : [];
  // (walls: mapped buildings standing on the ground; not machine-learned
  // outlines, which can sit on the road itself, nor roofs and canopies over it)
  const buildings = list.filter((f) => f?.type === 'building' && Array.isArray(f.geometry) && f.geometry.length >= 3
    && f.tags?.['mapng:source'] !== 'overture' && !['roof', 'canopy', 'carport'].includes(f.tags?.building)
    && !(Number(f.tags?.layer) >= 1) && !(Number(f.tags?.min_height) > 2));
  if (!buildings.length) return { features: list, measured: [] };
  const lat0 = buildings[0].geometry[0].lat;
  const kx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  const toXY = (p) => [p.lng * kx, p.lat * M_PER_DEG];
  const walls = buildWalls(buildings.map((f) => f.geometry.map(toXY)));
  const waterAreas = list.filter((f) => f?.type === 'water' && Array.isArray(f.geometry) && f.geometry.length >= 2);
  const water = waterAreas.length ? (() => {
    const rings = waterAreas.filter((f) => !f.tags?.waterway).map((f) => f.geometry.map(toXY));
    const lines = waterAreas.filter((f) => f.tags?.waterway).map((f) => f.geometry.map(toXY));
    const a = buildWalls(rings); const b = buildWalls(lines, { open: true });
    return { ray: (p, d, reach) => { const x = a.ray(p, d, reach); const y = b.ray(p, d, reach); return x === null ? y : y === null ? x : Math.min(x, y); } };
  })() : null;
  const measured = [];
  const out = list.map((f) => {
    if (f?.type !== 'road' || !Array.isArray(f.geometry) || f.geometry.length < 2 || !measurable(f.tags)) return f;
    const m = sampleRightOfWay(f.geometry.map(toXY), walls, water);
    if (!m) return f;
    const tags = f.tags;
    const dflt = 2 * estimateRoadCrossSection(tags, tags.highway, isOneWayRoad(tags), { urban: true }).carriagewayHalfWidth;
    const split = m.row !== null ? splitRightOfWay(m.row) : null;
    if (!split) {
      // capped at its pinches
      if (m.pinch === null) return f;
      const cap = m.pinch - 2 * PINCH_CLEAR_M;
      if (cap >= dflt || cap < CARRIAGE_MIN) return f;
      measured.push({ id: f.id ?? null, highway: tags.highway, row: null, pinch: m.pinch, carriageway: cap, sidewalk: 0, before: dflt, capped: true });
      return { ...f, tags: { ...tags, 'mapng:carriageway_width': cap.toFixed(1) } };
    }
    const min = MINOR.has(tags.highway) ? CARRIAGE_MIN : MEASURE_MIN_MAJOR * dflt;
    if (split.carriageway < min || split.carriageway > Math.max(WIDEN_SHARE * dflt, dflt + WIDEN_M)) return f;
    const next = { ...tags, 'mapng:carriageway_width': split.carriageway.toFixed(1) };
    const sidewalkTagged = Object.keys(tags).some((k) => k === 'sidewalk' || k.startsWith('sidewalk:'));
    if (!sidewalkTagged) {
      // (only "no room for one": a sidewalk's own width stays the default; the
      // split's 3-4.5 m slabs on San Francisco's cross slopes floated and sank)
      if (split.sidewalk < SIDEWALK_MIN_M) next.sidewalk = 'no';
    }
    measured.push({ id: f.id ?? null, highway: tags.highway, row: m.row, carriageway: split.carriageway, sidewalk: split.sidewalk, before: dflt });
    return { ...f, tags: next };
  });
  return { features: out, measured };
}
