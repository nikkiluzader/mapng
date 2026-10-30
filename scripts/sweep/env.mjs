// Shared settings for the sweep tools: where test areas live and the keys
// (never printed).
//   MAPNG_AREAS   folder of test areas (default: scratch/levelprobe/data)
//   keys          ~/.config/mapng/mapng.env (GPXZ_API_KEY, TRACESTRACK_API_URL,
//                 GOOGLE_STREETVIEW_KEY, ...), or the environment
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
export const AREAS_DIR = process.env.MAPNG_AREAS || path.join(REPO, 'scratch/levelprobe/data');
export const OUT_DIR = process.env.MAPNG_SWEEP_OUT || path.join(REPO, 'scratch/sweep');

const envText = (() => {
  for (const f of ['mapng.env', 'gpxz.env', 'tracestrack.env']) {
    try { return fs.readFileSync(path.join(os.homedir(), '.config/mapng', f), 'utf8'); } catch { /* next */ }
  }
  return '';
})();
const repoEnv = (() => { try { return fs.readFileSync(path.join(REPO, 'refs/tracestrack.env'), 'utf8'); } catch { return ''; } })();
export function key(name) {
  if (process.env[name]) return process.env[name];
  for (const t of [envText, repoEnv]) {
    const m = t.match(new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*"?([^"\\s]+)"?`, 'm'));
    if (m) return m[1];
  }
  return '';
}

/** The area catalogue (scripts/sweep/areas.json). */
export function areas() {
  return JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/sweep/areas.json'), 'utf8')).areas;
}
