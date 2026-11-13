// An OpenStreetMap file of the user's own as the level's map data: the
// "Export" of openstreetmap.org (a map.osm download, straight from the main
// OSM database, so as fresh as the last edit), a file saved from JOSM, or an
// Overpass JSON answer. For when the public Overpass servers can't be reached
// or lag behind, and for someone who just fixed their town on OSM.
//
// The file is read into the shape the Overpass query's `out body geom`
// returns (ways and relation members carry their own geometry), so
// osm.js parseOverpassResponse takes it unchanged. While one is loaded and
// overlaps the area being generated, fetchOSMData reads it instead of
// fetching (osm.js fetchOsmRaw).

// openstreetmap.org's own limits on one export (OSM.MAX_REQUEST_AREA, the API's
// node cap): a bigger box is refused there with "too many nodes"
export const OSM_EXPORT_MAX_AREA_DEG2 = 0.25;
export const OSM_EXPORT_MAX_NODES = 50000;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => (s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENTITIES[e] ?? m;
}));
// (JOSM writes attributes in single quotes, openstreetmap.org in double)
const ATTR = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const attrs = (s) => {
  const out = {};
  ATTR.lastIndex = 0;
  for (let m; (m = ATTR.exec(s));) out[m[1]] = decode(m[2] ?? m[3]);
  return out;
};
// (an element a JOSM file marks deleted, or the API's history marks gone)
const gone = (a) => a.action === 'delete' || a.visible === 'false';

/**
 * OSM XML (.osm) -> { nodes: Map id -> node, ways: [], relations: [], bounds }
 * with nodes { id, lat, lon, tags? }, ways { id, refs, tags }, relations
 * { id, members [{ type, ref, role }], tags }.
 */
function readOsmXml(text) {
  const nodes = new Map();
  const ways = [];
  const relations = [];
  let bounds = null;
  let current = null;          // the node / way / relation being read
  const TAG = /<(\/?)(node|way|relation|tag|nd|member|bounds)\b([^>]*?)(\/?)>/g;
  for (let m; (m = TAG.exec(text));) {
    const [, closing, name, body, selfClosing] = m;
    if (closing) { current = null; continue; }
    const a = attrs(body);
    switch (name) {
      case 'node': {
        const node = { type: 'node', id: Number(a.id), lat: Number(a.lat), lon: Number(a.lon) };
        if (!gone(a) && Number.isFinite(node.lat) && Number.isFinite(node.lon)) nodes.set(node.id, node);
        current = selfClosing ? null : node;
        break;
      }
      case 'way': {
        const way = { type: 'way', id: Number(a.id), refs: [], tags: null };
        if (!gone(a)) ways.push(way);
        current = selfClosing ? null : way;
        break;
      }
      case 'relation': {
        const rel = { type: 'relation', id: Number(a.id), members: [], tags: null };
        if (!gone(a)) relations.push(rel);
        current = selfClosing ? null : rel;
        break;
      }
      case 'tag':
        if (current && a.k != null) (current.tags ||= {})[a.k] = a.v ?? '';
        break;
      case 'nd':
        if (current?.refs) current.refs.push(Number(a.ref));
        break;
      case 'member':
        if (current?.members) current.members.push({ type: a.type, ref: Number(a.ref), role: a.role || '' });
        break;
      case 'bounds': {
        const b = { south: Number(a.minlat), west: Number(a.minlon), north: Number(a.maxlat), east: Number(a.maxlon) };
        // (a file from JOSM has one <bounds> for every area downloaded into it: the box round all of them.
        // The last one alone was kept, so a file of several downloads counted as covering only its last
        // piece and was refused, "doesn't cover the area", however much it held: a tester's files, cropped
        // by hand to get them in.)
        if (Object.values(b).every(Number.isFinite)) {
          bounds = bounds
            ? { south: Math.min(bounds.south, b.south), west: Math.min(bounds.west, b.west), north: Math.max(bounds.north, b.north), east: Math.max(bounds.east, b.east) }
            : b;
        }
        break;
      }
      default:
    }
  }
  return { nodes, ways, relations, bounds };
}

/** Overpass JSON (out geom, or out body + skel) -> the same shape as readOsmXml. */
function readOverpassJson(json) {
  const nodes = new Map();
  const ways = [];
  const relations = [];
  const wayGeometry = new Map();   // (ways that came with their own geometry)
  for (const el of json.elements || []) {
    if (el.type === 'node' && Number.isFinite(el.lat) && Number.isFinite(el.lon)) {
      nodes.set(el.id, { type: 'node', id: el.id, lat: el.lat, lon: el.lon, ...(el.tags ? { tags: el.tags } : {}) });
    } else if (el.type === 'way') {
      ways.push({ type: 'way', id: el.id, refs: el.nodes || [], tags: el.tags || null });
      if (Array.isArray(el.geometry)) wayGeometry.set(el.id, el.geometry);
    } else if (el.type === 'relation') {
      relations.push({ type: 'relation', id: el.id, members: (el.members || []).map((m) => ({ ...m })), tags: el.tags || null });
    }
  }
  const b = json.bounds;
  const bounds = b && [b.minlat, b.minlon, b.maxlat, b.maxlon].every(Number.isFinite)
    ? { south: b.minlat, west: b.minlon, north: b.maxlat, east: b.maxlon } : null;
  return { nodes, ways, relations, bounds, wayGeometry };
}

/**
 * The text of an OSM file -> { data: { elements } as Overpass `out body geom`
 * gives them, bounds { south, west, north, east }, counts }. Throws on a
 * file that isn't OSM data (or holds none).
 */
export function parseOsmFile(text) {
  const head = String(text || '').slice(0, 2000).trimStart();
  let read;
  if (head.startsWith('{')) {
    let json;
    try { json = JSON.parse(text); } catch { throw new Error('This JSON file could not be read.'); }
    if (!Array.isArray(json?.elements)) throw new Error('This JSON file is not OpenStreetMap data (no "elements").');
    read = readOverpassJson(json);
  } else if (/<osm\b/.test(head) || /<osmChange\b/.test(head)) {
    if (/<osmChange\b/.test(head)) throw new Error('This is a change file (osmChange), not map data.');
    read = readOsmXml(String(text));
  } else if (head.startsWith('<')) {
    throw new Error('This XML file is not OpenStreetMap data (no <osm> element).');
  } else {
    throw new Error('Not an OpenStreetMap file. Use a .osm file (openstreetmap.org Export or JOSM) or Overpass JSON.');
  }

  const { nodes, ways, relations, wayGeometry } = read;
  if (!nodes.size && !ways.length) throw new Error('The file holds no map data.');

  const geomOf = (way) => {
    const own = wayGeometry?.get(way.id);
    if (own) return own.map((p) => ({ lat: p.lat, lon: p.lon }));
    const out = [];
    for (const ref of way.refs) {
      const n = nodes.get(ref);
      if (n) out.push({ lat: n.lat, lon: n.lon });
    }
    return out;
  };

  const elements = [];
  for (const n of nodes.values()) if (n.tags) elements.push(n);
  const wayById = new Map();
  for (const way of ways) {
    const geometry = geomOf(way);
    wayById.set(way.id, geometry);
    if (geometry.length < 2) continue;
    elements.push({ type: 'way', id: way.id, nodes: way.refs, geometry, tags: way.tags || {} });
  }
  for (const rel of relations) {
    const members = rel.members.map((m) => {
      if (m.type === 'way') {
        const geometry = m.geometry || wayById.get(m.ref);
        return geometry?.length ? { ...m, geometry } : { ...m };
      }
      if (m.type === 'node') {
        const n = nodes.get(m.ref);
        return n ? { ...m, lat: n.lat, lon: n.lon } : { ...m };
      }
      return { ...m };
    });
    elements.push({ type: 'relation', id: rel.id, members, tags: rel.tags || {} });
  }

  // (no <bounds>, as in a file saved from JOSM: the box its nodes span)
  let bounds = read.bounds;
  if (!bounds) {
    let south = Infinity; let west = Infinity; let north = -Infinity; let east = -Infinity;
    for (const n of nodes.values()) {
      if (n.lat < south) south = n.lat; if (n.lat > north) north = n.lat;
      if (n.lon < west) west = n.lon; if (n.lon > east) east = n.lon;
    }
    for (const g of wayGeometry?.values() || []) for (const p of g) {
      if (p.lat < south) south = p.lat; if (p.lat > north) north = p.lat;
      if (p.lon < west) west = p.lon; if (p.lon > east) east = p.lon;
    }
    bounds = Number.isFinite(south) ? { south, west, north, east } : null;
  }
  if (!bounds) throw new Error('The file holds no map data.');

  return {
    data: { elements },
    bounds,
    counts: { nodes: nodes.size, ways: ways.length, relations: relations.length },
  };
}

/**
 * How much of `area` (a { south, west, north, east } box) the file's box
 * covers: 'full', 'partial' or 'none', and the covered share (0..1).
 */
export function osmFileCoverage(fileBounds, area) {
  if (!fileBounds || !area) return { coverage: 'none', share: 0 };
  const w = Math.max(area.west, fileBounds.west);
  const e = Math.min(area.east, fileBounds.east);
  const s = Math.max(area.south, fileBounds.south);
  const n = Math.min(area.north, fileBounds.north);
  const areaSize = (area.east - area.west) * (area.north - area.south);
  if (e <= w || n <= s || !(areaSize > 0)) return { coverage: 'none', share: 0 };
  const share = Math.min(1, ((e - w) * (n - s)) / areaSize);
  // (a hair short of the edge, from rounding the box on export, still counts)
  return { coverage: share > 0.995 ? 'full' : 'partial', share };
}

/**
 * The openstreetmap.org API link that downloads `area` as map.osm, the same
 * request as the Export button on openstreetmap.org. A small margin around
 * the area keeps roads and buildings on its edge whole.
 */
export function osmExportUrl(area, marginFraction = 0.03) {
  const dx = (area.east - area.west) * marginFraction;
  const dy = (area.north - area.south) * marginFraction;
  const f = (v) => v.toFixed(6);
  return `https://api.openstreetmap.org/api/0.6/map?bbox=${f(area.west - dx)},${f(area.south - dy)},${f(area.east + dx)},${f(area.north + dy)}`;
}

/**
 * openstreetmap.org's Export page with its map, and so its export box, fitted
 * to the area (the site reads ?bbox= and fits the view to it).
 */
export function osmExportPageUrl(area) {
  const f = (v) => v.toFixed(6);
  return `https://www.openstreetmap.org/export?bbox=${f(area.west)},${f(area.south)},${f(area.east)},${f(area.north)}`;
}

/** A file name for the area's export: osm_<lat>_<lon>.osm (its centre). */
export function osmExportFileName(area) {
  const lat = (area.north + area.south) / 2;
  const lon = (area.east + area.west) / 2;
  return `osm_${lat.toFixed(4)}_${lon.toFixed(4)}.osm`;
}

/**
 * The area from openstreetmap.org's API (the request its Export button makes;
 * the API allows the website's and the desktop app's origins). -> the .osm
 * text. onProgress(bytes) while it arrives. Throws an Error with .code:
 * 'too_big' (over the API's node or area limit), 'busy' (rate limited),
 * 'network', or 'http'.
 */
export async function fetchOsmExport(area, { signal, onProgress } = {}) {
  let response;
  try {
    response = await fetch(osmExportUrl(area), { signal, headers: { Accept: 'application/xml' } });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw Object.assign(new Error(`openstreetmap.org could not be reached: ${e?.message || e}`), { code: 'network' });
  }
  if (!response.ok) {
    const body = (await response.text().catch(() => '')).slice(0, 300);
    const code = response.status === 400 && /too many nodes|area|bounding box/i.test(body) ? 'too_big'
      : (response.status === 429 || response.status === 509) ? 'busy' : 'http';
    throw Object.assign(new Error(body || `openstreetmap.org answered ${response.status}`), { code, status: response.status });
  }
  if (!response.body?.getReader) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: true });
    onProgress?.(bytes);
  }
  return text + decoder.decode();
}

/** Whether openstreetmap.org will hand out `area` in one export (its box limit; the node cap shows only on asking). */
export const osmExportAreaOk = (area) => (area.east - area.west) * (area.north - area.south) <= OSM_EXPORT_MAX_AREA_DEG2;

// ---- the file loaded now (one at a time; kept in memory until cleared or reloaded) ----

let loaded = null;   // { name, size, bounds, counts, data, text, loadedAt }
const listeners = new Set();

/** The loaded file, or null. */
export const getLoadedOsmFile = () => loaded;

/** Read `text` (named `name`) as the loaded file; throws if it isn't OSM data. Keeps the text for the desktop app's generate job (and a rebuild). */
export function loadOsmFileText(text, name = 'map.osm', { source = 'file' } = {}) {
  const parsed = parseOsmFile(text);
  // (source: 'file' dropped or picked, 'pulled' straight from openstreetmap.org)
  loaded = { name, source, size: text.length, ...parsed, text, loadedAt: new Date().toISOString() };
  for (const fn of listeners) fn(loaded);
  return loaded;
}

export function clearOsmFile() {
  loaded = null;
  for (const fn of listeners) fn(null);
}

/** Call `fn(file or null)` whenever the loaded file changes; returns the unsubscribe. */
export function onOsmFileChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
