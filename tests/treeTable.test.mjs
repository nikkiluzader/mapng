// The tree table (services/treeTable.js): the kinds and models the export's
// own rules pick for an area, counted for Fine-tuning.
import test from 'node:test';
import assert from 'node:assert/strict';
import { treeTable, treeModelLabel, sampleElevations } from '../services/treeTable.js';
import { chooseTreeGroup } from '../services/beamngTrees.js';

const sum = (rows) => rows.reduce((s, r) => s + r.share, 0);

test('with local records the table follows their shares', () => {
  const mix = { shares: { palm: 0.6, live_oak: 0.4 }, records: 80 };
  const t = treeTable({ lat: 29.9, lon: -81.3, mix });
  assert.equal(t.source, 'records');
  assert.equal(t.records, 80);
  assert.deepEqual(t.rows.map((r) => r.group), ['palm', 'live_oak']);
  assert.ok(Math.abs(t.rows[0].share - 0.6) < 0.04, String(t.rows[0].share));
  assert.ok(Math.abs(sum(t.rows) - 1) < 1e-9);
  for (const r of t.rows) {
    assert.ok(r.models.length >= 1);
    assert.ok(Math.abs(r.models.reduce((s, m) => s + m.share, 0) - r.share) < 1e-9);
  }
});

test('without records the climate rule decides, as in the export', () => {
  const t = treeTable({ lat: 47.4, lon: 8.5, mix: null });
  assert.equal(t.source, 'climate');
  assert.equal(t.records, 0);
  const expected = new Set();
  for (let i = 0; i < 300; i++) expected.add(chooseTreeGroup({ kind: 'tree', lat: 47.4, lon: 8.5, area: true, seed: `table:${i}` }));
  for (const r of t.rows) assert.ok(expected.has(r.group), r.group);
  assert.ok(t.rows.length >= 1 && Math.abs(sum(t.rows) - 1) < 0.02);
  assert.deepEqual(treeTable({ lat: 47.4, lon: 8.5, mix: { shares: {}, records: 0 } }).source, 'climate');
});

test('high ground turns the table to conifers whatever the lowland records say', () => {
  const mix = { shares: { oak: 1 }, records: 60 };
  const low = treeTable({ lat: 45.5, lon: 6.9, mix, elevations: [400, 500] });
  const high = treeTable({ lat: 45.5, lon: 6.9, mix, elevations: [2600, 2700] });
  assert.equal(low.rows[0].group, 'oak');
  assert.equal(high.rows.length, 1);
  assert.match(high.rows[0].group, /conifer|pine_west/);
});

test('the same inputs give the same table; no location, no rows', () => {
  const a = treeTable({ lat: 40.78, lon: -87.36, mix: null, elevations: [200] });
  assert.deepEqual(a, treeTable({ lat: 40.78, lon: -87.36, mix: null, elevations: [200] }));
  assert.deepEqual(treeTable({}).rows, []);
});

test('model names and height samples', () => {
  assert.equal(treeModelLabel('mapng_tree_tree_oak_large_b'), 'oak large b');
  assert.equal(treeModelLabel('mapng_tree_Juniper_tree_03'), 'Juniper tree 03');
  const h = new Float32Array(4096 * 4); h.fill(120); h[7] = NaN;
  const s = sampleElevations(h, 64);
  assert.ok(s.length > 32 && s.length <= 64 && s.every((v) => v === 120));
  assert.deepEqual(sampleElevations(null), []);
});

test('a kind left out is drawn again as the others, which keep their shares among themselves', async () => {
  const { chooseTreeGroupAllowed, sanitizeTreeKindsOff, TREE_KIND_IDS } = await import('../services/beamngTrees.js');
  const mix = { shares: { broadleaf: 0.75, juniper: 0.15, conifer: 0.1 }, records: 60 };
  const p = { lat: 40.78, lon: -87.36, mix, elevations: [200] };
  const all = treeTable(p);
  const cut = treeTable({ ...p, off: ['juniper'] });
  const share = (t, g) => t.rows.find((r) => r.group === g)?.share ?? 0;
  assert.ok(share(all, 'juniper') > 0.1);
  // (still listed, to switch back on; no share, no models)
  assert.deepEqual(cut.rows.at(-1), { group: 'juniper', share: 0, models: [], off: true });
  const on = cut.rows.filter((r) => !r.off);
  assert.ok(Math.abs(on.reduce((s, r) => s + r.share, 0) - 1) < 1e-9);
  // deciduous : conifer stays about 0.75 : 0.10
  assert.ok(Math.abs(share(cut, 'deciduous') / share(cut, 'conifer') - share(all, 'deciduous') / share(all, 'conifer')) < 1.5);
  // every kind the records give left out but one: all trees are that one
  const one = treeTable({ ...p, off: ['juniper', 'deciduous'] }).rows.filter((r) => !r.off);
  assert.deepEqual(one.map((r) => r.group), ['conifer']);
  // a tree whose species the map names keeps it; bushes are not touched
  const off = new Set(['palm']);
  assert.equal(chooseTreeGroupAllowed({ kind: 'tree', tags: { species: 'Sabal palmetto' }, lat: 29.9, lon: -81.3, seed: 'a' }, off), 'palm');
  assert.equal(chooseTreeGroupAllowed({ kind: 'shrub', lat: 29.9, lon: -81.3, seed: 'a' }, new Set(['shrub'])), chooseTreeGroupAllowed({ kind: 'shrub', lat: 29.9, lon: -81.3, seed: 'a' }, null));
  // the stored list: known kinds only, and never all of them
  assert.deepEqual(sanitizeTreeKindsOff(['palm', 'nonsense', 'palm']), ['palm']);
  assert.deepEqual(sanitizeTreeKindsOff([...TREE_KIND_IDS]), []);
  assert.deepEqual(sanitizeTreeKindsOff('palm'), []);
});

test('tree kinds left out are saved with the level, go into codes and the summary, and are not counted in the stats', async () => {
  const { exportSettingsFor } = await import('../services/exportSettings.js');
  const { EXPORT_FIELDS, isCountedField } = await import('../services/sessionConfig.js');
  const { summarizeExportSettings } = await import('../services/exportSettingsSummary.js');
  assert.equal(exportSettingsFor({ treeKindsOff: ['juniper', 'bogus'] }).mapng_beamNGTreeKindsOff, '["juniper"]');
  assert.equal(exportSettingsFor({}).mapng_beamNGTreeKindsOff, '[]');
  const field = EXPORT_FIELDS.find((f) => f[1] === 'mapng_beamNGTreeKindsOff');
  assert.ok(field);
  assert.equal(isCountedField(field), false);
  const rows = (o) => summarizeExportSettings(o).flatMap((g) => g.rows);
  assert.equal(rows({ includeTrees: true, treeKindsOff: ['juniper'] }).find((r) => r.key === 'treeKindsOff')?.value.text, 'juniper');
  assert.ok(!rows({ includeTrees: true, treeKindsOff: [] }).some((r) => r.key === 'treeKindsOff'));
});
