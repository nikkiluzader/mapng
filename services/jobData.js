import JSZip from 'jszip';

const SUPPORTED_JOB_VERSION = '1.0';

/**
 * Converts a blob URL back to a Blob object.
 */
async function blobUrlToBlob(url) {
    if (!url) return null;
    try {
        const resp = await fetch(url);
        return await resp.blob();
    } catch (e) {
        console.warn('Failed to fetch blob from URL:', url, e);
        return null;
    }
}

/**
 * Exports terrainData to a .mapng ZIP file.
 */
export async function exportJobData(terrainData, generationKey = null) {
    const zip = new JSZip();

    // 1. Metadata and JSON parts
    const metadata = {
        width: terrainData.width,
        height: terrainData.height,
        minHeight: terrainData.minHeight,
        maxHeight: terrainData.maxHeight,
        bounds: terrainData.bounds,
        osmRequestInfo: terrainData.osmRequestInfo,
        usgsFallback: terrainData.usgsFallback,
        sourceGeoTiffs: terrainData.sourceGeoTiffs,
        generationKey: generationKey,
        version: SUPPORTED_JOB_VERSION
    };

    zip.file("job.json", JSON.stringify(metadata, null, 2));
    zip.file("osmFeatures.json", JSON.stringify(terrainData.osmFeatures || [], null, 2));

    // 2. Heightmap (binary)
    if (terrainData.heightMap) {
        zip.file("heightmap.bin", terrainData.heightMap.buffer);
    }

    // 3. Textures
    const textures = {
        "satellite.jpg": terrainData.satelliteTextureUrl,
        "osm.png": terrainData.osmTextureUrl,
        "hybrid.jpg": terrainData.hybridTextureUrl
    };

    for (const [name, url] of Object.entries(textures)) {
        if (url) {
            const blob = await blobUrlToBlob(url);
            if (blob) {
                zip.file(name, blob);
            }
        }
    }

    // 4. Generate ZIP
    return await zip.generateAsync({ 
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 }
    });
}

/**
 * Imports terrainData from a .mapng ZIP file.
 */
export async function importJobData(blob) {
    const zip = await JSZip.loadAsync(blob);

    // 1. Load job.json
    const jobJsonStr = await zip.file("job.json")?.async("string");
    if (!jobJsonStr) throw new Error("Invalid job data: job.json missing");
    const metadata = JSON.parse(jobJsonStr);

    if (metadata.version && metadata.version !== SUPPORTED_JOB_VERSION) {
        throw new Error(`Unsupported job data version: ${metadata.version}`);
    }
    if (!metadata.version) {
        throw new Error('Invalid job data: missing version');
    }
    if (!Number.isFinite(metadata.width) || !Number.isFinite(metadata.height)) {
        throw new Error('Invalid job data: width/height missing');
    }

    // 2. Load heightmap.bin
    const heightmapBuf = await zip.file("heightmap.bin")?.async("arraybuffer");
    if (!heightmapBuf) throw new Error("Invalid job data: heightmap.bin missing");
    const heightMap = new Float32Array(heightmapBuf);

    const expectedSamples = metadata.width * metadata.height;
    if (heightMap.length !== expectedSamples) {
        throw new Error('Invalid job data: heightmap size mismatch');
    }

    // 3. Load osmFeatures.json
    const osmFeaturesStr = await zip.file("osmFeatures.json")?.async("string");
    const osmFeatures = osmFeaturesStr ? JSON.parse(osmFeaturesStr) : [];

    // 4. Load textures
    const terrainData = {
        ...metadata,
        heightMap,
        osmFeatures,
    };

    const textureFiles = {
        "satellite.jpg": "satelliteTextureUrl",
        "osm.png": "osmTextureUrl",
        "hybrid.jpg": "hybridTextureUrl",
        "segmented.png": "segmentedTextureUrl",
        "segmented_hybrid.png": "segmentedHybridTextureUrl"
    };

    for (const [fileName, propName] of Object.entries(textureFiles)) {
        const file = zip.file(fileName);
        if (file) {
            const blob = await file.async("blob");
            terrainData[propName] = URL.createObjectURL(blob);
        }
    }

    return terrainData;
}
