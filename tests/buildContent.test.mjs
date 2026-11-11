// What to build (services/buildContent.js): presets, the export's options,
// the OSM tag filter, and the choice carried by share codes and "Modify".
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT_IDS, CONTENT_PRESETS, presetOf, contentExportOptions, contentOn, filterOsmByTags,
  osmTagCounts, itemOfFeature, sanitizeExcludeTags, sanitizeContentOff,
} from '../services/buildContent.js';
import { buildSessionConfig, applyStoredSettings, encodeSessionCode, parseSessionText, describeSessionConfig } from '../services/sessionConfig.js';
import { usageFromConfig } from '../services/usageStats.js';

const storage = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m }; };
const run = { center: { lat: 40.44, lng: -80.0 }, resolution: 1024, includeOSM: true, elevationSource: 'default', processingMetersPerPixel: 1 };

test('every preset names known features, and is recognised back', () => {
  for (const [id, off] of Object.entries(CONTENT_PRESETS)) {
    assert.ok(off.every((x) => CONTENT_IDS.includes(x)), id);
    assert.equal(presetOf(off), id);
  }
  assert.equal(presetOf(['benches']), 'custom');
  assert.equal(presetOf([], ['amenity=bench']), 'custom', 'a single tag left out is a custom choice');
});

test('features switched off: old options set, their tags left out, the rest asked of contentOn', () => {
  const o = contentExportOptions(['buildings', 'roadSurfaces', 'benches', 'sidewalks', 'markings'], ['building=garage']);
  assert.equal(o.includeBuildings, false);
  assert.equal(o.roadType, 'none');
  assert.equal(o.includeSidewalks, false);
  assert.ok(o.excludeTags.includes('amenity=bench') && o.excludeTags.includes('building=garage'));
  assert.equal(contentOn(o, 'markings'), false);
  assert.equal(contentOn(o, 'lamps'), true);
  assert.equal(contentOn({}, 'markings'), true, 'old options (no contentOff) build everything');
});

test('the tag filter leaves out only the features of the excluded kind', () => {
  const features = [
    { type: 'road', tags: { highway: 'residential', railway: 'tram' } },      // a street with tram tracks
    { type: 'railway', tags: { railway: 'tram', highway: 'residential' } },   // its track
    { type: 'railway', tags: { railway: 'rail' } },
    { type: 'street_furniture', tags: { amenity: 'bench' } },
    { type: 'road', tags: { highway: 'footway' } },
    { type: 'barrier', tags: { barrier: 'fence', access: 'no' } },
  ];
  const r = filterOsmByTags(features, contentExportOptions(['railways', 'benches']).excludeTags);
  assert.deepEqual(r.features.map((f) => f.type), ['road', 'road', 'barrier']);
  assert.equal(r.removed, 3);
  // (a footway mapped as a crossing stays with the crosswalk when footpaths are left out)
  assert.equal(filterOsmByTags([{ type: 'road', tags: { highway: 'footway', footway: 'crossing' } }, { type: 'road', tags: { highway: 'footway' } }], ['highway=footway']).removed, 1);
  // (traffic_sign=* matches any value but 'no')
  assert.equal(filterOsmByTags([{ tags: { traffic_sign: 'no' } }, { tags: { traffic_sign: 'US:R1' } }], ['traffic_sign=*']).removed, 1);
  // (nothing off: the same array back)
  assert.equal(filterOsmByTags(features, []).features, features);
});

test('tag counts per feature, most common first; features sorted into groups for the map', () => {
  const c = osmTagCounts([{ tags: { barrier: 'wall' } }, { tags: { barrier: 'fence' } }, { tags: { barrier: 'fence' } }]);
  assert.deepEqual(c.fences, [{ tag: 'barrier=fence', count: 2 }, { tag: 'barrier=wall', count: 1 }]);
  assert.equal(itemOfFeature({ type: 'road', tags: { highway: 'primary', railway: 'tram' } }), 'mainRoads');
  assert.equal(itemOfFeature({ type: 'road', tags: { highway: 'raceway' } }), 'roadSurfaces');
  assert.equal(itemOfFeature({ type: 'building', tags: { building: 'yes' } }), 'buildings');
  assert.equal(itemOfFeature({ type: 'road', tags: { highway: 'steps' } }), 'steps');
});

test('water by kind: rivers, lakes and the sea are three switches', async () => {
  const { waterKindOf, filterWaterKinds } = await import('../services/buildContent.js');
  const w = (tags, type = 'water') => ({ type, tags });
  const features = [
    w({ waterway: 'stream' }), w({ natural: 'water', water: 'river' }), w({ waterway: 'riverbank' }),
    w({ natural: 'water', water: 'pond' }), w({ landuse: 'reservoir' }), w({ natural: 'water' }),
    w({ natural: 'coastline' }, 'coastline'), w({ waterway: 'dam' }), w({ leisure: 'swimming_pool' }), { type: 'road', tags: { highway: 'primary' } },
  ];
  assert.deepEqual(features.map(waterKindOf), ['river', 'river', 'river', 'lake', 'lake', 'lake', 'sea', null, null, null]);
  // (the rivers off: the lakes, the coast, the dam and the road stay)
  const r = filterWaterKinds(features, contentExportOptions(['rivers']));
  assert.equal(r.removed, 3);
  assert.ok(r.features.some((f) => f.tags.waterway === 'dam') && r.features.some((f) => f.tags.water === 'pond'));
  assert.equal(filterWaterKinds(features, {}).features, features, 'nothing off: the same array back');
  // (the old single option: off only when no inland water is built)
  assert.equal(contentExportOptions(['rivers']).includeWater, undefined);
  assert.equal(contentExportOptions(['rivers', 'lakes']).includeWater, false);
  // (the old single switch in a stored list or a code: rivers and lakes)
  assert.deepEqual(sanitizeContentOff(['water']).sort(), ['lakes', 'rivers']);
  assert.equal(itemOfFeature(w({ waterway: 'stream' })), 'rivers');
  assert.equal(itemOfFeature(w({ natural: 'water' })), 'lakes');
});

test('footbridges are their own switch: off, they go with their stretch of path', async () => {
  const { filterFootBridges, footBridgeOf } = await import('../services/buildContent.js');
  const features = [
    { type: 'road', tags: { highway: 'footway', bridge: 'yes' } }, { type: 'road', tags: { highway: 'steps', bridge: 'viaduct' } },
    { type: 'road', tags: { highway: 'footway' } }, { type: 'road', tags: { highway: 'primary', bridge: 'yes' } }, { type: 'road', tags: { highway: 'path', bridge: 'no' } },
  ];
  assert.deepEqual(features.map(footBridgeOf), [true, true, false, false, false]);
  assert.equal(filterFootBridges(features, contentExportOptions(['footBridges'])).removed, 2);
  assert.equal(filterFootBridges(features, {}).features, features);
  assert.equal(itemOfFeature(features[0]), 'footBridges');
  assert.equal(presetOf(['footBridges']), 'custom');
});

test('stored lists are cleaned: unknown ids and bad selectors dropped', () => {
  assert.deepEqual(sanitizeContentOff(['benches', 'nope', 'benches']), ['benches']);
  assert.deepEqual(sanitizeExcludeTags(['amenity=bench', 'bad', 'a=b=c', ' building=yes ', 'x=*']), ['amenity=bench', 'building=yes', 'x=*']);
  assert.deepEqual(sanitizeExcludeTags('amenity=bench'), []);
});

test('the choice travels in a share code and comes back into storage', async () => {
  const from = storage({
    mapng_beamNGIncludeBuildings: 'false',
    mapng_beamNGContentOff: JSON.stringify(['benches', 'parkedCars']),
    mapng_beamNGExcludeTags: JSON.stringify(['building=garage']),
    mapng_beamNGBasicPreset: 'clean',
    mapng_advanced_mode: 'true',
  });
  const config = buildSessionConfig(run, from);
  assert.deepEqual(config.export.contentOff, ['benches', 'parkedCars']);
  assert.deepEqual(config.export.excludeTags, ['building=garage']);
  assert.equal(config.export.basicPreset, 'clean');
  const back = await parseSessionText(await encodeSessionCode(config));
  const to = storage();
  applyStoredSettings(back, to);
  assert.equal(to.getItem('mapng_beamNGIncludeBuildings'), 'false');
  assert.deepEqual(JSON.parse(to.getItem('mapng_beamNGContentOff')), ['benches', 'parkedCars']);
  assert.deepEqual(JSON.parse(to.getItem('mapng_beamNGExcludeTags')), ['building=garage']);
  assert.equal(to.getItem('mapng_beamNGBasicPreset'), 'clean');
  // (someone else's code is data: junk in the lists never reaches storage)
  const junk = storage();
  applyStoredSettings({ export: { contentOff: ['benches', '<script>'], excludeTags: ['x', 'amenity=bench'] } }, junk);
  assert.deepEqual(JSON.parse(junk.getItem('mapng_beamNGContentOff')), ['benches']);
  assert.deepEqual(JSON.parse(junk.getItem('mapng_beamNGExcludeTags')), ['amenity=bench']);
  // (the confirm dialog lists them; the settings stats never count them)
  const rows = describeSessionConfig(back);
  assert.ok(rows.some((r) => r.label === 'config.contentOff'));
  assert.ok(rows.some((r) => r.label === 'config.excludeTags'));
  // (a basic config shows its preset, not the advanced switches)
  const basicRows = describeSessionConfig({ ...back, advancedMode: false });
  assert.ok(basicRows.some((r) => r.label === 'config.basicPreset' && r.valueKey === 'build.preset_clean'));
  assert.ok(!basicRows.some((r) => r.label === 'config.contentOff' || r.label === 'config.content'));
  const usage = usageFromConfig(back, 'web');
  assert.ok(!('contentOff' in usage) && !('excludeTags' in usage) && !('basicPreset' in usage));
});

test('an old code without the new fields leaves them alone', () => {
  const to = storage({ mapng_beamNGContentOff: JSON.stringify(['benches']) });
  applyStoredSettings({ export: { buildings: true } }, to);
  assert.deepEqual(JSON.parse(to.getItem('mapng_beamNGContentOff')), ['benches']);
});

test('"Modify" in My Levels puts the choice back (own tags only)', async () => {
  globalThis.localStorage ??= storage();
  const { exportSettingsFor } = await import('../services/exportSettings.js');
  const s = exportSettingsFor({ includeBuildings: false, contentOff: ['buildings', 'benches'], excludeTags: ['building=garage'] });
  assert.equal(s.mapng_beamNGIncludeBuildings, 'false');
  assert.deepEqual(JSON.parse(s.mapng_beamNGContentOff), ['benches']);
  assert.deepEqual(JSON.parse(s.mapng_beamNGExcludeTags), ['building=garage']);
});

test('road classes: each one leaves the data by its highway tags; Roads only keeps them all', async () => {
  const { ROAD_CLASS_IDS, contentExportOptions: opts, filterOsmByTags: filter, CONTENT_PRESETS: presets, itemOfFeature: itemOf } = await import('../services/buildContent.js');
  const roads = ['motorway', 'motorway_link', 'trunk', 'primary', 'tertiary_link', 'residential', 'unclassified', 'living_street', 'service', 'track', 'raceway', 'footway']
    .map((highway) => ({ type: 'road', tags: { highway } }));
  const left = (off) => filter(roads, opts(off, []).excludeTags).features.map((f) => f.tags.highway);
  assert.deepEqual(left(['motorways']), ['primary', 'tertiary_link', 'residential', 'unclassified', 'living_street', 'service', 'track', 'raceway', 'footway']);
  assert.deepEqual(left(['streets', 'serviceRoads', 'tracks']), ['motorway', 'motorway_link', 'trunk', 'primary', 'tertiary_link', 'raceway', 'footway']);
  assert.deepEqual(left(['mainRoads']).filter((h) => /primary|secondary|tertiary/.test(h)), []);
  assert.deepEqual(left([]).length, roads.length);
  // presets: Roads only builds every class; Scenery only none of them
  for (const id of ROAD_CLASS_IDS) { assert.ok(!presets.roads.includes(id), id); assert.ok(presets.scenery.includes(id), id); assert.ok(!presets.clean.includes(id), id); }
  assert.equal(itemOf({ type: 'road', tags: { highway: 'motorway_link' } }), 'motorways');
  assert.equal(itemOf({ type: 'road', tags: { highway: 'service' } }), 'serviceRoads');
  assert.equal(itemOf({ type: 'road', tags: { highway: 'footway' } }), 'paths');
});
