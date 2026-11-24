// Asset files made from a generated map as Blobs, without starting a download (the export panel's one file per tile:
// components/panels/ExportPanel.vue).
import { exportTer } from './exportTer.js';
import { encode } from 'fast-png';

/**
 * Generate a 16-bit PNG heightmap as a Blob.
 */
export function generateHeightmapBlob(terrainData, normalization = null) {
  const { width, height, heightMap } = terrainData;
  const minHeight = Number.isFinite(normalization?.minHeight)
    ? normalization.minHeight
    : terrainData.minHeight;
  const maxHeight = Number.isFinite(normalization?.maxHeight)
    ? normalization.maxHeight
    : terrainData.maxHeight;
  const data = new Uint16Array(width * height);
  const range = maxHeight - minHeight;

  for (let i = 0; i < heightMap.length; i++) {
    const h = heightMap[i];
    if (!Number.isFinite(h)) {
      data[i] = 0;
      continue;
    }
    let val = range > 0 ? Math.floor(((h - minHeight) / range) * 65535) : 0;
    data[i] = Math.max(0, Math.min(65535, val));
  }

  const pngData = encode({ width, height, data, depth: 16, channels: 1 });
  return new Blob([new Uint8Array(pngData)], { type: 'image/png' });
}

/** The terrain as a BeamNG .ter file. */
export async function generateTerBlob(terrainData) {
  const { blob } = await exportTer(terrainData);
  return blob;
}
