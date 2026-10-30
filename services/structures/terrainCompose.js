// Structure solver, stage E: the terrain the solved roads need, written once
// (refs/output/bridge-tunnel-plan.md).
//
// Every road stretch contributes a corridor: its core at the solved road
// height, side slopes back to the terrain sized to the height difference
// (fill or cut), the ground under a deck held below its underside, nothing
// over a tunnel. Where corridors overlap the one whose core is nearest wins
// (equal: averaged), so a junction, where every road has one solved height,
// comes out flat instead of a round bump. Edits live in sparse tiles (a
// full-grid buffer is 1 GiB at 16k). Nothing here knows about any place.

const TILE = 64;
const SHOULDER_M = 1;          // flat past the paved half width before the slope
const GROUND_BLEND_M = 4;      // a road at ground level blends back over this far
const FILL_RUN = 2;            // embankment side slope: 1 m up per 2 m out
const CUT_RUN = 1.5;           // cutting side slope
const SLOPE_MIN_M = 2;
const SLOPE_MAX_M = 40;
const DECK_UNDER_M = 2.2;      // deck depth under its road surface
const DECK_CLEAR_M = 0.5;      // terrain at least this far under a deck's underside
const DECK_REACH_M = 1.5;      // past a deck's half width
const ABUTMENT_M = 8;
const DECK_ABUT_CLEAR_M = 0.3;  // abutment fill stops this far under the deck's underside          // a deck end on fill rests on it this far: no cap there

const smoothstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * Compose the terrain edits for a solved, classified graph.
 *   grid: { heightMap, width, height, worldSize, minHeight } (raw heights;
 *         world z = raw - minHeight, world x, y centred, y north)
 * Returns { tiles, stats, heightAt(x, y), apply(set) }:
 *   heightAt: the composed terrain in world z (edits over the current grid)
 *   apply(set): calls set(idx, raw) for every edited pixel
 */
export function composeTerrain(graph, grid) {
  const { heightMap, width, height, worldSize, minHeight = 0 } = grid;
  const z = graph.profile?.z;
  const segments = graph.classes?.segments || [];
  const toPixel = (x, y) => [(x / worldSize + 0.5) * (width - 1), (0.5 - y / worldSize) * (height - 1)];
  const toWorld = (c, r) => [((c / (width - 1)) - 0.5) * worldSize, (0.5 - r / (height - 1)) * worldSize];
  const raw = (c, r) => heightMap[r * width + c];
  const tiles = new Map();
  const tileFor = (c, r) => {
    const key = Math.floor(c / TILE) * 65536 + Math.floor(r / TILE);
    let t = tiles.get(key);
    if (!t) {
      t = { h: new Float32Array(TILE * TILE), w: new Float32Array(TILE * TILE).fill(Infinity), n: new Uint8Array(TILE * TILE), cap: new Float32Array(TILE * TILE).fill(Infinity) };
      tiles.set(key, t);
    }
    return t;
  };
  const stats = { pixels: 0, capped: 0, corridors: 0, wallPixels: 0, roadUnderDeckTooLow: 0 };
  if (!z) return { tiles, stats, heightAt: () => NaN, apply: () => {} };

  // kind per station of every edge
  const kindOf = graph.edges.map((e) => new Array(e.s.length).fill('ground'));
  for (const seg of segments) for (let i = seg.i0; i <= seg.i1; i++) kindOf[seg.edge][i] = seg.kind;

  // how far each deck station is from a deck end that hands over to a
  // stretch on the ground (an abutment): a deck rests on its fill there
  const nodeKinds = new Map();
  graph.edges.forEach((e, k) => {
    for (const [id, i] of [[e.from, 0], [e.to, e.s.length - 1]]) {
      if (id === undefined) continue;
      if (!nodeKinds.has(id)) nodeKinds.set(id, []);
      nodeKinds.get(id).push(kindOf[k][i]);
    }
  });
  const toAbutment = graph.edges.map((e, k) => {
    const out = new Float64Array(e.s.length).fill(Infinity);
    const kinds = kindOf[k];
    const endOnFill = (id) => (nodeKinds.get(id) || []).some((kk) => kk !== 'deck');
    let last = endOnFill(e.from) && kinds[0] === 'deck' ? 0 : -Infinity;
    for (let i = 0; i < kinds.length; i++) {
      if (kinds[i] !== 'deck') { last = e.s[i]; continue; }
      out[i] = Math.min(out[i], e.s[i] - last);
    }
    let next = endOnFill(e.to) && kinds[kinds.length - 1] === 'deck' ? e.s[e.s.length - 1] : Infinity;
    for (let i = kinds.length - 1; i >= 0; i--) {
      if (kinds[i] !== 'deck') { next = e.s[i]; continue; }
      out[i] = Math.min(out[i], next - e.s[i]);
    }
    return out;
  });

  const abutmentOff = (kind, k, j) => (kind === 'deck' && toAbutment[k][j] < ABUTMENT_M ? DECK_UNDER_M : 0);
  graph.edges.forEach((e, k) => {
    const zk = z[k];
    for (let i = 0; i + 1 < e.s.length; i++) {
      const kind = kindOf[k][i];
      if (kind === 'boredTunnel' || kind === 'cutAndCover' || kind === 'external') continue;
      // a deck's ends on fill are abutments: fill under the deck (below)
      const abutment = kind === 'deck' && Math.min(toAbutment[k][i], toAbutment[k][i + 1]) < ABUTMENT_M;
      const deck = kind === 'deck' && !abutment;
      const ax = e.x[i]; const ay = e.y[i]; const bx = e.x[i + 1]; const by = e.y[i + 1];
      const vx = bx - ax; const vy = by - ay; const L2 = vx * vx + vy * vy;
      if (L2 < 1e-9) continue;
      const core = e.half + SHOULDER_M;
      // the side slope only reaches as far as this piece's height difference
      // from the terrain needs (most roads sit at ground level: 4 m)
      const offAt = (j) => {
        const [pc, pr] = toPixel(e.x[j], e.y[j]);
        const cc = Math.max(0, Math.min(width - 1, Math.round(pc))); const rr = Math.max(0, Math.min(height - 1, Math.round(pr)));
        return Math.abs(zk[j] - (abutmentOff(kind, k, j)) - (raw(cc, rr) - minHeight));
      };
      const off = Math.max(offAt(i), offAt(i + 1)) + 1;
      const reach = deck ? e.half + DECK_REACH_M : core + Math.min(SLOPE_MAX_M, Math.max(GROUND_BLEND_M, off * FILL_RUN + 2));
      const [c0, r0] = toPixel(Math.min(ax, bx) - reach, Math.max(ay, by) + reach);
      const [c1, r1] = toPixel(Math.max(ax, bx) + reach, Math.min(ay, by) - reach);
      stats.corridors++;
      for (let r = Math.max(0, Math.floor(r0)); r <= Math.min(height - 1, Math.ceil(r1)); r++) {
        for (let c = Math.max(0, Math.floor(c0)); c <= Math.min(width - 1, Math.ceil(c1)); c++) {
          const [x, y] = toWorld(c, r);
          const uRaw = ((x - ax) * vx + (y - ay) * vy) / L2;
          const u = Math.max(0, Math.min(1, uRaw));
          const d = Math.hypot(ax + vx * u - x, ay + vy * u - y);
          if (d > reach) continue;
          const zc = zk[i] + (zk[i + 1] - zk[i]) * u - (abutment ? DECK_UNDER_M + DECK_ABUT_CLEAR_M : 0);
          const t = tileFor(c, r); const j = (r % TILE) * TILE + (c % TILE);
          if (deck) {
            // under the deck only, not round its ends
            if (uRaw < 0 || uRaw > 1) continue;
            const cap = zc - DECK_UNDER_M - DECK_CLEAR_M;
            if (cap < t.cap[j]) t.cap[j] = cap;
            continue;
          }
          const h0 = raw(c, r) - minHeight;
          let slope = GROUND_BLEND_M;
          if (kind === 'embankment' || kind === 'cutting' || Math.abs(zc - h0) > 0.5) {
            slope = Math.min(SLOPE_MAX_M, Math.max(SLOPE_MIN_M, Math.abs(zc - h0) * (zc > h0 ? FILL_RUN : CUT_RUN)));
          }
          const tt = d <= core ? 0 : (d - core) / slope;
          if (tt >= 1) continue;
          const target = zc + (h0 - zc) * smoothstep(tt);
          // the road whose core is physically nearest owns the pixel (inside
          // two cores, the nearer centreline; equal: averaged). Two roads side by side at different
          // heights then meet in a step midway between them, where a
          // retaining wall stands, instead of tilting into both.
          // negative inside a road's core (the nearer centreline wins there
          // too); abutment fill never counts as a road core
          // (inside any road core beats every side slope, and among cores the
          // nearer centreline wins outright: a wide road must not take a
          // narrower road's own surface just because its core reaches)
          const out = abutment ? Math.max(1e-3, d - core) : (d <= core ? -1000 + d : d - core);
          if (out < t.w[j] - 1e-3) { t.w[j] = out; t.h[j] = target; t.n[j] = 1; }
          else if (Math.abs(out - t.w[j]) <= 1e-3) { t.h[j] = (t.h[j] * t.n[j] + target) / (t.n[j] + 1); t.n[j] = Math.min(255, t.n[j] + 1); }
        }
      }
    }
  });

  // the edited value of a pixel in world z, or NaN if untouched (a despiked
  // pixel's value from `spiked`)
  const spiked = new Map();
  const edited = (c, r) => {
    const sv = spiked.get(r * width + c);
    if (sv !== undefined) return sv;
    const t = tiles.get(Math.floor(c / TILE) * 65536 + Math.floor(r / TILE));
    if (!t) return NaN;
    const j = (r % TILE) * TILE + (c % TILE);
    const base = Number.isFinite(t.w[j]) ? t.h[j] : raw(c, r) - minHeight;
    if (!Number.isFinite(t.w[j]) && !Number.isFinite(t.cap[j])) return NaN;
    // a road's own core is never dug below its surface by a deck over it
    // (too little room there is the crossing's problem, counted, not a trench)
    if (t.w[j] <= 0) return base;
    return Math.min(base, t.cap[j]);
  };
  for (const [key, t] of tiles) {
    const tc = Math.floor(key / 65536); const tr = key - tc * 65536;
    for (let j = 0; j < TILE * TILE; j++) {
      if (Number.isFinite(t.w[j]) || Number.isFinite(t.cap[j])) {
        stats.pixels++;
        if (t.w[j] <= 0 && t.cap[j] < t.h[j]) stats.roadUnderDeckTooLow++;
        if (Number.isFinite(t.cap[j])) {
          const c = tc * TILE + (j % TILE); const r = tr * TILE + Math.floor(j / TILE);
          if (c < width && r < height && edited(c, r) < (Number.isFinite(t.w[j]) ? t.h[j] : raw(c, r) - minHeight)) stats.capped++;
        }
      }
    }
  }
  // despike: an edited pixel more than SPIKE_M off the median of its 3x3
  // neighbourhood takes the median (corners where three corridors meet at
  // different heights left single pixels standing metres proud)
  const SPIKE_M = 2;
  const win = new Float64Array(9);
  const value = (c, r) => { const e = edited(c, r); return Number.isFinite(e) ? e : raw(c, r) - minHeight; };
  for (let pass = 0; pass < 2; pass++) {
    const fix = [];
    for (const key of tiles.keys()) {
      const tc = Math.floor(key / 65536); const tr = key - tc * 65536;
      for (let j = 0; j < TILE * TILE; j++) {
        const c = tc * TILE + (j % TILE); const r = tr * TILE + Math.floor(j / TILE);
        if (c < 1 || r < 1 || c + 1 >= width || r + 1 >= height) continue;
        const h = edited(c, r);
        if (!Number.isFinite(h)) continue;
        let n = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) win[n++] = value(c + dc, r + dr);
        win.sort();
        if (Math.abs(h - win[4]) > SPIKE_M) fix.push([r * width + c, win[4]]);
      }
    }
    for (const [idx, v] of fix) spiked.set(idx, v);
    stats.despiked = (stats.despiked || 0) + fix.length;
    if (!fix.length) break;
  }
  // steps between neighbouring edited pixels: where retaining walls go
  const WALL_STEP_M = 0.5;
  for (const key of tiles.keys()) {
    const tc = Math.floor(key / 65536); const tr = key - tc * 65536;
    for (let j = 0; j < TILE * TILE; j++) {
      const c = tc * TILE + (j % TILE); const r = tr * TILE + Math.floor(j / TILE);
      if (c + 1 >= width || r + 1 >= height) continue;
      const h = edited(c, r);
      if (!Number.isFinite(h)) continue;
      const hx = edited(c + 1, r); const hy = edited(c, r + 1);
      if ((Number.isFinite(hx) && Math.abs(hx - h) > WALL_STEP_M) || (Number.isFinite(hy) && Math.abs(hy - h) > WALL_STEP_M)) stats.wallPixels++;
    }
  }
  const heightAt = (x, y) => {
    const [fc, fr] = toPixel(x, y);
    const c0 = Math.max(0, Math.min(width - 2, Math.floor(fc))); const r0 = Math.max(0, Math.min(height - 2, Math.floor(fr)));
    const fx = fc - c0; const fy = fr - r0;
    const v = (c, r) => { const e = edited(c, r); return Number.isFinite(e) ? e : raw(c, r) - minHeight; };
    return v(c0, r0) * (1 - fx) * (1 - fy) + v(c0 + 1, r0) * fx * (1 - fy) + v(c0, r0 + 1) * (1 - fx) * fy + v(c0 + 1, r0 + 1) * fx * fy;
  };
  const apply = (set) => {
    for (const key of tiles.keys()) {
      const tc = Math.floor(key / 65536); const tr = key - tc * 65536;
      for (let j = 0; j < TILE * TILE; j++) {
        const c = tc * TILE + (j % TILE); const r = tr * TILE + Math.floor(j / TILE);
        if (c >= width || r >= height) continue;
        const e = edited(c, r);
        if (Number.isFinite(e)) set(r * width + c, e + minHeight);
      }
    }
  };
  return { tiles, stats, heightAt, apply };
}
