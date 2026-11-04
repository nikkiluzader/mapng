// One building tile's shape (beamngBuildings.js buildTexturedBuildings'
// tiles): its full meshes, its lite meshes and their collision, in the
// BeamNG hierarchy, positioned round the tile's origin.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { letterName } from './beamngBuildings.js';

// The lite mesh takes over at about this distance from a tile: the engine's
// detail size is (shape radius) x ENGINE_PX / distance (BeamNG.Earth's
// measurement, 2560 x 1440 at high mesh quality; lower settings switch nearer)
export const BUILDING_LITE_FROM_M = 400;
const ENGINE_DETAIL_PX = 4100;
const LITE_DOWN_TO_PX = 2;      // the lite mesh drawn down to this detail size (the stock shapes' smallest)

/**
 * A tile { key, origin, full, lite } as { root (base00), meta { key, origin,
 * fullPx } }. A tile with no lite meshes draws its full ones far off too
 * (cloneLite), else nothing there (and collides with nothing).
 */
export function buildingTileScene(t, { cloneLite = true } = {}) {
  const [ox, oy] = t.origin;
  const base00 = new THREE.Group(); base00.name = 'base00';
  const start01 = new THREE.Group(); start01.name = 'start01';
  base00.add(start01);
  const box = new THREE.Box3();
  for (const m of [...t.full, ...t.lite]) {
    m.geometry.translate(-ox, -oy, 0);
    m.geometry.computeBoundingBox();
    box.union(m.geometry.boundingBox);
  }
  const radius = box.isEmpty() ? 1 : box.getSize(new THREE.Vector3()).length() / 2;
  const fullPx = Math.max(LITE_DOWN_TO_PX + 1, Math.round((radius * ENGINE_DETAIL_PX) / BUILDING_LITE_FROM_M));
  t.full.forEach((m, i) => { m.name = `bld${letterName(i)}${fullPx}`; start01.add(m); });
  const lites = t.lite.length ? t.lite : cloneLite ? t.full : [];
  lites.forEach((m, i) => {
    const lm = t.lite.length ? m : m.clone();
    lm.name = `lite${letterName(i)}${LITE_DOWN_TO_PX}`;
    start01.add(lm);
  });
  // collision: the lite walls and roofs (positions only)
  const parts = lites.map((m) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', m.geometry.getAttribute('position').clone());
    if (m.geometry.index) g.setIndex(m.geometry.index.clone());
    return g;
  });
  const colGeom = parts.length ? mergeGeometries(parts) : null;
  parts.forEach((g) => g.dispose());
  if (colGeom) {
    colGeom.name = 'Colmesh-1';
    const col = new THREE.Mesh(colGeom, new THREE.MeshBasicMaterial({ name: 'osm_object', color: 0xffffff }));
    col.name = 'Colmesh-1';
    start01.add(col);
  }
  base00.updateMatrixWorld(true);
  return { root: base00, meta: { key: t.key, origin: [ox, oy], fullPx } };
}
