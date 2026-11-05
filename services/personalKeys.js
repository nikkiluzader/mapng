// Personal settings that belong to this user only: keys, their own server
// addresses, and what their GPXZ account allows. A config from someone else
// (pasted, loaded, sent with a code, Modify) never carries or changes these,
// and MapNG never puts them into a config it makes. Add new personal
// settings here: tests/personalKeys.test.mjs holds every config path to it.

/** Where they're kept (localStorage). */
export const PERSONAL_STORAGE_KEYS = [
  'mapng_gpxzApiKey',
  'mapng_customOverpassUrl',
];

/** Their names inside configs, run configurations and export options. */
export const PERSONAL_CONFIG_FIELDS = [
  'gpxzApiKey', 'gpxzApiKeyMasked', 'gpxzStatus', 'gpxzKeySig',
  'backdropGpxzApiKey', 'customOverpassUrl', 'overpassUrl',
];

// (anything named like a key, token or password counts as personal too)
const SECRET_RE = /key|token|secret|password|auth/i;
const isPersonal = (name) => PERSONAL_CONFIG_FIELDS.includes(name) || SECRET_RE.test(name);

/** A copy without any personal setting, at any depth. */
export function withoutPersonal(value, depth = 0) {
  if (value == null || typeof value !== 'object' || depth > 8) return value;
  if (Array.isArray(value)) return value.map((v) => withoutPersonal(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (!isPersonal(k)) out[k] = withoutPersonal(v, depth + 1);
  }
  return out;
}
