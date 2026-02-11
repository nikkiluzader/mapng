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
 * Create a function that maps (lat, lng) → pixel {x, y} for a given
 * terrain bounds + raster size.  Used for OSM texture rendering and 3D export.
 *
 * @param {{north:number, south:number, east:number, west:number}} bounds
 * @param {number} width   raster width in pixels (= meters at 1 m/px)
 * @param {number} height  raster height in pixels
 * @returns {(lat:number, lng:number) => {x:number, y:number}}
 */
export const createMetricProjector = (bounds, width, height) => {
    const centerLat = (bounds.north + bounds.south) / 2;
    const centerLng = (bounds.east + bounds.west) / 2;
    const toMetric = createWGS84ToLocal(centerLat, centerLng);

    const [minX, minY] = toMetric.forward([bounds.west, bounds.south]);
    const [maxX, maxY] = toMetric.forward([bounds.east, bounds.north]);

    const widthM = Math.abs(maxX - minX);
    const heightM = Math.abs(maxY - minY);

    return (lat, lng) => {
        const [localX, localY] = toMetric.forward([lng, lat]);

        const u = (localX - minX) / widthM;
        const v = (localY - minY) / heightM;

        const x = u * (width - 1);
        const y = (1 - v) * (height - 1);

        return { x, y };
    };
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
