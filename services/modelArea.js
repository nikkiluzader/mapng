// A 3D terrain model of part of a map, or of a map in tiles, that lines up with the level.
//
// The level puts height sample (col, row) at x = (col - W/2) * m, y = (H/2 - 1 - row) * m, height over the
// map's lowest point (m: metres a sample). A model is in the same frame (glTF: x east, y up, z south = -y), so
// it can be laid over the level, and so can a model of one part: its own samples keep the place they have in
// the whole map. Tiles share the row and column of samples along each joint, so no gap opens between them.
import { meshPlan, MESH_MAX_POINTS } from './modelMesh.js';

export const TILE_COUNTS = [1, 2, 4, 8, 16];

/** A square of samples kept inside a W x H grid: { c0, r0, size } (at least 16 a side), or null. */
export function clampArea(area, W, H) {
  if (!area) return null;
  const max = Math.min(W, H);
  const size = Math.max(Math.min(16, max), Math.min(max, Math.round(area.size)));
  const c0 = Math.max(0, Math.min(W - size, Math.round(area.c0)));
  const r0 = Math.max(0, Math.min(H - size, Math.round(area.r0)));
  return { c0, r0, size };
}

/** A dragged rectangle (two corners in samples) as the square round its middle, of its longer side. */
export function squareOfDrag(a, b, W, H) {
  const size = Math.max(Math.abs(b.c - a.c), Math.abs(b.r - a.r));
  return clampArea({ c0: (a.c + b.c) / 2 - size / 2, r0: (a.r + b.r) / 2 - size / 2, size }, W, H);
}

/** k x k tiles of a square area: [{ i, j, c0, r0, size }], neighbours sharing one row or column of samples. */
export function tileRects(area, k) {
  const n = Math.max(1, Math.round(k)); const out = [];
  const step = (area.size - 1) / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = Math.round(i * step); const b = Math.round(j * step);
    // (square tiles: the longer of the two spans, clipped to the area on its last row and column)
    const size = Math.max(Math.round((i + 1) * step) - a, Math.round((j + 1) * step) - b) + 1;
    const cs = Math.min(a, area.size - size); const rs = Math.min(b, area.size - size);
    out.push({ i, j, c0: area.c0 + Math.max(0, cs), r0: area.r0 + Math.max(0, rs), size: Math.min(size, area.size) });
  }
  return out;
}

/** The fewest tiles a side whose meshes each fit in one file at this stride; null when even 16 x 16 do not. */
export function tilesNeeded(areaSize, metersPerPixel, stride) {
  for (const k of TILE_COUNTS) {
    const size = Math.ceil((areaSize - 1) / k) + 1;
    if (meshPlan(size, metersPerPixel, stride).points <= MESH_MAX_POINTS) return k;
  }
  return null;
}

/**
 * Where a part's model goes so that it lies where it does in the whole map. `full`: { width, height,
 * metersPerPixel, minHeight }; `rect`: the part; `partMinHeight`: its own lowest point (a model's heights
 * start at its own). Metres in the model's frame: { x, y, z }.
 */
export function partOffset(full, rect, partMinHeight) {
  const m = Number(full.metersPerPixel) > 0 ? Number(full.metersPerPixel) : 1;
  return {
    x: (rect.c0 + rect.size / 2 - full.width / 2) * m,
    y: (Number(partMinHeight) || 0) - (Number(full.minHeight) || 0),
    z: -((full.height / 2 - rect.r0 - rect.size / 2) * m),
  };
}

/** Where sample (col, row) of a part ends up in the whole map's frame, the way the model export places it. */
export function samplePosition(full, rect, col, row) {
  const m = Number(full.metersPerPixel) > 0 ? Number(full.metersPerPixel) : 1;
  const off = partOffset(full, rect, 0);
  // (the part's own frame: x = (col - size/2) * m, z = -(size/2 - 1 - row) * m)
  return { x: (col - rect.size / 2) * m + off.x, z: -((rect.size / 2 - 1 - row) * m) + off.z };
}
