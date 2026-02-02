import proj4 from 'proj4';


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
    const localProjDef = `+proj=tmerc +lat_0=${centerLat} +lon_0=${centerLng} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs`;
    const toWGS84 = proj4(localProjDef, 'EPSG:4326');
    
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
