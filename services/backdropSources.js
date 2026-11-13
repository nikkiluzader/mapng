// The elevation sources the backdrop (the terrain round the map: Export > Surroundings) can be built from, and
// which of them cover a map. The list in the export panel had only 30 m global, USGS 1 m and GPXZ: a BeamNG
// developer building a level in Poland picked "USGS 1 m" (it covers the USA only), and neither Mapterhorn nor
// Poland's own 1 m model was offered.
import { isWithinKron86Coverage } from './kron86.js';

export const BACKDROP_SOURCES = ['off', 'global30m', 'mapterhorn', 'usgs1m', 'kron86', 'gpxz'];

// Where the USGS 3DEP 1 m programme has data at all: the United States and its territories, as boxes
// (the lower 48, Alaska, Hawaii, Puerto Rico and the US Virgin Islands, Guam and the Northern Marianas).
const USGS_BOXES = [
  { west: -125.1, south: 24.3, east: -66.8, north: 49.5 },
  { west: -180, south: 51, east: -129.9, north: 71.6 },
  { west: -160.4, south: 18.8, east: -154.7, north: 22.4 },
  { west: -67.4, south: 17.6, east: -64.5, north: 18.6 },
  { west: 144.5, south: 13.2, east: 146.2, north: 20.6 },
];
const meets = (a, b) => !!a && !(a.east <= b.west || a.west >= b.east || a.north <= b.south || a.south >= b.north);

/** Can this source have data for a map with these bounds? (gpxzOk: the map itself was made with a GPXZ key.) */
export function backdropSourceCovers(source, bounds, { gpxzOk = false } = {}) {
  if (source === 'usgs1m') return !bounds || USGS_BOXES.some((box) => meets(bounds, box));
  if (source === 'kron86') return !bounds || isWithinKron86Coverage(bounds);
  if (source === 'gpxz') return !!gpxzOk;
  return BACKDROP_SOURCES.includes(source);   // (off, 30 m global, Mapterhorn: anywhere; Mapterhorn falls back to 30 m by itself)
}

/** The source the backdrop is really built from: the chosen one, or 30 m global where that one has nothing here. */
export function effectiveBackdropSource(source, bounds, opts = {}) {
  if (!source || source === 'off') return 'off';
  if (!BACKDROP_SOURCES.includes(source)) return 'global30m';
  return backdropSourceCovers(source, bounds, opts) ? source : 'global30m';
}
