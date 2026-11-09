// What never goes into a problem report (desktop/crashReports.js): keys,
// tokens and passwords; the user's home folder (it holds their account name);
// location fields when the user unticks the location. No Electron here, so
// tests can load it.
import os from 'node:os';

// never in a report: keys, tokens, passwords (GPXZ / Overpass keys live in the options)
const SECRET_KEY_RE = /key|token|secret|password|auth/i;
// (points: the user's spawn and quicktravel points, named places on the map)
const LOCATION_KEY_RE = /^(center|centre|lat|lng|lon|latitude|longitude|bounds|bbox|points|backgroundMask)$/i;

/** Export options with secrets removed (and location fields, when the user unticks the location). */
export function cleanOptions(options, { keepLocation = true } = {}) {
  if (!options || typeof options !== 'object') return null;
  const walk = (v, depth) => {
    if (v == null || typeof v !== 'object') return typeof v === 'string' ? v.slice(0, 500) : v;
    if (depth > 4) return undefined;
    if (Array.isArray(v)) return v.length > 50 ? `[${v.length} items]` : v.map((x) => walk(x, depth + 1));
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (SECRET_KEY_RE.test(k) || typeof x === 'function') continue;
      if (!keepLocation && LOCATION_KEY_RE.test(k)) continue;
      const w = walk(x, depth + 1);
      if (w !== undefined) out[k] = w;
    }
    return out;
  };
  return walk(options, 0);
}

/** The user's home folder (which holds their account name) written as ~, and key-looking values hidden. */
export function scrubText(text, home = os.homedir()) {
  let t = String(text || '');
  if (home) {
    for (const h of new Set([home, home.replace(/\\/g, '/')])) t = t.split(h).join('~');
  }
  return t.replace(/((?:api[_-]?key|key|token|secret|password)["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi, '$1[hidden]');
}
