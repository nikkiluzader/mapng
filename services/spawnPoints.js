// Spawn and quicktravel points: places the user picks in step 1 for the car
// to start at or jump to. In BeamNG both are info.json spawnPoints entries
// (shown on the big map under Points of Interest -> Quicktravel Points) with
// a SpawnSphere of the same object name in PlayerDropPoints; the default one
// is the level's starting spawn. Design: refs/output/poi-quicktravel-plan.md.
//
// The points are geographic, so they do not belong to one box: a point
// outside the box is kept (moving the box back brings it back) and skipped
// by the export. Pure functions; the 2D map and the sidebar keep the list in
// the store (stores/mainStore.js), the export places them on the drawn roads.
import { NON_DRIVEABLE_HIGHWAYS } from './roadWidth.js';

export const MAX_POINTS = 64;
export const POINT_NAME_MAX = 48;
export const POINT_DESCRIPTION_MAX = 200;
export const POINTS_STORAGE_KEY = 'mapng_points_v1';
export const POINT_KINDS = ['spawn', 'quicktravel'];
// the default point's object name: BeamNG remembers the spawn a player last
// picked by object name (settings/cloud/game-state.json), and every MapNG
// level so far has had spawn_default, so a player who picked it follows the
// new default instead of being left on a stale pick
export const DEFAULT_SPAWN_OBJECT = 'spawn_default';
// (a centreline this close, or the road's own half width and 3 m: the point
// is on that road; further off it stays where it was put, e.g. a car park)
const SNAP_REACH_M = 12;
const SNAP_EDGE_M = 3;
// at a crossing (an overpass over a street, a road over a tunnel) the roads
// are about equally near: the one the arrow is aimed along wins, then the
// one on the ground
const ALIGN_WEIGHT_M = 2;
const OFF_GROUND_PENALTY_M = 0.75;
// over the drawn surface: BeamNG's safeTeleport settles the car from there
const SPAWN_LIFT_M = 0.5;

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

/** A short random id for a new point (drives its file and object names). */
export function newPointId(rand = Math.random) {
  let s = '';
  for (let i = 0; i < 6; i++) s += 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(rand() * 32) % 32];
  return s;
}

/**
 * A name as the game will show it. The name goes in as plain text where
 * official levels put a translation key (Cliff does the same), so anything
 * that reads as a key or i18n syntax is taken out: control characters,
 * { } | @, and a leading "levels." or "ui.".
 */
export function cleanPointName(name, max = POINT_NAME_MAX) {
  let s = String(name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[{}|@]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  while (/^(levels|ui)\./i.test(s)) s = s.replace(/^(levels|ui)\./i, '').trim();
  return s.slice(0, max).trim();
}

const normHeading = (h) => {
  const n = Number(h);
  if (!Number.isFinite(n)) return 0;
  return round(((n % 360) + 360) % 360, 1);
};

/**
 * A list of points made safe to keep, share and export: at most MAX_POINTS,
 * finite coordinates, known kinds, short clean names, unique ids, and at
 * most one default. The kind follows the default (the default is the spawn,
 * the others quicktravel points), so hand-edited configs stay consistent.
 */
export function sanitizePoints(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const ids = new Set();
  let hasDefault = false;
  for (const raw of list) {
    if (out.length >= MAX_POINTS) break;
    if (!raw || typeof raw !== 'object') continue;
    const lat = Number(raw.lat);
    const lng = Number(raw.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    let id = typeof raw.id === 'string' ? raw.id.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) : '';
    if (!id || ids.has(id)) {
      // (a stable stand-in from the position: the same config gives the same names)
      let h = 2166136261;
      for (const c of `${lat.toFixed(6)},${lng.toFixed(6)},${out.length}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
      id = `p${(h >>> 0).toString(36)}`.slice(0, 8);
      while (ids.has(id)) id += 'x';
    }
    ids.add(id);
    const wantsDefault = raw.isDefault === true;
    const isDefault = wantsDefault && !hasDefault;
    if (isDefault) hasDefault = true;
    const point = {
      id,
      kind: isDefault ? 'spawn' : 'quicktravel',
      name: cleanPointName(raw.name),
      lat: round(lat, 6),
      lng: round(lng, 6),
      heading: normHeading(raw.heading),
      isDefault,
    };
    const description = cleanPointName(raw.description, POINT_DESCRIPTION_MAX);
    if (description) point.description = description;
    // (an older list may mark the spawn by kind alone)
    point._spawnKind = raw.kind === 'spawn';
    out.push(point);
  }
  if (!hasDefault) {
    const first = out.find((p) => p._spawnKind);
    if (first) { first.isDefault = true; first.kind = 'spawn'; }
  }
  for (const p of out) delete p._spawnKind;
  return out;
}

/** The name a point is shown with: its own, or "Point n". */
export const pointLabel = (p, index) => (p?.name ? p.name : `Point ${index + 1}`);

/** Inside a { north, south, east, west } box. */
export function pointInBounds(p, b) {
  if (!p || !b) return false;
  return p.lat <= b.north && p.lat >= b.south && p.lng <= b.east && p.lng >= b.west;
}

/** Compass bearing in degrees (0 = north, clockwise) from one lat/lng to another. */
export function bearingDeg(from, to) {
  const k = Math.cos(((from.lat + to.lat) / 2) * Math.PI / 180);
  const dx = (to.lng - from.lng) * k;
  const dy = to.lat - from.lat;
  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return 0;
  return normHeading(Math.atan2(dx, dy) * 180 / Math.PI);
}

/**
 * A SpawnSphere's rotationMatrix for a heading (0 = north, clockwise):
 * rows right, forward (BeamNG +Y), up, as findRoadSpawn's (verified in game).
 */
export function headingRotationMatrix(headingDeg) {
  const h = (Number(headingDeg) || 0) * Math.PI / 180;
  const fx = Math.sin(h); const fy = Math.cos(h);
  const r = (v) => round(v, 6) + 0;   // (+0: no -0 in the JSON)
  return [r(fy), r(-fx), 0, r(fx), r(fy), 0, 0, 0, 1];
}

const roadName = (cw) => {
  const tags = cw.tags || {};
  return cleanPointName(tags.name || tags.ref || '') || null;
};

/**
 * The drawn carriageway a point at world (x, y) lands on, or null when none
 * is within reach. Carriageways as the export draws them ({ nodes: [[x, y,
 * z]], half, highway, oneWay, bridge, carried, tunnel, tags }): their node z
 * is the road surface as solved, a deck's or a tunnel road's height, so z
 * here is never the ground under a deck. The car stands in the lane traffic
 * keeps to on a two-way road, facing along it in the direction nearer the
 * arrow; on a one-way road it faces the way's direction.
 */
export function snapToCarriageway(x, y, headingDeg, carriageways, { leftHandTraffic = false } = {}) {
  const h = (Number(headingDeg) || 0) * Math.PI / 180;
  const ax = Math.sin(h); const ay = Math.cos(h);
  let best = null;
  for (const cw of carriageways || []) {
    const n = cw?.nodes;
    if (!Array.isArray(n) || n.length < 2 || NON_DRIVEABLE_HIGHWAYS.has(cw.highway)) continue;
    const half = Number(cw.half) || 3;
    const reach = Math.max(half + SNAP_EDGE_M, SNAP_REACH_M);
    const elevated = !!(cw.bridge || cw.carried || cw.tunnel);
    for (let i = 0; i + 1 < n.length; i++) {
      const [x0, y0, z0] = n[i]; const [x1, y1, z1] = n[i + 1];
      const dx = x1 - x0; const dy = y1 - y0; const L2 = dx * dx + dy * dy;
      if (L2 < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / L2));
      const px = x0 + dx * t; const py = y0 + dy * t;
      const d = Math.hypot(x - px, y - py);
      if (d > reach) continue;
      const L = Math.sqrt(L2); const tx = dx / L; const ty = dy / L;
      const align = Math.abs(ax * tx + ay * ty);
      const score = d + ALIGN_WEIGHT_M * (1 - align) + (elevated ? OFF_GROUND_PENALTY_M : 0);
      if (best && score >= best.score) continue;
      best = { score, cw, px, py, pz: z0 + (z1 - z0) * t, tx, ty, d, half };
    }
  }
  if (!best) return null;
  const { cw, tx, ty, half } = best;
  const dot = ax * tx + ay * ty;
  const oneWay = !!cw.oneWay;
  const sign = oneWay || dot >= 0 ? 1 : -1;
  const fx = tx * sign; const fy = ty * sign;
  const lane = oneWay ? 0 : (half / 2) * (leftHandTraffic ? -1 : 1);
  return {
    x: best.px + fy * lane,
    y: best.py - fx * lane,
    z: best.pz,
    heading: normHeading(Math.atan2(fx, fy) * 180 / Math.PI),
    road: roadName(cw),
    highway: cw.highway || null,
    layer: cw.tunnel ? 'tunnel' : (cw.bridge || cw.carried) ? 'bridge' : 'ground',
    distance: best.d,
    againstOneWay: oneWay && dot < 0,
  };
}

/**
 * Where each point goes in the level, and what the level writes for it.
 *
 * ctx: { bounds (the export's), project(lat, lng) -> [x, y], carriageways,
 * groundAt(x, y) (the terrain's height, for points off the roads),
 * leftHandTraffic, autoSpawn: { position, rotationMatrix } (today's spawn) }.
 *
 * Returns { spheres, spawnPoints, previews, report, used }:
 *  - spheres: the SpawnSpheres ({ name, position, rotationMatrix });
 *  - spawnPoints: info.json's list, the default first;
 *  - previews: [{ file, x, y, heading }] crops to render (spawn_<id>.jpg);
 *  - report: a row per point, outside ones included;
 *  - used: false without points (the level as before: the automatic spawn).
 */
export function planSpawnPoints(points, ctx = {}) {
  const { bounds, project, carriageways = [], groundAt = () => 0, leftHandTraffic = false, autoSpawn = null } = ctx;
  const list = sanitizePoints(points);
  const auto = {
    sphere: { name: DEFAULT_SPAWN_OBJECT, position: autoSpawn?.position || [0, 0, 0], rotationMatrix: autoSpawn?.rotationMatrix || [1, 0, 0, 0, 1, 0, 0, 0, 1] },
    // (exactly today's entry: a level without points is unchanged)
    entry: { name: 'Default', objectname: DEFAULT_SPAWN_OBJECT, preview: 'preview.png', translationId: 'Default Spawnpoint' },
  };
  if (!list.length) return { spheres: [auto.sphere], spawnPoints: [auto.entry], previews: [], report: [], used: false };

  const report = [];
  const placed = [];
  list.forEach((p, index) => {
    const name = pointLabel(p, index);
    if (!bounds || !pointInBounds(p, bounds)) {
      report.push({ id: p.id, name, isDefault: p.isDefault, skipped: true, note: 'outside the map: not exported' });
      return;
    }
    const [x, y] = project(p.lat, p.lng);
    const snap = snapToCarriageway(x, y, p.heading, carriageways, { leftHandTraffic });
    const at = snap
      ? { x: snap.x, y: snap.y, z: snap.z, heading: snap.heading }
      : { x, y, z: groundAt(x, y), heading: p.heading };
    const position = [round(at.x, 2), round(at.y, 2), round(at.z + SPAWN_LIFT_M, 2)];
    const objectname = p.isDefault ? DEFAULT_SPAWN_OBJECT : `spawn_mapng_${p.id}`;
    const preview = `spawn_${p.id}.jpg`;
    const entry = { translationId: name, objectname, preview };
    if (p.description) entry.description = p.description;
    placed.push({
      isDefault: p.isDefault,
      sphere: { name: objectname, position, rotationMatrix: headingRotationMatrix(at.heading) },
      entry,
      preview: { file: preview, x: at.x, y: at.y, heading: at.heading },
    });
    report.push({
      id: p.id, name, isDefault: p.isDefault, skipped: false, position,
      heading: at.heading,
      road: snap ? (snap.road || snap.highway || 'unnamed road') : null,
      layer: snap ? snap.layer : 'off road',
      distance: snap ? round(snap.distance, 1) : null,
      note: snap ? (snap.againstOneWay ? 'arrow against the one-way road: faces the way it runs' : '') : 'no drivable road within reach: on the ground where placed',
    });
  });

  const def = placed.find((p) => p.isDefault);
  const others = placed.filter((p) => !p.isDefault);
  const spheres = [];
  const spawnPoints = [];
  if (def) { spheres.push(def.sphere); spawnPoints.push(def.entry); }
  else { spheres.push(auto.sphere); spawnPoints.push(auto.entry); }
  for (const p of others) { spheres.push(p.sphere); spawnPoints.push(p.entry); }
  return { spheres, spawnPoints, previews: placed.map((p) => p.preview), report, used: true };
}

/** export_report.txt lines for planSpawnPoints' report. */
export function spawnReportLines(report) {
  if (!report?.length) return [];
  const lines = ['', 'Spawn and Quicktravel Points'];
  for (const r of report) {
    const star = r.isDefault ? ' (default spawn)' : '';
    if (r.skipped) { lines.push(`- ${r.name}${star}: skipped, ${r.note}`); continue; }
    const [x, y, z] = r.position;
    const where = r.road ? `on ${r.road} (${r.layer}, ${r.distance} m from the pin)` : 'off road';
    lines.push(`- ${r.name}${star}: ${where}, x ${x} y ${y} z ${z}, heading ${Math.round(r.heading)}°${r.note ? `; ${r.note}` : ''}`);
  }
  return lines;
}
