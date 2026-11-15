// Which railway lines an export would build as track, from MapNG's planet tiles (the app's own reader), by tag.
//
//   node scripts/planet/railSurvey.mjs [name lat lng km]...
//
// For each place: every railway feature the data step keeps, whether railways.js builds it (and as what), and its
// length, grouped by the tags that decide it. For checking reports of track where there is none.
import { planetSource } from './planetSource.mjs';
const args = process.argv.slice(2);
const places = Array.from({ length: Math.floor(args.length / 4) }, (_, i) => [args[i * 4], Number(args[i * 4 + 1]), Number(args[i * 4 + 2]), Number(args[i * 4 + 3])]);
const { manifest, sourceFor } = planetSource({});
const store = new Map([['mapng_overtureBuildings', 'false']]);
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
globalThis.location ||= { protocol: 'https:' };
const quiet = async (fn) => { const { log, warn } = console; console.log = console.warn = () => {}; try { return await fn(); } finally { console.log = log; console.warn = warn; } };
const { fetchOSMData } = await import('../../services/osm.js');
const { setOsmTileManifest } = await import('../../services/osmTiles.js');
const { railKindOf, railStateOf } = await import('../../services/railways.js');
const KEYS = ['highway', 'railway', 'service', 'usage', 'disused', 'abandoned', 'disused:railway', 'railway:disused', 'abandoned:railway', 'railway:preserved', 'tunnel', 'bridge'];
const len = (g) => { let s = 0; for (let i = 1; i < g.length; i++) { const a = g[i - 1]; const b = g[i]; const kx = 111320 * Math.cos((a.lat * Math.PI) / 180); s += Math.hypot((b.lng - a.lng) * kx, (b.lat - a.lat) * 110574); } return s; };
for (const [name, lat, lng, km] of places) {
  const dLat = km / 2 / 111.32; const dLng = dLat / Math.cos((lat * Math.PI) / 180);
  setOsmTileManifest(manifest, sourceFor);
  const features = await quiet(() => fetchOSMData({ north: lat + dLat, south: lat - dLat, west: lng - dLng, east: lng + dLng }));
  const rows = new Map();
  for (const f of features) {
    if (f.type !== 'railway' || !Array.isArray(f.geometry)) continue;
    const t = f.tags || {};
    const key = `${railKindOf(t) ? `BUILT as ${railKindOf(t)}${railStateOf(t) ? ` (${railStateOf(t)})` : ''}` : 'not built'} | ${KEYS.filter((k) => t[k] != null).map((k) => `${k}=${t[k]}`).join(' ')}`;
    const r = rows.get(key) || { n: 0, m: 0, ids: [] }; r.n += 1; r.m += len(f.geometry); if (r.ids.length < 3) r.ids.push(f.id); rows.set(key, r);
  }
  console.log(`\n${name} (${km} km):`);
  for (const [k, r] of [...rows.entries()].sort((a, b) => b[1].m - a[1].m)) console.log(`  ${(r.m / 1000).toFixed(1).padStart(6)} km  ${String(r.n).padStart(4)} ways  ${k}  e.g. ${r.ids.join(',')}`);
}
