// The level's view distance (services/viewDistance.js): one of four
// distances, saved with the level, shared in a code, shown when not 4 km.
import test from 'node:test';
import assert from 'node:assert/strict';

test('a view distance is one of the four, else the default', async () => {
  const { viewDistanceMeters, VIEW_DISTANCES_M, DEFAULT_VIEW_DISTANCE_M } = await import('../services/viewDistance.js');
  assert.deepEqual(VIEW_DISTANCES_M, [2000, 4000, 8000, 12000, 16000]);
  assert.equal(DEFAULT_VIEW_DISTANCE_M, 4000);
  assert.equal(viewDistanceMeters('2000'), 2000);
  assert.equal(viewDistanceMeters(8000), 8000);
  assert.equal(viewDistanceMeters('16000'), 16000);
  for (const bad of [undefined, null, '', 'far', 0, 1000, 3000, -1000]) assert.equal(viewDistanceMeters(bad), 4000, String(bad));
});

test('view distance is saved, shared and shown only when not 4 km, and never counted', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const { exportSettingsFor } = await import('../services/exportSettings.js');
  const { EXPORT_FIELDS, describeSessionConfig, isCountedField } = await import('../services/sessionConfig.js');
  const { summarizeExportSettings } = await import('../services/exportSettingsSummary.js');
  assert.equal(exportSettingsFor({ viewDistance: 2000 }).mapng_beamNGViewDistance, '2000');
  assert.equal(exportSettingsFor({}).mapng_beamNGViewDistance, '4000');
  assert.equal(exportSettingsFor({ viewDistance: 123 }).mapng_beamNGViewDistance, '4000');
  const field = EXPORT_FIELDS.find((f) => f[1] === 'mapng_beamNGViewDistance');
  assert.ok(field);
  assert.equal(isCountedField(field), false);       // (public/data.html lists every counted setting)
  const rows = (o) => summarizeExportSettings(o).flatMap((g) => g.rows);
  assert.equal(rows({ viewDistance: 2000 }).find((r) => r.key === 'viewDistance')?.value.text, '2 km');
  assert.ok(!rows({ viewDistance: 4000 }).some((r) => r.key === 'viewDistance'));
  assert.ok(!rows({}).some((r) => r.key === 'viewDistance'));
  const d = describeSessionConfig({ advancedMode: true, export: { viewDistance: '8000' } });
  assert.ok(d.some((r) => r.label === 'config.viewDistance' && r.value === '8 km'), JSON.stringify(d));
  assert.ok(!describeSessionConfig({ advancedMode: true, export: { viewDistance: '4000' } }).some((r) => r.label === 'config.viewDistance'));
});

test('a short view gets thicker fog; 4 km and over keep the light haze', async () => {
  const { fogDensityFor } = await import('../services/viewDistance.js');
  assert.equal(fogDensityFor(2000), 0.0003);
  for (const d of [4000, 8000, 12000, 16000, undefined]) assert.equal(fogDensityFor(d), 0.0001, String(d));
});

test('every language has the view distance words', async () => {
  const fs = await import('node:fs');
  for (const lang of ['en', 'de', 'es', 'fr', 'it', 'pl', 'ru']) {
    const d = JSON.parse(fs.readFileSync(new URL(`../locales/${lang}.json`, import.meta.url), 'utf8'));
    for (const v of [d.exportPanel.viewDistance, d.exportPanel.ui.viewDistanceHint, d.config.viewDistance, d.exportSettings.viewDistance]) assert.ok(v && typeof v === 'string', lang);
  }
});
