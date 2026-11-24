const getBuildTrace = () => {
  return {
    hash: typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'dev',
    time: typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : null,
  };
};

export const getExportTimestamp = () => new Date().toISOString();

export const buildCommonTraceMetadata = ({
  mode,
  center,
  zoom,
  resolution,
  terrainData,
  textureModes,
  osmQuery,
  gpxz,
  extra = {},
}) => {
  return {
    schemaVersion: 1,
    generatedAt: getExportTimestamp(),
    build: getBuildTrace(),
    run: {
      mode,
      center,
      zoom,
      resolution,
      bbox: terrainData?.bounds || null,
      width: terrainData?.width ?? null,
      height: terrainData?.height ?? null,
      textureModes,
      osmQuery,
      gpxz,
    },
    ...extra,
  };
};

export const downloadJsonFile = (data, filename) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
};
