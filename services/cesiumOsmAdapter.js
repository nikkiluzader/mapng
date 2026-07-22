export const CESIUM_DRIVABLE_HIGHWAYS = Object.freeze(new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'service',
  'living_street',
  'motorway_link',
  'trunk_link',
  'primary_link',
  'secondary_link',
  'tertiary_link',
  'track',
  'road',
  'busway',
  'bus_guideway',
  'escape',
  'raceway',
]));

export const CESIUM_NON_MOTORIZED_HIGHWAYS = Object.freeze(new Set([
  'footway',
  'path',
  'steps',
  'pedestrian',
  'cycleway',
  'bridleway',
  'corridor',
  'platform',
]));

const ROAD_STYLES = Object.freeze({
  motorway: { color: '#E11D48', width: 6 },
  trunk: { color: '#F97316', width: 5.5 },
  primary: { color: '#F59E0B', width: 5 },
  secondary: { color: '#FACC15', width: 4.5 },
  tertiary: { color: '#A3E635', width: 4 },
  unclassified: { color: '#38BDF8', width: 3 },
  residential: { color: '#FFFFFF', width: 3 },
  service: { color: '#94A3B8', width: 2.5 },
  living_street: { color: '#C084FC', width: 3 },
  motorway_link: { color: '#FB7185', width: 4.5 },
  trunk_link: { color: '#FB923C', width: 4.25 },
  primary_link: { color: '#FBBF24', width: 4 },
  secondary_link: { color: '#FDE047', width: 3.75 },
  tertiary_link: { color: '#BEF264', width: 3.5 },
  track: { color: '#A16207', width: 2.5 },
  road: { color: '#CBD5E1', width: 3 },
  busway: { color: '#06B6D4', width: 3.5 },
  bus_guideway: { color: '#0891B2', width: 3.5 },
  escape: { color: '#F43F5E', width: 3 },
  raceway: { color: '#DC2626', width: 4 },
  footway: { color: '#E2E8F0', width: 1.75 },
  path: { color: '#C4B5FD', width: 1.75 },
  steps: { color: '#F0ABFC', width: 2 },
  pedestrian: { color: '#F8FAFC', width: 2.5 },
  cycleway: { color: '#22D3EE', width: 2.25 },
  bridleway: { color: '#D97706', width: 2 },
  corridor: { color: '#94A3B8', width: 1.75 },
  platform: { color: '#A1A1AA', width: 2.5 },
  construction: { color: '#F97316', width: 2.5 },
  proposed: { color: '#64748B', width: 2 },
});

const DEFAULT_ROAD_STYLE = Object.freeze({ color: '#FFFFFF', width: 3 });
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

const toCoordinates = (geometry) => {
  if (!Array.isArray(geometry)) return null;

  const coordinates = geometry.map((point) => [Number(point?.lng), Number(point?.lat)]);
  if (
    coordinates.length < 2
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

  return coordinates;
};

export const getCesiumRoadStyle = (highway) => (
  ROAD_STYLES[String(highway || '')] || DEFAULT_ROAD_STYLE
);

export const getCesiumHighwayCategory = (highway) => {
  const normalized = String(highway || '');
  if (CESIUM_DRIVABLE_HIGHWAYS.has(normalized)) return 'motorized';
  if (CESIUM_NON_MOTORIZED_HIGHWAYS.has(normalized)) return 'non-motorized';
  return 'other';
};

export const osmRoadFeaturesToGeoJson = (features) => {
  if (!Array.isArray(features)) {
    return { type: 'FeatureCollection', features: [] };
  }

  const roads = features.flatMap((feature) => {
    const highway = String(feature?.tags?.highway || '');
    if (feature?.type !== 'road' || !highway) return [];

    const coordinates = toCoordinates(feature.geometry);
    if (!coordinates) return [];

    const featureId = String(feature.id ?? '');
    if (!featureId) return [];
    const sourceId = featureId.replace(SEGMENT_SUFFIX, '');
    const tags = feature.tags || {};

    return [{
      type: 'Feature',
      id: `mapng-road-${featureId}`,
      geometry: {
        type: 'LineString',
        coordinates,
      },
      properties: {
        osmId: `way/${sourceId}`,
        featureId,
        highway,
        highwayCategory: getCesiumHighwayCategory(highway),
        name: nullableTag(tags, 'name'),
        lanes: nullableTag(tags, 'lanes'),
        width: nullableTag(tags, 'width'),
        oneway: nullableTag(tags, 'oneway') ?? 'no',
        bridge: nullableTag(tags, 'bridge'),
        tunnel: nullableTag(tags, 'tunnel'),
        layer: nullableTag(tags, 'layer') ?? '0',
      },
    }];
  });

  roads.sort((left, right) => (
    compareText(left.properties.osmId, right.properties.osmId)
    || compareText(left.properties.featureId, right.properties.featureId)
  ));

  return { type: 'FeatureCollection', features: roads };
};
