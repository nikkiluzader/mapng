/**
 * Shared utility for building a run configuration object from terrain generation parameters.
 * Used by both ControlPanel and ExportPanel to avoid duplication.
 */
export const buildRunConfiguration = ({
  center,
  zoom,
  resolution,
  includeOSM,
  elevationSource,
  gpxzApiKey,
  gpxzStatus,
  terrainData,
  extra = {},
}) => ({
  schemaVersion: 1,
  mode: 'single',
  center: { ...center },
  zoom: zoom ?? null,
  resolution,
  includeOSM,
  elevationSource,
  useUSGS: elevationSource === 'usgs',
  useGPXZ: elevationSource === 'gpxz',
  useKRON86: elevationSource === 'kron86',
  gpxzApiKey: gpxzApiKey || '',
  gpxzStatus: gpxzStatus ? { ...gpxzStatus } : null,
  terrain: terrainData ? {
    width: terrainData.width,
    height: terrainData.height,
    bounds: terrainData.bounds,
    minHeight: terrainData.minHeight,
    maxHeight: terrainData.maxHeight,
  } : null,
  textureModes: {
    satellite: !!terrainData?.satelliteTextureUrl,
    osm: !!terrainData?.osmTextureUrl,
    hybrid: !!terrainData?.hybridTextureUrl,
    roadMask: !!terrainData?.osmFeatures?.length,
  },
  osmQuery: terrainData?.osmRequestInfo || null,
  ...extra,
});
