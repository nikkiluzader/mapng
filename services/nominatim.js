
const NOMINATIM_ENDPOINTS = [
    "/api/nominatim-geocode/search",
    "/api/nominatim-osm/search"
];

// Both names end at the same server: nominatim.geocoding.ai answers with a
// redirect to nominatim.openstreetmap.org (checked 2026-11-12). So a refusal
// from one (429 too many requests, 503 busy) is that server asking for less,
// and trying the other name only asks it again: REFUSED below.
const NOMINATIM_REVERSE_ENDPOINTS = [
    "/api/nominatim-osm/reverse",
    "/api/nominatim-geocode/reverse"
];
const REFUSED = new Set([429, 503]);

// OpenStreetMap's Nominatim asks for at most one request a second and no heavy
// use (https://operations.osmfoundation.org/policies/nominatim/). One at a
// time, a second apart: callers queue. (The earlier wait let every caller that
// arrived together through at once.)
const MIN_REQUEST_INTERVAL = 1100;
let queue = Promise.resolve();
let lastRequestTime = 0;
const waitForRateLimit = () => {
    const turn = queue.then(async () => {
        const wait = lastRequestTime + MIN_REQUEST_INTERVAL - Date.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        lastRequestTime = Date.now();
    });
    queue = turn.catch(() => {});
    return turn;
};

// A place's name does not change while the app is open: answers are kept by
// position, rounded to about 100 m (the name is a suggestion for a level's
// name, not an address).
const REVERSE_ROUND = 3;
const reverseCache = new Map();
const REVERSE_CACHE_MAX = 500;
export const reverseKey = (lat, lng) => `${Number(lat).toFixed(REVERSE_ROUND)},${Number(lng).toFixed(REVERSE_ROUND)}`;

export const searchLocation = async (query) => {
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
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                console.warn(`[Nominatim] Endpoint ${endpoint} returned ${response.status}`);
                if (REFUSED.has(response.status)) break;   // (the other name is the same server)
                continue;
            }

            const data = await response.json();

            if (!Array.isArray(data)) {
                console.warn(`[Nominatim] Unexpected response format from ${endpoint}`);
                continue;
            }

            return data.map((item) => {
                // Parse bounding box if available [south, north, west, east]
                let boundingBox;
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
                    // Prefer addresstype (city, town, village) over generic type (administrative)
                    type: item.addresstype || item.type || item.class || 'place',
                    boundingBox
                };
            });

        } catch (error) {
            console.warn(`[Nominatim] Failed to fetch from ${endpoint}:`, error);
            continue;
        }
    }

    console.warn("[Nominatim] All endpoints failed");
    return [];
};

const pickReverseDisplayName = (item) => {
    const address = item?.address || {};
    return (
        address.road ||
        address.neighbourhood ||
        address.neighborhood ||
        address.suburb ||
        address.hamlet ||
        address.village ||
        address.town ||
        address.city ||
        address.county ||
        item?.name ||
        item?.display_name ||
        ''
    );
};

/**
 * A short name for the place at (lat, lng), or '' when none is found.
 * `signal` (AbortSignal): a caller that no longer wants the answer gives up
 * its place in the queue and its request.
 */
export const reverseLocationName = async (lat, lng, { signal = null } = {}) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
    const key = reverseKey(lat, lng);
    if (reverseCache.has(key)) return reverseCache.get(key);

    await waitForRateLimit();
    if (signal?.aborted) return '';
    if (reverseCache.has(key)) return reverseCache.get(key);   // (answered while this one waited)

    // (asked at the rounded position, so the same place is the same request for the site's cache too)
    const [qLat, qLng] = key.split(',');
    const params = new URLSearchParams({
        lat: qLat,
        lon: qLng,
        format: 'json',
        addressdetails: '1',
        zoom: '16',
    });

    for (const endpoint of NOMINATIM_REVERSE_ENDPOINTS) {
        try {
            const response = await fetch(`${endpoint}?${params}`, {
                headers: {
                    'Accept': 'application/json'
                },
                signal,
            });

            if (!response.ok) {
                console.warn(`[Nominatim] Reverse endpoint ${endpoint} returned ${response.status}.`);
                if (REFUSED.has(response.status)) break;   // (the other name is the same server)
                continue;
            }

            const data = await response.json();
            const name = pickReverseDisplayName(data).trim();
            if (name) {
                if (reverseCache.size >= REVERSE_CACHE_MAX) reverseCache.delete(reverseCache.keys().next().value);
                reverseCache.set(key, name);
                return name;
            }
        } catch (error) {
            if (error?.name === 'AbortError') return '';
            console.warn(`[Nominatim] Failed reverse fetch from ${endpoint}:`, error);
        }
    }

    return '';
};

// Get a shorter, more readable name from the full display name
export const getShortName = (displayName) => {
    const parts = displayName.split(',').map(p => p.trim());
    
    // Return first 2-3 meaningful parts
    if (parts.length <= 2) {
        return displayName;
    }
    
    return parts.slice(0, 3).join(', ');
};

// Get location type icon hint
export const getLocationTypeIcon = (type) => {
    console.log('[Nominatim] getLocationTypeIcon called with type:', type);
    
    const iconGroups = [
        ['🏙️', ['city']],
        ['🏘️', ['town', 'village', 'suburb', 'neighbourhood', 'neighborhood', 'quarter', 'residential']],
        ['🏠', ['hamlet', 'isolated_dwelling', 'house']],
        ['⛰️', ['mountain', 'peak', 'hill', 'ridge', 'saddle', 'fell']],
        ['🌋', ['volcano']],
        ['🧗', ['cliff']],
        ['🪨', ['rock', 'stone']],
        ['🕳️', ['cave_entrance']],
        ['🧊', ['glacier']],
        ['🏞️', ['valley', 'national_park']],
        ['🌾', ['grassland', 'farmland', 'meadow']],
        ['🌿', ['heath', 'scrub', 'wetland']],
        ['🌲', ['wood', 'forest']],
        ['🌳', ['tree', 'park', 'nature_reserve', 'protected_area']],
        ['🌊', ['river', 'stream', 'canal', 'bay', 'sea', 'ocean']],
        ['💧', ['lake', 'reservoir', 'pond', 'water', 'spring', 'waterfall']],
        ['🏖️', ['beach', 'coastline']],
        ['🚜', ['farmyard']],
        ['🍎', ['orchard']],
        ['🍇', ['vineyard']],
        ['🌷', ['garden']],
        ['⚰️', ['cemetery']],
        ['🏭', ['industrial']],
        ['🏢', ['commercial', 'building', 'apartments']],
        ['🛒', ['retail', 'marketplace', 'supermarket']],
        ['🎖️', ['military']],
        ['⛏️', ['quarry']],
        ['🛣️', ['road', 'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'highway']],
        ['🚶', ['path', 'footway']],
        ['🚴', ['cycleway']],
        ['🛤️', ['track']],
        ['🚂', ['railway']],
        ['🚌', ['bus_stop']],
        ['🚉', ['station']],
        ['✈️', ['aerodrome', 'airport']],
        ['🚁', ['helipad']],
        ['🏨', ['hotel']],
        ['🏥', ['hospital']],
        ['🏫', ['school']],
        ['🎓', ['university', 'college']],
        ['📚', ['library']],
        ['🏛️', ['museum', 'townhall', 'embassy', 'archaeological_site', 'administrative', 'municipality']],
        ['🎭', ['theatre']],
        ['🎬', ['cinema']],
        ['🍽️', ['restaurant']],
        ['☕', ['cafe']],
        ['🍺', ['pub']],
        ['🍸', ['bar']],
        ['🍔', ['fast_food']],
        ['🏦', ['bank']],
        ['💳', ['atm']],
        ['💊', ['pharmacy']],
        ['⛽', ['fuel']],
        ['🅿️', ['parking']],
        ['👮', ['police']],
        ['🚒', ['fire_station']],
        ['📮', ['post_office', 'postcode']],
        ['⚖️', ['courthouse']],
        ['⛪', ['church']],
        ['🕌', ['mosque']],
        ['🕍', ['synagogue']],
        ['🛕', ['temple']],
        ['🏟️', ['stadium']],
        ['🏋️', ['sports_centre']],
        ['🏊', ['swimming_pool']],
        ['⛳', ['golf_course']],
        ['🛍️', ['shop']],
        ['🗺️', ['boundary', 'state', 'region', 'province', 'county', 'district']],
        ['🌍', ['country']],
        ['⭐', ['attraction']],
        ['👁️', ['viewpoint']],
        ['🎨', ['artwork']],
        ['🗿', ['monument']],
        ['🪦', ['memorial']],
        ['🏰', ['castle']],
        ['🏚️', ['ruins']],
        ['⛺', ['camp_site']],
        ['🚐', ['caravan_site']],
        ['🧺', ['picnic_site']],
        ['🎢', ['theme_park']],
        ['🦁', ['zoo']],
        ['🐠', ['aquarium']],
        ['📍', ['locality', 'place']]
    ];
    
    const lowerType = type.toLowerCase();
    
    for (const [icon, types] of iconGroups) {
        if (types.includes(lowerType)) {
            return icon;
        }
    }
    
    return '📍';
};
