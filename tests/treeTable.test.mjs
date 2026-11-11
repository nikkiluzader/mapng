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
