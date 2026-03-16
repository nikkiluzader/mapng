/**
 * Crops a terrainData object to its center exportCropSize × exportCropSize area.
 * Returns the original terrainData unchanged if exportCropSize is not set.
 *
 * Textures (URL strings) are cropped via an offscreen canvas.
 */

async function cropTextureUrl(url, origWidth, origHeight, startX, startY, cropSize) {
  if (!url) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = cropSize;
      canvas.height = cropSize;
      const ctx = canvas.getContext('2d');
      // Scale the source rect from heightmap pixel space to image pixel space
      const sx = startX * (img.naturalWidth  / origWidth);
      const sy = startY * (img.naturalHeight / origHeight);
      const sw = cropSize * (img.naturalWidth  / origWidth);
      const sh = cropSize * (img.naturalHeight / origHeight);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cropSize, cropSize);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.crossOrigin = 'anonymous';
    img.src = url;
  });
}

function cropHeightmap(heightMap, origWidth, origHeight, startX, startY, cropSize) {
  const out = new Float32Array(cropSize * cropSize);
  for (let row = 0; row < cropSize; row++) {
    const srcRow = startY + row;
    for (let col = 0; col < cropSize; col++) {
      out[row * cropSize + col] = heightMap[(srcRow * origWidth) + (startX + col)];
    }
  }
  return out;
}

function adjustBounds(bounds, origWidth, origHeight, startX, startY, cropSize) {
  const lngPerPx = (bounds.east  - bounds.west)  / origWidth;
  const latPerPx = (bounds.north - bounds.south) / origHeight;
  return {
    west:  bounds.west  + startX          * lngPerPx,
    east:  bounds.west  + (startX + cropSize) * lngPerPx,
    north: bounds.north - startY          * latPerPx,
    south: bounds.north - (startY + cropSize) * latPerPx,
  };
}

function pointInBounds(pt, bounds) {
  return (
    pt &&
    pt.lat <= bounds.north &&
    pt.lat >= bounds.south &&
    pt.lng >= bounds.west &&
    pt.lng <= bounds.east
  );
}

function clampPointToBounds(pt, bounds) {
  return {
    lat: Math.max(bounds.south, Math.min(bounds.north, pt.lat)),
    lng: Math.max(bounds.west, Math.min(bounds.east, pt.lng)),
  };
}

function clipRoadGeometryToBounds(geometry, bounds) {
  if (!Array.isArray(geometry) || geometry.length < 2) return [];
  const segments = [];
  let current = [];

  for (let i = 0; i < geometry.length; i++) {
    const pt = geometry[i];
    const inside = pointInBounds(pt, bounds);

    if (inside) {
      if (current.length === 0 && i > 0) {
        current.push(clampPointToBounds(geometry[i - 1], bounds));
      }
      current.push(pt);
    } else if (current.length > 0) {
      current.push(clampPointToBounds(pt, bounds));
      if (current.length >= 2) segments.push(current);
      current = [];
    }
  }

  if (current.length >= 2) segments.push(current);
  return segments;
}

function cropOSMFeatures(osmFeatures, bounds) {
  if (!Array.isArray(osmFeatures) || !bounds) return osmFeatures;

  const out = [];
  for (const feature of osmFeatures) {
    if (!feature?.geometry?.length) continue;

    if (feature.type === 'road') {
      const pieces = clipRoadGeometryToBounds(feature.geometry, bounds);
      for (const geom of pieces) {
        out.push({ ...feature, geometry: geom });
      }
      continue;
    }

    // Buildings/areas/points: keep only if they overlap cropped bounds.
    const hasAnyInside = feature.geometry.some((pt) => pointInBounds(pt, bounds));
    if (!hasAnyInside) continue;

    const croppedFeature = {
      ...feature,
      geometry: feature.geometry
        .filter((pt) => pointInBounds(pt, bounds))
        .map((pt) => ({ lat: pt.lat, lng: pt.lng })),
    };

    // Preserve minimum shape viability.
    if (feature.type === 'building' && croppedFeature.geometry.length < 3) continue;
    if (feature.type !== 'building' && croppedFeature.geometry.length < 1) continue;

    if (Array.isArray(feature.holes) && feature.holes.length > 0) {
      const holes = feature.holes
        .map((hole) => hole.filter((pt) => pointInBounds(pt, bounds)))
        .filter((hole) => hole.length >= 3);
      if (holes.length > 0) croppedFeature.holes = holes;
      else delete croppedFeature.holes;
    }

    out.push(croppedFeature);
  }

  return out;
}

export async function prepareCroppedTerrainData(terrainData) {
  const cropSize = terrainData?.exportCropSize;
  if (!cropSize) return terrainData;

  const origWidth  = terrainData.width;
  const origHeight = terrainData.height;

  // Center the crop
  const startX = Math.floor((origWidth  - cropSize) / 2);
  const startY = Math.floor((origHeight - cropSize) / 2);

  // Crop heightmap
  const croppedHeightMap = cropHeightmap(
    terrainData.heightMap, origWidth, origHeight, startX, startY, cropSize
  );

  // Recalculate min/max from cropped data
  let minHeight = Infinity, maxHeight = -Infinity;
  for (let i = 0; i < croppedHeightMap.length; i++) {
    const h = croppedHeightMap[i];
    if (h < -10000) continue; // skip NO_DATA
    if (h < minHeight) minHeight = h;
    if (h > maxHeight) maxHeight = h;
  }
  if (minHeight === Infinity) minHeight = terrainData.minHeight;
  if (maxHeight === -Infinity) maxHeight = terrainData.maxHeight;

  // Adjust geographic bounds
  const croppedBounds = adjustBounds(
    terrainData.bounds, origWidth, origHeight, startX, startY, cropSize
  );

  const croppedOSMFeatures = cropOSMFeatures(terrainData.osmFeatures, croppedBounds);

  // Crop all texture URLs in parallel
  const urlFields = [
    'satelliteTextureUrl',
    'osmTextureUrl',
    'hybridTextureUrl',
    'segmentedTextureUrl',
    'segmentedHybridTextureUrl',
  ];
  const croppedUrls = {};
  await Promise.all(
    urlFields.map(async (field) => {
      const url = terrainData[field];
      if (url) {
        croppedUrls[field] = await cropTextureUrl(
          url, origWidth, origHeight, startX, startY, cropSize
        );
      }
    })
  );

  return {
    ...terrainData,
    width:     cropSize,
    height:    cropSize,
    heightMap: croppedHeightMap,
    minHeight,
    maxHeight,
    bounds:    croppedBounds,
    osmFeatures: croppedOSMFeatures,
    // exportCropSize cleared so downstream doesn't try to crop again
    exportCropSize: null,
    ...croppedUrls,
    // Canvas refs are invalidated after crop; clear them
    osmTextureCanvas: null,
    hybridTextureCanvas: null,
    segmentedTextureCanvas: null,
    segmentedHybridTextureCanvas: null,
    // Pre-crop blobs are at the wrong size; clear so URL fallbacks (croppedUrls) are used
    hybridTextureBlob: null,
    osmTextureBlob: null,
    segmentedTextureBlob: null,
    segmentedHybridTextureBlob: null,
    // After crop, all textures are cropSize×cropSize
    hybridTexWidth: cropSize,
  };
}
