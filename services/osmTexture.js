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

    // --- OSM2World inspired surface mapping ---
    const surface = tags.surface || tags.landcover || tags.landuse || tags.natural || tags.leisure;

    if (tags.natural === 'water' || tags.waterway || tags.landuse === 'reservoir' || tags.landuse === 'basin') return COLORS.water;
    if (tags.natural === 'wetland') return COLORS.wetland;

    if (['forest', 'wood'].includes(surface)) return COLORS.forest;
    if (['grass', 'meadow', 'grassland', 'fell', 'park', 'village_green', 'garden'].includes(surface)) return COLORS.grass;
    if (['scrub', 'heath', 'tundra'].includes(surface)) return COLORS.scrub;
    
    if (['sand', 'beach'].includes(surface)) return COLORS.sand;
    if (['bare_rock', 'rock', 'scree', 'shingle'].includes(surface)) return COLORS.bare;
    if (['glacier', 'snow'].includes(surface)) return COLORS.glacier;
    if (['mud', 'ground', 'dirt', 'earth', 'construction'].includes(surface)) return COLORS.dirt;

    if (['residential'].includes(surface)) return COLORS.residential;
    if (['commercial', 'retail'].includes(surface)) return COLORS.commercial;
    if (['industrial', 'quarry', 'railway'].includes(surface)) return COLORS.industrial;
    if (['military'].includes(surface)) return COLORS.military;
    if (['cemetery'].includes(surface)) return COLORS.cemetery;
    if (['pitch', 'track', 'stadium', 'golf_course', 'playground'].includes(surface)) return COLORS.sport;

    return COLORS.defaultLanduse;
};

// Help map tags to user-friendly categories (simplified for internal use)
export const getFeatureCategory = (feature) => {
    return feature.type;
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

const getLaneLayout = (tags) => {
    const highway = tags.highway;
    const isOneWay = tags.oneway === 'yes' || tags.oneway === '1' || highway === 'motorway';
    const lanesT = parseInt(tags.lanes) || (isOneWay ? 1 : 2);
    const lanesF = parseInt(tags['lanes:forward']) || Math.ceil(lanesT / 2);
    const lanesB = parseInt(tags['lanes:backward']) || (lanesT - lanesF);
    
    const layout = {
        totalWidth: parseFloat(tags.width) || 0,
        lanes: []
    };

    // 1. Initial width estimation
    if (layout.totalWidth === 0) {
        if (highway === 'motorway' || highway === 'trunk') layout.totalWidth = lanesT * 3.7;
        else if (highway === 'primary' || highway === 'secondary') layout.totalWidth = lanesT * 3.5;
        else if (highway === 'tertiary' || highway === 'residential') layout.totalWidth = lanesT * 3.0;
        else layout.totalWidth = lanesT * 2.8;
    }

    // 2. Build lane list (Left to Right)
    // Sidewalks & Cycleways
    const hasLeftSidewalk = tags.sidewalk === 'left' || tags.sidewalk === 'both';
    const hasRightSidewalk = tags.sidewalk === 'right' || tags.sidewalk === 'both';
    const hasLeftCycleway = tags['cycleway:left'] === 'lane' || tags.cycleway === 'lane';
    const hasRightCycleway = tags['cycleway:right'] === 'lane' || tags.cycleway === 'lane';

    if (hasLeftSidewalk) layout.lanes.push({ type: 'sidewalk', width: 2.0, color: '#999999' });
    if (hasLeftCycleway) layout.lanes.push({ type: 'cycleway', width: 1.5, color: '#704444' });

    // Vehicle Lanes (Backward)
    if (!isOneWay) {
        for (let i = 0; i < lanesB; i++) {
            if (i > 0) layout.lanes.push({ type: 'separator', width: 0.15, color: COLORS.markingWhite, dash: [2, 4] });
            layout.lanes.push({ type: 'vehicle', width: 3.5 });
        }
        // Center Divider
        layout.lanes.push({ type: 'divider', width: 0.2, color: COLORS.markingYellow, double: lanesT >= 4 });
    }

    // Vehicle Lanes (Forward)
    for (let i = 0; i < (isOneWay ? lanesT : lanesF); i++) {
        if (i > 0) layout.lanes.push({ type: 'separator', width: 0.15, color: COLORS.markingWhite, dash: [2, 4] });
        layout.lanes.push({ type: 'vehicle', width: 3.5 });
    }

    if (hasRightCycleway) layout.lanes.push({ type: 'cycleway', width: 1.5, color: '#704444' });
    if (hasRightSidewalk) layout.lanes.push({ type: 'sidewalk', width: 2.0, color: '#999999' });

    // 3. Normalize widths to fit total width
    let currentSum = layout.lanes.reduce((sum, l) => sum + l.width, 0);
    const scale = layout.totalWidth / currentSum;
    layout.lanes.forEach(l => l.width *= scale);

    // 4. Calculate offsets from center
    let offset = -layout.totalWidth / 2;
    layout.lanes.forEach(l => {
        l.offset = offset + l.width / 2;
        offset += l.width;
    });

    return layout;
};

const drawRoadWithMarkings = (ctx, feature, toPixel, SCALE_FACTOR) => {
    const layout = getLaneLayout(feature.tags || {});
    const geometry = feature.geometry;

    // 1. Draw Base Pavement (Combined)
    ctx.beginPath();
    const centerPoints = geometry.map(p => toPixel(p.lat, p.lng));
    drawPathData(ctx, centerPoints);
    ctx.strokeStyle = COLORS.road;
    ctx.lineWidth = layout.totalWidth * SCALE_FACTOR;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // 2. Draw Individual Lane Features
    layout.lanes.forEach(lane => {
        if (lane.type === 'vehicle') return; // Pavement already covers it

        ctx.beginPath();
        const offsetPath = getOffsetPath(geometry, lane.offset, toPixel, SCALE_FACTOR);
        drawPathData(ctx, offsetPath);
        
        ctx.strokeStyle = lane.color || COLORS.road;
        ctx.lineWidth = lane.width * SCALE_FACTOR;
        
        if (lane.type === 'divider' && lane.double) {
            // Double yellow line
            ctx.setLineDash([]);
            const gap = 0.1 * SCALE_FACTOR;
            ctx.lineWidth = 0.1 * SCALE_FACTOR;
            
            ctx.beginPath();
            drawPathData(ctx, getOffsetPath(geometry, lane.offset - 0.15, toPixel, SCALE_FACTOR));
            ctx.stroke();
            
            ctx.beginPath();
            drawPathData(ctx, getOffsetPath(geometry, lane.offset + 0.15, toPixel, SCALE_FACTOR));
            ctx.stroke();
        } else {
            if (lane.dash) {
                ctx.setLineDash(lane.dash.map(d => d * SCALE_FACTOR));
            } else {
                ctx.setLineDash([]);
            }
            ctx.stroke();
        }
    });
    
    ctx.setLineDash([]);
};

const renderFeaturesToCanvas = (ctx, features, toPixel, SCALE_FACTOR, options = {}) => {
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

    // 1. Draw Landcover & Landuse (Sorted by area)
    const landcover = features.filter(f => ['vegetation', 'water'].includes(f.type));
    const sortedLC = landcover.map(f => ({ f, area: getFeatureArea(f) })).sort((a, b) => b.area - a.area);
    
    if (options.alpha) ctx.globalAlpha = options.alpha;
    for (const { f } of sortedLC) {
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
    ctx.globalAlpha = 1.0;

    // 2. Draw Roads (with priority sorting)
    const roads = features.filter(f => f.type === 'road');
    const roadPriority = {
        'motorway': 100, 'motorway_link': 100,
        'trunk': 90, 'trunk_link': 90,
        'primary': 80, 'primary_link': 80,
        'secondary': 70, 'secondary_link': 70,
        'tertiary': 60, 'tertiary_link': 60,
        'residential': 50, 'unclassified': 40, 'service': 30,
        'path': 20, 'footway': 20, 'cycleway': 20
    };
    roads.sort((a, b) => {
        const layerA = parseInt(a.tags.layer) || 0;
        const layerB = parseInt(b.tags.layer) || 0;
        if (layerA !== layerB) return layerA - layerB;
        return (roadPriority[a.tags.highway] || 10) - (roadPriority[b.tags.highway] || 10);
    });

    roads.forEach(f => {
        const highway = f.tags?.highway;
        if (['footway', 'path', 'pedestrian', 'cycleway', 'steps', 'track'].includes(highway)) {
            ctx.beginPath();
            drawPath(f.geometry);
            ctx.strokeStyle = COLORS.path;
            ctx.lineWidth = 2 * SCALE_FACTOR;
            ctx.stroke();
        } else {
            drawRoadWithMarkings(ctx, f, toPixel, SCALE_FACTOR);
        }
    });

    // 3. Draw Buildings
    const buildings = features.filter(f => f.type === 'building');
    ctx.lineWidth = 0.5 * SCALE_FACTOR;
    buildings.forEach(f => {
        ctx.fillStyle = getFeatureColor(f.tags);
        ctx.strokeStyle = COLORS.buildingStroke;
        drawPolygon(f);
        ctx.fill('evenodd');
        ctx.stroke();
    });

    // 4. Draw Barriers
    const barriers = features.filter(f => f.type === 'barrier');
    ctx.strokeStyle = COLORS.barrier;
    ctx.lineWidth = 1 * SCALE_FACTOR;
    barriers.forEach(f => {
        ctx.beginPath();
        drawPath(f.geometry);
        ctx.stroke();
    });
};

export const generateOSMTexture = async (terrainData) => {
    const TARGET_RESOLUTION = 8192;
    let SCALE_FACTOR = Math.max(1, Math.ceil(TARGET_RESOLUTION / terrainData.width));
    const canvas = document.createElement('canvas');
    canvas.width = terrainData.width * SCALE_FACTOR;
    canvas.height = terrainData.height * SCALE_FACTOR;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Could not get 2D context");

    const centerLat = (terrainData.bounds.north + terrainData.bounds.south) / 2;
    const centerLng = (terrainData.bounds.east + terrainData.bounds.west) / 2;
    const localProjDef = `+proj=tmerc +lat_0=${centerLat} +lon_0=${centerLng} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs`;
    const toMetric = proj4('EPSG:4326', localProjDef);
    const halfW = terrainData.width / 2, halfH = terrainData.height / 2;

    const toPixel = (lat, lng) => {
        const [lx, ly] = toMetric.forward([lng, lat]);
        return { x: (lx + halfW) * SCALE_FACTOR, y: (halfH - ly) * SCALE_FACTOR };
    };

    ctx.fillStyle = COLORS.defaultLanduse;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    renderFeaturesToCanvas(ctx, terrainData.osmFeatures, toPixel, SCALE_FACTOR);

    return new Promise(r => canvas.toBlob(b => r(b ? URL.createObjectURL(b) : ''), 'image/png'));
};

export const generateHybridTexture = async (terrainData) => {
    const TARGET_RESOLUTION = 8192;
    let SCALE_FACTOR = Math.max(1, Math.ceil(TARGET_RESOLUTION / terrainData.width));
    const canvas = document.createElement('canvas');
    canvas.width = terrainData.width * SCALE_FACTOR;
    canvas.height = terrainData.height * SCALE_FACTOR;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Could not get 2D context");

    if (terrainData.satelliteTextureUrl) {
        const img = new Image();
        img.src = terrainData.satelliteTextureUrl;
        await new Promise(r => img.onload = r);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    } else {
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const centerLat = (terrainData.bounds.north + terrainData.bounds.south) / 2;
    const centerLng = (terrainData.bounds.east + terrainData.bounds.west) / 2;
    const localProjDef = `+proj=tmerc +lat_0=${centerLat} +lon_0=${centerLng} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs`;
    const toMetric = proj4('EPSG:4326', localProjDef);
    const halfW = terrainData.width / 2, halfH = terrainData.height / 2;

    const toPixel = (lat, lng) => {
        const [lx, ly] = toMetric.forward([lng, lat]);
        return { x: (lx + halfW) * SCALE_FACTOR, y: (halfH - ly) * SCALE_FACTOR };
    };

    renderFeaturesToCanvas(ctx, terrainData.osmFeatures, toPixel, SCALE_FACTOR, { alpha: 0.4 });

    return new Promise(r => canvas.toBlob(b => r(b ? URL.createObjectURL(b) : ''), 'image/png'));
};
