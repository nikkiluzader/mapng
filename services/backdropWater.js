// Water carried out over the backdrop: the lakes, ponds, reservoirs, wide
// rivers and streams round the map (the export's data step fetched them for
// the whole backdrop area, not cut at the map's edge), as the map's own are
// built: lake WaterBlocks at each lake's level and River ribbons, but only
// outside the map's square (inside it the map's own water stands). A lake
// running off the map keeps the map's level for it, so no step shows at the
// edge; the backdrop's ground (its coarse 30 m elevations) gives the rest.
// Without it the map's lakes stopped dead at its edge, the backdrop's
// satellite photo of the same lake in a different colour beyond.
import { planLakes, planRivers, LAKE_TILE_OVERLAP_M } from './beamngWater.js';

/** Height at world (x, y) from the backdrop tiles' coarse elevations (world z: elevation - minHeight), or NaN. */
export function backdropHeightSampler(heights, { bounds, worldSize, minHeight = 0 }) {
  const tiles = (heights || []).filter((t) => t?.heightMap && t.width > 1 && t.height > 1);
  if (!tiles.length) return () => NaN;
  return (x, y) => {
    const lat = bounds.north - (0.5 - y / worldSize) * (bounds.north - bounds.south);
    const lng = bounds.west + (x / worldSize + 0.5) * (bounds.east - bounds.west);
    for (const t of tiles) {
      const b = t.bounds;
      if (lat > b.north || lat < b.south || lng < b.west || lng > b.east) continue;
      const u = ((lng - b.west) / (b.east - b.west)) * (t.width - 1);
      const v = ((b.north - lat) / (b.north - b.south)) * (t.height - 1);
      const x0 = Math.min(t.width - 2, Math.max(0, Math.floor(u))); const y0 = Math.min(t.height - 2, Math.max(0, Math.floor(v)));
      const fx = Math.min(1, Math.max(0, u - x0)); const fy = Math.min(1, Math.max(0, v - y0));
      const at = (cx, cy) => t.heightMap[cy * t.width + cx];
      const h = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
      return Number.isFinite(h) && h > -10000 ? h - minHeight : NaN;
    }
    return NaN;
  };
}

// The parts of an axis-aligned tile outside the square |x|, |y| <= half (up to four rectangles).
function outsideParts(tile, half) {
  const x0 = tile.cx - tile.sx / 2; const x1 = tile.cx + tile.sx / 2;
  const y0 = tile.cy - tile.sy / 2; const y1 = tile.cy + tile.sy / 2;
  if (x1 <= -half || x0 >= half || y1 <= -half || y0 >= half) return [tile];   // wholly outside
  if (x0 >= -half && x1 <= half && y0 >= -half && y1 <= half) return [];        // wholly inside
  const out = [];
  const rect = (a, b, c, d) => { if (b - a > 0.5 && d - c > 0.5) out.push({ ...tile, cx: (a + b) / 2, cy: (c + d) / 2, sx: b - a, sy: d - c }); };
  rect(x0, x1, half, y1);                                        // north band
  rect(x0, x1, y0, -half);                                       // south band
  const ya = Math.max(y0, -half); const yb = Math.min(y1, half);
  rect(x0, -half, ya, yb);                                       // west
  rect(half, x1, ya, yb);                                        // east
  return out;
}

// The part of an axis-aligned tile inside the square |x|, |y| <= half, or null.
export function insidePart(tile, half) {
  const x0 = Math.max(-half, tile.cx - tile.sx / 2); const x1 = Math.min(half, tile.cx + tile.sx / 2);
  const y0 = Math.max(-half, tile.cy - tile.sy / 2); const y1 = Math.min(half, tile.cy + tile.sy / 2);
  if (x1 - x0 < 0.5 || y1 - y0 < 0.5) return null;
  return { ...tile, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, sx: x1 - x0, sy: y1 - y0 };
}
// (a lake crossing the map's edge: the backdrop's water reaches this far in,
// the map's own blocks for it end there: the map's last row of cells along
// the cut edge was left dry as "shore", a strip with no water at the edge)
export const EDGE_HANDOVER_M = 70;
export const BACKDROP_CELL_M = 24;          // the backdrop's lake tiles: no finer than this
export const BACKDROP_MIN_AREA_M2 = 2500;   // a pond wholly outside the map and smaller than this: not built

/**
 * The backdrop's water. features: the data step's water (lat/lng); bounds,
 * worldSize: the map's; groundAt(x, y): the map's terrain inside its square,
 * the backdrop's beyond (world z); mapLakes: the map's own planned lakes
 * ({ poly, level }); seaZ: the sea plane (lakes at or under it are the sea's).
 * Returns { tiles (lake WaterBlock rectangles), rivers (planRivers' shape),
 * stats }.
 */
export function planBackdropWater({ features = [], bounds, worldSize, groundAt, mapLakes = [], seaZ = null }) {
  const half = worldSize / 2;
  const toWorld = (lat, lng) => [((lng - bounds.west) / (bounds.east - bounds.west) - 0.5) * worldSize, (0.5 - (bounds.north - lat) / (bounds.north - bounds.south)) * worldSize];
  const heightAt = (x, y) => { const h = groundAt(x, y); return Number.isFinite(h) ? h : 0; };
  // (only water that reaches out past the map's square)
  const outside = (f) => (f.geometry || []).some((p) => { const [x, y] = toWorld(p.lat, p.lng); return Math.abs(x) > half || Math.abs(y) > half; });
  // Seen only from the map, kilometres off, over ground known every 30 m: a pond wholly outside the map and
  // under BACKDROP_MIN_AREA_M2 is left out, and the rest are tiled no finer than BACKDROP_CELL_M. Tiled like
  // the map's own lakes (2 to 4 m cells) an 8 km map in lake country got 9,171 WaterBlocks round it for 692
  // lakes, each an object the game draws on its own: a BeamNG developer's level ran at 6 frames a second.
  const whollyOut = (f) => (f.geometry || []).every((p) => { const [x, y] = toWorld(p.lat, p.lng); return Math.abs(x) > half || Math.abs(y) > half; });
  const areaOf = (f) => { const q = (f.geometry || []).map((p) => toWorld(p.lat, p.lng)); let a = 0; for (let i = 0; i < q.length; i++) { const r = q[(i + 1) % q.length]; a += q[i][0] * r[1] - r[0] * q[i][1]; } return Math.abs(a) / 2; };
  const closed = (f) => { const g = f.geometry || []; return g.length > 3 && g[0].lat === g[g.length - 1].lat && g[0].lng === g[g.length - 1].lng; };
  let smallLeftOut = 0;
  const wet = features.filter((f) => {
    if (f?.type !== 'water' || !outside(f)) return false;
    if (closed(f) && whollyOut(f) && areaOf(f) < BACKDROP_MIN_AREA_M2) { smallLeftOut++; return false; }
    return true;
  });
  const lakes = planLakes({ features: wet, toWorld, heightAt, seaZ, minCell: BACKDROP_CELL_M });
  // a lake running off the map: the map's level for it (no step at the edge)
  const mapLakeOf = lakes.lakes.map((lk) => {
    const k = mapLakes.findIndex((m) => {
      // (the map lake's outline corners and edge midpoints well inside the map, inside this lake)
      // (nudged 5 % towards its middle: points on a shared shore are on both outlines)
      const ring = m.poly?.outer || [];
      const cx = ring.reduce((t, p) => t + p[0], 0) / (ring.length || 1); const cy = ring.reduce((t, p) => t + p[1], 0) / (ring.length || 1);
      const nudge = ([x, y]) => [x + (cx - x) * 0.05, y + (cy - y) * 0.05];
      let n = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]; const b = ring[(i + 1) % ring.length];
        for (const [x, y] of [nudge(a), nudge([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])]) {
          if (Math.abs(x) < half - 2 && Math.abs(y) < half - 2 && lk.poly.contains(x, y)) n++;
        }
      }
      return n >= 2;
    });
    return k >= 0 ? k : null;
  });
  const levelOf = lakes.lakes.map((lk, i) => (mapLakeOf[i] != null ? mapLakes[mapLakeOf[i]].level : lk.level));
  // (a lake reaching into the map: its water comes in EDGE_HANDOVER_M past the
  // edge, over the map's last row of cells there, at the same level: no strip
  // without water between the two, whichever of OSM's outlines each was planned from)
  const reachesIn = lakes.lakes.map((lk) => {
    const [x0, y0, x1, y1] = lk.poly.box;
    return x0 < half && x1 > -half && y0 < half && y1 > -half;
  });
  const handedOver = new Set();
  const tiles = [];
  for (const t of lakes.tiles) {
    const z = levelOf[t.lake] ?? t.z;
    // (edge to edge, no overlap: two blocks over the backdrop's shallow ground showed doubled)
    const flush = { ...t, z, sx: Math.max(0.5, t.sx - LAKE_TILE_OVERLAP_M), sy: Math.max(0.5, t.sy - LAKE_TILE_OVERLAP_M) };
    const edge = reachesIn[t.lake] ? half - EDGE_HANDOVER_M : half;
    for (const part of outsideParts(flush, edge)) tiles.push({ ...part, lake: `bd${t.lake}` });
  }
  // rivers: each one's runs outside the square, a node inside kept at each
  // end so the ribbon meets the map's own at the edge
  const riverPlan = planRivers({ features: wet, toWorld, heightAt });
  const rivers = [];
  let streamsLeftOut = 0;
  for (const r of riverPlan.rivers) {
    let run = [];
    const isOut = (n) => Math.abs(n[0]) > half || Math.abs(n[1]) > half;
    // (a stream or ditch that never comes onto the map: a metre or two of water kilometres away, one more
    // object each for the game to draw: 890 of them round the same 8 km map. Rivers and canals are kept, and
    // any stream that reaches the map, so it does not stop at the edge.)
    if (r.kind !== 'river' && r.kind !== 'canal' && r.nodes.every(isOut)) { streamsLeftOut++; continue; }
    r.nodes.forEach((n, i) => {
      if (isOut(n)) {
        if (!run.length && i > 0) run.push(r.nodes[i - 1]);
        run.push(n);
      } else if (run.length) {
        run.push(n);
        if (run.length > 1) rivers.push({ ...r, nodes: run });
        run = [];
      }
    });
    if (run.length > 1) rivers.push({ ...r, nodes: run });
  }
  // mapTrim: the map's lakes whose own blocks end EDGE_HANDOVER_M short of the edge
  return { tiles, rivers, mapTrim: handedOver, innerHalf: half - EDGE_HANDOVER_M, stats: { lakes: lakes.lakes.length, tiles: tiles.length, rivers: rivers.length, smallLeftOut, streamsLeftOut } };
}
