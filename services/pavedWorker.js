// A paved-area tile on a worker thread (services/pavedSidewalks.js): the grid and its outlines, plain data in and
// out (no heights: meshing and grading, which read the terrain, stay on the export's thread and are cheap).
import { makeGrid, buildPavedGrid, traceOutlines, markPolygon, WALK, GAP, ROAD } from './pavedArea.js';

/** item: { box, roads, cornerArcs, walks, streetWalks, greenery, buildings } -> { cells, g, rings } */
export function pavedTile(item) {
  const [x0, y0, x1, y1] = item.box;
  const g = makeGrid(x0, y0, x1, y1);
  const { cells } = buildPavedGrid(g, item);
  // (paved pockets by the seawalls, found as today: paved where they are not road, their holes left)
  if (item.pockets?.length) {
    const inP = new Uint8Array(cells.length); const inH = new Uint8Array(cells.length);
    for (const poly of item.pockets) { markPolygon(inP, g, poly[0], 1); for (const h of poly.slice(1)) markPolygon(inH, g, h, 1); }
    for (let i = 0; i < cells.length; i++) if (inP[i] && !inH[i] && !(cells[i] & ROAD)) cells[i] |= GAP;
  }
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
