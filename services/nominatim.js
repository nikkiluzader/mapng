
const NOMINATIM_ENDPOINTS = [
    "https://nominatim.openstreetmap.org/search",
    "https://nominatim.geocoding.ai/search"
];

// Rate limiting: Nominatim requires max 1 request per second
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1000;

const waitForRateLimit = async () => {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
        await new Promise(resolve => 
            setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest)
        );
    }
    
    lastRequestTime = Date.now();
};

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

    console.error("[Nominatim] All endpoints failed");
    return [];
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
