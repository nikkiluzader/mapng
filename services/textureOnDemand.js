// Textures made when they are first wanted.
//
// Generate paints all three (the OSM, the hybrid and the game texture) for every map. A terrain that still
// lacks one (made by an older version, a batch tile, a level opened for Modify) gets it painted here
// the first time something asks for it: the level export with another ground texture, a 2D asset's download, a
// 3D model's texture, a preview's texture picker. Nothing is downloaded for it: the map data and the satellite
// picture came with the Generate.
import { generateOSMTexture, generateHybridTexture, generateGameTexture } from './osmTexture.js';

export const TEXTURE_KINDS = ['osm', 'hybrid', 'game'];

/** The painted texture a ground-texture choice needs: 'osm' | 'hybrid' | 'game', or null (satellite, none). */
export const textureKindOf = (choice) => (choice === 'painted' ? 'hybrid' : TEXTURE_KINDS.includes(choice) ? choice : null);

/** Whether the terrain already carries that texture, in any of the forms the app keeps it in. */
export function hasTexture(terrainData, kind) {
  const k = textureKindOf(kind);
  if (!k || !terrainData) return false;
  return !!(terrainData[`${k}TextureCanvas`] || terrainData[`${k}TextureBlob`] || terrainData[`${k}TextureUrl`]);
}

/**
 * Generate's three switches: all three textures are painted, every time, whatever ground texture is
 * chosen. (For 0.3.1 only the chosen one was painted, to save a third of a large Generate. But the
 * choice is made after Generate, in the previews and the export panel, so the one kept from last time
 * decided what a new map got: with "satellite" kept, no game texture at all, and the previews offered
 * none. The developer's rule since 2026-11-15: Generate always makes all of them.)
 */
export function texturesToGenerate() {
  return { generateOSMTextureAsset: true, generateHybridTextureAsset: true, generateGameTextureAsset: true };
}

const running = new WeakMap();   // terrainData -> Map kind -> Promise

/**
 * Make sure the terrain has the texture, painting it now if it has not. Resolves true when it has it (already,
 * or now), false when it cannot be made (no map data, or no such texture). `assignTo`: where the result is
 * also written (the app's reactive copy of the same terrain, so the page sees it).
 */
export async function ensureTexture(terrainData, kind, { onProgress, assignTo = null, generators = null } = {}) {
  const k = textureKindOf(kind);
  if (!k || !terrainData) return false;
  if (hasTexture(terrainData, k)) return true;
  if (!Array.isArray(terrainData.osmFeatures) || terrainData.osmFeatures.length === 0) return false;
  let mine = running.get(terrainData);
  if (!mine) { mine = new Map(); running.set(terrainData, mine); }
  if (!mine.has(k)) {
    const make = (generators || { osm: generateOSMTexture, hybrid: generateHybridTexture, game: generateGameTexture })[k];
    mine.set(k, (async () => {
      try {
        const result = await make(terrainData, { Roads: true, onProgress });
        for (const target of [terrainData, assignTo]) {
          if (!target) continue;
          target[`${k}TextureUrl`] = result.url;
          target[`${k}TextureCanvas`] = result.canvas;
          target[`${k}TextureBlob`] = result.blob || null;
        }
        return hasTexture(terrainData, k);
      } finally { mine.delete(k); }
    })());
  }
  return mine.get(k);
}
