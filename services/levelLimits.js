// What MapNG says about very big areas.
//
// Huge areas are better made at a coarser m per pixel (2, 4, 8): the terrain file stays a normal size and BeamNG
// spaces its squares out (squareSize). The risk there is the amount of OSM data, not the terrain.

// a single tile this many km across or more gets the "lots of OSM data" note
export const BIG_AREA_KM = 16;
// BeamNG: objects farther than this from the level's centre can start to
// shake (float precision; BeamNG QA)
export const SHAKE_DISTANCE_KM = 30;

/** Whether a level this many km across reaches past the shaking distance from its centre. */
export const reachesShakeDistance = (sideKm) => sideKm / 2 > SHAKE_DISTANCE_KM;
