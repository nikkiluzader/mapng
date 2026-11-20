// The seams the export's own terrain edits leave, relaxed.
//
// Every edit (the sea floor, lake beds, a road's cut or fill, a field's plane) meets the surveyed ground somewhere,
// and on a 1 m grid that meeting is a crease or a ragged step a point wide: the jagged edges along coasts, road cuts
// and cliffs (user, 2026-11-20). In the game the World Editor's "Really smooth" brush fixes them: measured in game, it
// pulls each point toward the average of its near neighbours (a Gaussian about 1 m wide), about 0.75 of the way at the
// brush's centre (scratch/jag/brushtest.png). Here the same, at the export, only on the seams:
//   - a seam point is an edited point beside an unedited one; the band is the seam and up to BAND_STEPS points further
//     into the edit. Only edited points move: the surveyed ground is left exactly as measured (real-world alignment
//     first) and pulls the edit's edge up or down to meet it (moving the survey's own seam points too, a marsh bank
//     beside a deep sea floor cut went 1.9 m down: kingst);
//   - held points are never moved (roads and their margin: on 2 m lidar or finer the survey's road is near perfect and
//     no smoothing may touch it, the user's rule, kept on every survey here; the ground graded under the paving; a
//     tunnel's own ground; ground under a deck) but their heights still pull on their neighbours;
//   - PASSES sweeps, each moving a point STRENGTH of the way to its four neighbours' average, never past its surveyed
//     height nor back past its edited one.
// Sparse throughout: no full-grid buffer (a 16k grid is 268 M points), the band's points in a PixelEdits.
import { PixelEdits } from './pixelEdits.js';

export const SEAM_BAND_STEPS = 3;
export const SEAM_PASSES = 3;
export const SEAM_STRENGTH = 0.5;
// an edit deeper than this is meant (a tunnel approach's cutting between its walls, a pit for a garage's deck): held.
// Smoothed, the floor of a cutting beside its wall rose 18 m toward the hillside over it (gt_chevril)
export const SEAM_DEEP_M = 1.5;
const SEAM_EPS = 1e-4;   // an edit smaller than this (m) is no edit

/**
 * heightMap: the edited heights (changed in place through set); source: the heights before any edit (same grid);
 * width, height; held(idx): a point never moved; set(idx, v): writes a height (default heightMap[idx] = v);
 * deepOk(idx): an edit smoothed however deep (the sea floor: lowered water, never a structure's ground).
 * Returns { seam, band, held, deep (edits deeper than deepM, held), moved, maxChange, meanChange, maxAt (the index moved
 * most), big (points moved over 1 m) }.
 */
export function relaxSeams({ heightMap, source, width, height, held = () => false, set = null,
  bandSteps = SEAM_BAND_STEPS, passes = SEAM_PASSES, strength = SEAM_STRENGTH, deepM = SEAM_DEEP_M, deepOk = () => false } = {}) {
  const N = width * height;
  const stats = { seam: 0, band: 0, held: 0, deep: 0, moved: 0, maxChange: 0, meanChange: 0, maxAt: -1, big: 0 };
  if (!heightMap || !source || heightMap === source || source.length !== N) return stats;
  const edited = (i) => Math.abs(heightMap[i] - source[i]) > SEAM_EPS;
  // the seam: one sweep over the grid, each point against its right and lower neighbour
  const band = new PixelEdits();       // idx -> steps from the seam
  let frontier = [];
  const mark = (i, d) => { if (!band.has(i)) { band.set(i, d); if (d === 0) frontier.push(i); } };
  for (let r = 0; r < height; r++) {
    const row = r * width;
    for (let c = 0; c < width; c++) {
      const i = row + c; const e = edited(i);
      if (c + 1 < width && edited(i + 1) !== e) { mark(i, 0); mark(i + 1, 0); }
      if (r + 1 < height && edited(i + width) !== e) { mark(i, 0); mark(i + width, 0); }
    }
  }
  stats.seam = band.size;
  // ... and into the edits, bandSteps further
  for (let step = 1; step <= bandSteps && frontier.length; step++) {
    const next = [];
    for (const i of frontier) {
      const r = (i / width) | 0; const c = i - r * width;
      for (const k of [c > 0 ? i - 1 : -1, c < width - 1 ? i + 1 : -1, r > 0 ? i - width : -1, r < height - 1 ? i + width : -1]) {
        if (k < 0 || band.has(k) || !edited(k)) continue;
        band.set(k, step); next.push(k);
      }
    }
    frontier = next;
  }
  // the points that move
  const pts = [];
  for (const i of band.keys()) {
    if (!edited(i)) continue;
    if (Math.abs(heightMap[i] - source[i]) > deepM && !deepOk(i)) stats.deep++;
    else if (held(i)) stats.held++;
    else pts.push(i);
  }
  stats.band = band.size;
  if (!pts.length) return stats;
  const start = new Float64Array(pts.length);
  for (let k = 0; k < pts.length; k++) start[k] = heightMap[pts[k]];
  const write = set || ((i, v) => { heightMap[i] = v; });
  for (let p = 0; p < passes; p++) {
    for (let k = 0; k < pts.length; k++) {
      const i = pts[k]; const r = (i / width) | 0; const c = i - r * width;
      let sum = 0; let n = 0;
      if (c > 0) { sum += heightMap[i - 1]; n++; }
      if (c < width - 1) { sum += heightMap[i + 1]; n++; }
      if (r > 0) { sum += heightMap[i - width]; n++; }
      if (r < height - 1) { sum += heightMap[i + width]; n++; }
      if (!n) continue;
      const h = heightMap[i];
      // (only between the edit and the survey: the pass takes back part of the export's own edit, never makes new
      // ground. On a steep slope the four neighbours' mean lies metres off, and a cliff's foot moved 6.7 m: gt_chevril)
      const a = start[k]; const b = source[i];
      const v = h + strength * (sum / n - h);
      write(i, Math.min(Math.max(a, b), Math.max(Math.min(a, b), v)));
    }
  }
  let total = 0;
  for (let k = 0; k < pts.length; k++) {
    const d = Math.abs(heightMap[pts[k]] - start[k]);
    if (d > SEAM_EPS) { stats.moved++; total += d; if (d > 1) stats.big++; if (d > stats.maxChange) { stats.maxChange = d; stats.maxAt = pts[k]; } }
  }
  stats.meanChange = stats.moved ? total / stats.moved : 0;
  return stats;
}
