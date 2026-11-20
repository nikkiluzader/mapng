// services/osmFormats.js: .osm.pbf and GeoJSON files read into the Overpass JSON the OSM file import takes.
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import Pbf from 'pbf';
import { decodeOsmPbf, looksLikePbf, geojsonToOverpass, isGeojson, osmTextOfFile } from '../services/osmFormats.js';
import { parseOsmFile } from '../services/osmFile.js';

// ── a small .osm.pbf built here, as osmium writes one (zlib blocks, dense nodes) ──
const packedSVarints = (pbf, tag, arr) => pbf.writePackedSVarint(tag, arr);
function block(type, payload, { compress = true } = {}) {
  const blob = new Pbf();
  if (compress) { blob.writeVarintField(2, payload.length); blob.writeBytesField(3, zlib.deflateSync(payload)); } else blob.writeBytesField(1, payload);
  const blobBytes = blob.finish();
  const head = new Pbf(); head.writeStringField(1, type); head.writeVarintField(3, blobBytes.length);
  const headBytes = head.finish();
  const len = Buffer.alloc(4); len.writeUInt32BE(headBytes.length);
  return Buffer.concat([len, Buffer.from(headBytes), Buffer.from(blobBytes)]);
}
function samplePbf() {
  const header = new Pbf();
  header.writeMessage(1, (_, p) => { p.writeSVarintField(1, 7000000000); p.writeSVarintField(2, 7010000000); p.writeSVarintField(3, 45010000000); p.writeSVarintField(4, 45000000000); });
  header.writeStringField(4, 'OsmSchema-V0.6'); header.writeStringField(4, 'DenseNodes');
  // strings: 0 is always ""
  const S = ['', 'highway', 'residential', 'name', 'Rue A', 'amenity', 'bench', 'type', 'multipolygon', 'building', 'yes', 'outer'];
  const pb = new Pbf();
  pb.writeMessage(1, (_, p) => { for (const s of S) p.writeBytesField(1, Buffer.from(s)); });
  pb.writeMessage(2, (_, p) => {
    // dense: ids 1,2,3 (delta), lat/lon in units of 100 nanodegrees (granularity 100), node 2 a bench
    p.writeMessage(2, (__, q) => {
      packedSVarints(q, 1, [1, 1, 1]);
      packedSVarints(q, 8, [450010000, 10000, 10000]);
      packedSVarints(q, 9, [70010000, 10000, 10000]);
      q.writePackedVarint(10, [0, 5, 6, 0, 0]);
    });
  });
  pb.writeMessage(2, (_, p) => {
    p.writeMessage(3, (__, q) => { q.writeVarintField(1, 10); q.writePackedVarint(2, [1, 3]); q.writePackedVarint(3, [2, 4]); q.writePackedSVarint(8, [1, 1, 1]); });
    p.writeMessage(4, (__, q) => { q.writeVarintField(1, 20); q.writePackedVarint(2, [7, 9]); q.writePackedVarint(3, [8, 10]); q.writePackedVarint(8, [11]); q.writePackedSVarint(9, [10]); q.writePackedVarint(10, [1]); });
  });
  return Buffer.concat([block('OSMHeader', header.finish(), { compress: false }), block('OSMData', pb.finish())]);
}

test('an .osm.pbf extract decodes to Overpass elements: dense nodes with tags, ways, relations, the box', async () => {
  const bytes = samplePbf();
  assert.ok(looksLikePbf(bytes));
  assert.ok(!looksLikePbf(Buffer.from('<?xml version="1.0"?><osm></osm>')));
  const { elements, bounds } = await decodeOsmPbf(bytes);
  const nodes = elements.filter((e) => e.type === 'node');
  assert.deepEqual(nodes.map((n) => n.id), [1, 2, 3]);
  assert.ok(Math.abs(nodes[1].lat - 45.002) < 1e-9 && Math.abs(nodes[1].lon - 7.002) < 1e-9);
  assert.deepEqual(nodes[1].tags, { amenity: 'bench' });
  assert.equal(nodes[0].tags, undefined);
  const way = elements.find((e) => e.type === 'way');
  assert.deepEqual(way, { type: 'way', id: 10, nodes: [1, 2, 3], tags: { highway: 'residential', name: 'Rue A' } });
  const rel = elements.find((e) => e.type === 'relation');
  assert.deepEqual(rel.members, [{ type: 'way', ref: 10, role: 'outer' }]);
  assert.deepEqual(rel.tags, { type: 'multipolygon', building: 'yes' });
  assert.ok(Math.abs(bounds.minlat - 45) < 1e-9 && Math.abs(bounds.maxlon - 7.01) < 1e-9);
  // and through the import: the way gets its geometry from the nodes
  const parsed = parseOsmFile(JSON.stringify({ elements, bounds }));
  const w = parsed.data.elements.find((e) => e.type === 'way');
  assert.equal(w.geometry.length, 3);
  assert.equal(parsed.counts.nodes, 3);
});

test('a picked .pbf file becomes Overpass JSON text; other files stay text', async () => {
  const fileOf = (bytes, name) => ({ name, slice: (a, b) => ({ arrayBuffer: async () => bytes.subarray(a, b) }), arrayBuffer: async () => bytes, text: async () => Buffer.from(bytes).toString('utf8') });
  const text = await osmTextOfFile(fileOf(samplePbf(), 'alps-latest.osm.pbf'));
  assert.equal(JSON.parse(text).elements.length, 5);
  const xml = '<?xml version="1.0"?><osm version="0.6"></osm>';
  assert.equal(await osmTextOfFile(fileOf(Buffer.from(xml), 'map.osm')), xml);
});

test('GeoJSON features become nodes, ways and multipolygons with their properties as tags', () => {
  const fc = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { '@id': 'node/5', amenity: 'bench' }, geometry: { type: 'Point', coordinates: [7.1, 45.1] } },
      { type: 'Feature', id: 'way/77', properties: { tags: { highway: 'service' }, meta: {} }, geometry: { type: 'LineString', coordinates: [[7, 45], [7.001, 45.001]] } },
      { type: 'Feature', properties: { building: 'yes', 'building:levels': 3 }, geometry: { type: 'Polygon', coordinates: [[[7, 45], [7.001, 45], [7.001, 45.001], [7, 45]]] } },
      { type: 'Feature', properties: { landuse: 'grass' }, geometry: { type: 'Polygon', coordinates: [[[7, 45], [7.01, 45], [7.01, 45.01], [7, 45]], [[7.002, 45.002], [7.003, 45.002], [7.003, 45.003], [7.002, 45.002]]] } },
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [7, 45] } },
    ],
  };
  assert.ok(isGeojson(fc)); assert.ok(!isGeojson({ elements: [] }));
  const { elements } = geojsonToOverpass(fc);
  assert.deepEqual(elements[0], { type: 'node', id: 5, lat: 45.1, lon: 7.1, tags: { amenity: 'bench' } });
  assert.equal(elements[1].id, 77); assert.deepEqual(elements[1].tags, { highway: 'service' }); assert.equal(elements[1].geometry.length, 2);
  assert.equal(elements[2].type, 'way'); assert.deepEqual(elements[2].tags, { building: 'yes', 'building:levels': '3' });
  assert.equal(elements[3].type, 'relation'); assert.equal(elements[3].tags.type, 'multipolygon');
  assert.deepEqual(elements[3].members.map((m) => m.role), ['outer', 'inner']);
  assert.equal(elements.length, 4, 'the untagged feature is left out');
  // and through the import, as text
  const parsed = parseOsmFile(JSON.stringify(fc));
  assert.equal(parsed.counts.ways, 2);
  assert.ok(parsed.bounds.south <= 45 && parsed.bounds.north >= 45.1);
});
