export const KRON86_POLAND_BOUNDS = {
  west: 13.70,
  south: 48.64,
  east: 24.87,
  north: 55.03,
};

export const USGS_CONUS_BOUNDS = {
  west: -125,
  south: 24,
  east: -66,
  north: 50,
};

export const USGS_ALASKA_BOUNDS = {
  west: -170,
  south: 50,
  east: -129,
  north: 72,
};

export const USGS_HAWAII_BOUNDS = {
  west: -161,
  south: 18,
  east: -154,
  north: 23,
};

const inBoundingBox = (lat, lng, bbox) => {
  return lat >= bbox.south && lat <= bbox.north && lng >= bbox.west && lng <= bbox.east;
};

export const ELEVATION_SOURCES = [
  {
    id: 'default',
    labelKey: 'map.standard30m',
    descriptionKey: 'map.standardDescription',
    isGlobal: true,
  },
  {
    id: 'none',
    labelKey: 'map.flatNone',
    descriptionKey: 'map.flatNoneDescription',
    isGlobal: true,
  },
  {
    id: 'kron86',
    labelKey: 'map.kron86Poland',
    descriptionKey: 'map.kron86Description',
    isGlobal: false,
    checkCoverage: (center) => {
      if (!center) return false;
      return inBoundingBox(center.lat, center.lng, KRON86_POLAND_BOUNDS);
    },
  },
  {
    id: 'usgs',
    labelKey: 'map.usgs1m',
    descriptionKey: 'map.usgsDescription',
    isGlobal: false,
    checkCoverage: (center) => {
      if (!center) return false;
      const { lat, lng } = center;
      return (
        inBoundingBox(lat, lng, USGS_CONUS_BOUNDS) ||
        inBoundingBox(lat, lng, USGS_ALASKA_BOUNDS) ||
        inBoundingBox(lat, lng, USGS_HAWAII_BOUNDS)
      );
    },
  },
  {
    id: 'gpxz',
    labelKey: 'map.gpxzPremium',
    descriptionKey: 'map.gpxzDescription',
    isGlobal: true,
  },
];
