import test from 'node:test';
import assert from 'node:assert/strict';

const woodLevel = () => {
  const N = 257; const D = 0.004; // ~445 m square, a ~265 m wood in the middle
  return {
    width: N, height: N, heightMap: new Float32Array(N * N).fill(100), minHeight: 100, maxHeight: 100,
    bounds: { south: 45 - D / 2, north: 45 + D / 2, west: 7 - D / 2, east: 7 + D / 2 },
    osmFeatures: [
      { id: 'n1', type: 'vegetation', tags: { natural: 'tree' }, geometry: [{ lat: 45.0018, lng: 7.0018 }] },
      { id: 'w1', type: 'landuse', tags: { natural: 'wood' }, geometry: [
        { lat: 44.9988, lng: 6.9988 }, { lat: 44.9988, lng: 7.0012 }, { lat: 45.0012, lng: 7.0012 }, { lat: 45.0012, lng: 6.9988 }, { lat: 44.9988, lng: 6.9988 }] },
    ],
  };
};

test('forest density: woods get more trees, a mapped tree keeps its copies', async () => {
  const { __buildForestPlacements, FOREST_DENSITY, forestDensityMultiplier } = await import('../services/exportBeamNGLevel.js');
  const { getBeamNGBiomeById } = await import('../services/beamngBiomeCatalog.js');
  const { geoToWorldPoint } = await import('../services/terrainLookup.js');
  assert.equal(forestDensityMultiplier('normal'), 1.5);
  assert.equal(forestDensityMultiplier('nonsense'), 1.5);
  const counts = {};
  const quiet = console.log; console.log = () => {};
  try {
    for (const k of Object.keys(FOREST_DENSITY)) {
      const td = woodLevel();
      const out = await __buildForestPlacements(td, 1.7, { includeTrees: true, includeRocks: false, forestDensity: k }, getBeamNGBiomeById('east_coast_usa'));
      const all = [...out.values()].flat();
      const [tx, ty] = geoToWorldPoint(45.0018, 7.0018, td, 1.7, 0);
      const nearMapped = all.filter((p) => Math.hypot(p.pos[0] - tx, p.pos[1] - ty) < 7).length;
      counts[k] = { all: all.length, nearMapped };
    }
  } finally { console.log = quiet; }
  assert.ok(counts.light.all < counts.normal.all && counts.normal.all < counts.dense.all && counts.dense.all < counts.veryDense.all, JSON.stringify(counts));
  // woods scale with the multiplier (tree count within 25%; bushes are capped at 'dense')
  assert.ok(counts.veryDense.all / counts.normal.all > 2.2, JSON.stringify(counts));
  for (const k of Object.keys(counts)) assert.equal(counts[k].nearMapped, counts.normal.nearMapped, `mapped tree copies at ${k}`);
});

test('forest density is saved, shared and shown only when not normal', async () => {
  const { exportSettingsFor } = await import('../services/exportSettings.js');
  const { EXPORT_FIELDS, describeSessionConfig } = await import('../services/sessionConfig.js');
  const { summarizeExportSettings } = await import('../services/exportSettingsSummary.js');
  assert.equal(exportSettingsFor({ forestDensity: 'dense' }).mapng_beamNGForestDensity, 'dense');
  assert.equal(exportSettingsFor({ forestDensity: 'bogus' }).mapng_beamNGForestDensity, 'normal');
  assert.ok(EXPORT_FIELDS.some((f) => f[1] === 'mapng_beamNGForestDensity'));
  const rows = (o) => summarizeExportSettings({ includeTrees: true, ...o }).flatMap((g) => g.rows).map((r) => r.key);
  assert.ok(rows({ forestDensity: 'veryDense' }).includes('forestDensity'));
  assert.ok(!rows({ forestDensity: 'normal' }).includes('forestDensity'));
  const d = describeSessionConfig({ export: { forestDensity: 'dense' } });
  assert.ok(d.some((r) => r.label === 'config.forestDensity' && r.valueKey === 'exportPanel.ui.forestDensity_dense'));
});
