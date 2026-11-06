// The default elevation source: Mapterhorn (free lidar where a national survey exists, Standard 30 m elsewhere).
// Until 2026-11, Standard 30 m was the default, so most saved "default" choices are the old default rather than a
// decision: they move to Mapterhorn once (a flag per setting), and a later switch back to Standard is kept.
export const DEFAULT_ELEVATION_SOURCE = 'mapterhorn';
const MIGRATED_SUFFIX = '_mapterhornDefault';

export function initialElevationSource(storageKey, storage = globalThis.localStorage) {
  let stored = null;
  try { stored = storage?.getItem(storageKey) ?? null; } catch { return DEFAULT_ELEVATION_SOURCE; }
  if (!stored) return DEFAULT_ELEVATION_SOURCE;
  try {
    if (stored === 'default' && !storage.getItem(storageKey + MIGRATED_SUFFIX)) {
      storage.setItem(storageKey + MIGRATED_SUFFIX, '1');
      storage.setItem(storageKey, DEFAULT_ELEVATION_SOURCE);
      return DEFAULT_ELEVATION_SOURCE;
    }
    if (!storage.getItem(storageKey + MIGRATED_SUFFIX)) storage.setItem(storageKey + MIGRATED_SUFFIX, '1');
  } catch { /* private mode: keep what was read */ }
  return stored;
}
