// A chunked level's roads across its seams (services/chunkedExport.js). Each chunk solves its roads' heights on its
// own cut of the road network: a ramp, a bridge's approach or a tunnel seen whole by one chunk and cut short by the
// next came out metres apart (measured: 6 m inside the kept part of a chunk in Oslo, 2026-11-23). So a finished
// chunk hands its solved road heights on, and the next chunk's solver takes them as fixed where the finished chunk
// has the say (the part it keeps): the roads then leave the seam at the neighbour's heights and grades.
//
// Heights are absolute metres, positions the chunk's own metres (x east, y north, from its centre).

const CELL_M = 8;
// The neighbours fix a road only in the part they keep (their say 1), not in the band where the ground eases from
// theirs to this chunk's: a chunk has seen at least its whole margin of road beyond its kept part, but only a stub of
// what lies in the band (a tunnel seen for 14 m was left on the ground, and the next chunk, shown 500 m of it, had
// to follow).
export const SEAM_SAY = 0.999;
export const SEAM_ROAD_REACH_M = 1.5;

/**
 * Whether a neighbour's height for a road binds at a point where its say is `weight`: in the part it keeps, always;
 * a road it built a tunnel on, wherever it handed the road on. A tunnel's model belongs to the chunk that holds its
 * middle and runs on past the seam to that chunk's own edge (pieces of up to 250 m): the next chunk's road has to be
 * inside that tube. (Seen in game, Oslo 2026-11-23: the neighbour's tube ran level 35 m past the seam while the
 * next chunk's road climbed 7 % through its roof.)
 */
export const seamHolds = (hit, weight) => !!hit && (weight >= SEAM_SAY || !!hit.tunnel);   // a station takes a neighbour's height from the same road this near in plan

/**
 * What a finished chunk hands on: its solved roads as [{ wayId, tunnel, x, y, z (absolute) }], from the structure
 * solver's graph and profile. minHeight: the datum the solver's heights are over; tunnelKind(edge) -> the kind of
 * tunnel the chunk built on it ('' for none).
 */
export function seamRoadsOut(graph, minHeight, tunnelKind = () => '') {
  const z = graph?.profile?.z; if (!z || !Array.isArray(graph.edges)) return [];
  const out = [];
  graph.edges.forEach((e, k) => {
    if (e.wayId == null || !z[k] || e.s.length < 2) return;
    const zz = new Float64Array(e.s.length);
    for (let i = 0; i < zz.length; i++) zz[i] = z[k][i] + minHeight;
    out.push({ wayId: e.wayId, tunnel: tunnelKind(e) || '', rail: !!e.rail, x: Float64Array.from(e.x), y: Float64Array.from(e.y), z: zz });
  });
  return out;
}

/**
 * The finished neighbours' road heights as this chunk sees them: { at(wayId, x, y) -> { z, tunnel, from (the neighbour's key) } | null, roads,
 * stations }, or null when no finished chunk hands any on. neighbours: [{ key, roads (seamRoadsOut), dx, dy (the
 * neighbour's centre from this chunk's, metres) }]. A road's height at a point is read between the neighbour's two
 * stations on the same OSM way nearest it, within `reach` in plan.
 */
export function seamRoadLookup(neighbours, reach = SEAM_ROAD_REACH_M) {
  const grid = new Map(); let stations = 0; let roads = 0;
  const key = (cx, cy) => cx * 73856093 ^ cy * 19349663;
  for (const nb of neighbours) {
    for (const r of nb.roads || []) {
      roads++;
      const road = { wayId: r.wayId, tunnel: r.tunnel, from: nb.key ?? '', z: r.z, x: Float64Array.from(r.x, (v) => v + nb.dx), y: Float64Array.from(r.y, (v) => v + nb.dy) };
      for (let i = 0; i < road.x.length; i++) {
        const k = key(Math.floor(road.x[i] / CELL_M), Math.floor(road.y[i] / CELL_M));
        let l = grid.get(k); if (!l) { l = []; grid.set(k, l); }
        l.push(road, i); stations++;
      }
    }
  }
  if (!stations) return null;
  // (a point against one piece of a road: its distance and the height there)
  const onPiece = (road, i, x, y) => {
    const ax = road.x[i]; const ay = road.y[i]; const bx = road.x[i + 1]; const by = road.y[i + 1];
    const ux = bx - ax; const uy = by - ay; const L2 = ux * ux + uy * uy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ux + (y - ay) * uy) / L2)) : 0;
    const px = ax + ux * t; const py = ay + uy * t;
    return [(px - x) ** 2 + (py - y) ** 2, road.z[i] + (road.z[i + 1] - road.z[i]) * t];
  };
  const at = (wayId, x, y) => {
    if (wayId == null) return null;
    const cx = Math.floor(x / CELL_M); const cy = Math.floor(y / CELL_M);
    let best = reach * reach; let hit = null;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const l = grid.get(key(cx + dx, cy + dy)); if (!l) continue;
      for (let j = 0; j < l.length; j += 2) {
        const road = l[j]; if (road.wayId !== wayId) continue;
        const i = l[j + 1];
        if (i > 0) { const [d, z] = onPiece(road, i - 1, x, y); if (d <= best) { best = d; hit = { z, tunnel: road.tunnel, from: road.from }; } }
        if (i + 1 < road.x.length) { const [d, z] = onPiece(road, i, x, y); if (d <= best) { best = d; hit = { z, tunnel: road.tunnel, from: road.from }; } }
      }
    }
    return hit;
  };
  return { at, roads, stations };
}

/**
 * The solver's pins from the neighbours: [[edge, station, z]...] for this chunk's graph stations where the
 * neighbours have the say (weightAt(x, y) = 1: the part they keep) and hand on a height for the same
 * road. minHeight: this chunk's solver datum. Returns { pins, edges (how many edges
 * they are on) }.
 */
export function seamRoadPins(graph, lookup, weightAt, minHeight) {
  const pins = []; const edges = new Set();
  if (!lookup || !graph?.edges) return { pins, edges: 0 };
  graph.edges.forEach((e, k) => {
    if (e.wayId == null) return;
    for (let i = 0; i < e.s.length; i++) {
      const h = lookup.at(e.wayId, e.x[i], e.y[i]); if (!h) continue;
      if (!seamHolds(h, weightAt(e.x[i], e.y[i]))) continue;
      pins.push([k, i, h.z - minHeight]); edges.add(k);
    }
  });
  return { pins, edges: edges.size };
}
