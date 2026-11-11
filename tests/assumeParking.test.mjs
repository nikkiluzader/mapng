// Fine-tuning's "Assume street parking" (services/roadWidth.js
// withoutAssumedParking): off, town streets with no parking tags are built at
// their driving width. Jevi, Discord 2026-11-09: "residential roads became
// super wide" (6 m of lanes plus 2.3 m of assumed parking a side = 10.6 m).
import test from 'node:test';
import assert from 'node:assert/strict';
import { withoutAssumedParking, estimateRoadCrossSection } from '../services/roadWidth.js';

const width = (tags) => {
  const c = estimateRoadCrossSection(tags, tags.highway, false, { urban: true });
  return Math.round(c.carriagewayHalfWidth * 2 * 10) / 10;
};

test('a town street with no parking tags: 10.6 m with parking assumed, 6 m without', () => {
  const street = { type: 'road', tags: { highway: 'residential' } };
  assert.equal(width(street.tags), 10.6);
  const { features, changed } = withoutAssumedParking([street]);
  assert.equal(changed, 1);
  assert.equal(width(features[0].tags), 6);
  assert.equal(features[0].tags['mapng:parking'], 'not_assumed');
  assert.deepEqual(street.tags, { highway: 'residential' }, 'the original feature is not touched');
});

test('mapped parking, other classes and other features are left as they are', () => {
  const mapped = { type: 'road', tags: { highway: 'residential', 'parking:both': 'lane' } };
  const oneSide = { type: 'road', tags: { highway: 'tertiary', 'parking:left': 'lane' } };
  const motorway = { type: 'road', tags: { highway: 'motorway' } };
  const service = { type: 'road', tags: { highway: 'service' } };
  const building = { type: 'building', tags: { building: 'yes' } };
  const all = [mapped, oneSide, motorway, service, building];
  const { features, changed } = withoutAssumedParking(all);
  assert.equal(changed, 1);                       // (only the street tagged on one side: its other side)
  assert.equal(features[0], mapped);
  assert.equal(features[2], motorway);
  assert.equal(features[3], service);
  assert.equal(features[4], building);
  // the mapped side keeps its lane, the unmapped side gets none
  const c = estimateRoadCrossSection(features[1].tags, 'tertiary', false, { urban: true });
  assert.ok(c.leftExtra > 2 && c.rightExtra === 0, `${c.leftExtra} / ${c.rightExtra}`);
  // nothing to change: the same array back
  assert.equal(withoutAssumedParking([mapped, motorway]).features.length, 2);
  assert.equal(withoutAssumedParking([mapped, motorway]).changed, 0);
});

test('the switch is saved, shared and shown only when off, and not counted', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const { exportSettingsFor } = await import('../services/exportSettings.js');
  const { EXPORT_FIELDS, describeSessionConfig, isCountedField } = await import('../services/sessionConfig.js');
  const { summarizeExportSettings } = await import('../services/exportSettingsSummary.js');
  assert.equal(exportSettingsFor({ assumeParking: false }).mapng_beamNGAssumeParking, 'false');
  assert.equal(exportSettingsFor({}).mapng_beamNGAssumeParking, 'true');
  const field = EXPORT_FIELDS.find((f) => f[1] === 'mapng_beamNGAssumeParking');
  assert.ok(field && field[3] === true);
  assert.equal(isCountedField(field), false);
  const keys = (o) => summarizeExportSettings(o).flatMap((g) => g.rows).map((r) => r.key);
  assert.ok(keys({ assumeParking: false }).includes('assumeParking'));
  assert.ok(!keys({}).includes('assumeParking'));
  assert.ok(describeSessionConfig({ advancedMode: true, export: { assumeParking: false } }).some((r) => r.label === 'config.assumeParking'));
  assert.ok(!describeSessionConfig({ advancedMode: true, export: { assumeParking: true } }).some((r) => r.label === 'config.assumeParking'));
});
