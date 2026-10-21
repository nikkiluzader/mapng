// Raised sidewalks with curbs (plan R5), the way West Coast USA and
// BeamNG.Earth build them: no MeshRoads, but a curb-and-slab profile swept
// along each sidewalk run into one mesh per batch, textured from the shared
// `curbs` trim sheet (light band = curb top/nose, dark = face) and the
// `sidewalk1` slab sheet, colliding with its visible geometry.
//
// Runs follow the drawn carriageway's edge (generateDecalRoads exposes the
// carriageways) and are cut where they would cross another road or a
// crosswalk, so curbs end cleanly at junctions. Profile numbers are
// BeamNG.Earth's (server/sidewalks.py), measured on official US curbs.

import * as THREE from 'three';
import { buildCarriagewayIndex, cutNodes, isInZone, isOnOtherCarriageway } from './roadMarkingCuts.js';

const CURB_H = 0.15;          // m above the road
const SINK = 0.10;            // m the faces reach below the road
const BATTER = 0.02;          // m the face leans back over its height
const NOSE = 0.025;           // bevelled nose: down from the top ...
const NOSE_W = 0.045;         // ... and in from the face
const CURB_W = 0.15;          // m of curb top band
const CROSS_SLOPE = 0.015;    // slab rises away from the road
const BACK_SLOPE_RUN = 2.0;   // back falls to the ground at 1:2, no wheel-catching ledge
const CURB_REPEAT_M = 9.0;    // m of curb per texture width
const SLAB_REPEAT_M = 45.0;   // m of sidewalk per texture width
const DEFAULT_WIDTH_M = 2.0;
const MAX_WIDTH_M = 6.0;
const CUT_MARGIN_M = 0.5;     // runs stop this far outside other carriageways
const MIN_RUN_M = 4;
const RUNS_PER_MESH = 300;

// curbs sheet (1024 × 512, 8 bands of 64 px, v up): band 0, light rows 0–40.
const V_BAND_TOP = 1 - 1 / 512;
const V_LIGHT_LOW = 1 - 40 / 512;
const V_BAND_LOW = 1 - 63 / 512;
// sidewalk1 sheet: its top strip across the slab.
const V_SLAB_IN = 1 - 0.195;
const V_SLAB_OUT = 1 - 0.005;

export const SIDEWALK_MATERIALS = { curb: 'mapng_curbs', slab: 'mapng_sidewalk' };

/** Material definitions (shared /assets textures; West Coast USA's settings). */
export function getSidewalkMaterialDefs() {
  const CURBS = '/assets/materials/trim/concrete/curbs';
  const SLAB = '/assets/materials/tileable/concrete/sidewalk1';
  const def = (name, stage) => ({
    name, mapTo: name, class: 'Material', version: 1.5, annotation: 'SIDEWALK',
    groundType: 'CONCRETE', Stages: [stage, {}, {}, {}], translucentBlendOp: 'None',
  });
  return {
    [SIDEWALK_MATERIALS.curb]: def(SIDEWALK_MATERIALS.curb, {
      ambientOcclusionMap: `${CURBS}/t_curbs_ao.data.png`,
      baseColorMap: `${CURBS}/t_curbs_b.color.png`,
      normalMap: `${CURBS}/t_curbs_nm.normal.png`,
      roughnessMap: `${CURBS}/t_curbs_r.data.png`,
      pixelSpecular: true,
    }),
    [SIDEWALK_MATERIALS.slab]: def(SIDEWALK_MATERIALS.slab, {
      ambientOcclusionMap: `${SLAB}/t_sidewalk1_ao.data.png`,
      baseColorFactor: [0.745, 0.745, 0.745, 1],
      baseColorMap: `${SLAB}/t_sidewalk1_b.color.png`,
      metallicFactor: 0.7,
      metallicMap: `${SLAB}/t_sidewalk1_m.data.png`,
      normalMap: `${SLAB}/t_sidewalk1_nm.normal.png`,
      normalMapStrength: 1.2,
      roughnessMap: `${SLAB}/t_sidewalk1_r.data.png`,
      pixelSpecular: true,
    }),
  };
}

const norm = (value) => String(value ?? '').trim().toLowerCase();
const SIDEWALK_CLASSES = new Set(['residential', 'tertiary', 'secondary', 'primary', 'unclassified', 'living_street']);
const PRESENT = new Set(['yes', 'both', 'left', 'right']);
const ABSENT = new Set(['no', 'none', 'separate']);

const parseWidth = (value) => {
  const w = Number.parseFloat(value);
  return Number.isFinite(w) && w > 0.5 ? Math.min(w, MAX_WIDTH_M) : null;
};

/**
 * Sidewalk width on each side of a carriageway (left/right of node order),
 * 0 for none. OSM sidewalk tags first; untagged urban streets of the usual
 * classes get both sides (BeamNG.Earth). `separate` means it is mapped as its
 * own footway (drawn on the terrain), so no raised sidewalk here.
 */
export function sidewalkSides({ tags = {}, highway, urban }) {
  const width = (side) => parseWidth(tags[`sidewalk:${side}:width`]) ?? parseWidth(tags['sidewalk:both:width'])
    ?? parseWidth(tags['sidewalk:width']) ?? DEFAULT_WIDTH_M;
  const general = norm(tags.sidewalk);
  const both = norm(tags['sidewalk:both']);
  const sideTag = (side) => norm(tags[`sidewalk:${side}`]);
  const has = (side) => {
    const own = sideTag(side);
    if (PRESENT.has(own)) return true;
    if (ABSENT.has(own)) return false;
    if (PRESENT.has(both)) return true;
    if (ABSENT.has(both)) return false;
    if (general === 'both' || general === 'yes') return true;
    if (general === side) return true;
    if (general === 'left' || general === 'right' || ABSENT.has(general)) return false;
    return !!urban && SIDEWALK_CLASSES.has(String(highway ?? ''));
  };
  return { left: has('left') ? width('left') : 0, right: has('right') ? width('right') : 0 };
}

// Curb line `offset` m to the left of the centreline (mitred, z kept).
function offsetLine(nodes, offset) {
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[Math.max(0, i - 1)];
    const b = nodes[Math.min(nodes.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    out.push([nodes[i][0] - ((b[1] - a[1]) / len) * offset, nodes[i][1] + ((b[0] - a[0]) / len) * offset, nodes[i][2], 0]);
  }
  return out;
}

/**
 * Sidewalk runs: [{ points: [[x,y,z]...], side: ±1, width, owner }] where side +1
 * is left of the run's direction (the sidewalk lies on that side of the curb)
 * and owner is the carriageway's.
 */
export function buildSidewalkRuns(carriageways, { zones = [] } = {}) {
  const index = buildCarriagewayIndex(carriageways);
  const runs = [];
  for (const cw of carriageways) {
    const sides = sidewalkSides(cw);
    const ignore = new Set([cw.owner, ...(cw.continuations || [])]);
    const blocked = (x, y) => isOnOtherCarriageway(index, x, y, CUT_MARGIN_M, (o) => ignore.has(o)) || isInZone(zones, x, y);
    for (const [side, width] of [[1, sides.left], [-1, sides.right]]) {
      if (!width) continue;
      for (const piece of cutNodes(offsetLine(cw.nodes, side * cw.half), blocked, { minPieceM: MIN_RUN_M })) {
        runs.push({ points: piece.map((n) => [n[0], n[1], n[2]]), side, width, owner: cw.owner });
      }
    }
  }
  return runs;
}

// Profile across from the curb line: [outward offset, height] and material.
function profileFor(width) {
  const slabOut = CURB_H + width * CROSS_SLOPE;
  const back = width + BACK_SLOPE_RUN * (slabOut + SINK);
  return {
    points: [[0, -SINK], [BATTER, CURB_H - NOSE], [NOSE_W, CURB_H], [CURB_W, CURB_H], [width, slabOut], [back, -SINK]],
    // segment k joins points k and k+1
    segments: [
      { mat: 'curb', v: [V_BAND_LOW, V_LIGHT_LOW] },   // face
      { mat: 'curb', v: [V_LIGHT_LOW, V_BAND_TOP] },   // nose
      { mat: 'curb', v: [V_LIGHT_LOW, V_BAND_TOP] },   // top
      { mat: 'slab', v: [V_SLAB_IN, V_SLAB_OUT] },     // slab
      { mat: 'curb', v: [V_BAND_LOW, V_LIGHT_LOW] },   // back
    ],
  };
}

class PartBuilder {
  constructor() { this.parts = { curb: { pos: [], uv: [] }, slab: { pos: [], uv: [] } }; this.triangles = 0; }

  // Triangle a-b-c turned so its normal points along `want`.
  tri(mat, a, b, c, ua, ub, uc, want) {
    const n = [
      (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
      (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
    ];
    const flip = n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0;
    const p = this.parts[mat];
    for (const [v, u] of flip ? [[a, ua], [c, uc], [b, ub]] : [[a, ua], [b, ub], [c, uc]]) {
      p.pos.push(v[0], v[1], v[2]);
      p.uv.push(u[0], u[1]);
    }
    this.triangles++;
  }

  toMesh(name) {
    let total = 0;
    for (const p of Object.values(this.parts)) total += p.pos.length / 3;
    if (total === 0) return null;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    const materials = [];
    let start = 0;
    for (const [key, p] of Object.entries(this.parts)) {
      const count = p.pos.length / 3;
      if (count === 0) continue;
      pos.set(p.pos, start * 3);
      uv.set(p.uv, start * 2);
      geo.addGroup(start, count, materials.length);
      materials.push(new THREE.MeshStandardMaterial({ name: SIDEWALK_MATERIALS[key] }));
      start += count;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, materials);
    mesh.name = name;
    return mesh;
  }
}

function sweepRun(builder, run) {
  const { points, side, width } = run;
  const profile = profileFor(width);
  // Outward unit normal at each station (mitred, the sidewalk's side).
  const outward = points.map((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-((b[1] - a[1]) / len) * side, ((b[0] - a[0]) / len) * side];
  });
  const stations = points.map((p, i) => profile.points.map(([o, h]) => [p[0] + outward[i][0] * o, p[1] + outward[i][1] * o, p[2] + h]));
  let along = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const step = Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
    const s0 = along;
    const s1 = along + step;
    along = s1;
    const out = [(outward[i][0] + outward[i + 1][0]) / 2, (outward[i][1] + outward[i + 1][1]) / 2];
    profile.segments.forEach((seg, k) => {
      const [o0, h0] = profile.points[k];
      const [o1, h1] = profile.points[k + 1];
      // Front of this profile segment: (−dh)·outward + (do)·up.
      const want = [-(h1 - h0) * out[0], -(h1 - h0) * out[1], o1 - o0];
      const repeat = seg.mat === 'slab' ? SLAB_REPEAT_M : CURB_REPEAT_M;
      const u0 = s0 / repeat;
      const u1 = s1 / repeat;
      const a0 = stations[i][k]; const b0 = stations[i][k + 1];
      const a1 = stations[i + 1][k]; const b1 = stations[i + 1][k + 1];
      const [va, vb] = seg.v;
      builder.tri(seg.mat, a0, a1, b1, [u0, va], [u1, va], [u1, vb], want);
      builder.tri(seg.mat, a0, b1, b0, [u0, va], [u1, vb], [u0, vb], want);
    });
  }
  // End caps: fan over the profile, facing away from the run.
  for (const [i, j] of [[0, 1], [points.length - 1, points.length - 2]]) {
    const dir = [points[i][0] - points[j][0], points[i][1] - points[j][1], 0];
    const ring = stations[i];
    for (let k = 1; k + 1 < ring.length; k++) {
      builder.tri('curb', ring[0], ring[k], ring[k + 1], [0, V_BAND_LOW], [0.02, V_LIGHT_LOW], [0.04, V_LIGHT_LOW], dir);
    }
  }
}

/**
 * Sidewalk meshes for the drawn carriageways: { meshes (THREE, world space),
 * runs, triangles }. Batches of RUNS_PER_MESH runs; names use letters (BeamNG
 * reads trailing digits of a Collada node name as a detail level).
 */
export function buildSidewalkMeshes(carriageways, options = {}) {
  const runs = buildSidewalkRuns(carriageways, options);
  const meshes = [];
  let builder = new PartBuilder();
  let inBatch = 0;
  let triangles = 0;
  const letters = (n) => { let s = ''; let k = n; do { s = String.fromCharCode(97 + (k % 26)) + s; k = Math.floor(k / 26) - 1; } while (k >= 0); return s; };
  const flush = () => {
    triangles += builder.triangles;
    const mesh = builder.toMesh(`sidewalks_${letters(meshes.length)}`);
    if (mesh) meshes.push(mesh);
    builder = new PartBuilder();
    inBatch = 0;
  };
  for (const run of runs) {
    if (run.points.length < 2) continue;
    sweepRun(builder, run);
    if (++inBatch >= RUNS_PER_MESH) flush();
  }
  flush();
  return { meshes, runs, triangles };
}
