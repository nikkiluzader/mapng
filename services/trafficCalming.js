// Speed bumps, humps, tables and cushions from OSM traffic_calming, on the
// roads they are mapped on, all from stock BeamNG assets
// (beamngPropLibrary.js CALMING_SHAPES):
//
//   bump     Driver Training's bolt-down rubber/steel bump: modules tiled
//            across the road, an end cap at each side
//   cushion  the same modules as one pad per lane (wide vehicles straddle them)
//   hump     Gridmap's smooth 4.2 m suspension hump, tiled across the road and
//            scaled to its width, with road_chevrons paint over it
//   table    Gridmap's flat-topped piece, likewise
//
// Humps and tables get a warning sign ahead of them for each travel
// direction (East Coast USA's BUMP sign in the Americas, the Vienna-
// convention humps sign elsewhere), one per run of humps.
//
// They sit on the roads drawn as DecalRoads (the carriageways) or, in parking
// lots and on driveways, on the OSM service road (painted asphalt).
// Pure: callers pass world-space roads and lookups.

import { CALMING_SHAPES } from './beamngPropLibrary.js';

export const HUMP_SIGN_SHAPES = {
  americas: '/levels/east_coast_usa/art/shapes/signs_usa/sign_bump.dae',
  white: '/art/shapes/garage_and_dealership/Clutter/italy_traf_sign_warn_humps.dae',
};
export const CALMING_KINDS = new Set(['bump', 'hump', 'table', 'cushion']);

const BUMP_MODULE_W = 1.0;       // speedbump1 across the road
const GRID_PIECE_W = 4.2;        // Gridmap hump / table across the road
const GUTTER_M = 0.15;           // calming stops this short of each road edge
const SNAP_CARRIAGEWAY_M = 4;    // a mapped node lies on the centre line
const SNAP_SERVICE_M = 2;
const SERVICE_HALF = { parking_aisle: 3.0, driveway: 1.75, alley: 2.25, drive_through: 1.75 };
const SERVICE_HALF_DEFAULT = 2.75;
const SERVICE_HIGHWAYS = new Set(['service', 'track', 'unclassified', 'residential', 'living_street', 'road']);
const LANE_W = 3.2;
const CUSHION_MODULES = 2;       // a pad: two modules (2 m) and its caps
// The Gridmap pieces' profiles (measured from their geometry), for the paint
// over them: hump 4x4_b rises smoothly to 8.3 cm over 4.2 m; table 4x4_c
// climbs to 10.7 cm in ~0.7 m ramps.
const PIECE_L = 4.2;
const HUMP_H = 0.083;
const TABLE_H = 0.107;
const TABLE_RAMP_L = 0.7;
const SIGN_BEFORE_M = 30;        // the warning sign this far ahead of the first hump
const SIGN_RUN_M = 150;          // humps this close, going the same way, share a sign
const SIGN_KERB_M = 1.5;

const unit = ([x, y]) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };

const isOneWay = (tags = {}) => ['yes', '1', 'true', '-1', 'reverse'].includes(String(tags.oneway ?? '').trim().toLowerCase())
  || tags.junction === 'roundabout' || tags.highway === 'motorway' || tags.highway === 'motorway_link';
const travelSign = (tags = {}) => (['-1', 'reverse'].includes(String(tags.oneway ?? '').trim().toLowerCase()) ? -1 : 1);

// Segment index over polylines for nearest-point lookups.
function buildLineIndex(lines, cell = 20) {
  const grid = new Map();
  lines.forEach((line, li) => {
    for (let i = 0; i + 1 < line.points.length; i++) {
      const a = line.points[i]; const b = line.points[i + 1];
      const x0 = Math.floor(Math.min(a[0], b[0]) / cell); const x1 = Math.floor(Math.max(a[0], b[0]) / cell);
      const y0 = Math.floor(Math.min(a[1], b[1]) / cell); const y1 = Math.floor(Math.max(a[1], b[1]) / cell);
      for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
        const k = `${gx},${gy}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push([li, i]);
      }
    }
  });
  return (x, y, maxD) => {
    let best = null;
    const gx = Math.floor(x / cell); const gy = Math.floor(y / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const [li, i] of grid.get(`${gx + dx},${gy + dy}`) || []) {
        const line = lines[li];
        const a = line.points[i]; const b = line.points[i + 1];
        const sx = b[0] - a[0]; const sy = b[1] - a[1];
        const L2 = sx * sx + sy * sy || 1e-9;
        const f = Math.max(0, Math.min(1, ((x - a[0]) * sx + (y - a[1]) * sy) / L2));
        const px = a[0] + sx * f; const py = a[1] + sy * f;
        const d = Math.hypot(px - x, py - y);
        if (d <= maxD && (!best || d < best.d)) best = { d, line, point: [px, py], tangent: unit([sx, sy]) };
      }
    }
    return best;
  };
}

// The piece's rise at `u` m from its centre along the road (for the paint).
export function calmingProfileAt(kind, u) {
  const a = Math.abs(u);
  if (a >= PIECE_L / 2) return 0;
  if (kind === 'table') {
    const fromEdge = PIECE_L / 2 - a;
    if (fromEdge >= TABLE_RAMP_L) return TABLE_H;
    const t = fromEdge / TABLE_RAMP_L;
    return TABLE_H * t * t * (3 - 2 * t);
  }
  const s = Math.cos((Math.PI * a) / PIECE_L);
  return HUMP_H * s * s;
}

/**
 * Place every mapped speed bump, hump, table and cushion.
 *
 * Returns { statics: [{ kind, shape, position, yaw, scale? }], chevrons:
 * [{ kind, nodes, textureLength }], signs: [{ kind, shape, position, yaw }],
 * counts, skipped }. A static's yaw turns its local +X to that heading
 * (rotationMatrixFromYaw).
 *
 * @param {object} p
 * @param {Array} p.features        OSM features (traffic_calming nodes; road ways tagged traffic_calming)
 * @param {Array} p.carriageways    drawn ground carriageways ({ nodes, half, tags, owner })
 * @param {Function} p.toWorld      (lat, lng) -> [x, y]
 * @param {Function} p.heightAt     (x, y) -> ground height (relative to the terrain's minimum)
 * @param {Function} [p.isBlocked]  (x, y) -> true where a warning sign may not stand (another road)
 * @param {'americas'|'white'} [p.style]
 * @param {boolean} [p.leftHandTraffic]
 */
export function placeTrafficCalming({ features = [], carriageways = [], toWorld, heightAt, isBlocked = () => false, style = 'americas', leftHandTraffic = false }) {
  const statics = [];
  const chevrons = [];
  const signs = [];
  const counts = { bump: 0, hump: 0, table: 0, cushion: 0 };
  const skipped = { offRoad: 0, unsupported: 0 };

  const drawn = buildLineIndex(carriageways.filter((cw) => cw.nodes?.length > 1).map((cw) => ({ points: cw.nodes, cw })));
  const serviceLines = [];
  for (const f of features) {
    if (f.type !== 'road' || !SERVICE_HIGHWAYS.has(f.tags?.highway) || !(f.geometry?.length > 1)) continue;
    if (f.tags?.bridge && f.tags.bridge !== 'no') continue;
    if ((Number.parseInt(f.tags?.layer ?? '0', 10) || 0) !== 0) continue;
    serviceLines.push({ points: f.geometry.map((p) => toWorld(p.lat, p.lng)), tags: f.tags, key: `svc:${serviceLines.length}` });
  }
  const service = buildLineIndex(serviceLines);

  // The mapped spots: nodes, plus the middle of a road way tagged as one.
  const spots = [];
  for (const f of features) {
    const kind = String(f.tags?.traffic_calming ?? '').trim().toLowerCase();
    if (!kind || kind === 'no') continue;
    if (!CALMING_KINDS.has(kind)) { skipped.unsupported++; continue; }
    if (f.type === 'traffic_calming' && f.geometry?.length) {
      const [x, y] = toWorld(f.geometry[0].lat, f.geometry[0].lng);
      spots.push({ kind, x, y, tags: f.tags });
    } else if (f.type === 'road' && f.geometry?.length > 1) {
      const pts = f.geometry.map((p) => toWorld(p.lat, p.lng));
      const m = Math.floor((pts.length - 1) / 2);
      spots.push({ kind, x: (pts[m][0] + pts[m + 1][0]) / 2, y: (pts[m][1] + pts[m + 1][1]) / 2, tags: f.tags });
    }
  }

  const signRuns = [];   // signs already standing: { dirKey, x, y }
  for (const spot of spots) {
    let hit = drawn(spot.x, spot.y, SNAP_CARRIAGEWAY_M);
    let road;
    if (hit) {
      road = { half: hit.line.cw.half, tags: hit.line.cw.tags || {}, key: `cw:${hit.line.cw.owner}` };
    } else {
      hit = service(spot.x, spot.y, SNAP_SERVICE_M);
      if (!hit) { skipped.offRoad++; continue; }
      const svc = String(hit.line.tags?.service ?? '').toLowerCase();
      road = { half: SERVICE_HALF[svc] ?? SERVICE_HALF_DEFAULT, tags: hit.line.tags || {}, key: hit.line.key };
    }
    const [x, y] = hit.point;
    const t = hit.tangent;
    const n = [-t[1], t[0]];
    const along = Math.atan2(t[1], t[0]);
    const usable = Math.max(BUMP_MODULE_W, 2 * road.half - 2 * GUTTER_M);
    counts[spot.kind]++;

    if (spot.kind === 'bump' || spot.kind === 'cushion') {
      // Driver Training's module: local x along the road, y across it
      const pads = [];
      if (spot.kind === 'bump') {
        pads.push({ centre: 0, modules: Math.max(1, Math.floor(usable / BUMP_MODULE_W)) });
      } else {
        const lanes = Math.max(1, Number.parseInt(spot.tags?.lanes ?? road.tags?.lanes, 10) || Math.round(usable / LANE_W));
        const laneW = usable / lanes;
        for (let k = 0; k < lanes; k++) pads.push({ centre: -usable / 2 + laneW * (k + 0.5), modules: laneW >= 2.6 ? CUSHION_MODULES : 1 });
      }
      for (const pad of pads) {
        for (let k = 0; k < pad.modules; k++) {
          const off = pad.centre + (k - (pad.modules - 1) / 2) * BUMP_MODULE_W;
          const px = x + n[0] * off; const py = y + n[1] * off;
          const position = [px, py, heightAt(px, py)];
          statics.push({ kind: spot.kind, shape: CALMING_SHAPES.bumpModule.shapeFile, position, yaw: along });
          // the caps' geometry reaches past the first / last module's sides
          if (k === 0) statics.push({ kind: spot.kind, shape: CALMING_SHAPES.bumpCapStart.shapeFile, position, yaw: along });
          if (k === pad.modules - 1) statics.push({ kind: spot.kind, shape: CALMING_SHAPES.bumpCapEnd.shapeFile, position, yaw: along });
        }
      }
      continue;
    }

    // hump / table: Gridmap pieces (local x across the road, y along it),
    // as few as cover the road, squeezed across to its width
    const pieces = Math.max(1, Math.ceil(usable / GRID_PIECE_W - 0.15));
    const sx = usable / (pieces * GRID_PIECE_W);
    for (let k = 0; k < pieces; k++) {
      const off = (k - (pieces - 1) / 2) * GRID_PIECE_W * sx;
      const px = x + n[0] * off; const py = y + n[1] * off;
      statics.push({
        kind: spot.kind, shape: CALMING_SHAPES[spot.kind].shapeFile,
        position: [px, py, heightAt(px, py)], yaw: along - Math.PI / 2, scale: [sx, 1, 1],
      });
    }

    // chevrons for each travel direction, pointing the way it goes; a sign ahead
    const oneway = isOneWay(road.tags);
    for (const dir of oneway ? [travelSign(road.tags)] : [1, -1]) {
      const d = [t[0] * dir, t[1] * dir];
      const right = [d[1], -d[0]];
      const side = leftHandTraffic ? [-right[0], -right[1]] : right;
      const off = oneway ? 0 : usable / 4;
      const width = oneway ? usable * 0.8 : usable * 0.4;
      const cx = x + side[0] * off; const cy = y + side[1] * off;
      const len = PIECE_L * 0.9;
      const nodes = [-0.5, 0, 0.5].map((f) => {
        const u = f * len;
        const nx = cx + d[0] * u; const ny = cy + d[1] * u;
        return [nx, ny, heightAt(nx, ny) + calmingProfileAt(spot.kind, u), width];
      });
      chevrons.push({ kind: spot.kind, nodes, textureLength: len / 2 });

      // by heading, not road piece: OSM splits a street at every junction
      const dirKey = Math.round((Math.atan2(d[1], d[0]) * 8) / Math.PI);
      if (signRuns.some((r) => r.dirKey === dirKey && Math.hypot(r.x - x, r.y - y) < SIGN_RUN_M)) continue;
      const kx = x - d[0] * SIGN_BEFORE_M + side[0] * (road.half + SIGN_KERB_M);
      const ky = y - d[1] * SIGN_BEFORE_M + side[1] * (road.half + SIGN_KERB_M);
      if (isBlocked(kx, ky)) continue;
      signRuns.push({ dirKey, x, y });
      signs.push({ kind: 'bump', shape: HUMP_SIGN_SHAPES[style] ?? HUMP_SIGN_SHAPES.white, position: [kx, ky, heightAt(kx, ky)], yaw: Math.atan2(-d[0], d[1]) });
    }
  }
  return { statics, chevrons, signs, counts, skipped };
}
