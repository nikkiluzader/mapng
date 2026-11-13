// A road's paved width measured from the satellite picture (Esri World Imagery at zoom 19: about 0.3 m a
// pixel), for roads OpenStreetMap gives no width. Without it a road gets its class's usual width, and a rural
// road 5.9 m wide came out several metres wider (a BeamNG developer's report, 2026-11-13).
//
// Across the road every few metres: the colour 12 m to each side. The road's own colour is read at the centre
// line; walking out each way, the edge is where the colour has left it for a metre. A road's width is the
// median of its cross-sections, and it is kept only where they agree: under trees, in shadow or between parked
// cars they do not, and the road keeps the width it had. Opt in (Map data > Measure road widths), at Generate.
import { loadDataImage } from './dataCache.js';

export const MEASURE_WIDTHS_STORAGE_KEY = 'mapng_measureRoadWidths';
export const WIDTH_SOURCE_TAG = 'mapng:width_source';
const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
const Z = 19;
const HALF_M = 12;            // looked at to each side of the centre line
const STEP_M = 0.25;          // along a cross-section
const EVERY_M = 5;            // between cross-sections
const MAX_SECTIONS = 160;     // per road piece (a long one: spread evenly)
const MIN_SECTIONS = 6;
const EDGE_RUN_M = 1;         // the colour has to stay off the road's for this long
const MIN_WIDTH_M = 2.5, MAX_WIDTH_M = 2 * HALF_M - 2;
const MAX_TILES = 1500;       // one Generate (about 20 MB at most); main roads first
const CONCURRENCY = 12;
// (in order of who is measured first when the tile budget runs out)
const CLASSES = ['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential'];

export const measureWidthsEnabled = () => {
  try { return globalThis.localStorage?.getItem(MEASURE_WIDTHS_STORAGE_KEY) === 'true'; } catch { return false; }
};

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * q; const lo = Math.floor(i); return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (i - lo); };

/** One cross-section: colours (array of [r,g,b] | null, centre in the middle, STEP_M apart) -> width in metres or null. */
export function widthOfSection(profile, stepM = STEP_M) {
  const n = profile.length; const mid = n >> 1;
  if (profile.some((c) => !c)) return null;
  const core = [0, 1, 2].map((k) => median(profile.slice(mid - 4, mid + 5).map((c) => c[k])));
  const d = profile.map((c) => Math.hypot(c[0] - core[0], c[1] - core[1], c[2] - core[2]));
  // (the road's own scatter around its colour sets how far off counts as off)
  const limit = Math.max(22, 3 * median(d.slice(mid - 6, mid + 7)) + 10);
  const run = Math.max(1, Math.round(EDGE_RUN_M / stepM));
  const edge = (sign) => {
    for (let k = mid; k > run && k < n - run - 1; k += sign) {
      let off = true;
      for (let j = 0; j < run && off; j++) off = d[k + sign * j] > limit;
      if (off) return Math.abs(k - mid) * stepM;
    }
    return null;
  };
  const left = edge(-1), right = edge(1);
  if (left === null || right === null) return null;
  const w = left + right;
  return w >= MIN_WIDTH_M && w <= MAX_WIDTH_M ? w : null;
}

/** Cross-sections' widths -> { width, sections, spread } when they agree, else null. */
export function agreedWidth(widths) {
  if (widths.length < MIN_SECTIONS) return null;
  const m = median(widths); const spread = quantile(widths, 0.75) - quantile(widths, 0.25);
  if (spread > Math.max(1.5, 0.3 * m)) return null;
  return { width: Math.round(m * 10) / 10, sections: widths.length, spread: Math.round(spread * 10) / 10 };
}

/** Roads worth measuring: a paved class on the ground, with no width given. */
export function roadsToMeasure(features) {
  const rank = new Map(CLASSES.map((c, i) => [c, i]));
  return (features || []).filter((f) => {
    const t = f?.tags || {};
    if (f.type !== 'road' || !rank.has(t.highway) || !Array.isArray(f.geometry) || f.geometry.length < 2) return false;
    if (t.width || t['width:carriageway'] || t.area === 'yes') return false;
    if ((t.bridge && t.bridge !== 'no') || (t.tunnel && t.tunnel !== 'no') || t.covered === 'yes') return false;
    if (/^(unpaved|gravel|dirt|ground|grass|sand|compacted|fine_gravel|earth|mud)$/.test(String(t.surface || ''))) return false;
    return true;
  }).sort((a, b) => rank.get(a.tags.highway) - rank.get(b.tags.highway));
}

const pixelOf = (lat, lng) => {
  const n = 2 ** Z * 256; const r = (lat * Math.PI) / 180;
  return { x: ((lng + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
};

/** The cross-sections of a road piece: [{ lat, lng, nLat, nLng }] (centre, and one metre to the left in degrees). */
export function sectionsOf(geometry) {
  const lat0 = geometry[0].lat; const mLat = 1 / 111320; const mLng = 1 / (111320 * Math.cos((lat0 * Math.PI) / 180));
  const pts = geometry.map((p) => ({ x: p.lng / mLng, y: p.lat / mLat }));
  let total = 0; for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const every = Math.max(EVERY_M, total / MAX_SECTIONS); const out = [];
  let next = every / 2, walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]; const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.5) { walked += len; continue; }
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    for (; next <= walked + len; next += every) {
      const s = next - walked;
      out.push({ lat: (a.y + uy * s) * mLat, lng: (a.x + ux * s) * mLng, nLat: ux * mLat, nLng: -uy * mLng });
    }
    walked += len;
  }
  return out;
}

const tilesOfSection = (s) => {
  const keys = new Set();
  for (const o of [-HALF_M, 0, HALF_M]) { const p = pixelOf(s.lat + s.nLat * o, s.lng + s.nLng * o); keys.add(`${Math.floor(p.x / 256)}/${Math.floor(p.y / 256)}`); }
  return keys;
};

/** A road piece's width from its cross-sections, colours read through colourAt(lat, lng) -> [r,g,b] | null. */
export function measureRoad(geometry, colourAt) {
  const widths = [];
  for (const s of sectionsOf(geometry)) {
    const profile = [];
    for (let o = -HALF_M; o <= HALF_M + 1e-9; o += STEP_M) profile.push(colourAt(s.lat + s.nLat * o, s.lng + s.nLng * o));
    const w = widthOfSection(profile);
    if (w !== null) widths.push(w);
  }
  return agreedWidth(widths);
}

async function tilePixels(x, y, signal) {
  // (blankTile=false: no placeholder picture where zoom 19 was never flown; that road is then not measured)
  const img = await loadDataImage(`${TILE_URL}/${Z}/${y}/${x}?blankTile=false`, signal).catch(() => null);
  if (!img) return null;
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, 256, 256);
  return ctx.getImageData(0, 0, 256, 256).data;
}

/**
 * Measure and write the widths: each measured road gets tags.width and mapng:width_source=satellite.
 * Pieces of one named road take the road's width (the median over its pieces that agree) where at least a
 * quarter of its length was clear, so it does not step from piece to piece. Returns { asked, measured, refused, tiles, skippedForBudget }.
 */
export async function measureRoadWidths(features, { onProgress, signal, loadTile = tilePixels, maxTiles = MAX_TILES } = {}) {
  const roads = roadsToMeasure(features);
  const wanted = new Map(); const taken = []; let skippedForBudget = 0;
  for (const f of roads) {
    const keys = new Set(); for (const s of sectionsOf(f.geometry)) for (const k of tilesOfSection(s)) keys.add(k);
    const fresh = [...keys].filter((k) => !wanted.has(k));
    if (wanted.size + fresh.length > maxTiles) { skippedForBudget++; continue; }
    for (const k of fresh) wanted.set(k, null);
    taken.push(f);
  }
  const keys = [...wanted.keys()]; let done = 0, at = 0;
  const worker = async () => {
    while (at < keys.length) {
      signal?.throwIfAborted();
      const k = keys[at++]; const [x, y] = k.split('/').map(Number);
      wanted.set(k, await loadTile(x, y, signal));
      if (++done % 50 === 0 || done === keys.length) onProgress?.(`Measuring road widths from the satellite picture: ${done}/${keys.length} tiles...`);
    }
  };
  if (keys.length) onProgress?.(`Measuring road widths from the satellite picture: 0/${keys.length} tiles...`);
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, keys.length) }, worker));
  const colourAt = (lat, lng) => {
    const p = pixelOf(lat, lng); const data = wanted.get(`${Math.floor(p.x / 256)}/${Math.floor(p.y / 256)}`);
    if (!data) return null;
    const i = ((Math.floor(p.y) & 255) * 256 + (Math.floor(p.x) & 255)) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const results = taken.map((f) => ({ f, got: measureRoad(f.geometry, colourAt) }));
  // (a named road: one width for all its pieces, from the pieces that agree, when enough of it does)
  const groups = new Map();
  for (const r of results) {
    const t = r.f.tags; const name = t.name || t.ref;
    const key = name ? `${t.highway}|${name}|${t.lanes || ''}|${t.oneway || ''}` : null;
    if (key) { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); }
  }
  for (const rs of groups.values()) {
    const good = rs.filter((r) => r.got);
    // (by length: where under a quarter of the road was clear, only its clear pieces take their own width)
    const len = (r) => sectionsOf(r.f.geometry).length;
    const clear = good.reduce((sum, r) => sum + len(r), 0), all = rs.reduce((sum, r) => sum + len(r), 0);
    if (!good.length || clear < 0.25 * all) continue;
    const w = Math.round(median(good.map((r) => r.got.width)) * 10) / 10;
    for (const r of rs) r.got = { ...(r.got || { sections: 0 }), width: w };
  }
  let measured = 0;
  for (const { f, got } of results) {
    if (!got) continue;
    f.tags = { ...f.tags, width: String(got.width), [WIDTH_SOURCE_TAG]: 'satellite' };
    measured++;
  }
  const summary = { asked: roads.length, measured, refused: taken.length - measured, tiles: keys.length, skippedForBudget };
  console.log(`[Road widths] ${measured} of ${roads.length} road pieces measured from the satellite picture (${summary.refused} not clear enough, ${skippedForBudget} over the tile budget; ${keys.length} tiles)`);
  return summary;
}

/** The step Generate runs after the map data is in: measures when the setting is on; never fails the Generate. */
export async function withMeasuredWidths(features, { onProgress, signal } = {}) {
  if (!measureWidthsEnabled() || !Array.isArray(features) || !features.length) return features;
  try { await measureRoadWidths(features, { onProgress, signal }); } catch (e) {
    if (signal?.aborted) throw e;
    console.warn('[Road widths] measuring failed; roads keep their usual widths:', e?.message || e);
  }
  return features;
}
