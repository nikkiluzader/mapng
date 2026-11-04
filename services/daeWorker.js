// Collada files written on worker threads (services/parallel.js): a shape's
// scene described as plain data (node names and matrices, geometry arrays,
// material colours), rebuilt in the worker and written there by the same
// ColladaExporter, so the file is the same as one written in place. A dense
// 8 km export spent ~35 s writing building, sidewalk and bridge shapes on
// its one main thread.
import * as THREE from 'three';
import { ColladaExporter } from './ColladaExporter.js';

export const DAE_OPTIONS = { version: '1.4.1', upAxis: 'Z_UP' };

// (a typed array on its own buffer: a view into a larger one would carry
// the whole buffer through postMessage)
const own = (a) => (a.byteOffset === 0 && a.byteLength === a.buffer.byteLength ? a : a.slice());

// (vertexColors, roughness, metalness, flatShading: the 3D preview's
// materials, which come from a worker too: services/previewOsmWorker.js)
const MATERIAL_KEYS = ['name', 'side', 'opacity', 'transparent', 'shininess', 'reflectivity', 'vertexColors', 'roughness', 'metalness', 'flatShading'];
const COLOR_KEYS = ['color', 'emissive', 'specular'];

function describeMaterial(m) {
  const out = { type: m.isMeshBasicMaterial ? 'basic' : m.isMeshLambertMaterial ? 'lambert' : m.isMeshPhongMaterial ? 'phong' : 'standard' };
  for (const k of MATERIAL_KEYS) if (m[k] !== undefined) out[k] = m[k];
  for (const k of COLOR_KEYS) if (m[k]?.isColor) out[k] = m[k].getHex();
  return out;
}

function makeMaterial(d) {
  const M = { basic: THREE.MeshBasicMaterial, lambert: THREE.MeshLambertMaterial, phong: THREE.MeshPhongMaterial, standard: THREE.MeshStandardMaterial }[d.type];
  const m = new M();
  for (const k of MATERIAL_KEYS) if (d[k] !== undefined && k in m) m[k] = d[k];
  for (const k of COLOR_KEYS) if (d[k] !== undefined && m[k]?.isColor) m[k].setHex(d[k]);
  return m;
}

/** A shape's scene (its root group, matrices updated) as plain, cloneable data. */
/** The buffers of a description (to transfer it instead of copying it). */
export function sceneBuffers(desc, out = new Set()) {
  if (desc.geometry) {
    for (const a of Object.values(desc.geometry.attributes)) out.add(a.array.buffer);
    if (desc.geometry.index) out.add(desc.geometry.index.buffer);
  }
  for (const c of desc.children || []) sceneBuffers(c, out);
  return out;
}

export function describeScene(root) {
  const geometries = new Map();
  const describeGeometry = (g) => {
    if (geometries.has(g)) return geometries.get(g);
    const d = {
      id: geometries.size,
      name: g.name,
      attributes: Object.fromEntries(Object.entries(g.attributes).map(([k, a]) => [k, { array: own(a.array), itemSize: a.itemSize, normalized: a.normalized }])),
      index: g.index ? own(g.index.array) : null,
      groups: g.groups.map((x) => ({ ...x })),
    };
    geometries.set(g, d);
    return d;
  };
  const node = (o) => ({
    name: o.name,
    kind: o.isMesh ? 'mesh' : 'group',
    matrix: o.matrix.toArray(),
    geometry: o.isMesh ? describeGeometry(o.geometry) : null,
    material: o.isMesh ? (Array.isArray(o.material) ? o.material.map(describeMaterial) : describeMaterial(o.material)) : null,
    castShadow: !!o.castShadow,
    receiveShadow: !!o.receiveShadow,
    visible: o.visible !== false,
    children: o.children.map(node),
  });
  return node(root);
}

/** The scene back from describeScene's data. */
export function sceneFromDescription(desc) {
  const geometries = new Map();
  const makeGeometry = (d) => {
    if (geometries.has(d.id)) return geometries.get(d.id);
    const g = new THREE.BufferGeometry();
    g.name = d.name;
    for (const [k, a] of Object.entries(d.attributes)) g.setAttribute(k, new THREE.BufferAttribute(a.array, a.itemSize, a.normalized));
    if (d.index) g.setIndex(new THREE.BufferAttribute(d.index, 1));
    for (const x of d.groups) g.addGroup(x.start, x.count, x.materialIndex);
    geometries.set(d.id, g);
    return g;
  };
  const build = (d) => {
    const o = d.kind === 'mesh'
      ? new THREE.Mesh(makeGeometry(d.geometry), Array.isArray(d.material) ? d.material.map(makeMaterial) : makeMaterial(d.material))
      : new THREE.Group();
    o.name = d.name;
    o.castShadow = !!d.castShadow;
    o.receiveShadow = !!d.receiveShadow;
    if (d.visible === false) o.visible = false;
    o.matrix.fromArray(d.matrix);
    o.matrix.decompose(o.position, o.quaternion, o.scale);
    for (const c of d.children) o.add(build(c));
    return o;
  };
  const root = build(desc);
  root.updateMatrixWorld(true);
  return root;
}

/** The Collada text of a described scene (the worker's job). */
export function writeDae(desc) {
  return new ColladaExporter().parse(sceneFromDescription(desc), undefined, DAE_OPTIONS)?.data ?? null;
}
