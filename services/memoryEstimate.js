// How much memory a desktop export will need at its peak, shown before exporting (export panel, beside how heavy
// the level will be), against the computer's own memory.
//
// Measured, not guessed: the desktop app run whole (Generate, then the BeamNG export) on three kinds of place
// (mountains, a mixed town, a dense downtown) at 2, 4, 8 and 16 km, each process's memory read every second
// (scratch/memprobe, 2026-11-18). Two things drive the peak, and different steps hold it:
//  - the terrain and everything round it grow with the map's pixels and a little with its map data;
//  - the 3D buildings step grows with the map data (points of every mapped way and area), more slowly than it.
// The peak is the larger of the two, with a margin: over on small maps, close on the big ones (the safe side
// for a warning). Elevation source made no difference (within 1 GB).
//
// estimateExportMemory({ terrainPx, metersPerPixel, mapPoints, includeBuildings }) -> { gb, step }
// memoryFit(gb, totalBytes) -> 'fits' | 'tight' | 'tooMuch'

// (coefficients from the measurements with at most 8 worker threads, services/parallel.js MAX_THREADS: ten jobs
// from 2 to 16 km, scratch/memprobe/model_cap.json. A dense downtown's peak is in packing the level, which the
// fit reads up to 20 % low: hence the margin, so the warning errs on the safe side.)
const REST = { base: 4.99, perMpx: 0.036, perKPoints: 0.0127 };
const BUILDINGS = { base: -0.32, scale: 0.26, power: 0.658 };
const MARGIN = 1.2;

/** Points in the map data: the outline vertices of every mapped way and area, as the measurements counted them. */
export function countMapPoints(features) {
  let n = 0;
  for (const f of features || []) if (Array.isArray(f?.geometry)) n += f.geometry.length;
  return n;
}

/**
 * @param {object} p
 * @param {number} p.terrainPx       terrain width in pixels (square)
 * @param {number} p.metersPerPixel  unused for now: the measurements were all at 1 m (pixels drive the memory)
 * @param {number} p.mapPoints       countMapPoints(osmFeatures)
 * @param {boolean} p.includeBuildings
 * @returns {{ gb: number, step: 'terrain'|'buildings' }}
 */
export function estimateExportMemory({ terrainPx = 0, mapPoints = 0, includeBuildings = true } = {}) {
  const mpx = (Math.max(0, Number(terrainPx) || 0) ** 2) / 1e6;
  const kPoints = Math.max(0, Number(mapPoints) || 0) / 1000;
  const rest = REST.base + REST.perMpx * mpx + REST.perKPoints * kPoints;
  const buildings = includeBuildings ? BUILDINGS.base + BUILDINGS.scale * kPoints ** BUILDINGS.power : 0;
  return buildings > rest ? { gb: buildings * MARGIN, step: 'buildings' } : { gb: rest * MARGIN, step: 'terrain' };
}

// (the export's own process may use three quarters of the memory: desktop/main.js spawnRunner; the window, the
// system and the other programs need the rest)
const FITS_SHARE = 0.6;
const TIGHT_SHARE = 0.8;

/** Whether gb fits a computer with totalBytes of memory. */
export function memoryFit(gb, totalBytes) {
  const total = (Number(totalBytes) || 0) / 2 ** 30;
  if (!(total > 0) || !(gb > 0)) return null;
  if (gb <= total * FITS_SHARE) return 'fits';
  if (gb <= total * TIGHT_SHARE) return 'tight';
  return 'tooMuch';
}

// ── Generate ──────────────────────────────────────────────────────────────────
// What the desktop app's Generate step needs at its peak, by the map's pixels: its own process measured through
// whole runs at 2, 4, 8 and 16 km (scratch/memprobe/samples, 2026-11-18: 1.0-1.4, 3.1-4.0, 5.9-7.6 and 8.6-10.4 GB)
// and alone at 8192 x 2 m in a dense place (scratch/memprobe/gen_peak.mjs, 2026-11-24: 7.0 GB after the textures'
// canvases are let go; 8.65 GB before, which a 16 GB computer could not give: report MR-PM849Z). The upper figures,
// read between the measured sizes. A map built in chunks is generated a chunk at a time: one chunk's pixels count.
const GENERATE_GB = [[0, 0.6], [4.2, 1.4], [16.8, 4.0], [67.1, 7.6], [268.4, 10.5]];

/** @returns {number} GB at the peak of generating a map of widthPx x heightPx. */
export function estimateGenerateMemory({ widthPx = 0, heightPx = widthPx } = {}) {
  const mpx = (Math.max(0, Number(widthPx) || 0) * Math.max(0, Number(heightPx) || 0)) / 1e6;
  for (let i = 1; i < GENERATE_GB.length; i++) {
    const [m0, g0] = GENERATE_GB[i - 1]; const [m1, g1] = GENERATE_GB[i];
    if (mpx <= m1) return g0 + ((g1 - g0) * (mpx - m0)) / (m1 - m0);
  }
  // (past the largest measured map: its slope carried on)
  const [ma, ga] = GENERATE_GB[GENERATE_GB.length - 2]; const [mb, gb] = GENERATE_GB[GENERATE_GB.length - 1];
  return gb + ((gb - ga) / (mb - ma)) * (mpx - mb);
}
