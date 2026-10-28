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
}) => {
  const processingMppExtra = Number(extra?.processingMetersPerPixel);
  const processingMppTerrain = Number(terrainData?.processingMetersPerPixel);
  const processingMetersPerPixel = Number.isFinite(processingMppExtra) && processingMppExtra > 0
    ? processingMppExtra
    : (Number.isFinite(processingMppTerrain) && processingMppTerrain > 0 ? processingMppTerrain : 1);

  const width = Number(terrainData?.width);
  const height = Number(terrainData?.height);
  const worldWidthMeters = Number.isFinite(width) && width > 0
    ? Math.round(width * processingMetersPerPixel * 100) / 100
    : null;
  const worldHeightMeters = Number.isFinite(height) && height > 0
    ? Math.round(height * processingMetersPerPixel * 100) / 100
    : null;

  return {
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
      worldWidthMeters,
      worldHeightMeters,
    } : null,
    gameLevelInfo: terrainData ? {
      size: worldWidthMeters !== null && worldHeightMeters !== null
        ? [worldWidthMeters, worldHeightMeters]
        : null,
      sizeUnit: 'meters',
      processingMetersPerPixel,
    } : null,
    textureModes: {
      satellite: !!terrainData?.satelliteTextureUrl,
      osm: !!terrainData?.osmTextureUrl,
      hybrid: !!terrainData?.hybridTextureUrl,
      game: !!terrainData?.gameTextureUrl,
      roadMask: !!terrainData?.osmFeatures?.length,
    },
    osmQuery: terrainData?.osmRequestInfo || null,
    ...extra,
  };
};
