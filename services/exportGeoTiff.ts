import { writeArrayBuffer } from 'geotiff';
import JSZip from 'jszip';
import { TerrainData, LatLng } from '../types';
import { getGeoTiffCoordsWGS84 } from './geoUtils';

export interface GeoTiffExportResult {
    blob: Blob;
    filename: string;
}

export const exportGeoTiff = async (
    terrainData: TerrainData,
    center: LatLng
): Promise<GeoTiffExportResult> => {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    
    if (terrainData.sourceGeoTiffs) {
        const { arrayBuffers, source } = terrainData.sourceGeoTiffs;
        
        if (arrayBuffers.length === 1) {
            return {
                blob: new Blob([arrayBuffers[0]], { type: 'image/tiff' }),
                filename: `${source.toUpperCase()}_${timestamp}.tif`
            };
        } else {
            const zip = new JSZip();
            arrayBuffers.forEach((buffer, index) => zip.file(`tile_${index + 1}.tif`, buffer));
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            return {
                blob: zipBlob,
                filename: `${source.toUpperCase()}_${arrayBuffers.length}tiles_${timestamp}.zip`
            };
        }
    } else {
        const { width, height, heightMap } = terrainData;
        const coords = getGeoTiffCoordsWGS84(center.lat, center.lng, width, height);

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
    }
};
