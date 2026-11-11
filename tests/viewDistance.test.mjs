// The level's view distance (services/viewDistance.js): it follows the map
// unless one of five distances is chosen; saved with the level, shared in a
// code, shown when one was chosen.
import test from 'node:test';
import assert from 'node:assert/strict';

test('a view distance choice is one of the five, else auto', async () => {
  const { viewDistanceChoice, VIEW_DISTANCES_M, AUTO_VIEW_DISTANCE } = await import('../services/viewDistance.js');
  assert.deepEqual(VIEW_DISTANCES_M, [2000, 4000, 8000, 12000, 16000]);
  assert.equal(viewDistanceChoice('2000'), 2000);
  assert.equal(viewDistanceChoice(16000), 16000);
  for (const other of [undefined, null, '', 'auto', 'far', 0, 1000, 3000, -1000]) assert.equal(viewDistanceChoice(other), AUTO_VIEW_DISTANCE, String(other));
});

test('auto follows the map: its width, 4 km at least, 16 km at most', async () => {
  const { autoViewDistance, viewDistanceMeters } = await import('../services/viewDistance.js');
  assert.equal(autoViewDistance(512), 4000);
  assert.equal(autoViewDistance(2048), 4000);
  assert.equal(autoViewDistance(4096), 8000);      // (a 4 km map seen corner to corner needs more than 4 km)
  assert.equal(autoViewDistance(8192), 12000);
  assert.equal(autoViewDistance(12000), 12000);
  assert.equal(autoViewDistance(16384), 16000);
  assert.equal(autoViewDistance(40000), 16000);
  assert.equal(autoViewDistance(undefined), 4000);
  // a chosen distance wins over the map; anything else is auto
  assert.equal(viewDistanceMeters(2000, 16384), 2000);
  assert.equal(viewDistanceMeters('auto', 16384), 16000);
  assert.equal(viewDistanceMeters(undefined, 1024), 4000);
});

test('view distance is saved, shared and shown only when chosen, and never counted', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const { exportSettingsFor } = await import('../services/exportSettings.js');
  const { EXPORT_FIELDS, describeSessionConfig, isCountedField } = await import('../services/sessionConfig.js');
  const { summarizeExportSettings } = await import('../services/exportSettingsSummary.js');
  assert.equal(exportSettingsFor({ viewDistance: 2000 }).mapng_beamNGViewDistance, '2000');
  assert.equal(exportSettingsFor({}).mapng_beamNGViewDistance, 'auto');
  assert.equal(exportSettingsFor({ viewDistance: 123 }).mapng_beamNGViewDistance, 'auto');
  const field = EXPORT_FIELDS.find((f) => f[1] === 'mapng_beamNGViewDistance');
  assert.ok(field);
  assert.equal(field[3], 'auto');
  assert.equal(isCountedField(field), false);       // (public/data.html lists every counted setting)
  const rows = (o) => summarizeExportSettings(o).flatMap((g) => g.rows);
  assert.equal(rows({ viewDistance: 2000 }).find((r) => r.key === 'viewDistance')?.value.text, '2 km');
  assert.equal(rows({ viewDistance: 4000 }).find((r) => r.key === 'viewDistance')?.value.text, '4 km');
  assert.ok(!rows({ viewDistance: 'auto' }).some((r) => r.key === 'viewDistance'));
  assert.ok(!rows({}).some((r) => r.key === 'viewDistance'));
  const d = describeSessionConfig({ advancedMode: true, export: { viewDistance: '8000' } });
  assert.ok(d.some((r) => r.label === 'config.viewDistance' && r.value === '8 km'), JSON.stringify(d));
  assert.ok(!describeSessionConfig({ advancedMode: true, export: { viewDistance: 'auto' } }).some((r) => r.label === 'config.viewDistance'));
});

test('a short view gets thicker fog; 4 km and over keep the light haze', async () => {
  const { fogDensityFor } = await import('../services/viewDistance.js');
  assert.equal(fogDensityFor(2000), 0.0003);
  for (const d of [4000, 8000, 12000, 16000]) assert.equal(fogDensityFor(d), 0.0001, String(d));
});

test('every language has the view distance words', async () => {
  const fs = await import('node:fs');
  for (const lang of ['en', 'de', 'es', 'fr', 'it', 'pl', 'ru']) {
    const d = JSON.parse(fs.readFileSync(new URL(`../locales/${lang}.json`, import.meta.url), 'utf8'));
    for (const v of [d.exportPanel.viewDistance, d.exportPanel.ui.viewDistanceHint, d.exportPanel.ui.viewDistanceAuto, d.config.viewDistance, d.exportSettings.viewDistance]) assert.ok(v && typeof v === 'string', lang);
    assert.ok(d.exportPanel.ui.viewDistanceAuto.includes('{km}'), lang);
  }
});
