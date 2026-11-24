// .o5m: a compact binary form of OSM XML (wiki.openstreetmap.org/wiki/O5m), written by osmconvert and offered by
// some extract services. Asked for by SPLATPLAYS (Discord #general 2026-11-21). Read into the Overpass JSON the
// importer takes, as an .osm.pbf is (osmFormats.js).
//
// The format: a run of datasets, each a type byte and (except a reset, 0xff) a length. Nodes, ways and relations
// are delta-coded against the previous object of the same kind (ids, coordinates, way node refs, relation member
// refs per member type); strings (tag keys and values, member roles, authors) are either written out, ending in a
// zero byte, or refer back into a table of the last 15,000 short strings. A reset (0xff) clears every delta and the
// table. An object with no body after its id and version is deleted (in a change file).

const T_NODE = 0x10; const T_WAY = 0x11; const T_REL = 0x12;
const T_BBOX = 0xdb; const T_TIME = 0xdc; const T_HEADER = 0xe0; const T_SYNC = 0xee; const T_JUMP = 0xef;
const T_END = 0xfe; const T_RESET = 0xff;
const TABLE = 15000; const TABLE_MAX_LEN = 250;

/** Whether these bytes are an .o5m file ('o5m2'), an .o5c change file ('o5c2') or neither (null). */
export function o5mKind(bytes) {
  if (!bytes || bytes.length < 7 || bytes[0] !== T_RESET || bytes[1] !== T_HEADER) return null;
  const tag = String.fromCharCode(bytes[3], bytes[4], bytes[5], bytes[6]);
  return tag === 'o5m2' ? 'o5m' : tag === 'o5c2' ? 'o5c' : null;
}

/** An .o5m file's bytes -> { elements, bounds? } (Overpass JSON: nodes with lat/lon, ways with node ids). */
export function decodeO5m(input, { onProgress } = {}) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const kind = o5mKind(b);
  if (kind === 'o5c') throw new Error('This is an .o5c change file: it lists edits, not a map. Load the map it was made against instead.');
  if (kind !== 'o5m') throw new Error('This is not an .o5m file.');
  const dec = new TextDecoder('utf-8');
  let pos = 0;
  const uvar = () => {
    let v = 0; let mul = 1;
    for (;;) {
      if (pos >= b.length) throw new Error('This .o5m file is cut short.');
      const c = b[pos++];
      v += (c & 0x7f) * mul;
      if (!(c & 0x80)) return v;
      mul *= 128;
    }
  };
  const svar = () => { const u = uvar(); return u % 2 ? -(u + 1) / 2 : u / 2; };
  // the string table: a ring of the last TABLE short strings (a pair counts as one entry)
  let table = new Array(TABLE); let tpos = 0;
  const readZ = () => { const s = pos; while (pos < b.length && b[pos] !== 0) pos++; if (pos >= b.length) throw new Error('This .o5m file is cut short.'); const out = b.subarray(s, pos); pos++; return out; };
  const stringPair = (pair) => {
    const ref = uvar();
    if (ref) {
      const e = table[(tpos - ref + TABLE * 2) % TABLE];
      if (!e) throw new Error('This .o5m file is damaged (a string refers to nothing).');
      return e;
    }
    const start = pos;
    const a = readZ(); const c = pair ? readZ() : null;
    const e = pair ? [dec.decode(a), dec.decode(c)] : [dec.decode(a)];
    if (pos - start - (pair ? 2 : 1) <= TABLE_MAX_LEN) { table[tpos] = e; tpos = (tpos + 1) % TABLE; }
    return e;
  };
  // the delta state
  let nodeId = 0; let wayId = 0; let relId = 0; let time = 0; let cset = 0; let lon = 0; let lat = 0; let wayRef = 0;
  const memRef = [0, 0, 0];
  const reset = () => { nodeId = wayId = relId = time = cset = lon = lat = wayRef = 0; memRef[0] = memRef[1] = memRef[2] = 0; table = new Array(TABLE); tpos = 0; };
  const version = () => {
    const v = uvar();
    if (v === 0) return;
    time += svar();
    if (time !== 0) { cset += svar(); stringPair(true); }   // (changeset and author: read and dropped)
  };
  const tags = (end) => {
    let t = null;
    while (pos < end) { const [k, v] = stringPair(true); (t ||= {})[k] = v; }
    return t;
  };
  const elements = []; let bounds = null; let lastShare = 0;
  const memberType = ['node', 'way', 'relation'];
  while (pos < b.length) {
    const type = b[pos++];
    if (type === T_RESET) { reset(); continue; }
    if (type === T_END) break;
    if (type >= 0xf0 && type < 0xff && type !== T_SYNC && type !== T_JUMP && type !== T_END) continue;   // (single-byte datasets)
    const len = uvar(); const end = pos + len;
    if (end > b.length) throw new Error('This .o5m file is cut short.');
    if (type === T_NODE) {
      nodeId += svar(); version();
      if (pos < end) {
        lon += svar(); lat += svar();
        const el = { type: 'node', id: nodeId, lat: lat / 1e7, lon: lon / 1e7 };
        const t = tags(end); if (t) el.tags = t;
        elements.push(el);
      }
    } else if (type === T_WAY) {
      wayId += svar(); version();
      if (pos < end) {
        const refsLen = uvar(); const refsEnd = pos + refsLen; const nodes = [];   // (length first: `pos + uvar()` reads pos before uvar moves it)
        while (pos < refsEnd) { wayRef += svar(); nodes.push(wayRef); }
        const el = { type: 'way', id: wayId, nodes };
        const t = tags(end); if (t) el.tags = t;
        elements.push(el);
      }
    } else if (type === T_REL) {
      relId += svar(); version();
      if (pos < end) {
        const refsLen = uvar(); const refsEnd = pos + refsLen; const members = [];
        while (pos < refsEnd) {
          const delta = svar();
          const [tr] = stringPair(false);
          const mt = tr.charCodeAt(0) - 48;
          if (mt < 0 || mt > 2) throw new Error('This .o5m file is damaged (bad member type).');
          memRef[mt] += delta;
          members.push({ type: memberType[mt], ref: memRef[mt], role: tr.slice(1) });
        }
        const el = { type: 'relation', id: relId, members };
        const t = tags(end); if (t) el.tags = t;
        elements.push(el);
      }
    } else if (type === T_BBOX) {
      const x1 = svar(); const y1 = svar(); const x2 = svar(); const y2 = svar();
      bounds = { minlon: x1 / 1e7, minlat: y1 / 1e7, maxlon: x2 / 1e7, maxlat: y2 / 1e7 };
    }
    // (header, file timestamp, sync, jump and anything newer: skipped by their length)
    pos = end;
    const share = pos / b.length;
    if (onProgress && share - lastShare > 0.02) { lastShare = share; onProgress(share); }
  }
  if (!elements.length) throw new Error('The file holds no map data.');
  return { elements, ...(bounds ? { bounds } : {}) };
}
