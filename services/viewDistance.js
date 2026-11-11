// The level's view distance (LevelInfo visibleDistance: how far the game
// draws). By default it follows the map: its width, 4 km at least and 16 km
// at most, so a big map shows its far land. Advanced mode's Level card can
// name a distance instead (lighter on a weaker PC).
//
// Why not one distance for every map (seen in game, 2026-11-11): with 4 km on a
// 20 km mountain map everything past the near ridge was the flat grey water
// plane, an island where there are hills; 16 km showed the whole map. The
// official levels draw 4.5 km (Hirochi Raceway) to 25 km (Italy): Utah 8,
// East Coast 12, West Coast 15.7. Under 2 km the far edge and the sea plane
// (which needs the terrain inside the far clip) show too easily.
export const VIEW_DISTANCES_M = [2000, 4000, 8000, 12000, 16000];
export const AUTO_VIEW_DISTANCE = 'auto';
const AUTO_MIN_M = 4000;

/** A stored or passed choice: one of the distances (a number), else 'auto'. */
export const viewDistanceChoice = (v) => (VIEW_DISTANCES_M.includes(Number(v)) ? Number(v) : AUTO_VIEW_DISTANCE);

/** The distance that follows a map this wide: the first choice that covers it, 4 km at least, 16 km at most. */
export function autoViewDistance(worldSizeM) {
  const size = Number(worldSizeM) || 0;
  const fits = VIEW_DISTANCES_M.find((d) => d >= AUTO_MIN_M && d >= size);
  return fits ?? VIEW_DISTANCES_M[VIEW_DISTANCES_M.length - 1];
}

/** The metres written to the level: the chosen distance, or the one that follows the map. */
export const viewDistanceMeters = (v, worldSizeM) => {
  const choice = viewDistanceChoice(v);
  return choice === AUTO_VIEW_DISTANCE ? autoViewDistance(worldSizeM) : choice;
};

// Fog hides the far edge (the BeamNG docs: "use fog density to hide far
// clipping"). MapNG's light haze does at 4 km and over; a shorter view gets a
// thicker one. Seen in game (2026-11-11, sea to the horizon): at 2 km the sea
// plane ends in a dark band; 0.0003 softens it and keeps a blue sky with
// clouds, 0.0005 softened it no better and greyed the sky.
export const BASE_FOG_DENSITY = 0.0001;
export const SHORT_VIEW_FOG_DENSITY = 0.0003;
/** The fog for a view distance in metres. */
export const fogDensityFor = (meters) => (Number(meters) < AUTO_MIN_M ? SHORT_VIEW_FOG_DENSITY : BASE_FOG_DENSITY);
