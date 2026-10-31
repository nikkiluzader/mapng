// Build public/ept-index.json: the USGS 3DEP Entwine Point Tile datasets as a compact list of
// { name, bbox: [w, s, e, n] } (the full boundaries file is 8.7 MB; this is the part the export needs).
// Usage: node scripts/lidar/buildEptIndex.mjs
import fs from 'node:fs';
const src = 'https://usgs.entwine.io/boundaries/resources.geojson';
const gj = await (await fetch(src)).json();
const out = gj.features.map((f) => {
  let w = 180, s = 90, e = -180, n = -90;
  for (const poly of f.geometry.coordinates) for (const [x, y] of poly[0]) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  const r = (v) => Math.round(v * 1e4) / 1e4;
  return { name: f.properties.name, bbox: [r(w), r(s), r(e), r(n)] };
}).filter((d) => d.bbox[0] <= d.bbox[2]);
fs.writeFileSync(new URL('../../public/ept-index.json', import.meta.url), JSON.stringify({ source: src, built: new Date().toISOString().slice(0, 10), datasets: out }));
console.log(out.length, 'datasets');
