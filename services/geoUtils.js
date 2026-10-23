import proj4 from 'proj4';

// ─── Shared Projection Utilities ─────────────────────────────────────────────
// Single source of truth for local Transverse Mercator projections used
// throughout the app (terrain resampling, OSM textures, 3D export, etc.)

/**
 * Build a local Transverse Mercator proj4 definition string centered on (lat, lng).
 * Units are meters; origin is 0,0 at center.
 */
export const localProjDef = (centerLat, centerLng) =>
    `+proj=tmerc +lat_0=${centerLat} +lon_0=${centerLng} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs`;

/**
 * Create a converter from local meter coordinates → WGS84 [lng, lat].
 * Usage: const [lng, lat] = toWGS84.forward([meterX, meterY])
 */
export const createLocalToWGS84 = (centerLat, centerLng) =>
    proj4(localProjDef(centerLat, centerLng), 'EPSG:4326');

/**
 * Create a converter from WGS84 [lng, lat] → local meter coordinates.
 * Usage: const [meterX, meterY] = toLocal.forward([lng, lat])
 */
export const createWGS84ToLocal = (centerLat, centerLng) =>
    proj4('EPSG:4326', localProjDef(centerLat, centerLng));

/**
 * Create a function that maps (lat, lng) → pixel {x, y} on a terrain raster.
 *
 * Linear in lat/lng across the bounds, which is how fetchTerrainData
 * resamples the heightmap (targetBounds) and how the BeamNG export places
 * everything (geoToWorldPoint). Going through the local Transverse Mercator
 * instead put roads east of their real grid position by up to 18 m on a 16 km
 * Utah map (39 m in Alaska; it grows with the square of the map size).
 *
 * @param {{north:number, south:number, east:number, west:number}} bounds
 * @param {number} width   raster width in pixels
 * @param {number} height  raster height in pixels
 * @returns {(lat:number, lng:number) => {x:number, y:number}}
 */
export const createGridProjector = (bounds, width, height) => {
    const lngSpan = bounds.east - bounds.west;
    const latSpan = bounds.north - bounds.south;
    return (lat, lng) => ({
        x: ((lng - bounds.west) / lngSpan) * (width - 1),
        y: ((bounds.north - lat) / latSpan) * (height - 1),
    });
};

// ─── UTM Helpers ─────────────────────────────────────────────────────────────

export const getUTMZone = (lng) => {
    return Math.floor((lng + 180) / 6) + 1;
};

export const getEPSGCode = (lat, zone) => {
    return lat >= 0 ? 32600 + zone : 32700 + zone;
};

export const latLonToUTM = (lat, lng) => {
    const zone = getUTMZone(lng);
    const isSouth = lat < 0;
    const epsg = getEPSGCode(lat, zone);
    
    const utmProj = `+proj=utm +zone=${zone} ${isSouth ? '+south ' : ''}+datum=WGS84 +units=m +no_defs`;
    const [x, y] = proj4('EPSG:4326', utmProj, [lng, lat]);

    return { x, y, zone, isSouth, epsg };
};

export const getGeoTiffCoordsWGS84 = (centerLat, centerLng, width, height) => {
    const toWGS84 = createLocalToWGS84(centerLat, centerLng);
    
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    
    const [topLeftLng, topLeftLat] = toWGS84.forward([-halfWidth, halfHeight]);
    const [bottomRightLng, bottomRightLat] = toWGS84.forward([halfWidth, -halfHeight]);
    
    return {
        topLeftLat,
        topLeftLng,
        pixelSizeLat: (bottomRightLat - topLeftLat) / height,
        pixelSizeLng: (bottomRightLng - topLeftLng) / width
    };
};
