export const CESIUM_BUILDING_HEIGHT_RULES = Object.freeze({
  defaultFloorHeight: 3,
  fallbackBuildingHeight: 6,
  minimumHeight: 2,
  maximumPreviewHeight: 150,
});

const SEGMENT_SUFFIX = /_seg_\d+$/;

const compareText = (left, right) => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const nullableTag = (tags, key) => {
  const value = tags?.[key];
  return value === undefined || value === null || value === '' ? null : String(value);
};

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

const parseOsmLengthMeters = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase().replace(',', '.');
  const numeric = Number.parseFloat(normalized);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  if (/\b(ft|feet|foot)\b/.test(normalized) || normalized.includes("'")) return numeric * 0.3048;
  return numeric;
};

const parsePositiveNumber = (value) => {
  const numeric = Number.parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};

const sameCoordinate = (left, right) => left[0] === right[0] && left[1] === right[1];

const toClosedRing = (geometry) => {
  if (!Array.isArray(geometry)) return null;
  const coordinates = geometry.map((point) => [Number(point?.lng), Number(point?.lat)]);
  if (
    coordinates.length < 3
    || coordinates.some(([lng, lat]) => (
      !Number.isFinite(lng)
      || !Number.isFinite(lat)
      || lng < -180
      || lng > 180
      || lat < -90
      || lat > 90
    ))
  ) {
    return null;
  }

  if (!sameCoordinate(coordinates[0], coordinates[coordinates.length - 1])) {
    coordinates.push([...coordinates[0]]);
  }
  return coordinates.length >= 4 ? coordinates : null;
};

export const resolveCesiumBuildingHeight = (tags = {}) => {
  const rules = CESIUM_BUILDING_HEIGHT_RULES;
  const explicitHeight = parseOsmLengthMeters(tags.height);
  const levels = parsePositiveNumber(tags['building:levels'] ?? tags.levels);
  const roofHeight = parseOsmLengthMeters(tags['roof:height']);

  let rawHeight = rules.fallbackBuildingHeight;
  let source = 'fallback';
  let estimated = true;

  if (explicitHeight !== null) {
    rawHeight = explicitHeight;
    source = 'height';
    estimated = false;
  } else if (levels !== null) {
    rawHeight = levels * rules.defaultFloorHeight + (roofHeight ?? 0);
    source = 'building:levels';
  }

  const height = clamp(rawHeight, rules.minimumHeight, rules.maximumPreviewHeight);
  const explicitMinHeight = parseOsmLengthMeters(tags.min_height);
  const minimumLevels = parsePositiveNumber(tags['building:min_level']);
  const rawMinHeight = explicitMinHeight ?? (
    minimumLevels === null ? 0 : minimumLevels * rules.defaultFloorHeight
  );
  const minHeight = clamp(rawMinHeight, 0, Math.max(0, height - 0.1));

  return {
    height,
    minHeight,
    roofHeight: roofHeight ?? 0,
    levels,
    source,
    estimated,
    clamped: height !== rawHeight,
  };
};

export const osmBuildingFeaturesToGeoJson = (features) => {
  if (!Array.isArray(features)) {
    return { type: 'FeatureCollection', features: [] };
  }

  const buildings = features.flatMap((feature) => {
    const tags = feature?.tags || {};
    const isBuilding = feature?.type === 'building' || Boolean(tags.building || tags['building:part']);
    if (!isBuilding) return [];

    const outerRing = toClosedRing(feature.geometry);
    if (!outerRing) return [];
    const innerRings = Array.isArray(feature.holes)
      ? feature.holes.map(toClosedRing).filter(Boolean)
      : [];

    const featureId = String(feature.id ?? '');
    if (!featureId) return [];
    const sourceId = featureId.replace(SEGMENT_SUFFIX, '');
    const height = resolveCesiumBuildingHeight(tags);

    return [{
      type: 'Feature',
      id: `mapng-building-${featureId}`,
      geometry: {
        type: 'Polygon',
        coordinates: [outerRing, ...innerRings],
      },
      properties: {
        osmId: sourceId.startsWith('rel_')
          ? `relation/${sourceId.slice(4)}`
          : `way/${sourceId}`,
        featureId,
        name: nullableTag(tags, 'name'),
        building: nullableTag(tags, 'building'),
        buildingPart: nullableTag(tags, 'building:part'),
        declaredHeight: nullableTag(tags, 'height'),
        buildingLevels: nullableTag(tags, 'building:levels'),
        minHeight: nullableTag(tags, 'min_height'),
        roofHeight: nullableTag(tags, 'roof:height'),
        previewHeightMeters: height.height,
        previewMinHeightMeters: height.minHeight,
        previewHeightSource: height.source,
        previewHeightEstimated: height.estimated,
        previewHeightClamped: height.clamped,
      },
    }];
  });

  buildings.sort((left, right) => (
    compareText(left.properties.osmId, right.properties.osmId)
    || compareText(left.properties.featureId, right.properties.featureId)
  ));

  return { type: 'FeatureCollection', features: buildings };
};

export const getBuildingTerrainSamplePoints = (featureCollection) => (
  Array.isArray(featureCollection?.features)
    ? featureCollection.features.map((feature) => {
      const outerRing = feature?.geometry?.coordinates?.[0];
      if (!Array.isArray(outerRing) || outerRing.length < 4) return null;
      const vertices = outerRing.slice(0, -1);
      const sum = vertices.reduce(
        (result, coordinate) => ({
          lng: result.lng + Number(coordinate?.[0] || 0),
          lat: result.lat + Number(coordinate?.[1] || 0),
        }),
        { lng: 0, lat: 0 },
      );
      return {
        lng: sum.lng / vertices.length,
        lat: sum.lat / vertices.length,
      };
    })
    : []
);

export const applyTerrainHeightsToBuildingGeoJson = (featureCollection, terrainHeights) => {
  if (!Array.isArray(featureCollection?.features) || !Array.isArray(terrainHeights)) {
    return { type: 'FeatureCollection', features: [] };
  }

  const features = featureCollection.features.flatMap((feature, index) => {
    const terrainHeight = Number(terrainHeights[index]);
    if (!Number.isFinite(terrainHeight)) return [];
    const minHeight = Number(feature.properties?.previewMinHeightMeters || 0);
    const previewHeight = Number(feature.properties?.previewHeightMeters || 6);
    const absoluteBase = terrainHeight + minHeight;
    const absoluteRoof = terrainHeight + previewHeight;

    return [{
      ...feature,
      geometry: {
        ...feature.geometry,
        coordinates: feature.geometry.coordinates.map((ring) => (
          ring.map(([lng, lat]) => [lng, lat, absoluteBase])
        )),
      },
      properties: {
        ...feature.properties,
        previewTerrainBaseMeters: terrainHeight,
        previewAbsoluteBaseMeters: absoluteBase,
        previewAbsoluteRoofMeters: absoluteRoof,
      },
    }];
  });

  return { type: 'FeatureCollection', features };
};
