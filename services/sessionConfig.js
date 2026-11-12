// The whole control panel as one shareable config: the data part (location,
// area, elevation source ... : services/runConfiguration.js, schemaVersion 1)
// plus `export`, every export-panel setting. Older MapNG versions read the
// data part and ignore `export`. Never holds keys or tokens.
//
// Shared three ways: as JSON (Save / Load), as a one-line code
// "mapng:1:<deflated base64url>" (Copy / Paste, Ctrl+V on the map, export and
// crash reports), and as a short send code (worker/shareCodes.js).
import { PERSONAL_STORAGE_KEYS, withoutPersonal } from './personalKeys.js';
import { sanitizePoints, pointLabel } from './spawnPoints.js';
import { sanitizeContentOff, sanitizeExcludeTags, PRESET_IDS } from './buildContent.js';
import { sanitizeTreeKindsOff } from './beamngTrees.js';

/** Export-panel settings: [name in the config, localStorage key, kind, default]. */
export const EXPORT_FIELDS = [
  ['baseTexture', 'mapng_beamNGBaseTexture', ['satellite', 'osm', 'hybrid', 'game', 'none', 'painted'], 'osm'],
  ['groundMaterials', 'mapng_beamNGPbrSource', ['osm', 'none'], 'osm'],
  ['roads', 'mapng_beamNGRoadType', ['decal', 'none'], 'decal'],
  ['buildings', 'mapng_beamNGIncludeBuildings', 'bool', true],
  ['water', 'mapng_beamNGIncludeWater', 'bool', true],
  ['trees', 'mapng_beamNGIncludeTrees', 'bool', true],
  ['forestDensity', 'mapng_beamNGForestDensity', ['light', 'normal', 'dense', 'veryDense'], 'normal'],
  ['viewDistance', 'mapng_beamNGViewDistance', ['auto', '2000', '4000', '8000', '12000', '16000'], 'auto'],   // metres: services/viewDistance.js
  ['rocks', 'mapng_beamNGIncludeRocks', 'bool', true],
  ['safeCaps', 'mapng_beamNGSafeCaps', 'bool', true],
  ['assumeParking', 'mapng_beamNGAssumeParking', 'bool', true],   // (off: only mapped street parking, services/roadWidth.js)
  ['bridges', 'mapng_beamNGIncludeBridges', 'bool', true],
  ['tunnels', 'mapng_beamNGIncludeTunnels', 'bool', true],
  ['measuredBridgeHeights', 'mapng_beamNGLidarDecks', 'bool', true],
  ['terrainEdits', 'mapng_beamNGShapeMode', ['all', 'custom', 'none'], 'all'],
  ['shapeTerrain', 'mapng_beamNGShapeTerrain', 'bool', true],
  ['shapeRoads', 'mapng_beamNGShapeRoads', 'bool', true],
  ['shapeBridges', 'mapng_beamNGShapeBridges', 'bool', true],
  ['shapeOverpasses', 'mapng_beamNGShapeOverpasses', 'bool', true],
  ['shapeTunnels', 'mapng_beamNGShapeTunnels', 'bool', true],
  ['shapeExtras', 'mapng_beamNGShapeExtras', 'bool', true],
  ['shapeDetail', 'mapng_beamNGShapeDetail', 'bool', true],
  ['backdrop', 'mapng_beamNGBackdropSource', ['off', 'global30m', 'usgs1m', 'gpxz'], 'off'],
  ['seaLevelOffset', 'mapng_beamNGSeaLevelOffset', 'number', 0],
  // What to build (composables/useBuildContent.js): features switched off beyond the seven
  // above, OSM tags left out one by one, and the preset basic mode builds
  ['contentOff', 'mapng_beamNGContentOff', 'contentList', []],
  ['excludeTags', 'mapng_beamNGExcludeTags', 'tagList', []],
  ['treeKindsOff', 'mapng_beamNGTreeKindsOff', 'treeKindList', []],   // tree kinds left out in Fine-tuning (services/beamngTrees.js)
  ['basicPreset', 'mapng_beamNGBasicPreset', PRESET_IDS, 'all'],
];
const LIST_KINDS = { contentList: sanitizeContentOff, tagList: sanitizeExcludeTags, treeKindList: sanitizeTreeKindsOff };
/** Whether a field holds a list (stored as JSON; not counted in the settings stats). */
export const isListField = ([, , kind]) => Object.hasOwn(LIST_KINDS, kind);
// (not counted in the settings stats: public/data.html lists every counted setting)
const NOT_COUNTED = new Set(['contentOff', 'excludeTags', 'basicPreset', 'viewDistance', 'assumeParking']);
export const isCountedField = (field) => !NOT_COUNTED.has(field[0]) && !isListField(field);

/** Data-part settings kept outside the run configuration: [name, key, kind, default]. */
export const DATA_FIELDS = [
  ['gapFillSource', 'mapng_gapFillSource', 'string', ''],
  ['elevationUnitOverride', 'mapng_elevationUnitOverride', 'string', 'auto'],
  ['advancedMode', 'mapng_advanced_mode', 'bool', false],
  ['overtureBuildings', 'mapng_overtureBuildings', 'bool', true],
];

const CODE_PREFIX = 'mapng:1:';

const readKey = (storage, key) => { try { return storage.getItem(key); } catch { return null; } };

function readField(storage, [, key, kind, fallback]) {
  const raw = readKey(storage, key);
  if (raw == null || raw === '') return fallback;
  if (LIST_KINDS[kind]) { try { return LIST_KINDS[kind](JSON.parse(raw)); } catch { return fallback; } }
  if (kind === 'bool') return raw !== 'false' && raw !== '0';
  if (kind === 'number') { const n = Number(raw); return Number.isFinite(n) ? n : fallback; }
  if (Array.isArray(kind)) return kind.includes(raw) ? raw : fallback;
  return String(raw).slice(0, 80);
}

function validValue([, , kind], value) {
  if (LIST_KINDS[kind]) return Array.isArray(value);
  if (kind === 'bool') return typeof value === 'boolean';
  if (kind === 'number') return Number.isFinite(Number(value));
  if (Array.isArray(kind)) return kind.includes(value);
  return typeof value === 'string' && value.length <= 80;
}

/** The export panel's settings, as stored. */
export const readExportSettings = (storage = globalThis.localStorage) =>
  Object.fromEntries(EXPORT_FIELDS.map((f) => [f[0], readField(storage, f)]));

/** The data-part settings outside the run configuration. */
export const readDataSettings = (storage = globalThis.localStorage) =>
  Object.fromEntries(DATA_FIELDS.map((f) => [f[0], readField(storage, f)]));

/** Drop personal settings (keys, own servers, GPXZ account) anywhere in a config: services/personalKeys.js. */
export const withoutSecrets = withoutPersonal;

/**
 * The whole session config from a run configuration (the data part) and the
 * stored settings. Generated-terrain details (terrain, textureModes, osmQuery
 * ...) are left out: they describe a result, not a setting.
 */
// (a background-areas mask worth carrying: drawn on a box, not empty)
export const usableMask = (m) => !!(m && typeof m === 'object' && m.version && m.bounds
  && ['lines', 'shade', 'unshade', 'roads', 'paint', 'raw'].some((k) => Array.isArray(m[k]) && m[k].length));

export function buildSessionConfig(runConfiguration, storage = globalThis.localStorage, { backgroundMask = null, points = null } = {}) {
  const run = withoutSecrets(runConfiguration || {});
  const keep = ['schemaVersion', 'mode', 'center', 'zoom', 'resolution', 'includeOSM', 'elevationSource', 'useUSGS', 'useGPXZ', 'useKRON86', 'processingMetersPerPixel', 'rawTerrain'];
  const config = Object.fromEntries(keep.filter((k) => run[k] !== undefined).map((k) => [k, run[k]]));
  config.schemaVersion = 1;
  config.mode = 'single';
  Object.assign(config, readDataSettings(storage));
  config.export = readExportSettings(storage);
  // the background areas drawn in step 1 (lines, shaded areas, kept roads,
  // Unmask and No smoothing strokes): they belong to this exact box
  if (usableMask(backgroundMask)) config.backgroundMask = JSON.parse(JSON.stringify(backgroundMask));
  // the spawn and quicktravel points (services/spawnPoints.js): geographic,
  // so they travel with or without a box
  const kept = sanitizePoints(points);
  if (kept.length) config.points = kept;
  return config;
}

/** A config's points, checked (a pasted code is someone else's data), or null when it has none. */
export const configPoints = (config) => (Array.isArray(config?.points) ? sanitizePoints(config.points) : null);

/**
 * The code for mapng.com's short send codes, which hold up to `limit`
 * characters: a big background-areas drawing is left out first, then the
 * points. Returns { code, dropped: [...names left out] }.
 */
export async function encodeSessionCodeWithin(config, limit = 16000) {
  let cfg = config;
  let code = await encodeSessionCode(cfg);
  const dropped = [];
  for (const key of ['backgroundMask', 'points']) {
    if (code.length <= limit) break;
    if (cfg[key] === undefined) continue;
    const { [key]: _drop, ...rest } = cfg;
    cfg = rest;
    dropped.push(key);
    code = await encodeSessionCode(cfg);
  }
  return { code, dropped };
}

/** Put a config's `export` (and data extras) into storage: the panels read it from there. */
export function applyStoredSettings(config, storage = globalThis.localStorage) {
  const write = (key, value) => {
    if (PERSONAL_STORAGE_KEYS.includes(key)) return;   // (never someone else's keys)
    try { storage.setItem(key, String(value)); } catch { /* private mode */ }
  };
  const exp = config?.export && typeof config.export === 'object' ? config.export : null;
  if (exp) {
    for (const field of EXPORT_FIELDS) {
      if (!(field[0] in exp) || !validValue(field, exp[field[0]])) continue;
      write(field[1], LIST_KINDS[field[2]] ? JSON.stringify(LIST_KINDS[field[2]](exp[field[0]])) : exp[field[0]]);
      // (a code that asks for a backdrop: kept for the next terrain, services/exportSettings.js)
      if (field[1] === 'mapng_beamNGBackdropSource') { if (exp[field[0]] !== 'off') write('mapng_beamNGBackdropApplied', '1'); else { try { storage.removeItem?.('mapng_beamNGBackdropApplied'); } catch { /* private mode */ } } }
    }
  }
  for (const field of DATA_FIELDS) {
    if (field[0] in (config || {}) && validValue(field, config[field[0]])) write(field[1], config[field[0]]);
  }
  return !!exp;
}

// ---- one-line codes ------------------------------------------------------

const toBase64Url = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64Url = (text) => {
  const b = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
async function pipe(bytes, stream) {
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(out);
}

/** "mapng:1:…" for a config. */
export async function encodeSessionCode(config) {
  const json = new TextEncoder().encode(JSON.stringify(withoutSecrets(config)));
  return CODE_PREFIX + toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

export const looksLikeSessionCode = (text) => String(text || '').trim().startsWith(CODE_PREFIX);

/** A pasted code or JSON (a session config, an old run configuration, a level's mapng.json) → config, or throws. */
export async function parseSessionText(text) {
  const t = String(text || '').trim();
  if (!t) throw new Error('empty');
  let value;
  if (t.startsWith(CODE_PREFIX)) {
    const bytes = await pipe(fromBase64Url(t.slice(CODE_PREFIX.length).replace(/\s+/g, '')), new DecompressionStream('deflate-raw'));
    value = JSON.parse(new TextDecoder().decode(bytes));
  } else {
    value = JSON.parse(t);
  }
  const config = value?.runConfiguration || value?.sessionConfig || value;
  if (!config || typeof config !== 'object') throw new Error('not a config');
  const hasArea = config.center && Number.isFinite(Number(config.center.lat)) && Number.isFinite(Number(config.center.lng));
  if (!hasArea && !config.export) throw new Error('not a config');
  return withoutSecrets(config);
}

// ---- what a config would change, for the confirm dialog ------------------

/**
 * Rows [{ section, label, value, warn? }] describing a config, with label and
 * value as i18n keys/params resolved by the dialog: `t(row.label)`,
 * `row.value` (plain) or `t(row.valueKey, row.params)`.
 */
export function describeSessionConfig(config, { hasGpxzKey = false } = {}) {
  const rows = [];
  const add = (section, label, value, extra = {}) => rows.push({ section, label, ...value, ...extra });
  const c = config || {};
  if (c.center && Number.isFinite(Number(c.center.lat))) {
    add('data', 'config.location', { value: `${Number(c.center.lat).toFixed(5)}, ${Number(c.center.lng).toFixed(5)}` });
  }
  if (Number.isFinite(Number(c.resolution))) {
    const mpp = Number(c.processingMetersPerPixel) > 0 ? Number(c.processingMetersPerPixel) : 1;
    const km = (Number(c.resolution) * mpp) / 1000;
    add('data', 'config.area', { valueKey: 'config.areaValue', params: { px: Number(c.resolution), mpp, km: km >= 10 ? km.toFixed(1) : km.toFixed(2) } });
  }
  if (c.elevationSource) {
    add('data', 'config.elevation', { valueKey: `config.source_${c.elevationSource}`, warn: c.elevationSource === 'gpxz' && !hasGpxzKey ? 'config.needsGpxzKey' : null });
  }
  if (typeof c.includeOSM === 'boolean') add('data', 'config.osm', { valueKey: c.includeOSM ? 'config.on' : 'config.off' });
  if (typeof c.rawTerrain === 'boolean') add('data', 'config.rawTerrain', { valueKey: c.rawTerrain ? 'config.on' : 'config.off' });
  if (typeof c.advancedMode === 'boolean') add('data', 'config.advancedMode', { valueKey: c.advancedMode ? 'config.on' : 'config.off' });
  if (usableMask(c.backgroundMask)) {
    const m = c.backgroundMask;
    add('data', 'config.backgroundAreas', { valueKey: 'config.backgroundAreasValue', params: { lines: (m.lines || []).length, areas: (m.shade || []).length, roads: (m.roads || []).length, strokes: (m.paint || []).length + (m.raw || []).length } });
  }

  const points = configPoints(c);
  if (points?.length) {
    const i = points.findIndex((p) => p.isDefault);
    add('data', 'config.points', i >= 0
      ? { valueKey: 'config.pointsValueDefault', params: { n: points.length, name: pointLabel(points[i], i) } }
      : { valueKey: 'config.pointsValue', params: { n: points.length } });
  }

  const e = c.export;
  if (e && typeof e === 'object') {
    if (e.baseTexture) add('export', 'config.baseTexture', { valueKey: `config.tex_${e.baseTexture}` });
    // (basic mode builds its preset: the advanced switches below only for an advanced config, or an old one that doesn't say)
    const advanced = c.advancedMode !== false;
    const content = ['buildings', 'water', 'trees', 'rocks', 'roads'].filter((k) => (k === 'roads' ? e.roads !== 'none' : e[k] !== false));
    if (advanced) add('export', 'config.content', { valueKey: 'config.list', params: { list: content.length ? content.map((k) => `config.c_${k}`) : ['config.nothing'] } });
    if (!advanced && e.basicPreset) add('export', 'config.basicPreset', { valueKey: `build.preset_${e.basicPreset}` });
    const offList = sanitizeContentOff(e.contentOff);
    if (advanced && offList.length) add('export', 'config.contentOff', { valueKey: 'config.list', params: { list: offList.map((id) => `build.item_${id}`) } });
    const tagList = sanitizeExcludeTags(e.excludeTags);
    if (advanced && tagList.length) add('export', 'config.excludeTags', { value: tagList.slice(0, 6).join(', ') + (tagList.length > 6 ? ` +${tagList.length - 6}` : '') });
    if (advanced && e.trees !== false && e.forestDensity && e.forestDensity !== 'normal') add('export', 'config.forestDensity', { valueKey: `exportPanel.ui.forestDensity_${e.forestDensity}` });
    if (advanced && e.assumeParking === false) add('export', 'config.assumeParking', { valueKey: 'config.off' });
    if (advanced && e.viewDistance && String(e.viewDistance) !== 'auto') add('export', 'config.viewDistance', { value: `${Number(e.viewDistance) / 1000} km` });
    const structures = ['bridges', 'tunnels', 'measuredBridgeHeights'].filter((k) => e[k] !== false);
    if (advanced) add('export', 'config.structures', { valueKey: 'config.list', params: { list: structures.length ? structures.map((k) => `config.c_${k}`) : ['config.nothing'] } });
    if (e.terrainEdits) {
      const custom = e.terrainEdits === 'custom'
        ? ['shapeRoads', 'shapeBridges', 'shapeOverpasses', 'shapeTunnels', 'shapeExtras', 'shapeDetail'].filter((k) => e[k] !== false).map((k) => `config.c_${k}`)
        : null;
      add('export', 'config.terrainEdits', custom
        ? { valueKey: 'config.customList', params: { list: custom.length ? custom : ['config.nothing'] } }
        : { valueKey: `config.edits_${e.terrainEdits}` });
    }
    if (e.backdrop) add('export', 'config.backdrop', { valueKey: e.backdrop === 'off' ? 'config.off' : `config.source_${e.backdrop}` });
    // (shown like the panel's "Build everything" box, the opposite of safe caps)
    if (advanced && typeof e.safeCaps === 'boolean') add('export', 'config.buildEverything', { valueKey: e.safeCaps ? 'config.off' : 'config.on' });
  }
  return rows;
}

// ---- short send codes (mapng.com /api/share: worker/shareCodes.js) --------------

const SHARE_CHARS = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
/** "k7f-29q", "K7F29Q" or a "mapng.com/#K7F-29Q" link → "K7F29Q", or null. */
export function shareIdFrom(text) {
  const t = String(text || '').trim();
  const m = /(?:^|#)([A-Za-z0-9]{3}-?[A-Za-z0-9]{3})$/.exec(t);
  if (!m) return null;
  const id = m[1].toUpperCase().replace('-', '');
  return [...id].every((c) => SHARE_CHARS.includes(c)) ? id : null;
}
export const shareLink = (id) => `https://mapng.com/#${id}`;

/** Store a code for 24 hours: { id: "K7F-29Q", expiresAt }, or throws with the server's reason. */
export async function sendSessionCode(code, fetchImpl = globalThis.fetch) {
  const r = await fetchImpl('/api/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.id) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

/** The code stored under a send code, or throws (expired / unknown / offline). */
export async function fetchSharedCode(id, fetchImpl = globalThis.fetch) {
  const r = await fetchImpl(`/api/share/${encodeURIComponent(id)}`);
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.code) throw new Error(d.error || `HTTP ${r.status}`);
  return d.code;
}
