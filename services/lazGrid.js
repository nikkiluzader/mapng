// Gridding steps for point cloud uploads (services/lazWorker.js), kept apart so tests can run them.

// ─── Cells finer than the points ─────────────────────────────────────────────
// At a processing resolution near the point spacing (0.25 m cells on a 25 cm cloud) a cell holds about one ground
// point: each shows that point's own noise, in a checkerboard with the empty cells between the laser's scan lines.
// There every cell takes its neighbours' points too, weighted 1-2-1 each way (about two point spacings across, the
// file's real detail), on the sums and counts: a cell's height stays a mean of measured points, and the gaps
// between scan lines get measured heights, not filled ones. Integer weights: the counts stay whole.
export const POOL_BELOW_SPACING = 1.5;
export const poolFineCells = (sum, cnt, width, height) => {
  const rs = new Float64Array(width); const rc = new Uint32Array(width);
  for (let y = 0; y < height; y++) {
    const o = y * width;
    for (let x = 0; x < width; x++) { rs[x] = sum[o + x]; rc[x] = cnt[o + x]; }
    for (let x = 0; x < width; x++) {
      let s = 2 * rs[x]; let c = 2 * rc[x];
      if (x > 0) { s += rs[x - 1]; c += rc[x - 1]; }
      if (x < width - 1) { s += rs[x + 1]; c += rc[x + 1]; }
      sum[o + x] = s; cnt[o + x] = c;
    }
  }
  const cs = new Float64Array(height); const cc = new Uint32Array(height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) { cs[y] = sum[y * width + x]; cc[y] = cnt[y * width + x]; }
    for (let y = 0; y < height; y++) {
      let s = 2 * cs[y]; let c = 2 * cc[y];
      if (y > 0) { s += cs[y - 1]; c += cc[y - 1]; }
      if (y < height - 1) { s += cs[y + 1]; c += cc[y + 1]; }
      sum[y * width + x] = s; cnt[y * width + x] = c;
    }
  }
};

// ─── Smoothing the filled cells ──────────────────────────────────────────────
// The pyramid's values meet the measured cells round a hole with seams and leave its coarse blocks in it: rough,
// blotchy ground under buildings, cars and trees (a third of a city tile's cells at 1 m, more at 0.25 m, where the
// laser's scan lines leave gaps between them). Successive over-relaxation toward the mean of the four neighbours,
// on the filled cells only: the measured heights stay exactly as measured, the holes become a smooth membrane
// between them (the pyramid's fill is the start, so few passes reach a big hole's middle).
const RELAX_PASSES = 48;
const RELAX_OMEGA = 1.8;
export const relaxFilled = (h, width, height, holes) => {
  for (let pass = 0; pass < RELAX_PASSES; pass++) {
    for (let k = 0; k < holes.length; k++) {
      const i = holes[k]; const y = (i / width) | 0; const x = i - y * width;
      let s = 0; let c = 0;
      if (x > 0) { s += h[i - 1]; c++; }
      if (x < width - 1) { s += h[i + 1]; c++; }
      if (y > 0) { s += h[i - width]; c++; }
      if (y < height - 1) { s += h[i + width]; c++; }
      h[i] += RELAX_OMEGA * (s / c - h[i]);
    }
  }
};


// ─── Relaxing each pyramid level on the way down ────────────────────────────
// The hole filler's pyramid averages whatever cells hold points, which on a slope sampled in patches is a biased
// guess, and the relaxation on the full grid (relaxFilled) runs a few dozen passes: across a gap of tens of cells
// (a few metres of forest floor at 10 cm) it never reaches the middle. A lone point the fill keeps exactly then stood
// metres off the coarse guess round it, and the ground dove to it in a funnel: the "stalactite field" of sparse
// ground under trees (Toma's 10 cm Nemuno iedas cloud, 3-4 m deep). Relaxed at every level as the pyramid is walked
// down (multigrid), a big gap is smoothed where it is only a few cells wide; measured cells stay as they are.
export const LEVEL_RELAX_PASSES = 12;
export const relaxLevel = (data, width, height, holes, passes = LEVEL_RELAX_PASSES) => {
  for (let pass = 0; pass < passes; pass++) {
    for (let k = 0; k < holes.length; k++) {
      const i = holes[k]; const y = (i / width) | 0; const x = i - y * width;
      let s = 0; let c = 0;
      if (x > 0) { s += data[i - 1]; c++; }
      if (x < width - 1) { s += data[i + 1]; c++; }
      if (y > 0) { s += data[i - width]; c++; }
      if (y < height - 1) { s += data[i + width]; c++; }
      if (c) data[i] += RELAX_OMEGA * (s / c - data[i]);
    }
  }
};
