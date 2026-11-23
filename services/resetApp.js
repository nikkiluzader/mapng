// Reset (the sidebar's button, web and desktop): every setting back to its default, the location, the tiles, the
// road and any drawn mask cleared, then the page loaded again as on a first visit (Tile mode, one 1024 x 1024
// tile). The map stays where it is unless the user unticks that: then the location is asked for once more, and
// without it the app starts at the default place.
//
// Kept: what is the user's own and tedious or impossible to give again, and what they chose about their privacy:
// keys and servers, the language, light or dark, the sharing choices, and the app's own bookkeeping.
import { PERSONAL_STORAGE_KEYS } from './personalKeys.js';

export const RESET_KEEPS = new Set([
  ...PERSONAL_STORAGE_KEYS,                                 // the user's own key and server (services/personalKeys.js)
  'mapng_locale',                                           // the language
  // (user, 2026-11-23, dev notes) the top-level mode, the last output size, and two map data choices
  'mapng_advanced_mode', 'mapng_resolution', 'mapng_measureRoadWidths', 'mapng_overtureBuildings',
  'mapng_share_exports', 'mapng_share_settings',            // privacy choices (asked once; never asked again by a reset)
  'mapng_tip_last_shown_at', 'mapng_levelDeleteWarned', 'mapng_reset_asked_at', 'mapng_reset_keep_place',   // "already shown" notes
  'mapng_job_running', 'mapng_overpass_health_v1', 'mapng_overpass_probe_at',   // bookkeeping
]);
// How the panel looks after a reset (user, 2026-11-23): step 1 shows Location and Area & detail, step 2 the
// elevation data source; every other section is closed. Written after the clear, as each section's own stored state.
export const RESET_SECTIONS = {
  mapng_showCoordinates: 'true', mapng_ui_sec_area: 'true', mapng_showElevationSource: 'true',
  mapng_ui_sec_points: 'false', mapng_ui_sec_background: 'false', mapng_ui_sec_mapdata: 'false',
};

/** The stored settings a reset clears: every `mapng_` key but the kept ones. */
export const settingsToClear = (keys) => keys.filter((k) => typeof k === 'string' && k.startsWith('mapng_') && !RESET_KEEPS.has(k));

/**
 * Clears the settings, asks for the location and loads the page again, already at that place (asked before the
 * reload: a place arriving after it moved a map that was still settling, and left it part of the way there).
 * With keepPlace (the question's checkbox, on unless switched off) the map stays where it is and nothing is asked.
 * Returns { cleared (keys), here (the location or null) }.
 */
export async function resetApp({ storage = globalThis.localStorage, locate = askLocation, reload = () => globalThis.location.reload(), keepPlace = resetKeepsPlace(storage) } = {}) {
  // (keep the map where it is: the place and the zoom survive, and no location is asked for)
  const place = keepPlace ? PLACE_KEYS.map((k) => { try { return [k, storage.getItem(k)]; } catch { return [k, null]; } }).filter(([, v]) => v != null) : [];
  const clear = () => {
    const keys = [];
    try { for (let i = 0; i < storage.length; i++) keys.push(storage.key(i)); } catch { /* private mode */ }
    const gone = settingsToClear(keys);
    for (const k of gone) { try { storage.removeItem(k); } catch { /* private mode */ } }
    return gone;
  };
  const cleared = clear();
  const here = keepPlace ? null : await locate();
  // (again: nothing the page stored while the question was open survives)
  cleared.push(...clear());
  if (here) { try { storage.setItem('mapng_center', JSON.stringify(here)); } catch { /* private mode */ } }
  for (const [k, v] of Object.entries(RESET_SECTIONS)) { try { storage.setItem(k, v); } catch { /* private mode */ } }
  for (const [k, v] of place) { try { storage.setItem(k, v); } catch { /* private mode */ } }
  reload();
  return { cleared, here };
}

/** The user's position, or null when it is refused, unsupported or late (8 s). */
export function askLocation(geo = globalThis.navigator?.geolocation) {
  return new Promise((resolve) => {
    if (!geo?.getCurrentPosition) { resolve(null); return; }
    geo.getCurrentPosition(
      (p) => resolve(Number.isFinite(p?.coords?.latitude) && Number.isFinite(p?.coords?.longitude) ? { lat: p.coords.latitude, lng: p.coords.longitude } : null),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 },
    );
  });
}

// The question before a reset is asked once a week at most (user, 2026-11-23: "i tend to click it a lot myself, and
// the extra pop up can be kind of annoying"): answered with Reset, it stays away for RESET_ASK_EVERY_MS.
export const RESET_ASKED_KEY = 'mapng_reset_asked_at';
export const RESET_ASK_EVERY_MS = 7 * 24 * 3600 * 1000;
/** Whether to ask before this reset. */
export function resetNeedsAsking(storage = globalThis.localStorage, now = Date.now()) {
  try { const at = Number(storage.getItem(RESET_ASKED_KEY)); return !(Number.isFinite(at) && at > 0 && now - at >= 0 && now - at < RESET_ASK_EVERY_MS); } catch { return true; }
}
/** The question was answered with Reset: not asked again for a week. */
export function noteResetAsked(storage = globalThis.localStorage, now = Date.now()) {
  try { storage.setItem(RESET_ASKED_KEY, String(now)); } catch { /* private mode */ }
}

// "Keep the map where it is" (user, 2026-11-23: on by default, so a reset does not lose the spot on the map): the
// choice is remembered, and holds for the resets that skip the question.
export const RESET_KEEP_PLACE_KEY = 'mapng_reset_keep_place';
const PLACE_KEYS = ['mapng_center', 'mapng_zoom'];
export function resetKeepsPlace(storage = globalThis.localStorage) { try { return storage.getItem(RESET_KEEP_PLACE_KEY) !== 'false'; } catch { return true; } }
export function setResetKeepsPlace(on, storage = globalThis.localStorage) { try { storage.setItem(RESET_KEEP_PLACE_KEY, on ? 'true' : 'false'); } catch { /* private mode */ } }
