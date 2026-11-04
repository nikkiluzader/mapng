// The app's Generate Data step (services/terrain.js fetchTerrainData) in its
// own Node process: elevation, imagery and OSM fetched and processed here,
// not in the window, whose JS heap stops at 4 GB like a browser tab.
//
//   node --max-old-space-size=<MB> generateJob.mjs <session dir>
//
// The session dir holds job.json ({ center, resolution, includeOSM, useUSGS,
// useGPXZ, useKRON86, gpxzApiKey, generationOptions, localStorage,
// sources? }); every network response it is made from goes to sources/ (or
// is replayed from a project's: a rebuild); the
// terrain data comes out as terrain.json there, its big values in files
// beside it (jobFormat.mjs), which the page reads back and an export reuses.
import fs from 'node:fs';
import path from 'node:path';
import { installBrowserShims, installSourceRecorder } from './browserShims.mjs';
import { appApiFetch, cancelSignal, installLocalStorage, send, startMemoryReports } from './common.mjs';
import { writeJobValue } from './jobFormat.mjs';

installBrowserShims({
  assetsDir: path.resolve(process.env.MAPNG_ASSETS || new URL('../../public', import.meta.url).pathname),
  apiOrigin: process.env.MAPNG_API_ORIGIN || 'https://mapng.com',
  apiFetch: appApiFetch(),
});
startMemoryReports();
const signal = cancelSignal();

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: generateJob.mjs <session dir>');
  const job = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8'));
  installLocalStorage(job.localStorage);
  // (what the terrain is made from, kept for a rebuild with later versions;
  // a rebuild replays it: job.sources { mode: 'replay', dir, fallback })
  const sources = installSourceRecorder({
    dir: job.sources?.dir || path.join(dir, 'sources'),
    mode: job.sources?.mode || 'record',
    fallback: job.sources?.fallback !== false,
  });
  const { fetchTerrainData } = await import('../../services/terrain.js');
  const started = Date.now();
  const data = await fetchTerrainData(
    job.center, job.resolution, !!job.includeOSM, !!job.useUSGS, !!job.useGPXZ, !!job.useKRON86,
    job.gpxzApiKey || '', undefined,
    (update) => send({ type: 'progress', update }),
    signal,
    job.generationOptions || {},
  );
  send({ type: 'progress', update: 'Saving the terrain…' });
  const { osmFeatures, sourceGeoTiffs, ...rest } = data;
  const out = await writeJobValue(rest, 'terrain', dir, { files: 0 });
  if (Array.isArray(osmFeatures)) {
    // (the biggest value: one JSON file)
    fs.writeFileSync(path.join(dir, 'osmFeatures.json'), JSON.stringify(osmFeatures));
    out.osmFeatures = { $file: 'osmFeatures.json', as: 'json' };
  }
  // (the GeoTIFF readers stay here; the page and the export read only their source)
  if (sourceGeoTiffs?.source) out.sourceGeoTiffs = { source: sourceGeoTiffs.source };
  fs.writeFileSync(path.join(dir, 'terrain.json'), JSON.stringify(out));
  // (in the log: whether a rebuild stayed offline, and what it had to fetch)
  console.log(`[Sources] ${job.sources?.mode || 'record'}: ${sources.recorded} recorded, ${sources.replayed} from saved data, ${sources.missed} not saved (${sources.downloaded} downloaded instead)`);
  for (const u of sources.missedUrls) console.log(`[Sources]   not saved: ${u}`);
  send({ type: 'done', seconds: (Date.now() - started) / 1000, width: data.width, height: data.height, sources });
}

main().then(
  () => process.exit(0),
  (error) => {
    send({ type: 'error', message: String(error?.message || error), aborted: error?.name === 'AbortError', stack: error?.stack });
    process.exit(1);
  },
);
