// A paved-area tile on a worker thread (services/pavedSidewalks.js): the grid and its outlines, plain data in and
// out (no heights: meshing and grading, which read the terrain, stay on the export's thread and are cheap).
import { makeGrid, buildPavedGrid, traceOutlines, markPolygon, markLine, WALK, GAP, ROAD } from './pavedArea.js';

const GAP_MIN_W_M = 1;         // filled gaps narrower than this are left as ground

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
  // (no paving over mapped water: a walk on a bridge or a pier over it is a deck, built as one, and paved as ground it
  // floated metres over the river with the grading spiking against it)
  if (item.water?.length) {
    const inW = new Uint8Array(cells.length);
    for (const ring of item.water) markPolygon(inW, g, ring, 1);
    for (let i = 0; i < cells.length; i++) if (inW[i]) cells[i] &= ~(WALK | GAP);
  }
  // (nor over an at-grade track bed: a footway over a level crossing and a street's sidewalk at one were paved as
  // raised slabs with curbs across the rails, a car crashed into one (SPLATPLAYS, Perth, 2026-11-24). The paving
  // stops at the bed's edge; the ground between runs flush)
  if (item.railBeds?.length) {
    const inB = new Uint8Array(cells.length);
    for (const ring of item.railBeds) markPolygon(inB, g, ring, 1);
    // (except where a path crosses the line at grade: its paving goes on over the bed, flush, up to the rails; each
    // rail strip stays clear (railTrack.js pathCrossingPads; Splatplays' Sherwood, 2026-11-25))
    const keep = new Uint8Array(cells.length);
    if (item.pads?.length) {
      const strip = new Uint8Array(cells.length);
      for (const pd of item.pads) markPolygon(keep, g, pd.pad, 1);
      for (const pd of item.pads) for (const st of pd.strips) markLine(strip, g, st.pts, st.half, 1);
      for (let i = 0; i < cells.length; i++) if (strip[i]) keep[i] = 0;
    }
    for (let i = 0; i < cells.length; i++) if (inB[i] && !keep[i]) cells[i] &= ~(WALK | GAP);
  }
  // (nor across a river's channel: its bed is dug after the sidewalks, and paving over it floated over the dug bed)
  if (item.rivers?.length) {
    const inR = new Uint8Array(cells.length);
    for (const rc of item.rivers) markLine(inR, g, rc.pts, rc.half, 1);
    for (let i = 0; i < cells.length; i++) if (inR[i]) cells[i] &= ~(WALK | GAP);
  }
  // (nor over the sea the water step lowers: the coast's water is no mapped area, the terrain under it a pixel mask)
  if (item.sea) {
    // (the mask smoothed and blended between its pixels, cleared where it is more than half sea: read pixel by pixel, the paving
    // stopped in 1 m steps along the shore, a sawtooth of teeth on a bayfront promenade with their sides showing as
    // dark triangles (St. Augustine's seawall, the user 2026-11-26))
    const { mask, c0, r0, w, h, W, H, ws } = item.sea;
    // (smoothed over 3 x 3 pixels first: blended alone, a diagonal shore's steps only lost their corners)
    const sm = new Float32Array(w * h);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) { let s = 0; let n = 0; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr; const cc = c + dc; if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue; s += mask[rr * w + cc] ? 1 : 0; n++; } sm[r * w + c] = s / n; }
    const px = (tc, tr) => (tc >= 0 && tc < w && tr >= 0 && tr < h ? sm[tr * w + tc] : 0);
    for (let r = 0; r < g.h; r++) {
      const y = g.y1 - (r + 0.5) * g.res; const v = (0.5 - y / ws) * H - 1 - r0; const tr = Math.floor(v); const fy = v - tr;
      if (tr < -1 || tr >= h) continue;
      for (let c = 0; c < g.w; c++) {
        const i = r * g.w + c; if (!(cells[i] & (WALK | GAP))) continue;
        const x = g.x0 + (c + 0.5) * g.res; const u = (x / ws + 0.5) * W - c0; const tc = Math.floor(u); const fx = u - tc;
        const s = (px(tc, tr) * (1 - fx) + px(tc + 1, tr) * fx) * (1 - fy) + (px(tc, tr + 1) * (1 - fx) + px(tc + 1, tr + 1) * fx) * fy;
        if (s > 0.5) cells[i] &= ~(WALK | GAP);
      }
    }
  }
  // (nor down a bank: the blocks the main thread found (services/pavedSidewalks.js), the closed strip in them
  // cleared before the outlines are traced; walks stay)
  if (item.bank) {
    const { mask, block, bw } = item.bank;
    for (let r = 0; r < g.h; r++) {
      const row = ((r / block) | 0) * bw;
      for (let c = 0; c < g.w; c++) { if (!mask[row + ((c / block) | 0)]) continue; const i = r * g.w + c; if (!(cells[i] & WALK)) cells[i] &= ~GAP; }
    }
  }
  // (no filled gap thinner than GAP_MIN_W_M: slivers a cell or two wide ran from the sidewalk to a building's front, odd
  // thin strips of paving in the lawn (St. Augustine, Orange Street). An opening: what survives shrinking by half that
  // width, grown back; mapped walks are never touched)
  {
    const r = Math.max(1, Math.round(GAP_MIN_W_M / 2 / g.res));
    const gapOnly = (i) => (cells[i] & GAP) && !(cells[i] & WALK);
    const step = (mask, grow) => {
      const out = new Uint8Array(mask);
      for (let row = 0; row < g.h; row++) {
        for (let c = 0; c < g.w; c++) {
          const i = row * g.w + c;
          if (grow ? mask[i] : !mask[i]) continue;
          // (shrink: off if any 4-neighbour is off; grow: on if any 4-neighbour is on)
          const n = [c > 0 ? mask[i - 1] : 0, c < g.w - 1 ? mask[i + 1] : 0, row > 0 ? mask[i - g.w] : 0, row < g.h - 1 ? mask[i + g.w] : 0];
          if (grow ? n.some((v) => v) : n.some((v) => !v)) out[i] = grow ? 1 : 0;
        }
      }
      return out;
    };
    let m = new Uint8Array(cells.length);
    for (let i = 0; i < cells.length; i++) m[i] = gapOnly(i) || (cells[i] & WALK) ? 1 : 0;
    const walk = new Uint8Array(cells.length); for (let i = 0; i < cells.length; i++) walk[i] = cells[i] & WALK ? 1 : 0;
    let e = m; for (let k = 0; k < r; k++) e = step(e, false);
    // (grown back from what survived and from the walks themselves, so gap paving joined to a walk keeps its full width)
    for (let i = 0; i < e.length; i++) if (walk[i]) e[i] = 1;
    let d = e; for (let k = 0; k < r; k++) d = step(d, true);
    for (let i = 0; i < cells.length; i++) if (gapOnly(i) && !d[i]) cells[i] &= ~GAP;
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
