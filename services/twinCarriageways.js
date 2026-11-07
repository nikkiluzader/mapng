// A divided road's two carriageways drawn side by side, not over each other.
//
// OSM maps each direction of a divided road as its own one-way line, down the middle of that carriageway.
// Where the median is narrow (a bridge's twin decks, an urban motorway) the two lines are often closer than
// the widths we draw for them (lanes + shoulders): the asphalt overlapped, a deck's parapet and girders
// stood on the other carriageway's edge lane, a suspension bridge's median barrier and hangers came down
// on a lane (the Golden Gate, Wellington's motorway, the Rainbow Bridge approaches).
//
// For each one-way road running alongside another for most of its length (ALONGSIDE of its samples, the
// lines parallel), closer than their drawn widths together: its carriageway is capped so the two meet at
// a line between them (each a share by its own width, GAP_M apart), written as mapng:carriageway_max
// (roadWidth.js: a cap only; shoulders and parking give way first, then the lanes; the cap never under
// LANE_MIN_M a lane). Not where OSM gives a width, nor a short overlap (a fork's branches: their joint handles those).
// Pure: features in, features out.

import { estimateRoadCrossSection, isOneWayRoad } from './roadWidth.js';

const CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'unclassified', 'residential']);
const STEP_M = 5;               // samples along a road
const END_SKIP_M = 8;           // ... clear of its ends (junctions, forks)
const PARALLEL_COS = 0.95;      // lines this parallel (either direction)
const REACH_M = 3;              // a twin within the drawn widths together + this: alongside
const ALONGSIDE = 0.6;          // ... in at least this share of the samples
const OVERLAP = 0.5;            // overlapping in at least this share: capped
const QUANTILE = 0.25;          // the cap from the narrower quarter of the overlapping samples
const GAP_M = 0.2;              // the two carriageways' edges this far apart
const LANE_MIN_M = 3.0;         // never narrower than this per lane
const DEFAULT_LANES = 2;
const M_PER_DEG = 111320;

function lanesOf(tags) {
  const n = parseInt(tags?.lanes, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LANES;
}

/** { features, fitted: [{ id, width, before }] } */
export function fitTwinCarriageways(features) {
  const list = Array.isArray(features) ? features : [];
  const cands = [];
  list.forEach((f, idx) => {
    const t = f?.tags;
    if (f?.type !== 'road' || !Array.isArray(f.geometry) || f.geometry.length < 2 || !t) return;
    if (!CLASSES.has(t.highway) || !isOneWayRoad(t) || t.width || t.area === 'yes' || t.junction === 'roundabout') return;
    cands.push({ idx, f });
  });
  if (cands.length < 2) return { features: list, fitted: [] };
  const lat0 = cands[0].f.geometry[0].lat;
  const kx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  const CELL = 40;
  const grid = new Map();
  for (const c of cands) {
    c.xy = c.f.geometry.map((p) => [p.lng * kx, p.lat * M_PER_DEG]);
    // (the widest it is drawn, rural shoulders: the cap only ever narrows it)
    const cs = estimateRoadCrossSection(c.f.tags, c.f.tags.highway, true, { urban: false });
    c.half = cs.carriagewayHalfWidth;
    c.xy.forEach((p, i) => {
      if (i + 1 >= c.xy.length) return;
      const q = c.xy[i + 1];
      for (let gx = Math.floor(Math.min(p[0], q[0]) / CELL); gx <= Math.floor(Math.max(p[0], q[0]) / CELL); gx++) {
        for (let gy = Math.floor(Math.min(p[1], q[1]) / CELL); gy <= Math.floor(Math.max(p[1], q[1]) / CELL); gy++) {
          const k = `${gx},${gy}`;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push([c, i]);
        }
      }
    });
  }
  const out = list.slice();
  const fitted = [];
  for (const a of cands) {
    // samples along a, clear of its ends
    const S = [0]; for (let i = 1; i < a.xy.length; i++) S.push(S[i - 1] + Math.hypot(a.xy[i][0] - a.xy[i - 1][0], a.xy[i][1] - a.xy[i - 1][1]));
    const total = S[S.length - 1];
    if (total < 2 * END_SKIP_M + STEP_M) continue;
    let n = 0; let along = 0; const caps = [];
    let seg = 0;
    for (let s = END_SKIP_M; s <= total - END_SKIP_M; s += STEP_M) {
      while (seg + 1 < S.length - 1 && S[seg + 1] < s) seg++;
      const p0 = a.xy[seg]; const p1 = a.xy[seg + 1];
      const L = (S[seg + 1] - S[seg]) || 1;
      const t = (s - S[seg]) / L;
      const p = [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
      const u = [(p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L];
      n++;
      // the nearest parallel line of another candidate
      let best = null;
      const seen = new Set();
      for (const [b, i] of grid.get(`${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`) || []) {
        if (b === a || seen.has(`${b.idx}:${i}`)) continue;
        seen.add(`${b.idx}:${i}`);
        const q0 = b.xy[i]; const q1 = b.xy[i + 1];
        const vx = q1[0] - q0[0]; const vy = q1[1] - q0[1]; const L2 = vx * vx + vy * vy || 1e-9; const Lb = Math.sqrt(L2);
        if (Math.abs((vx * u[0] + vy * u[1]) / Lb) < PARALLEL_COS) continue;
        const raw = ((p[0] - q0[0]) * vx + (p[1] - q0[1]) * vy) / L2;
        if (raw < 0 || raw > 1) continue;
        const d = Math.hypot(q0[0] + vx * raw - p[0], q0[1] + vy * raw - p[1]);
        if (!best || d < best.d) best = { d, b };
      }
      if (!best || best.d > a.half + best.b.half + REACH_M) continue;
      along++;
      if (best.d < a.half + best.b.half) caps.push(2 * (best.d * (a.half / (a.half + best.b.half)) - GAP_M / 2));
    }
    if (!n || along / n < ALONGSIDE || caps.length / n < OVERLAP) continue;
    caps.sort((x, y) => x - y);
    let cap = caps[Math.floor(QUANTILE * (caps.length - 1))];
    cap = Math.max(cap, lanesOf(a.f.tags) * LANE_MIN_M);
    if (cap >= 2 * a.half - 0.05) continue;
    out[a.idx] = { ...a.f, tags: { ...a.f.tags, 'mapng:carriageway_max': cap.toFixed(1) } };
    fitted.push({ id: a.f.id ?? null, width: +cap.toFixed(1), before: +(2 * a.half).toFixed(1) });
  }
  return { features: out, fitted };
}
