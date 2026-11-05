import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PERSONAL_STORAGE_KEYS, withoutPersonal } from '../services/personalKeys.js';
import { applyStoredSettings, buildSessionConfig, DATA_FIELDS, encodeSessionCode, EXPORT_FIELDS, parseSessionText } from '../services/sessionConfig.js';
import { exportSettingsFor } from '../services/exportSettings.js';

const memoryStorage = (init = {}) => { const m = new Map(Object.entries(init)); return { map: m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const MINE = { mapng_gpxzApiKey: 'MY-GPXZ-KEY', mapng_customOverpassUrl: 'https://my.server/api?key=MINE' };
// someone else's config, stuffed with every personal thing it could carry
const theirs = {
  schemaVersion: 1, mode: 'single', center: { lat: 1, lng: 2 }, resolution: 2048, elevationSource: 'gpxz',
  gpxzApiKey: 'THEIR-KEY', gpxzStatus: { plan: 'pro', remaining: 999 }, gpxzKeySig: 'abc',
  customOverpassUrl: 'https://their.server', overpassUrl: 'https://their.server',
  export: { baseTexture: 'game', backdropGpxzApiKey: 'THEIR-KEY', mapng_gpxzApiKey: 'THEIR-KEY' },
  nested: { apiKey: 'THEIR-KEY', authToken: 'x' },
};

test('a pasted, loaded or sent config never brings personal settings in', async () => {
  for (const text of [JSON.stringify(theirs), JSON.stringify({ runConfiguration: theirs }), await encodeSessionCode(theirs)]) {
    const parsed = await parseSessionText(text);
    const s = JSON.stringify(parsed);
    assert.ok(!s.includes('THEIR') && !s.includes('their.server') && !s.includes('gpxzStatus'), s);
  }
});

test("applying someone's config leaves my keys and server exactly as they were", () => {
  const storage = memoryStorage(MINE);
  applyStoredSettings(theirs, storage);
  applyStoredSettings({ ...theirs, export: Object.fromEntries(PERSONAL_STORAGE_KEYS.map((k) => [k, 'THEIRS'])) }, storage);
  for (const [k, v] of Object.entries(MINE)) assert.equal(storage.getItem(k), v);
  assert.equal(storage.getItem('mapng_beamNGBaseTexture'), 'game');
});

test('configs MapNG makes never contain my personal settings', async () => {
  const c = buildSessionConfig({ ...theirs, gpxzApiKey: 'MY-GPXZ-KEY' }, memoryStorage(MINE));
  const s = JSON.stringify(c) + (await encodeSessionCode(c));
  assert.ok(!s.includes('MY-GPXZ-KEY') && !s.includes('my.server'));
});

test('no shared setting is stored under a personal key', () => {
  const shared = [...EXPORT_FIELDS, ...DATA_FIELDS].map((f) => f[1]).concat(Object.keys(exportSettingsFor({})));
  for (const key of PERSONAL_STORAGE_KEYS) assert.ok(!shared.includes(key), key);
});

test('both control panels strip personal settings before applying a config', () => {
  for (const file of ['components/panels/ControlPanel.vue', 'components/panels/BatchControlPanel.vue']) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(src, /const src = withoutPersonal\(config\?\.runConfiguration \|\| config\);/, file);
    assert.doesNotMatch(src, /gpxzApiKey\.value = src\.|gpxzStatus\.value = \{ \.\.\.src\./, file);
  }
  assert.deepEqual(withoutPersonal({ a: 1, gpxzApiKey: 'x' }), { a: 1 });
});
