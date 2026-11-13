// The civil time at a place: its UTC offset on a given day, daylight saving included.
//
// A level's TimeOfDay takes utcOffset (BeamNG's docs: "exact civil UTC offset in hours, including DST"). Left
// out, the game works one out from the longitude (the nearest 15 degrees) and a guessed daylight-saving rule:
// right where clocks follow the sun, an hour or two off where they do not (France and Spain keep Central
// European time, China one time for five zones; a BeamNG developer's report, 2026-11-13). The zone is read from
// the place (tz-lookup: time zone outlines, public domain) and its offset on the day from the browser's or
// Node's own time zone tables.

/** Hours east of UTC at an instant in an IANA zone ("Europe/Paris"), or null when the zone is not known here. */
export function zoneOffsetHours(zone, date) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(date);
    const v = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
    const asUtc = Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second);
    return Math.round(((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 3600000) * 4) / 4;   // (to the quarter hour: Nepal is +5:45)
  } catch { return null; }
}

/**
 * { zone, utcOffset } for a place on a day ({ year, month, day }, at local noon), or null when it cannot be told
 * (the game then falls back to its own rule from the longitude).
 */
export async function civilTimeAt(lat, lng, day) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  try {
    const mod = await import('@photostructure/tz-lookup');
    const lookup = mod.default || mod;
    const zone = lookup(lat, lng);
    if (!zone) return null;
    // (noon UTC of the day, nudged by the longitude: near enough to local midday to be on the right side of a
    // daylight-saving change, which happens in the small hours)
    const at = new Date(Date.UTC(day.year, day.month - 1, day.day, 12, 0, 0) - (lng / 15) * 3600000);
    const utcOffset = zoneOffsetHours(zone, at);
    return utcOffset === null ? null : { zone, utcOffset };
  } catch { return null; }
}
