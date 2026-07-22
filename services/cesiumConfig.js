const DEFAULT_CENTER = Object.freeze({ lat: 48.7687, lng: 18.7408 });

export const CESIUM_ION_TOKEN = String(
  import.meta.env.VITE_CESIUM_ION_TOKEN || '',
).trim();

export const hasCesiumToken = () => CESIUM_ION_TOKEN.length > 0;

export const normalizeCesiumCenter = (center) => {
  const lat = Number(center?.lat);
  const lng = Number(center?.lng);

  if (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  ) {
    return { lat, lng };
  }

  return DEFAULT_CENTER;
};

export const normalizeCesiumBounds = (bounds) => {
  const north = Number(bounds?.north);
  const south = Number(bounds?.south);
  const east = Number(bounds?.east);
  const west = Number(bounds?.west);

  if (
    [north, south, east, west].every(Number.isFinite) &&
    north > south &&
    north <= 90 &&
    south >= -90 &&
    east >= -180 &&
    east <= 180 &&
    west >= -180 &&
    west <= 180 &&
    east > west
  ) {
    return { north, south, east, west };
  }

  return null;
};

export const getCesiumBoundsCenter = (bounds, fallbackCenter) => {
  const normalized = normalizeCesiumBounds(bounds);
  if (!normalized) return normalizeCesiumCenter(fallbackCenter);

  return {
    lat: (normalized.north + normalized.south) / 2,
    lng: (normalized.east + normalized.west) / 2,
  };
};

const EARTH_RADIUS_METERS = 6371008.8;

const distanceMeters = (latA, lngA, latB, lngB) => {
  const toRadians = (value) => value * Math.PI / 180;
  const dLat = toRadians(latB - latA);
  const dLng = toRadians(lngB - lngA);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(latA)) * Math.cos(toRadians(latB)) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const measureCesiumBounds = (bounds) => {
  const normalized = normalizeCesiumBounds(bounds);
  if (!normalized) return null;

  const center = getCesiumBoundsCenter(normalized);
  return {
    widthMeters: distanceMeters(center.lat, normalized.west, center.lat, normalized.east),
    heightMeters: distanceMeters(normalized.south, center.lng, normalized.north, center.lng),
  };
};

export const formatCesiumDistance = (meters) => {
  const value = Number(meters);
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value >= 10000) return `${(value / 1000).toFixed(1)} km`;
  if (value >= 1000) return `${(value / 1000).toFixed(2)} km`;
  return `${Math.round(value)} m`;
};
