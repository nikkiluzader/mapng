// The 3D terrain model's mesh: how far apart its points are, and what that costs, said before the download.
// (A tester's 16 km map came out with a point every 16 m and no word of it: the export thinned it to a fixed
// 1,024 points a side. The spacing is chosen now, and its point count and file size are shown.)

export const MESH_STRIDES = [1, 2, 4, 8, 16];
const AUTO_MAX_POINTS = 2049 * 2049;       // what "Auto" stays within: a mesh every tool opens
export const MESH_MAX_POINTS = 4097 * 4097; // past this one file is refused: the browser cannot build it
// (the terrain mesh alone, as measured in a GLB: position, normal and texture coordinate for a point, two
// triangles a square, about 51 bytes a point. The buildings, trees and a texture in the same file come on top:
// 8 MB of a 512 m town's 21.5 MB.)
const BYTES_PER_POINT = 52;

/** The mesh for one stride (every nth height): { stride, spacingM, side, points, bytes, tooBig }. */
export function meshPlan(sizePx, metersPerPixel, stride) {
  const size = Math.max(2, Math.round(Number(sizePx) || 0)); const mpp = Number(metersPerPixel) > 0 ? Number(metersPerPixel) : 1;
  const s = Math.max(1, Math.round(Number(stride) || 1));
  const side = Math.floor((size - 1) / s) + 1; const points = side * side;
  return { stride: s, spacingM: s * mpp, side, points, bytes: points * BYTES_PER_POINT, tooBig: points > MESH_MAX_POINTS };
}

/** The finest stride whose mesh stays within what "Auto" allows. */
export function autoStride(sizePx) {
  const size = Math.max(2, Math.round(Number(sizePx) || 0));
  return MESH_STRIDES.find((s) => (Math.floor((size - 1) / s) + 1) ** 2 <= AUTO_MAX_POINTS) || MESH_STRIDES[MESH_STRIDES.length - 1];
}

/** The stride a stored choice means ('auto' or a number of heights). */
export function strideOf(choice, sizePx) {
  const n = Number(choice);
  return MESH_STRIDES.includes(n) ? n : autoStride(sizePx);
}

/** What the mesh export is told (its "most points a side") so that it thins by exactly this stride. */
export const maxMeshResolutionFor = (sizePx, stride) => Math.ceil(Math.max(2, Number(sizePx) || 0) / Math.max(1, stride));
