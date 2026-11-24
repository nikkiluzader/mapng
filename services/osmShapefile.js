// OSM data as Shapefiles (a .zip of .shp + .dbf [+ .prj, .cpg] per layer), turned into GeoJSON features with OSM
// tags for the importer (osmFormats.js geojsonToOverpass). Asked for by SPLATPLAYS (Discord #general 2026-11-21).
//
// A Shapefile holds no OSM tags, only the columns its maker chose, so the tags are rebuilt from three known layouts:
//   - Geofabrik's free shapefiles (gis_osm_<layer>_free_1): one column `fclass` per layer (roads: "secondary",
//     railways: "rail", landuse: "park"...), plus name, ref, oneway (F/T/B), maxspeed, layer, bridge/tunnel (T/F);
//   - ogr2ogr's OSM driver (and QGIS's OSM import): columns named after OSM keys (highway, building, waterway...)
//     and the rest in `other_tags` ("key"=>"value",...);
//   - any file whose columns are OSM keys.
// What no Shapefile carries is lost: lanes, widths, surfaces, sidewalks, building heights and levels, turn lanes,
// relations; ways sharing a node are joined by equal coordinates only. So a Shapefile builds a simpler level than
// the same place's .osm or .osm.pbf.

import proj4 from 'proj4';

// ── the files ──────────────────────────────────────────────────────────────

function readDbf(bytes, encoding = 'utf-8') {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getUint32(4, true); const headerLen = dv.getUint16(8, true); const recLen = dv.getUint16(10, true);
  const fields = [];
  for (let o = 32; o < headerLen - 1 && bytes[o] !== 0x0d; o += 32) {
    let name = ''; for (let i = 0; i < 11 && bytes[o + i]; i++) name += String.fromCharCode(bytes[o + i]);
    fields.push({ name, type: String.fromCharCode(bytes[o + 11]), len: bytes[o + 16] });
  }
  let dec; try { dec = new TextDecoder(encoding); } catch { dec = new TextDecoder('utf-8'); }
  const rows = [];
  for (let r = 0; r < count; r++) {
    const start = headerLen + r * recLen;
    if (start + recLen > bytes.length) break;
    const deleted = bytes[start] === 0x2a;
    let p = start + 1; const row = {};
    for (const f of fields) {
      const raw = dec.decode(bytes.subarray(p, p + f.len)).replace(/\0/g, '').trim();
      p += f.len;
      if (raw !== '') row[f.name] = raw;
    }
    rows.push(deleted ? null : row);
  }
  return rows;
}

const SHP_POINT = new Set([1, 11, 21]); const SHP_LINE = new Set([3, 13, 23]); const SHP_POLY = new Set([5, 15, 25]); const SHP_MULTIPOINT = new Set([8, 18, 28]);

function ringArea(ring) { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]); return a / 2; }
function inRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A .shp file's bytes -> GeoJSON geometries in record order (null for a null shape). */
function readShp(bytes, project) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getInt32(0, false) !== 9994) throw new Error('This .shp file is not a Shapefile.');
  const out = [];
  let o = 100;
  while (o + 8 <= bytes.length) {
    const contentLen = dv.getInt32(o + 4, false) * 2; const c = o + 8; o = c + contentLen;
    if (o > bytes.length) break;
    const type = dv.getInt32(c, true);
    const pt = (at) => project([dv.getFloat64(at, true), dv.getFloat64(at + 8, true)]);
    if (type === 0) { out.push(null); continue; }
    if (SHP_POINT.has(type)) { out.push({ type: 'Point', coordinates: pt(c + 4) }); continue; }
    if (SHP_MULTIPOINT.has(type)) {
      const n = dv.getInt32(c + 36, true); const pts = [];
      for (let i = 0; i < n; i++) pts.push(pt(c + 40 + i * 16));
      out.push({ type: 'MultiPoint', coordinates: pts }); continue;
    }
    if (SHP_LINE.has(type) || SHP_POLY.has(type)) {
      const nParts = dv.getInt32(c + 36, true); const nPoints = dv.getInt32(c + 40, true);
      const parts = []; for (let i = 0; i < nParts; i++) parts.push(dv.getInt32(c + 44 + i * 4, true));
      const p0 = c + 44 + nParts * 4;
      const rings = parts.map((s, i) => { const e = i + 1 < nParts ? parts[i + 1] : nPoints; const r = []; for (let k = s; k < e; k++) r.push(pt(p0 + k * 16)); return r; });
      if (SHP_LINE.has(type)) { out.push(rings.length === 1 ? { type: 'LineString', coordinates: rings[0] } : { type: 'MultiLineString', coordinates: rings }); continue; }
      // (Shapefile polygons: outer rings clockwise, holes counter-clockwise; each hole to the outer ring holding it)
      // (ringArea is negative for a clockwise ring, x east and y north)
      const polys = [];
      for (const r of rings) { if (r.length >= 4 && ringArea(r) < 0) polys.push([r]); }
      for (const r of rings) {
        if (r.length < 4 || ringArea(r) < 0) continue;
        const owner = polys.find((pl) => inRing(r[0], pl[0]));
        if (owner) owner.push(r); else polys.push([r.slice().reverse()]);
      }
      if (polys.length) out.push(polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys });
      else out.push(null);
      continue;
    }
    out.push(null);   // (MultiPatch and others: nothing MapNG builds)
  }
  return out;
}

// ── the columns -> OSM tags ─────────────────────────────────────────────────

const yes = (v) => v === 'T' || v === 't' || v === '1' || v === 'yes' || v === 'Y';
// Geofabrik's layer -> how its fclass reads as OSM tags (download.geofabrik.de/osm-data-in-gis-formats-free.pdf)
const GEOFABRIK_LANDUSE = {
  forest: { landuse: 'forest' }, park: { leisure: 'park' }, residential: { landuse: 'residential' }, industrial: { landuse: 'industrial' },
  cemetery: { landuse: 'cemetery' }, allotments: { landuse: 'allotments' }, meadow: { landuse: 'meadow' }, commercial: { landuse: 'commercial' },
  nature_reserve: { leisure: 'nature_reserve' }, recreation_ground: { landuse: 'recreation_ground' }, retail: { landuse: 'retail' },
  military: { landuse: 'military' }, quarry: { landuse: 'quarry' }, orchard: { landuse: 'orchard' }, vineyard: { landuse: 'vineyard' },
  scrub: { natural: 'scrub' }, grass: { landuse: 'grass' }, heath: { natural: 'heath' }, farmland: { landuse: 'farmland' },
  farmyard: { landuse: 'farmyard' },
};
const GEOFABRIK_WATER = {
  water: { natural: 'water' }, reservoir: { landuse: 'reservoir' }, river: { natural: 'water', water: 'river' }, dock: { waterway: 'dock' },
  glacier: { natural: 'glacier' }, wetland: { natural: 'wetland' },
};
const GEOFABRIK_TRAFFIC = {
  traffic_signals: { highway: 'traffic_signals' }, stop: { highway: 'stop' }, crossing: { highway: 'crossing' }, give_way: { highway: 'give_way' },
  mini_roundabout: { highway: 'mini_roundabout' }, street_lamp: { highway: 'street_lamp' }, speed_camera: { highway: 'speed_camera' },
  turning_circle: { highway: 'turning_circle' }, motorway_junction: { highway: 'motorway_junction' }, fuel: { amenity: 'fuel' },
  parking: { amenity: 'parking' }, parking_site: { amenity: 'parking' }, parking_multistorey: { amenity: 'parking', parking: 'multi-storey' },
  parking_underground: { amenity: 'parking', parking: 'underground' }, parking_bicycle: { amenity: 'bicycle_parking' },
  slipway: { leisure: 'slipway' }, marina: { leisure: 'marina' }, pier: { man_made: 'pier' }, dam: { waterway: 'dam' }, weir: { waterway: 'weir' },
  waterfall: { waterway: 'waterfall' }, lock_gate: { waterway: 'lock_gate' },
};
const GEOFABRIK_NATURAL = { tree: { natural: 'tree' }, peak: { natural: 'peak' }, spring: { natural: 'spring' }, cliff: { natural: 'cliff' }, cave_entrance: { natural: 'cave_entrance' }, volcano: { natural: 'volcano' }, beach: { natural: 'beach' } };
const GEOFABRIK_TRANSPORT = { bus_stop: { highway: 'bus_stop' }, tram_stop: { railway: 'tram_stop' }, railway_station: { railway: 'station' }, railway_halt: { railway: 'halt' }, taxi: { amenity: 'taxi' }, bus_station: { amenity: 'bus_station' }, ferry_terminal: { amenity: 'ferry_terminal' } };

function geofabrikTags(layer, row) {
  const fc = row.fclass; if (!fc) return null;
  const t = {};
  if (row.name) t.name = row.name;
  if (layer === 'roads') {
    const m = /^track_grade(\d)$/.exec(fc);
    if (m) { t.highway = 'track'; t.tracktype = `grade${m[1]}`; } else if (fc === 'unknown') t.highway = 'road'; else t.highway = fc;
    if (row.ref) t.ref = row.ref;
    if (row.oneway === 'F') t.oneway = 'yes'; else if (row.oneway === 'T') t.oneway = '-1';
    if (row.maxspeed && Number(row.maxspeed) > 0) t.maxspeed = row.maxspeed;
  } else if (layer === 'railways') {
    t.railway = fc;
  } else if (layer === 'waterways') {
    t.waterway = fc;
    if (row.width && Number(row.width) > 0) t.width = row.width;
  } else if (layer === 'buildings') {
    t.building = row.type || 'yes';
  } else if (layer === 'landuse') {
    Object.assign(t, GEOFABRIK_LANDUSE[fc] || { landuse: fc });
  } else if (layer === 'water') {
    Object.assign(t, GEOFABRIK_WATER[fc] || { natural: 'water' });
  } else if (layer === 'natural') {
    Object.assign(t, GEOFABRIK_NATURAL[fc] || { natural: fc });
  } else if (layer === 'traffic') {
    const x = GEOFABRIK_TRAFFIC[fc]; if (!x) return null; Object.assign(t, x);
  } else if (layer === 'transport') {
    const x = GEOFABRIK_TRANSPORT[fc]; if (!x) return null; Object.assign(t, x);
  } else if (layer === 'pois' || layer === 'pofw') {
    // (shops, amenities, tourism: one fclass each; read as amenity unless it names a shop or a place of worship)
    if (layer === 'pofw') { t.amenity = 'place_of_worship'; } else if (/^(supermarket|bakery|kiosk|mall|department_store|convenience|clothes|florist|chemist|bookshop|butcher|shoe_shop|beverages|optician|jeweller|gift_shop|sports_shop|stationery|outdoor_shop|toy_shop|newsagent|greengrocer|beauty_shop|video_shop|car_dealership|bicycle_shop|doityourself|furniture_shop|computer_shop|garden_centre|hairdresser|car_repair|car_rental|car_wash|car_sharing|bicycle_rental|travel_agent|laundry|vending_machine|vending_any|mobile_phone_shop)$/.test(fc)) t.shop = fc.replace(/_shop$/, ''); else t.amenity = fc;
  } else if (layer === 'places' || layer === 'adminareas' || layer === 'protected_areas') {
    return null;   // (place names and boundaries: nothing MapNG builds)
  } else {
    return null;
  }
  if (layer === 'roads' || layer === 'railways') {
    if (row.layer && row.layer !== '0') t.layer = row.layer;
    if (yes(row.bridge)) t.bridge = 'yes';
    if (yes(row.tunnel)) t.tunnel = 'yes';
  }
  return t;
}

const OTHER_TAGS = /"((?:[^"\\]|\\.)*)"=>"((?:[^"\\]|\\.)*)"/g;
const NOT_TAGS = new Set(['osm_id', 'osm_way_id', 'osm_type', 'z_order', 'other_tags', 'fid', 'id', 'code', 'fclass', 'gid', 'objectid', 'shape_leng', 'shape_area']);
function columnTags(row) {
  const t = {};
  for (const [k, v] of Object.entries(row)) if (!NOT_TAGS.has(k.toLowerCase())) t[k] = v;
  if (row.other_tags) for (const m of row.other_tags.matchAll(OTHER_TAGS)) t[m[1].replace(/\\"/g, '"')] = m[2].replace(/\\"/g, '"');
  return t;
}
const KNOWN_KEYS = /^(highway|building|railway|waterway|natural|landuse|leisure|amenity|barrier|man_made|power|aeroway|place|shop|tourism|historic|water)$/;

function osmIdFor(layer, row, geomType) {
  const raw = row.osm_way_id || row.osm_id;
  if (!raw || !/^-?\d+$/.test(raw)) return null;
  // (an area's osm_id is its way's or its relation's, unsaid: two could share one. Areas get ids of their own)
  if (geomType !== 'Point' && geomType !== 'LineString') return null;
  const type = row.osm_way_id ? 'way' : geomType === 'Point' || geomType === 'MultiPoint' ? 'node' : 'way';
  return `${type}/${raw}`;
}

/**
 * A Shapefile zip's entries ({ name -> Uint8Array }) -> { type: 'FeatureCollection', features, layers, layout }.
 * layout: 'geofabrik', 'osm-columns' or null when no layer read as OSM data.
 */
export function shapefilesToGeojson(files) {
  const byBase = new Map();
  for (const [name, bytes] of Object.entries(files)) {
    const m = /^(.*)\.(shp|dbf|prj|cpg)$/i.exec(name.replace(/\\/g, '/'));
    if (!m) continue;
    const base = m[1]; if (!byBase.has(base)) byBase.set(base, {});
    byBase.get(base)[m[2].toLowerCase()] = bytes;
  }
  const features = []; const layers = []; let layout = null;
  for (const [base, f] of byBase) {
    if (!f.shp || !f.dbf) continue;
    const short = base.split('/').pop();
    const gf = /^gis_osm_([a-z_]+?)(?:_a)?_free_1$/.exec(short);
    const layer = gf ? gf[1] : short;
    const prj = f.prj ? new TextDecoder().decode(f.prj) : '';
    let project = (c) => c;
    if (prj && !/^\s*GEOGCS\[/i.test(prj)) {
      try { const tr = proj4(prj, 'EPSG:4326'); project = (c) => tr.forward(c); } catch { throw new Error(`The layer ${short} uses a map projection MapNG cannot read (${prj.slice(0, 60)}...).`); }
    }
    const enc = f.cpg ? new TextDecoder().decode(f.cpg).trim().toLowerCase().replace(/^(\d+)$/, 'windows-$1') : 'utf-8';
    const geoms = readShp(f.shp, project); const rows = readDbf(f.dbf, enc === 'utf8' ? 'utf-8' : enc);
    let read = 0;
    for (let i = 0; i < geoms.length; i++) {
      const g = geoms[i]; const row = rows[i];
      if (!g || !row) continue;
      let tags;
      if (gf) tags = geofabrikTags(layer, row);
      else { tags = columnTags(row); if (!Object.keys(tags).some((k) => KNOWN_KEYS.test(k))) tags = null; }
      if (!tags || !Object.keys(tags).length) continue;
      const id = osmIdFor(layer, row, g.type);
      features.push({ type: 'Feature', geometry: g, properties: { ...tags, ...(id ? { '@id': id } : {}) } });
      read++;
    }
    layers.push({ layer: short, read, of: geoms.length });
    if (read) layout = layout || (gf ? 'geofabrik' : 'osm-columns');
  }
  if (!layers.length) throw new Error('This zip holds no Shapefile (a .shp with its .dbf).');
  if (!features.length) throw new Error('None of these Shapefiles reads as OpenStreetMap data: their columns are not OSM tags (highway, building...) and they are not Geofabrik\'s layers.');
  return { type: 'FeatureCollection', features, layers, layout };
}
