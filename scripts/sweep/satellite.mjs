// Put Esri World Imagery (the app's satellite source) into a headless test
// export's terrain.png, so test levels look like a real satellite export
// instead of flat grey: node scripts/sweep/satellite.mjs <zip> <levelprobe area>
// (run instead of, or after, fixstubs.mjs; terrain.png is every terrain
// layer's base colour)
import fs from 'node:fs';
import JSZip from 'jszip';
import sharp from 'sharp';
import { AREAS_DIR } from './env.mjs';

const [file, area, pngOut] = process.argv.slice(2);   // pngOut: also save the image (no zip edit when file is '-')
const meta = JSON.parse(fs.readFileSync(`${AREAS_DIR}/${area}/meta.json`));
const { north, south, east, west } = meta.bounds;
const zip = file === '-' ? null : await JSZip.loadAsync(fs.readFileSync(file));
let size = meta.size || 2048;
if (zip) {
  const matsName = Object.keys(zip.files).find((n) => n.endsWith('/art/terrains/main.materials.json'));
  const set = Object.values(JSON.parse(await zip.file(matsName).async('string'))).find((m) => m.class === 'TerrainMaterialTextureSet');
  size = set?.baseTexSize?.[0] || 2048;
}

// a zoom giving about one tile pixel per texture pixel (or finer)
const metersWide = (east - west) * 111320 * Math.cos(((north + south) / 2) * Math.PI / 180);
const z = Math.min(19, Math.ceil(Math.log2((40075016 * Math.cos(((north + south) / 2) * Math.PI / 180) * size) / (256 * metersWide))));
const n = 2 ** z;
const tx = (lng) => ((lng + 180) / 360) * n;
const ty = (lat) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n; };
const x0 = Math.floor(tx(west)); const x1 = Math.floor(tx(east));
const y0 = Math.floor(ty(north)); const y1 = Math.floor(ty(south));
console.log(`zoom ${z}: ${(x1 - x0 + 1) * (y1 - y0 + 1)} tiles for a ${size} px texture`);

const tiles = [];
// (blankTile=false, as the app: no grey "Map data not yet available" tiles; a tile Esri has no imagery for at
// this zoom is cut from the nearest zoom above that has it)
const fetchOne = async (zz, x, y) => {
  const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zz}/${y}/${x}?blankTile=false`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'MapNG-levelprobe/1.0 (local diagnostics)' } });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      if (r.status === 404) return null;
    } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
  }
  return null;
};
const fetchTile = async (x, y) => {
  for (let step = 0; step <= 4; step++) {
    const buf = await fetchOne(z - step, Math.floor(x / 2 ** step), Math.floor(y / 2 ** step));
    if (!buf) continue;
    if (!step) return buf;
    const span = 256 / 2 ** step;
    return sharp(buf).resize(256, 256).extract({ left: Math.floor((x % 2 ** step) * span), top: Math.floor((y % 2 ** step) * span), width: Math.max(1, Math.floor(span)), height: Math.max(1, Math.floor(span)) }).png().toBuffer();
  }
  return null;
};
const jobs = [];
for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) jobs.push([x, y]);
for (let i = 0; i < jobs.length; i += 16) {
  await Promise.all(jobs.slice(i, i + 16).map(async ([x, y]) => {
    const buf = await fetchTile(x, y);
    if (buf) tiles.push({ input: await sharp(buf).resize(256, 256).png().toBuffer(), left: (x - x0) * 256, top: (y - y0) * 256 });
  }));
}
// (limitInputPixels off throughout: a 16 km mosaic is past sharp's default 268 Mpx guard)
const mosaic = await sharp({ create: { width: (x1 - x0 + 1) * 256, height: (y1 - y0 + 1) * 256, channels: 3, background: '#7a7a6a' }, limitInputPixels: false })
  .composite(tiles).png().toBuffer();
// crop to the export's bounds (north up), then to the texture size
const left = Math.round((tx(west) - x0) * 256); const top = Math.round((ty(north) - y0) * 256);
const width = Math.round((tx(east) - tx(west)) * 256); const height = Math.round((ty(south) - ty(north)) * 256);
const png = await sharp(mosaic, { limitInputPixels: false }).extract({ left, top, width, height }).resize(size, size, { fit: 'fill' }).png().toBuffer();
if (pngOut) { fs.writeFileSync(pngOut, png); console.log(`satellite image saved to ${pngOut}`); }
if (zip) {
  const terrainPng = Object.keys(zip.files).find((nm) => nm.endsWith('/art/terrains/terrain.png'));
  zip.file(terrainPng, png);
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }));
  console.log(`satellite terrain.png (${size} px) written into ${file}`);
}
