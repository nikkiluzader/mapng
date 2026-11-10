// How much of the satellite image the Game texture takes: a percentage, 0 the
// game's own flat colours only, 50 the look it has had (the default), 100
// twice the image's detail and colour. Read when the texture is painted (at
// Generate) and when the export panel's slider repaints it.
const STORAGE_KEY = 'mapng_gameTextureBlend';
export const DEFAULT_GAME_TEXTURE_BLEND = 50;

const clampPct = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(100, Math.round(Number(v)))) : DEFAULT_GAME_TEXTURE_BLEND);

export function readGameTextureBlend() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw == null || raw === '' ? DEFAULT_GAME_TEXTURE_BLEND : clampPct(raw);
  } catch { return DEFAULT_GAME_TEXTURE_BLEND; }
}

export function writeGameTextureBlend(pct) {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, String(clampPct(pct))); } catch { /* private mode */ }
}

/** The painter's strength for a percentage: 1 at the default, 0 none, 2 at 100 %. */
export const gameTextureBlendStrength = (pct) => clampPct(pct) / DEFAULT_GAME_TEXTURE_BLEND;

/**
 * Paint the Game texture again at a blend, in place on terrainData (the 3D
 * preview and the export read it from there). Returns false when there is
 * nothing to repaint from.
 */
export async function repaintGameTexture(terrainData, pct, { from = terrainData, onProgress } = {}) {
  if (!terrainData || !(terrainData.gameTextureCanvas || terrainData.gameTextureUrl)) return false;
  const { generateGameTexture } = await import('./osmTexture.js');
  const outputSize = terrainData.gameTextureCanvas?.width || terrainData.width;
  // (`from`: the same terrain without Vue's reactive wrapper, for the painter's loops)
  const result = await generateGameTexture(from, { outputSize, satelliteBlend: clampPct(pct), onProgress });
  const old = terrainData.gameTextureUrl;
  terrainData.gameTextureUrl = result.url;
  terrainData.gameTextureCanvas = result.canvas;
  terrainData.gameTextureBlob = result.blob || null;
  if (old && old !== result.url && old.startsWith('blob:')) { try { URL.revokeObjectURL(old); } catch { /* gone already */ } }
  return true;
}

// ── Live blending ───────────────────────────────────────────────────────────
// Painting the texture takes seconds, so a slider that repaints on every move
// lags behind the hand. Instead the texture is painted three times, once: at
// 0 %, 50 % and 100 % (the anchors). Any setting between is two of them
// cross-faded, which the browser does in a few milliseconds: the texture
// follows the slider. 50 % is the painter's own picture exactly; the others
// are within a shade of what painting at that setting would give.
// Up to ANCHOR_MAX_PX a side (three more textures in memory); larger textures
// keep the repaint on release.
export const ANCHOR_MAX_PX = 4096;
const anchorsOf = new WeakMap();   // terrain (raw) → { size, c0, c50, c100 }

const cloneCanvas = (source, size) => {
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  c.getContext('2d').drawImage(source, 0, 0, size, size);
  return c;
};

/** Can this terrain's Game texture be blended live? (it has one, of a size the anchors may take) */
export function canBlendLive(terrainData) {
  const size = terrainData?.gameTextureCanvas?.width || 0;
  return size > 0 && size <= ANCHOR_MAX_PX && typeof document !== 'undefined';
}

/**
 * The anchors for a terrain, painted once and kept with it. `paintedPct`: the
 * blend its canvas shows now (at 50 it is the middle anchor as it stands).
 * `from`: the terrain without Vue's wrapper. Null when it cannot blend live.
 */
export async function prepareBlendAnchors(terrainData, { from = terrainData, paintedPct = DEFAULT_GAME_TEXTURE_BLEND, onProgress } = {}) {
  if (!canBlendLive(terrainData)) return null;
  const size = terrainData.gameTextureCanvas.width;
  const have = anchorsOf.get(from);
  if (have && have.size === size) return have;
  if (have?.pending) return have.pending;
  const pending = (async () => {
    const { generateGameTexture } = await import('./osmTexture.js');
    const paint = async (pct) => (await generateGameTexture(from, { outputSize: size, satelliteBlend: pct, canvasOnly: true, onProgress })).canvas;
    const c50 = clampPct(paintedPct) === DEFAULT_GAME_TEXTURE_BLEND ? cloneCanvas(terrainData.gameTextureCanvas, size) : await paint(DEFAULT_GAME_TEXTURE_BLEND);
    const c0 = await paint(0);
    const c100 = await paint(100);
    const anchors = { size, c0, c50, c100 };
    anchorsOf.set(from, anchors);
    return anchors;
  })();
  anchorsOf.set(from, { pending });
  try { return await pending; } catch (err) { anchorsOf.delete(from); throw err; }
}

/** The two anchors a setting lies between and how far toward the second: for composeBlend and its tests. */
export function blendMix(pct) {
  const p = clampPct(pct);
  return p <= 50 ? { from: 'c0', to: 'c50', t: p / 50 } : { from: 'c50', to: 'c100', t: (p - 50) / 50 };
}

/** Draw a setting into a canvas from the anchors (milliseconds). */
export function composeBlend(anchors, pct, target) {
  const { from, to, t } = blendMix(pct);
  const ctx = target.getContext('2d');
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'copy'; ctx.globalAlpha = 1;
  ctx.drawImage(anchors[from], 0, 0, target.width, target.height);
  if (t > 0) { ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = t; ctx.drawImage(anchors[to], 0, 0, target.width, target.height); }
  ctx.restore();
}

/** After the slider is let go: the canvas as it stands becomes the texture's file too (its blob and URL). */
export async function commitGameTextureCanvas(terrainData) {
  const canvas = terrainData?.gameTextureCanvas; if (!canvas) return;
  const blob = await new Promise((r) => canvas.toBlob((b) => r(b || null), 'image/png'));
  if (!blob || terrainData.gameTextureCanvas !== canvas) return;
  const old = terrainData.gameTextureUrl;
  terrainData.gameTextureBlob = blob;
  terrainData.gameTextureUrl = URL.createObjectURL(blob);
  if (old && old.startsWith('blob:')) { try { URL.revokeObjectURL(old); } catch { /* gone already */ } }
}
