// The export's data step: the downloads a level export needs beyond what
// Generate Data / Preview 3D fetched (the surrounding backdrop's elevation and
// satellite, the US lidar survey along the bridges), fetched ahead into the
// download cache: in the background as soon as the export panel's options ask
// for them, and finished before the export begins. The export itself then
// only processes: it finds every response in the cache (the browser's
// services/dataCache.js; the desktop app's disk cache) and runs under the
// download guard.
//
// The requests are the export's own (exportDataInputs, fetchSurroundings,
// prefetchLidarDecks), so nothing here decides what to download.
import { exportDataInputs, prefetchLidarDecks, BACKDROP_FETCH } from './exportBeamNGLevel.js';
import { fetchSurroundings } from './export3d.js';
import { fetchOsmWater } from './osm.js';

// (the backdrop's area: the map and the eight tiles round it, each the map's size)
export const backdropBounds = (b) => {
  const la = b.north - b.south; const lo = b.east - b.west;
  return { north: b.north + la, south: b.south - la, east: b.east + lo, west: b.west - lo };
};

/**
 * What the export will download for these options ({ includeBackdrop,
 * backdropElevationSource, backdropGpxzApiKey, roadType, includeBridges,
 * lidarDecks, structureSolver }), or null when nothing: { backdrop, lidar, key }.
 */
export function exportDataNeeds(terrainData, options = {}) {
  if (!terrainData?.bounds || !terrainData?.width) return null;
  const backdrop = options.includeBackdrop
    ? { source: options.backdropElevationSource || 'global30m', gpxz: options.backdropElevationSource === 'gpxz' ? String(options.backdropGpxzApiKey || '') : '' }
    : null;
  const lidar = options.roadType !== 'none' && options.includeBridges !== false && options.lidarDecks !== false
    && (options.structureSolver ?? 'v2') === 'v2'
    && (terrainData.osmFeatures || []).some((f) => f?.type === 'road' && f.tags?.bridge && f.tags.bridge !== 'no');
  // the water carried out over the backdrop: lakes, ponds, rivers round the
  // map (not with water off, nor where the user drew background areas)
  const water = !!backdrop && options.includeWater !== false && !(terrainData.backgroundMask || options.backgroundMask);
  if (!backdrop && !lidar) return null;
  const b = terrainData.bounds;
  const key = [b.north, b.south, b.east, b.west].map((v) => Number(v).toFixed(6)).join(',')
    + `|${terrainData.width}x${terrainData.height}|${backdrop ? backdrop.source : '-'}|${lidar ? 'lidar' : '-'}|${water ? 'water' : '-'}`
    + `|${terrainData.backgroundMask ? JSON.stringify(terrainData.backgroundMask).length : 0}`;
  return { backdrop, lidar, water, key };
}

/**
 * Fetch the export's downloads into the cache (the responses themselves are
 * dropped: the export reads them back). onProgress(text, fraction 0..1).
 * Resolves { backdrop: bool, lidar: summary | null }.
 */
export async function downloadExportData(terrainData, options = {}, { onProgress, lidarProvider } = {}) {
  const needs = exportDataNeeds(terrainData, options);
  if (!needs) return { backdrop: false, lidar: null };
  const { terrainData: td, squareSize } = exportDataInputs(terrainData, options);
  const parts = (needs.backdrop ? 1 : 0) + (needs.lidar ? 1 : 0) + (needs.water ? 1 : 0);
  let done = 0;
  const step = (text, f) => onProgress?.(text, (done + Math.max(0, Math.min(1, f || 0))) / parts);
  const out = { backdrop: false, lidar: null, surroundWater: null };
  if (needs.backdrop) {
    step('Downloading the surroundings (elevation and satellite, 8 tiles)…', 0);
    await fetchSurroundings(td, (text) => step(`Surroundings: ${String(text).replace(/\.\.\.$/, '…')}`, 0), {
      ...BACKDROP_FETCH,
      elevationSource: needs.backdrop.source,
      gpxzApiKey: needs.backdrop.gpxz,
      onDownloadProgress: ({ completedTotal, total }) => { if (total > 0) step('Downloading the surroundings…', completedTotal / total); },
    });
    out.backdrop = true;
    done++;
  }
  if (needs.lidar) {
    step('Reading measured bridge heights (US lidar survey)…', 0);
    try {
      const r = await prefetchLidarDecks(td, squareSize, { lidarProvider }, (k, n) => step(`Bridge heights (US lidar): node ${k + 1} of ${n}…`, n ? k / n : 0));
      out.lidar = r?.skipped ? { skipped: r.skipped } : { dataset: r.dataset, nodes: r.nodes, bytes: r.bytes };
    } catch (err) {
      out.lidar = { skipped: String(err?.message || err) };
    }
    done++;
  }
  if (needs.water) {
    step('Downloading the lakes and rivers round the map…', 0);
    try {
      out.surroundWater = await fetchOsmWater(backdropBounds(td.bounds));
    } catch (err) {
      console.warn('[Export data] the water round the map could not be read:', err?.message || err);
      out.surroundWater = null;
    }
    done++;
  }
  onProgress?.('Downloads ready', 1);
  return out;
}

// ---- one data step per area and options, shared by the panel and the export ----

const runs = new Map();   // key → { promise, state: { status, text, fraction, result, error } }
const listeners = new Set();
const emit = () => { for (const fn of listeners) fn(); };

/** Watch the data step's state (the export panel's line under Surroundings). Returns unsubscribe. */
export function onExportDataChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** The data step's state for these options: null (nothing to download) or { status: 'running' | 'done' | 'failed', text, fraction }. */
export function exportDataState(terrainData, options) {
  const needs = exportDataNeeds(terrainData, options);
  if (!needs) return null;
  return runs.get(needs.key)?.state || { status: 'idle', text: '', fraction: 0 };
}

/**
 * Start (or join) the data step for these options. run(terrainData, options,
 * onProgress) does the downloads: downloadExportData in the page, the desktop
 * app's runner there. Resolves when they're in the cache.
 */
export function ensureExportData(terrainData, options, { run = downloadExportData, onProgress } = {}) {
  const needs = exportDataNeeds(terrainData, options);
  if (!needs) return Promise.resolve(null);
  const have = runs.get(needs.key);
  if (have && have.state.status !== 'failed') {
    if (onProgress) { const off = onExportDataChange(() => onProgress(have.state.text, have.state.fraction)); have.promise.finally(off); }
    return have.promise;
  }
  const state = { status: 'running', text: '', fraction: 0, result: null, error: null };
  const entry = { state, promise: null };
  runs.set(needs.key, entry);
  emit();
  entry.promise = Promise.resolve()
    .then(() => run(terrainData, options, (text, fraction) => { state.text = text; state.fraction = fraction; onProgress?.(text, fraction); emit(); }))
    .then((result) => { state.status = 'done'; state.result = result; state.fraction = 1; emit(); return result; })
    .catch((error) => { state.status = 'failed'; state.error = String(error?.message || error); emit(); throw error; });
  return entry.promise;
}

/** Forget finished data steps (a new terrain). */
export function resetExportData() { runs.clear(); emit(); }
