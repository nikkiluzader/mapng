// The sidewalk rework wired into the export (step 3e, docs/open-items.md section 5): street-side sidewalks and
// mapped footways as one paved area (services/pavedArea.js), built tile by tile into the sidewalk part builder.
// Behind a switch (MAPNG_PAVED_SIDEWALKS=1) until the side-by-side comparison is approved.
//
// Tiles: TILE_M squares with MARGIN_M round each (the rules reach SIDEWALK_GAP_M from a curb and close corners), each
// tile meshing and grading only its own core, so neighbours meet without overlaps. A whole 8 km map at 0.25 m
// would be a billion cells; a tile is about 1.3 million.
import { buildPavedMesh, SIDEWALK_GAP_M } from './pavedArea.js';
import { pavedTile } from './pavedWorker.js';
import { fastHypot } from './fastMath.js';
import { SLAB_TILE_M } from './sidewalkPanels.js';

export const TILE_M = 256;
export const MARGIN_M = SIDEWALK_GAP_M + 8;
const SEG_CELL_M = 16;
const EDGE_IN_M = 0.3;   // the road surface read this far inside its edge
// a driveway crossing the sidewalk: the curb dropped across its width, ramped back up either side (today's values,
// beamngSidewalks.js DRIVEWAY_HALF_M, DIP_RAMP_M), a small lip left in the dip
export const DRIVEWAY_HALF_M = 2.5;
export const DIP_RAMP_M = 1.0;
export const DIP_LIP_M = 0.02;
export const CROSS_REACH_M = SIDEWALK_GAP_M + 2;
export const BARE_CURB_M = 0.5;
export const FOLLOW_FROM_M = 0.5;   // terrain not shaped: the slab follows the road this far from its edge,
export const FOLLOW_M = 2;          // then onto the ground over this much
export const FOLLOW_OVER_M = 0.05;  // ... this far over it
export const OVERHEAD_FLOAT_M = 1;  // a slab this far over ground with something overhead follows the ground   // a bare curb (no sidewalk): a strip this wide along the road edge, its curb and top band

/** The part of a polyline from s0 to s1 metres along it. */
export function pieceAlong(points, s0, s1) {
  const out = []; let s = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]; const b = points[i + 1]; const L = fastHypot(b[0] - a[0], b[1] - a[1]);
    if (L > 0 && s + L >= s0 && s <= s1) {
      const t0 = Math.max(0, (s0 - s) / L); const t1 = Math.min(1, (s1 - s) / L);
      if (!out.length) out.push([a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0]);
      out.push([a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1]);
    }
    s += L;
  }
  return out;
}

/** The parts of a polyline outside the spans [[s0, s1]...] (metres along it). */
function piecesOutside(points, spans) {
  let total = 0; for (let i = 0; i + 1 < points.length; i++) total += fastHypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  const keep = []; let at = 0;
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) { if (a > at) keep.push([at, a]); at = Math.max(at, b); }
  if (at < total) keep.push([at, total]);
  return keep.map(([a, b]) => pieceAlong(points, a, b)).filter((l) => l.length > 1);
}   // a driveway's crossing: this far back from the road along its line
const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** The distance from (x, y) to the nearest of lines ([[x, y]...]), through a grid of segments; Infinity far off. */
export function makeLineDistance(lines, reach) {
  const cells = new Map(); const segs = [];
  const key = (cx, cy) => cx * 1048576 + cy;
  for (const pts of lines) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]; const b = pts[i + 1]; const s = segs.length; segs.push(a[0], a[1], b[0], b[1]);
      for (let gx = Math.floor((Math.min(a[0], b[0]) - reach) / SEG_CELL_M); gx <= Math.floor((Math.max(a[0], b[0]) + reach) / SEG_CELL_M); gx++) {
        for (let gy = Math.floor((Math.min(a[1], b[1]) - reach) / SEG_CELL_M); gy <= Math.floor((Math.max(a[1], b[1]) + reach) / SEG_CELL_M); gy++) {
          const k = key(gx, gy); let l = cells.get(k); if (!l) { l = []; cells.set(k, l); } l.push(s);
        }
      }
    }
  }
  return (x, y) => {
    const l = cells.get(key(Math.floor(x / SEG_CELL_M), Math.floor(y / SEG_CELL_M)));
    if (!l) return Infinity;
    let best = Infinity;
    for (const s of l) {
      const ax = segs[s]; const ay = segs[s + 1]; const dx = segs[s + 2] - ax; const dy = segs[s + 3] - ay; const L2 = dx * dx + dy * dy || 1e-12;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
      const d = fastHypot(ax + dx * t - x, ay + dy * t - y); if (d < best) best = d;
    }
    return best;
  };
}

/** The road surface's height near (x, y): the nearest carriageway centreline point's z (a grid of segments). */
export function makeRoadHeight(carriageways) {
  const cells = new Map();
  const key = (cx, cy) => cx * 1048576 + cy;
  const segs = [];
  for (const cw of carriageways) {
    const n = cw.nodes || [];
    for (let i = 0; i + 1 < n.length; i++) {
      const a = n[i]; const b = n[i + 1];
      if (!Number.isFinite(a[2]) || !Number.isFinite(b[2])) continue;
      const s = segs.length; segs.push(a[0], a[1], a[2], b[0], b[1], b[2], cw.half || 3);
      const reach = (cw.half || 3) + MARGIN_M;
      for (let gx = Math.floor((Math.min(a[0], b[0]) - reach) / SEG_CELL_M); gx <= Math.floor((Math.max(a[0], b[0]) + reach) / SEG_CELL_M); gx++) {
        for (let gy = Math.floor((Math.min(a[1], b[1]) - reach) / SEG_CELL_M); gy <= Math.floor((Math.max(a[1], b[1]) + reach) / SEG_CELL_M); gy++) {
          const k = key(gx, gy); let l = cells.get(k); if (!l) { l = []; cells.set(k, l); } l.push(s);
        }
      }
    }
  }
  // (returns { z, d, ex, ey }: the centreline z, the distance out past the carriageway's edge, and the point on its
  // edge just inside the curb (EDGE_IN_M) toward (x, y); null far from any road)
  return (x, y) => {
    const l = cells.get(key(Math.floor(x / SEG_CELL_M), Math.floor(y / SEG_CELL_M)));
    if (!l) return null;
    let best = Infinity; let bz = 0; let bd = 0; let ex = 0; let ey = 0;
    for (const s of l) {
      const ax = segs[s]; const ay = segs[s + 1]; const az = segs[s + 2]; const bx = segs[s + 3]; const by = segs[s + 4]; const bzz = segs[s + 5];
      const dx = bx - ax; const dy = by - ay; const L2 = dx * dx + dy * dy || 1e-12;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
      const px = ax + dx * t; const py = ay + dy * t;
      const d = fastHypot(px - x, py - y);
      if (d < best) {
        best = d; bz = az + (bzz - az) * t; bd = d - segs[s + 6];
        const inner = Math.max(0, Math.min(d, segs[s + 6] - EDGE_IN_M));
        ex = d > 1e-9 ? px + ((x - px) / d) * inner : px; ey = d > 1e-9 ? py + ((y - py) / d) * inner : py;
      }
    }
    return best === Infinity ? null : { z: bz, d: Math.max(0, bd), ex, ey };
  };
}

/**
 * Street-side sidewalks and mapped footways as one paved area, into builder (beamngSidewalks.js PartBuilder).
 * carriageways: [{ nodes: [[x, y, z]...], half }]; corners: joinCorners' ({ arc }); walks: the footpaths
 * ({ nodes, half, sidewalk, crossing }); runs: street-side runs ({ points, width, side }); openGround / buildings:
 * rings. curbH, crossSlope: the slab top over the road (today's values). Returns { tiles, heightAt, stats }.
 */
// groundAt(x, y): the shaped terrain (the road surface lies on it): the slab top is the road surface at the nearest
// edge plus the curb (read off the centreline's z, the solver's, it stood 10 cm over the road a curb ended short of)
export function addPavedSidewalks(builder, opts = {}) {
  const gen = addPavedSidewalksSteps(builder, opts);
  let step = gen.next();
  while (!step.done) step = gen.next(null);
  return step.value;
}

// (a generator: the tiles' grids asked of the driver as one batch, { kind: 'pavedTiles', items }, built on worker
// threads where there are some; null back: built here)
export function* addPavedSidewalksSteps(builder, { carriageways = [], corners = [], walks = [], runs = [], openGround = [], buildings = [], driveways = [], pockets = [], uvBands = null, followGround = false, overhead = null, mapBox = null, curbH = 0.15, crossSlope = 0.015, curbOnlyM = 0.3, THREE, groundAt = null } = {}) {
  const road = makeRoadHeight(carriageways);
  // (a driveway counts only where it crosses the sidewalk to reach the road: the part of its line within
  // CROSS_REACH_M of where it comes to the road's edge. Whole, an alley along a street dropped the curb along it)
  const crossings = [];
  for (const line of driveways) {
    const ends = [];
    for (const p of line) { const h = road(p[0], p[1]); if (h && h.d < 1.5) ends.push(p); }
    if (!ends.length) continue;
    let piece = [];
    for (const p of line) {
      const near = ends.some((q) => fastHypot(p[0] - q[0], p[1] - q[1]) <= CROSS_REACH_M);
      if (near) piece.push(p); else if (piece.length) { if (piece.length > 1) crossings.push(piece); piece = []; }
    }
    if (piece.length > 1) crossings.push(piece);
    // (a crossing mapped with one node at the road: its line to the next node)
    if (!crossings.length && ends.length) crossings.push(line);
  }
  const toDriveway = crossings.length ? makeLineDistance(crossings, DRIVEWAY_HALF_M + DIP_RAMP_M) : () => Infinity;
  // (the curb lowered wherever today's street runs lower it: crosswalks, walkways coming out to the street, car parks
  // and driveways along a bare curb; with a ramp back up into the sidewalk, as a kerb ramp)
  const dipLines = runs.flatMap((r) => (r.dips || []).map(([a, b]) => pieceAlong(r.points, a, b)).filter((l) => l.length > 1));
  const toDip = dipLines.length ? makeLineDistance(dipLines, DIP_RAMP_M) : () => Infinity;
  // the road surface at the nearest edge (a curb face comes down to it)
  const surfaceAt = (x, y) => { const h = road(x, y); if (!h) return groundAt ? groundAt(x, y) : 0; return groundAt ? groundAt(h.ex, h.ey) : h.z; };
  const heightAt = (x, y) => {
    const h = road(x, y); if (!h) return groundAt ? groundAt(x, y) : 0;
    const surface = groundAt ? groundAt(h.ex, h.ey) : h.z;
    const share = Math.min(smooth01((toDriveway(x, y) - DRIVEWAY_HALF_M) / DIP_RAMP_M), smooth01(toDip(x, y) / DIP_RAMP_M));
    const top = surface + curbH * share + DIP_LIP_M * (1 - share) + crossSlope * Math.min(h.d, 6);
    if (!groundAt) return top;
    // the terrain left as it is (no shaping): the curb at the road, the slab onto the ground within FOLLOW_M of it
    if (followGround) {
      const w = smooth01((h.d - FOLLOW_FROM_M) / FOLLOW_M);
      return w > 0 ? top * (1 - w) + (groundAt(x, y) + FOLLOW_OVER_M) * w : top;
    }
    // (floating well over ground the grading may not raise, something built over it: on the ground instead. Beside
    // a bridge the nearest ground road is the approach on its fill, and a slab under the deck stood 6.9 m up)
    const ground = groundAt(x, y);
    if (overhead && top - ground > OVERHEAD_FLOAT_M && overhead(x, y, ground, top + 0.5)) return ground + FOLLOW_OVER_M;
    return top;
  };
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const cw of carriageways) for (const p of cw.nodes || []) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  const stats = { tiles: 0, slab: 0, curb: 0, skirt: 0, ms: 0 };
  const tiles = [];
  if (!Number.isFinite(x0)) return { tiles, heightAt, stats };
  const t0 = Date.now();
  // (not a lift's or a stair's way mapped as a carriageway)
  const roads = carriageways.filter((c) => c.nodes?.length > 1 && !['elevator', 'steps', 'footway', 'path'].includes(c.highway)).map((c) => ({ pts: c.nodes, half: c.half || 3 }));
  const arcs = corners.filter((c) => c.arc?.length > 1).map((c) => c.arc);
  const ws = walks.filter((w) => w.nodes?.length > 1).map((w) => ({ pts: w.nodes, half: w.half || 1, sidewalk: !!w.sidewalk, crossing: !!w.crossing }));
  // (a street-side run's band: its points are on the curb line, the walk out to one side)
  const offset = (pts, dist) => pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(pts.length - 1, i + 1)];
    const tx = b[0] - a[0]; const ty = b[1] - a[1]; const L = fastHypot(tx, ty) || 1;
    return [p[0] - (ty / L) * dist, p[1] + (tx / L) * dist];
  });
  const street = runs.filter((r) => r.points?.length > 1 && r.width > curbOnlyM).map((r) => ({ pts: offset(r.points, (r.side ?? 1) * r.width / 2), half: r.width / 2 }));
  // a bare curb: a narrow strip along the road edge, left out across its dips (a car park right at the street, a
  // driveway: open there, as today)
  for (const r of runs) {
    if (!(r.points?.length > 1) || r.width > curbOnlyM) continue;
    for (const piece of piecesOutside(r.points, r.dips || [])) street.push({ pts: offset(piece, (r.side ?? 1) * BARE_CURB_M / 2), half: BARE_CURB_M / 2 });
  }
  const boxOf = (pts) => { let a = Infinity; let b = Infinity; let c = -Infinity; let d = -Infinity; for (const p of pts) { if (p[0] < a) a = p[0]; if (p[0] > c) c = p[0]; if (p[1] < b) b = p[1]; if (p[1] > d) d = p[1]; } return [a, b, c, d]; };
  const withBox = (list, get) => list.map((o) => ({ o, b: boxOf(get(o)) }));
  const R = withBox(roads, (o) => o.pts); const A = withBox(arcs, (o) => o); const W = withBox(ws, (o) => o.pts); const S = withBox(street, (o) => o.pts);
  const G = withBox(openGround.filter((r) => r.length > 2), (o) => o); const B = withBox(buildings.filter((r) => r.length > 2), (o) => o);
  const PK = withBox(pockets.filter((p) => p?.[0]?.length > 2), (o) => o[0]);
  const near = (list, bx) => list.filter(({ b }) => b[0] <= bx[2] && b[2] >= bx[0] && b[1] <= bx[3] && b[3] >= bx[1]).map(({ o }) => o);
  // (the tiles over the roads' box grown by the margin: the paving reaches past the outermost centrelines; over
  // the bare box a straight street along one line had no tile row at all)
  x0 -= MARGIN_M; y0 -= MARGIN_M; x1 += MARGIN_M; y1 += MARGIN_M;
  // (and never past the map: roads running on past its edge gave a test's 8 m map 3,093 empty tiles, a minute of work)
  if (mapBox) { x0 = Math.max(x0, mapBox[0]); y0 = Math.max(y0, mapBox[1]); x1 = Math.min(x1, mapBox[2]); y1 = Math.min(y1, mapBox[3]); }
  if (x1 <= x0 || y1 <= y0) { stats.ms = Date.now() - t0; return { tiles, heightAt, stats }; }
  const items = []; const cores = [];
  for (let tx = Math.floor(x0 / TILE_M) * TILE_M; tx <= x1; tx += TILE_M) {
    for (let ty = Math.floor(y0 / TILE_M) * TILE_M; ty <= y1; ty += TILE_M) {
      const core = [tx, ty, tx + TILE_M, ty + TILE_M];
      // (clipped to the roads' extent grown by the margin: a small map, or a tile on the map's edge, builds only the
      // cells that can hold paving; a whole 296 m grid for a 50 m test street made the test exports ten times slower)
      const box = [Math.max(tx - MARGIN_M, x0), Math.max(ty - MARGIN_M, y0), Math.min(tx + TILE_M + MARGIN_M, x1), Math.min(ty + TILE_M + MARGIN_M, y1)];
      if (box[2] <= box[0] || box[3] <= box[1]) continue;
      const tr = near(R, box);
      if (!tr.length) continue;
      // (paving only ever comes from a walk, a street-side sidewalk or a seawall pocket: a tile with none is skipped,
      // whatever roads cross it)
      const tw = near(W, box); const ts = near(S, box); const tp = near(PK, box);
      if (!tw.length && !ts.length && !tp.length) continue;
      items.push({ box, roads: tr, cornerArcs: near(A, box), walks: tw, streetWalks: ts, greenery: near(G, box), buildings: near(B, box), pockets: tp });
      cores.push(core);
    }
  }
  const fineAt = crossings.length || dipLines.length ? (x, y) => toDriveway(x, y) < DRIVEWAY_HALF_M + DIP_RAMP_M + 1 || toDip(x, y) < DIP_RAMP_M + 1 : null;
  const meshTile = ({ cells, g, rings }, k) => {
    const core = cores[k];
    const m = buildPavedMesh(rings, cells, g, { heightAt, bottomAt: surfaceAt, curbH, THREE, core, fineAt });
    addToBuilder(builder, m, uvBands);
    stats.tiles++; stats.slab += m.slab.length / 9; stats.curb += m.curb.length / 9; stats.skirt += m.skirt.length / 9;
    tiles.push({ cells, g, core });
  };
  // (meshed as the tiles come back from the workers, while they build the rest, but strictly in the tiles' order: in
  // arrival order the mesh would depend on the workers' timing)
  const got = new Array(items.length); let next = 0;
  const onTile = (k, r) => { got[k] = r; while (next < items.length && got[next]) { meshTile(got[next], next); got[next] = null; next++; } };
  const built = items.length ? yield { kind: 'pavedTiles', items, onTile } : null;
  if (built) built.forEach((r, k) => { if (k >= next && !got[k]) onTile(k, r); });
  else items.forEach((it, k) => onTile(k, pavedTile(it)));
  stats.ms = Date.now() - t0;
  return { tiles, heightAt, stats };
}

// slab triangles up, edge faces outward. UVs as today's builder lays them (beamngSidewalks.js): the slab in world
// metres over SLAB_TILE_M (the part builder scales that to the look's repeat; raw metres repeated the texture ten
// times too densely), the curb along its length over curbRepeat with the curb sheet's own bands for its face and top
// (uvBands: { curbRepeat, face: [v0, v1], top: [v0, v1] })
function addToBuilder(builder, m, uvBands) {
  const B = uvBands || { curbRepeat: 9, face: [0, 1], top: [0, 1] };
  const s = m.slab;
  for (let i = 0; i < s.length; i += 9) {
    const a = [s[i], s[i + 1], s[i + 2]]; const b = [s[i + 3], s[i + 4], s[i + 5]]; const c = [s[i + 6], s[i + 7], s[i + 8]];
    builder.tri('slab', a, b, c, [a[0] / SLAB_TILE_M, a[1] / SLAB_TILE_M], [b[0] / SLAB_TILE_M, b[1] / SLAB_TILE_M], [c[0] / SLAB_TILE_M, c[1] / SLAB_TILE_M], [0, 0, 1]);
  }
  // (along the curb in world terms: u from the edge's start measured as x + y, so neighbouring pieces carry on)
  const uAt = (p) => (p[0] + p[1]) / B.curbRepeat;
  const t = m.curbTop || [];
  for (let i = 0; i < t.length; i += 18) {
    const a = [t[i], t[i + 1], t[i + 2]]; const b = [t[i + 3], t[i + 4], t[i + 5]]; const bi = [t[i + 6], t[i + 7], t[i + 8]]; const ai = [t[i + 15], t[i + 16], t[i + 17]];
    const ua = uAt(a); const ub = ua + fastHypot(b[0] - a[0], b[1] - a[1]) / B.curbRepeat;
    builder.tri('curb', a, b, bi, [ua, B.top[0]], [ub, B.top[0]], [ub, B.top[1]], [0, 0, 1]);
    builder.tri('curb', a, bi, ai, [ua, B.top[0]], [ub, B.top[1]], [ua, B.top[1]], [0, 0, 1]);
  }
  for (const arr of [m.curb, m.skirt]) {
    for (let i = 0; i < arr.length; i += 18) {
      // (a quad as two triangles: a, b, b-down / a, b-down, a-down; its outward normal from the edge's direction)
      const a = [arr[i], arr[i + 1], arr[i + 2]]; const b = [arr[i + 3], arr[i + 4], arr[i + 5]]; const bd = [arr[i + 6], arr[i + 7], arr[i + 8]]; const ad = [arr[i + 15], arr[i + 16], arr[i + 17]];
      const L = fastHypot(b[0] - a[0], b[1] - a[1]) || 1; const want = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L, 0];
      const ua = uAt(a); const ub = ua + L / B.curbRepeat;
      builder.tri('curb', a, b, bd, [ua, B.face[1]], [ub, B.face[1]], [ub, B.face[0]], want);
      builder.tri('curb', a, bd, ad, [ua, B.face[1]], [ub, B.face[0]], [ua, B.face[0]], want);
    }
  }
}
