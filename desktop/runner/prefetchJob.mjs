// The export's data step in its own Node process (services/exportData.js):
// the surrounding backdrop's tiles and the bridges' lidar survey downloaded
// into the app's download cache, so the level export after it downloads
// nothing. Started by the export panel as soon as its options ask for them.
//
//   node prefetchJob.mjs <job dir>
//
// job.json: { terrainDir (the Generate session holding terrain.json),
// options (the export's), sources ({ mode: 'cache', dir }) }.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { installBrowserShims, installSourceRecorder } from './browserShims.mjs';
import { reviveJobValue } from './jobFormat.mjs';
import { appApiFetch, send, exitAfterSending } from './common.mjs';

installBrowserShims({
  assetsDir: path.resolve(process.env.MAPNG_ASSETS || new URL('../../public', import.meta.url).pathname),
  apiOrigin: process.env.MAPNG_API_ORIGIN || 'https://mapng.com',
  apiFetch: appApiFetch(),
});

// The backdrop's eight tiles kept small for the window's 2D preview, in the terrain's folder (served there as
// app://mapng/__terrain/<id>/<file>): the picture at most PREVIEW_SAT_PX a side as JPEG, the heights as raw Float32.
// The window used to rebuild the tiles itself, stitching the satellite and heights at full size (up to 16384 px a
// side, about 1 GB each): it ran out of memory on a big level (report MR-VYQGBY).
const PREVIEW_SAT_PX = 2048;
async function keepPreviewTiles(tiles, key, terrainDir) {
  if (!tiles || !terrainDir) return null;
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const tag = createHash('sha1').update(String(key)).digest('hex').slice(0, 12);
  const out = {};
  let bytes = 0;
  for (const [pos, t] of Object.entries(tiles)) {
    if (!t?.bounds) continue;
    const entry = { bounds: t.bounds, width: t.width, height: t.height, minHeight: t.minHeight, maxHeight: t.maxHeight, sat: null, hm: null };
    if (t.heightMap?.length) {
      entry.hm = `bdprev_${tag}_${pos}.f32`;
      const hm = t.heightMap instanceof Float32Array ? t.heightMap : Float32Array.from(t.heightMap);
      fs.writeFileSync(path.join(terrainDir, entry.hm), Buffer.from(hm.buffer, hm.byteOffset, hm.byteLength));
      bytes += hm.byteLength;
    }
    if (typeof t.satelliteDataUrl === 'string' && t.satelliteDataUrl.startsWith('data:')) {
      const img = await loadImage(Buffer.from(t.satelliteDataUrl.slice(t.satelliteDataUrl.indexOf(',') + 1), 'base64'));
      const k = Math.min(1, PREVIEW_SAT_PX / Math.max(img.width, img.height));
      const c = createCanvas(Math.max(1, Math.round(img.width * k)), Math.max(1, Math.round(img.height * k)));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const jpg = await c.encode('jpeg', 85);
      entry.sat = `bdprev_${tag}_${pos}.jpg`;
      fs.writeFileSync(path.join(terrainDir, entry.sat), jpg);
      bytes += jpg.byteLength;
    }
    out[pos] = entry;
  }
  console.log(`[Export data] backdrop preview: ${Object.keys(out).length} tile(s) kept for the 2D preview (${(bytes / 1048576).toFixed(1)} MB, pictures at most ${PREVIEW_SAT_PX} px)`);
  return out;
}

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: prefetchJob.mjs <job dir>');
  const job = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8'));
  const sources = installSourceRecorder(job.sources);
  const packed = JSON.parse(fs.readFileSync(path.join(job.terrainDir, 'terrain.json'), 'utf8'));
  const terrainData = await reviveJobValue(packed, job.terrainDir);
  const { downloadExportData } = await import('../../services/exportData.js');
  const result = await downloadExportData(terrainData, job.options || {}, {
    onProgress: (text, fraction) => send({ type: 'progress', text, fraction }),
    onBackdropTiles: (tiles, key) => keepPreviewTiles(tiles, key, job.terrainDir),
  });
  console.log(`[Sources] export data step: ${sources.replayed} already cached, ${sources.downloaded} downloaded`);
  send({ type: 'done', result, sources: { replayed: sources.replayed, downloaded: sources.downloaded } });
}

main().then(
  () => exitAfterSending(0),
  (error) => { send({ type: 'error', message: String(error?.message || error), stack: error?.stack }); exitAfterSending(1); },
);
