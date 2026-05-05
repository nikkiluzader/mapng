/**
 * Export a BeamNG terrain .ter binary (version 9).
 *
 * @param {object} terrainData
 * @param {object} [options]
 * @param {Uint8Array} [options.layerMap]       — material index per pixel (size×size),
 *                                                terrain space: 0,0=SW, y increases N.
 *                                                Defaults to all-zero (single material).
 * @param {string[]}  [options.materialNames]   — ordered material name list.
 *                                                Index 0 = fallback (must match .terrain.json).
 *                                                Defaults to ['DefaultMaterial'].
 */
export async function exportTer(terrainData, {
  layerMap: customLayerMap = null,
  materialNames: customMaterialNames = null,
} = {}) {
  const { width, height, heightMap, minHeight, maxHeight } = terrainData;

  // BeamNG terrains must be square power-of-two — clip down to fit.
  const squareSize = Math.min(width, height);
  const size = squareSize >= 2 ? 2 ** Math.floor(Math.log2(squareSize)) : squareSize;

  if (size !== width || size !== height) {
    console.warn('[exportTer] Terrain size normalized for BeamNG compatibility', {
      sourceWidth: width,
      sourceHeight: height,
      exportedSize: size,
    });
  }

  const materialNames = customMaterialNames ?? ['DefaultMaterial'];

  const encoder = new TextEncoder();

  // Pre-encode all material name strings and compute header sizes.
  const encodedNames = materialNames.map(n => encoder.encode(n));
  let materialNamesBytes = 0;
  for (const bytes of encodedNames) {
    materialNamesBytes += bytes.length < 255 ? 1 + bytes.length : 3 + bytes.length;
  }

  const headerSize        = 5;                    // version(1) + size(4)
  const heightmapSize     = size * size * 2;      // uint16 per pixel
  const layerMapSize      = size * size;           // uint8 per pixel
  const materialListHeader = 4;                   // uint32 material count

  const totalSize = headerSize + heightmapSize + layerMapSize + materialListHeader + materialNamesBytes;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  let offset = 0;

  // ── Header ─────────────────────────────────────────────────────────────
  view.setUint8(offset, 0x09);   // version 9
  offset += 1;
  view.setUint32(offset, size, true);
  offset += 4;

  // ── Heightmap ──────────────────────────────────────────────────────────
  // Row-major, first row = bottom of terrain (south edge) — Y is flipped
  // relative to the heightMap array (which has row 0 at the top/north).
  const range = maxHeight - minHeight;
  for (let y = size - 1; y >= 0; y--) {
    for (let x = 0; x < size; x++) {
      const srcIdx = y * width + x;
      const h = heightMap[srcIdx];
      let val = 0;
      if (range > 0) val = Math.floor(((h - minHeight) / range) * 65535);
      val = Math.max(0, Math.min(65535, val));
      view.setUint16(offset, val, true);
      offset += 2;
    }
  }

  // ── Layer map ──────────────────────────────────────────────────────────
  // Layer map from osmTerrainMaterials is already in terrain space (0,0=SW,
  // y increases northward), which matches the .ter bottom-left origin.
  // The heightmap Y-flip above does NOT apply here — the layer map bytes
  // are written south-to-north (row 0 of the .ter = south edge of terrain),
  // matching how the layer map Uint8Array was built.
  const layerMapView = new Uint8Array(buffer, offset, layerMapSize);
  if (customLayerMap && customLayerMap.length >= layerMapSize) {
    layerMapView.set(customLayerMap.subarray(0, layerMapSize));
  }
  // else: all zeros (DefaultMaterial everywhere)
  offset += layerMapSize;

  // ── Material name list ─────────────────────────────────────────────────
  view.setUint32(offset, materialNames.length, true);
  offset += 4;

  for (const bytes of encodedNames) {
    if (bytes.length < 255) {
      view.setUint8(offset, bytes.length);
      offset += 1;
    } else {
      view.setUint8(offset, 0xFF);
      offset += 1;
      view.setUint16(offset, bytes.length, true);
      offset += 2;
    }
    new Uint8Array(buffer, offset, bytes.length).set(bytes);
    offset += bytes.length;
  }

  return {
    blob: new Blob([buffer], { type: 'application/octet-stream' }),
    filename: 'theTerrain.ter',
  };
}
