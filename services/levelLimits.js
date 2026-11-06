// How big a level MapNG makes, and what it says about bigger ones.
//
// 16384 × 16384 px is the largest level MapNG is tested at (a single tile
// tops out there too). A combined batch level past it is "experimental" in
// the desktop app: allowed after a clear warning the user accepts. In a
// browser it stays blocked, since the tab's ~4 GB heap can't hold the
// exporter's full-grid buffers (1 GiB each at 16384²) for anything bigger.
//
// Huge areas are better made as one tile at a coarser m per pixel (2, 4, 8):
// the terrain file stays a normal size and BeamNG spaces its squares out
// (squareSize). The risk there is the amount of OSM data, not the terrain.

export const LEVEL_TESTED_MAX_PX = 16384;
// a single tile this many km across or more gets the "lots of OSM data" note
export const BIG_AREA_KM = 16;
// BeamNG: objects farther than this from the level's centre can start to
// shake (float precision; BeamNG QA)
export const SHAKE_DISTANCE_KM = 30;

/** 'ok', 'experimental' (desktop, past the tested size) or 'disabled' (browser, past it). */
export function combinedLevelTier(dimPx, { desktop = false } = {}) {
  if (dimPx <= LEVEL_TESTED_MAX_PX) return 'ok';
  return desktop ? 'experimental' : 'disabled';
}

/** The terrain file's size in GB (.ter: 2 bytes of height and 1 of material per square). */
export const terrainFileGB = (dimPx) => (dimPx * dimPx * 3) / 1e9;

/** Whether a level this many km across reaches past the shaking distance from its centre. */
export const reachesShakeDistance = (sideKm) => sideKm / 2 > SHAKE_DISTANCE_KM;
