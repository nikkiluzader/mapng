// The sidewalk rework wired into the export (step 3e, docs/open-items.md section 5): street-side sidewalks and
// mapped footways as one paved area (services/pavedArea.js), built tile by tile into the sidewalk part builder.
// Behind a switch (MAPNG_PAVED_SIDEWALKS=1) until the side-by-side comparison is approved.
//
// Tiles: TILE_M squares with MARGIN_M round each (the rules reach SIDEWALK_GAP_M from a curb and close corners), each
// tile meshing and grading only its own core, so neighbours meet without overlaps. A whole 8 km map at 0.25 m
// would be a billion cells; a tile is about 1.3 million.
import { makeGrid, buildPavedGrid, traceOutlines, buildPavedMesh, markPolygon, WALK, GAP, SIDEWALK_GAP_M } from './pavedArea.js';
import { fastHypot } from './fastMath.js';

export const TILE_M = 256;
export const MARGIN_M = SIDEWALK_GAP_M + 8;
const SEG_CELL_M = 16;
const EDGE_IN_M = 0.3;   // the road surface read this far inside its edge

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
export function addPavedSidewalks(builder, { carriageways = [], corners = [], walks = [], runs = [], openGround = [], buildings = [], curbH = 0.15, crossSlope = 0.015, curbOnlyM = 0.3, THREE, groundAt = null } = {}) {
  const road = makeRoadHeight(carriageways);
  const heightAt = (x, y) => {
    const h = road(x, y); if (!h) return groundAt ? groundAt(x, y) : 0;
    const surface = groundAt ? groundAt(h.ex, h.ey) : h.z;
    return surface + curbH + crossSlope * Math.min(h.d, 6);
  };
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const cw of carriageways) for (const p of cw.nodes || []) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  const stats = { tiles: 0, slab: 0, curb: 0, skirt: 0, ms: 0 };
  const tiles = [];
  if (!Number.isFinite(x0)) return { tiles, heightAt, stats };
  const t0 = Date.now();
  const roads = carriageways.filter((c) => c.nodes?.length > 1).map((c) => ({ pts: c.nodes, half: c.half || 3 }));
  const arcs = corners.filter((c) => c.arc?.length > 1).map((c) => c.arc);
  const ws = walks.filter((w) => w.nodes?.length > 1).map((w) => ({ pts: w.nodes, half: w.half || 1, sidewalk: !!w.sidewalk, crossing: !!w.crossing }));
  // (a street-side run's band: its points are on the curb line, the walk out to one side)
  const offset = (pts, dist) => pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(pts.length - 1, i + 1)];
    const tx = b[0] - a[0]; const ty = b[1] - a[1]; const L = fastHypot(tx, ty) || 1;
    return [p[0] - (ty / L) * dist, p[1] + (tx / L) * dist];
  });
  const street = runs.filter((r) => r.points?.length > 1 && r.width > curbOnlyM).map((r) => ({ pts: offset(r.points, (r.side ?? 1) * r.width / 2), half: r.width / 2 }));
  const boxOf = (pts) => { let a = Infinity; let b = Infinity; let c = -Infinity; let d = -Infinity; for (const p of pts) { if (p[0] < a) a = p[0]; if (p[0] > c) c = p[0]; if (p[1] < b) b = p[1]; if (p[1] > d) d = p[1]; } return [a, b, c, d]; };
  const withBox = (list, get) => list.map((o) => ({ o, b: boxOf(get(o)) }));
  const R = withBox(roads, (o) => o.pts); const A = withBox(arcs, (o) => o); const W = withBox(ws, (o) => o.pts); const S = withBox(street, (o) => o.pts);
  const G = withBox(openGround.filter((r) => r.length > 2), (o) => o); const B = withBox(buildings.filter((r) => r.length > 2), (o) => o);
  const near = (list, bx) => list.filter(({ b }) => b[0] <= bx[2] && b[2] >= bx[0] && b[1] <= bx[3] && b[3] >= bx[1]).map(({ o }) => o);
  for (let tx = Math.floor(x0 / TILE_M) * TILE_M; tx < x1; tx += TILE_M) {
    for (let ty = Math.floor(y0 / TILE_M) * TILE_M; ty < y1; ty += TILE_M) {
      const core = [tx, ty, tx + TILE_M, ty + TILE_M];
      const box = [tx - MARGIN_M, ty - MARGIN_M, tx + TILE_M + MARGIN_M, ty + TILE_M + MARGIN_M];
      const tr = near(R, box);
      if (!tr.length) continue;
      const g = makeGrid(box[0], box[1], box[2], box[3]);
      const { cells } = buildPavedGrid(g, { roads: tr, cornerArcs: near(A, box), walks: near(W, box), streetWalks: near(S, box), greenery: near(G, box) });
      // (no slab into a building)
      const inB = new Uint8Array(cells.length);
      for (const ring of near(B, box)) markPolygon(inB, g, ring, 1);
      for (let i = 0; i < cells.length; i++) if (inB[i]) cells[i] &= ~(WALK | GAP);
      const rings = traceOutlines(cells, g, WALK | GAP);
      const m = buildPavedMesh(rings, cells, g, { heightAt, curbH, THREE, core });
      addToBuilder(builder, m);
      stats.tiles++; stats.slab += m.slab.length / 9; stats.curb += m.curb.length / 9; stats.skirt += m.skirt.length / 9;
      tiles.push({ cells, g, core });
    }
  }
  stats.ms = Date.now() - t0;
  return { tiles, heightAt, stats };
}

// slab triangles up, edge faces outward; UVs in world metres along the ground and along each face
function addToBuilder(builder, m) {
  const s = m.slab;
  for (let i = 0; i < s.length; i += 9) {
    const a = [s[i], s[i + 1], s[i + 2]]; const b = [s[i + 3], s[i + 4], s[i + 5]]; const c = [s[i + 6], s[i + 7], s[i + 8]];
    builder.tri('slab', a, b, c, [a[0], a[1]], [b[0], b[1]], [c[0], c[1]], [0, 0, 1]);
  }
  for (const [arr, mat] of [[m.curb, 'curb'], [m.skirt, 'curb']]) {
    for (let i = 0; i < arr.length; i += 18) {
      // (a quad as two triangles: a, b, b-down / a, b-down, a-down; its outward normal from the edge's direction)
      const a = [arr[i], arr[i + 1], arr[i + 2]]; const b = [arr[i + 3], arr[i + 4], arr[i + 5]]; const bd = [arr[i + 6], arr[i + 7], arr[i + 8]]; const ad = [arr[i + 15], arr[i + 16], arr[i + 17]];
      const L = fastHypot(b[0] - a[0], b[1] - a[1]) || 1; const want = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L, 0];
      const h = a[2] - ad[2];
      builder.tri(mat, a, b, bd, [0, h], [L, h], [L, 0], want);
      builder.tri(mat, a, bd, ad, [0, h], [L, 0], [0, 0], want);
    }
  }
}
