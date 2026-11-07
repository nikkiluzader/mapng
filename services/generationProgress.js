// Overall progress for terrain generation (Preview 3D / Generate Data).
//
// fetchTerrainData and the upload loaders report free text ("Downloaded
// 120/1657 global tiles...", "Resampling heightmap to 1m/px...") and only a
// few steps a percent. This sorts each message into a stage, weights the
// stages by how long they take, and moves inside a stage by its percent, its
// "x/y" count or, for silent steps (the heightmap resample: 35 s at 16k),
// by the time spent against the stage's expected length.
//
// Stage seconds at 4096² (px = (resolution / 4096)²), from timed runs: 16k
// tiles 16 s (8k: 40 s on a slower connection), resample 35 s, road smoothing
// 3 s, textures 4 s. OSM is weighted for MapNG's own tiles (~1 s); a slow
// Overpass run creeps through its share instead. Stages a run skips (Raw
// terrain: no ground filter, no road shaping; lidar: no ground filter) weigh 0.

export const GENERATION_STAGES = ['prepare', 'source', 'tiles', 'repair', 'resample', 'satellite', 'osm', 'landcover', 'ground', 'roads', 'finalize', 'textures'];

/**
 * The six stages the progress card shows (components/ui/StageLoader.vue),
 * each the fine stages above it covers, in the order they run: elevation
 * (the chosen source: lidar, GPXZ, USGS..., then the global tiles it is
 * filled from, with satellite imagery), resampling to the level's grid, map
 * data, then shaping (the ground under buildings and trees, roads levelled
 * into the terrain: neither runs with Raw terrain), textures.
 */
export const GENERATION_STEP_GROUPS = [
  { key: 'prepare', members: ['prepare'] },
  { key: 'elevation', members: ['source', 'tiles', 'repair'] },
  { key: 'terrain', members: ['resample'] },
  { key: 'mapData', members: ['satellite', 'osm', 'landcover'] },
  { key: 'shaping', members: ['ground', 'roads'] },
  { key: 'textures', members: ['finalize', 'textures'] },
];

// source: 'default' (global 30 m), 'mapterhorn' (Best free), 'gpxz', 'usgs', 'kron86', 'upload'
const stageSeconds = ({ px, includeOSM, upload, raw, flat, source, groundFilter = true, smoothRoads = true }) => {
  const coarse = !upload && !flat && (source === 'default' || source === 'mapterhorn');
  return {
    prepare: 0.3,
    source: flat || upload ? (upload ? 1 + 3 * px : 0)
      : source === 'gpxz' ? 2 + 6 * px
      : source === 'usgs' || source === 'kron86' ? 3 + 5 * px
      : source === 'mapterhorn' ? 1 + 3 * px : 0,
    tiles: flat ? 0.3 : 1 + 2 * px,
    repair: 0.3,
    resample: 0.5 + 2.2 * px,
    satellite: upload ? 1 + 1 * px : 0,
    osm: includeOSM ? 2 + 0.3 * px : 0,
    // (ESA WorldCover, range reads of a few 3° tiles: ~1-2 s; the uploads read it after the terrain, unweighted)
    landcover: upload ? 0 : 1 + 0.15 * px,
    // (the ground filter: bare-earth and Copernicus grids fetched, then filtered; global 30 m only, never raw)
    ground: includeOSM && coarse && !raw && groundFilter ? 1.5 + 1.5 * px : 0,
    roads: includeOSM && !raw && !flat && smoothRoads ? 0.3 + 0.8 * px : 0,
    finalize: 0.3 + 1 * px,
    // (with the game texture: ~2.5 s at 2048²)
    textures: 0.5 + 6 * px,
  };
};

/**
 * The stage a progress message belongs to, or null when it says nothing
 * about the stage (a translated app status, "Rendering 3D view…").
 */
export function classifyGenerationStatus(text) {
  const s = String(text || '').toLowerCase();
  if (!s) return null;
  if (/generating (osm|hybrid|game map) texture|procedural noise|vector maps|blending satellite imagery/.test(s)) return 'textures';
  // (a note, not a stage: Raw terrain skips the shaping stages)
  if (/^raw terrain:/.test(s)) return null;
  if (/smoothing (\d+ )?roads|aligning roads/.test(s)) return 'roads';
  if (/ground under buildings|river water/.test(s)) return 'ground';
  if (/finaliz/.test(s)) return 'finalize';
  if (/land cover|worldcover/.test(s)) return 'landcover';
  if (/openstreetmap|overpass|osm data|\bmirror|overture/.test(s)) return 'osm';
  if (/resampling heightmap|mapping (uploaded )?elevation/.test(s)) return 'resample';
  // (the global tiles: the terrain the source is filled from, with the satellite imagery)
  if (/global tiles|terrain and \d+ satellite tiles|fallback terrain tiles/.test(s)) return 'tiles';
  if (/satellite/.test(s)) return 'satellite';
  if (/refill|repair|gaps|corrupt/.test(s)) return 'repair';
  if (/metric bounds|starting/.test(s)) return 'prepare';
  if (/mapterhorn|gpxz|usgs|nmt|evrf|point cloud|laz|lidar|tile|elevation|downloading|fetching|rate limited|retrying|interrupted|index/.test(s)) return 'source';
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
 * Both return { pct, completed, stage, stageFraction }: completed is the stage
 * just finished ({ step, durationMs }) or null; stage the one running and
 * stageFraction how far it is (0..1, never backwards).
 *
 * @param {{ resolution: number, includeOSM: boolean, upload?: boolean, raw?: boolean, flat?: boolean, source?: string, startAt?: string }} options
 *   startAt skips the stages before it (adding OSM to existing terrain).
 */
export function createGenerationProgress({ resolution, includeOSM, upload = false, raw = false, flat = false, source = 'mapterhorn', groundFilter = true, smoothRoads = true, startAt = null, now = () => performance.now() }) {
  const px = (Math.max(256, Number(resolution) || 1024) / 4096) ** 2;
  const seconds = stageSeconds({ px, includeOSM, upload, raw, flat, source, groundFilter, smoothRoads });
  const startIndex = startAt ? Math.max(0, GENERATION_STAGES.indexOf(startAt)) : 0;
  GENERATION_STAGES.forEach((stage, i) => { if (i < startIndex) seconds[stage] = 0; });
  const total = GENERATION_STAGES.reduce((sum, stage) => sum + seconds[stage], 0) || 1;

  let index = startIndex;
  let stageStartedAt = now();
  let stageLabel = null;          // first message of the stage: the most descriptive
  let reported = 0;               // reported fraction of the current stage (percent / count)
  let counted = false;            // the stage reports its own progress: no creep
  let lastPct = 0;
  let stageFraction = 0;          // shown share of the current stage (never backwards)

  const doneBefore = (i) => GENERATION_STAGES.slice(0, i).reduce((sum, stage) => sum + seconds[stage], 0);
  const percent = () => {
    const stage = GENERATION_STAGES[index];
    const expected = seconds[stage];
    // silent stretches creep: ~85 % of the stage by its expected time, then on
    // slowly toward 99 % (an Overpass outage held the bar still for 45 s at 95 %)
    const t = expected > 0 ? (now() - stageStartedAt) / 1000 / expected : 0;
    const creep = expected > 0 ? 0.9 * (1 - Math.exp(-2.3 * t)) + 0.09 * (1 - Math.exp(-t / 6)) : 0;
    // a stage that counts its own progress still moves between its counts,
    // never past a quarter of what is left after the last one (a slow OSM
    // server's "3/5" held both bars still for 20 s)
    const fraction = counted ? Math.max(reported, Math.min(creep, reported + 0.25 * (1 - reported))) : Math.max(reported, creep);
    stageFraction = Math.max(stageFraction, Math.min(1, fraction));
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
      stageFraction = 0;
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
    return { pct: percent(), completed, stage: GENERATION_STAGES[index], stageFraction };
  };

  return {
    update,
    tick: () => ({ pct: percent(), completed: null, stage: GENERATION_STAGES[index], stageFraction }),
    // each stage's expected seconds in this run (0: skipped): the loader's weights
    weights: { ...seconds },
    // closes the last stage (the caller shows it as finished)
    finish: () => (stageLabel ? { step: stageLabel, durationMs: now() - stageStartedAt } : null),
  };
}
