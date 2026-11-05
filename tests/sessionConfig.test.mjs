import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStoredSettings, buildSessionConfig, describeSessionConfig, encodeSessionCode, parseSessionText, readExportSettings } from '../services/sessionConfig.js';

const memoryStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
};
const run = { schemaVersion: 1, mode: 'single', center: { lat: 30.1, lng: -81.4 }, zoom: 13, resolution: 4096, includeOSM: true, elevationSource: 'gpxz', gpxzApiKey: 'SECRET', gpxzStatus: { plan: 'x' }, terrain: { width: 4096 }, processingMetersPerPixel: 1, rawTerrain: false };

test('a session config holds the data part and every export setting, never keys', () => {
  const storage = memoryStorage({ mapng_beamNGBaseTexture: 'game', mapng_beamNGIncludeTrees: 'false', mapng_beamNGShapeMode: 'custom', mapng_beamNGShapeTunnels: 'false', mapng_beamNGSeaLevelOffset: '-2.5', mapng_gpxzApiKey: 'SECRET' });
  const c = buildSessionConfig(run, storage);
  assert.equal(JSON.stringify(c).includes('SECRET'), false);
  assert.equal(c.center.lat, 30.1);
  assert.equal('terrain' in c, false);
  assert.equal(c.export.baseTexture, 'game');
  assert.equal(c.export.trees, false);
  assert.equal(c.export.buildings, true);            // unset = default
  assert.equal(c.export.terrainEdits, 'custom');
  assert.equal(c.export.seaLevelOffset, -2.5);
  assert.equal(c.overtureBuildings, true);
});

test('a code round-trips, and old JSON configs (even with a key) still load without it', async () => {
  const c = buildSessionConfig(run, memoryStorage({ mapng_beamNGBaseTexture: 'hybrid' }));
  const code = await encodeSessionCode(c);
  assert.match(code, /^mapng:1:[A-Za-z0-9_-]+$/);
  assert.ok(code.length < 900, `code is ${code.length} chars`);
  assert.deepEqual(await parseSessionText(`  ${code}\n`), c);
  const old = await parseSessionText(JSON.stringify(run));
  assert.equal(old.resolution, 4096);
  assert.equal('gpxzApiKey' in old, false);
  await assert.rejects(parseSessionText('{"hello":1}'));
  await assert.rejects(parseSessionText('mapng:1:garbage!!'));
});

test('applying writes the export settings the panel reads, ignoring bad values', () => {
  const storage = memoryStorage();
  applyStoredSettings({ export: { baseTexture: 'game', trees: false, terrainEdits: 'nonsense', backdrop: 'usgs1m' }, advancedMode: true }, storage);
  const e = readExportSettings(storage);
  assert.equal(e.baseTexture, 'game');
  assert.equal(e.trees, false);
  assert.equal(e.terrainEdits, 'all');               // invalid value not written
  assert.equal(e.backdrop, 'usgs1m');
  assert.equal(storage.getItem('mapng_advanced_mode'), 'true');
});

test('the summary warns when GPXZ is needed and there is no key', () => {
  const c = buildSessionConfig(run, memoryStorage({ mapng_beamNGShapeMode: 'custom', mapng_beamNGShapeRoads: 'false' }));
  const rows = describeSessionConfig(c, { hasGpxzKey: false });
  assert.equal(rows.find((r) => r.label === 'config.elevation').warn, 'config.needsGpxzKey');
  assert.equal(describeSessionConfig(c, { hasGpxzKey: true }).find((r) => r.label === 'config.elevation').warn, null);
  const edits = rows.find((r) => r.label === 'config.terrainEdits');
  assert.equal(edits.valueKey, 'config.customList');
  assert.ok(!edits.params.list.includes('config.c_shapeRoads'));
});
