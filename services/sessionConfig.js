// The whole control panel as one shareable config: the data part (location,
// area, elevation source ... : services/runConfiguration.js, schemaVersion 1)
// plus `export`, every export-panel setting. Older MapNG versions read the
// data part and ignore `export`. Never holds keys or tokens.
//
// Shared three ways: as JSON (Save / Load), as a one-line code
// "mapng:1:<deflated base64url>" (Copy / Paste, Ctrl+V on the map, export and
// crash reports), and as a short send code (services/shareCodes.js).

/** Export-panel settings: [name in the config, localStorage key, kind, default]. */
export const EXPORT_FIELDS = [
  ['baseTexture', 'mapng_beamNGBaseTexture', ['satellite', 'osm', 'hybrid', 'game', 'none', 'painted'], 'osm'],
  ['groundMaterials', 'mapng_beamNGPbrSource', ['osm', 'none'], 'osm'],
  ['roads', 'mapng_beamNGRoadType', ['decal', 'none'], 'decal'],
  ['buildings', 'mapng_beamNGIncludeBuildings', 'bool', true],
  ['water', 'mapng_beamNGIncludeWater', 'bool', true],
  ['trees', 'mapng_beamNGIncludeTrees', 'bool', true],
  ['rocks', 'mapng_beamNGIncludeRocks', 'bool', true],
  ['safeCaps', 'mapng_beamNGSafeCaps', 'bool', true],
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
  ['backdrop', 'mapng_beamNGBackdropSource', ['off', 'global30m', 'usgs1m', 'gpxz'], 'off'],
  ['seaLevelOffset', 'mapng_beamNGSeaLevelOffset', 'number', 0],
];

/** Data-part settings kept outside the run configuration: [name, key, kind, default]. */
export const DATA_FIELDS = [
  ['gapFillSource', 'mapng_gapFillSource', 'string', ''],
  ['elevationUnitOverride', 'mapng_elevationUnitOverride', 'string', 'auto'],
  ['advancedMode', 'mapng_advanced_mode', 'bool', false],
  ['overtureBuildings', 'mapng_overtureBuildings', 'bool', true],
];

const SECRET_RE = /key|token|secret|password|auth/i;
const CODE_PREFIX = 'mapng:1:';

const readKey = (storage, key) => { try { return storage.getItem(key); } catch { return null; } };

function readField(storage, [, key, kind, fallback]) {
  const raw = readKey(storage, key);
  if (raw == null || raw === '') return fallback;
  if (kind === 'bool') return raw !== 'false' && raw !== '0';
  if (kind === 'number') { const n = Number(raw); return Number.isFinite(n) ? n : fallback; }
  if (Array.isArray(kind)) return kind.includes(raw) ? raw : fallback;
  return String(raw).slice(0, 80);
}

function validValue([, , kind], value) {
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

/** Drop keys/tokens anywhere in a config (they never travel in one). */
export function withoutSecrets(value, depth = 0) {
  if (value == null || typeof value !== 'object' || depth > 6) return value;
  if (Array.isArray(value)) return value.map((v) => withoutSecrets(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_RE.test(k) && k !== 'gpxzApiKeyMasked') continue;
    out[k] = withoutSecrets(v, depth + 1);
  }
  return out;
}

/**
 * The whole session config from a run configuration (the data part) and the
 * stored settings. Generated-terrain details (terrain, textureModes, osmQuery
 * ...) are left out: they describe a result, not a setting.
 */
export function buildSessionConfig(runConfiguration, storage = globalThis.localStorage) {
  const run = withoutSecrets(runConfiguration || {});
  const keep = ['schemaVersion', 'mode', 'center', 'zoom', 'resolution', 'includeOSM', 'elevationSource', 'useUSGS', 'useGPXZ', 'useKRON86', 'processingMetersPerPixel', 'rawTerrain'];
  const config = Object.fromEntries(keep.filter((k) => run[k] !== undefined).map((k) => [k, run[k]]));
  config.schemaVersion = 1;
  config.mode = 'single';
  Object.assign(config, readDataSettings(storage));
  config.export = readExportSettings(storage);
  return config;
}

/** Put a config's `export` (and data extras) into storage: the panels read it from there. */
export function applyStoredSettings(config, storage = globalThis.localStorage) {
  const write = (key, value) => { try { storage.setItem(key, String(value)); } catch { /* private mode */ } };
  const exp = config?.export && typeof config.export === 'object' ? config.export : null;
  if (exp) {
    for (const field of EXPORT_FIELDS) {
      if (field[0] in exp && validValue(field, exp[field[0]])) write(field[1], exp[field[0]]);
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

  const e = c.export;
  if (e && typeof e === 'object') {
    if (e.baseTexture) add('export', 'config.baseTexture', { valueKey: `config.tex_${e.baseTexture}` });
    const content = ['buildings', 'water', 'trees', 'rocks', 'roads'].filter((k) => (k === 'roads' ? e.roads !== 'none' : e[k] !== false));
    add('export', 'config.content', { valueKey: 'config.list', params: { list: content.length ? content.map((k) => `config.c_${k}`) : ['config.nothing'] } });
    const structures = ['bridges', 'tunnels', 'measuredBridgeHeights'].filter((k) => e[k] !== false);
    add('export', 'config.structures', { valueKey: 'config.list', params: { list: structures.length ? structures.map((k) => `config.c_${k}`) : ['config.nothing'] } });
    if (e.terrainEdits) {
      const custom = e.terrainEdits === 'custom'
        ? ['shapeRoads', 'shapeBridges', 'shapeOverpasses', 'shapeTunnels', 'shapeExtras'].filter((k) => e[k] !== false).map((k) => `config.c_${k}`)
        : null;
      add('export', 'config.terrainEdits', custom
        ? { valueKey: 'config.customList', params: { list: custom.length ? custom : ['config.nothing'] } }
        : { valueKey: `config.edits_${e.terrainEdits}` });
    }
    if (e.backdrop) add('export', 'config.backdrop', { valueKey: e.backdrop === 'off' ? 'config.off' : `config.source_${e.backdrop}` });
    if (typeof e.safeCaps === 'boolean') add('export', 'config.safeCaps', { valueKey: e.safeCaps ? 'config.on' : 'config.off' });
  }
  return rows;
}
