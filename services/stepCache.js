// The export's step cache: the result of an expensive, self-contained export
// step (the surrounding backdrop: its model and textures) kept by a key made
// of everything the step reads, so exporting again after changing something
// it doesn't read (tree density, a level name) reuses it instead of building
// it again. The page keeps results in memory (memoryStepCache); the desktop
// app's export runner keeps them on disk (desktop/runner/diskStepCache.mjs).
//
// A store is { get(key) → Promise<value | null>, set(key, value) → Promise };
// values are plain objects whose leaves may be Blobs or typed arrays.

/** FNV-1a over strings and byte views, for step keys (not security). */
export function stepHash(...parts) {
  let h = 0x811c9dc5;
  const mix = (byte) => { h ^= byte; h = Math.imul(h, 0x01000193); };
  for (const p of parts) {
    if (p == null) { mix(0); continue; }
    if (ArrayBuffer.isView(p)) {
      // (word by word where it can: a 4096² heightmap in a fraction of a second)
      const whole = (p.byteOffset % 4 === 0) ? Math.floor(p.byteLength / 4) : 0;
      if (whole) {
        const w = new Uint32Array(p.buffer, p.byteOffset, whole);
        for (let i = 0; i < w.length; i++) { h ^= w[i]; h = Math.imul(h, 0x01000193); h ^= h >>> 15; }
      }
      const b = new Uint8Array(p.buffer, p.byteOffset + whole * 4, p.byteLength - whole * 4);
      for (let i = 0; i < b.length; i++) mix(b[i]);
    } else {
      const s = typeof p === 'string' ? p : JSON.stringify(p);
      for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); mix(c & 0xff); mix(c >>> 8); }
    }
    mix(0x1f);
  }
  return (h >>> 0).toString(36);
}

const sizeOf = (v) => {
  if (v == null) return 0;
  if (typeof Blob !== 'undefined' && v instanceof Blob) return v.size;
  if (ArrayBuffer.isView(v)) return v.byteLength;
  if (typeof v === 'string') return v.length * 2;
  if (Array.isArray(v)) return v.reduce((s, x) => s + sizeOf(x), 0);
  if (typeof v === 'object') return Object.values(v).reduce((s, x) => s + sizeOf(x), 0);
  return 8;
};

const copy = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : v);

/**
 * A terrain's fingerprint for step keys: its heights, map features, land
 * cover and ground classes, and every small field (bounds, sizes, rules ...).
 * Texture URLs count as they are (a new Generate's are new).
 */
export function terrainFingerprint(td) {
  if (!td) return 'none';
  const small = {};
  for (const [k, v] of Object.entries(td)) {
    if (['heightMap', 'osmFeatures', 'landCover', 'groundClasses', 'sourceGeoTiffs'].includes(k)) continue;
    if (v == null || typeof v === 'function') continue;
    if (ArrayBuffer.isView(v) || (typeof Blob !== 'undefined' && v instanceof Blob)) { small[k] = `#${v.byteLength ?? v.size}`; continue; }
    if (typeof v === 'object') { try { const j = JSON.stringify(v); if (j.length < 200000) small[k] = j; else small[k] = `#${j.length}`; } catch { /* not plain */ } continue; }
    small[k] = v;
  }
  return stepHash(td.heightMap || null, JSON.stringify(td.osmFeatures || []), td.landCover?.grid || null,
    ArrayBuffer.isView(td.groundClasses) ? td.groundClasses : (td.groundClasses?.cls || td.groundClasses?.grid || JSON.stringify(td.groundClasses ?? null)), small);
}

/** An in-memory store (the page): at most maxBytes, the least recently used dropped. */
export function memoryStepCache({ maxBytes = 512 * 1024 ** 2 } = {}) {
  const map = new Map();   // key → { value, size } (insertion order = use order)
  let total = 0;
  return {
    // (copies in and out: an export changes what a step gave it, e.g. paints
    // roads into the materials' layer map, and the kept result must not change)
    async get(key) {
      const e = map.get(key);
      if (!e) return null;
      map.delete(key); map.set(key, e);
      return copy(e.value);
    },
    async set(key, value) {
      const size = sizeOf(value);
      if (size > maxBytes) return;
      value = copy(value);
      if (map.has(key)) { total -= map.get(key).size; map.delete(key); }
      map.set(key, { value, size });
      total += size;
      for (const [k, e] of map) { if (total <= maxBytes) break; map.delete(k); total -= e.size; }
    },
    get size() { return map.size; },
  };
}

// (the page's one store, shared by every export of the session)
let pageCache = null;
export const pageStepCache = () => (pageCache ||= memoryStepCache());

/**
 * Run a step through a store: the cached value when its key is there, else
 * build() and keep the result. Resolves { value, reused }.
 */
export async function cachedStep(store, key, build) {
  if (store && key) {
    try {
      const hit = await store.get(key);
      if (hit != null) return { value: hit, reused: true };
    } catch { /* an unreadable entry: built again */ }
  }
  const value = await build();
  if (store && key && value != null) { try { await store.set(key, value); } catch { /* not kept */ } }
  return { value, reused: false };
}
