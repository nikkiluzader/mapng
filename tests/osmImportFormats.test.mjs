// The OSM file import's formats (SPLATPLAYS's list, Discord 2026-11-21): compressed files (.gz, .bz2, .xz, made by
// the real gzip/bzip2/xz tools), .o5m, .osh history and Shapefiles, each read through the importer's own path and
// compared with the plain .osm; the change files and OsmAnd/vector-tile files refused with their reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from 'jszip';
import { decompress, compressionOf } from '../services/osmDecompress.js';
import { decodeO5m, o5mKind } from '../services/osmO5m.js';
import { shapefilesToGeojson } from '../services/osmShapefile.js';
import { osmTextOfBytes } from '../services/osmFormats.js';
import { parseOsmFile } from '../services/osmFile.js';

const F = new URL('./fixtures/osm-formats/', import.meta.url);
const bytes = (name) => new Uint8Array(fs.readFileSync(new URL(name, F)));
const read = async (name, b = bytes(name)) => parseOsmFile(await osmTextOfBytes(b, name));
const ways = (r) => new Map(r.data.elements.filter((e) => e.type === 'way').map((w) => [w.id, w]));
const plain = () => parseOsmFile(fs.readFileSync(new URL('small.osm', F), 'utf8'));

test('compressed .osm (gzip, bzip2, xz single and multi-block, CRC32, two bzip2 streams) reads as the plain file', async () => {
  const want = fs.readFileSync(new URL('small.osm', F));
  for (const f of ['small.osm.gz', 'small.osm.bz2', 'small.osm.xz', 'small.osm.blocks.xz', 'small.osm.crc32.xz']) {
    const out = await decompress(bytes(f));
    assert.equal(Buffer.compare(Buffer.from(out), want), 0, `${f} (${compressionOf(bytes(f))}) decodes byte for byte`);
  }
  const twice = await decompress(bytes('twice.osm.bz2'));
  assert.equal(Buffer.compare(Buffer.from(twice), Buffer.concat([want, want])), 0, 'two bzip2 streams back to back');
  const p = plain(); const x = await read('small.osm.xz');
  assert.deepEqual(x.counts, p.counts);
});

test('a damaged compressed file is refused, not read wrong', async () => {
  for (const f of ['small.osm.bz2', 'small.osm.xz']) {
    const b = bytes(f); b[Math.floor(b.length / 2)] ^= 0x20;
    await assert.rejects(() => decompress(b), /damaged|cut short/);
  }
});

test('.o5m: the same ways, tags and node lists as the .osm, a relation with its members and roles, points within 2 cm', async () => {
  assert.equal(o5mKind(bytes('small.o5m')), 'o5m');
  const a = ways(plain()); const r = await read('small.o5m'); const b = ways(r);
  assert.equal(b.size, a.size);
  for (const [id, w] of a) {
    const v = b.get(id);
    assert.deepEqual(v.tags, w.tags, `way ${id} tags`);
    assert.deepEqual(v.nodes, w.nodes, `way ${id} nodes`);
    w.geometry.forEach((p, i) => assert.ok(Math.hypot((p.lat - v.geometry[i].lat) * 111320, (p.lon - v.geometry[i].lon) * 64000) < 0.02));
  }
  const rel = r.data.elements.find((e) => e.type === 'relation');
  assert.equal(rel.tags.name, 'Test – žolė');
  assert.deepEqual(rel.members.map((m) => [m.type, m.role]), [['way', 'outer'], ['way', 'inner'], ['node', '']]);
  // (inside an .xz too)
  const { execFileSync } = await import('node:child_process');
  let xz = null; try { xz = execFileSync('xz', ['-c'], { input: Buffer.from(bytes('small.o5m')) }); } catch { /* no xz here */ }
  if (xz) assert.deepEqual((await read('small.o5m.xz', new Uint8Array(xz))).counts, r.counts);
});

test('.o5m: the string table refers back, a reset clears it, and a change file (.o5c) is refused', () => {
  const b = bytes('small.o5m');
  const r = decodeO5m(b);
  assert.ok(r.elements.length > 100 && r.bounds.minlat > 54);
  const c = b.slice(); c[5] = 0x63;   // 'o5m2' -> 'o5c2' (bytes 3..6 of the header)
  assert.equal(o5mKind(c), 'o5c');
  assert.throws(() => decodeO5m(c), /change file/);
});

test('.osh history: the newest version of each object stands, a deleted one is gone', async () => {
  const r = await read('small.osh'); const w = ways(r); const p = ways(plain());
  assert.equal(w.size, p.size - 1);
  assert.ok(![...w.values()].some((x) => x.tags?.highway === 'OLD_VERSION'), 'no old version left');
  assert.ok(!w.has(60852898), 'the deleted way is gone');
});

test('change files and OsmAnd / vector-tile files are refused with their reason', async () => {
  await assert.rejects(() => read('x.osc', new TextEncoder().encode('<?xml version="1.0"?><osmChange version="0.6"><create/></osmChange>')), /change file/);
  await assert.rejects(() => osmTextOfBytes(new Uint8Array([0x08, 0x01, 0x12, 0x00]), 'map.obf'), /OsmAnd/);
  await assert.rejects(() => osmTextOfBytes(new Uint8Array([0x1a, 0x05, 0x0a, 0x03, 0x72, 0x6f, 0x61]), 'tile.pbf'), /not an OpenStreetMap extract/);
});

// ── Shapefiles, written here: a minimal .shp/.dbf/.prj writer for the cases that matter ──
function shp(type, geoms) {
  const recs = geoms.map((g, i) => {
    let body;
    if (type === 1) { body = Buffer.alloc(20); body.writeInt32LE(1, 0); body.writeDoubleLE(g[0], 4); body.writeDoubleLE(g[1], 12); } else {
      const parts = g; const pts = parts.flat(); body = Buffer.alloc(44 + parts.length * 4 + pts.length * 16);
      body.writeInt32LE(type, 0); body.writeInt32LE(parts.length, 36); body.writeInt32LE(pts.length, 40);
      let k = 0; parts.forEach((p, j) => { body.writeInt32LE(k, 44 + j * 4); k += p.length; });
      pts.forEach((p, j) => { body.writeDoubleLE(p[0], 44 + parts.length * 4 + j * 16); body.writeDoubleLE(p[1], 52 + parts.length * 4 + j * 16); });
    }
    const head = Buffer.alloc(8); head.writeInt32BE(i + 1, 0); head.writeInt32BE(body.length / 2, 4);
    return Buffer.concat([head, body]);
  });
  const h = Buffer.alloc(100); h.writeInt32BE(9994, 0); h.writeInt32BE((100 + recs.reduce((n, r) => n + r.length, 0)) / 2, 24); h.writeInt32LE(1000, 28); h.writeInt32LE(type, 32);
  return new Uint8Array(Buffer.concat([h, ...recs]));
}
function dbf(cols, rows) {
  const lens = cols.map((c) => Math.max(c.length, ...rows.map((r) => Buffer.byteLength(String(r[c] ?? ''))), 1));
  const recLen = 1 + lens.reduce((a, b) => a + b, 0); const headLen = 32 + cols.length * 32 + 1;
  const h = Buffer.alloc(headLen); h[0] = 3; h.writeUInt32LE(rows.length, 4); h.writeUInt16LE(headLen, 8); h.writeUInt16LE(recLen, 10);
  cols.forEach((c, i) => { h.write(c, 32 + i * 32, 'latin1'); h[32 + i * 32 + 11] = 0x43; h[32 + i * 32 + 16] = lens[i]; });
  h[headLen - 1] = 0x0d;
  const body = rows.map((r) => { const b = Buffer.alloc(recLen, 0x20); let p = 1; cols.forEach((c, i) => { b.write(String(r[c] ?? ''), p, 'utf8'); p += lens[i]; }); return b; });
  return new Uint8Array(Buffer.concat([h, ...body]));
}
const WGS84 = new TextEncoder().encode('GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]]');

test('Shapefiles in Geofabrik\'s layout: roads, a railway bridge and a building with a hole read as OSM tags', async () => {
  const files = {
    'gis_osm_roads_free_1.shp': shp(3, [[[[7.42, 43.73], [7.421, 43.731], [7.422, 43.731]]], [[[7.42, 43.74], [7.43, 43.74]]]]),
    'gis_osm_roads_free_1.dbf': dbf(['osm_id', 'fclass', 'name', 'oneway', 'maxspeed', 'layer', 'bridge', 'tunnel'], [
      { osm_id: '4097656', fclass: 'secondary', name: 'Avenue Princesse Alice', oneway: 'F', maxspeed: '30', layer: '0', bridge: 'F', tunnel: 'F' },
      { osm_id: '22', fclass: 'track_grade2', oneway: 'B', maxspeed: '0', layer: '1', bridge: 'T', tunnel: 'F' }]),
    'gis_osm_roads_free_1.prj': WGS84,
    'gis_osm_buildings_a_free_1.shp': shp(5, [[[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]].map(([x, y]) => [7.4 + x * 1e-5, 43.7 + y * 1e-5]), [[3, 3], [6, 3], [6, 6], [3, 6], [3, 3]].map(([x, y]) => [7.4 + x * 1e-5, 43.7 + y * 1e-5])]]),
    'gis_osm_buildings_a_free_1.dbf': dbf(['osm_id', 'fclass', 'name', 'type'], [{ osm_id: '5', fclass: 'building', name: 'Musée', type: 'public' }]),
    'gis_osm_places_free_1.shp': shp(1, [[7.4, 43.7]]),
    'gis_osm_places_free_1.dbf': dbf(['osm_id', 'fclass', 'name'], [{ osm_id: '9', fclass: 'city', name: 'Monaco' }]),
  };
  const g = shapefilesToGeojson(files);
  assert.equal(g.layout, 'geofabrik');
  const road = g.features.find((f) => f.properties.name === 'Avenue Princesse Alice');
  assert.deepEqual({ ...road.properties }, { name: 'Avenue Princesse Alice', highway: 'secondary', oneway: 'yes', maxspeed: '30', '@id': 'way/4097656' });
  const track = g.features.find((f) => f.properties.highway === 'track');
  assert.deepEqual([track.properties.tracktype, track.properties.bridge, track.properties.layer, track.properties.oneway], ['grade2', 'yes', '1', undefined]);
  const b = g.features.find((f) => f.properties.building);
  assert.equal(b.properties.building, 'public');
  assert.equal(b.geometry.type, 'Polygon'); assert.equal(b.geometry.coordinates.length, 2, 'the hole is kept as an inner ring');
  assert.ok(!g.features.some((f) => f.properties.name === 'Monaco'), 'place names are not built');
});

test('Shapefiles from ogr2ogr (OSM keys as columns, other_tags) in a projected system read in degrees', async () => {
  // (UTM zone 32N: 7.42 E 43.73 N is about x 372 900, y 4 843 100)
  const utm = new TextEncoder().encode('PROJCS["WGS_1984_UTM_Zone_32N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",9.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]');
  const files = {
    'lines.shp': shp(3, [[[[372900, 4843100], [373000, 4843150]]]]),
    'lines.dbf': dbf(['osm_id', 'name', 'highway', 'waterway', 'z_order', 'other_tags'], [{ osm_id: '77', name: 'Rue', highway: 'residential', z_order: '3', other_tags: '"lanes"=>"2","surface"=>"asphalt"' }]),
    'lines.prj': utm,
    'other.shp': shp(1, [[372900, 4843100]]),
    'other.dbf': dbf(['kind'], [{ kind: 'x' }]),
    'other.prj': utm,
  };
  const g = shapefilesToGeojson(files);
  assert.equal(g.layout, 'osm-columns');
  assert.equal(g.features.length, 1, 'a layer whose columns are not OSM keys is left out');
  const f = g.features[0];
  assert.deepEqual([f.properties.highway, f.properties.lanes, f.properties.surface, f.properties.z_order], ['residential', '2', 'asphalt', undefined]);
  const [lon, lat] = f.geometry.coordinates[0];
  assert.ok(Math.abs(lon - 7.42) < 0.01 && Math.abs(lat - 43.73) < 0.01, `reprojected to ${lon}, ${lat}`);
});

test('a Shapefile zip goes through the importer to OSM ways', async () => {
  const zip = new JSZip();
  zip.file('gis_osm_roads_free_1.shp', shp(3, [[[[7.42, 43.73], [7.421, 43.731]]]]));
  zip.file('gis_osm_roads_free_1.dbf', dbf(['osm_id', 'fclass', 'name'], [{ osm_id: '1', fclass: 'residential', name: 'Rue' }]));
  const b = await zip.generateAsync({ type: 'uint8array' });
  const r = await read('monaco.zip', b);
  const w = [...ways(r).values()];
  assert.equal(w.length, 1); assert.equal(w[0].tags.highway, 'residential');
});
