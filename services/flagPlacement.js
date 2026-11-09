// Where the MapNG flag stands: the map's summit. Not simply its highest
// height sample: a one- or two-pixel spike in the elevation data (a mast, a
// lidar return off a bird or a wire, a tile seam) won the old pick and the
// flag stood in mid-air over the real ground; and where the land rises off
// the map, the highest sample is on its edge, the flag hanging over nothing.
//
// Every sample scores the lowest height in its 3x3 neighbourhood (a spike up
// to two samples wide scores its surroundings). The flag goes on the highest
// hilltop inside the map: a score with nothing higher within PEAK_RADIUS of
// the map's width, away from the edges (EDGE_MARGIN each side). Only a map
// with no hilltop at all (land rising off it the whole way) takes the
// highest score inside the margins. Shared by the export and the preview.

export const FLAG_EDGE_MARGIN = 0.08;
export const FLAG_PEAK_RADIUS = 0.04;

const ok = (h) => Number.isFinite(h) && h > -10000;

/** The flag's heightmap cell: { col, row, height, peak } (rows from the north), or null. */
export function pickFlagCell({ heightMap, width, height }, { margin = FLAG_EDGE_MARGIN, peakRadius = FLAG_PEAK_RADIUS } = {}) {
  if (!heightMap?.length || !(width > 2) || !(height > 2)) return null;
  // scores on a coarse grid (step g: at most ~512 a side), each the lowest
  // full-resolution height in a 3x3 round its sample
  const g = Math.max(1, Math.floor(Math.max(width, height) / 512));
  const gw = Math.floor((width - 1) / g) + 1; const gh = Math.floor((height - 1) / g) + 1;
  const sc = new Float64Array(gw * gh).fill(-Infinity);
  const erode = (c, r) => {
    let lo = Infinity;
    for (let dr = -1; dr <= 1; dr++) {
      const rr = Math.max(0, Math.min(height - 1, r + dr));
      for (let dc = -1; dc <= 1; dc++) {
        const h = heightMap[rr * width + Math.max(0, Math.min(width - 1, c + dc))];
        if (!ok(h)) return -Infinity;
        if (h < lo) lo = h;
      }
    }
    return lo;
  };
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) sc[j * gw + i] = erode(Math.min(width - 1, i * g), Math.min(height - 1, j * g));
  const mi = Math.max(1, Math.round(gw * margin)); const mj = Math.max(1, Math.round(gh * margin));
  const rad = Math.max(1, Math.round(Math.max(gw, gh) * peakRadius));
  // the highest hilltop inside the margins
  let best = null;
  for (let j = mj; j < gh - mj; j++) {
    for (let i = mi; i < gw - mi; i++) {
      const s = sc[j * gw + i];
      if (s === -Infinity || (best && s <= best.s)) continue;
      let top = true;
      for (let dj = -rad; dj <= rad && top; dj++) {
        const jj = j + dj; if (jj < 0 || jj >= gh) continue;
        for (let di = -rad; di <= rad; di++) {
          const ii = i + di; if (ii < 0 || ii >= gw || (di === 0 && dj === 0)) continue;
          if (sc[jj * gw + ii] > s) { top = false; break; }
        }
      }
      if (top) best = { i, j, s, peak: true };
    }
  }
  // no hilltop: the highest score inside the margins
  if (!best) {
    for (let j = mj; j < gh - mj; j++) for (let i = mi; i < gw - mi; i++) {
      const s = sc[j * gw + i];
      if (s > -Infinity && (!best || s > best.s)) best = { i, j, s, peak: false };
    }
  }
  if (!best) return null;
  // refined at full resolution round the coarse winner
  const c0 = Math.min(width - 1, best.i * g); const r0 = Math.min(height - 1, best.j * g);
  let out = null;
  for (let r = Math.max(1, r0 - g); r <= Math.min(height - 2, r0 + g); r++) {
    for (let c = Math.max(1, c0 - g); c <= Math.min(width - 2, c0 + g); c++) {
      const s = erode(c, r);
      if (s === -Infinity) continue;
      const h = heightMap[r * width + c];
      if (!out || s > out.s || (s === out.s && h > out.height)) out = { col: c, row: r, height: h, s };
    }
  }
  return out ? { col: out.col, row: out.row, height: out.height, peak: best.peak } : null;
}
