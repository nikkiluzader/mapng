import { NominatimResult, Bounds } from "../types";

const NOMINATIM_ENDPOINTS = [
    "https://nominatim.openstreetmap.org/search",
    "https://nominatim.geocoding.ai/search"
];

// Rate limiting: Nominatim requires max 1 request per second
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1000;

const waitForRateLimit = async (): Promise<void> => {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
        await new Promise(resolve => 
            setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest)
        );
    }
    
    lastRequestTime = Date.now();
};

export const searchLocation = async (query: string): Promise<NominatimResult[]> => {
    if (!query || query.trim().length < 2) {
        return [];
    }

    await waitForRateLimit();

    const params = new URLSearchParams({
        q: query.trim(),
        format: 'json',
        addressdetails: '1',
        limit: '8',
        dedupe: '1'
    });

    for (const endpoint of NOMINATIM_ENDPOINTS) {
        try {
            const response = await fetch(`${endpoint}?${params}`, {
                headers: {
                    'User-Agent': 'MapNG-BeamNG-Terrain-Generator/1.0',
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                console.warn(`[Nominatim] Endpoint ${endpoint} returned ${response.status}`);
                continue;
            }

            const data = await response.json();

            if (!Array.isArray(data)) {
                console.warn(`[Nominatim] Unexpected response format from ${endpoint}`);
                continue;
            }

            return data.map((item: any): NominatimResult => {
                // Parse bounding box if available [south, north, west, east]
                let boundingBox: Bounds | undefined;
                if (item.boundingbox && item.boundingbox.length === 4) {
                    boundingBox = {
                        south: parseFloat(item.boundingbox[0]),
                        north: parseFloat(item.boundingbox[1]),
                        west: parseFloat(item.boundingbox[2]),
                        east: parseFloat(item.boundingbox[3])
                    };
                }

                return {
                    lat: parseFloat(item.lat),
                    lng: parseFloat(item.lon),
                    displayName: item.display_name,
                    type: item.type || item.class || 'place',
                    boundingBox
                };
            });

        } catch (error) {
            console.warn(`[Nominatim] Failed to fetch from ${endpoint}:`, error);
            continue;
        }
    }

    console.error("[Nominatim] All endpoints failed");
    return [];
};

// Get a shorter, more readable name from the full display name
export const getShortName = (displayName: string): string => {
    const parts = displayName.split(',').map(p => p.trim());
    
    // Return first 2-3 meaningful parts
    if (parts.length <= 2) {
        return displayName;
    }
    
    return parts.slice(0, 3).join(', ');
};

// Get location type icon hint
export const getLocationTypeIcon = (type: string): string => {
    const typeMap: Record<string, string> = {
        'city': '🏙️',
        'town': '🏘️',
        'village': '🏘️',
        'hamlet': '🏠',
        'mountain': '⛰️',
        'peak': '⛰️',
        'hill': '⛰️',
        'valley': '🏞️',
        'river': '🌊',
        'lake': '💧',
        'forest': '🌲',
        'park': '🌳',
        'road': '🛣️',
        'motorway': '🛣️',
        'administrative': '📍',
        'country': '🌍',
        'state': '🗺️',
        'county': '🗺️'
    };
    
    return typeMap[type.toLowerCase()] || '📍';
};
