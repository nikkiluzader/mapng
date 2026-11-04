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
  const { blob, filename } = await exportBeamNGLevel(terrainData, job.center, {
    ...job.options,
    onProgress: (p) => send({ type: 'progress', ...p }),
  });
  fs.mkdirSync(job.outputDir, { recursive: true });
  const out = path.join(job.outputDir, filename);
  // (written beside, then renamed: the game never sees half a zip; in 64 MB
  // slices: Blob.stream() hands Node's web streams small chunks)
  const partial = `${out}.partial`;
  const fd = fs.openSync(partial, 'w');
  try {
    for (let o = 0; o < blob.size; o += 64 * 2 ** 20) fs.writeSync(fd, new Uint8Array(await blob.slice(o, o + 64 * 2 ** 20).arrayBuffer()));
  } finally { fs.closeSync(fd); }
  fs.renameSync(partial, out);
  send({ type: 'done', path: out, filename, size: blob.size, seconds: (Date.now() - started) / 1000 });
}

main().then(
  () => process.exit(0),
  (error) => { send({ type: 'error', message: String(error?.message || error), stack: error?.stack }); process.exit(1); },
);
