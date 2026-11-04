// Corners shared between triangles written once. A non-indexed geometry
// (three.js's default for built meshes) gives every triangle corner its own
// vertex; BeamNG keeps every written vertex in GPU memory, and its geometry
// pool is finite: a dense 8 km city ran out of it (the shapes loaded last
// got broken memory: smeared "rainbow" slabs, black materials). Welding
// corners that agree in every attribute (to 0.1 mm, 1e-4 in normals and
// colours, 1e-5 in UVs) keeps the look and the triangles exactly, with 24%
// (buildings) to 64% (sidewalks) fewer vertices.
import * as THREE from 'three';

const STEP = { position: 1e4, normal: 1e4, color: 1e4, uv: 1e5, uv1: 1e5, uv2: 1e5 };

/**
 * An indexed copy of a geometry with matching corners merged (an indexed
 * one too: its duplicate vertices folded into one). The index keeps the
 * original triangle order, so groups (index ranges, one per material) stay
 * valid as they are. The input is not changed.
 */
export function weldGeometry(geometry) {
  const names = Object.keys(geometry.attributes);
  const attrs = names.map((n) => geometry.attributes[n]);
  const n = geometry.attributes.position?.count || 0;
  if (n === 0) return geometry;
  const sourceIndex = geometry.index ? geometry.index.array : null;
  const width = attrs.reduce((w, a) => w + a.itemSize, 0);
  const steps = []; const sources = [];
  for (let k = 0; k < attrs.length; k++) {
    for (let c = 0; c < attrs[k].itemSize; c++) { steps.push(STEP[names[k]] ?? 1e5); sources.push([k, c]); }
  }
  // each corner's quantized attributes, and a hash of them
  const q = new Int32Array(n * width);
  const hashes = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let h = 2166136261;
    for (let j = 0; j < width; j++) {
      const [k, c] = sources[j];
      const v = Math.round(attrs[k].getComponent(i, c) * steps[j]) | 0;
      q[i * width + j] = v;
      h = Math.imul(h ^ v, 16777619);
      h ^= h >>> 13;
    }
    hashes[i] = h >>> 0;
  }
  // open addressing: a slot per distinct corner
  let size = 1; while (size < n * 2) size <<= 1;
  const mask = size - 1;
  const table = new Int32Array(size).fill(-1);   // slot → first corner with that key
  const remap = new Uint32Array(n);               // corner → output vertex
  const firstOf = [];                              // output vertex → its first corner
  for (let i = 0; i < n; i++) {
    let s = hashes[i] & mask;
    for (;;) {
      const at = table[s];
      if (at === -1) { table[s] = i; remap[i] = firstOf.length; firstOf.push(i); break; }
      let same = hashes[at] === hashes[i];
      for (let j = 0; same && j < width; j++) same = q[at * width + j] === q[i * width + j];
      if (same) { remap[i] = remap[at]; break; }
      s = (s + 1) & mask;
    }
  }
  const out = new THREE.BufferGeometry();
  const m = firstOf.length;
  for (let k = 0; k < attrs.length; k++) {
    const a = attrs[k];
    const arr = new a.array.constructor(m * a.itemSize);
    for (let v = 0; v < m; v++) for (let c = 0; c < a.itemSize; c++) arr[v * a.itemSize + c] = a.getComponent(firstOf[v], c);
    out.setAttribute(names[k], new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
  }
  // (an indexed input: its index through the merge)
  let index = remap;
  if (sourceIndex) {
    if (m === n) return geometry;   // nothing to merge
    index = new Uint32Array(sourceIndex.length);
    for (let i = 0; i < sourceIndex.length; i++) index[i] = remap[sourceIndex[i]];
  }
  out.setIndex(new THREE.BufferAttribute(m > 65535 ? index : new Uint16Array(index), 1));
  for (const g of geometry.groups) out.addGroup(g.start, g.count, g.materialIndex);
  out.name = geometry.name;
  out.userData = geometry.userData;
  return out;
}
