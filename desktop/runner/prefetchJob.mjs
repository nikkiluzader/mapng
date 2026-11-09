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
import { installBrowserShims, installSourceRecorder } from './browserShims.mjs';
import { reviveJobValue } from './jobFormat.mjs';
import { appApiFetch, send } from './common.mjs';

installBrowserShims({
  assetsDir: path.resolve(process.env.MAPNG_ASSETS || new URL('../../public', import.meta.url).pathname),
  apiOrigin: process.env.MAPNG_API_ORIGIN || 'https://mapng.com',
  apiFetch: appApiFetch(),
});

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
  });
  console.log(`[Sources] export data step: ${sources.replayed} already cached, ${sources.downloaded} downloaded`);
  send({ type: 'done', result, sources: { replayed: sources.replayed, downloaded: sources.downloaded } });
}

main().then(
  () => process.exit(0),
  (error) => { send({ type: 'error', message: String(error?.message || error), stack: error?.stack }); process.exit(1); },
);
