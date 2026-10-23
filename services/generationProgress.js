// Overall progress for terrain generation (Preview 3D / Generate Data).
//
// fetchTerrainData and the upload loaders report free text ("Downloaded
// 120/1657 global tiles...", "Resampling heightmap to 1m/px...") and only a
// few steps a percent. This sorts each message into a stage, weights the
// stages by how long they take, and moves inside a stage by its percent, its
// "x/y" count or, for silent steps (the heightmap resample: 35 s at 16k),
// by the time spent against the stage's expected length.
//
// Stage seconds at 4096² (px = (resolution / 4096)²), from timed standard-
// source runs: 16k tiles 16 s (8k: 40 s on a slower connection), resample
// 35 s, road smoothing 3 s, textures 4 s. OSM is weighted for MapNG's own
// tiles (~1 s); a slow Overpass run creeps through its share instead.

export const GENERATION_STAGES = ['prepare', 'elevation', 'repair', 'resample', 'satellite', 'osm', 'roads', 'finalize', 'textures'];

const stageSeconds = ({ px, includeOSM, upload }) => ({
  prepare: 0.3,
  elevation: 1 + 2 * px,
  repair: 0.3,
  resample: 0.5 + 2.2 * px,
  satellite: upload ? 1 + 1 * px : 0,
  osm: includeOSM ? 2 + 0.3 * px : 0,
  roads: includeOSM ? 0.1 + 0.2 * px : 0,
  finalize: 0.1 + 0.05 * px,
  textures: 0.3 + 0.25 * px,
});

/**
 * The stage a progress message belongs to, or null when it says nothing
 * about the stage (a translated app status, "Rendering 3D view…").
 */
export function classifyGenerationStatus(text) {
  const s = String(text || '').toLowerCase();
  if (!s) return null;
  if (/generating (osm|hybrid) texture|procedural noise|vector maps|blending satellite imagery/.test(s)) return 'textures';
  if (/smoothing roads|aligning roads/.test(s)) return 'roads';
  if (/finaliz/.test(s)) return 'finalize';
  if (/openstreetmap|overpass|osm data|\bmirror/.test(s)) return 'osm';
  if (/resampling heightmap|mapping uploaded elevation/.test(s)) return 'resample';
  if (/satellite/.test(s) && !/terrain and \d+ satellite tiles/.test(s)) return 'satellite';
  if (/refill|repair|gaps|fallback|corrupt/.test(s)) return 'repair';
  if (/metric bounds|starting|checking gpxz|index/.test(s)) return 'prepare';
  if (/tile|gpxz|usgs|nmt|elevation|point cloud|laz|downloading|fetching|rate limited|retrying|interrupted/.test(s)) return 'elevation';
  return null;
}

const countFraction = (text) => {
  // "mirror 2/6" is which Overpass server is being tried, not progress
  if (/mirror/i.test(String(text || ''))) return null;
  const m = /(\d+)\s*\/\s*(\d+)/.exec(String(text || ''));
  if (!m) return null;
  const total = Number(m[2]);
  return total > 0 ? Math.min(1, Number(m[1]) / total) : null;
};

/**
 * Track one generation run. update(status, percent?) takes each progress
 * message; tick() re-evaluates the time-based creep (call it on a timer).
 * Both return { pct, completed } where completed is the stage just finished
 * ({ step, durationMs }) or null.
 *
 * @param {{ resolution: number, includeOSM: boolean, upload?: boolean, startAt?: string }} options
 *   startAt skips the stages before it (adding OSM to existing terrain).
 */
export function createGenerationProgress({ resolution, includeOSM, upload = false, startAt = null, now = () => performance.now() }) {
  const px = (Math.max(256, Number(resolution) || 1024) / 4096) ** 2;
  const seconds = stageSeconds({ px, includeOSM, upload });
  const startIndex = startAt ? Math.max(0, GENERATION_STAGES.indexOf(startAt)) : 0;
  GENERATION_STAGES.forEach((stage, i) => { if (i < startIndex) seconds[stage] = 0; });
  const total = GENERATION_STAGES.reduce((sum, stage) => sum + seconds[stage], 0) || 1;

  let index = startIndex;
  let stageStartedAt = now();
  let stageLabel = null;          // first message of the stage: the most descriptive
  let reported = 0;               // reported fraction of the current stage (percent / count)
  let counted = false;            // the stage reports its own progress: no creep
  let lastPct = 0;

  const doneBefore = (i) => GENERATION_STAGES.slice(0, i).reduce((sum, stage) => sum + seconds[stage], 0);
  const percent = () => {
    const stage = GENERATION_STAGES[index];
    const expected = seconds[stage];
    // silent stretches creep toward 95 % of the stage, ~85 % by its expected time
    const creep = !counted && expected > 0 ? 0.95 * (1 - Math.exp((-2.3 * (now() - stageStartedAt)) / 1000 / expected)) : 0;
    const fraction = Math.max(reported, creep);
    const pct = Math.floor(((doneBefore(index) + expected * Math.min(1, fraction)) / total) * 100);
    lastPct = Math.max(lastPct, Math.min(99, pct));
    return lastPct;
  };

  const update = (status, statusPercent = null) => {
    let completed = null;
    const stage = classifyGenerationStatus(status);
    const next = stage ? GENERATION_STAGES.indexOf(stage) : -1;
    if (next > index) {
      if (stageLabel) completed = { step: stageLabel, durationMs: now() - stageStartedAt };
      index = next;
      stageStartedAt = now();
      stageLabel = null;
      reported = 0;
      counted = false;
    }
    if (!stageLabel && stage) stageLabel = String(status).replace(/\.{3}$|…$/, '');
    // a count only speaks for its own stage (a late "tiles 950/1000" is not resample progress)
    const fraction = stage && GENERATION_STAGES.indexOf(stage) !== index ? null
      : Number.isFinite(statusPercent) ? statusPercent / 100 : countFraction(status);
    if (fraction != null) { reported = Math.max(reported, fraction); counted = true; }
    return { pct: percent(), completed };
  };

  return {
    update,
    tick: () => ({ pct: percent(), completed: null }),
    // closes the last stage (the caller shows it as finished)
    finish: () => (stageLabel ? { step: stageLabel, durationMs: now() - stageStartedAt } : null),
  };
}
