// Road rules from the export's location: which country it is in, which side
// traffic drives on, and the region that picks signal cycles and defaults.
// Outlines come from public/country_rules.json (Natural Earth 1:10m, simplified
// to ~1 km; built by scripts/build-country-rules.py) and load on first use.

const RULES_URL = '/country_rules.json';
// A point just off a simplified coastline (harbours, small islands) still
// belongs to the nearest country within this distance.
const NEAREST_MAX_DEG = 0.5;

// BeamNG ships display names for these country keys only (locales/en-US).
const BEAMNG_COUNTRY_KEYS = {
  US: 'levels.common.country.usa',
  DE: 'levels.common.country.germany',
  IT: 'levels.common.country.italy',
  NZ: 'levels.common.country.newzealand',
};

let rulesPromise = null;

const decodeRing = (encoded, scale) => {
  const ring = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i + 1 < encoded.length; i += 2) {
    x += encoded[i];
    y += encoded[i + 1];
    ring.push([x / scale, y / scale]);
  }
  return ring;
};

const decodeCountries = (data) => (data?.countries || []).map((country) => ({
  code: country.c,
  name: country.n,
  region: country.r,
  subregion: country.s,
  leftHandTraffic: country.l === 1,
  bbox: country.b,
  rings: (country.p || []).map((ring) => decodeRing(ring, data.scale || 1000)),
}));

const loadCountries = async (fetchImpl = globalThis.fetch) => {
  if (!rulesPromise) {
    rulesPromise = fetchImpl(RULES_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(decodeCountries)
      .catch((error) => {
        rulesPromise = null;
        throw error;
      });
  }
  return rulesPromise;
};

// Even-odd test over every ring, so holes (lakes, enclaves) work.
const ringsContain = (rings, lng, lat) => {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
};

const segmentDistanceSq = (px, py, [ax, ay], [bx, by]) => {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  const ex = ax + t * dx - px;
  const ey = ay + t * dy - py;
  return ex * ex + ey * ey;
};

/**
 * Country containing (lat, lng), or the nearest one within NEAREST_MAX_DEG.
 * Pure: takes decoded countries so tests can supply their own.
 */
export const findCountry = (countries, lat, lng) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const nearby = countries.filter(({ bbox: [w, s, e, n] }) => (
    lng >= w - NEAREST_MAX_DEG && lng <= e + NEAREST_MAX_DEG
    && lat >= s - NEAREST_MAX_DEG && lat <= n + NEAREST_MAX_DEG
  ));
  for (const country of nearby) {
    const [w, s, e, n] = country.bbox;
    if (lng >= w && lng <= e && lat >= s && lat <= n && ringsContain(country.rings, lng, lat)) return country;
  }
  let best = null;
  let bestSq = NEAREST_MAX_DEG * NEAREST_MAX_DEG;
  for (const country of nearby) {
    for (const ring of country.rings) {
      for (let i = 1; i < ring.length; i++) {
        const d = segmentDistanceSq(lng, lat, ring[i - 1], ring[i]);
        if (d < bestSq) {
          bestSq = d;
          best = country;
        }
      }
    }
  }
  return best;
};

/**
 * Road rules for a country record (or null for "unknown": BeamNG defaults).
 *   leftHandTraffic → info.json roadRules.rightHandDrive (BeamNG's name for it)
 *   euroSignals     → red+amber before green (BeamNG's lightsBasicEU cycle)
 *   turnOnRed       → right turn on red, legal across the US and Canada
 */
export const getCountryRoadRules = (country) => {
  if (!country) return null;
  const northAmerica = country.code === 'US' || country.code === 'CA';
  return {
    countryCode: country.code,
    countryName: country.name,
    region: country.region,
    leftHandTraffic: country.leftHandTraffic,
    euroSignals: country.region === 'Europe',
    turnOnRed: northAmerica,
    beamngCountry: BEAMNG_COUNTRY_KEYS[country.code] || country.name,
  };
};

/** Road rules at a location; null when the outlines can't be loaded. */
export const resolveRoadRulesAt = async (lat, lng, { fetchImpl } = {}) => {
  try {
    const countries = await loadCountries(fetchImpl);
    return getCountryRoadRules(findCountry(countries, lat, lng));
  } catch (error) {
    console.warn('[CountryRules] Could not load country outlines:', error?.message || error);
    return null;
  }
};

export const __test = { decodeCountries };
