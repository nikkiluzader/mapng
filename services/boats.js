// A few boats moored at the piers and in the marinas: the game's own (Italy's
// harbour boats, which bob on the water), never many: a share of the piers
// get one or two alongside, out in
// water deep enough for the hull, clear of other piers, roads, bridges,
// buildings and each other. Each sits at its draft below sea level (Italy
// sets them 0.7 to 1.8 m down from their keel).

import { hash01 } from './streetProps.js';

// shape (beamngPropLibrary PROP_SHAPES), length along local x (or y: yawOffset), beam, draft
export const BOAT_TYPES = [
  { shape: 'boatMotorSmall', length: 7.7, beam: 3.0, draft: 0.8, size: 'small' },
  { shape: 'boatSailB', length: 10.6, beam: 5.3, draft: 1.1, size: 'mid' },
  { shape: 'boatSailC', length: 10.6, beam: 5.3, draft: 1.1, size: 'mid' },
  { shape: 'boatSailD', length: 12.3, beam: 4.8, draft: 1.2, size: 'mid' },
  { shape: 'boatSailE', length: 12.2, beam: 4.0, draft: 1.2, size: 'mid' },
  { shape: 'boatMotorBig', length: 13.7, beam: 6.0, draft: 1.3, size: 'big' },
  { shape: 'boatBigA', length: 16, beam: 5.3, draft: 1.5, size: 'big' },
  { shape: 'boatBigC', length: 16.3, beam: 5.3, draft: 1.5, size: 'big' },
  { shape: 'boatBigD', length: 18.4, beam: 4.7, draft: 1.6, size: 'big' },
];

const PIER_SHARE = 0.55;          // the share of piers with boats
const PER_PIER = 2;
const MAX_BOATS = 10;
const STATION_STEP_M = 9;
const PIER_GAP_M = 0.7;           // the hull this far off the pier's edge
const DEPTH_SPARE_M = 0.1;
const WATER_MIN_M = 0.5;          // water at least this deep under the hull (plus the spare)
const BOAT_GAP_M = 1.5;
const MARINA_TRIES = 24;
const MARINA_BOATS = 3;

/**
 * Boats for piers [{ nodes: [[x, y]...], half }] and marinas (rings), in sea
 * water: groundAt(x, y), seaZ; blocked(x, y): a road, bridge, building or
 * other pier there. Returns [{ shape, x, y, z, yaw }].
 */
export function placeBoats({ piers = [], marinas = [], groundAt, seaZ, blocked = () => false, maxBoats = MAX_BOATS } = {}) {
  if (!Number.isFinite(seaZ) || !groundAt) return [];
  const boats = [];
  const fits = (type, cx, cy, ux, uy) => {
    const vx = -uy; const vy = ux;
    const hl = type.length / 2; const hb = type.beam / 2;
    for (const s of [-1, -0.5, 0, 0.5, 1]) {
      for (const t of [-1, 0, 1]) {
        const x = cx + ux * hl * s + vx * hb * t; const y = cy + uy * hl * s + vy * hb * t;
        // (water under the whole hull; no deeper than lidar shows: it has no
        // depths, the bed is the export's own, a keel in it hidden under the water)
        if (groundAt(x, y) > seaZ - Math.min(type.draft, WATER_MIN_M) - DEPTH_SPARE_M || blocked(x, y)) return false;
      }
    }
    return boats.every((b) => Math.hypot(b.x - cx, b.y - cy) > (b.type.length + type.length) / 2 * 0.6 + BOAT_GAP_M);
  };
  const pick = (seed, sizes) => {
    const list = BOAT_TYPES.filter((t) => sizes.includes(t.size));
    return list[Math.min(list.length - 1, Math.floor(hash01(seed, 'boat') * list.length))];
  };
  const add = (type, x, y, yaw) => boats.push({ type, shape: type.shape, x, y, z: seaZ - type.draft, yaw: yaw + (type.yawOffset || 0) });

  piers.forEach((pier, pi) => {
    if (boats.length >= maxBoats || pier.nodes.length < 2) return;
    if (hash01(`pier:${pi}`, 'boats') >= PIER_SHARE) return;
    const n = pier.nodes;
    let total = 0; const st = [0];
    for (let i = 1; i < n.length; i++) { total += Math.hypot(n[i][0] - n[i - 1][0], n[i][1] - n[i - 1][1]); st.push(total); }
    const sizes = total > 80 ? ['mid', 'big'] : ['small', 'mid'];
    let here = 0;
    for (let s = STATION_STEP_M / 2; s < total && here < PER_PIER && boats.length < maxBoats; s += STATION_STEP_M) {
      const i = Math.max(1, st.findIndex((v) => v >= s));
      const a = n[i - 1]; const b = n[i]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const t = (s - st[i - 1]) / L;
      const px = a[0] + (b[0] - a[0]) * t; const py = a[1] + (b[1] - a[1]) * t;
      const ux = (b[0] - a[0]) / L; const uy = (b[1] - a[1]) / L;
      const type = pick(`pier:${pi}:${Math.round(s)}`, sizes);
      for (const side of hash01(`pier:${pi}:${Math.round(s)}`, 'side') < 0.5 ? [1, -1] : [-1, 1]) {
        const off = pier.half + PIER_GAP_M + type.beam / 2;
        const cx = px - uy * off * side; const cy = py + ux * off * side;
        // (alongside, its length along the pier: a little past each station's middle so they stagger)
        if (!fits(type, cx, cy, ux, uy)) continue;
        add(type, cx, cy, Math.atan2(uy, ux));
        here++;
        break;
      }
    }
  });

  // a few in each marina's own water, along its longest side's line
  marinas.forEach((ring, mi) => {
    if (ring.length < 3) return;
    const xs = ring.map((p) => p[0]); const ys = ring.map((p) => p[1]);
    const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    let li = 0; let ll = 0;
    for (let i = 0; i < ring.length; i++) { const q = ring[(i + 1) % ring.length]; const d = Math.hypot(q[0] - ring[i][0], q[1] - ring[i][1]); if (d > ll) { ll = d; li = i; } }
    const ux = (ring[(li + 1) % ring.length][0] - ring[li][0]) / (ll || 1); const uy = (ring[(li + 1) % ring.length][1] - ring[li][1]) / (ll || 1);
    const inside = (x, y) => { let k = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (((ring[i][1] > y) !== (ring[j][1] > y)) && (x < ((ring[j][0] - ring[i][0]) * (y - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0])) k = !k; return k; };
    let here = 0;
    for (let k = 0; k < MARINA_TRIES && here < MARINA_BOATS && boats.length < maxBoats; k++) {
      const x = box[0] + (box[2] - box[0]) * hash01(`marina:${mi}:${k}`, 'x');
      const y = box[1] + (box[3] - box[1]) * hash01(`marina:${mi}:${k}`, 'y');
      if (!inside(x, y)) continue;
      const type = pick(`marina:${mi}:${k}`, ['small', 'mid']);
      if (!fits(type, x, y, ux, uy)) continue;
      add(type, x, y, Math.atan2(uy, ux));
      here++;
    }
  });
  return boats.map(({ type, ...b }) => b);
}
