import {
  CESIUM_DRIVABLE_HIGHWAYS,
  getCesiumHighwayCategory,
} from './cesiumOsmAdapter.js';

export const ROAD_WIDTH_RULES = Object.freeze({
  defaultLaneWidth: 3.5,
  minimumWidth: 2.5,
  maximumWidth: 30,
  globalFallback: 5.5,
});

const CLASS_DEFAULT_WIDTHS = Object.freeze({
  motorway: 14,
  trunk: 10.5,
  primary: 8,
  secondary: 7,
  tertiary: 6.5,
  residential: 5.5,
  service: 4,
  living_street: 4.5,
  motorway_link: 7,
  trunk_link: 7,
  primary_link: 6.5,
  secondary_link: 6,
  tertiary_link: 5.5,
  track: 3,
  road: 5.5,
  busway: 3.5,
  bus_guideway: 3.5,
  escape: 3.5,
  raceway: 10,
  footway: 2.5,
  path: 2.5,
  steps: 2.5,
  pedestrian: 4,
  cycleway: 2.5,
  bridleway: 2.5,
  corridor: 2.5,
  platform: 4,
  construction: 5.5,
  proposed: 5.5,
});

const SEGMENT_SUFFIX = /_seg_\d+$/;
const COORDINATE_PRECISION = 7;

const compareText = (left, right) => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const nullableTag = (tags, key) => {
  const value = tags?.[key];
  return value === undefined || value === null || value === '' ? null : String(value);
};

const parsePositiveNumber = (value) => {
  const numeric = Number.parseFloat(String(value ?? '').trim().replace(',', '.'));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};

const parseWidthMeters = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase().replace(',', '.');
  const numeric = Number.parseFloat(normalized);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  if (/\b(ft|feet|foot)\b/.test(normalized) || normalized.includes("'")) return numeric * 0.3048;
  return numeric;
};

const getLaneCount = (tags = {}) => {
  const total = parsePositiveNumber(tags.lanes);
  if (total !== null) return total;
  const forward = parsePositiveNumber(tags['lanes:forward']) ?? 0;
  const backward = parsePositiveNumber(tags['lanes:backward']) ?? 0;
  return forward + backward > 0 ? forward + backward : null;
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
  ) return null;
  return coordinates;
};

const isTruthyOsmTag = (value) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  return Boolean(normalized) && !['no', 'false', '0'].includes(normalized);
};

const normalizeLayer = (tags = {}) => {
  const rawLayer = String(tags.layer ?? '0').trim();
  const numericLayer = Number(rawLayer);
  return Number.isFinite(numericLayer) ? String(numericLayer) : rawLayer;
};

const gradeContext = (tags = {}) => ({
  layer: normalizeLayer(tags),
  bridge: isTruthyOsmTag(tags.bridge),
  tunnel: isTruthyOsmTag(tags.tunnel),
});

const gradeSignature = (context) => `${context.layer}|b${Number(context.bridge)}|t${Number(context.tunnel)}`;

const coordinateKey = ([lng, lat]) => `${lng.toFixed(COORDINATE_PRECISION)},${lat.toFixed(COORDINATE_PRECISION)}`;

const sourceRoadId = (featureId) => String(featureId).replace(SEGMENT_SUFFIX, '');

const getValidRoads = (features, { drivableOnly = false } = {}) => {
  if (!Array.isArray(features)) return [];
  return features.flatMap((feature) => {
    const highway = String(feature?.tags?.highway || '');
    if (
      feature?.type !== 'road'
      || !highway
      || (drivableOnly && !CESIUM_DRIVABLE_HIGHWAYS.has(highway))
    ) return [];
    const coordinates = toCoordinates(feature.geometry);
    const featureId = String(feature.id ?? '');
    if (!coordinates || !featureId) return [];
    return [{ feature, featureId, sourceId: sourceRoadId(featureId), highway, coordinates }];
  });
};

export const resolveRoadDiagnosticWidth = (tags = {}) => {
  const rules = ROAD_WIDTH_RULES;
  const explicitWidth = parseWidthMeters(tags.width);
  const invalidExplicitWidth = explicitWidth !== null
    && (explicitWidth < rules.minimumWidth || explicitWidth > rules.maximumWidth);

  if (explicitWidth !== null && !invalidExplicitWidth) {
    return {
      width: explicitWidth,
      source: 'explicit',
      confidence: 'declared',
      lanes: getLaneCount(tags),
      invalidExplicitWidth: false,
    };
  }

  const lanes = getLaneCount(tags);
  if (lanes !== null) {
    return {
      width: Math.min(rules.maximumWidth, Math.max(rules.minimumWidth, lanes * rules.defaultLaneWidth)),
      source: 'lanes-derived',
      confidence: 'estimated',
      lanes,
      invalidExplicitWidth,
    };
  }

  const highway = String(tags.highway || '');
  const effectiveClass = ['construction', 'proposed'].includes(highway)
    ? String(tags[highway] || highway)
    : highway;
  const classWidth = CLASS_DEFAULT_WIDTHS[effectiveClass] ?? CLASS_DEFAULT_WIDTHS[highway];
  return {
    width: classWidth ?? rules.globalFallback,
    source: classWidth === undefined ? 'fallback' : 'class-default',
    confidence: 'estimated',
    lanes: null,
    invalidExplicitWidth,
  };
};

export const osmRoadWidthsToGeoJson = (features) => {
  const roads = getValidRoads(features).map(({ feature, featureId, sourceId, highway, coordinates }) => {
    const tags = feature.tags || {};
    const width = resolveRoadDiagnosticWidth(tags);
    return {
      type: 'Feature',
      id: `mapng-road-width-${featureId}`,
      geometry: { type: 'LineString', coordinates },
      properties: {
        osmId: `way/${sourceId}`,
        featureId,
        highway,
        highwayCategory: getCesiumHighwayCategory(highway),
        name: nullableTag(tags, 'name'),
        declaredWidth: nullableTag(tags, 'width'),
        lanes: nullableTag(tags, 'lanes'),
        previewWidthMeters: width.width,
        previewWidthSource: width.source,
        previewWidthConfidence: width.confidence,
        invalidExplicitWidth: width.invalidExplicitWidth,
        layer: normalizeLayer(tags),
        bridge: nullableTag(tags, 'bridge'),
        tunnel: nullableTag(tags, 'tunnel'),
      },
    };
  });

  roads.sort((left, right) => (
    compareText(left.properties.osmId, right.properties.osmId)
    || compareText(left.properties.featureId, right.properties.featureId)
  ));
  return { type: 'FeatureCollection', features: roads };
};

const classifyJunction = (branchCount, incidents) => {
  const allOneWay = incidents.length > 1 && incidents.every((incident) => (
    ['yes', 'true', '1', '-1'].includes(String(incident.oneway || '').toLowerCase())
  ));
  if (branchCount === 3) return allOneWay ? 'split/merge' : 'T-junction';
  if (branchCount === 4) return '4-way';
  return branchCount > 4 ? 'multi-way' : null;
};

export const deriveCoordinateJunctionsGeoJson = (features) => {
  const nodes = new Map();

  getValidRoads(features, { drivableOnly: true }).forEach(({ feature, sourceId, highway, coordinates }) => {
    const tags = feature.tags || {};
    const context = gradeContext(tags);
    const signature = gradeSignature(context);
    coordinates.forEach((coordinate, index) => {
      const key = `${coordinateKey(coordinate)}|${signature}`;
      if (!nodes.has(key)) nodes.set(key, { coordinate, context, incidents: [] });
      nodes.get(key).incidents.push({
        sourceId,
        osmId: `way/${sourceId}`,
        highway,
        name: nullableTag(tags, 'name'),
        oneway: nullableTag(tags, 'oneway'),
        branches: index === 0 || index === coordinates.length - 1 ? 1 : 2,
      });
    });
  });

  const junctions = [];
  nodes.forEach(({ coordinate, context, incidents }) => {
    const uniqueIncidents = new Map();
    incidents.forEach((incident) => {
      const existing = uniqueIncidents.get(incident.sourceId);
      if (!existing) uniqueIncidents.set(incident.sourceId, { ...incident });
      else existing.branches = Math.max(existing.branches, incident.branches);
    });
    const distinct = [...uniqueIncidents.values()];
    const branchCount = distinct.reduce((sum, incident) => sum + incident.branches, 0);
    const classification = classifyJunction(branchCount, distinct);
    if (!classification || distinct.length < 2) return;

    const coordinateIdentity = coordinateKey(coordinate);
    junctions.push({
      type: 'Feature',
      id: `mapng-junction-${coordinateIdentity}-${gradeSignature(context)}`,
      geometry: { type: 'Point', coordinates: coordinate },
      properties: {
        nodeIdentity: `coordinate/${coordinateIdentity}`,
        identitySource: 'coordinate-derived',
        osmNodeId: null,
        classification,
        branchCount,
        incidentRoadCount: distinct.length,
        incidentRoadIds: distinct.map((item) => item.osmId).sort(compareText).join(', '),
        incidentRoadNames: distinct.map((item) => item.name || item.highway).sort(compareText).join(', '),
        incidentRoadClasses: [...new Set(distinct.map((item) => item.highway))].sort(compareText).join(', '),
        layer: context.layer,
        bridge: context.bridge,
        tunnel: context.tunnel,
      },
    });
  });

  junctions.sort((left, right) => compareText(left.id, right.id));
  return { type: 'FeatureCollection', features: junctions };
};

export const getRoadWidthPreviewStyle = (source) => ({
  explicit: { color: '#22C55E', alpha: 0.48 },
  'lanes-derived': { color: '#38BDF8', alpha: 0.38 },
  'class-default': { color: '#F59E0B', alpha: 0.32 },
  fallback: { color: '#EF4444', alpha: 0.3 },
}[source] || { color: '#EF4444', alpha: 0.3 });
