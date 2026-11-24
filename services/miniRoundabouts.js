// Mini roundabouts (OSM highway=mini_roundabout on a junction node): the white painted centre, flush with the road at
// its rim and domed a few centimetres in the middle, so a car can drive over it (as the real ones are). Its size is the
// mapped diameter=* within limits, else 4 m (UK mini roundabouts are 1-4 m across). The give-way paint round it is
// left to the junction's own markings. Nothing here knows about any place.

import * as THREE from 'three';
import { SIDEWALK_MATERIALS } from './beamngSidewalks.js';

export const MINI_ROUNDABOUT_DIAMETER_M = 4;
const DIAMETER_RANGE_M = [1, 6];
export const MINI_ROUNDABOUT_DOME_M = 0.08;
const LIFT_M = 0.012;    // the rim just over the road surface, under the decals' own lift
const SEGMENTS = 32; const RINGS = 5;

/** Its diameter: diameter=* (metres) where given and sensible, else the usual 4 m. */
export function miniRoundaboutDiameter(tags = {}) {
  const d = Number.parseFloat(String(tags.diameter ?? '').replace(/m$/, ''));
  return Number.isFinite(d) && d >= DIAMETER_RANGE_M[0] && d <= DIAMETER_RANGE_M[1] ? d : MINI_ROUNDABOUT_DIAMETER_M;
}

/** One mini roundabout's triangles: [[A, B, C]...] in world coordinates, the road surface at z. */
export function miniRoundaboutTriangles({ x, y, z, diameter = MINI_ROUNDABOUT_DIAMETER_M }) {
  const R = diameter / 2; const out = [];
  const at = (k, j) => {
    const r = (R * k) / RINGS; const a = (j / SEGMENTS) * 2 * Math.PI;
    return [x + r * Math.cos(a), y + r * Math.sin(a), z + LIFT_M + MINI_ROUNDABOUT_DOME_M * (1 - (r / R) ** 2)];
  };
  const top = [x, y, z + LIFT_M + MINI_ROUNDABOUT_DOME_M];
  for (let j = 0; j < SEGMENTS; j++) out.push([top, at(1, j), at(1, j + 1)]);
  for (let k = 1; k < RINGS; k++) for (let j = 0; j < SEGMENTS; j++) {
    const a = at(k, j); const b = at(k + 1, j); const c = at(k + 1, j + 1); const d = at(k, j + 1);
    out.push([a, b, c], [a, c, d]);
  }
  return out;
}

/** The meshes for all of them (one, the white paint), for the sidewalk tiles. */
export function buildMiniRoundaboutMeshes(items) {
  const pos = []; const uv = []; let triangles = 0;
  for (const m of items) for (const tri of miniRoundaboutTriangles(m)) { for (const v of tri) { pos.push(v[0], v[1], v[2]); uv.push(v[0] / 4, v[1] / 4); } triangles++; }
  if (!pos.length) return { meshes: [], count: 0, triangles: 0 };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: SIDEWALK_MATERIALS.paint }));
  mesh.name = 'mini_roundabouts';
  return { meshes: [mesh], count: items.length, triangles };
}
