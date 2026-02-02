import proj4 from 'proj4';

// Colors mixed from standard OSM Carto and OpenStreetBrowser
// Carto: https://github.com/gravitystorm/openstreetmap-carto/blob/master/style/landcover.mss
// OSB: https://wiki.openstreetmap.org/wiki/OpenStreetBrowser/Landuse-_and_Building_Colors
const COLORS = {
    // Vegetation (Standard Carto is good for these)
    forest: "#add19e",      // wood, forest
    scrub: "#c8d7ab",       // scrub, tundra, fell
    heath: "#d6d99f",       // heath
    grass: "#cdebb0",       // grassland, grass, meadow, garden, village_green, allotments
    orchard: "#aedfa3",     // orchard, vineyard, plant_nursery
    farmland: "#eef0d5",    // farmland, greenhouse_horticulture

    // Water (Standard Carto)
    water: "#aad3df",       // water, basin, salt_pond, reef
    wetland: "#d6d99f",     // wetland
    glacier: "#ddecec",     // glacier
    mud: "#e6dcd1",         // mud

    // Bare (Standard Carto)
    bare: "#eee5dc",        // bare_rock, scree, blockfield, shingle
    sand: "#f5e9c6",        // sand, beach, shoal
    
    // Developed / Landuse (Using OpenStreetBrowser for distinct zoning)
    residential: "#ccb18b", // OSB: brownish/orange
    commercial: "#d195b6",  // OSB: pinkish
    industrial: "#b7b8cc",  // OSB: bluish grey (also quarry, landfill)
    retail: "#ffe285",      // OSB: yellow
    education: "#e39ccf",   // OSB: pink
    military: "#93a65b",    // OSB: olive green
    cemetery: "#8acb94",    // OSB: green
    sport: "#8bccb3",       // OSB: teal
    
    // Defaults
    building: "#d9d0c9",
    buildingStroke: "#c4b6ab",
    road: "#404040",
    path: "#cccccc",
    barrier: "#C4A484",
    defaultLanduse: "#f2f2f2"
};

const getFeatureColor = (tags) => {
    if (!tags) return COLORS.defaultLanduse;

    // --- Vegetation ---
    if (tags.landuse === 'forest' || tags.natural === 'wood' || tags.natural === 'tree_row') return COLORS.forest;
    if (tags.natural === 'scrub' || tags.natural === 'tundra' || tags.natural === 'fell') return COLORS.scrub;
    if (tags.natural === 'heath') return COLORS.heath;
    if (tags.landuse === 'grass' || tags.landuse === 'meadow' || tags.natural === 'grassland' || 
        tags.leisure === 'park' || tags.leisure === 'garden' || tags.landuse === 'village_green' || 
        tags.landuse === 'allotments' || tags.leisure === 'common') return COLORS.grass;
    if (tags.landuse === 'orchard' || tags.landuse === 'vineyard' || tags.landuse === 'plant_nursery') return COLORS.orchard;
    if (tags.landuse === 'farmland' || tags.landuse === 'greenhouse_horticulture' || tags.landuse === 'farm') return COLORS.farmland;

    // --- Water ---
    if (tags.natural === 'water' || tags.waterway || tags.landuse === 'reservoir' || tags.landuse === 'basin' || 
        tags.landuse === 'salt_pond' || tags.natural === 'reef') return COLORS.water;
    if (tags.natural === 'wetland' || tags.landuse === 'wetland' || tags.natural === 'marsh') return COLORS.wetland;
    if (tags.natural === 'glacier' || tags.landuse === 'glacier') return COLORS.glacier;
    if (tags.natural === 'mud' || tags.landuse === 'mud') return COLORS.mud;

    // --- Bare ---
    if (tags.natural === 'bare_rock' || tags.natural === 'scree' || tags.natural === 'blockfield' || tags.natural === 'shingle') return COLORS.bare;
    if (tags.natural === 'sand' || tags.natural === 'beach' || tags.natural === 'shoal' || tags.landuse === 'desert') return COLORS.sand;

    // --- Developed / Landuse (OSB Logic) ---
    if (tags.landuse === 'education' || tags.amenity === 'school' || tags.amenity === 'university' || 
        tags.amenity === 'college' || tags.amenity === 'kindergarten') return COLORS.education;

    if (tags.landuse === 'industrial' || tags.landuse === 'quarry' || tags.landuse === 'landfill' || 
        tags.landuse === 'construction' || tags.landuse === 'railway' || tags.power === 'sub_station' || 
        tags.power === 'generator') return COLORS.industrial;

    if (tags.landuse === 'residential') return COLORS.residential;
    
    if (tags.landuse === 'commercial' || tags.amenity === 'office') return COLORS.commercial;
    
    if (tags.landuse === 'retail' || tags.shop || tags.amenity === 'marketplace') return COLORS.retail;
    
    if (tags.landuse === 'military' || tags.military) return COLORS.military;
    
    if (tags.landuse === 'cemetery' || tags.amenity === 'grave_yard') return COLORS.cemetery;
    
    if (tags.leisure === 'golf_course' || tags.leisure === 'playground' || tags.leisure === 'sports_centre' || 
        tags.leisure === 'track' || tags.leisure === 'pitch' || tags.leisure === 'stadium') return COLORS.sport;

    return COLORS.defaultLanduse;
};

export const generateOSMTexture = async (terrainData) => {
    // Target extremely high resolution (8192px) to ensure "SVG-like" sharpness.
    // We use the raw vector data to render this, which is superior to fetching raster tiles
    // because it allows for infinite scaling without pixelation (until rasterization) and
    // gives us complete control to remove labels and style features.
    const TARGET_RESOLUTION = 8192;
    let SCALE_FACTOR = Math.ceil(TARGET_RESOLUTION / terrainData.width);
    if (SCALE_FACTOR < 1) SCALE_FACTOR = 1;

    const canvas = document.createElement('canvas');
    canvas.width = terrainData.width * SCALE_FACTOR;
    canvas.height = terrainData.height * SCALE_FACTOR;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Could not get 2D context");

    // Fill background
    ctx.fillStyle = COLORS.defaultLanduse;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Helper to project LatLng to Canvas coordinates (Metric)
    const centerLat = (terrainData.bounds.north + terrainData.bounds.south) / 2;
    const centerLng = (terrainData.bounds.east + terrainData.bounds.west) / 2;
    const localProjDef = `+proj=tmerc +lat_0=${centerLat} +lon_0=${centerLng} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs`;
    const toMetric = proj4('EPSG:4326', localProjDef);
    const halfWidth = terrainData.width / 2;
    const halfHeight = terrainData.height / 2;

    const toPixel = (lat, lng) => {
        const [localX, localY] = toMetric.forward([lng, lat]);
        const x = (localX + halfWidth) * SCALE_FACTOR;
        const y = (halfHeight - localY) * SCALE_FACTOR;
        return { x, y };
    };

    const drawPath = (points) => {
        if (points.length < 2) return;
        const start = toPixel(points[0].lat, points[0].lng);
        ctx.moveTo(start.x, start.y);
        for (let i = 1; i < points.length; i++) {
            const p = toPixel(points[i].lat, points[i].lng);
            ctx.lineTo(p.x, p.y);
        }
    };

    const drawPolygon = (feature) => {
        ctx.beginPath();
        drawPath(feature.geometry);
        ctx.closePath();
        
        if (feature.holes) {
            for (const hole of feature.holes) {
                drawPath(hole);
                ctx.closePath();
            }
        }
    };

    // Sort features by type to draw in correct order
    const features = terrainData.osmFeatures;
    
    const water = features.filter(f => f.type === 'water');
    const vegetation = features.filter(f => f.type === 'vegetation');
    const roads = features.filter(f => f.type === 'road');
    const buildings = features.filter(f => f.type === 'building');
    const barriers = features.filter(f => f.type === 'barrier');

    // 1. Draw Vegetation / Landuse (Background Layers)
    for (const f of vegetation) {
        const color = getFeatureColor(f.tags);
        ctx.fillStyle = color;
        
        if (f.geometry.length === 1) {
            // Draw tree point
            const p = toPixel(f.geometry[0].lat, f.geometry[0].lng);
            ctx.beginPath();
            ctx.arc(p.x, p.y, 1.5 * SCALE_FACTOR, 0, Math.PI * 2);
            ctx.fill();
        } else {
            drawPolygon(f);
            ctx.fill('evenodd');
        }
    }

    // 2. Draw Water
    ctx.fillStyle = COLORS.water;
    for (const f of water) {
        drawPolygon(f);
        ctx.fill('evenodd');
    }

    // 3. Draw Roads
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    for (const f of roads) {
        ctx.beginPath();
        drawPath(f.geometry);
        
        const highway = f.tags?.highway;
        
        // Footpaths and tracks (Light Grey)
        if (highway === 'footway' || highway === 'path' || highway === 'pedestrian' || highway === 'cycleway' || highway === 'steps' || highway === 'track') {
             ctx.strokeStyle = COLORS.path; 
             ctx.lineWidth = 2 * SCALE_FACTOR;
             ctx.stroke();
        } 
        // Vehicle roads (Solid Dark Grey)
        else {
            ctx.strokeStyle = COLORS.road; 
            
            // Vary width by importance
            if (highway === 'motorway' || highway === 'trunk') {
                ctx.lineWidth = 8 * SCALE_FACTOR;
            } else if (highway === 'primary' || highway === 'secondary') {
                ctx.lineWidth = 6 * SCALE_FACTOR;
            } else {
                ctx.lineWidth = 4 * SCALE_FACTOR;
            }
            ctx.stroke();
        }
    }

    // 4. Draw Buildings
    ctx.lineWidth = 0.5 * SCALE_FACTOR;
    for (const f of buildings) {
        let color = COLORS.building;
        
        // Try to find a more specific color based on tags
        const specificColor = getFeatureColor(f.tags);
        if (specificColor !== COLORS.defaultLanduse) {
            color = specificColor;
        }

        ctx.fillStyle = color;
        ctx.strokeStyle = COLORS.buildingStroke;
        
        drawPolygon(f);
        ctx.fill('evenodd');
        ctx.stroke();
    }
    
    // 5. Draw Barriers
    ctx.strokeStyle = COLORS.barrier;
    ctx.lineWidth = 1 * SCALE_FACTOR;
    for (const f of barriers) {
        ctx.beginPath();
        drawPath(f.geometry);
        ctx.stroke();
    }

    return new Promise((resolve) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(URL.createObjectURL(blob));
            else resolve('');
        }, 'image/png');
    });
};

export const generateHybridTexture = async (terrainData) => {
    // Target extremely high resolution (8192px) to ensure "SVG-like" sharpness.
    const TARGET_RESOLUTION = 8192;
    let SCALE_FACTOR = Math.ceil(TARGET_RESOLUTION / terrainData.width);
    if (SCALE_FACTOR < 1) SCALE_FACTOR = 1;

    const canvas = document.createElement('canvas');
    canvas.width = terrainData.width * SCALE_FACTOR;
    canvas.height = terrainData.height * SCALE_FACTOR;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Could not get 2D context");

    // 1. Draw Satellite Background
    if (terrainData.satelliteTextureUrl) {
        const img = new Image();
        img.src = terrainData.satelliteTextureUrl;
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
        });
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    } else {
        // Fallback if no satellite image
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Helper to project LatLng to Canvas coordinates (Metric)
    const centerLat = (terrainData.bounds.north + terrainData.bounds.south) / 2;
    const centerLng = (terrainData.bounds.east + terrainData.bounds.west) / 2;
    const localProjDef = `+proj=tmerc +lat_0=${centerLat} +lon_0=${centerLng} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs`;
    const toMetric = proj4('EPSG:4326', localProjDef);
    const halfWidth = terrainData.width / 2;
    const halfHeight = terrainData.height / 2;

    const toPixel = (lat, lng) => {
        const [localX, localY] = toMetric.forward([lng, lat]);
        const x = (localX + halfWidth) * SCALE_FACTOR;
        const y = (halfHeight - localY) * SCALE_FACTOR;
        return { x, y };
    };

    const drawPath = (points) => {
        if (points.length < 2) return;
        const start = toPixel(points[0].lat, points[0].lng);
        ctx.moveTo(start.x, start.y);
        for (let i = 1; i < points.length; i++) {
            const p = toPixel(points[i].lat, points[i].lng);
            ctx.lineTo(p.x, p.y);
        }
    };

    const drawPolygon = (feature) => {
        ctx.beginPath();
        drawPath(feature.geometry);
        ctx.closePath();
        
        if (feature.holes) {
            for (const hole of feature.holes) {
                drawPath(hole);
                ctx.closePath();
            }
        }
    };

    // Sort features by type to draw in correct order
    const features = terrainData.osmFeatures;
    
    const roads = features.filter(f => f.type === 'road');
    const buildings = features.filter(f => f.type === 'building');
    const barriers = features.filter(f => f.type === 'barrier');

    // 2. Draw Roads
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    for (const f of roads) {
        ctx.beginPath();
        drawPath(f.geometry);
        
        const highway = f.tags?.highway;
        
        // Footpaths and tracks (Light Grey)
        if (highway === 'footway' || highway === 'path' || highway === 'pedestrian' || highway === 'cycleway' || highway === 'steps' || highway === 'track') {
             ctx.strokeStyle = COLORS.path; 
             ctx.lineWidth = 2 * SCALE_FACTOR;
             ctx.stroke();
        } 
        // Vehicle roads (Solid Dark Grey)
        else {
            ctx.strokeStyle = COLORS.road; 
            
            // Vary width by importance
            if (highway === 'motorway' || highway === 'trunk') {
                ctx.lineWidth = 8 * SCALE_FACTOR;
            } else if (highway === 'primary' || highway === 'secondary') {
                ctx.lineWidth = 6 * SCALE_FACTOR;
            } else {
                ctx.lineWidth = 4 * SCALE_FACTOR;
            }
            ctx.stroke();
        }
    }

    // 3. Draw Buildings
    ctx.lineWidth = 0.5 * SCALE_FACTOR;
    for (const f of buildings) {
        let color = COLORS.building;
        
        // Try to find a more specific color based on tags
        const specificColor = getFeatureColor(f.tags);
        if (specificColor !== COLORS.defaultLanduse) {
            color = specificColor;
        }

        ctx.fillStyle = color;
        ctx.strokeStyle = COLORS.buildingStroke;
        
        drawPolygon(f);
        ctx.fill('evenodd');
        ctx.stroke();
    }
    
    // 4. Draw Barriers
    ctx.strokeStyle = COLORS.barrier;
    ctx.lineWidth = 1 * SCALE_FACTOR;
    for (const f of barriers) {
        ctx.beginPath();
        drawPath(f.geometry);
        ctx.stroke();
    }

    return new Promise((resolve) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(URL.createObjectURL(blob));
            else resolve('');
        }, 'image/png');
    });
};
