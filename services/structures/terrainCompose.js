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

import { findSideArms, sideArmFromEnd, sideArmStation, throughSurface } from './sideArms.js';
import { seatable } from './profileSolve.js';

const TILE = 64;
const SHOULDER_M = 1;          // flat past the paved half width before the slope
const GROUND_BLEND_M = 4;      // a road at ground level blends back over this far
const RACEWAY_BANK_MAX = 0.62;  // steepest banking kept (32 degrees: past any real oval's)
const FILL_RUN = 2;            // embankment side slope: 1 m up per 2 m out
const CUT_RUN = 1.5;           // cutting side slope
const SLOPE_MIN_M = 2;
const SLOPE_MAX_M = 40;
const DECK_UNDER_M = 2.2;      // deck depth under its road surface
const DECK_CLEAR_M = 0.5;      // terrain at least this far under a deck's underside
const DECK_REACH_M = 1.5;      // past a deck's half width
const ABUTMENT_M = 8;
const CORE_STEP_M = 2;          // road cores this far apart in height are on two levels
const CORE_OUTER = 0.6;         // ...where the lower road may take the upper's outer core only
const SIDE_WARP_M = 12;         // a side road leaves its through road's edge at that road's grade across it, level again this far on
const SIDE_WARP_MAX = 0.2;
const SIDE_SQUARE_M = 15;       // a side road's pieces this far past its through road's edge never reach back behind it
const DECK_ABUT_CLEAR_M = 0.3;  // abutment fill stops this far under the deck's underside          // a deck end on fill rests on it this far: no cap there

const smoothstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// The x extent where a row at y crosses the capsule within R of the piece
// a–b (the disks round its ends and the band along it), or null: a corridor's
// pixels row by row, not its whole axis-aligned box (most of a diagonal
// piece's box lies outside its reach).
function capsuleSpan(ax, ay, bx, by, R, y) {
  let lo = Infinity; let hi = -Infinity;
  for (const [px, py] of [[ax, ay], [bx, by]]) {
    const dy = y - py;
    if (Math.abs(dy) <= R) { const w = Math.sqrt(R * R - dy * dy); lo = Math.min(lo, px - w); hi = Math.max(hi, px + w); }
  }
  const vx = bx - ax; const vy = by - ay; const L = Math.sqrt(vx * vx + vy * vy);
  if (L > 1e-9) {
    const tx = vx / L; const ty = vy / L;
    let sLo = -Infinity; let sHi = Infinity;
    // min <= k·x + c0 <= max
    const clip = (k, c0, min, max) => {
      if (Math.abs(k) < 1e-12) { if (c0 < min || c0 > max) sLo = Infinity; return; }
      let a = (min - c0) / k; let b = (max - c0) / k;
      if (a > b) [a, b] = [b, a];
      sLo = Math.max(sLo, a); sHi = Math.min(sHi, b);
    };
    clip(tx, -ax * tx + (y - ay) * ty, 0, L);
    clip(-ty, ax * ty + (y - ay) * tx, -R, R);
    if (sLo <= sHi) { lo = Math.min(lo, sLo); hi = Math.max(hi, sHi); }
  }
  return lo <= hi ? [lo, hi] : null;
}

/**
 * Compose the terrain edits for a solved, classified graph.
 *   grid: { heightMap, width, height, worldSize, minHeight, keep? } (raw
 *         heights; world z = raw - minHeight, world x, y centred, y north;
 *         keep(idx): ground another builder shaped, left alone outside the
 *         road cores; tube(idx): ground over a built tube, composed only under a
 *         road's own surface); skip(k, i): the piece i..i+1 of edge k is
 *         left alone (terrain shaping switched off for it)
 * Returns { tiles, stats, heightAt(x, y), apply(set) }:
 *   heightAt: the composed terrain in world z (edits over the current grid)
 *   apply(set): calls set(idx, raw) for every edited pixel
 */
export function composeTerrain(graph, grid) {
  const { heightMap, width, height, worldSize, minHeight = 0, keep = null, tube = null, skip = null } = grid;
  const z = graph.profile?.z;
  const segments = graph.classes?.segments || [];
  // the game's grid (services/terrainLookup.js terrainGroundAt): sample c at (c - W/2) squares,
  // rows from the south. The old (W - 1)-span mapping drifted up to a square across the map:
  // centimetres at 1 m squares, at 10 m a road's bench cut 10 m beside the road.
  const squareM = worldSize / Math.max(1, width);
  const toPixel = (x, y) => [x / squareM + width / 2, (height - 1) - (y / squareM + height / 2)];
  const xOfCol = (c) => (c - width / 2) * squareM;
  const yOfRow = (r) => ((height - 1 - r) - height / 2) * squareM;
  const raw = (c, r) => heightMap[r * width + c];
  // On a coarse grid (a big map at 4, 10 m squares) a corridor sized in metres falls between the
  // grid's points: one point at the road's height, its neighbours left on the hillside, and the
  // triangles between them a row of teeth along the road. The flat shoulder is at least one
  // square (the points round the pavement's triangles are then all on the road) and a side slope
  // or blend at least two. At 1 m squares nothing changes.
  const shoulderM = Math.max(SHOULDER_M, squareM);
  const blendM = Math.max(GROUND_BLEND_M, 2 * squareM);
  const slopeMinM = Math.max(SLOPE_MIN_M, 2 * squareM);
  const tiles = new Map();
  const tileFor = (c, r) => {
    const key = Math.floor(c / TILE) * 65536 + Math.floor(r / TILE);
    let t = tiles.get(key);
    if (!t) {
      t = { h: new Float32Array(TILE * TILE), w: new Float32Array(TILE * TILE).fill(Infinity), q: new Float32Array(TILE * TILE).fill(1), n: new Uint8Array(TILE * TILE), cap: new Float32Array(TILE * TILE).fill(Infinity) };
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

  // ends that run into a tube (a tunnel's or another builder's stretch,
  // left to it): no corridor round them, a cutting's floor carried on past
  // the portal stood the terrain inside the tube
  // (a dam's crest: the dam is built over the ground, which stays as it is)
  const TUBE = new Set(['boredTunnel', 'cutAndCover', 'external', 'dam']);
  // (a tube another builder builds: an unbuilt tunnel road stays on the
  // ground, its approach composed on into it)
  const BUILT = new Set(['external']);
  const tubeNode = new Set();
  for (const [id, kinds] of nodeKinds) if (kinds.some((kk) => BUILT.has(kk))) tubeNode.add(id);
  // where a road goes into one, a plane across it: none of the road's
  // corridor beyond (every segment's rounded reach, not the last one's only)
  const PORTAL_PLANE_M = 40;
  const portalPlanes = graph.edges.map((e, k) => {
    const n = e.s.length; const kinds = kindOf[k]; const out = [];
    // at station `at`, facing from station `a` toward `b` (into the tube)
    const plane = (at, a, b) => {
      const dx = e.x[b] - e.x[a]; const dy = e.y[b] - e.y[a]; const L = Math.hypot(dx, dy);
      if (L > 1e-6) out.push([e.x[at], e.y[at], dx / L, dy / L]);
    };
    if (n < 2) return out;
    if (tubeNode.has(e.to) && !TUBE.has(kinds[n - 2])) plane(n - 1, n - 2, n - 1);
    if (tubeNode.has(e.from) && !TUBE.has(kinds[0])) plane(0, 1, 0);
    for (let j = 1; j + 1 < n; j++) {
      if (BUILT.has(kinds[j]) && !TUBE.has(kinds[j - 1])) plane(j, j - 1, j);
      if (!TUBE.has(kinds[j]) && BUILT.has(kinds[j - 1])) plane(j - 1, j, j - 1);
    }
    return out;
  });
  // pixels a corridor reached but left alone (past a portal, a tunnel's
  // cutting): still despiked, a lone one among composed ground stood metres
  // proud
  const left = new Set();
  const abutmentOff = (kind, k, j) => (kind === 'deck' && toAbutment[k][j] < ABUTMENT_M ? DECK_UNDER_M : 0);
  // a side road's pieces under its through road's lanes (sideArms.js): the
  // through road's surface there, so any other road's core wins the pixel
  const yields = new Map();
  const warps = new Map();
  const squareEnds = new Map();
  for (const arm of findSideArms(graph, seatable(graph))) {
    const e = graph.edges[arm.edge];
    let set = yields.get(arm.edge);
    if (!set) { set = new Uint8Array(e.s.length); yields.set(arm.edge, set); }
    for (let j = 0; j + 1 <= arm.under; j++) set[Math.min(sideArmStation(e, arm.end, j), sideArmStation(e, arm.end, j + 1))] = 1;
    // past the lanes its surface is twisted to the through road's grade
    // where it leaves them, level again SIDE_WARP_M on: level across from
    // the edge, a side street's strip stood 0.4-0.7 m proud of a 13% trunk
    // road at one corner and as far under it at the other
    if (z && arm.under + 1 < e.s.length) {
      const i0 = sideArmStation(e, arm.end, arm.under); const i1 = sideArmStation(e, arm.end, arm.under + 1);
      const a = Math.min(i0, i1); const b = Math.max(i0, i1);
      const dx = e.x[b] - e.x[a]; const dy = e.y[b] - e.y[a]; const L = Math.hypot(dx, dy);
      if (L > 1e-6) {
        // (to the left of the edge's own direction, as the banking below)
        const nx = -dy / L; const ny = dx / L; const h = Math.max(1, e.half);
        const zOf = (k, i) => z[k][i];
        const l = throughSurface(graph, arm.mains, zOf, e.x[i0] + nx * h, e.y[i0] + ny * h);
        const r = throughSurface(graph, arm.mains, zOf, e.x[i0] - nx * h, e.y[i0] - ny * h);
        if (l && r) {
          const tilt = Math.max(-SIDE_WARP_MAX, Math.min(SIDE_WARP_MAX, (l.z - r.z) / (2 * h)));
          let w = warps.get(arm.edge);
          if (!w) { w = new Float32Array(e.s.length); warps.set(arm.edge, w); }
          const reach = sideArmFromEnd(e, arm.end, i0);
          // (under the lanes too: its strip past the through road's shoulder is still that road's grade)
          for (let j = 0; j < e.s.length; j++) {
            const i = sideArmStation(e, arm.end, j); const t = (sideArmFromEnd(e, arm.end, i) - reach) / SIDE_WARP_M;
            if (t >= 1) break;
            w[i] += tilt * (1 - smoothstep(t));
          }
        }
      }
    }
    // (the pieces clear of the lanes end square toward them, at the line across the first clear station: no
    // round end back over the outer lane, nor the next pieces' round ends, a road's width behind them)
    if (arm.under + 1 < e.s.length) {
      const i0 = sideArmStation(e, arm.end, arm.under); const i1 = sideArmStation(e, arm.end, arm.under + 1);
      const dx = e.x[i1] - e.x[i0]; const dy = e.y[i1] - e.y[i0]; const L = Math.hypot(dx, dy);
      if (L > 1e-6) {
        const reach = sideArmFromEnd(e, arm.end, i0);
        let list = squareEnds.get(arm.edge);
        if (!list) { list = []; squareEnds.set(arm.edge, list); }
        const pieces = new Set();
        for (let j = arm.under; j + 1 < e.s.length; j++) {
          if (sideArmFromEnd(e, arm.end, sideArmStation(e, arm.end, j)) - reach > SIDE_SQUARE_M) break;
          pieces.add(Math.min(sideArmStation(e, arm.end, j), sideArmStation(e, arm.end, j + 1)));
        }
        list.push({ px: e.x[i0], py: e.y[i0], dx: dx / L, dy: dy / L, pieces });
      }
    }
  }
  graph.edges.forEach((e, k) => {
    const zk = z[k];
    for (let i = 0; i + 1 < e.s.length; i++) {
      const kind = kindOf[k][i];
      if (TUBE.has(kind)) continue;
      // terrain shaping switched off for this piece (structures/shaping.js)
      if (skip && skip(k, i)) { stats.skipped = (stats.skipped || 0) + 1; continue; }
      const planes = portalPlanes[k];
      const yielding = !!yields.get(k)?.[i];
      const squares = (squareEnds.get(k) || []).filter((q) => q.pieces.has(i));
      // a deck's ends on fill are abutments: fill under the deck (below)
      const abutment = kind === 'deck' && Math.min(toAbutment[k][i], toAbutment[k][i + 1]) < ABUTMENT_M;
      const deck = kind === 'deck' && !abutment;
      const ax = e.x[i]; const ay = e.y[i]; const bx = e.x[i + 1]; const by = e.y[i + 1];
      const vx = bx - ax; const vy = by - ay; const L2 = vx * vx + vy * vy;
      if (L2 < 1e-9) continue;
      const core = e.half + (kind === 'deck' ? SHOULDER_M : shoulderM);
      // a railway's profile is the top of its rails: the ground under it is
      // its formation, the track's depth lower (e.drop per station: none
      // where a road crosses it at grade, services/railways.js)
      const dropAt = (j) => (e.drop ? e.drop[j] : 0);
      // a raceway keeps its ground's banking (an oval's turns, 20-30 degrees
      // in the elevation data): across its core the surface tilts as the
      // terrain does there, not levelled into a shelf with a cliff each side
      let bank = 0;
      const warp = warps.get(k);
      if (warp && !deck) bank = (warp[i] + warp[i + 1]) / 2;
      if (e.highway === 'raceway' && !deck) {
        const L = Math.sqrt(L2); const nx = -vy / L; const ny = vx / L;
        const mx = (ax + bx) / 2; const my = (ay + by) / 2; const o = e.half * 0.7;
        const hAt = (x, y) => { const [pc, pr] = toPixel(x, y); const cc = Math.max(0, Math.min(width - 1, Math.round(pc))); const rr = Math.max(0, Math.min(height - 1, Math.round(pr))); return raw(cc, rr); };
        const hl = hAt(mx + nx * o, my + ny * o); const hr = hAt(mx - nx * o, my - ny * o);
        if (Number.isFinite(hl) && Number.isFinite(hr)) bank = Math.max(-RACEWAY_BANK_MAX, Math.min(RACEWAY_BANK_MAX, (hl - hr) / (2 * o)));
      }
      // the side slope only reaches as far as this piece's height difference
      // from the terrain needs (most roads sit at ground level: 4 m)
      const offAt = (j) => {
        const [pc, pr] = toPixel(e.x[j], e.y[j]);
        const cc = Math.max(0, Math.min(width - 1, Math.round(pc))); const rr = Math.max(0, Math.min(height - 1, Math.round(pr)));
        return Math.abs(zk[j] - dropAt(j) - (abutmentOff(kind, k, j)) - (raw(cc, rr) - minHeight));
      };
      const off = Math.max(offAt(i), offAt(i + 1)) + 1;
      const reach = deck ? e.half + DECK_REACH_M : core + Math.min(SLOPE_MAX_M, Math.max(blendM, off * FILL_RUN + 2));
      const [c0, r0] = toPixel(Math.min(ax, bx) - reach, Math.max(ay, by) + reach);
      const [c1, r1] = toPixel(Math.max(ax, bx) + reach, Math.min(ay, by) - reach);
      stats.corridors++;
      const cBox0 = Math.max(0, Math.floor(c0)); const cBox1 = Math.min(width - 1, Math.ceil(c1));
      for (let r = Math.max(0, Math.floor(r0)); r <= Math.min(height - 1, Math.ceil(r1)); r++) {
        const y = yOfRow(r);
        let cFrom = cBox0; let cTo = cBox1;
        // (only the row's crossing of the corridor, a pixel either side; a
        // piece at a portal keeps its whole box, whose pixels past the
        // portal are all marked left)
        if (!planes.length) {
          const span = capsuleSpan(ax, ay, bx, by, reach, y);
          if (!span) continue;
          cFrom = Math.max(cBox0, Math.floor(span[0] / squareM + width / 2) - 1);
          cTo = Math.min(cBox1, Math.ceil(span[1] / squareM + width / 2) + 1);
        }
        let tileKey = -1; let t = null;
        for (let c = cFrom; c <= cTo; c++) {
          const x = xOfCol(c);
          const uRaw = ((x - ax) * vx + (y - ay) * vy) / L2;
          if (planes.length && planes.some(([px, py, dx, dy]) => (x - px) * dx + (y - py) * dy > 0 && Math.hypot(x - px, y - py) < PORTAL_PLANE_M)) { left.add(r * width + c); continue; }
          if (squares.length && squares.some((q) => (x - q.px) * q.dx + (y - q.py) * q.dy < 0)) continue;
          const u = Math.max(0, Math.min(1, uRaw));
          const d = Math.hypot(ax + vx * u - x, ay + vy * u - y);
          if (d > reach) continue;
          let zc = zk[i] + (zk[i + 1] - zk[i]) * u - (abutment ? DECK_UNDER_M + DECK_ABUT_CLEAR_M : 0) - (dropAt(i) + (dropAt(i + 1) - dropAt(i)) * u);
          // (banked: the left of the line higher by bank per metre, out to the core's edge)
          if (bank) zc += bank * Math.max(-core, Math.min(core, (-(x - ax) * vy + (y - ay) * vx) / Math.sqrt(L2)));
          const key = Math.floor(c / TILE) * 65536 + Math.floor(r / TILE);
          if (key !== tileKey) { tileKey = key; t = tileFor(c, r); }
          const j = (r % TILE) * TILE + (c % TILE);
          if (deck) {
            // under the deck only, not round its ends
            if (uRaw < 0 || uRaw > 1) continue;
            const cap = zc - DECK_UNDER_M - DECK_CLEAR_M;
            if (cap < t.cap[j]) t.cap[j] = cap;
            continue;
          }
          const h0 = raw(c, r) - minHeight;
          let slope = blendM;
          // How far the side slope runs is set by how far the road stands off
          // the ground at its own edge on this side, not off the ground at
          // the pixel: on a hillside that grows with every metre out, so a
          // road lying exactly on its bench still pulled the slope above it
          // down (and the one below it up) by a quarter to a half of its
          // height as far as the corridor reached, a band of cut and fill
          // along every mountain road and a wall of ground between the arms
          // of a hairpin.
          let hEdge = h0;
          if (d > core) {
            const f = core / d; const qx = ax + vx * u; const qy = ay + vy * u;
            const [pc, pr] = toPixel(qx + (x - qx) * f, qy + (y - qy) * f);
            hEdge = raw(Math.max(0, Math.min(width - 1, Math.round(pc))), Math.max(0, Math.min(height - 1, Math.round(pr)))) - minHeight;
          }
          const off2 = Math.abs(zc - hEdge);
          if (kind === 'embankment' || kind === 'cutting' || off2 > 0.5) {
            slope = Math.min(SLOPE_MAX_M, Math.max(slopeMinM, off2 * (zc > hEdge ? FILL_RUN : CUT_RUN)));
          }
          const tt = d <= core ? 0 : (d - core) / slope;
          if (tt >= 1) continue;
          // ground over a built tube is the tunnel's: only a road's own
          // surface on it (a street over the box) is composed, not a road's
          // rounded end or side slope reaching over it (a cutting's end, its
          // road meeting the tube by a short link: dug into the portal)
          if (tube && (d > core || uRaw < 0 || uRaw > 1) && tube(r * width + c)) { left.add(r * width + c); continue; }
          // ground another builder shaped (a tunnel's cutting): its own
          // except under the road's surface
          if (keep && d > core && keep(r * width + c)) { left.add(r * width + c); continue; }
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
          // (a side road's piece under its through road's lanes: over every side slope, under every other core)
          const out = abutment ? Math.max(1e-3, d - core) : (d <= core ? (yielding ? -400 : -1000) + d : d - core);
          // two road cores overlapping at clearly different heights: the lower
          // road keeps its whole drawn width (the upper stands behind a wall)
          // (only in the upper road's outer margin: its centre stays its own)
          const q = d / core;   // how far out in this road's core (0 centre, 1 edge)
          const bothCores = out < -500 && t.w[j] < -500;
          const twoLevels = bothCores && Math.abs(target - t.h[j]) > CORE_STEP_M;
          if (twoLevels) {
            const lowerIsNew = target < t.h[j];
            const upperQ = lowerIsNew ? t.q[j] : q;
            const take = upperQ > CORE_OUTER ? lowerIsNew : out < t.w[j] - 1e-3;
            if (take) { t.w[j] = out; t.h[j] = target; t.q[j] = q; t.n[j] = 1; }
          } else if (out < t.w[j] - 1e-3) { t.w[j] = out; t.h[j] = target; t.q[j] = q; t.n[j] = 1; }
          else if (!twoLevels && Math.abs(out - t.w[j]) <= 1e-3) { t.h[j] = (t.h[j] * t.n[j] + target) / (t.n[j] + 1); t.n[j] = Math.min(255, t.n[j] + 1); }
        }
      }
    }
  });

  // the edited value of a pixel in world z, or NaN if untouched (a despiked
  // pixel's value from `spiked`)
  const spiked = new Map();
  // (the last tile looked up kept: neighbouring pixels nearly always share one)
  let lastKey = -1; let lastTile;
  const edited = (c, r) => {
    if (spiked.size) {
      const sv = spiked.get(r * width + c);
      if (sv !== undefined) return sv;
    }
    const key = Math.floor(c / TILE) * 65536 + Math.floor(r / TILE);
    if (key !== lastKey) { lastKey = key; lastTile = tiles.get(key); }
    const t = lastTile;
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
  // a tile's edited values (NaN: untouched) and values (edited, else the
  // grid's), a pixel round it included, gathered once per pass: every pixel
  // looked itself and its eight neighbours up one by one before
  const SPAN = TILE + 2;
  const tileEdited = new Float64Array(SPAN * SPAN);
  const tileValue = new Float64Array(SPAN * SPAN);
  const gather = (tc, tr) => {
    for (let rr = -1; rr <= TILE; rr++) {
      for (let cc = -1; cc <= TILE; cc++) {
        const c = tc * TILE + cc; const r = tr * TILE + rr; const at = (rr + 1) * SPAN + cc + 1;
        if (c < 0 || r < 0 || c >= width || r >= height) { tileEdited[at] = NaN; tileValue[at] = NaN; continue; }
        const e = edited(c, r);
        tileEdited[at] = e;
        tileValue[at] = Number.isFinite(e) ? e : raw(c, r) - minHeight;
      }
    }
  };
  for (let pass = 0; pass < 2; pass++) {
    const fix = [];
    for (const key of tiles.keys()) {
      const tc = Math.floor(key / 65536); const tr = key - tc * 65536;
      gather(tc, tr);
      for (let j = 0; j < TILE * TILE; j++) {
        const c = tc * TILE + (j % TILE); const r = tr * TILE + Math.floor(j / TILE);
        if (c < 1 || r < 1 || c + 1 >= width || r + 1 >= height) continue;
        const at = (Math.floor(j / TILE) + 1) * SPAN + (j % TILE) + 1;
        let h = tileEdited[at];
        if (!Number.isFinite(h)) {
          if (!left.has(r * width + c)) continue;
          h = raw(c, r) - minHeight;
        }
        let n = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) win[n++] = tileValue[at + dr * SPAN + dc];
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
    gather(tc, tr);
    for (let j = 0; j < TILE * TILE; j++) {
      const c = tc * TILE + (j % TILE); const r = tr * TILE + Math.floor(j / TILE);
      if (c + 1 >= width || r + 1 >= height) continue;
      const at = (Math.floor(j / TILE) + 1) * SPAN + (j % TILE) + 1;
      const h = tileEdited[at];
      if (!Number.isFinite(h)) continue;
      const hx = tileEdited[at + 1]; const hy = tileEdited[at + SPAN];
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
