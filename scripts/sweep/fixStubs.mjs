// Replace the canvas-polyfill stub images (4-byte "PNG"s) in a headless export with real files,
// so the level loads clean in game: node scripts/sweep/fixStubs.mjs <zip>
// terrain.png -> grey at baseTexSize (what the app writes for baseTexture 'none'),
// cubemap faces -> public/cubemap, preview.png -> grey 512.
import fs from 'node:fs';
import JSZip from 'jszip';
import sharp from 'sharp';

const file = process.argv[2];
const zip = await JSZip.loadAsync(fs.readFileSync(file));
const root = new URL('../../public/cubemap/', import.meta.url).pathname;
const grey = (size) => sharp({ create: { width: size, height: size, channels: 3, background: '#808080' } }).png().toBuffer();
let fixed = 0;
for (const name of Object.keys(zip.files)) {
  if (zip.files[name].dir) continue;
  const bytes = await zip.file(name).async('uint8array');
  if (bytes.length > 16) continue;
  const face = name.match(/cubemap\/(skybox\d\.hdr\.dds)$/);
  if (face) zip.file(name, fs.readFileSync(root + face[1]));
  else if (name.endsWith('/art/terrains/terrain.png')) {
    const mats = Object.keys(zip.files).find((n) => n.endsWith('/art/terrains/main.materials.json'));
    const set = Object.values(JSON.parse(await zip.file(mats).async('string'))).find((m) => m.class === 'TerrainMaterialTextureSet');
    zip.file(name, await grey(set?.baseTexSize?.[0] || 2048));
  } else if (name.endsWith('/preview.png')) zip.file(name, await grey(512));
  else { console.log('left stub:', name); continue; }
  fixed++;
}
// the app ships public/beamng_facade_e.png beside the buildings (lit windows
// at night); a headless export cannot fetch it, so add it here
const bldMats = Object.keys(zip.files).find((n) => n.endsWith('/custom_assets/osm_objects/main.materials.json'));
if (bldMats && !Object.keys(zip.files).some((n) => n.endsWith('/osm_objects/beamng_facade_e.png'))) {
  const dir = bldMats.replace(/main\.materials\.json$/, '');
  zip.file(dir + 'beamng_facade_e.png', fs.readFileSync(new URL('../../public/beamng_facade_e.png', import.meta.url).pathname));
  const mats = JSON.parse(await zip.file(bldMats).async('string'));
  const level = dir.match(/^levels\/([^/]+)\//)[1];
  if (mats.mapng_bld_facade) mats.mapng_bld_facade.Stages[0].emissiveMap = `/levels/${level}/map_assets/custom_assets/osm_objects/beamng_facade_e.png`;
  zip.file(bldMats, JSON.stringify(mats, null, 2));
  fixed++;
}
fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }));
console.log('fixed', fixed, 'stub file(s) in', file);
