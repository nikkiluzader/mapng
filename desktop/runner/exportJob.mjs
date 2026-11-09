// One level export in its own Node process (a full Node: Electron's own caps
// the JS heap at 4 GB, like a browser tab).
//
//   node --max-old-space-size=<MB> exportJob.mjs <job dir>
//
// The job dir is what the app wrote (services/platform/desktop.js): job.json with the
// export options and the terrain data, its big values in files beside it.
// Progress, the result and errors go to the parent over IPC (stdout when run
// by hand).
import fs from 'node:fs';
import path from 'node:path';
import { installBrowserShims, installSourceRecorder } from './browserShims.mjs';
import { reviveJobValue } from './jobFormat.mjs';
import { diskStepCache } from './diskStepCache.mjs';
import { appApiFetch, send, startMemoryReports } from './common.mjs';

// (MAPNG_ASSETS: set by the app; the repo's public/ when run by hand)
installBrowserShims({
  assetsDir: path.resolve(process.env.MAPNG_ASSETS || new URL('../../public', import.meta.url).pathname),
  apiOrigin: process.env.MAPNG_API_ORIGIN || 'https://mapng.com',
  apiFetch: appApiFetch(),
});
const { exportBeamNGLevel } = await import('../../services/exportBeamNGLevel.js');

startMemoryReports();

async function main() {
  const jobDir = process.argv[2];
  if (!jobDir) throw new Error('usage: exportJob.mjs <job dir>');
  const job = JSON.parse(fs.readFileSync(path.join(jobDir, 'job.json'), 'utf8'));
  // (the export's own downloads: US lidar for bridge heights, the backdrop;
  // recorded with the level, replayed by Update and Modify: main.js)
  // (the export only processes: its downloads were fetched ahead by the data
  // step, desktop/runner/prefetchJob.mjs, into the cache it reads here; what
  // it still has to download is logged, refused under MAPNG_STRICT_NO_DOWNLOAD)
  const sources = installSourceRecorder({ ...(job.sources || { dir: path.join(jobDir, 'export-sources'), mode: 'record' }) });
  const terrainData = await reviveJobValue(job.terrainData, jobDir);
  const started = Date.now();
  // (the zip written to the file as it is made, beside the final name; the
  // game never sees half a zip: renamed when complete)
  fs.mkdirSync(job.outputDir, { recursive: true });
  let partial = null; let fd = null; let size = 0;
  // The data step, when nothing ran it ahead (a terrain the window made
  // itself: a batch's combined level, an upload): its downloads first, as
  // their own step, so the export after it only processes
  if (!job.options?.dataStepDone) {
    const { exportDataNeeds, downloadExportData } = await import('../../services/exportData.js');
    if (exportDataNeeds(terrainData, job.options || {})) {
      send({ type: 'progress', step: 'Downloading what the level needs (surroundings, bridge heights)…', pct: 0 });
      const r = await downloadExportData(terrainData, job.options || {}, {
        onProgress: (text) => send({ type: 'progress', step: text, pct: 0 }),
      }).catch((err) => { console.warn(`[Sources] the data step failed (${err?.message || err}); the export fetches what it needs`); return null; });
      if (r?.surroundWater?.length && job.options) job.options.surroundingWater = r.surroundWater;
      console.log(`[Sources] data step before the export: ${sources.downloaded} downloaded, ${sources.replayed} from the cache`);
      sources.downloaded = 0; sources.downloadedUrls.length = 0;
    }
  }
  sources.strict = process.env.MAPNG_STRICT_NO_DOWNLOAD === '1';
  const { filename, steps, reused } = await exportBeamNGLevel(terrainData, job.center, {
    ...job.options,
    // (the steps nothing changed for since the last export, reused: services/stepCache.js)
    stepCache: job.stepCacheDir ? diskStepCache(job.stepCacheDir) : null,
    onProgress: (p) => send({ type: 'progress', ...p }),
    zipSink: {
      write(chunk) {
        if (fd === null) { partial = path.join(job.outputDir, `.mapng-${process.pid}.zip.partial`); fd = fs.openSync(partial, 'w'); }
        fs.writeSync(fd, chunk);
        size += chunk.byteLength;
      },
    },
  }).catch((error) => {
    if (fd !== null) { fs.closeSync(fd); fs.rmSync(partial, { force: true }); }
    throw error;
  });
  fs.closeSync(fd);
  const out = path.join(job.outputDir, filename);
  fs.renameSync(partial, out);
  console.log(`[Sources] export ${job.sources?.mode || 'record'}: ${sources.recorded} recorded, ${sources.replayed} from saved data, ${sources.downloaded} downloaded`);
  if (job.sources?.mode === 'cache' && sources.downloaded) {
    console.warn(`[Sources] the export downloaded ${sources.downloaded} file(s) its data step should have fetched:`);
    for (const u of sources.downloadedUrls) console.warn(`[Sources]   ${u}`);
  }
  send({ type: 'done', path: out, filename, size, seconds: (Date.now() - started) / 1000, steps, reused, sources: { recorded: sources.recorded, replayed: sources.replayed, downloaded: sources.downloaded, downloadedUrls: sources.downloadedUrls.slice(0, 5) } });
}

main().then(
  () => process.exit(0),
  (error) => { send({ type: 'error', message: String(error?.message || error), stack: error?.stack }); process.exit(1); },
);
