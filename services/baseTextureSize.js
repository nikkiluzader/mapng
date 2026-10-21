// Base texture resolution relative to the terrain grid.
//
// BeamNG samples the terrain base texture at uv / *BaseTexSize with uv in grid
// squares (shaders/common/terrain/terrain.h.hlsl), so the texture's pixel count
// is independent of the grid; only the span is in grid squares. Official levels
// use this: west_coast_usa has a 2048 grid with a 4096 base texture,
// small_island and driver_training a 1024 grid with a 2048 one. No official
// level is larger than 4096, and none uses a base texture above 4096.

export const BASE_TEXTURE_SCALE = 2;
// Grids above this keep one texel per grid square (they already sit at the cap).
export const BASE_TEXTURE_SCALE_MAX_GRID = 4096;
export const BASE_TEXTURE_MAX_PX = 8192;

/** Pixel size of the satellite / hybrid texture generated for a grid. */
export function getBaseTextureSize(gridSize) {
  const grid = Math.max(1, Math.floor(Number(gridSize) || 0));
  const scale = grid <= BASE_TEXTURE_SCALE_MAX_GRID ? BASE_TEXTURE_SCALE : 1;
  return Math.max(1, Math.min(BASE_TEXTURE_MAX_PX, grid * scale));
}

/**
 * Base texture size for an export: the 2× size when the supplied texture
 * carries that much detail, otherwise the grid size (OSM texture, flat
 * placeholder, levels generated before 2× textures). Never upscales a texture
 * just to fill a larger slot.
 */
export function chooseBaseTextureSize(textureWidth, gridSize) {
  const grid = Math.max(1, Math.floor(Number(gridSize) || 0));
  const target = getBaseTextureSize(grid);
  if (target > grid && Number(textureWidth) >= target) return target;
  return grid;
}
