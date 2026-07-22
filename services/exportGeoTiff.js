import { writeArrayBuffer } from 'geotiff';
import { getGeoTiffCoordsWGS84 } from './geoUtils.js';

const buildWgs84GeoTiffExport = async (terrainData, center, timestamp) => {
    const { width, height, heightMap } = terrainData;
    const bounds = terrainData?.bounds;
    const hasBounds = [bounds?.west, bounds?.south, bounds?.east, bounds?.north]
        .every((value) => Number.isFinite(Number(value)));
    const coords = hasBounds ? {
        pixelSizeLng: (Number(bounds.east) - Number(bounds.west)) / width,
        pixelSizeLat: (Number(bounds.north) - Number(bounds.south)) / height,
        topLeftLng: Number(bounds.west),
        topLeftLat: Number(bounds.north),
    } : getGeoTiffCoordsWGS84(center.lat, center.lng, width, height);

    const metadata = {
        height,
        width,
        ModelPixelScale: [coords.pixelSizeLng, -coords.pixelSizeLat, 0],
        ModelTiepoint: [0, 0, 0, coords.topLeftLng, coords.topLeftLat, 0],
        GeographicTypeGeoKey: 4326,
        GTModelTypeGeoKey: 2,
        GTRasterTypeGeoKey: 1
    };

    const arrayBuffer = await writeArrayBuffer(heightMap, metadata);

    return {
        blob: new Blob([arrayBuffer], { type: 'image/tiff' }),
        filename: `Heightmap_WGS84_${timestamp}.tif`
    };
};

export const exportProcessedGeoTiff = async (terrainData, center) => {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    return buildWgs84GeoTiffExport(terrainData, center, timestamp);
};


export const exportGeoTiff = async (
    terrainData,
    center
) => {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    
    if (terrainData.sourceGeoTiffs) {
        const { arrayBuffers, source } = terrainData.sourceGeoTiffs;
        
        if (arrayBuffers.length === 1) {
            return {
                blob: new Blob([arrayBuffers[0]], { type: 'image/tiff' }),
                filename: `${source.toUpperCase()}_${timestamp}.tif`
            };
        }
    }

    return buildWgs84GeoTiffExport(terrainData, center, timestamp);
};
