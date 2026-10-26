/**
 * Last-resort OSM source: Overture Maps' own vector tiles.
 *
 * Used by services/osm.js only when MapNG's tiles don't cover the area and
 * every Overpass server (custom, cache, public mirrors) has failed. Overture
 * publishes one PMTiles archive per theme on its own CDN (CORS *, range
 * requests), so the browser reads it like MapNG's R2 tiles — no server of
 * ours involved, and an Overpass outage doesn't touch it.
 *
 * fetchOsmFromOverture() turns the tiles covering a bbox into the same
 * Overpass-shaped {elements} parseOverpassResponse reads:
 *   - base (land, land_use, water, infrastructure) keeps the original OSM tags
 *     in `source_tags`; those pass through, filtered by OSM_FILTER so the
 *     fallback holds exactly what the live query would ask for;
 *   - buildings and road segments carry Overture's own schema, mapped to the
 *     OSM tags the export reads (building/height/building:levels/roof:*,
 *     highway/surface/maxspeed/oneway/bridge/tunnel/layer/width/name);
 *   - places adds fuel and charging stations.
 * Vector tiles cut features at tile edges (plus a buffer). A feature drawn
 * whole inside one tile's buffer is taken as is; anything bigger is clipped
 * to each exact tile square and the pieces rejoined by their Overture id.
 *
 * Lanes, traffic calming, street lamps on roads etc. come only from what
 * Overture keeps, so a fallback export is a little plainer than a normal one.
 */
import { PMTiles } from 'pmtiles';
import { OSM_FILTER } from './overpassQuery.js';

// Pinned release; bump with Overture's monthly releases (tiles.overturemaps.org/<release>/).
export const OVERTURE_RELEASE = '2026-10-21.0';
const TILE_ROOT = `https://tiles.overturemaps.org/${OVERTURE_RELEASE}`;
export const OVERTURE_ATTRIBUTION = '© OpenStreetMap contributors, Overture Maps Foundation (overturemaps.org)';
const THEMES = ['base', 'buildings', 'transportation', 'places'];
const MAX_IN_FLIGHT = 6;

const archives = new Map();
let archiveFactory = (theme) => new PMTiles(`${TILE_ROOT}/${theme}.pmtiles`);
/** Tests: replace how a theme's archive is opened (null restores the default). */
export const setOvertureArchiveFactory = (factory) => {
  archives.clear();
  archiveFactory = factory || ((theme) => new PMTiles(`${TILE_ROOT}/${theme}.pmtiles`));
};
const archiveFor = (theme) => {
  if (!archives.has(theme)) archives.set(theme, archiveFactory(theme));
  return archives.get(theme);
};

// ── Mapbox Vector Tile decoding (spec v2.1) ─────────────────────────────────

class Reader {
  constructor(buf) { this.buf = buf; this.pos = 0; this.end = buf.length; }
  varint() {
    let result = 0;
    let shift = 0;
    let b;
    do {
      b = this.buf[this.pos++];
      result += (b & 0x7f) * 2 ** shift;   // no bit ops: values can pass 2^31
      shift += 7;
    } while (b & 0x80);
    return result;
  }
  svarint() { const n = this.varint(); return n % 2 === 1 ? -(n + 1) / 2 : n / 2; }
  bytes() { const len = this.varint(); const out = this.buf.subarray(this.pos, this.pos + len); this.pos += len; return out; }
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.pos += this.varint();
    else if (wire === 5) this.pos += 4;
    else throw new Error(`MVT: unknown wire type ${wire}`);
  }
  // Calls fn(field, wire) per field; fn must consume the value or return false.
  fields(fn) {
    while (this.pos < this.end) {
      const key = this.varint();
      const field = Math.floor(key / 8);
      const wire = key & 7;
      if (fn(field, wire) === false) this.skip(wire);
    }
  }
}

const utf8 = new TextDecoder();
const sub = (r) => { const b = r.bytes(); return new Reader(b); };
const packed = (r) => { const s = sub(r); const out = []; while (s.pos < s.end) out.push(s.varint()); return out; };

const readValue = (r) => {
  let v = null;
  r.fields((f, w) => {
    if (f === 1) v = utf8.decode(r.bytes());
    else if (f === 2) { v = new DataView(r.buf.buffer, r.buf.byteOffset + r.pos, 4).getFloat32(0, true); r.pos += 4; }
    else if (f === 3) { v = new DataView(r.buf.buffer, r.buf.byteOffset + r.pos, 8).getFloat64(0, true); r.pos += 8; }
    else if (f === 4 || f === 5) v = r.varint();
    else if (f === 6) v = r.svarint();
    else if (f === 7) v = r.varint() !== 0;
    else return false;
    return true;
  });
  return v;
};

// Geometry commands -> arrays of [x, y] parts (points: one part of points).
const readGeometry = (cmds) => {
  const parts = [];
  let part = null;
  let x = 0;
  let y = 0;
  let i = 0;
  while (i < cmds.length) {
    const cmd = cmds[i] & 7;
    const count = Math.floor(cmds[i] / 8);
    i++;
    if (cmd === 7) {
      if (part && part.length) part.push([part[0][0], part[0][1]]);
      continue;
    }
    for (let k = 0; k < count; k++) {
      const dx = cmds[i++];
      const dy = cmds[i++];
      x += dx % 2 === 1 ? -(dx + 1) / 2 : dx / 2;
      y += dy % 2 === 1 ? -(dy + 1) / 2 : dy / 2;
      if (cmd === 1) { part = [[x, y]]; parts.push(part); } else part.push([x, y]);
    }
  }
  return parts;
};

/** {layerName: {extent, features: [{type, props, parts}]}} from MVT bytes. */
export const decodeMvt = (bytes) => {
  const r = new Reader(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const layers = {};
  r.fields((f) => {
    if (f !== 3) return false;
    const lr = sub(r);
    const layer = { name: '', extent: 4096, keys: [], values: [], raw: [] };
    lr.fields((lf) => {
      if (lf === 1) layer.name = utf8.decode(lr.bytes());
      else if (lf === 2) layer.raw.push(lr.bytes());
      else if (lf === 3) layer.keys.push(utf8.decode(lr.bytes()));
      else if (lf === 4) layer.values.push(readValue(sub(lr)));
      else if (lf === 5) layer.extent = lr.varint();
      else return false;
      return true;
    });
    const features = layer.raw.map((buf) => {
      const fr = new Reader(buf);
      const feat = { type: 0, props: {}, parts: [] };
      let tags = [];
      let geom = [];
      fr.fields((ff) => {
        if (ff === 2) tags = packed(fr);
        else if (ff === 3) feat.type = fr.varint();
        else if (ff === 4) geom = packed(fr);
        else return false;
        return true;
      });
      for (let t = 0; t + 1 < tags.length; t += 2) feat.props[layer.keys[tags[t]]] = layer.values[tags[t + 1]];
      feat.parts = readGeometry(geom);
      return feat;
    });
    layers[layer.name] = { extent: layer.extent, features };
    return true;
  });
  return layers;
};

// ── Geometry helpers (tile pixel space) ─────────────────────────────────────

const ringArea = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
};

// MVT v2: exterior rings have positive area in tile (y-down) space.
const polygonsFromRings = (parts) => {
  const polys = [];
  for (const ring of parts) {
    if (ring.length < 4) continue;
    const a = ringArea(ring);
    if (a > 0 || !polys.length) polys.push([ring]);
    else if (a < 0) polys[polys.length - 1].push(ring);
  }
  return polys;
};

const clipRingToSquare = (ring, size) => {
  let out = ring.slice(0, ring.length - 1);
  const edges = [
    (p) => p[0] >= 0, (p) => p[0] <= size, (p) => p[1] >= 0, (p) => p[1] <= size,
  ];
  const cut = [
    (a, b) => [0, a[1] + (b[1] - a[1]) * (0 - a[0]) / (b[0] - a[0])],
    (a, b) => [size, a[1] + (b[1] - a[1]) * (size - a[0]) / (b[0] - a[0])],
    (a, b) => [a[0] + (b[0] - a[0]) * (0 - a[1]) / (b[1] - a[1]), 0],
    (a, b) => [a[0] + (b[0] - a[0]) * (size - a[1]) / (b[1] - a[1]), size],
  ];
  for (let e = 0; e < 4 && out.length; e++) {
    const input = out;
    out = [];
    let prev = input[input.length - 1];
    for (const cur of input) {
      const cin = edges[e](cur);
      const pin = edges[e](prev);
      if (cin) { if (!pin) out.push(cut[e](prev, cur)); out.push(cur); } else if (pin) out.push(cut[e](prev, cur));
      prev = cur;
    }
  }
  if (out.length < 3) return null;
  out.push([out[0][0], out[0][1]]);
  return out;
};

// Liang–Barsky per segment; consecutive inside runs become pieces.
const clipLineToSquare = (line, size) => {
  const pieces = [];
  let current = null;
  for (let i = 0; i + 1 < line.length; i++) {
    const [x0, y0] = line[i];
    const [x1, y1] = line[i + 1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    let t0 = 0;
    let t1 = 1;
    let ok = true;
    for (const [p, q] of [[-dx, x0], [dx, size - x0], [-dy, y0], [dy, size - y0]]) {
      if (p === 0) { if (q < 0) { ok = false; break; } continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) { ok = false; break; } if (t > t0) t0 = t; } else { if (t < t0) { ok = false; break; } if (t < t1) t1 = t; }
    }
    if (!ok) { current = null; continue; }
    const a = [x0 + t0 * dx, y0 + t0 * dy];
    const b = [x0 + t1 * dx, y0 + t1 * dy];
    if (!current || t0 > 0) { current = [a]; pieces.push(current); }
    current.push(b);
    if (t1 < 1) current = null;
  }
  return pieces.filter((p) => p.length > 1);
};

// ── Tile -> lon/lat ─────────────────────────────────────────────────────────

const tileXY = (lat, lon, z) => {
  const n = 2 ** z;
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.asinh(Math.tan((clamped * Math.PI) / 180)) / Math.PI) / 2) * n);
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))];
};

const tilesCovering = (bounds, z) => {
  const [x0, y0] = tileXY(bounds.north, bounds.west, z);
  const [x1, y1] = tileXY(bounds.south, bounds.east, z);
  const out = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ x, y });
  return out;
};

const r7 = (v) => Math.round(v * 1e7) / 1e7;
const toLonLat = (z, x, y, extent) => ([px, py]) => {
  const n = 2 ** z;
  const lon = ((x + px / extent) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / extent)) / n))) * 180) / Math.PI;
  return { lat: r7(lat), lon: r7(lon) };
};

// ── Overture properties -> OSM tags ─────────────────────────────────────────

const json = (v) => {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (!(s.startsWith('{') || s.startsWith('['))) return v;
  try { return JSON.parse(s); } catch { return v; }
};
const nameOf = (p) => p['@name'] || json(p.names)?.primary;
const fmt = (n, places = 1) => String(Math.round(n * 10 ** places) / 10 ** places);

// Rules (Overture linear referencing) that cover the whole segment.
const wholeRule = (rules) => (Array.isArray(rules) ? rules.find((r) => !Array.isArray(r?.between)) : null);

const BUILDING_SUBTYPE = { outbuilding: 'shed', service: 'service' };
export const buildingTags = (p) => {
  if (p.is_underground === true || p.is_underground === 'true') return null;
  const tags = { building: p.class || BUILDING_SUBTYPE[p.subtype] || p.subtype || 'yes' };
  if (Number(p.height) > 0) tags.height = fmt(Number(p.height));
  if (Number(p.min_height) > 0) tags.min_height = fmt(Number(p.min_height));
  if (Number(p.num_floors) > 0) tags['building:levels'] = String(p.num_floors);
  if (p.roof_shape) tags['roof:shape'] = p.roof_shape;
  if (Number(p.roof_height) > 0) tags['roof:height'] = fmt(Number(p.roof_height));
  if (p.roof_color) tags['roof:colour'] = p.roof_color;
  if (p.facade_color) tags['building:colour'] = p.facade_color;
  if (p.facade_material) tags['building:material'] = p.facade_material;
  if (p.roof_material) tags['roof:material'] = p.roof_material;
  const name = nameOf(p);
  if (name) tags.name = name;
  return tags;
};

const ROAD_CLASSES = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'living_street',
  'unclassified', 'service', 'pedestrian', 'footway', 'steps', 'path', 'track', 'cycleway', 'bridleway',
]);
const LINKABLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
const SERVICE_SUBCLASS = { driveway: 'driveway', parking_aisle: 'parking_aisle', alley: 'alley' };

// Whether rule r applies at fraction t; t = NaN (segment not held whole):
// only rules covering the whole segment.
const appliesAt = (r, t) => {
  if (!Array.isArray(r?.between)) return true;
  return Number.isFinite(t) && t >= r.between[0] && t <= r.between[1];
};
const flagsAt = (rules, t) => {
  const flags = new Set();
  for (const r of Array.isArray(rules) ? rules : []) if (appliesAt(r, t)) for (const v of r.values || []) flags.add(v);
  return flags;
};
const valueAt = (rules, t) => {
  for (const r of Array.isArray(rules) ? rules : []) if (appliesAt(r, t)) return r.value;
  return undefined;
};

/** OSM tags for a road segment at fraction t along it (null: not a road we keep). */
export const segmentTags = (p, t = 0.5) => {
  if (p.subtype !== 'road') return null;
  const cls = p.class;
  const subclass = valueAt(json(p.subclass_rules), t) ?? p.subclass;
  const flags = flagsAt(json(p.road_flags), t);
  let highway = ROAD_CLASSES.has(cls) ? cls : 'road';
  const tags = {};
  if ((subclass === 'link' || flags.has('is_link')) && LINKABLE.has(highway)) highway = `${highway}_link`;
  if (subclass === 'sidewalk') { highway = 'footway'; tags.footway = 'sidewalk'; }
  if (subclass === 'crosswalk') { highway = 'footway'; tags.footway = 'crossing'; }
  if (SERVICE_SUBCLASS[subclass]) tags.service = SERVICE_SUBCLASS[subclass];
  tags.highway = highway;
  const name = nameOf(p);
  if (name) tags.name = name;
  const surface = valueAt(json(p.road_surface), t);
  if (surface && surface !== 'unknown') tags.surface = surface;
  const speed = wholeRule(json(p.speed_limits))?.max_speed;
  if (speed?.value) tags.maxspeed = speed.unit === 'mph' ? `${speed.value} mph` : String(speed.value);
  const width = wholeRule(json(p.width_rules))?.value;
  if (Number(width) > 0) tags.width = fmt(Number(width));
  if (flags.has('is_bridge')) tags.bridge = 'yes';
  if (flags.has('is_tunnel')) tags.tunnel = 'yes';
  if (flags.has('is_covered') && !flags.has('is_tunnel')) tags.covered = 'yes';
  const level = valueAt(json(p.level_rules), t);
  if (Number.isFinite(Number(level)) && Number(level) !== 0) tags.layer = String(level);
  else if (tags.bridge) tags.layer = '1';
  // One-way: travel denied against (or along) the drawn direction for everyone.
  for (const r of json(p.access_restrictions) || []) {
    if (r?.access_type !== 'denied' || Array.isArray(r.between)) continue;
    const when = r.when || {};
    if (Object.keys(when).length !== 1 || !when.heading) continue;
    if (when.heading === 'backward') tags.oneway = 'yes';
    else if (when.heading === 'forward') tags.oneway = '-1';
  }
  return tags;
};

// Linear-reference breakpoints (fractions) where a segment's tags change.
const breakpoints = (p) => {
  const cuts = new Set();
  for (const key of ['road_flags', 'level_rules', 'road_surface', 'subclass_rules']) {
    for (const r of json(p[key]) || []) {
      if (Array.isArray(r?.between)) { cuts.add(r.between[0]); cuts.add(r.between[1]); }
    }
  }
  return [...cuts].filter((c) => c > 0 && c < 1).sort((a, b) => a - b);
};

const metersBetween = (a, b) => {
  const k = 111320;
  const dx = (b.lon - a.lon) * k * Math.cos((a.lat * Math.PI) / 180);
  const dy = (b.lat - a.lat) * k;
  return Math.hypot(dx, dy);
};

// Split a whole segment at fractions of its length.
const splitAt = (line, cuts) => {
  if (!cuts.length) return [{ from: 0, to: 1, geometry: line }];
  const seg = [];
  let total = 0;
  for (let i = 0; i + 1 < line.length; i++) { const d = metersBetween(line[i], line[i + 1]); seg.push(d); total += d; }
  if (total <= 0) return [{ from: 0, to: 1, geometry: line }];
  const stops = [0, ...cuts, 1];
  const out = [];
  for (let s = 0; s + 1 < stops.length; s++) {
    const [fa, fb] = [stops[s] * total, stops[s + 1] * total];
    const geom = [];
    let acc = 0;
    for (let i = 0; i < seg.length; i++) {
      const a = line[i];
      const b = line[i + 1];
      const lerp = (d) => { const t = seg[i] ? (d - acc) / seg[i] : 0; return { lat: r7(a.lat + (b.lat - a.lat) * t), lon: r7(a.lon + (b.lon - a.lon) * t) }; };
      if (acc + seg[i] >= fa && acc <= fb) {
        if (!geom.length) geom.push(fa > acc ? lerp(fa) : a);
        geom.push(fb < acc + seg[i] ? lerp(fb) : b);
      }
      acc += seg[i];
    }
    if (geom.length > 1) out.push({ from: stops[s], to: stops[s + 1], geometry: geom });
  }
  return out;
};

const PLACE_AMENITY = { gas_station: 'fuel', fuel_station: 'fuel', ev_charging_station: 'charging_station' };
const placeTags = (p) => {
  const tax = json(p.taxonomy);
  const amenity = PLACE_AMENITY[tax?.primary] || PLACE_AMENITY[p.basic_category];
  if (!amenity || p.operating_status === 'permanently_closed') return null;
  const tags = { amenity };
  const name = nameOf(p);
  if (name) tags.name = name;
  const brand = json(p.brand)?.names?.primary;
  if (brand) tags.brand = brand;
  return tags;
};

const NODE_KEEP = new Set(OSM_FILTER.nodeTags.map(([k, v]) => `${k}=${v}`));
const keepNode = (tags) => Object.entries(tags).some(([k, v]) => NODE_KEEP.has(`${k}=${v}`));
const keepWay = (tags) => OSM_FILTER.wayKeys.some((k) => tags[k] !== undefined)
  || OSM_FILTER.wayTags.some(([k, v]) => tags[k] === v);

// Base features keep their OSM tags; the few without (ocean, ESA land cover)
// map from class, land cover is too coarse to use.
const baseTags = (layerName, p) => {
  if (layerName === 'land_cover' || layerName === 'bathymetry') return null;
  const src = json(p.source_tags);
  if (src && typeof src === 'object' && Object.keys(src).length) {
    const tags = {};
    for (const [k, v] of Object.entries(src)) if (v !== null && v !== undefined) tags[k] = String(v);
    return tags;
  }
  if (layerName === 'water' && p.subtype) return { natural: 'water', water: p.subtype === 'ocean' ? 'sea' : String(p.subtype) };
  return null;
};

// ── Assembly ────────────────────────────────────────────────────────────────

const JOIN_TOLERANCE_M = 2;

// Chain pieces whose ends meet (within tolerance) into as few lines as possible.
const joinPieces = (pieces) => {
  const pool = pieces.map((p) => [...p]);
  const lines = [];
  while (pool.length) {
    let line = pool.pop();
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        const s = line[0];
        const e = line[line.length - 1];
        if (metersBetween(e, p[0]) < JOIN_TOLERANCE_M) line = [...line, ...p.slice(1)];
        else if (metersBetween(e, p[p.length - 1]) < JOIN_TOLERANCE_M) line = [...line, ...p.slice(0, -1).reverse()];
        else if (metersBetween(s, p[p.length - 1]) < JOIN_TOLERANCE_M) line = [...p.slice(0, -1), ...line];
        else if (metersBetween(s, p[0]) < JOIN_TOLERANCE_M) line = [...p.slice(1).reverse(), ...line];
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    lines.push(line);
  }
  return lines;
};

/**
 * Collect one theme's decoded tiles into per-feature records:
 * { kind: 'point'|'line'|'polygon', layer, props, whole, pieces }.
 * `whole` is the feature drawn complete inside some tile's buffer (in
 * lon/lat); `pieces` its parts clipped to each exact tile square.
 */
export const collectFeatures = (tiles) => {
  const byId = new Map();
  for (const { z, x, y, layers } of tiles) {
    for (const [layerName, layer] of Object.entries(layers)) {
      const ext = layer.extent;
      // Features cut at the tile buffer all share its edge coordinates.
      let lo = Infinity;
      let hi = -Infinity;
      for (const f of layer.features) for (const part of f.parts) for (const [px, py] of part) {
        if (px < lo) lo = px; if (py < lo) lo = py;
        if (px > hi) hi = px; if (py > hi) hi = py;
      }
      const cutAtBuffer = (part) => part.some(([px, py]) => px <= lo || py <= lo || px >= hi || py >= hi);
      const project = toLonLat(z, x, y, ext);
      layer.features.forEach((f, idx) => {
        const id = `${layerName}/${f.props.id ?? `${z}/${x}/${y}/${idx}`}`;
        let rec = byId.get(id);
        const kind = f.type === 1 ? 'point' : f.type === 2 ? 'line' : 'polygon';
        if (!rec) { rec = { id, kind, layer: layerName, props: f.props, whole: null, pieces: [] }; byId.set(id, rec); }
        if (kind === 'point') {
          for (const part of f.parts) for (const pt of part) {
            if (pt[0] >= 0 && pt[0] < ext && pt[1] >= 0 && pt[1] < ext) rec.pieces.push([project(pt)]);
          }
          return;
        }
        const inside = (lo < 0 || hi > ext) && !f.parts.some(cutAtBuffer);
        if (kind === 'line') {
          if (inside && !rec.whole) rec.whole = f.parts.map((part) => part.map(project));
          for (const part of f.parts) for (const piece of clipLineToSquare(part, ext)) rec.pieces.push(piece.map(project));
        } else {
          const polys = polygonsFromRings(f.parts);
          if (inside && !rec.whole) rec.whole = polys.map((rings) => rings.map((ring) => ring.map(project)));
          for (const rings of polys) {
            const outer = clipRingToSquare(rings[0], ext);
            if (!outer) continue;
            const holes = rings.slice(1).map((h) => clipRingToSquare(h, ext)).filter(Boolean);
            rec.pieces.push([outer, ...holes].map((ring) => ring.map(project)));
          }
        }
      });
    }
  }
  return [...byId.values()];
};

/** Overpass-shaped {elements} from collected records of each theme. */
export const buildElements = (recordsByTheme) => {
  const elements = [];
  let nodeId = 0;
  let wayId = 0;
  let relId = 0;
  const addWay = (tags, geometry) => { elements.push({ type: 'way', id: ++wayId, tags, geometry }); };
  const addPolygon = (tags, rings) => {
    if (rings.length === 1) { addWay(tags, rings[0]); return; }
    const members = rings.map((ring, i) => ({ type: 'way', ref: ++wayId, role: i === 0 ? 'outer' : 'inner', geometry: ring }));
    elements.push({ type: 'relation', id: ++relId, tags: { type: 'multipolygon', ...tags }, members });
  };

  for (const [theme, records] of Object.entries(recordsByTheme)) {
    for (const rec of records) {
      const p = rec.props;
      if (rec.kind === 'point') {
        const tags = theme === 'places' ? placeTags(p) : theme === 'base' ? baseTags(rec.layer, p) : null;
        if (!tags || !keepNode(tags) || !rec.pieces.length) continue;
        const [pt] = rec.pieces[0];
        elements.push({ type: 'node', id: ++nodeId, lat: pt.lat, lon: pt.lon, tags });
        continue;
      }
      if (rec.kind === 'polygon') {
        let tags = null;
        if (theme === 'buildings') tags = rec.layer === 'building' ? buildingTags(p) : null;
        else if (theme === 'base') tags = baseTags(rec.layer, p);
        else if (theme === 'places') tags = placeTags(p);
        if (!tags || !keepWay(tags)) continue;
        for (const rings of rec.whole || rec.pieces) addPolygon(tags, rings);
        continue;
      }
      // Lines
      if (theme === 'transportation') {
        if (rec.layer !== 'segment' || p.subtype !== 'road') continue;
        const whole = rec.whole?.length === 1 ? rec.whole[0] : null;
        const lines = whole ? [whole] : joinPieces(rec.pieces);
        // Linear references are fractions of the whole segment: only a
        // segment we hold whole can be split; else rules covering all of it.
        const cuts = whole ? breakpoints(p) : [];
        for (const line of lines) {
          for (const part of splitAt(line, cuts)) {
            const tags = segmentTags(p, whole ? (part.from + part.to) / 2 : NaN);
            if (tags && part.geometry.length > 1) addWay(tags, part.geometry);
          }
        }
      } else if (theme === 'base') {
        const tags = baseTags(rec.layer, p);
        if (!tags || !keepWay(tags)) continue;
        for (const line of rec.whole || joinPieces(rec.pieces)) if (line.length > 1) addWay(tags, line);
      }
    }
  }
  return { elements };
};

const pool = async (items, limit, fn) => {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  });
  await Promise.all(workers);
  return out;
};

/**
 * Overpass-shaped {elements} for bounds from Overture's tiles, or null when
 * nothing came back (e.g. Overture's CDN unreachable too).
 */
export const fetchOsmFromOverture = async (bounds, { signal, onStatus } = {}) => {
  const recordsByTheme = {};
  let tileCount = 0;
  let failures = 0;
  for (const theme of THEMES) {
    signal?.throwIfAborted?.();
    try {
      const archive = archiveFor(theme);
      const header = await archive.getHeader();
      const z = header.maxZoom;
      const tiles = tilesCovering(bounds, z);
      onStatus?.(`Reading Overture Maps ${theme} (${tiles.length} tile${tiles.length === 1 ? '' : 's'})...`);
      const decoded = await pool(tiles, MAX_IN_FLIGHT, async ({ x, y }) => {
        signal?.throwIfAborted?.();
        const tile = await archive.getZxy(z, x, y, signal);
        return tile?.data ? { z, x, y, layers: decodeMvt(new Uint8Array(tile.data)) } : null;
      });
      const present = decoded.filter(Boolean);
      tileCount += present.length;
      recordsByTheme[theme] = collectFeatures(present);
    } catch (err) {
      if (err?.name === 'AbortError' || signal?.aborted) throw err;
      failures++;
      console.warn(`[OSM] Overture ${theme} tiles failed:`, err?.message || err);
      recordsByTheme[theme] = [];
    }
  }
  if (failures === THEMES.length || tileCount === 0) return null;
  return buildElements(recordsByTheme);
};
