// Sweep areas with their map data read from the planet tiles instead of the live servers.
//
//   node scripts/planet/areasFromTiles.mjs <out dir> <area>...     (or --smoke)
//
// <out>/<area>/ gets links to everything the area has (elevation, land cover, ...) and its own
// osm.json: the app's fetchOSMData for the area's bounds, from the planet archives in the bucket.
// Then: MAPNG_AREAS=<out> node scripts/sweep/runSweep.mjs ...
import fs from 'node:fs'; import path from 'node:path';
import { AREAS_DIR, areas } from '../sweep/env.mjs';
import { planetSource, env } from './planetSource.mjs';

const [out, ...rest] = process.argv.slice(2);
const names = rest[0] === '--smoke' ? areas().filter((a) => a.smoke).map((a) => a.name) : rest;
if (!out || !names.length) { console.error('usage: areasFromTiles.mjs <out dir> <area>... | --smoke'); process.exit(2); }
const store = new Map([['mapng_customOverpassUrl', env.TRACESTRACK_API_URL]]);
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
globalThis.location ||= { protocol: 'https:' };
const { fetchOSMData, getLastOSMRequestInfo } = await import('../../services/osm.js');
const { setOsmTileManifest } = await import('../../services/osmTiles.js');
const { manifest, sourceFor } = planetSource();
setOsmTileManifest(manifest, sourceFor);
for (const name of names) {
  const from = path.join(AREAS_DIR, name); const to = path.join(out, name);
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    if (f === 'osm.json') continue;
    const link = path.join(to, f); try { fs.unlinkSync(link); } catch { /* new */ }
    fs.symlinkSync(path.join(from, f), link);
  }
  const was = JSON.parse(fs.readFileSync(path.join(from, 'osm.json'), 'utf8')).length;
  const { log, warn } = console; console.log = console.warn = () => {};
  let features; try { features = await fetchOSMData(JSON.parse(fs.readFileSync(path.join(from, 'meta.json'), 'utf8')).bounds); } finally { console.log = log; console.warn = warn; }
  const info = getLastOSMRequestInfo();
  if (info?.endpointUsed !== 'mapng-osm-tiles') { console.error(`${name}: NOT from the tiles (${info?.endpointUsed}; ${info?.mapngTiles || ''})`); process.exitCode = 1; continue; }
  fs.writeFileSync(path.join(to, 'osm.json'), JSON.stringify(features));
  console.log(`${name}: ${features.length} features from the tiles (snapshot ${info.osmSnapshot}); the area's saved map data has ${was}`);
}
