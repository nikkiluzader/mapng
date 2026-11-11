// The level's view distance (LevelInfo visibleDistance: how far the game
// draws), a choice in the export panel's Level card (advanced). Shorter loads
// and runs lighter on a big or dense level; the game's own setting can only be
// changed after the level has loaded once.
export const VIEW_DISTANCES_M = [1000, 2000, 4000, 8000];
export const DEFAULT_VIEW_DISTANCE_M = 4000;

/** A stored or passed value as one of the distances (anything else: the default). */
export const viewDistanceMeters = (v) => (VIEW_DISTANCES_M.includes(Number(v)) ? Number(v) : DEFAULT_VIEW_DISTANCE_M);
