/**
 * batchExports.js — Pure functions that generate export Blobs from terrainData.
 * Used by the batch job runner to produce tile exports without triggering downloads.
 */

import { encode } from 'fast-png';
import { createWGS84ToLocal } from './geoUtils.js';
import { exportGeoTiff } from './exportGeoTiff.js';
import { segmentSatelliteTexture } from './segmentation.js';
import { generateSegmentedHybridTexture } from './osmTexture.js';

const isJsonMimeType = (mime = '') => {
  const normalized = String(mime).toLowerCase();
  return normalized.includes('application/json') || normalized.includes('text/json');
};

const normalizeBlobType = async (blob, expectedMimeType, fallbackMimeType = expectedMimeType) => {
  if (!blob) return null;
  if (isJsonMimeType(blob.type)) {
    throw new Error(`Expected ${expectedMimeType} blob but received JSON payload.`);
  }

  const currentType = String(blob.type || '').toLowerCase();
  const expectedType = String(expectedMimeType || '').toLowerCase();
  if (expectedType && currentType !== expectedType) {
    const buffer = await blob.arrayBuffer();
    return new Blob([buffer], { type: fallbackMimeType || expectedMimeType || 'application/octet-stream' });
  }

  if (!blob.type && (fallbackMimeType || expectedMimeType)) {
    const buffer = await blob.arrayBuffer();
    return new Blob([buffer], { type: fallbackMimeType || expectedMimeType });
  }

  return blob;
};

const fetchTypedBlob = async (url, expectedMimeType, fallbackMimeType = expectedMimeType) => {
  const response = await fetch(url);
  const blob = await response.blob();
  return normalizeBlobType(blob, expectedMimeType, fallbackMimeType);
};

const canvasToBlob = (canvas, type = 'image/png', quality) => {
  if (!canvas) return Promise.resolve(null);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob || null), type, quality);
  });
};

/**
 * Generate a 16-bit PNG heightmap as a Blob.
 */
export function generateHeightmapBlob(terrainData) {
  const { width, height, heightMap, minHeight, maxHeight } = terrainData;
  const data = new Uint16Array(width * height);
  const range = maxHeight - minHeight;

  for (let i = 0; i < heightMap.length; i++) {
    const h = heightMap[i];
    let val = range > 0 ? Math.floor(((h - minHeight) / range) * 65535) : 0;
    data[i] = Math.max(0, Math.min(65535, val));
  }

  const pngData = encode({ width, height, data, depth: 16, channels: 1 });
  return new Blob([new Uint8Array(pngData)], { type: 'image/png' });
}

/**
 * Generate a satellite texture PNG Blob from the terrainData's dataURL.
 */
export async function generateSatelliteBlob(terrainData) {
  if (!terrainData.satelliteTextureUrl) return null;

  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = terrainData.satelliteTextureUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const blob = await new Promise((resolve) => canvas.toBlob((value) => resolve(value || null), 'image/png'));
  return normalizeBlobType(blob, 'image/png');
}

/**
 * Fetch the OSM texture blob URL and return the Blob.
 */
export async function generateOSMTextureBlob(terrainData) {
  if (terrainData.osmTextureBlob) return normalizeBlobType(terrainData.osmTextureBlob, 'image/png');
  if (terrainData.osmTextureCanvas) {
    const blob = await canvasToBlob(terrainData.osmTextureCanvas, 'image/png');
    return normalizeBlobType(blob, 'image/png');
  }
  if (!terrainData.osmTextureUrl) return null;
  return fetchTypedBlob(terrainData.osmTextureUrl, 'image/png');
}

/**
 * Fetch the hybrid texture blob URL and return the Blob.
 */
export async function generateHybridTextureBlob(terrainData) {
  if (terrainData.hybridTextureBlob) return normalizeBlobType(terrainData.hybridTextureBlob, 'image/png');
  if (terrainData.hybridTextureCanvas) {
    const blob = await canvasToBlob(terrainData.hybridTextureCanvas, 'image/png');
    return normalizeBlobType(blob, 'image/png');
  }
  if (!terrainData.hybridTextureUrl) return null;
  return fetchTypedBlob(terrainData.hybridTextureUrl, 'image/png');
}

/**
 * Generate a 16-bit road mask PNG Blob.
 */
export function generateRoadMaskBlob(terrainData, center) {
  if (!terrainData.osmFeatures || terrainData.osmFeatures.length === 0) return null;

  const { width, height } = terrainData;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, width, height);

  const toLocal = createWGS84ToLocal(center.lat, center.lng);

  ctx.strokeStyle = 'white';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const exclude = ['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway', 'corridor'];

  terrainData.osmFeatures.forEach(feature => {
    if (feature.type !== 'road') return;
    const highway = feature.tags?.highway;
    if (highway && exclude.includes(highway)) return;

    ctx.beginPath();
    feature.geometry.forEach((pt, index) => {
      const [x, y] = toLocal.forward([pt.lng, pt.lat]);
      const u = x + width / 2;
      const v = height / 2 - y;
      if (index === 0) ctx.moveTo(u, v);
      else ctx.lineTo(u, v);
    });
    ctx.stroke();
  });

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = new Uint16Array(width * height);
  for (let i = 0; i < data.length; i++) {
    data[i] = imageData.data[i * 4] > 128 ? 65535 : 0;
  }

  const pngData = encode({ width, height, data, depth: 16, channels: 1 });
  return new Blob([new Uint8Array(pngData)], { type: 'image/png' });
}

/**
 * Generate a segmented satellite texture Blob via mean-shift segmentation.
 */
export async function generateSegmentedSatelliteBlob(terrainData) {
  if (terrainData.segmentedTextureBlob) return normalizeBlobType(terrainData.segmentedTextureBlob, 'image/png');
  if (terrainData.segmentedTextureCanvas) {
    const blob = await canvasToBlob(terrainData.segmentedTextureCanvas, 'image/png');
    if (blob) return normalizeBlobType(blob, 'image/png');
  }
  if (terrainData.segmentedTextureUrl) {
    return fetchTypedBlob(terrainData.segmentedTextureUrl, 'image/png');
  }

  if (!terrainData.satelliteTextureUrl) return null;
  const result = await segmentSatelliteTexture(terrainData.satelliteTextureUrl);
  terrainData.segmentedTextureUrl = result.url;
  terrainData.segmentedTextureCanvas = result.canvas;
  terrainData.segmentedTextureBlob = result.blob || null;
  if (result.blob) return normalizeBlobType(result.blob, 'image/png');

  return fetchTypedBlob(result.url, 'image/png');
}

/**
 * Generate a segmented hybrid texture Blob (segmented base + roads overlay).
 */
export async function generateSegmentedHybridBlob(terrainData) {
  if (terrainData.segmentedHybridTextureBlob) return normalizeBlobType(terrainData.segmentedHybridTextureBlob, 'image/png');
  if (terrainData.segmentedHybridTextureCanvas) {
    const blob = await canvasToBlob(terrainData.segmentedHybridTextureCanvas, 'image/png');
    if (blob) return normalizeBlobType(blob, 'image/png');
  }
  if (terrainData.segmentedHybridTextureUrl) {
    return fetchTypedBlob(terrainData.segmentedHybridTextureUrl, 'image/png');
  }

  if (!terrainData.segmentedTextureUrl || !terrainData.osmFeatures?.length) return null;
  const result = await generateSegmentedHybridTexture(terrainData);
  terrainData.segmentedHybridTextureUrl = result.url;
  terrainData.segmentedHybridTextureCanvas = result.canvas;
  terrainData.segmentedHybridTextureBlob = result.blob || null;
  if (result.blob) return normalizeBlobType(result.blob, 'image/png');

  return fetchTypedBlob(result.url, 'image/png');
}

/**
 * Generate GeoTIFF Blob.
 */
export async function generateGeoTIFFBlob(terrainData, center) {
  const { blob } = await exportGeoTiff(terrainData, center);
  return normalizeBlobType(blob, 'image/tiff', 'image/tiff');
}

/**
 * Generate GeoJSON Blob from OSM features.
 */
export function generateGeoJSONBlob(terrainData) {
  if (!terrainData.osmFeatures || terrainData.osmFeatures.length === 0) return null;

  const features = terrainData.osmFeatures.map(f => {
    const coordinates = f.geometry.map(p => [p.lng, p.lat]);
    let geometryType = 'LineString';
    let geometryCoordinates = coordinates;

    const isClosed = coordinates.length > 3 &&
      coordinates[0][0] === coordinates[coordinates.length - 1][0] &&
      coordinates[0][1] === coordinates[coordinates.length - 1][1];

    if (f.type === 'building' || (f.type === 'vegetation' && isClosed)) {
      geometryType = 'Polygon';
      geometryCoordinates = [coordinates];
    }

    return {
      type: 'Feature',
      properties: { id: f.id, feature_type: f.type, ...f.tags },
      geometry: { type: geometryType, coordinates: geometryCoordinates },
    };
  });

  const geoJSON = { type: 'FeatureCollection', features };
  return new Blob([JSON.stringify(geoJSON, null, 2)], { type: 'application/geo+json' });
}
