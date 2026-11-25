// Street widths from the kerbs mapped along them (Splatplays' Armadale, 2026-11-25).
//
// Where OSM maps the kerbs as lines (barrier=kerb along both edges of the carriageway) or the road's own surface as
// an area (area:highway=<road class>), the carriageway's width is known: the distance between them. Without it every
// street of a class got its class default: Schruth Street South, 8 m kerb to kerb, came out 5.5 m, its curbs a metre
// inside the real kerbs and the mapped sidewalks beside them a metre away (a trench of bare ground between), the
// corner slabs following the real kerb while the curb followed the road (zig-zag corners).
//
//   every STEP_M along the street (clear of its ends: junctions), a ray each way to the first kerb running with the
//   street (within PARALLEL_DEG of it; a kerb across the ray is a side street's or a driveway's). The street is
//   measured when both rays hit in at least SEEN of the cross-sections and the widths agree (IQR within AGREE_M or
//   AGREE of the median); the median is written as mapng:carriageway_width (roadWidth.js fits it onto the lanes,
//   parking and shoulders) with mapng:width_source=kerb. Ahead of the width measured between the buildings
//   (streetWidths.js), which then leaves the street alone; never where OSM tags a width.
//
// Pure: features in, features out.
import { estimateRoadCrossSection, isOneWayRoad } from './roadWidth.js';
import { fastHypot } from './fastMath.js';

const STEP_M = 3;
const END_SKIP_M = 6;
const MIN_SAMPLES = 2;
const SEEN = 0.5;
const AGREE = 0.25;
const AGREE_M = 1.5;
const PARALLEL_COS = Math.cos((35 * Math.PI) / 180);
export const KERB_MIN_M = 2.4;         // a carriageway narrower than this between kerbs: a measuring error
const REACH_MIN_M = 8;
const REACH_MAX_M = 20;
const BUCKET_M = 16;
const M_PER_DEG = 111320;
// roads that may be measured (paths have their own widths; a parking aisle's kerbs are the car park's)
const ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link',
  'secondary_link', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service', 'road', 'busway']);
const SERVICE_MEASURED = new Set([undefined, '', 'alley']);
// a road's surface mapped as an area: its outline is the kerb (a traffic island's is a kerb inside the road)
const AREA_ROADS = new Set([...ROADS, 'emergency', 'bus_stop']);

const has = (v) => v !== undefined && v !== null && v !== '';

/** Whether a road may take a width measured between its kerbs. */
export function kerbMeasurable(tags = {}) {
  if (!ROADS.has(tags.highway) || tags.area === 'yes') return false;
  if (tags.highway === 'service' && !SERVICE_MEASURED.has(tags.service)) return false;
  if (has(tags.width) || has(tags['width:carriageway'])) return false;
  if (has(tags.bridge) && tags.bridge !== 'no') return false;
  if (has(tags.tunnel) && tags.tunnel !== 'no') return false;
  return true;
}

/** Kerb segments in a bucket index; ray(p, d, reach) -> distance to the first one running across d's normal, or null. */
export function buildKerbIndex(lines) {
  const segs = []; const buckets = new Map();
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i]; const b = line[i + 1];
      const L = fastHypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-6) continue;
      const k = segs.length;
      segs.push([a[0], a[1], b[0], b[1], (b[0] - a[0]) / L, (b[1] - a[1]) / L]);
      for (let bx = Math.floor(Math.min(a[0], b[0]) / BUCKET_M); bx <= Math.floor(Math.max(a[0], b[0]) / BUCKET_M); bx++) {
        for (let by = Math.floor(Math.min(a[1], b[1]) / BUCKET_M); by <= Math.floor(Math.max(a[1], b[1]) / BUCKET_M); by++) {
          const key = `${bx},${by}`;
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(k);
        }
      }
    }
  }
  // (along: the street's direction; a kerb must run within PARALLEL_DEG of it)
  const ray = (p, d, along, reach) => {
    const q = [p[0] + d[0] * reach, p[1] + d[1] * reach];
    let best = Infinity; const seen = new Set();
    for (let bx = Math.floor(Math.min(p[0], q[0]) / BUCKET_M); bx <= Math.floor(Math.max(p[0], q[0]) / BUCKET_M); bx++) {
      for (let by = Math.floor(Math.min(p[1], q[1]) / BUCKET_M); by <= Math.floor(Math.max(p[1], q[1]) / BUCKET_M); by++) {
        for (const k of buckets.get(`${bx},${by}`) || []) {
          if (seen.has(k)) continue;
          seen.add(k);
          const [x0, y0, x1, y1, ux, uy] = segs[k];
          if (Math.abs(ux * along[0] + uy * along[1]) < PARALLEL_COS) continue;
          const ex = x1 - x0; const ey = y1 - y0;
          const den = d[0] * ey - d[1] * ex;
          if (Math.abs(den) < 1e-12) continue;
          const t = ((x0 - p[0]) * ey - (y0 - p[1]) * ex) / den;
          const u = ((x0 - p[0]) * d[1] - (y0 - p[1]) * d[0]) / den;
          if (t > 0 && t <= reach && u >= 0 && u <= 1 && t < best) best = t;
        }
      }
    }
    return Number.isFinite(best) ? best : null;
  };
  return { ray, count: segs.length };
}

/**
 * The kerb-to-kerb width of a street (centreline [[x, y]...]) or null: { width, offset (m left of the line the
 * kerbs' middle stands), samples, seen }.
 */
export function sampleKerbWidth(line, kerbs, { reach = 12, min = KERB_MIN_M, max = 40 } = {}) {
  const s = [0];
  for (let i = 1; i < line.length; i++) s.push(s[i - 1] + fastHypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const L = s[s.length - 1];
  const skip = Math.min(END_SKIP_M, L / 4);
  const widths = []; const offsets = [];
  let samples = 0; let j = 0;
  for (let at = skip; at <= L - skip + 1e-9; at += STEP_M) {
    while (j + 1 < line.length - 1 && s[j + 1] < at) j++;
    const seg = s[j + 1] - s[j];
    if (!(seg > 1e-6)) continue;
    const t = (at - s[j]) / seg;
    const p = [line[j][0] + (line[j + 1][0] - line[j][0]) * t, line[j][1] + (line[j + 1][1] - line[j][1]) * t];
    const dx = (line[j + 1][0] - line[j][0]) / seg; const dy = (line[j + 1][1] - line[j][1]) / seg;
    samples++;
    const left = kerbs.ray(p, [-dy, dx], [dx, dy], reach);
    const right = kerbs.ray(p, [dy, -dx], [dx, dy], reach);
    if (left === null || right === null) continue;
    const w = left + right;
    if (w < min || w > max) continue;
    widths.push(w); offsets.push((left - right) / 2);
  }
  if (samples < MIN_SAMPLES || widths.length < Math.max(MIN_SAMPLES, SEEN * samples)) return null;
  const sorted = [...widths].sort((a, b) => a - b);
  const q = (f) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
  const median = q(0.5);
  if (q(0.75) - q(0.25) > Math.max(AGREE_M, AGREE * median)) return null;
  const off = [...offsets].sort((a, b) => a - b)[Math.floor(offsets.length / 2)];
  return { width: median, offset: off, samples, seen: widths.length };
}

/**
 * Features with the widths measured between their kerbs written into their roads' tags. Returns
 * { features, measured: [{ id, highway, width, before, offset }], kerbLines, roadAreas }.
 */
export function measureKerbWidths(features) {
  const list = Array.isArray(features) ? features : [];
  const kerbLines = list.filter((f) => f?.tags?.barrier === 'kerb' && Array.isArray(f.geometry) && f.geometry.length >= 2);
  const roadAreas = list.filter((f) => AREA_ROADS.has(f?.tags?.['area:highway']) && Array.isArray(f.geometry) && f.geometry.length >= 3);
  if (!kerbLines.length && !roadAreas.length) return { features: list, measured: [], kerbLines: 0, roadAreas: 0 };
  const lat0 = (kerbLines[0] || roadAreas[0]).geometry[0].lat;
  const kx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  const toXY = (p) => [p.lng * kx, p.lat * M_PER_DEG];
  const lines = kerbLines.map((f) => f.geometry.map(toXY));
  for (const f of roadAreas) {
    const ring = f.geometry.map(toXY);
    const a = ring[0]; const b = ring[ring.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) ring.push(a);
    lines.push(ring);
  }
  const kerbs = buildKerbIndex(lines);
  // (a traffic island's outline is the kerb of the one-way carriageways either side of it; a two-way road's line
  // runs through its islands, so for it they are not looked for)
  const islands = list.filter((f) => f?.tags?.['area:highway'] === 'traffic_island' && Array.isArray(f.geometry) && f.geometry.length >= 3);
  const withIslands = islands.length ? buildKerbIndex([...lines, ...islands.map((f) => { const r = f.geometry.map(toXY); r.push(r[0]); return r; })]) : kerbs;
  const measured = [];
  const out = list.map((f) => {
    if (f?.type !== 'road' || !Array.isArray(f.geometry) || f.geometry.length < 2 || !kerbMeasurable(f.tags)) return f;
    const tags = f.tags;
    const dflt = 2 * estimateRoadCrossSection(tags, tags.highway, isOneWayRoad(tags), { urban: true }).carriagewayHalfWidth;
    // (each side's kerb looked for out to the class width and some: a street wider than that has its kerbs further,
    // but further still a ray finds the next street's)
    const reach = Math.min(REACH_MAX_M, Math.max(REACH_MIN_M, dflt + 4));
    const m = sampleKerbWidth(f.geometry.map(toXY), isOneWayRoad(tags) ? withIslands : kerbs, { reach, max: Math.max(2.2 * dflt, dflt + 8) });
    if (!m) return f;
    measured.push({ id: f.id ?? null, highway: tags.highway, width: m.width, before: dflt, offset: m.offset, seen: m.seen, samples: m.samples });
    return { ...f, tags: { ...tags, 'mapng:carriageway_width': m.width.toFixed(1), 'mapng:width_source': 'kerb' } };
  });
  return { features: out, measured, kerbLines: kerbLines.length, roadAreas: roadAreas.length, islands: islands.length };
}

/** One log line: what was measured, what was looked at. */
export function kerbWidthsSummary(r) {
  if (!r.kerbLines && !r.roadAreas) return '[Kerb widths] no kerb lines or road areas mapped here: every street keeps its class width (or the width between its buildings).';
  const n = r.measured.length;
  if (!n) return `[Kerb widths] ${r.kerbLines} kerb line(s) and ${r.roadAreas} road area(s) mapped, but no street had kerbs found on both sides along enough of it: widths left to the class (or the buildings).`;
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const off = r.measured.filter((m) => Math.abs(m.offset) > 0.75).length;
  return `[Kerb widths] ${n} street(s) measured kerb to kerb from ${r.kerbLines} kerb line(s), ${r.roadAreas} road area(s) and ${r.islands || 0} traffic island(s) (the kerb of the one-way carriageways beside them): median ${med(r.measured.map((m) => m.width)).toFixed(1)} m (their class default ${med(r.measured.map((m) => m.before)).toFixed(1)} m); ${off} with the mapped line more than 0.75 m off the kerbs' middle (kept on its line).`;
}
