// polygon-clipping with its input on a 1 cm grid. Off the grid, near-touching
// edges now and then sent its sweep line round forever: a walkway strip with
// 409 curb cuts spun for half an hour without returning or throwing (the
// export stuck at "Building sidewalks"); on the grid the same shapes took
// 48 ms. Snapped, a bad case throws instead, which every caller catches.
import polygonClipping from 'polygon-clipping';

const GRID = 100; // per metre

/** A point, ring, polygon or multipolygon with its coordinates on the grid. */
export function snapGeom(g) {
  if (typeof g[0] === 'number') return [Math.round(g[0] * GRID) / GRID, Math.round(g[1] * GRID) / GRID];
  return g.map(snapGeom);
}

const op = (fn) => (geom, ...more) => fn(snapGeom(geom), ...more.map(snapGeom));

export default {
  union: op(polygonClipping.union),
  intersection: op(polygonClipping.intersection),
  difference: op(polygonClipping.difference),
  xor: op(polygonClipping.xor),
};
