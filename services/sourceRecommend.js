// "Which source here?": one line under the elevation comparison's pictures.
//
// Light on purpose: it reads only the heights the comparison has already
// loaded (a square of a few hundred metres at the map's centre) and says which
// of them to use. The finest source wins, unless the free lidar fails one
// plain check against the 30 m data.
//
// The check: lidar that lies level where the 30 m data shows a steady slope,
// and sits metres away from it. A real case: the free lidar over central
// Arnhem is a level shelf at the river's height, 500 m wide and up to 15 m
// under the streets, ending in a cliff (levels built on it had streets at
// 80 %). Trees and buildings also put the 30 m data above lidar, but as an
// offset, not as a slope across hundreds of metres: both are compared only
// after smoothing over about 90 m, and only their slopes decide.

const SMOOTH_M = 90;          // both sources are smoothed over this before their slopes are compared
const LEVEL_SLOPE = 0.007;    // lidar counts as level under 0.7 %
const SLOPING = 0.025;        // the 30 m data counts as sloping over 2.5 %
const APART_M = 4;            // ...and the two must be this far apart there
const SUSPECT_SHARE = 0.2;    // that much of the square, and the lidar is not recommended

// box blur, three passes (close to a Gaussian), on a coarse grid
function smooth(h, n, radius) {
  let a = Float64Array.from(h); let b = new Float64Array(n * n);
  for (let pass = 0; pass < 3; pass++) {
    for (const horizontal of [true, false]) {
      for (let i = 0; i < n; i++) {
        let sum = 0; let count = 0;
        const at = (k) => (horizontal ? a[i * n + k] : a[k * n + i]);
        for (let k = 0; k <= Math.min(radius, n - 1); k++) { sum += at(k); count++; }
        for (let k = 0; k < n; k++) {
          if (horizontal) b[i * n + k] = sum / count; else b[k * n + i] = sum / count;
          const add = k + radius + 1; const drop = k - radius;
          if (add < n) { sum += at(add); count++; }
          if (drop >= 0) { sum -= at(drop); count--; }
        }
      }
      [a, b] = [b, a];
    }
  }
  return a;
}

/**
 * How much of the square the lidar lies level on while the 30 m data slopes and sits apart from it.
 * lidar, coarse: Float32Array px*px of heights on the same square; cellM: metres per cell.
 * Returns { share: 0..1, apartM: the median distance between them there (0 when none) }.
 */
export function levelWhereItSlopes(lidar, coarse, px, cellM) {
  // (on a grid of about 8 m cells: slopes over 90 m need no more)
  const step = Math.max(1, Math.round(8 / cellM)); const n = Math.floor(px / step); const cell = cellM * step;
  if (n < 16) return { share: 0, apartM: 0 };
  const pick = (h) => { const o = new Float64Array(n * n); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) o[y * n + x] = h[(y * step) * px + x * step]; return o; };
  const radius = Math.max(1, Math.round(SMOOTH_M / 2 / cell));
  const L = smooth(pick(lidar), n, radius); const C = smooth(pick(coarse), n, radius);
  const slopeAt = (h, x, y) => Math.hypot(h[y * n + x + 1] - h[y * n + x - 1], h[(y + 1) * n + x] - h[(y - 1) * n + x]) / (2 * cell);
  let cells = 0; const apart = [];
  for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
    const l = L[y * n + x]; const c = C[y * n + x];
    if (!Number.isFinite(l) || !Number.isFinite(c)) continue;
    cells++;
    if (slopeAt(L, x, y) < LEVEL_SLOPE && slopeAt(C, x, y) > SLOPING && Math.abs(l - c) > APART_M) apart.push(Math.abs(l - c));
  }
  apart.sort((p, q) => p - q);
  return { share: cells ? apart.length / cells : 0, apartM: apart.length ? apart[Math.floor(apart.length / 2)] : 0 };
}

/**
 * Which loaded source to use.
 * sources: { standard?: { h }, mapterhorn?: { h, res }, gpxz?: { h, res } } (h: Float32Array px*px), px, cellM.
 * Returns { pick: 'standard' | 'mapterhorn' | 'gpxz', why: 'finest' | 'noLidar' | 'lidarLevel', share?, apartM? },
 * or null when nothing is loaded.
 */
export function recommendSource(sources, px, cellM) {
  const { standard, mapterhorn, gpxz } = sources || {};
  if (!standard?.h && !mapterhorn?.h && !gpxz?.h) return null;
  if (mapterhorn?.h && standard?.h) {
    const { share, apartM } = levelWhereItSlopes(mapterhorn.h, standard.h, px, cellM);
    if (share >= SUSPECT_SHARE) return { pick: gpxz?.h ? 'gpxz' : 'standard', why: 'lidarLevel', share, apartM };
  }
  if (gpxz?.h && (!mapterhorn?.h || (gpxz.res || 1) < (mapterhorn.res || 30))) return { pick: 'gpxz', why: 'finest' };
  if (mapterhorn?.h) return { pick: 'mapterhorn', why: 'finest' };
  if (gpxz?.h) return { pick: 'gpxz', why: 'finest' };
  return { pick: 'standard', why: 'noLidar' };
}
