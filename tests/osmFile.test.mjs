import test from 'node:test';
import assert from 'node:assert/strict';

import { parseOsmFile, osmFileCoverage, osmExportUrl, loadOsmFileText, clearOsmFile, getLoadedOsmFile } from '../services/osmFile.js';
import { parseOverpassResponse } from '../services/osm.js';

// (as openstreetmap.org's Export gives it: double quotes, a <bounds>, untagged way nodes)
const OSM_ORG = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="openstreetmap-cgimap" copyright="OpenStreetMap and contributors">
 <bounds minlat="46.0000000" minlon="7.0000000" maxlat="46.0100000" maxlon="7.0100000"/>
 <node id="1" visible="true" version="2" lat="46.0010000" lon="7.0010000"/>
 <node id="2" visible="true" version="2" lat="46.0020000" lon="7.0090000"/>
 <node id="3" visible="true" version="1" lat="46.0050000" lon="7.0050000">
  <tag k="amenity" v="bench"/>
 </node>
 <node id="4" lat="46.0060000" lon="7.0060000"/>
 <node id="5" lat="46.0060000" lon="7.0070000"/>
 <node id="6" lat="46.0070000" lon="7.0070000"/>
 <node id="7" lat="46.0070000" lon="7.0060000"/>
 <way id="10" visible="true" version="3">
  <nd ref="1"/>
  <nd ref="2"/>
  <tag k="highway" v="residential"/>
  <tag k="name" v="Rue de l&apos;Église &amp; Co"/>
 </way>
 <way id="11">
  <nd ref="4"/><nd ref="5"/><nd ref="6"/><nd ref="7"/><nd ref="4"/>
 </way>
 <relation id="20">
  <member type="way" ref="11" role="outer"/>
  <member type="node" ref="3" role=""/>
  <tag k="type" v="multipolygon"/>
  <tag k="building" v="yes"/>
 </relation>
</osm>`;

test('openstreetmap.org export: ways and relation members get geometry, tags decoded', () => {
  const { data, bounds, counts } = parseOsmFile(OSM_ORG);
  assert.deepEqual(bounds, { south: 46, west: 7, north: 46.01, east: 7.01 });
  assert.deepEqual(counts, { nodes: 7, ways: 2, relations: 1 });
  const road = data.elements.find((e) => e.type === 'way' && e.id === 10);
  assert.equal(road.tags.name, "Rue de l'Église & Co");
  assert.deepEqual(road.geometry, [{ lat: 46.001, lon: 7.001 }, { lat: 46.002, lon: 7.009 }]);
  // (untagged nodes stay out of the elements; the tagged bench is in)
  assert.equal(data.elements.filter((e) => e.type === 'node').length, 1);
  const rel = data.elements.find((e) => e.type === 'relation');
  assert.equal(rel.members[0].geometry.length, 5);
  assert.equal(rel.members[1].lat, 46.005);
});

test('the parsed file goes through the Overpass parser like an Overpass answer', () => {
  const { data, bounds } = parseOsmFile(OSM_ORG);
  const features = parseOverpassResponse(data, bounds);
  assert.ok(features.some((f) => f.tags?.highway === 'residential'), 'road');
  assert.ok(features.some((f) => f.tags?.building === 'yes'), 'multipolygon building');
});

test('JOSM file: single quotes, deleted elements skipped, bounds from the nodes', () => {
  const josm = `<?xml version='1.0' encoding='UTF-8'?>
<osm version='0.6' upload='false' generator='JOSM'>
  <node id='-1' action='modify' lat='10.5' lon='20.5' />
  <node id='-2' action='modify' lat='10.6' lon='20.7' />
  <node id='-3' action='delete' lat='50' lon='50' />
  <way id='-5' action='modify'>
    <nd ref='-1' /><nd ref='-2' />
    <tag k='highway' v='track' />
  </way>
  <way id='-6' action='delete'><nd ref='-1' /><nd ref='-2' /><tag k='highway' v='primary' /></way>
</osm>`;
  const { data, bounds } = parseOsmFile(josm);
  assert.deepEqual(bounds, { south: 10.5, west: 20.5, north: 10.6, east: 20.7 });
  const ways = data.elements.filter((e) => e.type === 'way');
  assert.equal(ways.length, 1);
  assert.equal(ways[0].tags.highway, 'track');
});

test('Overpass JSON, both with geometry and with node lists', () => {
  const skel = { elements: [
    { type: 'node', id: 1, lat: 1, lon: 1 }, { type: 'node', id: 2, lat: 1.1, lon: 1.2 },
    { type: 'way', id: 3, nodes: [1, 2], tags: { waterway: 'stream' } },
  ] };
  const a = parseOsmFile(JSON.stringify(skel));
  assert.deepEqual(a.data.elements[0].geometry, [{ lat: 1, lon: 1 }, { lat: 1.1, lon: 1.2 }]);
  const geom = { elements: [{ type: 'way', id: 3, geometry: [{ lat: 2, lon: 2 }, { lat: 2.5, lon: 2.5 }], tags: { highway: 'path' } }] };
  const b = parseOsmFile(JSON.stringify(geom));
  assert.deepEqual(b.bounds, { south: 2, west: 2, north: 2.5, east: 2.5 });
});

test('not OSM data: a clear error', () => {
  assert.throws(() => parseOsmFile('hello'), /Not an OpenStreetMap file/);
  assert.throws(() => parseOsmFile('<gpx></gpx>'), /not OpenStreetMap data/);
  assert.throws(() => parseOsmFile('{"type":"FeatureCollection"}'), /not OpenStreetMap data/);
  assert.throws(() => parseOsmFile('<osm version="0.6"></osm>'), /no map data/);
});

test('coverage of the area by the file', () => {
  const file = { south: 0, west: 0, north: 1, east: 1 };
  assert.equal(osmFileCoverage(file, { south: 0.2, west: 0.2, north: 0.8, east: 0.8 }).coverage, 'full');
  const half = osmFileCoverage(file, { south: 0.5, west: 0.5, north: 1.5, east: 1.0 });
  assert.equal(half.coverage, 'partial');
  assert.ok(Math.abs(half.share - 0.5) < 1e-9);
  assert.equal(osmFileCoverage(file, { south: 2, west: 2, north: 3, east: 3 }).coverage, 'none');
});

test('export link: the area plus a small margin, west,south,east,north', () => {
  const url = osmExportUrl({ south: 46, west: 7, north: 46.01, east: 7.01 }, 0);
  assert.equal(url, 'https://api.openstreetmap.org/api/0.6/map?bbox=7.000000,46.000000,7.010000,46.010000');
});

test('loading and clearing the file', () => {
  loadOsmFileText(OSM_ORG, 'map.osm');
  assert.equal(getLoadedOsmFile().name, 'map.osm');
  clearOsmFile();
  assert.equal(getLoadedOsmFile(), null);
});

test('fetchOSMData reads a loaded file and fetches nothing', async () => {
  const { fetchOSMData, getLastOSMRequestInfo } = await import('../services/osm.js');
  const realFetch = globalThis.fetch;
  const realStorage = globalThis.localStorage;
  let fetched = 0;
  globalThis.fetch = async () => { fetched++; throw new Error('offline'); };
  globalThis.localStorage = { getItem: (k) => (k === 'mapng_overtureBuildings' ? 'false' : null), setItem() {}, removeItem() {} };
  try {
    loadOsmFileText(OSM_ORG, 'mytown.osm');
    const features = await fetchOSMData({ south: 46.001, west: 7.001, north: 46.009, east: 7.009 });
    assert.equal(fetched, 0);
    assert.ok(features.some((f) => f.tags?.highway === 'residential'));
    assert.equal(getLastOSMRequestInfo().endpointUsed, 'osm-file');
    assert.equal(getLastOSMRequestInfo().osmFile.name, 'mytown.osm');
  } finally {
    clearOsmFile();
    globalThis.fetch = realFetch;
    globalThis.localStorage = realStorage;
  }
});
