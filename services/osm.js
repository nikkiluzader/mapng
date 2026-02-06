
const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter"
];

// --- Clipping Helpers ---

// Check if a point is inside a half-plane defined by a boundary edge
const isInside = (p, bounds, edge) => {
    switch (edge) {
        case 'N': return p.lat <= bounds.north;
        case 'S': return p.lat >= bounds.south;
        case 'E': return p.lng <= bounds.east;
        case 'W': return p.lng >= bounds.west;
    }
};

// Calculate intersection of a line segment (a->b) with a boundary edge
const intersect = (a, b, bounds, edge) => {
    // Latitude = y, Longitude = x
    const x1 = a.lng, y1 = a.lat;
    const x2 = b.lng, y2 = b.lat;

    let x = 0, y = 0;

    // Avoid divide by zero if line is parallel (though isInside check usually prevents this being called purely parallel outside)
    if (edge === 'N' || edge === 'S') {
        const boundaryY = edge === 'N' ? bounds.north : bounds.south;
        y = boundaryY;
        if (y2 === y1) x = x1; // Parallel
        else x = x1 + (x2 - x1) * (boundaryY - y1) / (y2 - y1);
    } else {
        const boundaryX = edge === 'E' ? bounds.east : bounds.west;
        x = boundaryX;
        if (x2 === x1) y = y1; // Parallel
        else y = y1 + (y2 - y1) * (boundaryX - x1) / (x2 - x1);
    }
    return { lat: y, lng: x };
};

// Sutherland-Hodgman algorithm for Polygon clipping
const clipPolygon = (points, bounds) => {
    let output = points;
    const edges = ['N', 'S', 'E', 'W'];

    for (const edge of edges) {
        const input = output;
        output = [];
        if (input.length === 0) break;

        let S = input[input.length - 1];
        for (const E of input) {
            if (isInside(E, bounds, edge)) {
                if (!isInside(S, bounds, edge)) {
                    output.push(intersect(S, E, bounds, edge));
                }
                output.push(E);
            } else if (isInside(S, bounds, edge)) {
                output.push(intersect(S, E, bounds, edge));
            }
            S = E;
        }
    }
    return output;
};

// Line clipping that handles splitting lines into multiple segments
const clipLineString = (points, bounds) => {
    let segments = [points];
    const edges = ['N', 'S', 'E', 'W'];

    for (const edge of edges) {
        const nextSegments = [];

        for (const segment of segments) {
            let currentSplit = [];

            for (let i = 0; i < segment.length; i++) {
                const p = segment[i];
                const prev = i > 0 ? segment[i - 1] : null;

                const pIn = isInside(p, bounds, edge);
                const prevIn = prev ? isInside(prev, bounds, edge) : null;

                if (i === 0) {
                    if (pIn) currentSplit.push(p);
                } else {
                    if (pIn && prevIn) {
                        // Both inside
                        currentSplit.push(p);
                    } else if (pIn && !prevIn) {
                        // Entering
                        if (prev) {
                            const intersection = intersect(prev, p, bounds, edge);
                            currentSplit.push(intersection);
                            currentSplit.push(p);
                        }
                    } else if (!pIn && prevIn) {
                        // Leaving
                        if (prev) {
                            const intersection = intersect(prev, p, bounds, edge);
                            currentSplit.push(intersection);
                            // Finish this segment
                            if (currentSplit.length > 0) nextSegments.push(currentSplit);
                            currentSplit = [];
                        }
                    }
                }
            }
            if (currentSplit.length > 0) nextSegments.push(currentSplit);
        }
        segments = nextSegments;
    }

    return segments;
};

// --- Main Service ---

// Helper to construct the Overpass QL query
const buildQuery = (bounds) => {
    // Overpass expects (south, west, north, east)
    const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;

    // Increased timeout to 180s and maxsize to handle larger areas
    return `
        [out:json][timeout:180][maxsize:1073741824];
        (
          node["natural"="tree"](${bbox});
          node["natural"="peak"](${bbox});
          way["natural"="water"](${bbox});
          way["waterway"](${bbox});
          way["highway"](${bbox});
          way["building"](${bbox});
          way["natural"~"wood|scrub|tree_row|grass|meadow|heath|moor|wetland|sand|beach|bare_rock|scree|dirt"](${bbox});
          way["landuse"~"forest|grass|meadow|park|orchard|vineyard|farmland|quarry|reservoir|basin"](${bbox});
          way["historic"](${bbox});
          way["barrier"](${bbox});
          way["man_made"="bridge"](${bbox});
          relation["building"](${bbox});
          relation["historic"](${bbox});
          relation["natural"="water"](${bbox});
          relation["waterway"](${bbox});
        );
        out body;
        >;
        out skel qt;
    `;
};

const parseOverpassResponse = (data, bounds) => {
    const nodes = {};
    const ways = {};
    const relations = [];
    const rawFeatures = [];
    const consumedWayIds = new Set();

    // 1. Index Nodes & Process Standalone Nodes
    for (const el of data.elements) {
        if (el.type === 'node') {
            nodes[el.id] = { lat: el.lat, lng: el.lon, tags: el.tags };

            // Check for standalone tree nodes
            if (el.tags && el.tags.natural === 'tree') {
                // Check if inside bounds (simple check)
                if (el.lat <= bounds.north && el.lat >= bounds.south &&
                    el.lon <= bounds.east && el.lon >= bounds.west) {
                    rawFeatures.push({
                        id: el.id.toString(),
                        type: 'vegetation',
                        geometry: [{ lat: el.lat, lng: el.lon }],
                        tags: el.tags
                    });
                }
            }
        }
    }

    // 2. Index Ways
    for (const el of data.elements) {
        if (el.type === 'way' && el.nodes && el.nodes.length > 0) {
            const geometry = el.nodes
                .map((id) => nodes[id])
                .filter((n) => n !== undefined);

            if (geometry.length > 1) {
                ways[el.id] = { nodes: geometry, tags: el.tags || {} };
            }
        } else if (el.type === 'relation') {
            relations.push(el);
        }
    }

    // 3. Process Relations
    for (const r of relations) {
        const tags = r.tags || {};
        const isBuilding = tags.building || tags.historic;

        if (isBuilding && r.members) {
            const outers = r.members.filter((m) => m.type === 'way' && m.role === 'outer');
            const inners = r.members.filter((m) => m.type === 'way' && m.role === 'inner');

            const holeGeometries = [];
            for (const member of inners) {
                const w = ways[member.ref];
                if (w) {
                    holeGeometries.push(w.nodes);
                    consumedWayIds.add(member.ref);
                }
            }

            for (const member of outers) {
                const w = ways[member.ref];
                if (w) {
                    const type = 'building';
                    rawFeatures.push({
                        id: `${r.id}_${member.ref}`,
                        type,
                        geometry: w.nodes,
                        holes: holeGeometries,
                        tags: { ...tags, ...w.tags }
                    });
                    consumedWayIds.add(member.ref);
                }
            }
        }
    }

    // 4. Process Standalone Ways
    for (const idStr in ways) {
        const id = parseInt(idStr);
        if (consumedWayIds.has(id)) continue;

        const w = ways[id];
        const tags = w.tags;
        let type = null;

        if (tags.building || (tags.historic && tags.historic !== 'district')) type = 'building';
        else if (tags.natural === 'water' || tags.waterway || tags.landuse === 'reservoir' || tags.landuse === 'basin') type = 'water';
        else if (tags.natural || tags.landuse) type = 'vegetation';
        else if (tags.highway) type = 'road';
        else if (tags.man_made === 'bridge') type = 'road';
        else if (tags.barrier) type = 'barrier';

        if (type) {
            rawFeatures.push({
                id: id.toString(),
                type,
                geometry: w.nodes,
                tags
            });
        }
    }

    // 5. CLIP FEATURES
    const clippedFeatures = [];

    for (const f of rawFeatures) {
        if (f.geometry.length === 1) {
            // It's a point (tree), already checked bounds
            clippedFeatures.push(f);
            continue;
        }

        if (f.type === 'road' || f.type === 'barrier') {
            const clippedSegments = clipLineString(f.geometry, bounds);
            clippedSegments.forEach((segment, index) => {
                if (segment.length > 1) {
                    clippedFeatures.push({
                        ...f,
                        id: `${f.id}_seg_${index}`,
                        geometry: segment
                    });
                }
            });
        } else {
            // Polygon clipping
            const clippedPoly = clipPolygon(f.geometry, bounds);
            if (clippedPoly.length > 2) {
                // Clip holes too
                const clippedHoles = [];
                if (f.holes) {
                    for (const hole of f.holes) {
                        const clippedHole = clipPolygon(hole, bounds);
                        if (clippedHole.length > 2) {
                            clippedHoles.push(clippedHole);
                        }
                    }
                }

                clippedFeatures.push({
                    ...f,
                    geometry: clippedPoly,
                    holes: clippedHoles.length > 0 ? clippedHoles : undefined
                });
            }
        }
    }

    return clippedFeatures;
};

export const fetchOSMData = async (bounds) => {
    console.log(`[OSM] Fetching data for bounds: N:${bounds.north}, S:${bounds.south}, E:${bounds.east}, W:${bounds.west}`);

    const query = buildQuery(bounds);

    for (const endpoint of OVERPASS_ENDPOINTS) {
        try {
            console.log(`[OSM] Trying endpoint: ${endpoint}`);
            const response = await fetch(endpoint, {
                method: 'POST',
                body: `data=${encodeURIComponent(query)}`,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            if (!response.ok) {
                console.warn(`[OSM] API Error from ${endpoint}: ${response.status} ${response.statusText}`);
                continue; // Try next endpoint
            }

            const data = await response.json();
            console.log(`[OSM] Received ${data.elements?.length || 0} elements from ${endpoint}.`);

            const features = parseOverpassResponse(data, bounds);
            console.log(`[OSM] Parsed ${features.length} features.`);
            return features;

        } catch (error) {
            console.error(`[OSM] Error fetching data from ${endpoint}:`, error);
            // Wait a bit before trying the next one
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    console.error("[OSM] All endpoints failed.");
    return [];
};