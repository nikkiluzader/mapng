// Water never stands above its banks.
//
// The global 30 m elevation (AWS Terrarium) mixes sources; along wooded rivers
// and creeks it often takes radar heights that measure the tree tops, so a
// creek lined with forest comes out as a ridge several metres above the open
// ground beside it (a Florida creek: channel 8-12 m, pasture 0-2 m). The
// export then floats its water on top of that ridge.
//
// For river-like water (rivers, streams, canals, drains, riverbank outlines;
// not lakes or ponds, whose level can stand above ground downstream of a dam)
// this finds the bank level, the low end of the ground 20-80 m from the
// water, and lowers the water, and the strip within 20 m of it, wherever they
// stand clearly above it. Water already below its banks (a canyon, any real
// valley) is left exactly as it is. Only for coarse terrain: lidar and GPXZ
// measure the ground.
//
// Worked on a grid of ~4 m cells (the 30 m source holds nothing finer), so a
// 16k map needs no extra full-size buffers; the full grid takes the lowering
// bilinearly.
import { createGridProjector } from './geoUtils.js';

const RIVER_WATERWAYS = new Set(['river', 'stream', 'canal', 'drain', 'ditch', 'riverbank', 'tidal_channel']);
const RIVER_WATER = new Set(['river', 'stream', 'canal', 'oxbow', 'stream_pool', 'ditch', 'drain', 'tidal_channel']);
const LINE_HALF_WIDTH_M = { river: 6, canal: 4, stream: 2.5, tidal_channel: 3, drain: 1.5, ditch: 1.5 };

const CELL_M = 4;               // working cell size
const NEAR_FULL_M = 20;         // the strip beside the water brought fully down (canopy on the banks)...
const NEAR_M = 45;              // ...fading out by this distance
const BANK_MIN_M = 30;          // the banks: ground this far from the water...
const BANK_MAX_M = 100;         // ...up to this far
const BANK_PERCENTILE = 0.2;    // the low end of the bank ground (fields, not the next copse)
const TILE_M = 48;              // the bank level is measured per tile...
const TILE_REACH_M = 140;       // ...from the ground this far around it
const RAISED_M = 1.5;           // water this far above its banks is wrong (noise below it is not)

export const isRiverWater = (f) => {
  const t = f?.tags || {};
  if (f?.type !== 'water') return false;
  if (RIVER_WATERWAYS.has(t.waterway)) return true;
  return t.natural === 'water' && RIVER_WATER.has(t.water);
};

const isClosed = (g) => g.length > 3 && Math.abs(g[0].lat - g[g.length - 1].lat) < 1e-9 && Math.abs(g[0].lng - g[g.length - 1].lng) < 1e-9;

/** Paint river water into mask (cw × ch, 1 = water) at the working grid. */
function paintWater(mask, cw, ch, features, project, cellPx, mpp) {
  for (const f of features) {
    if (!isRiverWater(f)) continue;
    const pts = (f.geometry || []).filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .map((p) => { const q = project(p.lat, p.lng); return [q.x / cellPx, q.y / cellPx]; });
    if (pts.length < 2) continue;
    const t = f.tags || {};
    const area = isClosed(f.geometry) && (t.natural === 'water' || t.waterway === 'riverbank' || t.area === 'yes');
    if (area) {
      // scanline fill
      let minY = Infinity; let maxY = -Infinity;
      for (const [, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(ch - 1, Math.ceil(maxY)); y++) {
        const yc = y + 0.5; const xs = [];
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, yi] = pts[i]; const [xj, yj] = pts[j];
          if ((yi > yc) !== (yj > yc)) xs.push(xi + ((yc - yi) / (yj - yi)) * (xj - xi));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(cw - 1, Math.floor(xs[k + 1] - 0.5)); x++) mask[y * cw + x] = 1;
        }
      }
    } else {
      const widthTag = parseFloat(t.width);
      const halfM = Number.isFinite(widthTag) && widthTag > 0 ? widthTag / 2 : (LINE_HALF_WIDTH_M[t.waterway] ?? 2);
      const r = Math.max(0.5, halfM / (CELL_M));
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1]; const [bx, by] = pts[i];
        const len = Math.hypot(bx - ax, by - ay); const steps = Math.max(1, Math.ceil(len * 2));
        for (let s = 0; s <= steps; s++) {
          const cx = ax + ((bx - ax) * s) / steps; const cy = ay + ((by - ay) * s) / steps;
          for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
            if (y < 0 || y >= ch) continue;
            for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
              if (x < 0 || x >= cw) continue;
              if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) mask[y * cw + x] = 1;
            }
          }
        }
      }
    }
  }
  void mpp;
}

/** Distance (m) from each cell to the nearest water cell (two-pass chamfer). */
function distanceFromWater(mask, cw, ch) {
  const d = new Float32Array(cw * ch);
  const INF = 1e9;
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : INF;
  const a = CELL_M; const b = CELL_M * Math.SQRT2;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const i = y * cw + x; let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + a);
    if (y > 0) { v = Math.min(v, d[i - cw] + a); if (x > 0) v = Math.min(v, d[i - cw - 1] + b); if (x < cw - 1) v = Math.min(v, d[i - cw + 1] + b); }
    d[i] = v;
  }
  for (let y = ch - 1; y >= 0; y--) for (let x = cw - 1; x >= 0; x--) {
    const i = y * cw + x; let v = d[i];
    if (x < cw - 1) v = Math.min(v, d[i + 1] + a);
    if (y < ch - 1) { v = Math.min(v, d[i + cw] + a); if (x < cw - 1) v = Math.min(v, d[i + cw + 1] + b); if (x > 0) v = Math.min(v, d[i + cw - 1] + b); }
    d[i] = v;
  }
  return d;
}

/**
 * Lower river water (and the strip beside it) standing above its banks, in
 * place. Returns { cells, maxDrop } (full-grid cells lowered, deepest cut m).
 */
export function lowerRaisedWater(heightMap, width, height, bounds, features, metersPerPixel) {
  const mpp = Number(metersPerPixel) > 0 ? Number(metersPerPixel) : 1;
  if (!features?.some(isRiverWater)) return { cells: 0, maxDrop: 0 };
  const f = Math.max(1, Math.round(CELL_M / mpp));           // full cells per working cell
  const cw = Math.ceil(width / f); const ch = Math.ceil(height / f);
  // working heights: block means
  const hC = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    let sum = 0; let n = 0;
    for (let yy = y * f; yy < Math.min(height, (y + 1) * f); yy++) for (let xx = x * f; xx < Math.min(width, (x + 1) * f); xx++) {
      const v = heightMap[yy * width + xx]; if (Number.isFinite(v)) { sum += v; n++; }
    }
    hC[y * cw + x] = n ? sum / n : NaN;
  }
  const mask = new Uint8Array(cw * ch);
  paintWater(mask, cw, ch, features, createGridProjector(bounds, width, height), f, mpp);
  const dist = distanceFromWater(mask, cw, ch);

  // bank level per tile: the low end of the ground 20-80 m from the water around it
  const tileC = Math.max(1, Math.round(TILE_M / CELL_M)); const reachC = Math.round(TILE_REACH_M / CELL_M);
  const tw = Math.ceil(cw / tileC); const th = Math.ceil(ch / tileC);
  const bank = new Float32Array(tw * th).fill(NaN);
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    const x0 = tx * tileC; const y0 = ty * tileC;
    let near = false;
    for (let y = y0; y < Math.min(ch, y0 + tileC) && !near; y++) for (let x = x0; x < Math.min(cw, x0 + tileC); x++) if (dist[y * cw + x] < NEAR_M) { near = true; break; }
    if (!near) continue;
    const vals = [];
    for (let y = Math.max(0, y0 - reachC); y < Math.min(ch, y0 + tileC + reachC); y++) for (let x = Math.max(0, x0 - reachC); x < Math.min(cw, x0 + tileC + reachC); x++) {
      const i = y * cw + x; const d = dist[i];
      if (d >= BANK_MIN_M && d <= BANK_MAX_M && Number.isFinite(hC[i])) vals.push(hC[i]);
    }
    if (vals.length < 12) continue;
    vals.sort((a, b) => a - b);
    bank[ty * tw + tx] = vals[Math.floor(vals.length * BANK_PERCENTILE)];
  }
  const bankAt = (x, y) => {
    // bilinear over tile centres, skipping tiles without a level
    const fx = x / tileC - 0.5; const fy = y / tileC - 0.5;
    const x0 = Math.floor(fx); const y0 = Math.floor(fy);
    let sum = 0; let wsum = 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const tx = Math.min(tw - 1, Math.max(0, x0 + dx)); const ty = Math.min(th - 1, Math.max(0, y0 + dy));
      const v = bank[ty * tw + tx]; if (!Number.isFinite(v)) continue;
      const w = (dx ? fx - x0 : 1 - (fx - x0)) * (dy ? fy - y0 : 1 - (fy - y0)) + 1e-6;
      sum += v * w; wsum += w;
    }
    return wsum ? sum / wsum : NaN;
  };

  // per working cell: the bank level and how fully to bring a cell down to it
  // (1 on and near the water, fading out across the strip beside it)
  const levelC = new Float32Array(cw * ch).fill(NaN);
  const weightC = new Float32Array(cw * ch);
  let any = false;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const i = y * cw + x; const d = dist[i];
    if (d >= NEAR_M) continue;
    const level = bankAt(x + 0.5, y + 0.5);
    if (!Number.isFinite(level)) continue;
    levelC[i] = level;
    weightC[i] = d <= NEAR_FULL_M ? 1 : 1 - (d - NEAR_FULL_M) / (NEAR_M - NEAR_FULL_M);
    if (Number.isFinite(hC[i]) && hC[i] - level > RAISED_M) any = true;
  }
  if (!any) return { cells: 0, maxDrop: 0 };

  // each full cell against its own height: what stands more than RAISED_M
  // over the bank comes down to it (never below it), by the weight
  let cells = 0; let maxDrop = 0;
  for (let yy = 0; yy < height; yy++) {
    const fy = (yy + 0.5) / f - 0.5; const y0 = Math.max(0, Math.floor(fy)); const y1 = Math.min(ch - 1, y0 + 1); const ty = Math.min(1, Math.max(0, fy - y0));
    for (let xx = 0; xx < width; xx++) {
      const fx = (xx + 0.5) / f - 0.5; const x0 = Math.max(0, Math.floor(fx)); const x1 = Math.min(cw - 1, x0 + 1); const tx = Math.min(1, Math.max(0, fx - x0));
      const corners = [[y0 * cw + x0, (1 - tx) * (1 - ty)], [y0 * cw + x1, tx * (1 - ty)], [y1 * cw + x0, (1 - tx) * ty], [y1 * cw + x1, tx * ty]];
      let lsum = 0; let lw = 0; let weight = 0;
      for (const [i, w] of corners) {
        weight += weightC[i] * w;
        if (Number.isFinite(levelC[i])) { lsum += levelC[i] * w; lw += w; }
      }
      if (!lw || weight <= 0) continue;
      const level = lsum / lw;
      const k = yy * width + xx;
      const excess = heightMap[k] - level;
      if (!(excess > RAISED_M)) continue;
      const v = excess * weight;
      heightMap[k] -= v;
      cells++;
      if (v > maxDrop) maxDrop = v;
    }
  }
  return { cells, maxDrop };
}
