// The level's view distance (LevelInfo visibleDistance: how far the game
// draws), a choice in the export panel's Level card (advanced). Shorter loads
// and runs lighter on a big or dense level; the game's own setting can only be
// changed after the level has loaded once.
// The official levels draw 4.5 km (Hirochi Raceway) to 25 km (Italy): Utah 8,
// East Coast 12, West Coast 15.7. Under 2 km the far edge and the sea plane
// (which needs the terrain inside the far clip) show too easily.
export const VIEW_DISTANCES_M = [2000, 4000, 8000, 12000, 16000];
export const DEFAULT_VIEW_DISTANCE_M = 4000;

/** A stored or passed value as one of the distances (anything else: the default). */
export const viewDistanceMeters = (v) => (VIEW_DISTANCES_M.includes(Number(v)) ? Number(v) : DEFAULT_VIEW_DISTANCE_M);

// Fog hides the far edge (the BeamNG docs: "use fog density to hide far
// clipping"). MapNG's light haze does at 4 km and over; a shorter view gets a
// thicker one. Seen in game (2026-11-11, sea to the horizon): at 2 km the sea
// plane ends in a dark band; 0.0003 softens it and keeps a blue sky with
// clouds, 0.0005 softened it no better and greyed the sky.
export const BASE_FOG_DENSITY = 0.0001;
export const SHORT_VIEW_FOG_DENSITY = 0.0003;
export const fogDensityFor = (viewDistance) => {
  const d = viewDistanceMeters(viewDistance);
  return d < DEFAULT_VIEW_DISTANCE_M ? SHORT_VIEW_FOG_DENSITY : BASE_FOG_DENSITY;
};
