import test from 'node:test';
import assert from 'node:assert/strict';

import { parseOverpassResponse } from '../services/osm.js';
import { OSM_FILTER, buildOverpassQuery } from '../services/overpassQuery.js';
import { railKindOf, railHalfWidth, gaugeOf, tracksOf, railSegmentsFrom, streetRunningTest, undergroundRailIds, railStateOf } from '../services/railways.js';

const line = (id, tags, pts) => ({ type: 'way', id, tags, geometry: pts.map(([lng, lat]) => ({ lat, lon: lng })) });
const bounds = { north: 1, south: 0, east: 1, west: 0 };

test('the Overpass query and the tile filter ask for the lines built: those in use, and disused, preserved and abandoned ones', () => {
  const asked = OSM_FILTER.wayTags.filter(([k]) => k === 'railway').map(([, v]) => v).sort();
  // (and platforms: raised beside their track, platforms.js)
  assert.deepEqual(asked, ['abandoned', 'disused', 'funicular', 'light_rail', 'monorail', 'narrow_gauge', 'platform', 'preserved', 'rail', 'subway', 'tram']);
  const q = buildOverpassQuery({ south: 0, west: 0, north: 1, east: 1 });
  assert.match(q, /way\["railway"="rail"\]\(0,0,1,1\);/);
  assert.match(q, /way\["railway"="disused"\]\(0,0,1,1\);/);
  assert.doesNotMatch(q, /razed|dismantled|construction|proposed/);
});

test('railKindOf: lines in use and closed lines in; lines never or no longer there, and underground subways, out', () => {
  assert.equal(railKindOf({ railway: 'rail' }), 'rail');
  assert.equal(railKindOf({ railway: 'tram' }), 'tram');
  // closed lines are built as the kind of line they were (plain rail when the map does not say)
  assert.equal(railKindOf({ railway: 'abandoned' }), 'rail');
  assert.equal(railKindOf({ railway: 'disused' }), 'rail');
  assert.equal(railKindOf({ railway: 'preserved' }), 'rail');
  assert.equal(railKindOf({ railway: 'disused', 'disused:railway': 'narrow_gauge' }), 'narrow_gauge');
  assert.equal(railKindOf({ railway: 'abandoned', 'abandoned:railway': 'tram' }), null);   // (its rails in the street are paved over)
  assert.equal(railKindOf({ railway: 'razed' }), null);
  assert.equal(railKindOf({ railway: 'dismantled' }), null);
  assert.equal(railKindOf({ railway: 'proposed' }), null);
  assert.equal(railStateOf({ railway: 'disused' }), 'disused');
  assert.equal(railStateOf({ railway: 'rail', abandoned: 'yes' }), 'abandoned');
  assert.equal(railKindOf({ railway: 'rail', abandoned: 'yes' }), null);
  assert.equal(railStateOf({ railway: 'rail' }), null);
  assert.equal(railKindOf({ railway: 'construction', construction: 'rail' }), null);
  assert.equal(railKindOf({ railway: 'rail', disused: 'yes' }), 'rail');
  assert.equal(railKindOf({ railway: 'rail', razed: 'yes' }), null);
  assert.equal(railKindOf({ railway: 'platform' }), null);
  assert.equal(railKindOf({ railway: 'rail', area: 'yes' }), null);
  // a subway: only where it is above ground
  assert.equal(railKindOf({ railway: 'subway', tunnel: 'yes', layer: '-1' }), null);
  assert.equal(railKindOf({ railway: 'subway', layer: '-2' }), null);
  assert.equal(railKindOf({ railway: 'subway', bridge: 'viaduct', layer: '1' }), 'subway');
  // a tunnel on a main line is built; a city's light rail tunnel is not (a metro under the streets)
  assert.equal(railKindOf({ railway: 'rail', tunnel: 'yes' }), 'rail');
  assert.equal(railKindOf({ railway: 'light_rail', tunnel: 'yes', layer: '-2' }), null);
  assert.equal(railKindOf({ railway: 'light_rail', tunnel: 'building_passage' }), 'light_rail');
  assert.equal(railKindOf({ railway: 'light_rail', layer: '-1' }), 'light_rail');
});

test('a railway way becomes a railway feature with its tags, clipped as a line', () => {
  const tags = { railway: 'rail', bridge: 'yes', layer: '1', gauge: '1435', electrified: 'contact_line', tracks: '2', usage: 'main', name: 'Main Line', 'bridge:structure': 'truss' };
  const features = parseOverpassResponse({ elements: [
    line(1, tags, [[-0.5, 0.5], [0.5, 0.5], [1.5, 0.5]]),
    line(2, { railway: 'razed' }, [[0.1, 0.1], [0.9, 0.1]]),
    line(4, { railway: 'disused' }, [[0.1, 0.3], [0.9, 0.3]]),
    line(3, { railway: 'subway', tunnel: 'yes', layer: '-1' }, [[0.1, 0.2], [0.9, 0.2]]),
  ] }, bounds);
  // (the subway in its tunnel is kept as data: the export builds what is above ground)
  const rail = features.filter((f) => f.type === 'railway' && f.tags.railway === 'rail');
  // (the razed line is not there; the disused one is kept, to be built)
  assert.equal(features.filter((f) => f.type === 'railway').length, 3);
  assert.equal(features.filter((f) => f.type === 'railway' && f.tags.railway === 'disused').length, 1);
  assert.equal(rail.length, 1);
  assert.deepEqual(rail[0].tags, tags);
  assert.ok(rail[0].geometry.every((p) => p.lng >= 0 && p.lng <= 1), 'clipped to the map');
  assert.equal(rail[0].geometry.length, 3);
  assert.ok(!features.some((f) => f.type === 'road'), 'no road made of it');
});

test('a street way carrying a tram is both a road and a railway', () => {
  const features = parseOverpassResponse({ elements: [
    line(5, { highway: 'residential', railway: 'tram', name: 'High Street' }, [[0.1, 0.5], [0.9, 0.5]]),
  ] }, bounds);
  assert.equal(features.filter((f) => f.type === 'road').length, 1);
  const tram = features.filter((f) => f.type === 'railway');
  assert.equal(tram.length, 1);
  assert.notEqual(tram[0].id.replace(/_seg_\d+$/, ''), '5', 'its own id');
});

test('track widths, gauges and counts from the tags, with fallbacks', () => {
  assert.equal(gaugeOf({}), 1.435);
  assert.equal(gaugeOf({ gauge: '1000' }), 1);
  assert.equal(gaugeOf({ gauge: '1435;1668' }), 1.435);
  assert.equal(gaugeOf({ railway: 'narrow_gauge' }), 1);
  assert.equal(gaugeOf({ gauge: 'standard' }), 1.435);
  assert.equal(tracksOf({}), 1);
  assert.equal(tracksOf({ tracks: '2' }), 2);
  assert.equal(tracksOf({ tracks: 'lots' }), 1);
  const one = railHalfWidth({ railway: 'rail' });
  const two = railHalfWidth({ railway: 'rail', tracks: '2' });
  assert.ok(one > 1.5 && one < 2.5, `single track half width ${one}`);
  assert.ok(Math.abs(two - one - 2) < 1e-9, 'a second track 4 m over');
});

test('rail segments for the structure graph; street-running trams left to the street', () => {
  const ll = (x, y) => ({ lat: y / 111320, lng: x / 111320 });
  const f = (id, tags, pts) => ({ id: String(id), type: 'railway', tags, geometry: pts.map(([x, y]) => ll(x, y)) });
  const features = [
    f(1, { railway: 'rail', bridge: 'yes', layer: '1' }, [[0, 0], [100, 0]]),
    f(2, { railway: 'tram' }, [[0, 50], [200, 50]]),          // down the middle of a street
    f(3, { railway: 'tram' }, [[0, -80], [200, -80]]),        // on its own right of way
    { id: '9', type: 'road', tags: { highway: 'primary' }, geometry: [ll(-10, 50), ll(210, 50)] },
  ];
  const project = (lat, lng) => [lng * 111320, lat * 111320];
  const streetRunning = streetRunningTest([{ xy: [[-10, 50], [210, 50]], half: 7 }], project);
  const segs = railSegmentsFrom(features, { streetRunning });
  assert.deepEqual(segs.map((s) => s.sourceFeature.id), ['1', '3']);
  assert.equal(segs[0].highway, 'railway:rail');
  assert.equal(segs[0].rail, 'rail');
  assert.equal(segs[0].layer, 1);
});

test('a city line\'s untagged station track between two of its tunnels is underground with them', () => {
  const ll = (x, y) => ({ lat: y / 111320, lng: x / 111320 });
  const f = (id, tags, pts) => ({ id: String(id), type: 'railway', tags, geometry: pts.map(([x, y]) => ll(x, y)) });
  const features = [
    f(1, { railway: 'light_rail', tunnel: 'yes', layer: '-1' }, [[-500, 0], [-100, 0]]),
    f(2, { railway: 'light_rail' }, [[-100, 0], [100, 0]]),                       // the station, untagged
    f(3, { railway: 'light_rail', tunnel: 'yes', layer: '-1' }, [[100, 0], [500, 0]]),
    f(4, { railway: 'light_rail' }, [[500, 0], [900, 0]]),                        // out of the portal, above ground
    f(5, { railway: 'rail' }, [[-100, 300], [100, 300]]),
  ];
  const under = undergroundRailIds(features);
  assert.deepEqual([...under].sort(), ['1', '2', '3']);
  assert.deepEqual(railSegmentsFrom(features).map((s) => s.sourceFeature.id), ['4', '5']);
});

test('a main line tunnel passing under the whole map (every end on the map\'s edge) is underground: not built', async () => {
  const { undergroundRailIds, railSegmentsFrom } = await import('../services/railways.js');
  const bounds = { north: 51.01, south: 51.0, west: -117.01, east: -117.0 };
  const way = (id, pts, tags) => ({ id, type: 'railway', tags: { railway: 'rail', ...tags }, geometry: pts.map(([lat, lng]) => ({ lat, lng })) });
  // edge to edge, in two pieces
  const through = [way('t1', [[51.0, -117.006], [51.005, -117.005]], { tunnel: 'yes' }), way('t2', [[51.005, -117.005], [51.01, -117.004]], { tunnel: 'yes' })];
  // a tunnel with a portal on the map: open track runs on from it
  const portal = [way('p1', [[51.002, -117.01], [51.003, -117.007]], { tunnel: 'yes' }), way('p2', [[51.003, -117.007], [51.004, -117.002]], {})];
  const feats = [...through, ...portal];
  assert.deepEqual([...undergroundRailIds(feats, bounds)].sort(), ['t1', 't2']);
  assert.deepEqual(railSegmentsFrom(feats, { bounds }).map((s) => s.sourceFeature.id).sort(), ['p1', 'p2']);
  // (no bounds given: as before)
  assert.equal(undergroundRailIds(feats).size, 0);
});

test('What to build: disused and abandoned lines have rows of their own, and switching one off leaves the others', async () => {
  const { CONTENT_GROUPS, filterOsmByTags, contentExportOptions } = await import('../services/buildContent.js');
  const group = CONTENT_GROUPS.find((g) => g.id === 'railways');
  assert.deepEqual(group.items.map((i) => i.id), ['railways', 'railwaysDisused', 'railwaysAbandoned', 'platforms']);
  assert.ok(group.items[0].tags.includes('railway=preserved'));
  const feats = [{ id: 'a', type: 'railway', tags: { railway: 'rail' } }, { id: 'b', type: 'railway', tags: { railway: 'disused' } }, { id: 'c', type: 'railway', tags: { railway: 'abandoned' } }];
  const choice = contentExportOptions ? contentExportOptions(['railwaysAbandoned'], []) : null;
  const tags = choice?.excludeTags || ['railway=abandoned'];
  assert.deepEqual(filterOsmByTags(feats, tags).features.map((f) => f.id), ['a', 'b']);
});

test('abandoned lines are off unless switched on: in every quick-select preset, and for the test export', async () => {
  const { CONTENT_PRESETS, DEFAULT_OFF_IDS, presetOf } = await import('../services/buildContent.js');
  assert.deepEqual(DEFAULT_OFF_IDS, ['railwaysAbandoned']);
  for (const [name, off] of Object.entries(CONTENT_PRESETS)) assert.ok(off.includes('railwaysAbandoned'), name);
  assert.ok(!CONTENT_PRESETS.all.includes('railwaysDisused') && !CONTENT_PRESETS.roads.includes('railwaysDisused'));
  assert.equal(presetOf(['railwaysAbandoned']), 'all');
  assert.equal(presetOf([]), 'custom');     // (everything and the abandoned lines too: a choice of one's own)
});

test('a closed line\'s old kind said the older way (disused=tram) is that kind; a closed line that is a path now has no rails', () => {
  assert.equal(railKindOf({ railway: 'disused', disused: 'tram' }), 'tram');
  assert.equal(railKindOf({ railway: 'disused', disused: 'yes' }), 'rail');
  assert.equal(railKindOf({ railway: 'abandoned', abandoned: 'tram' }), null, 'an abandoned tram line: paved over');
  // (a rail trail: the way is a cycleway, a footpath or a track with the old railway left on it)
  for (const highway of ['cycleway', 'footway', 'path', 'track']) {
    assert.equal(railKindOf({ railway: 'abandoned', highway, 'abandoned:railway': 'rail' }), null, highway);
    assert.equal(railKindOf({ railway: 'disused', highway }), null, highway);
  }
  // (a heritage line beside a path keeps its track; a closed tram line in a street keeps its rails in the road)
  assert.equal(railKindOf({ railway: 'preserved', highway: 'footway' }), 'rail');
  assert.equal(railKindOf({ railway: 'disused', highway: 'residential', 'disused:railway': 'tram' }), 'tram');
  assert.equal(railKindOf({ railway: 'rail', highway: 'service' }), 'rail');
});

test('a waterway relation is no feature of its own: its ways are built with their own tags (a stream in a culvert stays one)', () => {
  const features = parseOverpassResponse({ elements: [
    line(11, { waterway: 'stream', name: 'Brook', tunnel: 'culvert', layer: '-1' }, [[0.1, 0.4], [0.5, 0.4]]),
    line(12, { waterway: 'stream', name: 'Brook' }, [[0.5, 0.4], [0.9, 0.4]]),
    { type: 'relation', id: 99, tags: { type: 'waterway', waterway: 'stream', name: 'Brook' }, members: [{ type: 'way', ref: 11, role: '' }, { type: 'way', ref: 12, role: '' }] },
  ] }, bounds);
  const water = features.filter((f) => f.type === 'water');
  assert.ok(!water.some((f) => String(f.id).startsWith('rel_')), 'nothing built from the relation');
  assert.equal(water.length, 2);
  assert.equal(water.find((f) => String(f.id).startsWith('11')).tags.tunnel, 'culvert');
});
