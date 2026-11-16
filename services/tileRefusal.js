// Whether a base map's tile server is refusing this visitor. Tiles are images: the page cannot read their status,
// only that they failed. OpenStreetMap's own tile server turns heavy users away with "429 Access denied" (its tile
// usage policy), for hours: the map was plain grey and nothing said why. A server is taken as refusing when
// REFUSED_AFTER tiles in a row have failed and none has loaded since the layer was shown; one loaded tile clears it
// (a single missing tile, or a slow network, is no refusal).
export const REFUSED_AFTER = 6;

export function tileRefusalWatch(onRefused, after = REFUSED_AFTER) {
  let failed = 0; let loaded = 0; let told = false;
  return {
    error() { failed++; if (!told && !loaded && failed >= after) { told = true; onRefused(); } },
    load() { loaded++; failed = 0; },
    reset() { failed = 0; loaded = 0; told = false; },
    get state() { return { failed, loaded, told }; },
  };
}
