// The level's ground as models instead of a TerrainBlock (experimental "Ground as models"). A TerrainBlock must be a
// power-of-two square; a level whose ground is models can have any shape (a long strip of tiles, a road's corridor), as the
// terrain-less community levels are built (RC2K: one model cut into tiles, collision on the mesh, physics materials
// carrying the ground type).
//
// The ground is cut into GROUND_TILE squares of the terrain grid. Each tile is simplified with RTIN (right-triangulated
// irregular networks, the "Martini" method): a square is split only where the ground between its corners is more than
// GROUND_MAX_ERROR_M off the measured heights. Full resolution is kept where it matters:
//   - along every tile edge, so neighbouring tiles share the same points and leave no cracks;
//   - round the terrain holes (tunnel portals, pools), so the opening keeps its exact squares;
//   - where the surface type changes (a road's asphalt next to grass), so the physics material changes exactly
//     where the painted terrain did;
//   - along the edge of the kept area (a shaped level) and the grid's last row and column.
// Every grid point the mesh keeps has its exact height; between them the ground is within GROUND_MAX_ERROR_M.
//
// Grid convention (the TerrainBlock's): terrain space (i, j), j from the south, grid point (i, j) at world
// ((i - W/2) sq, (j - H/2) sq); heightMap rows run from the north (row r = H - 1 - j); the layer map is in terrain
// space (0, 0 = SW), 255 a hole. A square (i, j) is the square whose south-west corner is grid point (i, j).

// The level's edge: a wall from the ground's cut edge down, so a shaped level (tiles, a road's corridor) and a
// ground-model level's own rim read as a clean cut and not as a floating sheet (refs/output/tiles-step2-plan.md F).
// A clean shape running into the ground, as every generated structure; drawn only, no collision.
export const EDGE_SKIRT_M = 15;
export const GROUND_TILE = 256;             // grid squares a side per ground model (a power of two, for RTIN)
export const GROUND_MAX_ERROR_M = 0.05;     // the most the simplified ground may be off the grid between kept points (measured in game on a 1 km
                                            // lidar town: 3 cm 1.31 M triangles, 24 s of collision at load; 10 cm 0.76 M, 9 s)
const FORCE = 1e9;                          // an "error" that always splits

// The RTIN triangle coordinates for a tile of `T` squares (T + 1 points a side), shared by every tile.
const coordsCache = new Map();
function rtinCoords(T) {
  let c = coordsCache.get(T);
  if (c) return c;
  const numTriangles = T * T * 2 - 2;
  c = new Uint16Array(numTriangles * 4);
  for (let i = 0; i < numTriangles; i++) {
    let id = i + 2;
    let ax = 0; let ay = 0; let bx = 0; let by = 0; let cx = 0; let cy = 0;
    if (id & 1) { bx = by = cx = T; } else { ax = ay = cy = T; }
    while ((id >>= 1) > 1) {
      const mx = (ax + bx) >> 1; const my = (ay + by) >> 1;
      if (id & 1) { bx = ax; by = ay; ax = cx; ay = cy; } else { ax = bx; ay = by; bx = cx; by = cy; }
      cx = mx; cy = my;
    }
    const k = i * 4;
    c[k] = ax; c[k + 1] = ay; c[k + 2] = bx; c[k + 3] = by;
  }
  coordsCache.set(T, c);
  return c;
}

/**
 * The RTIN error of every point of a tile: `h` (T+1)² heights, `force` (T+1)² flags (1 = keep this point), into
 * `errors` (Float32Array (T+1)², filled here). A point's error covers its children's, so a split reaches every point
 * that must be kept.
 */
export function rtinErrors(h, force, T, errors) {
  const g = T + 1;
  const coords = rtinCoords(T);
  const numTriangles = T * T * 2 - 2;
  const numParents = numTriangles - T * T;
  for (let k = 0; k < g * g; k++) errors[k] = force[k] ? FORCE : 0;
  for (let i = numTriangles - 1; i >= 0; i--) {
    const k = i * 4;
    const ax = coords[k]; const ay = coords[k + 1]; const bx = coords[k + 2]; const by = coords[k + 3];
    const mx = (ax + bx) >> 1; const my = (ay + by) >> 1;
    const cx = mx + my - ay; const cy = my + ax - mx;
    const mid = my * g + mx;
    const e = Math.abs((h[ay * g + ax] + h[by * g + bx]) / 2 - h[mid]);
    let m = errors[mid] > e ? errors[mid] : e;
    if (i < numParents) {
      const l = errors[((ay + cy) >> 1) * g + ((ax + cx) >> 1)];
      const r = errors[((by + cy) >> 1) * g + ((bx + cx) >> 1)];
      if (l > m) m = l;
      if (r > m) m = r;
    }
    errors[mid] = m;
  }
}

/** The tile's triangles within maxError, as grid-point indices into the tile (a, b, c counter-clockwise from above). */
export function rtinTriangles(errors, T, maxError) {
  const g = T + 1;
  const out = [];
  const process = (ax, ay, bx, by, cx, cy) => {
    const mx = (ax + bx) >> 1; const my = (ay + by) >> 1;
    if (Math.abs(ax - cx) + Math.abs(ay - cy) > 1 && errors[my * g + mx] > maxError) {
      process(cx, cy, ax, ay, mx, my);
      process(bx, by, cx, cy, mx, my);
    } else {
      // (RTIN's a, b, c run clockwise seen from above: written a, c, b so the face is up)
      out.push(ay * g + ax, cy * g + cx, by * g + bx);
    }
  };
  process(0, 0, T, T, T, 0);
  process(T, T, 0, 0, 0, T);
  return out;
}

/**
 * The exact check: every grid point under triangle (pa, pc, pb) (tile point indices) within maxError of its plane.
 * RTIN's error is measured at midpoints against the level above, not against the final triangle, so a kept triangle
 * can be further off than maxError; this finds those. Returns -1 when the triangle is within, else the point to keep
 * to split it (the midpoint of its long edge, a to b).
 */
export function triangleOff(h, T, pa, pc, pb, maxError) {
  const g = T + 1;
  const ax = pa % g; const ay = (pa - ax) / g; const bx = pb % g; const by = (pb - bx) / g; const cx = pc % g; const cy = (pc - cx) / g;
  if (Math.abs(ax - cx) + Math.abs(ay - cy) <= 1) return -1;   // a half square: all its points are its corners
  const d = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  const ha = h[pa]; const hb = h[pb]; const hc = h[pc];
  const x0 = Math.min(ax, bx, cx); const x1 = Math.max(ax, bx, cx); const y0 = Math.min(ay, by, cy); const y1 = Math.max(ay, by, cy);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const lb = ((x - ax) * (cy - ay) - (cx - ax) * (y - ay)) / d;
      const lc = ((bx - ax) * (y - ay) - (x - ax) * (by - ay)) / d;
      const la = 1 - lb - lc;
      if (la < -1e-9 || lb < -1e-9 || lc < -1e-9) continue;
      if (Math.abs(la * ha + lb * hb + lc * hc - h[y * g + x]) > maxError) return ((ay + by) >> 1) * g + ((ax + bx) >> 1);
    }
  }
  return -1;
}

/**
 * The ground models: [{ key, i0, j0, groups: [{ groundModel, positions: Float32Array, normals, uvs }], skirt (the
 * edge wall's triangles in the same form, or null: drawn, never collided with), triangles,
 * fullTriangles }] per tile with ground in it, and a summary for the log.
 *
 * terrain: { width: W, height: H, heightMap (rows from the north), minHeight }; sq: metres per grid square;
 * layerMap: Uint8Array W·H in terrain space (255 a hole) or null; groundModelOf(layer): the ground model name of a
 * layer; keepSquare(i, j): false for a square outside the kept area (a shaped level), or null to keep all.
 */
export function buildGroundTiles({ width: W, height: H, heightMap, minHeight }, sq, {
  layerMap = null, groundModelOf = () => 'GRASS', keepSquare = null, tile = GROUND_TILE, maxError = GROUND_MAX_ERROR_M,
  // the edge wall: isLevelEdge(i, j) says whether a square that is not kept lies outside the level's ground (true) or
  // is only another part's to build (a chunk's neighbour: no wall there); null: every square not kept is outside.
  // skirtM 0: no wall.
  skirtM = EDGE_SKIRT_M, isLevelEdge = null,
} = {}) {
  const T = tile; const g = T + 1;
  const ok = (v) => (Number.isFinite(v) && v > -10000 ? v : minHeight);
  // grid point (i, j) height, relative to minHeight (the TerrainBlock's z), clamped to the grid
  const hAt = (i, j) => {
    const ii = i < 0 ? 0 : i > W - 1 ? W - 1 : i; const jj = j < 0 ? 0 : j > H - 1 ? H - 1 : j;
    return ok(heightMap[(H - 1 - jj) * W + ii]) - minHeight;
  };
  // a square's surface: its layer's ground model as a small index (-1 a hole, -2 outside the grid or the kept area)
  const gmIndex = new Map(); const gmNames = [];
  const layerGm = new Int16Array(256).fill(-3);
  const squareKind = (i, j) => {
    if (i < 0 || j < 0 || i >= W - 1 || j >= H - 1) return -2;
    if (keepSquare && !keepSquare(i, j)) return -2;
    const L = layerMap ? layerMap[j * W + i] : 0;
    if (L === 255) return -1;
    if (layerGm[L] === -3) {
      const name = groundModelOf(L) || 'GRASS';
      if (!gmIndex.has(name)) { gmIndex.set(name, gmNames.length); gmNames.push(name); }
      layerGm[L] = gmIndex.get(name);
    }
    return layerGm[L];
  };
  const tilesX = Math.ceil((W - 1) / T); const tilesY = Math.ceil((H - 1) / T);
  const h = new Float32Array(g * g); const force = new Uint8Array(g * g); const errors = new Float32Array(g * g);
  const kind = new Int16Array((T + 2) * (T + 2));   // square kinds of the tile plus a one-square ring
  const out = [];
  let triangles = 0; let full = 0; let holes = 0; let outside = 0; let refinePasses = 0; let skirtTriangles = 0;
  // (a square beside a kept one that is outside the level: past the grid, or not kept and not another part's)
  const beyond = (i, j) => (i < 0 || j < 0 || i >= W - 1 || j >= H - 1 ? (isLevelEdge ? isLevelEdge(i, j) : true)
    : !!keepSquare && !keepSquare(i, j) && (isLevelEdge ? isLevelEdge(i, j) : true));
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const i0 = tx * T; const j0 = ty * T;
      // the tile's square kinds (a ring round it too, to see changes at its edge)
      let any = false;
      for (let b = -1; b <= T; b++) {
        for (let a = -1; a <= T; a++) {
          const k = squareKind(i0 + a, j0 + b);
          kind[(b + 1) * (T + 2) + (a + 1)] = k;
          if (k >= 0 && a >= 0 && b >= 0 && a < T && b < T) any = true;
        }
      }
      if (!any) continue;
      // heights, and the points to keep: the tile's edge, and any point whose four squares differ in kind
      for (let b = 0; b <= T; b++) {
        for (let a = 0; a <= T; a++) {
          const p = b * g + a;
          h[p] = hAt(i0 + a, j0 + b);
          let f = a === 0 || b === 0 || a === T || b === T ? 1 : 0;
          if (!f) {
            const k00 = kind[b * (T + 2) + a]; const k10 = kind[b * (T + 2) + a + 1];
            const k01 = kind[(b + 1) * (T + 2) + a]; const k11 = kind[(b + 1) * (T + 2) + a + 1];
            if (k00 !== k10 || k00 !== k01 || k00 !== k11) f = 1;
          }
          force[p] = f;
        }
      }
      // simplify, then hold every kept triangle to the exact bound: one that is off keeps its long edge's midpoint
      // and the tile is simplified again (a split decided per point, so both triangles on that edge split alike and
      // no crack opens)
      let tri;
      for (let pass = 0; ; pass++) {
        rtinErrors(h, force, T, errors);
        tri = rtinTriangles(errors, T, maxError);
        let added = 0;
        for (let t = 0; t < tri.length; t += 3) {
          const m = triangleOff(h, T, tri[t], tri[t + 1], tri[t + 2], maxError);
          if (m >= 0 && !force[m]) { force[m] = 1; added++; }
        }
        if (!added) break;
        refinePasses++;
      }
      // triangles per surface; a triangle's square is the one its centroid is in (a triangle over a kind change is a
      // single square's half, as those points are kept)
      const perGm = new Map();
      for (let t = 0; t < tri.length; t += 3) {
        const pa = tri[t]; const pb = tri[t + 1]; const pc = tri[t + 2];
        const ca = Math.floor(((pa % g) + (pb % g) + (pc % g)) / 3); const cb = Math.floor((Math.floor(pa / g) + Math.floor(pb / g) + Math.floor(pc / g)) / 3);
        const k = kind[(cb + 1) * (T + 2) + (ca + 1)];
        if (k === -1) { holes++; continue; }
        if (k < 0) { outside++; continue; }
        let l = perGm.get(k); if (!l) perGm.set(k, (l = []));
        l.push(pa, pb, pc);
      }
      if (!perGm.size) continue;
      const groups = [];
      let n = 0;
      for (const [k, l] of [...perGm].sort((x, y) => x[0] - y[0])) {
        const count = l.length;
        const positions = new Float32Array(count * 3); const normals = new Float32Array(count * 3); const uvs = new Float32Array(count * 2);
        for (let v = 0; v < count; v++) {
          const p = l[v]; const a = p % g; const b = (p - a) / g;
          const i = i0 + a; const j = j0 + b;
          positions[v * 3] = (i - W / 2) * sq; positions[v * 3 + 1] = (j - H / 2) * sq; positions[v * 3 + 2] = h[p];
          // the grid's own normal at the point (central differences), so shading matches the full-resolution ground
          const dx = (hAt(i + 1, j) - hAt(i - 1, j)) / (2 * sq); const dy = (hAt(i, j + 1) - hAt(i, j - 1)) / (2 * sq);
          const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
          normals[v * 3] = -dx * inv; normals[v * 3 + 1] = -dy * inv; normals[v * 3 + 2] = inv;
          // the base texture over the whole map, as the TerrainBlock lays it (Collada's t from the bottom)
          uvs[v * 2] = i / W; uvs[v * 2 + 1] = j / H;
        }
        groups.push({ groundModel: gmNames[k], positions, normals, uvs });
        n += count / 3;
      }
      triangles += n;
      full += 2 * Math.min(T, W - 1 - i0) * Math.min(T, H - 1 - j0);
      // the edge wall: under every side of a kept square (a hole is no ground) that faces outside the level. Each
      // side is walked with the outside on its right, so the two triangles face outward.
      let skirt = null;
      if (skirtM > 0) {
        const pos = []; const nrm = []; const uv = [];
        const wall = (ia, ja, ib, jb, nx, ny) => {
          const ax = (ia - W / 2) * sq; const ay = (ja - H / 2) * sq; const bx = (ib - W / 2) * sq; const by = (jb - H / 2) * sq;
          const za = hAt(ia, ja); const zb = hAt(ib, jb);
          pos.push(ax, ay, za, ax, ay, za - skirtM, bx, by, zb - skirtM, ax, ay, za, bx, by, zb - skirtM, bx, by, zb);
          for (let k = 0; k < 6; k++) nrm.push(nx, ny, 0);
          // (its colour: the base texture a square and a half outside the edge, where a shaped level's texture is
          // painted an even dark (exportBeamNGLevel.js paintTextureOutsideShape). At the edge itself every column of
          // the wall took the ground's own colour there: fine vertical streaks, seen in game. Past the map's own rim
          // there is no texture: the edge's colour, as before.)
          const ua = (ia + nx * 1.5) / W; const va = (ja + ny * 1.5) / H; const ub = (ib + nx * 1.5) / W; const vb = (jb + ny * 1.5) / H;
          const off = ua >= 0 && ua <= 1 && va >= 0 && va <= 1 && ub >= 0 && ub <= 1 && vb >= 0 && vb <= 1;
          const [u0, v0, u1, v1] = off ? [ua, va, ub, vb] : [ia / W, ja / H, ib / W, jb / H];
          uv.push(u0, v0, u0, v0, u1, v1, u0, v0, u1, v1, u1, v1);
        };
        for (let b = 0; b < T; b++) {
          for (let a = 0; a < T; a++) {
            if (kind[(b + 1) * (T + 2) + (a + 1)] < 0) continue;
            const i = i0 + a; const j = j0 + b;
            if (beyond(i, j - 1)) wall(i, j, i + 1, j, 0, -1);
            if (beyond(i + 1, j)) wall(i + 1, j, i + 1, j + 1, 1, 0);
            if (beyond(i, j + 1)) wall(i + 1, j + 1, i, j + 1, 0, 1);
            if (beyond(i - 1, j)) wall(i, j + 1, i, j, -1, 0);
          }
        }
        if (pos.length) { skirt = { positions: Float32Array.from(pos), normals: Float32Array.from(nrm), uvs: Float32Array.from(uv), groundModel: groups[0].groundModel }; skirtTriangles += pos.length / 9; }
      }
      out.push({ key: `${tx}_${ty}`, i0, j0, groups, skirt, triangles: n });
    }
  }
  return { tiles: out, groundModels: gmNames, summary: { tiles: out.length, triangles, fullTriangles: full, holeTriangles: holes, outsideTriangles: outside, skirtTriangles, skirtM, refinePasses, maxError, tile: T } };
}
