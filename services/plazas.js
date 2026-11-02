// Pedestrian squares (highway=pedestrian + area=yes, area:highway=pedestrian):
// paved surfaces lying on the terrain, in the stone or brick the square is
// mapped in (surface=*), concrete pavers when untagged: a square is a laid,
// decorated surface, not a road's asphalt. Cut round the buildings standing
// in it and the roads crossing it, and draped on the terrain's own triangles
// (sportsFields.drapedMesh) a few centimetres over it.

import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { drapedMesh } from './sportsFields.js';

const PLAZA_LIFT_M = 0.04;     // over the ground (the drape lies on its triangles)
const PLAZA_MIN_M2 = 12;
const PLAZA_MAX_M2 = 60000;    // a whole district mapped as one square: left to the terrain's paint
const ROAD_CLEAR_M = 0.2;      // past a crossing road's paved edge

// mesh materials over the same shared tileable textures the paved streets'
// decals use (exportBeamNGLevel PAVING_MATERIALS); tileM: metres per repeat
const SETS = {
  bricks: {
    tileM: 1.4,
    stage: {
      ambientOcclusionMap: '/assets/materials/tileable/brick/t_bricks_herringbone_01/t_bricks_herringbone_01_ao.data.png',
      baseColorMap: '/assets/materials/tileable/brick/t_bricks_herringbone_01/t_bricks_herringbone_01_b.color.png',
      normalMap: '/assets/materials/tileable/brick/t_bricks_herringbone_01/t_bricks_herringbone_01_nm.normal.png',
      roughnessMap: '/assets/materials/tileable/brick/t_bricks_herringbone_01/t_bricks_herringbone_01_r.data.png',
    },
  },
  pavers: {
    tileM: 1.0,
    legacy: true,
    stage: {
      colorMap: '/assets/materials/tileable/tile/italy_bld_hpaver/italy_hpaver_d.dds',
      normalMap: '/assets/materials/tileable/tile/italy_bld_hpaver/italy_hpaver_n.dds',
      specularMap: '/assets/materials/tileable/tile/italy_bld_hpaver/italy_hpaver_s.dds',
      specularPower: 19,
    },
  },
  sett: {
    tileM: 1.0,
    legacy: true,
    stage: {
      colorMap: '/assets/materials/tileable/paving/t_italy_cobblestone/t_italy_cobblestone_d.color.png',
      normalMap: '/assets/materials/tileable/paving/t_italy_cobblestone/t_italy_cobblestone_n.normal.png',
      specularMap: '/assets/materials/tileable/paving/t_italy_cobblestone/t_italy_cobblestone_s.color.png',
    },
  },
  cobble: {
    tileM: 1.4,
    legacy: true,
    stage: {
      colorMap: '/assets/materials/tileable/tile/si_cobblestone/si_cobblestone_d.dds',
      normalMap: '/assets/materials/tileable/tile/si_cobblestone/si_cobblestone_n.dds',
      specularMap: '/assets/materials/tileable/tile/si_cobblestone/si_cobblestone_s.dds',
    },
  },
  concrete: {
    tileM: 10,
    stage: {
      ambientOcclusionMap: '/assets/materials/tileable/concrete/sidewalk1/t_sidewalk1_ao.data.png',
      baseColorFactor: [0.745, 0.745, 0.745, 1],
      baseColorMap: '/assets/materials/tileable/concrete/sidewalk1/t_sidewalk1_b.color.png',
      normalMap: '/assets/materials/tileable/concrete/sidewalk1/t_sidewalk1_nm.normal.png',
      roughnessMap: '/assets/materials/tileable/concrete/sidewalk1/t_sidewalk1_r.data.png',
    },
    groundType: 'CONCRETE',
  },
  asphalt: {
    tileM: 8,
    stage: {
      ambientOcclusionMap: '/assets/materials/tileable/road/road_asphalt_light/t_road_asphalt1_ao.data.png',
      baseColorMap: '/assets/materials/decalroad/asphalt/road_rubber_sticky/t_road_asphalt1_b.color.png',
      normalMap: '/assets/materials/tileable/road/road_asphalt_light/t_road_asphalt1_nm.normal.png',
      roughnessMap: '/assets/materials/decalroad/asphalt/road_rubber_sticky/t_asphalt1_r.data.png',
    },
    groundType: 'ASPHALT',
  },
};
export const PLAZA_MATERIAL = (set) => `mapng_plaza_${set}`;

/** The material definitions, for the sidewalks' materials file. */
export function getPlazaMaterialDefs() {
  const out = {};
  for (const [set, def] of Object.entries(SETS)) {
    const name = PLAZA_MATERIAL(set);
    out[name] = {
      name, mapTo: name, class: 'Material', annotation: 'SIDEWALK', groundType: def.groundType || 'COBBLESTONE',
      Stages: [{ ...def.stage, ...(def.legacy ? { useAnisotropic: true } : {}) }, {}, {}, {}],
      translucentBlendOp: 'None',
      ...(def.legacy ? {} : { version: 1.5 }),
    };
  }
  return out;
}

/**
 * The surface set (SETS key) a square is paved in: its surface=* (stone,
 * brick, concrete, asphalt), concrete pavers when untagged or unknown.
 */
export function plazaSurface(surface) {
  const s = String(surface ?? '').trim().toLowerCase();
  if (s === 'sett' || s === 'cobblestone' || s === 'cobblestone:flattened' || s === 'stone') return 'sett';
  if (s === 'unhewn_cobblestone' || s === 'pebblestone') return 'cobble';
  if (s === 'bricks' || s === 'brick' || s === 'clay') return 'bricks';
  if (s === 'concrete' || s === 'concrete:plates' || s === 'concrete:lanes') return 'concrete';
  if (s === 'asphalt' || s === 'paved' || s === 'chipseal') return 'asphalt';
  return 'pavers';
}

/** Metres one repeat of a surface set's texture covers. */
export const plazaTileM = (set) => SETS[set]?.tileM ?? 1;

/** The stone or brick set a walk's surface=* is laid in, or null (concrete, asphalt, untagged: the plain slab). */
export function pavedWalkSurface(surface, { americas = false } = {}) {
  const s = String(surface ?? '').trim().toLowerCase();
  if (!s) return null;
  // (as the paved streets' decals: paving stones in the Americas are red brick)
  if (s === 'paving_stones' || s.startsWith('paving_stones:')) return americas ? 'bricks' : 'pavers';
  const set = plazaSurface(s);
  return set === 'pavers' || set === 'concrete' || set === 'asphalt' ? null : set;
}

/** Is this OSM feature a pedestrian square? */
export function isPlaza(f) {
  const t = f?.tags || {};
  if (!(f?.geometry?.length >= 4)) return false;
  if (t['area:highway'] === 'pedestrian') return true;
  return t.highway === 'pedestrian' && t.area === 'yes' && (!t.layer || t.layer === '0') && !t.bridge && !t.tunnel && t.indoor !== 'yes';
}

const area2 = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i]; const q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const boxOf = (r) => [Math.min(...r.map((p) => p[0])), Math.min(...r.map((p) => p[1])), Math.max(...r.map((p) => p[0])), Math.max(...r.map((p) => p[1]))];
const overlaps = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
const open = (r) => { const out = r.map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]); const a = out[0]; const b = out[out.length - 1]; if (a[0] === b[0] && a[1] === b[1]) out.pop(); return out; };
const close = (r) => [...r, r[0]];

/**
 * The squares' meshes: plazas [{ ring: [[x, y]...], surface }] (world), cut
 * round `buildings` (rings) and `roads` ([{ nodes: [[x, y]...], half }]),
 * draped by drape = { drapeAt, grid }. Returns { meshes, count, triangles }.
 */
export function buildPlazaMeshes(plazas, { drape, buildings = [], roads = [] } = {}) {
  const parts = {};
  let triangles = 0;
  let count = 0;
  const builder = {
    tri(mat, a, b, c) {
      const p = parts[mat] || (parts[mat] = { pos: [], uv: [] });
      const { tileM } = SETS[mat];
      for (const v of [a, b, c]) {
        p.pos.push(v[0], v[1], v[2] + PLAZA_LIFT_M);
        p.uv.push(v[0] / tileM, v[1] / tileM);
      }
      triangles++;
    },
  };
  const buildingBoxes = buildings.map((r) => ({ r, box: boxOf(r) }));
  const roadQuads = [];
  for (const { nodes, half } of roads) {
    for (let i = 0; i + 1 < nodes.length; i++) {
      const a = nodes[i]; const b = nodes[i + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.01) continue;
      const h = half + ROAD_CLEAR_M;
      const ux = (b[0] - a[0]) / L; const uy = (b[1] - a[1]) / L;
      const nx = -uy * h; const ny = ux * h;
      // (a little past each end: no sliver left between segments at a bend)
      const ex = ux * 0.3; const ey = uy * 0.3;
      const q = [[a[0] - ex + nx, a[1] - ey + ny], [b[0] + ex + nx, b[1] + ey + ny], [b[0] + ex - nx, b[1] + ey - ny], [a[0] - ex - nx, a[1] - ey - ny]];
      roadQuads.push({ r: q, box: boxOf(q) });
    }
  }
  for (const plaza of plazas) {
    const ring = open(plaza.ring);
    const a = Math.abs(area2(ring));
    if (ring.length < 3 || a < PLAZA_MIN_M2 || a > PLAZA_MAX_M2) continue;
    const box = boxOf(ring);
    const cuts = [...buildingBoxes, ...roadQuads].filter((c) => overlaps(c.box, box)).map((c) => [close(open(c.r))]);
    let shape = [[close(ring)]];
    try {
      if (cuts.length) shape = polygonClipping.difference(shape, ...cuts);
    } catch (err) {
      console.warn('Plazas: could not cut a square round its buildings and roads:', err?.message);
      continue;
    }
    const set = SETS[plaza.surface] ? plaza.surface : 'pavers';
    let laid = false;
    for (const poly of shape) {
      const [outer, ...holes] = poly.map((r) => r.slice(0, -1));
      if (outer.length < 3 || Math.abs(area2(outer)) < 1) continue;
      drapedMesh(builder, set, outer, holes, drape.drapeAt, () => null, drape.grid);
      laid = true;
    }
    if (laid) count++;
  }
  const meshes = [];
  for (const [set, p] of Object.entries(parts)) {
    if (!p.pos.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p.pos), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.uv), 2));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: PLAZA_MATERIAL(set) }));
    mesh.name = `plazas_${set}`;
    meshes.push(mesh);
  }
  return { meshes, count, triangles };
}
