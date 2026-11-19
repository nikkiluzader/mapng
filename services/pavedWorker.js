// A paved-area tile on a worker thread (services/pavedSidewalks.js): the grid and its outlines, plain data in and
// out (no heights: meshing and grading, which read the terrain, stay on the export's thread and are cheap).
import { makeGrid, buildPavedGrid, traceOutlines, markPolygon, WALK, GAP } from './pavedArea.js';

/** item: { box, roads, cornerArcs, walks, streetWalks, greenery, buildings } -> { cells, g, rings } */
export function pavedTile(item) {
  const [x0, y0, x1, y1] = item.box;
  const g = makeGrid(x0, y0, x1, y1);
  const { cells } = buildPavedGrid(g, item);
  // (no slab into a building)
  if (item.buildings?.length) {
    const inB = new Uint8Array(cells.length);
    for (const ring of item.buildings) markPolygon(inB, g, ring, 1);
    for (let i = 0; i < cells.length; i++) if (inB[i]) cells[i] &= ~(WALK | GAP);
  }
  return { cells, g, rings: traceOutlines(cells, g, WALK | GAP) };
}

/** A batch for a worker: each item's tile. */
export function pavedTiles(items) { return items.map(pavedTile); }
