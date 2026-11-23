// Long and diagonal shapes in chunks (refs/output/chunked-pipeline-plan.md). A footprint on the level's global grid
// (one lattice for the whole level: Generate's frame at the level's centre, pixels (x east, y south)) is covered by
// square chunks of CHUNK_PX, laid on a regular grid with stride CHUNK_PX - OVERLAP_PX, so neighbours overlap by
// OVERLAP_PX. Each chunk owns its core: the chunk less half the overlap on every side. The cores tile the plane
// exactly, so every pixel has one owner. Only chunks whose core holds some of the footprint are kept.
//
// Each chunk is generated and exported on its own square grid (the square path works unchanged), with the footprint
// clipped to it; its core says what it keeps (ground, objects); the overlap round the core gives every edit that
// reaches the core's edge (road cuts, smoothing) the same ground on both sides.
import { metresPerDegree } from './mapFrame.js';
import { shapeRows } from './batchShape.js';

export const CHUNK_PX = 2048;
export const OVERLAP_PX = 256;

/**
 * The chunks over a footprint: [{ key, x0, y0, size, core: [cx0, cy0, cx1, cy1], area, runs }] with x0, y0 the chunk's
 * top-left on the global grid, core in global pixels ([cx0, cx1) x [cy0, cy1)), area the footprint pixels in its core,
 * runs the footprint within the whole chunk in its own pixels ([[y, x0, x1]...]). footprint: rects or { runs } on a
 * W x H global grid.
 */
export function chunkLayout(footprint, W, H, { size = CHUNK_PX, overlap = OVERLAP_PX } = {}) {
  const rows = shapeRows(footprint, H, W);
  const S = size - overlap; const half = overlap / 2;
  // the grid of chunks: chunk (a, b) at (a S - half, b S - half), so its core [a S, (a + 1) S) starts at 0
  const nA = Math.ceil(W / S); const nB = Math.ceil(H / S);
  const out = [];
  for (let b = 0; b < nB; b++) {
    const cy0 = b * S; const cy1 = Math.min(H, cy0 + S);
    for (let a = 0; a < nA; a++) {
      const cx0 = a * S; const cx1 = Math.min(W, cx0 + S);
      // the footprint in the core
      let area = 0;
      for (let y = cy0; y < cy1; y++) { const l = rows[y]; if (l) for (const [p, q] of l) area += Math.max(0, Math.min(q, cx1) - Math.max(p, cx0)); }
      if (!area) continue;
      const x0 = cx0 - half; const y0 = cy0 - half;
      // the footprint in the whole chunk, in its own pixels
      const runs = [];
      for (let y = Math.max(0, y0); y < Math.min(H, y0 + size); y++) {
        const l = rows[y]; if (!l) continue;
        for (const [p, q] of l) { const s = Math.max(p, x0); const e = Math.min(q, x0 + size); if (e > s) runs.push([y - y0, s - x0, e - x0]); }
      }
      out.push({ key: `${a}_${b}`, a, b, x0, y0, size, core: [cx0, cy0, cx1, cy1], area, runs });
    }
  }
  return out;
}

/** Which chunk owns global pixel (x, y): the one whose core holds it (cores tile the plane). */
export const chunkOwnerKey = (x, y, size = CHUNK_PX, overlap = OVERLAP_PX) => `${Math.floor(x / (size - overlap))}_${Math.floor(y / (size - overlap))}`;

/**
 * The level's lattice: the level's own frame (services/mapFrame.js), one linear lat/lng grid for the whole level with
 * the true metres per degree at its centre: the line gy squares south of the level's north edge is at
 * lat = lat0 + (H / 2 - gy) dlat, the line gx squares east of its west edge at lng = lng0 + (gx - W / 2) dlng. A chunk's
 * bounds are those lines round its squares, so a chunk is a map in the same frame: its height sample (i, j) is the
 * level's sample (x0 + i, y0 + j) exactly, and its map data, placed through its bounds, lands on the same squares.
 * (Until 2026-11-23 the lattice used a flat 111,320 m per degree, up to 0.67 % off, and a chunk's rows were sampled one
 * square north of where they were read.)
 */
export function levelLattice(center, mpp, W, H) {
  const k = metresPerDegree(center.lat);
  const dlat = mpp / k.lat; const dlng = mpp / k.lng;
  const latOf = (gy) => center.lat + (H / 2 - gy) * dlat; const lngOf = (gx) => center.lng + (gx - W / 2) * dlng;
  return {
    latOf, lngOf, dlat, dlng,
    /** A chunk's bounds and centre for Generate (fetchTerrainData targetBounds). */
    chunkBounds: (c) => ({ north: latOf(c.y0), south: latOf(c.y0 + c.size), west: lngOf(c.x0), east: lngOf(c.x0 + c.size) }),
    chunkCenter: (c) => ({ lat: latOf(c.y0 + c.size / 2), lng: lngOf(c.x0 + c.size / 2) }),
    /** A chunk's centre's offset from the level's centre, in metres (x east, y north): where the merge moves its outputs. */
    chunkOffsetM: (c) => ({ x: (c.x0 + c.size / 2 - W / 2) * mpp, y: (H / 2 - (c.y0 + c.size / 2)) * mpp }),
  };
}
