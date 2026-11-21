// Tiles in step 1 (refs/output/tiles-plan.md): one map made of several tiles of the same base size, laid out where the
// user puts them. Tile 0 sits on the map's centre; every tile is an offset from it in whole processing pixels (x east,
// y north). One tile is today's single square, exactly.
//
// - "Together": tiles sit on a grid of whole tiles (a new one goes beside the last; a dragged one lands on the nearest
//   free grid spot).
// - "Free": tiles go anywhere (whole pixels); with snap on, a dragged tile's edge snaps to a neighbour's edge or corner
//   when near (SNAP_FRACTION of a tile), so tiles join without gaps or slivers.
// - The footprint is the union of the tiles; the grid Generate makes is its bounding rectangle. A footprint that fills a
//   power-of-two square is built on a TerrainBlock as today; any other shape becomes ground models.
// - Caps: on the web the export's square (the power of two holding the grid's long side) is held to WEB_MAX_SIDE; the
//   desktop only warns past it.

export const WEB_MAX_SIDE = 16384;
export const SNAP_FRACTION = 0.15;
export const MAX_TILES = 64;   // (a pasted code or saved project with more is cut to this)

/** A fresh layout: one tile. */
export const singleTile = () => [{ dx: 0, dy: 0 }];

const isPow2 = (n) => n > 0 && (n & (n - 1)) === 0;

/** Where a new tile goes: beside the last one, east (in "together", the first free grid spot east of it). */
export function nextTileSpot(tiles, R) {
  const last = tiles[tiles.length - 1] || { dx: 0, dy: 0 };
  let spot = { dx: last.dx + R, dy: last.dy };
  const taken = (s) => tiles.some((t) => Math.abs(t.dx - s.dx) < R && Math.abs(t.dy - s.dy) < R);
  while (taken(spot)) spot = { dx: spot.dx + R, dy: spot.dy };
  return spot;
}

/** A dragged tile's resting place: on the tile grid ("together"), snapped to a neighbour (free + snap), or as dropped. */
export function placeTile(tiles, index, want, R, { together = true, snap = true } = {}) {
  const others = tiles.filter((_, i) => i !== index);
  const r = (v) => Math.round(v);
  if (together) {
    // the nearest grid spot not taken
    const gx = Math.round(want.dx / R); const gy = Math.round(want.dy / R);
    let best = null;
    for (let ring = 0; ring < 6 && !best; ring++) {
      for (let a = -ring; a <= ring; a++) for (let b = -ring; b <= ring; b++) {
        if (Math.max(Math.abs(a), Math.abs(b)) !== ring) continue;
        const s = { dx: (gx + a) * R, dy: (gy + b) * R };
        if (others.some((t) => t.dx === s.dx && t.dy === s.dy)) continue;
        const d = (s.dx - want.dx) ** 2 + (s.dy - want.dy) ** 2;
        if (!best || d < best.d) best = { ...s, d };
      }
    }
    return best ? { dx: best.dx, dy: best.dy } : { dx: r(want.dx), dy: r(want.dy) };
  }
  let dx = r(want.dx); let dy = r(want.dy);
  if (snap && others.length) {
    const reach = SNAP_FRACTION * R;
    // edges: this tile's left/right against a neighbour's right/left (and the same edges lined up), likewise top/bottom
    let bestX = null; let bestY = null;
    for (const t of others) {
      for (const cx of [t.dx + R, t.dx - R, t.dx]) { const d = Math.abs(cx - dx); if (d <= reach && (!bestX || d < bestX.d)) bestX = { v: cx, d }; }
      for (const cy of [t.dy + R, t.dy - R, t.dy]) { const d = Math.abs(cy - dy); if (d <= reach && (!bestY || d < bestY.d)) bestY = { v: cy, d }; }
    }
    if (bestX) dx = bestX.v; if (bestY) dy = bestY.v;
  }
  return { dx, dy };
}

/**
 * The layout as a grid for Generate: { width, height, rects: [[x, y, R, R]...] (rows from the north), centerOffset:
 * { x, y } (the grid's centre from tile 0's centre, in pixels, x east, y north), areaPx (the footprint's pixels),
 * terrainBlock (true: one power-of-two square, built as today), squareSide (the export's square), webOk, overlaps,
 * islands }.
 */
export function layoutGrid(tiles, R) {
  const ts = tiles.length ? tiles : singleTile();
  // tile corners in pixels, x east, y south
  const boxes = ts.map((t) => ({ x0: t.dx - R / 2, y0: -t.dy - R / 2 }));
  const minX = Math.min(...boxes.map((b) => b.x0)); const minY = Math.min(...boxes.map((b) => b.y0));
  const maxX = Math.max(...boxes.map((b) => b.x0 + R)); const maxY = Math.max(...boxes.map((b) => b.y0 + R));
  const width = Math.round(maxX - minX); const height = Math.round(maxY - minY);
  const rects = boxes.map((b) => [Math.round(b.x0 - minX), Math.round(b.y0 - minY), R, R]);
  // the footprint's pixels (overlaps once): rows of merged runs
  let areaPx = 0; let overlaps = false;
  const ys = [...new Set(rects.flatMap(([, y]) => [y, y + R]))].sort((a, b) => a - b);
  for (let k = 0; k + 1 < ys.length; k++) {
    const runs = rects.filter(([, y]) => y <= ys[k] && y + R >= ys[k + 1]).map(([x]) => [x, x + R]).sort((a, b) => a[0] - b[0]);
    let len = 0; let end = -Infinity;
    for (const [a, b] of runs) { if (a < end) overlaps = true; if (b > end) { len += b - Math.max(a, end); end = b; } }
    areaPx += len * (ys[k + 1] - ys[k]);
  }
  // islands: tiles not joined to the first by touching or overlapping
  const touch = (a, b) => a[0] <= b[0] + R && b[0] <= a[0] + R && a[1] <= b[1] + R && b[1] <= a[1] + R;
  const seen = new Set([0]); const stack = [0];
  while (stack.length) { const i = stack.pop(); rects.forEach((r, j) => { if (!seen.has(j) && touch(rects[i], r)) { seen.add(j); stack.push(j); } }); }
  const terrainBlock = width === height && isPow2(width) && areaPx === width * height;
  let squareSide = 1; while (squareSide < Math.max(width, height)) squareSide *= 2;
  return {
    width, height, rects, areaPx, overlaps, islands: seen.size < rects.length,
    centerOffset: { x: minX + width / 2, y: -(minY + height / 2) },
    // (past one grid's square the level is built in chunks; the website's cap is the footprint's own area)
    terrainBlock, squareSide, chunked: squareSide > WEB_MAX_SIDE, webOk: areaPx <= WEB_MAX_SIDE * WEB_MAX_SIDE,
  };
}

/**
 * The tiles a map was made from (terrainData.tiles, set by Generate), checked: { list, tilePx, anchor, together, snap }
 * with tile 0 at the origin, or null for a single square (old maps, one tile).
 */
export function tilesFromTerrain(td) {
  const t = td?.tiles;
  if (!t || !Array.isArray(t.list) || t.list.length < 2) return null;
  const list = t.list.slice(0, MAX_TILES).map((p) => ({ dx: Number(p?.dx) || 0, dy: Number(p?.dy) || 0 }));
  list[0] = { dx: 0, dy: 0 };
  const lat = Number(t.anchor?.lat); const lng = Number(t.anchor?.lng);
  return {
    list, tilePx: Math.max(1, Math.round(Number(t.tilePx) || 1024)),
    anchor: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
    together: t.together !== false, snap: t.snap !== false,
  };
}
