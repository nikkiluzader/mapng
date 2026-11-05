// Which settings people export with (opt in, separate from export hotspots;
// public/data.html#usage). One report per finished level export: a flat
// list of setting → value from the allowed lists below, never a location,
// level name, key or anything free-form. The server (hotspotsObject.js)
// only adds 1 to each pair's total and refuses anything not listed here.
import { EXPORT_FIELDS } from './sessionConfig.js';

const ON_OFF = ['on', 'off'];

/** Every setting that can be counted, and the values it can have. */
export const USAGE_FIELDS = {
  platform: ['web', 'desktop'],
  elevationSource: ['default', 'none', 'kron86', 'usgs', 'gpxz', 'upload'],
  resolution: ['512', '1024', '2048', '4096', '8192', '16384', 'other'],
  metersPerPixel: ['under1', '1', '1to2', '2to4', 'over4'],
  mapData: ON_OFF,
  overtureBuildings: ON_OFF,
  advancedMode: ON_OFF,
  rawTerrain: ON_OFF,
  seaLevelOffset: ['zero', 'changed'],
  ...Object.fromEntries(EXPORT_FIELDS
    .filter(([name]) => name !== 'seaLevelOffset')
    .map(([name, , kind]) => [name, Array.isArray(kind) ? kind : ON_OFF])),
};

const onOff = (v) => (v ? 'on' : 'off');
const mppBucket = (mpp) => (mpp < 1 ? 'under1' : mpp === 1 ? '1' : mpp <= 2 ? '1to2' : mpp <= 4 ? '2to4' : 'over4');

/** The counted settings for a session config (services/sessionConfig.js buildSessionConfig). */
export function usageFromConfig(config, platform, { uploaded = false } = {}) {
  const c = config || {};
  const e = c.export || {};
  const mpp = Number(c.processingMetersPerPixel) > 0 ? Number(c.processingMetersPerPixel) : 1;
  const resolution = String(Number(c.resolution));
  const out = {
    platform,
    elevationSource: uploaded ? 'upload' : c.elevationSource,
    resolution: USAGE_FIELDS.resolution.includes(resolution) ? resolution : 'other',
    metersPerPixel: mppBucket(mpp),
    mapData: onOff(c.includeOSM !== false),
    overtureBuildings: onOff(c.overtureBuildings !== false),
    advancedMode: onOff(!!c.advancedMode),
    rawTerrain: onOff(!!c.advancedMode && !!c.rawTerrain),
    seaLevelOffset: Number(e.seaLevelOffset) ? 'changed' : 'zero',
  };
  for (const [name, , kind] of EXPORT_FIELDS) {
    if (name === 'seaLevelOffset' || !(name in e)) continue;
    out[name] = Array.isArray(kind) ? e[name] : onOff(e[name] !== false);
  }
  return validUsage(out);
}

/** Only listed settings with listed values (the server applies the same check). */
export function validUsage(report) {
  const out = {};
  if (!report || typeof report !== 'object') return out;
  for (const [name, value] of Object.entries(report)) {
    if (Object.hasOwn(USAGE_FIELDS, name) && USAGE_FIELDS[name].includes(value)) out[name] = value;
  }
  return out;
}
