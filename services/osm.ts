import { Bounds, LatLng, OSMFeature } from "../types";

const OVERPASS_API_URL = "https://overpass-api.de/api/interpreter";

// --- Clipping Helpers ---

// Check if a point is inside a half-plane defined by a boundary edge
const isInside = (p: LatLng, bounds: Bounds, edge: 'N'|'S'|'E'|'W'): boolean => {
   switch(edge) {
       case 'N': return p.lat <= bounds.north;
       case 'S': return p.lat >= bounds.south;
       case 'E': return p.lng <= bounds.east;
       case 'W': return p.lng >= bounds.west;
   }
};

// Calculate intersection of a line segment (a->b) with a boundary edge
const intersect = (a: LatLng, b: LatLng, bounds: Bounds, edge: 'N'|'S'|'E'|'W'): LatLng => {
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
const clipPolygon = (points: LatLng[], bounds: Bounds): LatLng[] => {
    let output = points;
    const edges: ('N'|'S'|'E'|'W')[] = ['N', 'S', 'E', 'W'];
    
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
const clipLineString = (points: LatLng[], bounds: Bounds): LatLng[][] => {
    let segments: LatLng[][] = [points];
    const edges: ('N'|'S'|'E'|'W')[] = ['N', 'S', 'E', 'W'];

    for (const edge of edges) {
        const nextSegments: LatLng[][] = [];
        
        for (const segment of segments) {
            let currentSplit: LatLng[] = [];
            
            for (let i = 0; i < segment.length; i++) {
                const p = segment[i];
                const prev = i > 0 ? segment[i-1] : null;

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
const buildQuery = (bounds: Bounds) => {
    // Overpass expects (south, west, north, east)
    const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
    
    return `
        [out:json][timeout:25];
        (
          way["highway"](${bbox});
          way["building"](${bbox});
          way["natural"~"wood|scrub"](${bbox});
          way["landuse"~"forest|grass|meadow|park"](${bbox});
          way["historic"](${bbox});
          way["barrier"](${bbox});
          way["man_made"="bridge"](${bbox});
          relation["building"](${bbox});
          relation["historic"](${bbox});
        );
        out body;
        >;
        out skel qt;
    `;
};

const parseOverpassResponse = (data: any, bounds: Bounds): OSMFeature[] => {
    const nodes: Record<number, LatLng> = {};
    const ways: Record<number, { nodes: LatLng[], tags: Record<string, string> }> = {};
    const relations: any[] = [];
    const rawFeatures: OSMFeature[] = [];
    const consumedWayIds = new Set<number>();

    // 1. Index Nodes
    for (const el of data.elements) {
        if (el.type === 'node') {
            nodes[el.id] = { lat: el.lat, lng: el.lon };
        }
    }

    // 2. Index Ways
    for (const el of data.elements) {
        if (el.type === 'way' && el.nodes && el.nodes.length > 0) {
            const geometry: LatLng[] = el.nodes
                .map((id: number) => nodes[id])
                .filter((n: LatLng | undefined) => n !== undefined);
            
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
            const outers = r.members.filter((m: any) => m.type === 'way' && m.role === 'outer');
            for (const member of outers) {
                const w = ways[member.ref];
                if (w) {
                    const type = 'building';
                    rawFeatures.push({
                        id: `${r.id}_${member.ref}`,
                        type,
                        geometry: w.nodes,
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
        let type: OSMFeature['type'] | null = null;

        if (tags.building || tags.historic) type = 'building';
        else if (tags.natural === 'wood' || tags.natural === 'scrub' || tags.landuse) type = 'vegetation';
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
    const clippedFeatures: OSMFeature[] = [];

    for (const f of rawFeatures) {
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
                clippedFeatures.push({
                    ...f,
                    geometry: clippedPoly
                });
            }
        }
    }

    return clippedFeatures;
};

export const fetchOSMData = async (bounds: Bounds): Promise<OSMFeature[]> => {
    try {
        const query = buildQuery(bounds);
        const response = await fetch(OVERPASS_API_URL, {
            method: 'POST',
            body: `data=${encodeURIComponent(query)}`,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        if (!response.ok) {
            throw new Error(`Overpass API error: ${response.statusText}`);
        }

        const data = await response.json();
        return parseOverpassResponse(data, bounds);

    } catch (error) {
        console.warn("Failed to fetch OSM data:", error);
        return []; 
    }
};