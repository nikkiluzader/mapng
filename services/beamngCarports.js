// Carports: OSM building=carport (and building=roof over a car park) are
// open roofs on posts, not closed sheds. Each footprint is tiled with
// Italy's dealership carport (beamngPropLibrary CARPORT_SHAPE): rows across
// its short side, modules along its long side, scaled a little to fit, only
// the tiles inside the outline kept.
import { orientedBox } from './beamngBuildings.js';

// Italy_dealership_carport, measured in game: 6.2 m deep along local X
// (x -2.8..3.4), 14.5 m long along local Y (centred), 3.4 m tall from 0.
export const CARPORT_DEPTH_M = 6.2;
export const CARPORT_LENGTH_M = 14.5;
const CARPORT_X_OFFSET_M = 0.3;      // the model's centre on local X
const SCALE_MIN = 0.75;
const SCALE_MAX = 1.35;

/** Whether an OSM feature is a carport (an open roof over cars). */
export function isCarportFeature(feature) {
  const t = feature?.tags || {};
  if (feature?.type !== 'building' && !t.building) return false;
  if (t.building === 'carport') return true;
  // (a solar-panel roof is nearly always a car park's canopy: Phoenix's rows)
  const solar = t['generator:method'] === 'photovoltaic' || t['generator:source'] === 'solar';
  return t.building === 'roof' && (t.amenity === 'parking' || t.parking === 'carport' || solar);
}

const inRing = (x, y, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi) inside = !inside;
  }
  return inside;
};

/**
 * Carport tiles for the carport footprints: [{ x, y, yaw, scale: [sx, sy, 1] }]
 * in world space (yaw turns the model's local Y along the footprint's long
 * side; x, y already shifted for the model's off-centre origin).
 * project(lat, lng) -> [x, y].
 */
export function planCarports(features, project) {
  const tiles = [];
  for (const f of features || []) {
    if (!isCarportFeature(f) || !(f.geometry?.length >= 3)) continue;
    const ring = f.geometry.map((p) => project(p.lat, p.lng));
    const box = orientedBox(ring);
    if (!box || box.width < 2 || box.length < 2) continue;
    const { cx, cy, ux, uy } = box;
    const vx = -uy; const vy = ux;          // across the footprint
    const rows = Math.max(1, Math.round(box.width / CARPORT_DEPTH_M));
    const along = Math.max(1, Math.round(box.length / CARPORT_LENGTH_M));
    const sx = Math.min(SCALE_MAX, Math.max(SCALE_MIN, box.width / (rows * CARPORT_DEPTH_M)));
    const sy = Math.min(SCALE_MAX, Math.max(SCALE_MIN, box.length / (along * CARPORT_LENGTH_M)));
    const depth = CARPORT_DEPTH_M * sx; const length = CARPORT_LENGTH_M * sy;
    // local Y along the long side: rows of rotationMatrixFromYaw are the
    // local axes, local Y = (-sin yaw, cos yaw)
    const yaw = Math.atan2(-ux, uy);
    const lx = Math.cos(yaw); const ly = Math.sin(yaw);   // local X in world
    for (let r = 0; r < rows; r++) {
      const v = (r - (rows - 1) / 2) * depth;
      for (let a = 0; a < along; a++) {
        const u = (a - (along - 1) / 2) * length;
        const tx = cx + ux * u + vx * v; const ty = cy + uy * u + vy * v;
        if (!inRing(tx, ty, ring)) continue;
        tiles.push({
          x: tx - lx * CARPORT_X_OFFSET_M * sx,
          y: ty - ly * CARPORT_X_OFFSET_M * sx,
          yaw,
          scale: [sx, sy, 1],
          featureId: f.id,
        });
      }
    }
  }
  return tiles;
}
