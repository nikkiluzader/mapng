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
    dirt: "#d9ccb5",        // earth, dirt, brownfield, construction
    quarry: "#c3c3c3",      // quarry, mining

    // Developed / Landuse (Using OpenStreetBrowser for distinct zoning)
    residential: "#ccb18b", // OSB: brownish/orange
    commercial: "#d195b6",  // OSB: pinkish
    industrial: "#b7b8cc",  // OSB: bluish grey
    retail: "#ffe285",      // OSB: yellow
    education: "#e39ccf",   // OSB: pink
    military: "#9d9d7c",    // OSB: olive green
    cemetery: "#aacbaf",    // OSB: light green
    sport: "#8bccb3",       // OSB: teal
    park: "#c8df9f",        // OSB: leisure=park

    // Defaults
    building: "#d9d0c9",
    buildingStroke: "#c4b6ab",
    road: "#404040",
    path: "#cccccc",
    barrier: "#C4A484",
    defaultLanduse: "#f2f2f2",

    // Markings
    markingWhite: "rgba(255, 255, 255, 0.7)",
    markingYellow: "rgba(255, 204, 0, 0.8)",
    markingRed: "rgba(255, 50, 50, 0.8)"
};

const getFeatureColor = (tags) => {
    if (!tags) return COLORS.defaultLanduse;

    // --- Vegetation ---
    if (tags.landuse === 'forest' || tags.natural === 'wood' || tags.natural === 'tree_row') return COLORS.forest;
    if (tags.natural === 'scrub' || tags.natural === 'tundra' || tags.natural === 'fell') return COLORS.scrub;
    if (tags.natural === 'heath') return COLORS.heath;
    if (tags.landuse === 'grass' || tags.landuse === 'meadow' || tags.natural === 'grassland' ||
        tags.leisure === 'garden' || tags.landuse === 'village_green' ||
        tags.landuse === 'allotments' || tags.leisure === 'common') return COLORS.grass;
    if (tags.leisure === 'park' || tags.leisure === 'recreation_ground') return COLORS.park;
    if (tags.landuse === 'orchard' || tags.landuse === 'vineyard' || tags.landuse === 'plant_nursery') return COLORS.orchard;
    if (tags.landuse === 'farmland' || tags.landuse === 'greenhouse_horticulture' || tags.landuse === 'farm') return COLORS.farmland;

    // --- Water ---
    if (tags.natural === 'water' || tags.waterway || tags.landuse === 'reservoir' || tags.landuse === 'basin' ||
        tags.landuse === 'salt_pond' || tags.natural === 'reef') return COLORS.water;
    if (tags.natural === 'wetland' || tags.landuse === 'wetland' || tags.natural === 'marsh') return COLORS.wetland;
    if (tags.natural === 'glacier' || tags.landuse === 'glacier') return COLORS.glacier;
    if (tags.natural === 'mud' || tags.landuse === 'mud') return COLORS.mud;

    // --- Bare / Earth ---
    if (tags.natural === 'bare_rock' || tags.natural === 'scree' || tags.natural === 'blockfield' || tags.natural === 'shingle') return COLORS.bare;
    if (tags.natural === 'sand' || tags.natural === 'beach' || tags.natural === 'shoal' || tags.landuse === 'desert') return COLORS.sand;
    if (tags.landuse === 'construction' || tags.landuse === 'brownfield' || tags.natural === 'earth' || tags.natural === 'bare_soil') return COLORS.dirt;
    if (tags.landuse === 'quarry') return COLORS.quarry;

    // --- Developed / Landuse (OSB Logic) ---
    if (tags.landuse === 'education' || tags.amenity === 'school' || tags.amenity === 'university' ||
        tags.amenity === 'college' || tags.amenity === 'kindergarten') return COLORS.education;

    if (tags.landuse === 'industrial' || tags.landuse === 'landfill' ||
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

// Help map tags to user-friendly categories for toggling
export const getFeatureCategory = (feature) => {
    const tags = feature.tags || {};
    if (feature.type === 'water') return 'Water Bodies';
    if (feature.type === 'building') return 'Buildings';
    if (feature.type === 'road') return 'Roads';
    if (feature.type === 'barrier') return 'Barriers';

    // Vegetation & Natural
    if (tags.landuse === 'forest' || tags.natural === 'wood' || tags.natural === 'tree_row') return 'Forests';
    if (tags.landuse === 'grass' || tags.landuse === 'meadow' || tags.natural === 'grassland') return 'Grass & Meadows';
    if (tags.leisure === 'park' || tags.leisure === 'garden' || tags.leisure === 'common' || tags.leisure === 'recreation_ground') return 'Parks & Gardens';
    if (tags.landuse === 'farmland' || tags.landuse === 'farm' || tags.landuse === 'orchard' || tags.landuse === 'vineyard') return 'Farmland & Orchards';
    if (tags.natural === 'scrub' || tags.natural === 'heath' || tags.natural === 'tundra') return 'Scrub & Heath';
    if (tags.natural === 'wetland' || tags.natural === 'marsh' || tags.natural === 'mud') return 'Wetlands & Swamps';

    // Bare / Earth
    if (tags.natural === 'bare_rock' || tags.natural === 'scree' || tags.natural === 'glacier') return 'Rock & Ice';
    if (tags.natural === 'sand' || tags.natural === 'beach' || tags.landuse === 'desert') return 'Sand & Beaches';
    if (tags.landuse === 'construction' || tags.landuse === 'brownfield' || tags.natural === 'earth' || tags.natural === 'bare_soil') return 'Dirt & Construction';
    if (tags.landuse === 'quarry') return 'Quarries & Mining';

    // Developed
    if (tags.landuse === 'residential') return 'Residential Areas';
    if (tags.landuse === 'commercial' || tags.landuse === 'retail') return 'Commercial & Retail';
    if (tags.landuse === 'industrial' || tags.landuse === 'railway' || tags.power === 'sub_station') return 'Industrial & Power';
    if (tags.landuse === 'military' || tags.military) return 'Military Zones';
    if (tags.landuse === 'cemetery') return 'Cemeteries';
    if (tags.leisure === 'golf_course' || tags.leisure === 'sports_centre' || tags.leisure === 'stadium' || tags.leisure === 'pitch') return 'Sports & Leisure';

    return 'Other Landuse';
};

// Helper to calculate approximate area of a LatLng feature for Z-sorting
const getFeatureArea = (feature) => {
    const points = feature.geometry;
    if (points.length < 3) return 0;

    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];
        area += (p2.lng - p1.lng) * (p2.lat + p1.lat);
    }
    return Math.abs(area);
};

// --- Procedural Road Marking Helpers ---

const getOffsetPath = (points, offsetMeters, toPixel, SCALE_FACTOR) => {
    if (points.length < 2) return [];
    const offsetPath = [];

    // Project points once for speed and accuracy
    const projected = points.map(p => toPixel(p.lat, p.lng));

    for (let i = 0; i < projected.length; i++) {
        const p = projected[i];
        let dx, dy;

        if (i === 0) {
            dx = projected[i + 1].x - projected[i].x;
            dy = projected[i + 1].y - projected[i].y;
        } else if (i === projected.length - 1) {
            dx = projected[i].x - projected[i - 1].x;
            dy = projected[i].y - projected[i - 1].y;
        } else {
            dx = projected[i + 1].x - projected[i - 1].x;
            dy = projected[i + 1].y - projected[i - 1].y;
        }

        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) {
            offsetPath.push(p);
            continue;
        }

        // Perpendicular vector in pixel space
        const nx = -dy / len;
        const ny = dx / len;

        offsetPath.push({
            x: p.x + nx * offsetMeters * SCALE_FACTOR,
            y: p.y + ny * offsetMeters * SCALE_FACTOR
        });
    }
    return offsetPath;
};

const drawPathData = (ctx, points) => {
    if (points.length < 2) return;
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
    }
};

const drawRoadWithMarkings = (ctx, feature, toPixel, SCALE_FACTOR, isHybrid = false) => {
    const tags = feature.tags || {};
    const highway = tags.highway;
    const isOneWay = tags.oneway === 'yes' || tags.oneway === '1' || highway === 'motorway';

    // 1. Determine Properties
    let baseWidth = 6;
    let lanes = parseInt(tags.lanes);

    if (highway === 'motorway' || highway === 'motorway_link') baseWidth = 14;
    else if (highway === 'trunk' || highway === 'trunk_link') baseWidth = 12;
    else if (highway === 'primary' || highway === 'primary_link') baseWidth = 12;
    else if (highway === 'secondary' || highway === 'secondary_link') baseWidth = 10;
    else if (highway === 'tertiary' || highway === 'tertiary_link') baseWidth = 8;
    else if (highway === 'residential' || highway === 'unclassified') baseWidth = 7;
    else if (highway === 'service') baseWidth = 5;
    else baseWidth = 4;

    if (isNaN(lanes)) {
        if (baseWidth >= 12) lanes = 4;
        else if (baseWidth >= 7) lanes = 2;
        else lanes = 1;
    }

    const totalWidthPx = baseWidth * SCALE_FACTOR;
    const laneWidth = baseWidth / lanes;

    // 2. Draw Pavement
    ctx.beginPath();
    const centerPoints = feature.geometry.map(p => toPixel(p.lat, p.lng));
    drawPathData(ctx, centerPoints);
    ctx.strokeStyle = COLORS.road;
    ctx.lineWidth = totalWidthPx;
    ctx.setLineDash([]);
    ctx.stroke();

    // 3. Draw Markings (only if wide enough and in hybrid/detailed mode)
    // Heuristic: Minor neighborhood roads (residential, service, etc.) usually don't have paint 
    // unless they are multi-lane or explicitly marked in OSM.
    const isMinor = highway === 'residential' || highway === 'service' || highway === 'living_street' || highway === 'unclassified';
    const hasExplicitMarkings = tags.lane_markings === 'yes' || tags.road_marking === 'yes';
    const shouldMark = !isMinor || lanes > 2 || hasExplicitMarkings;

    if (baseWidth >= 5 && shouldMark) {
        // Edge Lines
        ctx.strokeStyle = COLORS.markingWhite;
        ctx.lineWidth = 0.15 * SCALE_FACTOR;

        ctx.beginPath();
        drawPathData(ctx, getOffsetPath(feature.geometry, (baseWidth / 2 - 0.2), toPixel, SCALE_FACTOR));
        ctx.stroke();

        ctx.beginPath();
        drawPathData(ctx, getOffsetPath(feature.geometry, -(baseWidth / 2 - 0.2), toPixel, SCALE_FACTOR));
        ctx.stroke();

        // Centerline / Lane Dividers
        for (let i = 1; i < lanes; i++) {
            const offset = -baseWidth / 2 + i * laneWidth;
            const isCenter = Math.abs(offset) < 0.1;

            ctx.beginPath();
            drawPathData(ctx, getOffsetPath(feature.geometry, offset, toPixel, SCALE_FACTOR));

            if (isCenter && !isOneWay) {
                // Direction Divider (Yellow for US-style)
                ctx.strokeStyle = COLORS.markingYellow;
                if (baseWidth >= 10) {
                    // Double yellow for wider roads
                    ctx.setLineDash([]);
                    ctx.lineWidth = 0.1 * SCALE_FACTOR;
                    ctx.stroke();

                    ctx.beginPath();
                    drawPathData(ctx, getOffsetPath(feature.geometry, offset + 0.2, toPixel, SCALE_FACTOR));
                    ctx.stroke();
                } else {
                    ctx.setLineDash([4 * SCALE_FACTOR, 4 * SCALE_FACTOR]);
                    ctx.lineWidth = 0.15 * SCALE_FACTOR;
                    ctx.stroke();
                }
            } else {
                // Lane Divider (Dashed White)
                ctx.strokeStyle = COLORS.markingWhite;
                ctx.setLineDash([3 * SCALE_FACTOR, 6 * SCALE_FACTOR]);
                ctx.lineWidth = 0.12 * SCALE_FACTOR;
                ctx.stroke();
            }
        }
        ctx.setLineDash([]);
    }
    ctx.setLineDash([]);
};

// Internal drawing helper used for both full rendering and pre-rendered layers
const renderFeaturesToCanvas = (ctx, features, toPixel, SCALE_FACTOR) => {
    const water = features.filter(f => f.type === 'water');
    const vegetation = features.filter(f => f.type === 'vegetation');
    const roads = features.filter(f => f.type === 'road');
    const buildings = features.filter(f => f.type === 'building');
    const barriers = features.filter(f => f.type === 'barrier');

    // Drawing Path helper (closure for this specific ctx/toPixel)
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

    // 1. Draw Vegetation / Landuse
    const sortedVegetation = vegetation
        .map(f => ({ f, area: getFeatureArea(f) }))
        .sort((a, b) => b.area - a.area);

    for (const { f } of sortedVegetation) {
        ctx.fillStyle = getFeatureColor(f.tags);
        if (f.geometry.length === 1) {
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
    const sortedWater = water
        .map(f => ({ f, area: getFeatureArea(f) }))
        .sort((a, b) => b.area - a.area);
    ctx.fillStyle = COLORS.water;
    for (const { f } of sortedWater) {
        drawPolygon(f);
        ctx.fill('evenodd');
    }

    // 3. Draw Roads
    for (const f of roads) {
        const highway = f.tags?.highway;
        if (highway === 'footway' || highway === 'path' || highway === 'pedestrian' || highway === 'cycleway' || highway === 'steps' || highway === 'track') {
            ctx.beginPath();
            drawPath(f.geometry);
            ctx.strokeStyle = COLORS.path;
            ctx.lineWidth = 2 * SCALE_FACTOR;
            ctx.stroke();
        } else {
            drawRoadWithMarkings(ctx, f, toPixel, SCALE_FACTOR);
        }
    }

    // 4. Draw Buildings
    ctx.lineWidth = 0.5 * SCALE_FACTOR;
    for (const f of buildings) {
        let color = COLORS.building;
        const specificColor = getFeatureColor(f.tags);
        if (specificColor !== COLORS.defaultLanduse) color = specificColor;
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
};

// Generates an object containing separate canvases for each ground cover layer
export const generateLayerCanvases = async (terrainData) => {
    const TARGET_RESOLUTION = 8192;
    let SCALE_FACTOR = Math.ceil(TARGET_RESOLUTION / terrainData.width);
    if (SCALE_FACTOR < 1) SCALE_FACTOR = 1;

    const width = terrainData.width * SCALE_FACTOR;
    const height = terrainData.height * SCALE_FACTOR;

    // Projection Setup
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

    // Group features by category
    const layers = {};
    for (const f of terrainData.osmFeatures) {
        const cat = getFeatureCategory(f);
        if (!layers[cat]) layers[cat] = [];
        layers[cat].push(f);
    }

    const canvases = {};
    for (const [cat, features] of Object.entries(layers)) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;

        renderFeaturesToCanvas(ctx, features, toPixel, SCALE_FACTOR);
        canvases[cat] = canvas;
    }

    return canvases;
};

export const generateOSMTexture = async (terrainData, visibilityOptions = null, layerCanvases = null) => {
    const TARGET_RESOLUTION = 8192;
    let SCALE_FACTOR = Math.ceil(TARGET_RESOLUTION / terrainData.width);
    if (SCALE_FACTOR < 1) SCALE_FACTOR = 1;

    const canvas = document.createElement('canvas');
    canvas.width = terrainData.width * SCALE_FACTOR;
    canvas.height = terrainData.height * SCALE_FACTOR;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Could not get 2D context");

    ctx.fillStyle = COLORS.defaultLanduse;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Fast Path: Composite pre-rendered layers
    if (layerCanvases && visibilityOptions) {
        for (const [cat, lCanvas] of Object.entries(layerCanvases)) {
            if (visibilityOptions[cat] !== false) {
                ctx.drawImage(lCanvas, 0, 0);
            }
        }
    }
    // Slow Path: Re-render from vector data
    else {
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

        const features = visibilityOptions
            ? terrainData.osmFeatures.filter(f => visibilityOptions[getFeatureCategory(f)] !== false)
            : terrainData.osmFeatures;

    }

    return new Promise((resolve) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(URL.createObjectURL(blob));
            else resolve('');
        }, 'image/png');
    });
};

export const generateHybridTexture = async (terrainData, visibilityOptions = null, layerCanvases = null) => {
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
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Fast Path: Composite pre-rendered layers with transparency
    if (layerCanvases && visibilityOptions) {
        ctx.globalAlpha = 0.5;
        // Draw Landuse & Water
        for (const [cat, lCanvas] of Object.entries(layerCanvases)) {
            if (visibilityOptions[cat] !== false && cat !== 'Roads' && cat !== 'Buildings' && cat !== 'Barriers') {
                ctx.drawImage(lCanvas, 0, 0);
            }
        }
        ctx.globalAlpha = 1.0;
        // Draw Roads, Buildings, Barriers (full opacity)
        if (visibilityOptions['Roads'] !== false && layerCanvases['Roads']) ctx.drawImage(layerCanvases['Roads'], 0, 0);
        if (visibilityOptions['Buildings'] !== false && layerCanvases['Buildings']) ctx.drawImage(layerCanvases['Buildings'], 0, 0);
        if (visibilityOptions['Barriers'] !== false && layerCanvases['Barriers']) ctx.drawImage(layerCanvases['Barriers'], 0, 0);
    }
    // Slow Path: Re-render from vector data
    else {
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

        const features = visibilityOptions
            ? terrainData.osmFeatures.filter(f => visibilityOptions[getFeatureCategory(f)] !== false)
            : terrainData.osmFeatures;

        const landcover = features.filter(f => f.type === 'vegetation' || f.type === 'water');
        const overlay = features.filter(f => f.type === 'road' || f.type === 'building' || f.type === 'barrier');

        ctx.globalAlpha = 0.5;
        renderFeaturesToCanvas(ctx, landcover, toPixel, SCALE_FACTOR);
        ctx.globalAlpha = 1.0;
        renderFeaturesToCanvas(ctx, overlay, toPixel, SCALE_FACTOR);
    }

    return new Promise((resolve) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(URL.createObjectURL(blob));
            else resolve('');
        }, 'image/png');
    });
};
