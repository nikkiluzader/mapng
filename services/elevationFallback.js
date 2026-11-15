// The elevation source to try when the chosen one has nothing for a place (outside its coverage, or it did not
// answer), before the global 30 m that backs every source. A request from a tester near Poland's border: the
// Polish survey first, free lidar second, the 30 m last.
export const FALLBACK_STANDARD = 'standard';   // straight to the global 30 m (the default: as it always was)
export const FALLBACK_SOURCES = [FALLBACK_STANDARD, 'mapterhorn', 'kron86', 'usgs', 'gpxz'];
export const DEFAULT_FALLBACK_SOURCE = FALLBACK_STANDARD;
// Sources that can have a fallback: the ones that cover part of the world (an upload has its own gap fill;
// flat ground and the global 30 m need none).
const HAS_FALLBACK = new Set(['mapterhorn', 'kron86', 'usgs', 'gpxz']);

/** The fallback as stored: a known source, never the chosen source itself, 'standard' otherwise. */
export function normalizeFallbackSource(value, primary = '') {
  const v = String(value || '').toLowerCase();
  if (!FALLBACK_SOURCES.includes(v) || v === String(primary || '').toLowerCase()) return DEFAULT_FALLBACK_SOURCE;
  return HAS_FALLBACK.has(String(primary || '').toLowerCase()) || !primary ? v : DEFAULT_FALLBACK_SOURCE;
}

/** Whether the chosen source can have one at all (the control is shown for these). */
export const sourceTakesFallback = (primary) => HAS_FALLBACK.has(String(primary || '').toLowerCase());

/**
 * The sources to try, in order, each once: the chosen ones (as before, when several are switched on: GPXZ,
 * Mapterhorn, the Polish survey, USGS), then the fallback. The global 30 m follows whatever is left without data.
 */
export function elevationTryOrder({ useGPXZ = false, useMapterhorn = false, useKRON86 = false, useUSGS = false, fallbackSource = '' } = {}) {
  const order = [];
  if (useGPXZ) order.push('gpxz');
  if (useMapterhorn) order.push('mapterhorn');
  if (useKRON86) order.push('kron86');
  if (useUSGS) order.push('usgs');
  const fb = String(fallbackSource || '').toLowerCase();
  if (order.length && HAS_FALLBACK.has(fb) && !order.includes(fb)) order.push(fb);
  return order;
}
