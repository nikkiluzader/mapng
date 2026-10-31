// Fountains for BeamNG exports: OSM amenity=fountain (and amenity=drinking_water)
// as stone basins with water and a centrepiece from a small library, built into
// the building tiles (beamngBuildings.js) with their materials.
//
// What a fountain is comes from its tags (fountain=*), then its shape:
//
//   tiered    a basin with a baluster pedestal and one to three bowls, water
//             spilling from each lip (fountain=decorative, the default)
//   jets      a basin with a tall central jet and a ring of smaller ones
//             (fountain=nozzle / water_spray / jet / geyser / musical)
//   obelisk   a basin with a plinth and an obelisk, spouts on its four sides
//             (fountain=sculpture / toroidal / monument)
//   pool      a low-rimmed reflecting pool, water only (a long or large mapped
//             outline with no type; jets along its axis when it is nozzle)
//   bowl      a stone bowl on a baluster, no basin (fountain=stone / bowl /
//             birdbath)
//   bubbler   a drinking post (fountain=drinking / bubbler / bottle, or
//             amenity=drinking_water)
//   wall      a back slab with a spout over a half-round basin, facing the
//             nearest street (fountain=wall, or support=wall_mounted)
//   splash    a flat splash pad with nozzles and short jets (fountain=splash_pad)
//
// A mapped outline is the basin's own; a node gets a round or octagonal basin
// of its kind's size (or its diameter tag). The stonework goes to both detail
// levels (the lite one is the collision: a car hits the rim), water and spray
// to the full one only (a car wades in, it does not ride on the water).
// Deterministic: choices hash the fountain's id. Pure geometry.

import * as THREE from 'three';
import { cylinder, cone, dome, box, wallQuad, insetRing } from './buildingDetails.js';
import { coverRing } from './waterCover.js';

export const FOUNTAIN_KINDS = ['tiered', 'jets', 'obelisk', 'pool', 'bowl', 'bubbler', 'wall', 'splash'];
const KIND_OF_TAG = {
  decorative: 'tiered', tiered: 'tiered', cascade: 'tiered',
  nozzle: 'jets', water_spray: 'jets', jet: 'jets', geyser: 'jets', musical: 'jets', dancing: 'jets', spray: 'jets',
  sculpture: 'obelisk', toroidal: 'obelisk', monument: 'obelisk', statue: 'obelisk', obelisk: 'obelisk',
  stone: 'bowl', bowl: 'bowl', birdbath: 'bowl', bird_bath: 'bowl',
  drinking: 'bubbler', bubbler: 'bubbler', bottle: 'bubbler', drinking_water: 'bubbler', drinking_fountain: 'bubbler',
  wall: 'wall', wall_mounted: 'wall',
  splash_pad: 'splash', splash: 'splash', water_play: 'splash',
  reflecting_pool: 'pool', pool: 'pool', basin: 'pool',
};
// basin diameters (m) for nodes: [min, max]
const NODE_DIAMETER = { tiered: [5, 8], jets: [6, 10], obelisk: [6, 9], pool: [6, 10], splash: [8, 14] };
const RIM = { h: 0.45, w: 0.4, cope: 0.08, over: 0.05, poolH: 0.3 };
const WATER_BELOW_M = 0.12;      // the water under the rim's top
const SKIRT_M = 0.3;             // the rim reaches this far under the lowest ground
const POOL_AREA_M2 = 600;
const POOL_ASPECT = 2.5;
const MAX_FOUNTAINS = 3000;
// smooth white or grey stone: cut marble, polished concrete
const STONES = [['marbleCut', [1, 1, 0.98]], ['marbleCut', [0.8, 0.81, 0.82]], ['smoothConcrete', [1, 0.99, 0.97]], ['smoothConcrete', [0.74, 0.75, 0.76]]];
const WHITE = [1, 1, 1];
const BASIN_TILE = [0.3, 0.5, 0.55];

export const hash01 = (...parts) => {
  let h = 2166136261;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};
const num = (v) => { const x = Number.parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(x) && x > 0 ? x : null; };
export const signedArea = (r) => r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
const circle = (cx, cy, r, n, phase = 0) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos(phase + (2 * Math.PI * i) / n), cy + r * Math.sin(phase + (2 * Math.PI * i) / n)]);

/** A fountain's kind from its tags and (for an outline) its size and shape. */
export function fountainKind(tags = {}, { area = 0, aspect = 1, node = true } = {}) {
  if (tags.amenity === 'drinking_water') return 'bubbler';
  const t = String(tags.fountain ?? '').trim().toLowerCase();
  const kind = KIND_OF_TAG[t] || (tags.support === 'wall_mounted' ? 'wall' : null);
  if (kind === 'jets' && !node && aspect > POOL_ASPECT) return 'pool';
  if (kind) return kind;
  if (!node && (area > POOL_AREA_M2 || aspect > POOL_ASPECT)) return 'pool';
  return 'tiered';
}

export function cleanRing(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) out.push([p[0], p[1]]);
  }
  if (out.length > 1 && Math.hypot(out[0][0] - out.at(-1)[0], out[0][1] - out.at(-1)[1]) < 0.05) out.pop();
  return out;
}
export function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function edgeDistance(x, y, ring) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j]; const [bx, by] = ring[i];
    const dx = bx - ax; const dy = by - ay; const L2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
    best = Math.min(best, Math.hypot(ax + dx * t - x, ay + dy * t - y));
  }
  return best;
}
// The point deepest inside a ring (a grid search, refined): where a centrepiece goes, and how much room it has.
function deepestPoint(ring) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  let best = [(x0 + x1) / 2, (y0 + y1) / 2]; let room = inRing(best[0], best[1], ring) ? edgeDistance(best[0], best[1], ring) : 0;
  let step = Math.max(x1 - x0, y1 - y0) / 12;
  let cx = best[0]; let cy = best[1];
  for (let round = 0; round < 4; round++) {
    for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) {
      const x = cx + i * step; const y = cy + j * step;
      if (!inRing(x, y, ring)) continue;
      const d = edgeDistance(x, y, ring);
      if (d > room) { room = d; best = [x, y]; }
    }
    [cx, cy] = best; step /= 4;
  }
  return { centre: best, room };
}
function aspectOf(ring) {
  // the long side over the short one of the ring's best oriented box (by its edges' directions)
  let best = 1; let bestArea = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]; const b = ring[(i + 1) % ring.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.3) continue;
    const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    let u0 = Infinity; let u1 = -Infinity; let v0 = Infinity; let v1 = -Infinity;
    for (const p of ring) { const s = p[0] * u[0] + p[1] * u[1]; const t = -p[0] * u[1] + p[1] * u[0]; u0 = Math.min(u0, s); u1 = Math.max(u1, s); v0 = Math.min(v0, t); v1 = Math.max(v1, t); }
    const area = (u1 - u0) * (v1 - v0);
    if (area < bestArea) { bestArea = area; best = Math.max(u1 - u0, v1 - v0) / Math.max(0.1, Math.min(u1 - u0, v1 - v0)); }
  }
  return best;
}

/** (x, y) -> inside some building footprint. */
export function buildingTest(features, project) {
  const buildings = [];
  for (const f of features || []) {
    if (f?.type !== 'building' || !(f.geometry?.length >= 3)) continue;
    const ring = f.geometry.map((p) => project(p.lat, p.lng));
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    buildings.push({ ring, box: [x0, y0, x1, y1] });
  }
  return (x, y) => buildings.some(({ ring, box: b }) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && inRing(x, y, ring));
}

/**
 * Fountains to build: [{ id, kind, ring (counter-clockwise, the basin's outer
 * edge; null for bowl / bubbler / wall), centre, room, z0 (lowest ground),
 * z1 (highest), tags, seed }]. project(lat, lng) -> [x, y, ground].
 */
export function planFountains(features, project) {
  const out = [];
  const areas = [];
  for (const f of features || []) {
    const t = f?.tags || {};
    if (t.amenity !== 'fountain' || !Array.isArray(f.geometry) || f.geometry.length < 4) continue;
    const pts = f.geometry.map((p) => project(p.lat, p.lng));
    let ring = cleanRing(pts);
    if (ring.length < 3) continue;
    let area = signedArea(ring);
    if (area < 0) { ring = ring.reverse(); area = -area; }
    if (area < 1.5 || area > 20000) continue;
    const grounds = pts.map((p) => p[2]).filter(Number.isFinite);
    if (!grounds.length) continue;
    const { centre, room } = deepestPoint(ring);
    const kind = fountainKind(t, { area, aspect: aspectOf(ring), node: false });
    const seed = String(f.id);
    out.push({ id: f.id, kind: ['bowl', 'bubbler', 'wall'].includes(kind) ? 'tiered' : kind, ring, centre, room, z0: Math.min(...grounds), z1: Math.max(...grounds), tags: t, seed, mapped: true });
    areas.push(ring);
  }
  // a node inside a building is indoors (a drinking fountain in a school or
  // a mall, under the roof) unless tagged outdoor
  const indoors = buildingTest(features, project);
  for (const f of features || []) {
    if (out.length >= MAX_FOUNTAINS) break;
    const t = f?.tags || {};
    if (f?.type !== 'fountain' || !(f.geometry?.length === 1)) continue;
    const [x, y, z] = project(f.geometry[0].lat, f.geometry[0].lng);
    if (!Number.isFinite(z)) continue;
    // (a node inside a mapped basin is that basin's fountain)
    if (areas.some((r) => inRing(x, y, r))) continue;
    if ((t.indoor === 'yes' || (t.indoor !== 'no' && t.location !== 'outdoor' && indoors(x, y)))) continue;
    const kind = fountainKind(t);
    const seed = String(f.id);
    const span = NODE_DIAMETER[kind];
    let ring = null; let room = 0;
    if (span) {
      const d = Math.min(30, num(t.diameter) || num(t.width) || span[0] + (span[1] - span[0]) * hash01(seed, 'd'));
      const n = kind !== 'splash' && hash01(seed, 'oct') < 0.35 ? 8 : 40;
      ring = circle(x, y, d / 2, n, n === 8 ? Math.PI / 8 : 0);
      room = (d / 2) * (n === 8 ? Math.cos(Math.PI / 8) : 1);
    }
    out.push({ id: f.id, kind, ring, centre: [x, y], room, z0: z, z1: z, tags: t, seed, mapped: false });
  }
  return out;
}

/** The ground each fountain covers (basins and splash pads): no ground cover grows through it. */
export function fountainFootprints(fountains) {
  return fountains.filter((fo) => fo.ring).map((fo) => (fo.kind === 'splash' ? fo.ring : insetRing(fo.ring, -RIM.over)));
}

// ── Geometry ─────────────────────────────────────────────────────────────────

// A flat polygon (holes allowed), facing up, at height z (or z(x, y)).
export function flat(m, mat, outer, holes, z, col, uvM = 2) {
  const tri = THREE.ShapeUtils.triangulateShape(outer.map(([x, y]) => new THREE.Vector2(x, y)), holes.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y))));
  const all = [...outer, ...holes.flat()];
  for (const [i, j, k] of tri) {
    let [a, b, c] = [all[i], all[j], all[k]];
    if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0) [b, c] = [c, b];
    const h = typeof z === 'function' ? z : () => z;
    m.tri(mat, [a[0], a[1], h(a[0], a[1])], [b[0], b[1], h(b[0], b[1])], [c[0], c[1], h(c[0], c[1])], [a[0] / uvM, a[1] / uvM], [b[0] / uvM, b[1] / uvM], [c[0] / uvM, c[1] / uvM], col);
  }
}

/**
 * A surface of revolution about (cx, cy): profile [[r, z]...] traced so the
 * outside is on its right going up (up the outside, inward over a top).
 */
export function lathe(m, mat, cx, cy, profile, col, { n = 24, uvM = 1 } = {}) {
  let v = 0;
  for (let k = 0; k + 1 < profile.length; k++) {
    const [r0, z0] = profile[k]; const [r1, z1] = profile[k + 1];
    const dv = Math.hypot(r1 - r0, z1 - z0) / uvM;
    for (let i = 0; i < n; i++) {
      const t0 = (2 * Math.PI * i) / n; const t1 = (2 * Math.PI * (i + 1)) / n;
      const c0 = Math.cos(t0); const s0 = Math.sin(t0); const c1 = Math.cos(t1); const s1 = Math.sin(t1);
      const u0 = i / n * Math.max(1, Math.round((2 * Math.PI * Math.max(r0, r1)) / uvM)); const u1 = (i + 1) / n * Math.max(1, Math.round((2 * Math.PI * Math.max(r0, r1)) / uvM));
      m.quad(mat, [cx + r0 * c0, cy + r0 * s0, z0], [cx + r0 * c1, cy + r0 * s1, z0], [cx + r1 * c1, cy + r1 * s1, z1], [cx + r1 * c0, cy + r1 * s0, z1],
        [u0, v], [u1, v], [u1, v + dv], [u0, v + dv], col);
    }
    v += dv;
  }
}

// A basin: the outer wall down past the ground, a coping over it, the inner
// wall down to a tiled floor, and the water over it.
function basin(stone, wet, ring, zLow, zTop, mat, tint, { w = RIM.w } = {}) {
  const out = insetRing(ring, -RIM.over);
  const inner = insetRing(ring, w);
  for (let i = 0; i < ring.length; i++) wallQuad(stone, mat, ring[i], ring[(i + 1) % ring.length], zLow, zTop - RIM.cope, tint, 1);
  for (let i = 0; i < out.length; i++) wallQuad(stone, mat, out[i], out[(i + 1) % out.length], zTop - RIM.cope, zTop, tint, 1);
  // (the coping's underside where it overhangs)
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    stone.quad(mat, [...out[i], zTop - RIM.cope], [...ring[i], zTop - RIM.cope], [...ring[j], zTop - RIM.cope], [...out[j], zTop - RIM.cope], [0, 0], [0, 0.05], [1, 0.05], [1, 0], tint);
  }
  flat(stone, mat, out, [inner.slice().reverse()], zTop, tint, 1);
  const zWater = zTop - WATER_BELOW_M;
  for (let i = 0; i < inner.length; i++) wallQuad(stone, mat, inner[i], inner[(i + 1) % inner.length], zWater - 0.3, zTop, tint, 1, false);
  // a tiled floor (the water is clear: the ground showed through it)
  flat(stone, 'poolTile', inner, [], zWater - 0.3, BASIN_TILE, 1.5);
  // (the water is WaterBlocks: recorded for fountainWaterBlocks; under the rim at most most of its width)
  wet.water?.(inner, zWater, w * 0.8, 0.4);
  return { zWater, inner };
}

// A baluster (a turned pedestal) of radius r from z0 to z1.
function baluster(m, cx, cy, r, z0, z1, mat, tint) {
  const h = z1 - z0;
  lathe(m, mat, cx, cy, [
    [r * 1.35, z0], [r * 1.35, z0 + h * 0.08], [r * 1.05, z0 + h * 0.12], [r * 0.7, z0 + h * 0.3],
    [r * 0.95, z0 + h * 0.55], [r * 0.6, z0 + h * 0.78], [r * 0.75, z0 + h * 0.92], [r * 1.1, z0 + h * 0.95], [r * 1.1, z1], [0.001, z1],
  ], tint, { n: 16 });
}

// A bowl of radius R whose lip is at zLip, its stem's radius rs: water in it, a curtain falling from its lip to zFall.
function bowl(stone, wet, cx, cy, R, zLip, rs, mat, tint, zFall = null) {
  lathe(stone, mat, cx, cy, [
    [rs, zLip - R * 0.45], [R * 0.55, zLip - R * 0.32], [R * 0.88, zLip - R * 0.14], [R, zLip - 0.04],
    [R, zLip + 0.04], [R - 0.06, zLip + 0.06], [R - 0.09, zLip - 0.02], [R * 0.6, zLip - R * 0.25],
  ], tint, { n: 24 });
  wet.water?.(circle(cx, cy, R - 0.08, 24), zLip - 0.03, 0.06, 0.25);
  if (zFall !== null && zFall < zLip - 0.1) {
    // (a thin sheet, its material double-sided)
    lathe(wet, 'fountainSpray', cx, cy, [[R + 0.22, zFall], [R + 0.08, zLip - 0.15], [R + 0.02, zLip + 0.02]], WHITE, { n: 24, uvM: 1.5 });
  }
}

// A jet: a column of spray from z0 rising h, its head spreading as it falls back.
function jet(wet, cx, cy, z0, h, r = 0.08) {
  const top = z0 + h;
  // (the column, its crown, the water falling back round it as a narrow plume)
  lathe(wet, 'fountainSpray', cx, cy, [
    [r, z0], [r * 0.75, top - h * 0.3], [r * 1.8, top], [Math.min(0.35, r + h * 0.07), top - h * 0.12], [Math.min(0.6, r + h * 0.12), top - h * 0.55],
  ], WHITE, { n: 10, uvM: 1.5 });
}

// A frustum box (an obelisk's shaft), centre c, half sizes h0 at z0 to h1 at z1.
function frustum(m, mat, c, h0, h1, z0, z1, tint) {
  const k = (h) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => [c[0] + sx * h, c[1] + sy * h]);
  const a = k(h0); const b = k(h1);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    m.quad(mat, [...a[i], z0], [...a[j], z0], [...b[j], z1], [...b[i], z1], [h1 - h0, z0], [h1 + h0, z0], [2 * h1, z1], [0, z1], tint);
  }
  return b;
}

/**
 * Build one fountain. stone: a builder for the stonework (both detail levels),
 * full: the full detail only (water, spray, small parts). streets: the
 * buildings' street index (a wall fountain faces the nearest street).
 */
export function buildFountain(stone, full, fo, streets = null) {
  const rnd = (...k) => hash01(fo.seed, ...k);
  const [mat, tint] = STONES[Math.floor(rnd('stone') * STONES.length)];
  const [cx, cy] = fo.centre;
  const g = fo.z1;
  const tagH = num(fo.tags.height);
  switch (fo.kind) {
    case 'tiered': case 'jets': case 'obelisk': case 'pool': {
      const zTop = g + (fo.kind === 'pool' ? RIM.poolH : RIM.h);
      const w = Math.min(RIM.w, Math.max(0.2, fo.room * 0.2));
      const { zWater, inner } = basin(stone, full, fo.ring, fo.z0 - SKIRT_M, zTop, mat, tint, { w });
      const room = Math.max(0, fo.room - w);
      if (fo.kind === 'tiered' && room >= 1.2) {
        const tiers = room >= 3.2 ? 3 : room >= 2 ? 2 : 1;
        const R1 = Math.min(2.6, room * 0.45);
        const H = Math.min(tagH || Infinity, 1.4 + tiers * 1.0);
        let z = zWater; let R = R1; const rs = Math.max(0.16, R1 * 0.14);
        const step = Math.max(0.7, (H - 0.3) / tiers);
        for (let k = 0; k < tiers; k++) {
          const zLip = z + step;
          baluster(stone, cx, cy, rs * (1 - k * 0.2), z - (k === 0 ? 0.35 : 0), zLip - R * 0.42, mat, tint);
          bowl(stone, full, cx, cy, R, zLip, rs * (1 - k * 0.2), mat, tint, z + (k === 0 ? 0 : 0.02));
          z = zLip; R *= 0.55;
        }
        // the finial and a small jet from it
        lathe(stone, mat, cx, cy, [[rs * 0.6, z - 0.05], [rs * 0.9, z + 0.25], [rs * 0.5, z + 0.45], [0.001, z + 0.55]], tint, { n: 12 });
        jet(full, cx, cy, z + 0.5, 0.5 + rnd('jet') * 0.4, 0.04);
        return 'tiered';
      }
      if (fo.kind === 'jets' && room >= 1) {
        const hMain = Math.min(tagH || Infinity, 2.5 + room * 0.6);
        lathe(stone, mat, cx, cy, [[0.35, zWater - 0.3], [0.35, zWater + 0.12], [0.001, zWater + 0.14]], tint, { n: 12 });
        jet(full, cx, cy, zWater + 0.12, hMain, 0.1);
        const n = room > 3 ? 8 : 6; const rr = room * 0.6;
        for (let i = 0; i < n; i++) {
          const a = (2 * Math.PI * i) / n;
          jet(full, cx + rr * Math.cos(a), cy + rr * Math.sin(a), zWater, hMain * 0.4, 0.05);
        }
        return 'jets';
      }
      if (fo.kind === 'obelisk' && room >= 1.1) {
        const p = Math.min(0.7, room * 0.35);
        box(stone, mat, [cx, cy], [1, 0], p, p, zWater - 0.3, zWater + 1.1, tint);
        box(stone, mat, [cx, cy], [1, 0], p + 0.08, p + 0.08, zWater + 1.1, zWater + 1.25, tint);
        const hShaft = Math.min(tagH || Infinity, 2.2 + room * 0.5);
        const top = frustum(stone, mat, [cx, cy], p * 0.55, p * 0.32, zWater + 1.25, zWater + 1.25 + hShaft, tint);
        const zt = zWater + 1.25 + hShaft;
        for (let i = 0; i < 4; i++) stone.tri(mat, [...top[i], zt], [...top[(i + 1) % 4], zt], [cx, cy, zt + p * 0.5], [0, 0], [1, 0], [0.5, 1], tint);
        // spouts on the plinth's four faces, arcs into the basin
        for (const [ux, uy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
          const sx = cx + ux * (p + 0.12); const sy = cy + uy * (p + 0.12);
          box(full, mat, [cx + ux * (p + 0.06), cy + uy * (p + 0.06)], [ux, uy], 0.08, 0.06, zWater + 0.72, zWater + 0.82, tint);
          const fx = cx + ux * (p + 0.75); const fy = cy + uy * (p + 0.75);
          const v = [-uy * 0.07, ux * 0.07];
          full.quad('fountainSpray', [sx - v[0], sy - v[1], zWater + 0.76], [sx + v[0], sy + v[1], zWater + 0.76], [fx + v[0] * 1.6, fy + v[1] * 1.6, zWater], [fx - v[0] * 1.6, fy - v[1] * 1.6, zWater],
            [0, 0], [1, 0], [1, 1], [0, 1], WHITE);
        }
        return 'obelisk';
      }
      if (fo.kind === 'pool' && String(fo.tags.fountain || '').toLowerCase().match(/nozzle|jet|spray/)) {
        // jets along the pool's long axis, through its deepest point
        let best = null;
        for (let i = 0; i < inner.length; i++) {
          const a = inner[i]; const b = inner[(i + 1) % inner.length];
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (!best || L > best.L) best = { L, u: [(b[0] - a[0]) / L, (b[1] - a[1]) / L] };
        }
        for (let s = -40; s <= 40; s += 3) {
          const x = cx + best.u[0] * s; const y = cy + best.u[1] * s;
          if (inRing(x, y, inner) && edgeDistance(x, y, inner) > 0.8) jet(full, x, y, zWater, 1.4, 0.05);
        }
      }
      return fo.kind === 'pool' ? 'pool' : 'basin';
    }
    case 'splash': {
      const pad = fo.ring;
      flat(stone, 'concrete', pad, [], g + 0.03, [0.42, 0.56, 0.68], 2);
      for (let i = 0; i < pad.length; i++) wallQuad(stone, 'concrete', pad[i], pad[(i + 1) % pad.length], fo.z0 - 0.2, g + 0.03, [0.42, 0.56, 0.68], 1);
      const r = fo.room;
      const pts = [[0, 0], ...circle(0, 0, r * 0.35, 5), ...circle(0, 0, r * 0.7, 9, 0.3)];
      for (const [dx, dy] of pts) {
        cylinder(full, 'concrete', cx + dx, cy + dy, 0.09, g + 0.03, g + 0.05, [0.25, 0.27, 0.3], { n: 8 });
        jet(full, cx + dx, cy + dy, g + 0.05, 0.5 + rnd('j', dx, dy) * 1.4, 0.04);
      }
      return 'splash';
    }
    case 'bowl': {
      const R = Math.min(0.9, (num(fo.tags.diameter) || 0.9) / 2);
      const zLip = g + Math.min(tagH || 0.85, 1.4);
      baluster(stone, cx, cy, 0.12, g - 0.2, zLip - R * 0.42, mat, tint);
      bowl(stone, full, cx, cy, R, zLip, 0.12, mat, tint);
      return 'bowl';
    }
    case 'bubbler': {
      const post = [0.42, 0.45, 0.43];
      box(stone, 'concrete', [cx, cy], [1, 0], 0.16, 0.16, g - 0.2, g + 0.82, post);
      lathe(stone, 'concrete', cx, cy, [[0.14, g + 0.8], [0.24, g + 0.9], [0.24, g + 0.95], [0.2, g + 0.95], [0.08, g + 0.89]], post, { n: 16 });
      cylinder(full, 'metalWhite', cx + 0.05, cy, 0.02, g + 0.89, g + 0.97, [0.7, 0.72, 0.74], { n: 6 });
      return 'bubbler';
    }
    case 'wall': {
      // facing the nearest street (the side of the slab a street is in front of)
      let u = [0, 1]; let bestD = Infinity;
      if (streets?.facing) {
        for (let k = 0; k < 8; k++) {
          const a = (2 * Math.PI * k) / 8; const d = [Math.cos(a), Math.sin(a)];
          // a wall a-b faces its right: a = c + left, b = c - left of the facing direction d
          const L = [-d[1], d[0]];
          const D = streets.facing([cx + L[0] * 0.9, cy + L[1] * 0.9], [cx - L[0] * 0.9, cy - L[1] * 0.9]);
          if (D !== null && D < bestD) { bestD = D; u = d; }
        }
      }
      const side = [u[1], -u[0]];
      const back = [cx - u[0] * 0.15, cy - u[1] * 0.15];
      box(stone, mat, back, side, 0.95, 0.15, g - 0.2, g + 2.3, tint);
      box(stone, mat, [back[0] + u[0] * 0.03, back[1] + u[1] * 0.03], side, 1.05, 0.2, g + 2.3, g + 2.45, tint);
      // the half-round basin in front
      const R = 0.8;
      const half = Array.from({ length: 13 }, (_, i) => {
        const a = Math.PI * (i / 12);
        return [cx + side[0] * R * Math.cos(a) + u[0] * R * Math.sin(a), cy + side[1] * R * Math.cos(a) + u[1] * R * Math.sin(a)];
      });
      const ring = signedArea(half) > 0 ? half : half.reverse();
      const { zWater } = basin(stone, full, ring, g - 0.2, g + 0.55, mat, tint, { w: 0.15 });
      // spout and its stream
      box(full, mat, [cx + u[0] * 0.08, cy + u[1] * 0.08], u, 0.12, 0.05, g + 1.2, g + 1.28, tint);
      dome(full, mat, cx + u[0] * 0.0, cy + u[1] * 0.0, 0.22, g + 1.35, tint, { n: 12, rings: 4, rise: 0.6 });
      const s0 = [cx + u[0] * 0.2, cy + u[1] * 0.2]; const s1 = [cx + u[0] * 0.45, cy + u[1] * 0.45];
      full.quad('fountainSpray', [s0[0] - side[0] * 0.04, s0[1] - side[1] * 0.04, g + 1.22], [s0[0] + side[0] * 0.04, s0[1] + side[1] * 0.04, g + 1.22],
        [s1[0] + side[0] * 0.07, s1[1] + side[1] * 0.07, zWater], [s1[0] - side[0] * 0.07, s1[1] - side[1] * 0.07, zWater], [0, 0], [1, 0], [1, 1], [0, 1], WHITE);
      return 'wall';
    }
    default: return null;
  }
}

/** The falling-water sheets (BeamNG material stage; the standing water is WaterBlocks). */
export const FOUNTAIN_MATERIAL_STAGES = {
  // (added over the scene: the texture's dark streaks clear, its white ones show)
  fountainSpray: {
    baseColorMap: '/assets/materials/tileable/water/water_effects/river_white_water_b.color.dds',
    baseColorFactor: [0.55, 0.57, 0.6, 1],
    roughnessFactor: 1,   // (a highlight made the sheets read as glass)
    metallicFactor: 0,
    animFlags: 1,
    scrollDir: [0, -0.6],
    scrollSpeed: 1.2,
  },
};

/**
 * A fountain's standing water (its basin, its bowls) as WaterBlock
 * rectangles: [{ cx, cy, sx, sy, u, z, depth }], each reaching under the rim
 * or the lip (waterCover.js). streets: as for buildFountain (a wall fountain
 * faces the same way).
 */
export function fountainWaterBlocks(fo, streets = null) {
  const out = [];
  const none = { tri() {}, quad() {} };
  const wet = { ...none, water: (ring, z, cap, depth) => { for (const b of coverRing(ring, { cap, h: Math.max(0.1, Math.min(0.3, cap * 1.5)) })) out.push({ ...b, z, depth }); } };
  buildFountain(none, wet, fo, streets);
  return out;
}
