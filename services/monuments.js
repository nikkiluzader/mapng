// Monuments the game has no model for, built as plain meshes: an obelisk (a tapering shaft with a pointed top on a
// stepped plinth), a stele (an upright slab on a low base) and a memorial stone (a rough block). Nothing here knows
// about any place: the kind comes from memorial=* / man_made=obelisk, the height from height=* within limits.

import * as THREE from 'three';
import { PLAZA_MATERIAL, plazaTileM } from './plazas.js';

const KINDS = { obelisk: { h: 6, min: 2, max: 40 }, stele: { h: 1.8, min: 0.8, max: 6 }, stone: { h: 1.1, min: 0.4, max: 3 } };

/** A feature's monument kind ('obelisk' | 'stele' | 'stone') or null. */
export function monumentKind(tags = {}) {
  if (tags.man_made === 'obelisk' || tags.memorial === 'obelisk' || tags['monument'] === 'obelisk') return 'obelisk';
  if (tags.historic !== 'memorial' && tags.historic !== 'monument') return null;
  if (tags.memorial === 'stele') return 'stele';
  if (tags.memorial === 'stone' || tags.memorial === 'stolperstein_group') return 'stone';
  return null;
}

/** Its height: height=* where given and sensible for its kind, else the kind's usual one. */
export function monumentHeight(kind, tags = {}) {
  const k = KINDS[kind]; const h = Number.parseFloat(tags.height);
  return Number.isFinite(h) && h >= k.min && h <= k.max ? h : k.h;
}

// a box of corners [x, y, z] (bottom ring then top ring, each counter-clockwise) as outward triangles
function prism(out, bottom, top, withTop = true) {
  const n = bottom.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    out.push([bottom[i], bottom[j], top[j]], [bottom[i], top[j], top[i]]);
  }
  if (withTop) for (let i = 1; i + 1 < n; i++) out.push([top[0], top[i], top[i + 1]]);
}
const ring = (cx, cy, z, hx, hy, yaw) => {
  const c = Math.cos(yaw); const s = Math.sin(yaw);
  return [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([a, b]) => [cx + a * c - b * s, cy + a * s + b * c, z]);
};

/** One monument's triangles: [[A, B, C]...], world coordinates, its foot at z (sunk 0.3 m so a slope shows no gap). */
export function monumentTriangles({ x, y, z, kind, height, yaw = 0 }) {
  const t = []; const foot = z - 0.3;
  if (kind === 'obelisk') {
    const w = Math.max(0.5, height / 10);
    // a plinth of two steps, the shaft tapering to 70 %, a pyramid top a shaft's width high
    const s1 = w * 1.6; const s2 = w * 1.25; const step = Math.max(0.25, w * 0.35);
    prism(t, ring(x, y, foot, s1, s1, yaw), ring(x, y, z + step, s1, s1, yaw));
    prism(t, ring(x, y, z + step, s2, s2, yaw), ring(x, y, z + step * 2, s2, s2, yaw));
    const shaftTop = z + height - w;
    const top = ring(x, y, shaftTop, w * 0.35, w * 0.35, yaw);
    prism(t, ring(x, y, z + step * 2, w / 2, w / 2, yaw), top, false);
    const apex = [x, y, z + height];
    for (let i = 0; i < 4; i++) t.push([top[i], top[(i + 1) % 4], apex]);
  } else if (kind === 'stele') {
    const wide = Math.max(0.6, height * 0.5); const thick = Math.max(0.18, height * 0.12);
    prism(t, ring(x, y, foot, wide / 2 + 0.15, thick / 2 + 0.15, yaw), ring(x, y, z + 0.15, wide / 2 + 0.15, thick / 2 + 0.15, yaw));
    prism(t, ring(x, y, z + 0.15, wide / 2, thick / 2, yaw), ring(x, y, z + height, wide / 2 * 0.94, thick / 2 * 0.9, yaw));
  } else {
    // a rough block: wider than high, its top a little smaller and leaning
    const wide = height * 1.2; const deep = height * 0.7;
    const b = ring(x, y, foot, wide / 2, deep / 2, yaw);
    const tp = ring(x + 0.04 * height, y, z + height, wide / 2 * 0.8, deep / 2 * 0.75, yaw + 0.08);
    prism(t, b, tp);
  }
  return t;
}

/** The monuments' mesh (concrete). items: [{ x, y, z, kind, height, yaw }]. Returns { meshes, count, triangles }. */
export function buildMonumentMeshes(items, opts = {}) {
  const set = opts.set || 'concrete'; const tile = plazaTileM(set);
  const pos = []; const uv = []; let triangles = 0;
  for (const m of items) {
    for (const [A, B, C] of monumentTriangles(m)) {
      // (each face mapped on its own plane: its long side along u)
      const nx = (B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]);
      const ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
      const nz = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
      const ax = Math.abs(nx); const ay = Math.abs(ny); const az = Math.abs(nz);
      for (const v of [A, B, C]) {
        pos.push(v[0], v[1], v[2]);
        if (az >= ax && az >= ay) uv.push(v[0] / tile, v[1] / tile);
        else if (ax >= ay) uv.push(v[1] / tile, v[2] / tile);
        else uv.push(v[0] / tile, v[2] / tile);
      }
      triangles++;
    }
  }
  if (!pos.length) return { meshes: [], count: 0, triangles: 0 };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: PLAZA_MATERIAL(set) }));
  mesh.name = `monuments_${set}`;
  return { meshes: [mesh], count: items.length, triangles };
}
