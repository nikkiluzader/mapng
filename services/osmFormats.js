// OSM data in the other common file formats, turned into the Overpass JSON the importer reads (services/osmFile.js):
// .osm.pbf (the binary format of Geofabrik's and BBBike's extracts, and of osmium's output) and GeoJSON (osmtogeojson,
// QGIS, overpass turbo's export). Asked for on Discord (2026-11-20). The result is Overpass JSON text, so the desktop
// app's generator, which is handed the file's text, reads it as it reads any other.
import Pbf from 'pbf';

// ── GeoJSON ─────────────────────────────────────────────────────────────────

const OSM_TYPES = { node: 'node', way: 'way', relation: 'relation', n: 'node', w: 'way', r: 'relation' };

/** A feature's OSM type and id, from "@id"/"id" ("way/123", "w123", 123) when it says one, else null. */
function osmIdOf(props = {}, feature = {}) {
  for (const raw of [props['@id'], props.id, feature.id]) {
    if (raw == null) continue;
    const m = /^(node|way|relation|[nwr])\/?(-?\d+)$/i.exec(String(raw).trim());
    if (m) return { type: OSM_TYPES[m[1].toLowerCase()], id: Number(m[2]) };
  }
  return null;
}

/** A feature's tags: osmtogeojson's properties.tags when there, else its properties (no "@" keys, no id). */
function tagsOf(props = {}) {
  const src = props.tags && typeof props.tags === 'object' ? props.tags : props;
  const tags = {};
  for (const [k, v] of Object.entries(src)) {
    if (k.startsWith('@') || k === 'id' || k === 'tags' || k === 'meta' || k === 'relations' || v == null || typeof v === 'object') continue;
    tags[k] = String(v);
  }
  return tags;
}

const ll = (c) => ({ lat: Number(c[1]), lon: Number(c[0]) });
const okCoord = (c) => Array.isArray(c) && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1]));

/** GeoJSON (a FeatureCollection, a Feature or a bare geometry) -> { elements } as Overpass `out body geom` gives them. */
export function geojsonToOverpass(json) {
  const elements = [];
  let next = -1;   // (ids for features that carry none: negative, as JOSM numbers new objects)
  const feats = json?.type === 'FeatureCollection' ? json.features || []
    : json?.type === 'Feature' ? [json]
      : json?.type ? [{ type: 'Feature', geometry: json, properties: {} }] : [];
  for (const f of feats) {
    const props = f?.properties || {};
    const tags = tagsOf(props);
    if (!Object.keys(tags).length) continue;   // (untagged: nothing MapNG builds)
    const osm = osmIdOf(props, f);
    const idFor = (type) => (osm && osm.type === type ? osm.id : next--);
    const add = (g) => {
      if (!g?.type) return;
      const c = g.coordinates;
      if (g.type === 'Point' && okCoord(c)) elements.push({ type: 'node', id: idFor('node'), ...ll(c), tags });
      else if (g.type === 'MultiPoint') {
        for (const p of c || []) if (okCoord(p)) elements.push({ type: 'node', id: next--, ...ll(p), tags });
      } else if (g.type === 'LineString') {
        const geometry = (c || []).filter(okCoord).map(ll);
        if (geometry.length >= 2) elements.push({ type: 'way', id: idFor('way'), nodes: [], geometry, tags });
      } else if (g.type === 'MultiLineString') {
        for (const line of c || []) {
          const geometry = (line || []).filter(okCoord).map(ll);
          if (geometry.length >= 2) elements.push({ type: 'way', id: next--, nodes: [], geometry, tags });
        }
      } else if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
        const polys = g.type === 'Polygon' ? [c || []] : c || [];
        const rings = [];
        for (const poly of polys) (poly || []).forEach((ring, k) => {
          const geometry = (ring || []).filter(okCoord).map(ll);
          if (geometry.length >= 4) rings.push({ role: k === 0 ? 'outer' : 'inner', geometry });
        });
        if (!rings.length) return;
        if (rings.length === 1) {
          // (one ring: a closed way, as OSM maps a simple area)
          elements.push({ type: 'way', id: idFor('way'), nodes: [], geometry: rings[0].geometry, tags });
        } else {
          elements.push({
            type: 'relation', id: idFor('relation'),
            members: rings.map((r) => ({ type: 'way', ref: next--, role: r.role, geometry: r.geometry })),
            tags: { type: 'multipolygon', ...tags },
          });
        }
      } else if (g.type === 'GeometryCollection') {
        for (const part of g.geometries || []) add(part);
      }
    };
    add(f?.geometry);
  }
  return { elements };
}

/** Whether parsed JSON is GeoJSON rather than Overpass JSON. */
export const isGeojson = (json) => !!json && !Array.isArray(json.elements)
  && ['FeatureCollection', 'Feature', 'Point', 'LineString', 'Polygon', 'MultiPoint', 'MultiLineString', 'MultiPolygon', 'GeometryCollection'].includes(json.type);

// ── .osm.pbf ────────────────────────────────────────────────────────────────
// The format (wiki.openstreetmap.org/wiki/PBF_Format): a run of blocks, each a 4-byte big-endian length, a BlobHeader
// (type "OSMHeader" or "OSMData", the blob's size) and a Blob (its data raw or zlib-compressed). An OSMHeader holds the
// box; an OSMData block is a PrimitiveBlock: a string table, groups of nodes (plain or "dense", delta-coded), ways
// (keys/values as string indexes, node refs delta-coded) and relations, and the coordinate scale (granularity,
// offsets in nanodegrees).

/** Whether these bytes start like an .osm.pbf file (a block header naming OSMHeader). */
export function looksLikePbf(bytes) {
  if (!bytes || bytes.length < 16) return false;
  const len = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
  if (len <= 0 || len > 64 * 1024) return false;
  const head = new TextDecoder('latin1').decode(bytes.subarray(4, Math.min(bytes.length, 4 + len)));
  return head.includes('OSMHeader');
}

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function readBlobHeader(pbf) {
  return pbf.readFields((tag, h, p) => {
    if (tag === 1) h.type = p.readString();
    else if (tag === 3) h.datasize = p.readVarint();
  }, { type: '', datasize: 0 });
}

async function readBlob(bytes) {
  const blob = new Pbf(bytes).readFields((tag, b, p) => {
    if (tag === 1) b.raw = p.readBytes();
    else if (tag === 3) b.zlib = p.readBytes();
    else if (tag === 4 || tag === 6 || tag === 7) b.other = tag;
  }, {});
  if (blob.raw) return blob.raw;
  if (blob.zlib) return inflate(blob.zlib);
  throw new Error('This .pbf file uses a compression MapNG cannot read (only zlib or none).');
}

function readHeaderBlock(bytes) {
  const out = {};
  new Pbf(bytes).readFields((tag, o, p) => {
    if (tag === 1) {
      const bb = p.readFields((t, b, q) => {
        if (t === 1) b.left = q.readSVarint(); else if (t === 2) b.right = q.readSVarint();
        else if (t === 3) b.top = q.readSVarint(); else if (t === 4) b.bottom = q.readSVarint();
      }, {}, p.readVarint() + p.pos);
      o.bbox = bb;
    } else if (tag === 4) (o.required ||= []).push(p.readString());
  }, out);
  return out;
}

const readPacked = (p, fn) => { const end = p.readVarint() + p.pos; const out = []; while (p.pos < end) out.push(fn.call(p)); return out; };

function readPrimitiveBlock(bytes, emit) {
  const block = { strings: [], groups: [], granularity: 100, latOffset: 0, lonOffset: 0 };
  new Pbf(bytes).readFields((tag, b, p) => {
    if (tag === 1) {
      const end = p.readVarint() + p.pos;
      const dec = new TextDecoder();
      while (p.pos < end) {
        const t = p.readVarint();
        if ((t >> 3) === 1) b.strings.push(dec.decode(p.readBytes())); else p.skip(t);
      }
    } else if (tag === 2) b.groups.push(p.readBytes());
    else if (tag === 17) b.granularity = p.readVarint();
    else if (tag === 19) b.latOffset = p.readVarint(true);
    else if (tag === 20) b.lonOffset = p.readVarint(true);
  }, block);
  const S = block.strings;
  const lat = (v) => 1e-9 * (block.latOffset + block.granularity * v);
  const lon = (v) => 1e-9 * (block.lonOffset + block.granularity * v);
  const tagsOfKV = (keys, vals) => {
    if (!keys?.length) return null;
    const t = {}; for (let i = 0; i < keys.length; i++) t[S[keys[i]]] = S[vals[i]]; return t;
  };
  for (const g of block.groups) {
    new Pbf(g).readFields((tag, _, p) => {
      if (tag === 1) {
        const n = p.readFields((t, o, q) => {
          if (t === 1) o.id = q.readSVarint(); else if (t === 2) o.keys = readPacked(q, q.readVarint);
          else if (t === 3) o.vals = readPacked(q, q.readVarint); else if (t === 8) o.lat = q.readSVarint();
          else if (t === 9) o.lon = q.readSVarint();
        }, {}, p.readVarint() + p.pos);
        const tags = tagsOfKV(n.keys, n.vals);
        emit({ type: 'node', id: n.id, lat: lat(n.lat), lon: lon(n.lon), ...(tags ? { tags } : {}) });
      } else if (tag === 2) {
        const d = p.readFields((t, o, q) => {
          if (t === 1) o.ids = readPacked(q, q.readSVarint); else if (t === 8) o.lats = readPacked(q, q.readSVarint);
          else if (t === 9) o.lons = readPacked(q, q.readSVarint); else if (t === 10) o.kv = readPacked(q, q.readVarint);
        }, { ids: [], lats: [], lons: [], kv: [] }, p.readVarint() + p.pos);
        let id = 0; let la = 0; let lo = 0; let k = 0;
        for (let i = 0; i < d.ids.length; i++) {
          id += d.ids[i]; la += d.lats[i]; lo += d.lons[i];
          let tags = null;
          // (keys_vals: key, value, ... and a 0 after each node's tags; empty when no node has any)
          if (d.kv.length) {
            while (k < d.kv.length && d.kv[k] !== 0) { (tags ||= {})[S[d.kv[k]]] = S[d.kv[k + 1]]; k += 2; }
            k++;
          }
          emit({ type: 'node', id, lat: lat(la), lon: lon(lo), ...(tags ? { tags } : {}) });
        }
      } else if (tag === 3) {
        const w = p.readFields((t, o, q) => {
          if (t === 1) o.id = q.readVarint(true); else if (t === 2) o.keys = readPacked(q, q.readVarint);
          else if (t === 3) o.vals = readPacked(q, q.readVarint); else if (t === 8) o.refs = readPacked(q, q.readSVarint);
        }, { refs: [] }, p.readVarint() + p.pos);
        let r = 0; const nodes = w.refs.map((dv) => (r += dv));
        emit({ type: 'way', id: w.id, nodes, tags: tagsOfKV(w.keys, w.vals) || {} });
      } else if (tag === 4) {
        const rel = p.readFields((t, o, q) => {
          if (t === 1) o.id = q.readVarint(true); else if (t === 2) o.keys = readPacked(q, q.readVarint);
          else if (t === 3) o.vals = readPacked(q, q.readVarint); else if (t === 8) o.roles = readPacked(q, q.readVarint);
          else if (t === 9) o.memids = readPacked(q, q.readSVarint); else if (t === 10) o.types = readPacked(q, q.readVarint);
        }, { roles: [], memids: [], types: [] }, p.readVarint() + p.pos);
        let m = 0;
        const members = rel.memids.map((dv, i) => ({ type: ['node', 'way', 'relation'][rel.types[i]] || 'node', ref: (m += dv), role: S[rel.roles[i]] || '' }));
        emit({ type: 'relation', id: rel.id, members, tags: tagsOfKV(rel.keys, rel.vals) || {} });
      }
    });
  }
}

/** An .osm.pbf file's bytes -> { elements, bounds } (Overpass JSON). onProgress(share 0..1) as blocks are read. */
export async function decodeOsmPbf(input, { onProgress } = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!looksLikePbf(bytes)) throw new Error('This is not an .osm.pbf file (it does not start with an OSM header).');
  const elements = [];
  let bounds = null;
  let pos = 0;
  let lastShare = 0;
  while (pos + 4 <= bytes.length) {
    const len = ((bytes[pos] << 24) >>> 0) + (bytes[pos + 1] << 16) + (bytes[pos + 2] << 8) + bytes[pos + 3];
    pos += 4;
    if (pos + len > bytes.length) throw new Error('This .pbf file is cut short.');
    const header = readBlobHeader(new Pbf(bytes.subarray(pos, pos + len)));
    pos += len;
    if (pos + header.datasize > bytes.length) throw new Error('This .pbf file is cut short.');
    const data = await readBlob(bytes.subarray(pos, pos + header.datasize));
    pos += header.datasize;
    if (header.type === 'OSMHeader') {
      const h = readHeaderBlock(data);
      const unsupported = (h.required || []).filter((f) => !['OsmSchema-V0.6', 'DenseNodes'].includes(f));
      if (unsupported.length) throw new Error(`This .pbf file needs features MapNG cannot read: ${unsupported.join(', ')}.`);
      const b = h.bbox;
      if (b && [b.left, b.right, b.top, b.bottom].every(Number.isFinite)) bounds = { minlat: b.bottom * 1e-9, minlon: b.left * 1e-9, maxlat: b.top * 1e-9, maxlon: b.right * 1e-9 };
    } else if (header.type === 'OSMData') {
      readPrimitiveBlock(data, (el) => elements.push(el));
    }
    const share = pos / bytes.length;
    if (onProgress && share - lastShare > 0.02) { lastShare = share; onProgress(share); }
  }
  if (!elements.length) throw new Error('The file holds no map data.');
  return { elements, ...(bounds ? { bounds } : {}) };
}

/**
 * A file the user picked -> its OSM data as text the importer reads: an .osm.pbf decoded to Overpass JSON, anything
 * else (OSM XML, Overpass JSON, GeoJSON) as it is (parseOsmFile reads GeoJSON itself).
 */
export async function osmTextOfFile(file, { onProgress } = {}) {
  const name = String(file?.name || '').toLowerCase();
  const start = new Uint8Array(await file.slice(0, 64 * 1024 + 4).arrayBuffer());
  if (name.endsWith('.pbf') || looksLikePbf(start)) {
    const data = await decodeOsmPbf(await file.arrayBuffer(), { onProgress });
    return JSON.stringify(data);
  }
  return file.text();
}
