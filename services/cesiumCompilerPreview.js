const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8000';
const JOB_ID_PATTERN = /^job_[a-f0-9]{12}$/i;

export const getCompilerBridgeUrl = () => String(
  import.meta.env.VITE_GEOCRASH_BRIDGE_URL || DEFAULT_BRIDGE_URL,
).replace(/\/+$/, '');

export const normalizeCompilerJobId = (value) => {
  const jobId = String(value || '').trim();
  return JOB_ID_PATTERN.test(jobId) ? jobId : '';
};

export const validateCompilerPreview = (payload) => {
  if (!payload || payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
    throw new Error('COMPILER_PREVIEW_INVALID');
  }
  if (payload.preview?.geometrySource !== 'compiled_surface_mesh') {
    throw new Error('COMPILER_PREVIEW_NOT_COMPILED');
  }
  return payload;
};

export const fetchCompilerPreview = async (jobId, { signal } = {}) => {
  const normalizedJobId = normalizeCompilerJobId(jobId);
  if (!normalizedJobId) throw new Error('COMPILER_JOB_ID_INVALID');

  const response = await fetch(
    `${getCompilerBridgeUrl()}/api/v1/map-compile/${encodeURIComponent(normalizedJobId)}/preview`,
    { signal, headers: { Accept: 'application/geo+json, application/json' } },
  );
  if (!response.ok) {
    const error = new Error(response.status === 409 ? 'COMPILER_PREVIEW_NOT_READY' : 'COMPILER_PREVIEW_FETCH_FAILED');
    error.status = response.status;
    throw error;
  }
  return validateCompilerPreview(await response.json());
};

export const countCompilerPreviewSurfaces = (preview) => ({
  roads: Number(preview?.preview?.roadSurfaceCount || 0),
  junctions: Number(preview?.preview?.junctionSurfaceCount || 0),
  total: Number(preview?.preview?.roadSurfaceCount || 0)
    + Number(preview?.preview?.junctionSurfaceCount || 0),
});

export const getCompilerTerrainGrid = (preview) => {
  const terrain = preview?.terrain;
  const width = Number(terrain?.width);
  const height = Number(terrain?.height);
  const sampleStride = Number(terrain?.sampleStride || 1);
  if (
    terrain?.source !== 'deformed_compiler_grid'
    || !Number.isInteger(width)
    || !Number.isInteger(height)
    || width < 2
    || height < 2
    || !Number.isInteger(sampleStride)
    || sampleStride < 1
    || sampleStride > 3
    || !Array.isArray(terrain.vertices)
    || terrain.vertices.length !== width * height
    || terrain.vertices.some((vertex) => (
      !Array.isArray(vertex)
      || vertex.length < 3
      || vertex.slice(0, 4).some((value) => !Number.isFinite(Number(value)))
    ))
  ) {
    return null;
  }
  return terrain;
};

export const buildCompilerTerrainTriangleIndices = (width, height) => {
  const indices = [];
  for (let row = 0; row < height - 1; row += 1) {
    for (let column = 0; column < width - 1; column += 1) {
      const upperLeft = row * width + column;
      const upperRight = upperLeft + 1;
      const lowerLeft = upperLeft + width;
      const lowerRight = lowerLeft + 1;
      indices.push(upperLeft, lowerLeft, upperRight, upperRight, lowerLeft, lowerRight);
    }
  }
  return indices;
};

export const offsetCompilerPreviewHeights = (preview, offsetMeters = 0.15) => {
  const offset = Number(offsetMeters);
  if (!Number.isFinite(offset) || !Array.isArray(preview?.features)) return preview;
  return {
    ...preview,
    features: preview.features.map((feature) => {
      if (feature?.geometry?.type !== 'MultiPolygon') return feature;
      return {
        ...feature,
        geometry: {
          ...feature.geometry,
          coordinates: feature.geometry.coordinates.map((polygon) => (
            polygon.map((ring) => ring.map((position) => (
              Array.isArray(position) && Number.isFinite(Number(position[2]))
                ? [position[0], position[1], Number(position[2]) + offset, ...position.slice(3)]
                : position
            )))
          )),
        },
      };
    }),
  };
};

export const getCompilerPreviewTerrainSamplePoints = (preview) => {
  const points = [];
  for (const feature of preview?.features || []) {
    if (feature?.geometry?.type !== 'MultiPolygon') continue;
    for (const polygon of feature.geometry.coordinates || []) {
      for (const ring of polygon || []) {
        for (const position of ring || []) {
          const lng = Number(position?.[0]);
          const lat = Number(position?.[1]);
          if (Number.isFinite(lng) && Number.isFinite(lat)) points.push({ lng, lat });
        }
      }
    }
  }
  return points;
};

export const applyTerrainHeightsToCompilerPreview = (
  preview,
  terrainHeights,
  clearanceMeters = 0.15,
) => {
  const heights = Array.isArray(terrainHeights) ? terrainHeights : [];
  const clearance = Number(clearanceMeters);
  if (!Array.isArray(preview?.features) || !Number.isFinite(clearance)) return preview;
  let sampleIndex = 0;
  let invalid = false;
  const features = preview.features.map((feature) => {
    if (feature?.geometry?.type !== 'MultiPolygon') return feature;
    return {
      ...feature,
      properties: {
        ...feature.properties,
        displayHeightMode: 'cesium-terrain-draped',
      },
      geometry: {
        ...feature.geometry,
        coordinates: feature.geometry.coordinates.map((polygon) => (
          polygon.map((ring) => ring.map((position) => {
            const height = Number(heights[sampleIndex]);
            sampleIndex += 1;
            if (!Number.isFinite(height)) {
              invalid = true;
              return position;
            }
            return [position[0], position[1], height + clearance, ...position.slice(3)];
          }))
        )),
      },
    };
  });
  if (invalid || sampleIndex !== heights.length) return null;
  return { ...preview, features };
};
