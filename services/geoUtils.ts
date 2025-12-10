import proj4 from 'proj4';

export interface UTMCoords {
    x: number;
    y: number;
    zone: number;
    isSouth: boolean;
    epsg: number;
}

export const getUTMZone = (lng: number): number => {
    return Math.floor((lng + 180) / 6) + 1;
};

export const getEPSGCode = (lat: number, zone: number): number => {
    return lat >= 0 ? 32600 + zone : 32700 + zone;
};

export const latLonToUTM = (lat: number, lng: number): UTMCoords => {
    const zone = getUTMZone(lng);
    const isSouth = lat < 0;
    const epsg = getEPSGCode(lat, zone);
    
    const utmProj = `+proj=utm +zone=${zone} ${isSouth ? '+south ' : ''}+datum=WGS84 +units=m +no_defs`;
    const wgs84 = 'EPSG:4326';

    const [x, y] = proj4(wgs84, utmProj, [lng, lat]);

    return { x, y, zone, isSouth, epsg };
};

export const getGeoKeyDirectory = (epsg: number): number[] => {
    // GeoTIFF Key IDs
    const GTModelTypeGeoKey = 1024;
    const GTRasterTypeGeoKey = 1025;
    const GeographicTypeGeoKey = 2048;
    const ProjectedCSTypeGeoKey = 3072;

    // Values
    const ModelTypeProjected = 1; // Projection Coordinate System
    const RasterPixelIsArea = 1;  // Standard for images
    const GCS_WGS_84 = 4326;

    return [
        1, 1, 0, 4, // Header: Version 1.1.0, 4 Keys
        GTModelTypeGeoKey, 0, 1, ModelTypeProjected,
        GTRasterTypeGeoKey, 0, 1, RasterPixelIsArea,
        GeographicTypeGeoKey, 0, 1, GCS_WGS_84,
        ProjectedCSTypeGeoKey, 0, 1, epsg
    ];
};
