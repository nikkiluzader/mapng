// The manifest of the planet archives under osm-all/ (one per zoom-3 tile): what
// /api/osm-tiles/manifest-all serves, and what the comparison tool reads the archives by.
//
//   node scripts/planet/planetManifest.mjs <dir of planet-3-x-y-<date>.pmtiles> [snapshot YYYY-MM-DD] > manifest.json
//
// Each archive covers its whole zoom-3 tile (sea included: a tile it does not hold is empty there).
// `all: true`: every tagged object is in it, and the app filters on reading (services/osmTiles.js).
import fs from 'node:fs';

export const z3Bounds = (x, y) => {
  const n = 8; const lat = (yy) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * yy) / n))) * 180) / Math.PI;
  return [(x / n) * 360 - 180, lat(y + 1), ((x + 1) / n) * 360 - 180, lat(y)];
};

export function planetManifest(names, { snapshot = '', prefix = 'osm-all/' } = {}) {
  const archives = [];
  for (const name of [...names].sort()) {
    const m = /^planet-3-(\d)-(\d)-(\d{4}-\d{2}-\d{2})\.pmtiles$/.exec(name);
    if (!m) continue;
    archives.push({ region: `planet-3-${m[1]}-${m[2]}`, key: `${prefix}${name}`, bounds: z3Bounds(Number(m[1]), Number(m[2])).map((v) => Math.round(v * 1e6) / 1e6), built_at: `${m[3]}T00:00:00Z`, zoom: 13, all: true, ...(snapshot ? { snapshot } : {}) });
  }
  return { archives };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const [dir, snapshot] = process.argv.slice(2);
  process.stdout.write(`${JSON.stringify(planetManifest(fs.readdirSync(dir), { snapshot }))}\n`);
}
