import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeExportSettings, translateExportSettings } from '../services/exportSettingsSummary.js';

const opts = {
  baseTexture: 'game', includeBackdrop: false, backdropElevationSource: 'off', includeBuildings: true, pbrSource: 'osm',
  includeWater: true, seaLevelOffset: 0, includeTrees: true, includeRocks: false, safeCaps: false, includeBridges: true,
  includeTunnels: true, lidarDecks: true, roadType: 'decal', levelName: 'Solano Avenue', elevationSource: 'mapterhorn',
  requestedResolution: 8192, requestedProcessingMetersPerPixel: 1,
  shapeTerrain: true, shapeRoads: true, shapeBridges: false, shapeOverpasses: false, shapeTunnels: true, shapeExtras: true, shapeDetail: true,
};

test('export settings: four groups, every row a label and a value, off rows marked', () => {
  const g = summarizeExportSettings(opts, { terrainMode: 'ready', advanced: true, width: 8192, metersPerPixel: 1 });
  assert.deepEqual(g.map((x) => x.key), ['groupTerrain', 'groupRoads', 'groupObjects', 'groupOutput']);
  const rows = Object.fromEntries(g.flatMap((x) => x.rows).map((r) => [r.key, r]));
  assert.equal(rows.size.value.text, '8192 px · 1 m/px · 8.2 km');
  assert.equal(rows.bridges.value.t, 'bridgesLidar');
  assert.equal(rows.rocks.off, true);
  assert.equal(rows.backdrop.off, true);
  assert.equal(rows.levelName.value.text, 'Solano Avenue');
  assert.equal(rows.seaLevel, undefined);   // (0: not listed)
});

test('export settings: Custom counts its edits; Basic is always Ready to drive', () => {
  const custom = summarizeExportSettings(opts, { terrainMode: 'custom', advanced: true, width: 1024 });
  const shaping = custom[0].rows.find((r) => r.key === 'shaping');
  assert.equal(shaping.value.t, 'modeCustomCount');
  assert.equal(shaping.value.text, '5 / 7');
  const basic = summarizeExportSettings(opts, { terrainMode: 'untouched', advanced: false, width: 1024 });
  assert.equal(basic[0].rows.find((r) => r.key === 'shaping').value.t, 'modeReady');
});

test('export settings: translated with the i18n function, text values kept', () => {
  const t = (k, p) => (p ? `${k}:${p.value}` : k);
  const out = translateExportSettings(summarizeExportSettings(opts, { terrainMode: 'custom', width: 512 }), t);
  assert.equal(out[0].title, 'exportSettings.groupTerrain');
  const shaping = out[0].rows.find((r) => r.label === 'exportSettings.shaping');
  assert.equal(shaping.value, 'exportSettings.modeCustomCount:5 / 7');
  assert.equal(out[3].rows.find((r) => r.label === 'exportSettings.levelName').value, 'Solano Avenue');
});
