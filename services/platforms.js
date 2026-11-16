// Railway platforms (railway=platform): a raised slab beside the track, paved on top, concrete down its sides. A
// mapped area is its outline; a line is its edge or middle, given its width (width=*, else 3 m). Its top stands a
// platform's height over the nearest track's own height (the track's solved profile, railTrack.js), or over the
// ground where no track runs near (a tram stop's platform beside a street). Nothing here knows about any place.

import * as THREE from 'three';
import { PLAZA_MATERIAL, plazaTileM } from './plazas.js';
import { drapedMesh } from './sportsFields.js';

export const PLATFORM_OVER_RAIL_M = 0.55;     // a main line's platform over the rails (0.55 m: the common European height)
export const PLATFORM_OVER_GROUND_M = 0.3;    // with no track near: a tram or bus platform's kerb
const TRACK_NEAR_M = 9;                       // a track this near is the platform's
const SIDE_BELOW_M = 0.4;                     // the sides run this far below the ground (no gap on a slope)
const DEFAULT_WIDTH_M = 3;
const ELEVATED_M = 2.5;                       // a top this far over the ground: an elevated station's
const SLAB_M = 1.0;

const closedRing = (g) => g.length > 3 && g[0][0] === g[g.length - 1][0] && g[0][1] === g[g.length - 1][1];

/** A line buffered to a ring `width` wide (its middle on the line). */
export function bufferLine(pts, width) {
  const h = width / 2; const left = []; const right = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0]; const dy = b[1] - a[1]; const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L; const ny = dx / L;
    left.push([pts[i][0] + nx * h, pts[i][1] + ny * h]); right.push([pts[i][0] - nx * h, pts[i][1] - ny * h]);
  }
  return [...left, ...right.reverse()];
}

/**
 * The platforms' meshes. platforms: [{ points: [[x, y]...] (closed for an area), width }]; groundAt(x, y);
 * tracks: [{ points: [[x, y]...], z: [...] }] (each point's track height); a platform's `over`: a set height over
 * the ground instead (a kerbed island). opts.topSet / sideSet / name: the paving sets and the meshes' name. Returns
 * { meshes, count, triangles }.
 */
export function buildPlatformMeshes(platforms, opts = {}) {
  const { groundAt, tracks = [] } = opts;
  const top = { pos: [], uv: [] }; const side = { pos: [], uv: [] };
  const topSet = opts.topSet || 'pavers'; const sideSet = opts.sideSet || 'concrete'; const name = opts.name || 'platforms';
  let count = 0; let triangles = 0;
  const trackZ = (x, y) => {
    let best = null; let bd = TRACK_NEAR_M;
    for (const t of tracks) {
      const p = t.points;
      for (let i = 0; i + 1 < p.length; i++) {
        const vx = p[i + 1][0] - p[i][0]; const vy = p[i + 1][1] - p[i][1]; const L = vx * vx + vy * vy || 1e-9;
        const u = Math.max(0, Math.min(1, ((x - p[i][0]) * vx + (y - p[i][1]) * vy) / L));
        const d = Math.hypot(p[i][0] + vx * u - x, p[i][1] + vy * u - y);
        if (d < bd && Number.isFinite(t.z?.[i]) && Number.isFinite(t.z?.[i + 1])) { bd = d; best = t.z[i] + (t.z[i + 1] - t.z[i]) * u; }
      }
    }
    return best;
  };
  const tTop = plazaTileM(topSet); const tSide = plazaTileM(sideSet);
  for (const pl of platforms) {
    let ring = pl.points;
    if (!(ring?.length >= 2)) continue;
    // (pl.strip: a band along the line, closed or not: a kerb round an island, its inside left to the ground)
    ring = closedRing(ring) && !pl.strip ? ring.slice(0, -1) : bufferLine(ring, pl.width > 0 ? Math.min(pl.width, 20) : DEFAULT_WIDTH_M);
    if (ring.length < 3) continue;
    // (counter-clockwise, so the top faces up and the sides face out)
    let a2 = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a2 += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
    if (a2 > 0) ring = ring.slice().reverse();
    // its top: over the nearest track where one runs near, else over the ground; never under the ground
    const tz = ring.map(([x, y]) => trackZ(x, y));
    const anyTrack = !Number.isFinite(pl.over) && tz.some((z) => z !== null);
    const g = ring.map(([x, y]) => groundAt(x, y));
    const z = ring.map((_, i) => {
      if (Number.isFinite(pl.over)) return g[i] + pl.over;   // (a set height over the ground: a kerbed island)
      if (anyTrack) { const t = tz[i] ?? tz.find((v) => v !== null); return Math.max(g[i] + 0.1, t + PLATFORM_OVER_RAIL_M); }
      return g[i] + PLATFORM_OVER_GROUND_M;
    });
    // (a slab at a set height over the ground, with the terrain's drape given: its top laid on the terrain's own
    // triangles, that height over it everywhere. Its corners alone set it once: the long thin triangles of a splitter
    // island ran corner to corner across a road's crown and fall, and its top folded along them)
    if (Number.isFinite(pl.over) && opts.drape) {
      let ok = true;
      try {
        drapedMesh({ tri: (_m, A, B, C) => { for (const v of [A, B, C]) { top.pos.push(v[0], v[1], v[2] + pl.over); top.uv.push(v[0] / tTop, v[1] / tTop); } triangles++; } },
          topSet, ring, [], opts.drape.drapeAt, () => null, opts.drape.grid);
      } catch { ok = false; }
      if (!ok) continue;
      for (let i = 0; i < ring.length; i++) z[i] = opts.drape.drapeAt(ring[i][0], ring[i][1]) + pl.over;
    } else {
      let tris;
      try { tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, y]) => new THREE.Vector2(x, y)), []); } catch { continue; }
      if (!tris.length) continue;
      for (const [i, j, k] of tris) {
        for (const n of [i, j, k]) { top.pos.push(ring[n][0], ring[n][1], z[n]); top.uv.push(ring[n][0] / tTop, ring[n][1] / tTop); }
        triangles++;
      }
    }
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      const [x0, y0] = ring[i]; const [x1, y1] = ring[j];
      const L = Math.hypot(x1 - x0, y1 - y0);
      // (an elevated station's platform, high over the ground with its track: a slab a metre deep, no wall to the street)
      const bottom = (k) => (z[k] - g[k] > ELEVATED_M ? z[k] - SLAB_M : g[k] - SIDE_BELOW_M);
      const b0 = bottom(i); const b1 = bottom(j);
      // (two triangles, outward: the ring runs counter-clockwise)
      const quad = [[x0, y0, b0, 0, b0], [x1, y1, b1, L, b1], [x1, y1, z[j], L, z[j]], [x0, y0, b0, 0, b0], [x1, y1, z[j], L, z[j]], [x0, y0, z[i], 0, z[i]]];
      for (const [x, y, zz, u, v] of quad) { side.pos.push(x, y, zz); side.uv.push(u / tSide, v / tSide); }
      triangles += 2;
    }
    count++;
  }
  const meshes = [];
  for (const [set, p] of (topSet === sideSet ? [[topSet, { pos: [...top.pos, ...side.pos], uv: [...top.uv, ...side.uv] }]] : [[topSet, top], [sideSet, side]])) {
    if (!p.pos.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p.pos), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.uv), 2));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: PLAZA_MATERIAL(set) }));
    mesh.name = `${name}_${set}`;
    meshes.push(mesh);
  }
  return { meshes, count, triangles };
}
