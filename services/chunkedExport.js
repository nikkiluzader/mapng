// A chunked level, start to end (refs/output/chunked-pipeline-plan.md): the footprint's chunks generated and exported
// one at a time (memory: one chunk), each keeping its core, each blending its ground toward its finished neighbours
// along their shared edges (the seams meet exactly: the export's whole-road steps differ by up to ~0.8 m between two
// chunks' views of the same overlap), then merged into one level (services/chunkMerge.js).
import { chunkLayout, levelLattice, CHUNK_PX, OVERLAP_PX } from './chunkLayout.js';
import { createChunkMerger } from './chunkMerge.js';
import { seamRoadLookup } from './chunkSeamRoads.js';

export const SEAM_EASE_PX = 64;

/** Row runs [[y, x0, x1]...] as spans per row. */
function runsByRow(runs, size) {
  const rows = new Array(size);
  for (const [y, p, q] of runs) (rows[y] ||= []).push([p, q]);
  return rows;
}   // a chunk's ground eases from a finished neighbour's heights to its own over this

/**
 * A chunk's seam blend: { target, weight } (Float32Array size x size, rows from the north) from its finished
 * neighbours, or null when none touches it. A pixel's weight is 1 inside a neighbour's core and falls to 0 at
 * SEAM_EASE_PX from it; its target is the neighbours' final heights there, the nearer a neighbour's core the more
 * it counts (at its core's edge it alone).
 */
export function seamBlendFor(chunk, finished, ease = SEAM_EASE_PX) {
  const N = chunk.size; const near = [];
  for (const f of finished) {
    const ox0 = Math.max(chunk.x0, f.x0); const ox1 = Math.min(chunk.x0 + N, f.x0 + f.size);
    const oy0 = Math.max(chunk.y0, f.y0); const oy1 = Math.min(chunk.y0 + N, f.y0 + f.size);
    if (ox1 > ox0 && oy1 > oy0) near.push(f);
  }
  if (!near.length) return null;
  const target = new Float32Array(N * N).fill(NaN); const weight = new Float32Array(N * N);
  const sum = new Float64Array(N * N); const wsum = new Float64Array(N * N);
  for (const f of near) {
    const [cx0, cy0, cx1, cy1] = f.core;
    // (only the neighbour's footprint holds surveyed ground: outside it Generate only fills)
    const rows = f.runs ? runsByRow(f.runs, f.size) : null;
    const inFoot = (lx, ly) => { if (!rows) return true; const l = rows[ly]; if (!l) return false; for (const [p, q] of l) if (lx >= p && lx < q) return true; return false; };
    for (let r = 0; r < N; r++) {
      const gy = chunk.y0 + r; if (gy < f.y0 || gy >= f.y0 + f.size) continue;
      for (let c = 0; c < N; c++) {
        const gx = chunk.x0 + c; if (gx < f.x0 || gx >= f.x0 + f.size) continue;
        // (Chebyshev distance to the neighbour's core)
        const d = Math.max(cx0 - gx, gx - (cx1 - 1), cy0 - gy, gy - (cy1 - 1), 0);
        // (the shared edge's own points (d <= 1) are both chunks': exactly the neighbour's)
        const w = Math.max(0, 1 - Math.max(0, d - 1) / ease); if (!(w > 0)) continue;
        if (!inFoot(gx - f.x0, gy - f.y0)) continue;
        const h = f.heights[(gy - f.y0) * f.size + (gx - f.x0)]; if (!Number.isFinite(h)) continue;
        // (where several finished chunks reach a point, the one nearest its own kept part counts for most, and at
        // its kept part's edge for all: an even mix let a neighbour's margin copy pull the ground off the keeper's
        // at a corner of four chunks, 0.6 to 2 m)
        const share = w / (1 - w + 1e-4);
        const k = r * N + c; sum[k] += h * share; wsum[k] += share; if (w > weight[k]) weight[k] = w;
      }
    }
  }
  for (let k = 0; k < N * N; k++) if (wsum[k] > 0) target[k] = sum[k] / wsum[k];
  return { target, weight };
}

/**
 * The chunked level: { zip (JSZip), chunks: [{ key, ms }], log }. footprint: rects or { runs } on the level's W x H
 * grid around `center` at `mpp`; generateChunk(chunk, { bounds, center }) -> terrainData (the chunk's square, from the
 * cache: the export never downloads); exportChunk(terrainData, center, options) -> the export's result (blob,
 * finalHeights, finalMinHeight); options: the export's options for every chunk.
 */
export async function exportChunked({ JSZip, footprint, W, H, center, mpp, levelName, generateChunk, exportChunk, options = {}, size = CHUNK_PX, overlap = OVERLAP_PX, levelInfo = null, onProgress = () => {}, log = () => {}, signal = null, sink = null }) {
  const L = levelLattice(center, mpp, W, H);
  const chunks = chunkLayout(footprint, W, H, { size, overlap });
  log(`${chunks.length} chunk(s) of ${size} px (overlap ${overlap}) over a ${W} x ${H} footprint grid`);
  const finished = []; const times = []; const reports = []; const lines = [];
  const say = (m) => { lines.push(m); log(m); };
  // (each chunk goes into the level as soon as it is exported, and its zip is let go: services/chunkMerge.js
  // createChunkMerger. The sink is the caller's streamed zip (services/zipStreamWriter.js, ZIP64 when needed) or,
  // without one, a JSZip returned as before)
  const own = sink ? null : new JSZip();
  const out = sink || { put: (p, d) => { own.file(p, d); }, has: (p) => !!own.file(p) };
  const bounds = { north: L.latOf(0), south: L.latOf(H), west: L.lngOf(0), east: L.lngOf(W) };
  const merger = createChunkMerger(out, levelName, { log: say, bounds, levelInfo });
  // (a failure says which chunk it was in, and at which step: one of many, each minutes long)
  const inChunk = async (c, k, what, run) => {
    try { return await run(); } catch (e) {
      if (e?.name === 'AbortError') throw e;
      const err = new Error(`Chunk ${c.key} (${k + 1} of ${chunks.length}), ${what}: ${e?.message || e}`); err.cause = e; err.chunk = c.key; throw err;
    }
  };
  for (let k = 0; k < chunks.length; k++) {
    const c = chunks[k]; const t0 = Date.now();
    signal?.throwIfAborted?.();
    onProgress({ chunk: k + 1, of: chunks.length, step: 'generate' });
    const td = await inChunk(c, k, 'generating it from the cache', () => generateChunk(c, { bounds: L.chunkBounds(c), center: L.chunkCenter(c) }));
    const seamBlend = seamBlendFor(c, finished);
    // (the finished chunks' solved road heights, in this chunk's own metres: held in the seam's band)
    const off = L.chunkOffsetM(c);
    const seamRoads = seamBlend && options.seamRoadPins !== false ? seamRoadLookup(finished.filter((f) => f.roads?.length).map((f) => ({ key: f.key, roads: f.roads, owns: (x, y) => { const gx = c.x0 + c.size / 2 + x / mpp; const gy = c.y0 + c.size / 2 - y / mpp; return gx >= f.core[0] && gx <= f.core[2] && gy >= f.core[1] && gy <= f.core[3]; }, dx: f.off.x - off.x, dy: f.off.y - off.y }))) : null;
    signal?.throwIfAborted?.();
    onProgress({ chunk: k + 1, of: chunks.length, step: 'export' });
    const chunkLevel = `${levelName}_c${c.key}`;
    const res = await inChunk(c, k, 'exporting it', () => exportChunk(td, L.chunkCenter(c), {
      ...options, levelName: chunkLevel, previewTitle: options.levelName || levelName, groundAsModels: true,
      groundShape: { size: c.size, runs: c.runs },
      chunkCore: [c.core[0] - c.x0, c.core[1] - c.y0, c.core[2] - c.x0, c.core[3] - c.y0],
      seamBlend, seamRoads, keepFinalHeights: true,
    }));
    // (the merge sets every chunk at its own height from this: without it a chunk would sit hundreds of metres off)
    if (!Number.isFinite(Number(res?.finalMinHeight))) throw new Error(`Chunk ${c.key} (${k + 1} of ${chunks.length}): the export gave no lowest height for it; the chunks cannot be set at their heights.`);
    if (typeof res.report === 'string' && res.report) reports.push({ key: c.key, text: res.report });
    finished.push({ key: c.key, x0: c.x0, y0: c.y0, size: c.size, core: c.core, runs: c.runs, heights: res.finalHeights, roads: res.finalRoads || [], off });
    // (a finished chunk's heights are needed only while a later chunk can still touch it: rows two chunks back drop)
    for (let i = finished.length - 1; i >= 0; i--) if (finished[i].y0 + finished[i].size < c.y0 - overlap) finished.splice(i, 1);
    // (a Blob in the browser; JSZip in Node reads its bytes)
    const bytes = typeof res.blob?.arrayBuffer === 'function' ? await res.blob.arrayBuffer() : res.blob;
    await merger.add({ zip: await JSZip.loadAsync(bytes), key: c.key, levelName: chunkLevel, offsetM: L.chunkOffsetM(c), minHeight: res.finalMinHeight });
    times.push({ key: c.key, ms: Date.now() - t0 });
    say(`chunk ${c.key} (${k + 1}/${chunks.length}): ${((Date.now() - t0) / 1000).toFixed(1)} s${seamBlend ? ', seam blended toward finished neighbours' : ''}`);
  }
  signal?.throwIfAborted?.();
  onProgress({ step: 'merge' });
  await merger.finish();
  // The level's own report: what the level is, how it was put together (the lines above), then every chunk's report.
  // (The merged zip used to hold the first chunk's report as if it were the level's.)
  const report = [
    `# MapNG export report: ${levelName} (built in ${chunks.length} chunks)`,
    '',
    `A level of ${W} x ${H} squares at ${mpp} m, built as ${chunks.length} chunks of ${size} squares (${overlap} shared with each neighbour) and merged. Each chunk's own report follows; the map data bundled in this level (mapng_source) is the first chunk's.`,
    '',
    '## How the chunks were put together',
    '',
    ...lines.map((l) => `- ${l}`),
    '',
    ...reports.flatMap((r) => [`## Chunk ${r.key}`, '', r.text.replace(/^# /gm, '### ').replace(/^## /gm, '#### '), '']),
  ].join('\n');
  await out.put(`levels/${levelName}/export_report.md`, report);
  return { zip: own, chunks: times, report };
}
