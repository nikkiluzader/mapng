
const NOMINATIM_ENDPOINTS = [
    "https://nominatim.geocoding.ai/search"
];

async function searchLocation(query) {
    const params = new URLSearchParams({
        q: query.trim(),
        format: 'json',
        addressdetails: '1',
        limit: '8',
        dedupe: '1'
    });

    for (const endpoint of NOMINATIM_ENDPOINTS) {
        try {
            console.log(`Fetching from ${endpoint}?${params}`);
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
            return data;

        } catch (error) {
            console.warn(`[Nominatim] Failed to fetch from ${endpoint}:`, error);
            continue;
        }
    }
    return [];
}

async function test() {
    console.log("Searching for 'Georgia'...");
    const results = await searchLocation("Georgia");
    console.log("Results count:", results.length);
    results.forEach(r => console.log("- " + r.display_name));
}

test();
