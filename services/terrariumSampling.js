/**
 * Terrarium (AWS global elevation tiles) decode + sampling shared by the
 * resampler worker and the main-thread fallback.
 *
 * Two artifacts of the raw tiles are handled here (measured on Fuji, z15,
 * scratch/demprobe):
 *
 *  - Tile seams. AWS renders every 256 px tile independently, so the surface
 *    kinks at tile edges: the slope break across an edge averages ~0.7 m vs
 *    ~0.03 m inside a tile. Sampled straight, every export gets a faint grid of
 *    ridges/creases every ~1 km. blendTerrariumTileSeams relaxes a narrow band
 *    either side of each edge with a 1-D Gaussian taken across the seam.
 *
 *  - Bilinear facets. Bilinear is only C0: slope jumps at every ~4 m source
 *    pixel, which reads as a fine crosshatch in hillshade and in the preview's
 *    full-resolution normal map. A cubic B-spline is C2-continuous and moves
 *    the surface by only ~0.02 m RMS.
 */

const TILE_SIZE = 256;
// Seam band half-width and blur, in source pixels (~4 m each at z15).
const SEAM_BAND = 8;
const SEAM_SIGMA = 3;

export const decodeTerrariumPixels = (pixels, width, height, noData) => {
    const heights = new Float32Array(width * height);
    for (let i = 0; i < heights.length; i++) {
        const p = i * 4;
        const h = pixels[p] * 256 + pixels[p + 1] + pixels[p + 2] / 256 - 32768;
        // Tolerance, not an exact sentinel: AWS blends coastline no-data.
        heights[i] = h <= -32760 ? noData : h;
    }
    return heights;
};

const seamWeights = () => {
    const r = Math.ceil(SEAM_SIGMA * 3);
    const k = new Float32Array(2 * r + 1);
    let sum = 0;
    for (let i = -r; i <= r; i++) {
        k[i + r] = Math.exp(-(i * i) / (2 * SEAM_SIGMA * SEAM_SIGMA));
        sum += k[i + r];
    }
    for (let i = 0; i < k.length; i++) k[i] /= sum;
    return { r, k };
};

// Cosine ramp: 1 on the seam, 0 at SEAM_BAND pixels away. Index = distance of
// the pixel centre from the edge, in half pixels (edge sits between pixels).
const seamBlend = (offsetInTile) => {
    const d = Math.abs(((offsetInTile + 0.5 + TILE_SIZE / 2) % TILE_SIZE) - TILE_SIZE / 2);
    return d >= SEAM_BAND ? 0 : 0.5 * (1 + Math.cos((Math.PI * d) / SEAM_BAND));
};

/**
 * In place. The mosaic origin must be a tile corner (it always is: mosaics are
 * whole tiles). Vertical seams are blurred horizontally, then horizontal seams
 * vertically; only band pixels are touched.
 */
export const blendTerrariumTileSeams = (heights, width, height, noData) => {
    if (width <= TILE_SIZE && height <= TILE_SIZE) return;
    const { r, k } = seamWeights();
    const blend = new Float32Array(TILE_SIZE);
    for (let i = 0; i < TILE_SIZE; i++) blend[i] = seamBlend(i);

    const pass = (horizontal) => {
        const lines = horizontal ? height : width;
        const len = horizontal ? width : height;
        const stride = horizontal ? 1 : width;
        const line = new Float32Array(len);
        for (let l = 0; l < lines; l++) {
            const base = horizontal ? l * width : l;
            for (let i = 0; i < len; i++) line[i] = heights[base + i * stride];
            for (let i = 0; i < len; i++) {
                const w = blend[i % TILE_SIZE];
                // Outer mosaic border is not a seam between two tiles.
                if (w === 0 || i < SEAM_BAND || i >= len - SEAM_BAND) continue;
                if (line[i] === noData) continue;
                let s = 0;
                let ok = true;
                for (let t = -r; t <= r; t++) {
                    const v = line[Math.max(0, Math.min(len - 1, i + t))];
                    if (v === noData) { ok = false; break; }
                    s += k[t + r] * v;
                }
                if (ok) heights[base + i * stride] = line[i] * (1 - w) + s * w;
            }
        }
    };
    pass(true);
    pass(false);
};

const bspline = (t) => {
    t = Math.abs(t);
    if (t < 1) return (4 - 6 * t * t + 3 * t * t * t) / 6;
    if (t < 2) { const u = 2 - t; return (u * u * u) / 6; }
    return 0;
};

/**
 * Height at fractional mosaic pixel coords (x, y), where pixel i covers
 * [i, i + 1) — the same convention as project()-relative tile coords. Values
 * sit at pixel centres. Falls back to the mean of valid neighbours near
 * no-data so coastline holes don't spread.
 */
export const sampleTerrariumHeights = (heights, width, height, x, y, noData) => {
    const fx = x - 0.5;
    const fy = y - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const dx = fx - x0;
    const dy = fy - y0;
    const wx0 = bspline(1 + dx), wx1 = bspline(dx), wx2 = bspline(1 - dx), wx3 = bspline(2 - dx);
    const wy = [bspline(1 + dy), bspline(dy), bspline(1 - dy), bspline(2 - dy)];

    let sum = 0;
    let validSum = 0;
    let validCnt = 0;
    let complete = true;
    for (let j = 0; j < 4; j++) {
        const row = Math.max(0, Math.min(height - 1, y0 - 1 + j)) * width;
        for (let i = 0; i < 4; i++) {
            const v = heights[row + Math.max(0, Math.min(width - 1, x0 - 1 + i))];
            if (v === noData) { complete = false; continue; }
            sum += wy[j] * (i === 0 ? wx0 : i === 1 ? wx1 : i === 2 ? wx2 : wx3) * v;
            validSum += v;
            validCnt++;
        }
    }
    if (complete) return sum;
    return validCnt > 0 ? validSum / validCnt : noData;
};
