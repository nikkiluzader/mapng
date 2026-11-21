// Generate for a chunked level (refs/output/chunked-pipeline-plan.md): a footprint whose bounding square is too big for
// one grid (a long or diagonal road) is generated as
//   1. an overview: one coarse Generate of the footprint's box (at most OVERVIEW_MAX_SIDE px a side, the footprint
//      scaled down with it), for the previews and the export panel: what the user sees and chooses on;
//   2. every chunk's own Generate at full resolution, run once to fill the download cache (the browser's IndexedDB,
//      the desktop's disk) and then dropped: the export generates each chunk again from the cache, one at a time,
//      and downloads nothing.
// The overview carries `chunked`: what the export needs to lay out and generate the chunks again (exportChunkedLevel).
import { chunkLayout, levelLattice, CHUNK_PX, OVERLAP_PX } from './chunkLayout.js';
import { shapeRows } from './batchShape.js';
import { exportChunked } from './chunkedExport.js';

export const OVERVIEW_MAX_SIDE = 4096;
// a shape is chunked when its power-of-two square would pass this (one grid up to here, as before)
export const CHUNKED_FROM_SIDE = 16384;

/** The power-of-two square side a W x H grid pads to. */
export const paddedSide = (W, H) => { let s = 1; while (s < Math.max(W, H)) s *= 2; return s; };
/** Whether a W x H footprint grid is generated in chunks. */
export const needsChunks = (W, H, from = CHUNKED_FROM_SIDE) => paddedSide(W, H) > from;

/** A footprint (rects or runs) on a W x H grid, scaled down by the whole factor f: row runs on ceil(W/f) x ceil(H/f). */
export function scaleFootprint(footprint, W, H, f) {
  const rows = shapeRows(footprint, H, W); const w = Math.ceil(W / f); const h = Math.ceil(H / f); const runs = [];
  for (let y = 0; y < h; y++) {
    // (a coarse pixel is in when any of its fine rows has footprint over it)
    const spans = [];
    for (let r = y * f; r < Math.min(H, (y + 1) * f); r++) for (const [p, q] of rows[r] || []) spans.push([Math.floor(p / f), Math.ceil(q / f)]);
    spans.sort((a, b) => a[0] - b[0]);
    let cur = null;
    for (const [p, q] of spans) { if (cur && p <= cur[1]) cur[1] = Math.max(cur[1], q); else { if (cur) runs.push([y, cur[0], Math.min(w, cur[1])]); cur = [p, q]; } }
    if (cur) runs.push([y, cur[0], Math.min(w, cur[1])]);
  }
  return { runs, width: w, height: h };
}

/**
 * Generate a chunked level. fetch(center, size, generationOptions) -> terrainData (fetchTerrainData with the
 * call's other arguments bound: the page's, or the desktop job's). Returns the overview terrainData with `chunked`.
 */
export async function generateChunked({ fetch, center, W, H, mpp, footprint, generationOptions = {}, size = CHUNK_PX, overlap = OVERLAP_PX, onStatus = () => {}, log = () => {} }) {
  const chunks = chunkLayout(footprint, W, H, { size, overlap });
  const L = levelLattice(center, mpp, W, H);
  const f = Math.max(1, Math.ceil(Math.max(W, H) / OVERVIEW_MAX_SIDE));
  const ov = scaleFootprint(footprint, W, H, f);
  log(`Chunked Generate: a ${W} x ${H} footprint grid at ${mpp} m/px, ${chunks.length} chunk(s) of ${size} px (overlap ${overlap}); overview ${ov.width} x ${ov.height} at ${mpp * f} m/px.`);
  // the chunks' data first (into the cache), then the overview
  const { footprint: _fp, ...baseOptions } = generationOptions;
  for (let k = 0; k < chunks.length; k++) {
    const c = chunks[k];
    onStatus({ chunk: k + 1, of: chunks.length });
    const t0 = Date.now();
    await fetch(L.chunkCenter(c), c.size, { ...baseOptions, processingMetersPerPixel: mpp, targetBounds: L.chunkBounds(c), footprint: { runs: c.runs }, chunkPrefetch: true });
    log(`chunk ${c.key} (${k + 1}/${chunks.length}): data fetched and cached in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  onStatus({ overview: true });
  const td = await fetch(center, { width: ov.width, height: ov.height }, { ...baseOptions, processingMetersPerPixel: mpp * f, footprint: { runs: ov.runs } });
  td.chunked = {
    center: { lat: center.lat, lng: center.lng }, W, H, mpp, size, overlap,
    footprint: { runs: shapeRows(footprint, H, W).flatMap((l, y) => (l || []).map(([p, q]) => [y, p, q])) },
    overviewFactor: f, chunks: chunks.length,
    // (the Generate options every chunk is made with again at export: plain values only)
    generationOptions: JSON.parse(JSON.stringify(baseOptions)),
  };
  return td;
}

/**
 * Export a chunked level from its overview's `chunked`: every chunk generated again from the cache and exported in
 * order (services/chunkedExport.js), then merged. fetch as for generateChunked; exportLevel(terrainData, center,
 * options) -> the export's result. Returns { zip (JSZip), chunks }.
 */
export async function exportChunkedLevel({ JSZip, chunked, fetch, exportLevel, options, levelInfo = null, onProgress = () => {}, log = () => {} }) {
  const { center, W, H, mpp, size, overlap, footprint, generationOptions } = chunked;
  const chunkOptions = { ...options };   // (no surrounding backdrop per chunk: includeBackdrop off below)
  return exportChunked({
    JSZip, footprint, W, H, center, mpp, levelName: options.levelName, size, overlap,
    generateChunk: (c, { bounds, center: cc }) => fetch(cc, c.size, { ...generationOptions, processingMetersPerPixel: mpp, targetBounds: bounds, footprint: { runs: c.runs } }),
    exportChunk: (td, cc, opts) => exportLevel(td, cc, opts),
    options: { ...chunkOptions, includeBackdrop: false },
    levelInfo, onProgress, log,
  });
}
