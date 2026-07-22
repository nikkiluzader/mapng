import { exportProcessedGeoTiff } from './exportGeoTiff.js';
import { getCompilerBridgeUrl } from './cesiumCompilerPreview.js';

const POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 900;

const toHex = (buffer) => Array.from(new Uint8Array(buffer))
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('');

export const sha256Blob = async (blob) => toHex(
  await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()),
);

export const getLocalMetricCrs = ({ lat, lng }) => {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('COMPILER_LOCATION_INVALID');
  }
  const zone = Math.max(1, Math.min(60, Math.floor((longitude + 180) / 6) + 1));
  return `EPSG:${latitude >= 0 ? 32600 + zone : 32700 + zone}`;
};

export const buildCompilerOsmGeoJson = (osmFeatures = []) => ({
  type: 'FeatureCollection',
  features: osmFeatures
    .filter((feature) => feature?.type === 'road' && Array.isArray(feature.geometry) && feature.geometry.length >= 2)
    .map((feature, index) => ({
      type: 'Feature',
      id: String(feature.id ?? `road_${index}`),
      geometry: {
        type: 'LineString',
        coordinates: feature.geometry.map((point) => [Number(point.lng), Number(point.lat)]),
      },
      properties: {
        id: String(feature.id ?? `road_${index}`),
        ...(feature.tags || {}),
      },
    }))
    .filter((feature) => feature.geometry.coordinates.every(
      ([longitude, latitude]) => Number.isFinite(longitude) && Number.isFinite(latitude),
    )),
});

export const makeCompilerProjectId = (center) => {
  const lat = Number(center?.lat).toFixed(5).replace('-', 'm').replace('.', '_');
  const lng = Number(center?.lng).toFixed(5).replace('-', 'm').replace('.', '_');
  return `mapng_${lat}_${lng}`;
};

const uploadSource = async (path, blob, headers, signal) => {
  const sha256 = await sha256Blob(blob);
  const response = await fetch(`${getCompilerBridgeUrl()}${path}`, {
    method: 'POST',
    body: blob,
    signal,
    headers: {
      'Content-Type': blob.type || 'application/octet-stream',
      'X-Content-SHA256': sha256,
      ...headers,
    },
  });
  if (!response.ok) throw new Error(`COMPILER_SOURCE_UPLOAD_FAILED_${response.status}`);
  return response.json();
};

const waitForCompiler = async (jobId, { signal, onProgress }) => {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    signal?.throwIfAborted?.();
    const response = await fetch(
      `${getCompilerBridgeUrl()}/api/v1/map-compile/${encodeURIComponent(jobId)}`,
      { signal },
    );
    if (!response.ok) throw new Error('COMPILER_STATUS_FAILED');
    const status = await response.json();
    onProgress?.({ stage: 'compiling', jobId, status: status.compile_status });
    if (status.compile_status === 'SUCCEEDED') return status;
    if (status.compile_status === 'FAILED') {
      throw new Error(status.error || 'COMPILER_FAILED');
    }
    await new Promise((resolve, reject) => {
      const handleAbort = () => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', handleAbort);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const timeout = setTimeout(() => {
        signal?.removeEventListener('abort', handleAbort);
        resolve();
      }, POLL_INTERVAL_MS);
      signal?.addEventListener('abort', handleAbort, { once: true });
    });
  }
  throw new Error('COMPILER_TIMEOUT');
};

export const compileTerrainData = async (terrainData, center, { signal, onProgress } = {}) => {
  if (!terrainData?.bounds || !terrainData?.heightMap || !terrainData?.osmFeatures?.length) {
    throw new Error('COMPILER_INPUTS_MISSING');
  }
  const osmGeoJson = buildCompilerOsmGeoJson(terrainData.osmFeatures);
  if (!osmGeoJson.features.length) throw new Error('COMPILER_ROADS_MISSING');
  const targetCrs = getLocalMetricCrs(center);

  onProgress?.({ stage: 'preparing' });
  const osmBlob = new Blob([JSON.stringify(osmGeoJson)], { type: 'application/geo+json' });
  const { blob: demBlob } = await exportProcessedGeoTiff(terrainData, center);

  onProgress?.({ stage: 'uploading-osm' });
  const osmAsset = await uploadSource(
    '/api/v1/map-compile/assets/osm',
    osmBlob,
    {},
    signal,
  );
  onProgress?.({ stage: 'uploading-dem' });
  const demAsset = await uploadSource(
    '/api/v1/map-compile/assets/dem',
    demBlob,
    { 'X-Target-CRS': targetCrs },
    signal,
  );

  onProgress?.({ stage: 'submitting' });
  const response = await fetch(`${getCompilerBridgeUrl()}/api/v1/map-compile`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id: makeCompilerProjectId(center),
      bbox: {
        west: Number(terrainData.bounds.west),
        south: Number(terrainData.bounds.south),
        east: Number(terrainData.bounds.east),
        north: Number(terrainData.bounds.north),
      },
      target_crs: targetCrs,
      osm_source: {
        source: { kind: 'asset', asset_id: osmAsset.asset_id, sha256: osmAsset.sha256 },
        source_crs: 'EPSG:4326',
      },
      dem_source: {
        source: { kind: 'asset', asset_id: demAsset.asset_id, sha256: demAsset.sha256 },
        crs: demAsset.crs,
        resolution_m: 1.0,
      },
      terrain_options: {
        terrain_mode: 'required_dem',
        out_of_bounds_action: 'clamp',
        resolution_m: 1.0,
      },
      collision_mode: 'welded',
    }),
  });
  if (!response.ok) throw new Error(`COMPILER_SUBMIT_FAILED_${response.status}`);
  const submitted = await response.json();
  onProgress?.({ stage: 'queued', jobId: submitted.job_id, status: submitted.status });
  const status = await waitForCompiler(submitted.job_id, { signal, onProgress });
  return { jobId: submitted.job_id, status };
};
