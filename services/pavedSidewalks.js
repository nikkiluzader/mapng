// The sidewalks (docs/open-items.md section 5): street-side sidewalks, corners, mapped footways and the paved pockets
// and aprons by seawalls as one paved area (services/pavedArea.js), built tile by tile into the sidewalk part builder.
// The old separate builders (swept strips, corners, merged walkways and their grading) were removed 2026-11-19.
//
// Tiles: TILE_M squares with MARGIN_M round each (the rules reach SIDEWALK_GAP_M from a curb and close corners), each
// tile meshing and grading only its own core, so neighbours meet without overlaps. A whole 8 km map at 0.25 m
// would be a billion cells; a tile is about 1.3 million.
import { buildPavedMesh, makeGrid, SIDEWALK_GAP_M } from './pavedArea.js';
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
export const OVERHEAD_FLOAT_M = 0.3;  // under a deck the ground is never graded up: a slab floating more than this follows it (at 1 m a plaza under a viaduct floated 0.84 m)
export const SURFACE_AGREE_M = 0.5;
export const GAP_STEEP_M = 1;      // curb and walk this far apart in height: the strip between follows the ground
export const BEND_TOL_M = 0.05;     // a slab following unshaped ground: squares bending more than this are cut finely
export const BANK_DROP_M = 1;      // the ground this far above or below the road's edge: a bank's slope, left unpaved
const BANK_BLOCK = 4;              // the bank test once a 4 x 4 block of cells (1 m): the ground is no finer
export const CURB_STRIP_M = 0.6;   // ... beyond this much at the curb, which stays at the road   // the terrain at a road's edge is its surface while within this of its solved height  // a slab this far over ground with something overhead follows the ground   // a bare curb (no sidewalk): a strip this wide along the road edge, its curb and top band

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
      // (with the road's own curb height where it has one, else NaN: the level's curb)
      const s = segs.length; segs.push(a[0], a[1], a[2], b[0], b[1], b[2], cw.half || 3, Number.isFinite(cw.curbH) ? cw.curbH : NaN);
      const reach = (cw.half || 3) + MARGIN_M;
      for (let gx = Math.floor((Math.min(a[0], b[0]) - reach) / SEG_CELL_M); gx <= Math.floor((Math.max(a[0], b[0]) + reach) / SEG_CELL_M); gx++) {
        for (let gy = Math.floor((Math.min(a[1], b[1]) - reach) / SEG_CELL_M); gy <= Math.floor((Math.max(a[1], b[1]) + reach) / SEG_CELL_M); gy++) {
          const k = key(gx, gy); let l = cells.get(k); if (!l) { l = []; cells.set(k, l); } l.push(s);
        }
      }
    }
  }
  // (returns { z, d, ex, ey, curb }: the centreline z, the distance out past the carriageway's edge, the point on its
  // edge just inside the curb (EDGE_IN_M) toward (x, y), and the road's own curb height (NaN: the level's); null far
  // from any road)
  return (x, y) => {
    const l = cells.get(key(Math.floor(x / SEG_CELL_M), Math.floor(y / SEG_CELL_M)));
    if (!l) return null;
    // (squared distances in the loop, the root once for the winner: the lookup runs for every slab vertex)
    let best2 = Infinity; let bs = -1; let bt = 0; let bpx = 0; let bpy = 0;
    for (let q = 0; q < l.length; q++) {
      const s = l[q];
      const ax = segs[s]; const ay = segs[s + 1]; const dx = segs[s + 3] - ax; const dy = segs[s + 4] - ay; const L2 = dx * dx + dy * dy || 1e-12;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
      const px = ax + dx * t; const py = ay + dy * t;
      const d2 = (px - x) * (px - x) + (py - y) * (py - y);
      if (d2 < best2) { best2 = d2; bs = s; bt = t; bpx = px; bpy = py; }
    }
    if (bs < 0) return null;
    const d = Math.sqrt(best2); const half = segs[bs + 6];
    const inner = Math.max(0, Math.min(d, half - EDGE_IN_M));
    const ex = d > 1e-9 ? bpx + ((x - bpx) / d) * inner : bpx; const ey = d > 1e-9 ? bpy + ((y - bpy) / d) * inner : bpy;
    return { z: segs[bs + 2] + (segs[bs + 5] - segs[bs + 2]) * bt, d: Math.max(0, d - half), ex, ey, curb: segs[bs + 7] };
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
export function* addPavedSidewalksSteps(builder, { carriageways = [], corners = [], walks = [], runs = [], openGround = [], buildings = [], driveways = [], pockets = [], uvBands = null, followGround = false, overhead = null, mapBox = null, water = [], seaMask = null, walkH = 0.1, riverChannels = [], railBeds = [], houses = [], curbH = 0.15, crossSlope = 0.015, curbOnlyM = 0.3, THREE, groundAt = null } = {}) {
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
  // (the shaped terrain at the edge, while it agrees with the road's own solved height: beside a bridge's abutment
  // the edge point lies where the bank drops to the water, and a slab off the low ground there dug a 4 m pit)
  const edgeSurface = (h) => { if (!groundAt) return h.z; const g = groundAt(h.ex, h.ey); return Math.abs(g - h.z) <= SURFACE_AGREE_M ? g : h.z; };
  const surfaceAt = (x, y) => { const h = road(x, y); if (!h) return groundAt ? groundAt(x, y) : 0; return edgeSurface(h); };
  // (the mapped walks' own heights, which follow what they run on, a bridge's approach among them: on a walk the
  // slab is its height plus walkH, as today's walkways; between the curb and a walk it goes from the curb's top to the
  // walk's. Off the roads alone, the walk to a bridge's footway sat 2-3 m under the deck walk it met)
  const walkHeight = makeRoadHeight(walks.filter((w) => w.sidewalk && !w.crossing && (w.nodes || []).length > 1 && w.nodes.every((p) => Number.isFinite(p[2]))).map((w) => ({ nodes: w.nodes, half: w.half || 1 })));
  const heightAt = (x, y) => {
    const h = road(x, y); if (!h) return groundAt ? groundAt(x, y) : 0;
    const surface = edgeSurface(h);
    const share = Math.min(smooth01((toDriveway(x, y) - DRIVEWAY_HALF_M) / DIP_RAMP_M), smooth01(toDip(x, y) / DIP_RAMP_M));
    // (a road with a curb of its own: a cycleway's sidewalk, nearly level with it)
    const ownCurb = Number.isFinite(h.curb) ? h.curb : curbH;
    let top = surface + ownCurb * share + DIP_LIP_M * (1 - share) + crossSlope * Math.min(h.d, 6);
    const wk = walkHeight(x, y);
    // (tried: a mapped walk within 0.5 m of the street's level laid at the street's level. Its ground around it is not
    // graded to that level, and Barcelona's sidewalks came out buried and floating (30 m: 13 -> 157 buried samples)
    // for no measurable gain in tilt)
    if (wk && wk.d < SIDEWALK_GAP_M) {
      const walkTop = wk.z + walkH;
      if (wk.d <= 0) top = walkTop;
      // (the strip between the curb and a walk much higher or lower than it lies on a bank or a cutting's slope: on
      // the ground there, curb and walk each at their own height. Blended, a walk on the rim of a 15 m road cutting
      // hung its paving in mid-air across the cut (Zion))
      else if (Math.abs(walkTop - top) > GAP_STEEP_M && groundAt && h.d > CURB_STRIP_M) top = groundAt(x, y) + FOLLOW_OVER_M;
      else top += (walkTop - top) * smooth01(h.d / (h.d + wk.d));
    }
    if (!groundAt) return top;
    // the terrain left as it is (no shaping): the curb at the road, the slab onto the ground within FOLLOW_M of it
    // (... following the ground beside it: tried level across instead (the curb's height, lifted where the ground under
    // the cross-section stood higher), the uphill sides stood up as tall curbs with dark slots by the road and the
    // downhill ones up to 1.8 m over the ground on their skirts (tychonas, terrain left as it is): here the terrain is
    // the survey's by the user's choice, and the slab on it reads truer)
    if (followGround) {
      const w = smooth01((h.d - FOLLOW_FROM_M) / FOLLOW_M);
      return w > 0 ? top * (1 - w) + (groundAt(x, y) + FOLLOW_OVER_M) * w : top;
    }
    // (floating well over ground the grading may not raise, something built over it: on the ground instead. Beside
    // a bridge the nearest ground road is the approach on its fill, and a slab under the deck stood 6.9 m up)
    const ground = groundAt(x, y);
    // (the same reach the grading's guard looks up, pavedArea.js gradePaved: where it leaves the ground, the slab follows it;
    // half a metre over the slab only, a plaza 0.84 m over the ground under a viaduct was neither graded nor lowered)
    if (overhead && top - ground > OVERHEAD_FLOAT_M && overhead(x, y, ground, top + 6)) return ground + FOLLOW_OVER_M;
    return top;
  };
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  // (over the roads, the mapped walks and the seawall pockets: a promenade more than the margin past the outermost road,
  // on a map's coastal edge, was left unpaved)
  const grow = (p) => { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; };
  for (const cw of carriageways) for (const p of cw.nodes || []) grow(p);
  for (const w of walks) if (!w.crossing) for (const p of w.nodes || []) grow(p);
  for (const pk of pockets) for (const p of pk?.[0] || []) grow(p);
  const stats = { tiles: 0, slab: 0, curb: 0, skirt: 0, ms: 0, bankCleared: 0, bankMs: 0, meshMs: 0, sampleMs: 0 };
  const tiles = [];
  if (!Number.isFinite(x0)) return { tiles, heightAt, stats, pavedAt: () => false };
  const t0 = Date.now();
  // (not a lift's or a stair's way mapped as a carriageway)
  // (a cul-de-sac whose sidewalk is mapped round it is left out of the road raster: its curb comes from its run, and
  // in the raster it changed what the fill round the mapped sidewalk paved, in teeth along the street; one with a
  // sidewalk of its own is in, or the strip from the street to that sidewalk was paved across the bulb)
  const roads = carriageways.filter((c) => c.nodes?.length > 1 && !(c.turningCircle && c.mappedWalk) && !['elevator', 'steps', 'footway', 'path'].includes(c.highway)).map((c) => ({ pts: c.nodes, half: c.half || 3 }));
  const arcs = corners.filter((c) => c.arc?.length > 1).map((c) => c.arc);
  // (only paved walks are paving: a dirt or gravel path, a highway=path, a footway on a bridge or in a tunnel is no slab.
  // Marked as walks, every mapped path came out a concrete strip on the ground, leaning with a hillside's slope)
  const ws = walks.filter((w) => w.nodes?.length > 1 && (w.sidewalk || w.crossing)).map((w) => ({ pts: w.nodes, half: w.half || 1, sidewalk: !!w.sidewalk, crossing: !!w.crossing }));
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
  const WA = withBox(water.filter((r) => r.length > 2), (o) => o);
  const RC = withBox(riverChannels, (o) => o.pts);
  const RB = withBox(railBeds.filter((r) => r.length > 2), (o) => o);
  const HO = withBox(houses.filter((r) => r.length > 2), (o) => o);
  // (the sea mask's piece under a tile's box, in terrain pixels: (c, r) at ((c / W) - 0.5) * size, (0.5 - (r + 1) / H) * size)
  const seaPiece = (bx) => {
    if (!seaMask) return null;
    const { mask, width: W, height: Hh, worldSize: ws } = seaMask;
    const c0 = Math.max(0, Math.floor((bx[0] / ws + 0.5) * W) - 1); const c1 = Math.min(W - 1, Math.ceil((bx[2] / ws + 0.5) * W) + 1);
    const r0 = Math.max(0, Math.floor((0.5 - bx[3] / ws) * Hh - 1) - 1); const r1 = Math.min(Hh - 1, Math.ceil((0.5 - bx[1] / ws) * Hh - 1) + 1);
    if (c1 < c0 || r1 < r0) return null;
    const w = c1 - c0 + 1; const h = r1 - r0 + 1; const sub = new Uint8Array(w * h); let any = false;
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) { const v = mask[(r + r0) * W + c + c0]; sub[r * w + c] = v; if (v) any = true; }
    return any ? { mask: sub, c0, r0, w, h, W, H: Hh, ws } : null;
  };
  const near = (list, bx) => list.filter(({ b }) => b[0] <= bx[2] && b[2] >= bx[0] && b[1] <= bx[3] && b[3] >= bx[1]).map(({ o }) => o);
  // (the tiles over that box grown by the margin: the paving reaches past the outermost centrelines; over
  // the bare box a straight street along one line had no tile row at all)
  x0 -= MARGIN_M; y0 -= MARGIN_M; x1 += MARGIN_M; y1 += MARGIN_M;
  // (and never past the map: roads running on past its edge gave a test's 8 m map 3,093 empty tiles, a minute of work)
  if (mapBox) { x0 = Math.max(x0, mapBox[0]); y0 = Math.max(y0, mapBox[1]); x1 = Math.min(x1, mapBox[2]); y1 = Math.min(y1, mapBox[3]); }
  if (x1 <= x0 || y1 <= y0) { stats.ms = Date.now() - t0; return { tiles, heightAt, stats, pavedAt: () => false }; }
  const items = []; const cores = [];
  for (let tx = Math.floor(x0 / TILE_M) * TILE_M; tx <= x1; tx += TILE_M) {
    for (let ty = Math.floor(y0 / TILE_M) * TILE_M; ty <= y1; ty += TILE_M) {
      const core = [tx, ty, tx + TILE_M, ty + TILE_M];
      // (clipped to the roads' extent grown by the margin: a small map, or a tile on the map's edge, builds only the
      // cells that can hold paving; a whole 296 m grid for a 50 m test street made the test exports ten times slower)
      const box = [Math.max(tx - MARGIN_M, x0), Math.max(ty - MARGIN_M, y0), Math.min(tx + TILE_M + MARGIN_M, x1), Math.min(ty + TILE_M + MARGIN_M, y1)];
      if (box[2] <= box[0] || box[3] <= box[1]) continue;
      const tr = near(R, box);
      // (paving only ever comes from a walk, a street-side sidewalk or a seawall pocket: a tile with none is skipped,
      // whatever roads cross it)
      const tw = near(W, box); const ts = near(S, box); const tp = near(PK, box);
      if (!tw.length && !ts.length && !tp.length) continue;
      items.push({ box, roads: tr, cornerArcs: near(A, box), walks: tw, streetWalks: ts, greenery: near(G, box), buildings: near(B, box), pockets: tp, water: near(WA, box), rivers: near(RC, box), railBeds: near(RB, box), houses: near(HO, [box[0] - 30, box[1] - 30, box[2] + 30, box[3] + 30]), sea: seaPiece(box) });
      cores.push(core);
    }
  }
  // No paving down a bank: the strip closed between the curb and a walk more than GAP_STEEP_M above or below it, where
  // the ground stands more than BANK_DROP_M off the road's edge, is the slope of an embankment or a cutting, left as
  // terrain (paved, the slab floated up to 2 m over pilchowice's 3.5 m road fill). Mapped walks stay; so does the curb
  // strip. The blocks (1 m) are found here, only round the walk points that stand that far off the curb (sampled
  // every 2 m), and handed to the tile's worker, which clears them before tracing the outlines: cleared after
  // tracing, each tile was traced twice (NYC: 2.3 s for 71 tiles)
  const tb = performance.now();
  if (groundAt) {
    const r = SIDEWALK_GAP_M + 2;
    const steep = new Map();   // tile key -> [x, y, ...] of steep walk points within r of it
    for (const w of walks) {
      const n = w.nodes || []; if (w.crossing || n.length < 2) continue;
      for (let i = 0; i + 1 < n.length; i++) {
        const a = n[i]; const b = n[i + 1]; if (!Number.isFinite(a[2]) || !Number.isFinite(b[2])) continue;
        const L = fastHypot(b[0] - a[0], b[1] - a[1]); const steps = Math.max(1, Math.ceil(L / 2));
        for (let j = 0; j <= steps; j++) {
          const t = j / steps; const x = a[0] + (b[0] - a[0]) * t; const y = a[1] + (b[1] - a[1]) * t;
          const h = road(x, y); if (!h || h.d > r) continue;
          if (Math.abs(a[2] + (b[2] - a[2]) * t + walkH - (edgeSurface(h) + curbH)) <= GAP_STEEP_M - 0.05) continue;
          for (let tx = Math.floor((x - r) / TILE_M); tx <= Math.floor((x + r) / TILE_M); tx++) {
            for (let ty = Math.floor((y - r) / TILE_M); ty <= Math.floor((y + r) / TILE_M); ty++) {
              const k = tx * 65536 + ty; let l = steep.get(k); if (!l) { l = []; steep.set(k, l); } l.push(x, y);
            }
          }
        }
      }
    }
    for (let ti = 0; ti < items.length; ti++) {
      const pts = steep.get(Math.floor(cores[ti][0] / TILE_M) * 65536 + Math.floor(cores[ti][1] / TILE_M));
      if (!pts) continue;
      const g = makeGrid(...items[ti].box);
      const bw = Math.ceil(g.w / BANK_BLOCK); const bh = Math.ceil(g.h / BANK_BLOCK); const bm = BANK_BLOCK * g.res;
      const mask = new Uint8Array(bw * bh); const tested = new Uint8Array(bw * bh); let any = false;
      for (let q = 0; q < pts.length; q += 2) {
        const c0 = Math.max(0, Math.floor((pts[q] - r - g.x0) / bm)); const c1 = Math.min(bw - 1, Math.floor((pts[q] + r - g.x0) / bm));
        const r0 = Math.max(0, Math.floor((g.y1 - pts[q + 1] - r) / bm)); const r1 = Math.min(bh - 1, Math.floor((g.y1 - pts[q + 1] + r) / bm));
        for (let br = r0; br <= r1; br++) {
          for (let bc = c0; bc <= c1; bc++) {
            const k = br * bw + bc; if (tested[k]) continue; tested[k] = 1;
            const x = g.x0 + (bc + 0.5) * bm; const y = g.y1 - (br + 0.5) * bm;
            const h = road(x, y); if (!h || h.d <= CURB_STRIP_M) continue;
            // (a bank only between a curb and a walk at very different heights: the ground alone, a metre off the
            // road, is the noise of a city's 30 m surface model, and cleared paving on 181 of NYC's 254 tiles)
            const wk = walkHeight(x, y); if (!wk || wk.d >= SIDEWALK_GAP_M) continue;
            if (Math.abs(wk.z + walkH - (edgeSurface(h) + curbH)) <= GAP_STEEP_M) continue;
            if (Math.abs(groundAt(x, y) - edgeSurface(h)) <= BANK_DROP_M) continue;
            mask[k] = 1; any = true;
          }
        }
      }
      if (any) { items[ti].bank = { mask, block: BANK_BLOCK, bw }; stats.bankCleared++; }
    }
  }
  stats.bankMs = performance.now() - tb;
  // (where the slab follows ungraded ground under a deck: there its squares are cut finely where they bend)
  const underOverhead = overhead && groundAt ? (x, y) => { const z = groundAt(x, y); return overhead(x, y, z, z + 8); } : null;
  const fineAt = crossings.length || dipLines.length ? (x, y) => toDriveway(x, y) < DRIVEWAY_HALF_M + DIP_RAMP_M + 1 || toDip(x, y) < DIP_RAMP_M + 1 : null;
  const meshTile = ({ cells, g, rings }, k) => {
    const core = cores[k];
    let tq = performance.now();
    const m = buildPavedMesh(rings, cells, g, { heightAt, bottomAt: surfaceAt, groundAt, curbH, THREE, core, fineAt, bendTol: groundAt && (followGround || overhead) ? BEND_TOL_M : null, bendWhere: followGround ? null : underOverhead });
    addToBuilder(builder, m, uvBands);
    stats.tiles++; stats.slab += m.slab.length / 9; stats.curb += m.curb.length / 9; stats.skirt += m.skirt.length / 9;
    stats.meshMs += performance.now() - tq; tq = performance.now();
    tiles.push({ cells, g, core, slabZ: sampleSlab(m.slab, g) });
    stats.sampleMs += performance.now() - tq;
  };
  // (meshed as the tiles come back from the workers, while they build the rest, but strictly in the tiles' order: in
  // arrival order the mesh would depend on the workers' timing)
  const got = new Array(items.length); let next = 0;
  const onTile = (k, r) => { got[k] = r; while (next < items.length && got[next]) { meshTile(got[next], next); got[next] = null; next++; } };
  // (a probe's hook: the tiles as the workers get them, e.g. scratch/swaudit/paveddump/hook.mjs; off unless set)
  globalThis.__MAPNG_PAVED_DUMP?.(items);
  const built = items.length ? yield { kind: 'pavedTiles', items, onTile } : null;
  if (built) built.forEach((r, k) => { if (k >= next && !got[k]) onTile(k, r); });
  else items.forEach((it, k) => onTile(k, pavedTile(it)));
  stats.ms = Date.now() - t0;
  return { tiles, heightAt, stats, pavedAt: makePavedAt(tiles) };
}

/**
 * Whether (x, y) is paved, from the tiles' grids (each tile's own core): for the steps after the sidewalks that would
 * change the ground under them (the water step's sea floor and lake beds leave it, as they leave the roads).
 */
export function makePavedAt(tiles) {
  const byCore = new Map();
  for (const t of tiles) byCore.set(Math.floor(t.core[0] / TILE_M) * 65536 + Math.floor(t.core[1] / TILE_M), t);
  return (x, y) => {
    const t = byCore.get(Math.floor(x / TILE_M) * 65536 + Math.floor(y / TILE_M)); if (!t) return false;
    const { g, cells } = t; const c = Math.floor((x - g.x0) / g.res); const r = Math.floor((g.y1 - y) / g.res);
    return c >= 0 && r >= 0 && c < g.w && r < g.h && (cells[r * g.w + c] & 6) !== 0;
  };
}

// The built slab's height on the ground check's lattice (beamngSidewalks.js checkPavedGround: every CHECK_STEP_M, at
// cell centres), NaN where no slab covers a point. The check measures the mesh the game shows: measured off the
// height function instead, on steep ground it counted floats the mesh did not have (27 of 31 in pilchowice)
export const CHECK_STEP_M = 2;
export function sampleSlab(slab, g, step = CHECK_STEP_M) {
  const k = Math.max(1, Math.round(step / g.res));
  const cols = Math.ceil(g.w / k); const rows = Math.ceil(g.h / k);
  const z = new Float32Array(cols * rows).fill(NaN);
  for (let i = 0; i < slab.length; i += 9) {
    const ax = slab[i], ay = slab[i + 1], az = slab[i + 2], bx = slab[i + 3], by = slab[i + 4], bz = slab[i + 5], cx = slab[i + 6], cy = slab[i + 7], cz = slab[i + 8];
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-12) continue;
    // lattice point (ri, ci) at cell (ri k, ci k): x = x0 + (ci k + 0.5) res, y = y1 - (ri k + 0.5) res
    const c0 = Math.max(0, Math.ceil(((Math.min(ax, bx, cx) - g.x0) / g.res - 0.5) / k)); const c1 = Math.min(cols - 1, Math.floor(((Math.max(ax, bx, cx) - g.x0) / g.res - 0.5) / k));
    const r0 = Math.max(0, Math.ceil(((g.y1 - Math.max(ay, by, cy)) / g.res - 0.5) / k)); const r1 = Math.min(rows - 1, Math.floor(((g.y1 - Math.min(ay, by, cy)) / g.res - 0.5) / k));
    for (let ri = r0; ri <= r1; ri++) {
      const y = g.y1 - (ri * k + 0.5) * g.res;
      for (let ci = c0; ci <= c1; ci++) {
        const x = g.x0 + (ci * k + 0.5) * g.res;
        const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den; const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den; const l3 = 1 - l1 - l2;
        if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
        const v = l1 * az + l2 * bz + l3 * cz; const j = ri * cols + ci;
        if (!(z[j] >= v)) z[j] = v;
      }
    }
  }
  return { z, k, cols };
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
