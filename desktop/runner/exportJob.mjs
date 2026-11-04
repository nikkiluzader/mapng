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
import { installBrowserShims } from './browserShims.mjs';
import { reviveJobValue } from './jobFormat.mjs';
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
  const terrainData = await reviveJobValue(job.terrainData, jobDir);
  const started = Date.now();
  // (the zip written to the file as it is made, beside the final name; the
  // game never sees half a zip: renamed when complete)
  fs.mkdirSync(job.outputDir, { recursive: true });
  let partial = null; let fd = null; let size = 0;
  const { filename } = await exportBeamNGLevel(terrainData, job.center, {
    ...job.options,
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
  send({ type: 'done', path: out, filename, size, seconds: (Date.now() - started) / 1000 });
}

main().then(
  () => process.exit(0),
  (error) => { send({ type: 'error', message: String(error?.message || error), stack: error?.stack }); process.exit(1); },
);
