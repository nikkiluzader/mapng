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
