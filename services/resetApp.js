// Reset (the sidebar's button, web and desktop): every setting back to its default, the location, the tiles, the
// road and any drawn mask cleared, the user's location asked for once more, then the page loaded again. It starts
// as on a first visit (Tile mode, one 1024 x 1024 tile) at that location; without it, at the default place.
//
// Kept: what is the user's own and tedious or impossible to give again, and what they chose about their privacy:
// keys and servers, the language, light or dark, the sharing choices, and the app's own bookkeeping.
export const RESET_KEEPS = new Set([
  'mapng_gpxzApiKey', 'mapng_customOverpassUrl',           // the user's own key and server
  'mapng_locale',                                           // the language
  'mapng_share_exports', 'mapng_share_settings',            // privacy choices (asked once; never asked again by a reset)
  'mapng_tip_last_shown_at', 'mapng_levelDeleteWarned',     // "already shown" notes
  'mapng_job_running', 'mapng_overpass_health_v1', 'mapng_overpass_probe_at',   // bookkeeping
]);
/** The stored settings a reset clears: every `mapng_` key but the kept ones. */
export const settingsToClear = (keys) => keys.filter((k) => typeof k === 'string' && k.startsWith('mapng_') && !RESET_KEEPS.has(k));

/**
 * Clears the settings, asks for the location and loads the page again, already at that place (asked before the
 * reload: a place arriving after it moved a map that was still settling, and left it part of the way there).
 * Returns { cleared (keys), here (the location or null) }.
 */
export async function resetApp({ storage = globalThis.localStorage, locate = askLocation, reload = () => globalThis.location.reload() } = {}) {
  const clear = () => {
    const keys = [];
    try { for (let i = 0; i < storage.length; i++) keys.push(storage.key(i)); } catch { /* private mode */ }
    const gone = settingsToClear(keys);
    for (const k of gone) { try { storage.removeItem(k); } catch { /* private mode */ } }
    return gone;
  };
  const cleared = clear();
  const here = await locate();
  // (again: nothing the page stored while the question was open survives)
  cleared.push(...clear());
  if (here) { try { storage.setItem('mapng_center', JSON.stringify(here)); } catch { /* private mode */ } }
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
