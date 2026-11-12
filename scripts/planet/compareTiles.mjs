// MapNG's planet tiles against the live OpenStreetMap servers, as the app reads both.
//
//   node scripts/planet/compareTiles.mjs [--local <dir>] [name lat lng km]...
//
// For each place: the app's own fetchOSMData twice, once from the planet archives (read from the
// R2 bucket by byte range with the keys in mapng.env, or from --local files) and once from the
// custom Overpass server (TRACESTRACK_API_URL), then the two sets of parsed features compared by
// kind and by id. The tiles are a snapshot: objects edited since differ, so a few per cent either
// way is expected; a kind missing or halved is not.
import { planetSource, env, stats } from './planetSource.mjs';
const args = process.argv.slice(2);
const localDir = args[0] === '--local' ? args.splice(0, 2)[1] : null;
const DEFAULT = [
  ['Arnhem NL', 51.9755, 5.91, 2], ['Greenwich UK (on a block edge)', 51.4779, 0.0, 2], ['Jacksonville US', 30.33, -81.66, 2],
  ['Tokyo JP', 35.6812, 139.7671, 1.5], ['Nairobi KE', -1.2864, 36.8172, 2], ['Sydney AU', -33.8688, 151.2093, 1.5],
  ['Viña del Mar CL', -33.05276, -71.52487, 2], ['Val d\'Isère FR', 45.448, 6.98, 3], ['Suva FJ (near the date line)', -18.1416, 178.4419, 2],
  ['Reykjavik IS', 64.1466, -21.9426, 2], ['Mumbai IN', 18.94, 72.835, 1.5], ['Equator and block corner, Gulf of Guinea coast GA', 0.39, 9.45, 2],
];
const places = args.length ? Array.from({ length: Math.floor(args.length / 4) }, (_, i) => [args[i * 4], Number(args[i * 4 + 1]), Number(args[i * 4 + 2]), Number(args[i * 4 + 3])]) : DEFAULT;

const { manifest, sourceFor } = planetSource({ localDir });

// ── the app's reader ──
const store = new Map([['mapng_customOverpassUrl', env.TRACESTRACK_API_URL], ['mapng_overtureBuildings', 'false']]);
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
globalThis.location ||= { protocol: 'https:' };
const quiet = async (fn) => { const { log, warn } = console; console.log = console.warn = () => {}; try { return await fn(); } finally { console.log = log; console.warn = warn; } };
const { fetchOSMData, getLastOSMRequestInfo } = await import('../../services/osm.js');
const { setOsmTileManifest } = await import('../../services/osmTiles.js');

const kindOf = (f) => (f.type === 'road' ? (f.tags.bridge && f.tags.bridge !== 'no' ? 'road on a bridge' : f.tags.tunnel && f.tags.tunnel !== 'no' ? 'road in a tunnel' : 'road') : f.type);
let worst = 0; const rows = [];
for (const [name, lat, lng, km] of places) {
  const dLat = km / 2 / 111.32; const dLng = dLat / Math.cos((lat * Math.PI) / 180);
  const bounds = { north: lat + dLat, south: lat - dLat, west: lng - dLng, east: lng + dLng };
  const r0 = stats.requests; const b0 = stats.bytes; const t0 = Date.now();
  setOsmTileManifest(manifest, sourceFor);
  const tiles = await quiet(() => fetchOSMData(bounds)); const tilesFrom = getLastOSMRequestInfo()?.endpointUsed; const tilesMs = Date.now() - t0;
  setOsmTileManifest({ archives: [] });
  const t1 = Date.now();
  const live = await quiet(() => fetchOSMData(bounds)); const liveFrom = getLastOSMRequestInfo()?.endpointUsed; const liveMs = Date.now() - t1;
  const count = (list) => { const c = {}; for (const f of list) c[kindOf(f)] = (c[kindOf(f)] || 0) + 1; return c; };
  const a = count(tiles); const b = count(live);
  const idsA = new Set(tiles.map((f) => `${f.type}:${f.id}`)); const idsB = new Set(live.map((f) => `${f.type}:${f.id}`));
  const onlyTiles = [...idsA].filter((k) => !idsB.has(k)).length; const onlyLive = [...idsB].filter((k) => !idsA.has(k)).length;
  const kinds = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const off = kinds.filter((k) => { const x = a[k] || 0; const y = b[k] || 0; return Math.abs(x - y) > Math.max(3, 0.1 * Math.max(x, y)); });
  const share = Math.max(onlyTiles, onlyLive) / Math.max(1, live.length); worst = Math.max(worst, share);
  console.log(`\n${name} (${km} km): tiles ${tiles.length} features from ${tilesFrom} in ${(tilesMs / 1000).toFixed(1)} s (${stats.requests - r0} range reads, ${((stats.bytes - b0) / 2 ** 20).toFixed(1)} MB) | live ${live.length} from ${liveFrom} in ${(liveMs / 1000).toFixed(1)} s`);
  console.log(`  only in the tiles: ${onlyTiles} · only live: ${onlyLive} (${(share * 100).toFixed(1)} % of the live set)`);
  console.log(`  ${kinds.map((k) => `${k} ${a[k] || 0}/${b[k] || 0}`).join(' · ')}`);
  if (off.length) console.log(`  KINDS MORE THAN 10 % APART: ${off.map((k) => `${k} ${a[k] || 0} vs ${b[k] || 0}`).join(', ')}`);
  rows.push({ name, tiles: tiles.length, live: live.length, onlyTiles, onlyLive, off, tilesFrom, liveFrom });
}
const bad = rows.filter((r) => r.off.length || r.tilesFrom !== 'mapng-osm-tiles' || !r.live);
console.log(`\n${rows.length} places; read from the tiles: ${rows.filter((r) => r.tilesFrom === 'mapng-osm-tiles').length}; with a kind more than 10 % apart: ${rows.filter((r) => r.off.length).length}; worst id difference ${(worst * 100).toFixed(1)} %`);
process.exit(bad.length ? 1 : 0);
