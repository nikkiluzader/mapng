// The terrain under the roads (structures/terrainCompose.js) laid on worker threads, in bands of rows.
//
// Each band runs the whole composition over its own rows only: every road's corridor, in the same order, for
// the pixels in the band. A pixel's result depends only on the roads laid over it and their order, so the
// bands' tiles together are exactly the single run's; the passes over them (spikes, walls) then run once, here,
// on the merged tiles. A dense 4 km city spent a third of its export in this one loop.
//
// The caller's keep / tube tests (functions: no worker can take them) come as the pixel sets they test, sent as
// byte masks in shared memory, and the shaping's skip(k, i) as a byte per road piece. The height grid is shared,
// not copied, where it already lies in shared memory.
import { composeTerrain, TILE } from './structures/terrainCompose.js';
import { parallelMap, parallelThreads } from './parallel.js';

const MIN_PIXELS = 2048 * 2048;   // smaller maps: one thread (the workers' start costs more than it saves)
const BANDS_PER_THREAD = 3;       // (the roads lie unevenly: more bands than threads keeps every thread busy)

/** One band of rows: { tiles: [[key, tile]], left: Int32Array, corridors, skipped } (worker side). */
export function composeBand(band, shared) {
  const { keepMask, tubeMask, skipBits } = shared;
  const out = composeTerrain(shared.graph, {
    heightMap: shared.heightMap, width: shared.width, height: shared.height, worldSize: shared.worldSize, minHeight: shared.minHeight,
    keep: keepMask ? (idx) => keepMask[idx] === 1 : null,
    tube: tubeMask ? (idx) => tubeMask[idx] === 1 : null,
    inside: shared.insideIdx ? insideMap(shared) : null,
    skip: skipBits ? (k, i) => skipBits[k]?.[i] === 1 : null,
    rows: band, collect: true,
  });
  return { tiles: [...out.tiles], left: Int32Array.from(out.left), corridors: out.stats.corridors, skipped: out.stats.skipped || 0 };
}

// (the tunnels' inside spans, sparse: a few thousand pixels, sent as arrays and made a Map again per worker)
const insideCache = new WeakMap();
const insideMap = (shared) => {
  if (insideCache.has(shared.insideIdx)) return insideCache.get(shared.insideIdx);
  const m = new Map();
  for (let i = 0; i < shared.insideIdx.length; i++) m.set(shared.insideIdx[i], [shared.insideLo[i], shared.insideHi[i]]);
  insideCache.set(shared.insideIdx, m);
  return m;
};
const maskOf = (set, n) => {
  if (!set?.size) return null;
  const m = new Uint8Array(new SharedArrayBuffer(n));
  for (const idx of set) if (idx >= 0 && idx < n) m[idx] = 1;
  return m;
};

/**
 * composeTerrain on worker threads; the same result. grid as composeTerrain's, plus keepSet / tubeSet: the pixel
 * sets its keep / tube test (without them, or on one thread, or on a small map, it runs here as before).
 */
export async function composeTerrainParallel(graph, grid) {
  const { width, height } = grid;
  const threads = await parallelThreads();
  const setsGiven = (!grid.keep || grid.keepSet) && (!grid.tube || grid.tubeSet);
  if (threads <= 1 || width * height < MIN_PIXELS || !setsGiven || !graph.profile?.z) return composeTerrain(graph, grid);
  const n = width * height;
  const hm = grid.heightMap;
  const heightMap = hm.buffer instanceof SharedArrayBuffer ? hm : (() => { const s = new Float32Array(new SharedArrayBuffer(n * 4)); s.set(hm); return s; })();
  const skipBits = grid.skip ? graph.edges.map((e, k) => {
    const bits = new Uint8Array(Math.max(0, e.s.length - 1));
    for (let i = 0; i < bits.length; i++) if (grid.skip(k, i)) bits[i] = 1;
    return bits;
  }) : null;
  // (what composeTerrain and its helpers read of the graph: structures/sideArms.js, profileSolve.js seatable)
  const sub = {
    edges: graph.edges, nodes: graph.nodes, profile: { z: graph.profile.z }, classes: { segments: graph.classes?.segments || [] },
    fixed: graph.fixed, noCut: graph.noCut, tunnelsPinned: graph.tunnelsPinned,
  };
  const shared = {
    graph: sub, heightMap, width, height, worldSize: grid.worldSize, minHeight: grid.minHeight || 0,
    keepMask: grid.keep ? maskOf(grid.keepSet, n) : null, tubeMask: grid.tube ? maskOf(grid.tubeSet, n) : null, skipBits,
    ...(grid.inside?.size ? {
      insideIdx: Int32Array.from(grid.inside.keys()),
      insideLo: Float32Array.from([...grid.inside.values()].map((s) => s[0])),
      insideHi: Float32Array.from([...grid.inside.values()].map((s) => s[1])),
    } : {}),
  };
  // bands of whole tile rows (a tile is never split between two bands)
  const tileRows = Math.ceil(height / TILE);
  const count = Math.min(tileRows, threads * BANDS_PER_THREAD);
  const bands = [];
  for (let b = 0; b < count; b++) {
    const t0 = Math.floor((b * tileRows) / count); const t1 = Math.floor(((b + 1) * tileRows) / count);
    if (t1 > t0) bands.push([t0 * TILE, Math.min(height, t1 * TILE)]);
  }
  let parts;
  try {
    parts = await parallelMap(bands, { local: composeBand, module: new URL('./composeWorker.js', import.meta.url).href, fn: 'composeBand', shared });
  } catch (err) {
    // (a graph that cannot be sent to a worker, or a worker that failed: the single run, the same result)
    console.warn(`[Terrain] composing on worker threads failed (${err?.message || err}); on one thread instead`);
    return composeTerrain(graph, grid);
  }
  const tiles = new Map(); const left = new Set();
  for (const p of parts) {
    for (const [key, t] of p.tiles) tiles.set(key, t);
    for (const idx of p.left) left.add(idx);
  }
  // (every band counts every road piece: the first band's count is the run's)
  return composeTerrain(graph, { ...grid, prebuilt: { tiles, left, corridors: parts[0]?.corridors || 0, skipped: parts[0]?.skipped || 0 } });
}
