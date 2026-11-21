// A rectangular map (a footprint's bounding box: tiles in step 1, refs/output/tiles-plan.md) made square for the
// export, which assumes a square grid in many places. The rectangle sits centred in the smallest power-of-two square
// holding it; the ground models, map data, trees and spawn are kept to the rectangle (or to the footprint inside it)
// by the shape returned, so nothing is built in the padding. The padding's heights are stretched out from the
// rectangle's edge (never drawn; the export's smoothing and grading near the edge then see the edge's own heights).
// Generate stays rectangular (fetching and memory follow the rectangle); only the export pads. A true rectangular
// export is a later step.
import { shapeRows, fillOutsideFootprint, hasShape, shiftShape } from './batchShape.js';

/** The power-of-two square side holding a W x H grid. */
export const squareSideFor = (W, H) => { let N = 1; while (N < Math.max(W, H)) N *= 2; return N; };

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('the texture could not be read'));
  img.src = src;
});

/** A texture (canvas, blob or URL) drawn centred on a square canvas: its scale to the grid kept. */
async function padTexture(source, W, N, ox, oy) {
  let img = source; let url = null;
  if (source instanceof Blob) { url = URL.createObjectURL(source); img = await loadImage(url); } else if (typeof source === 'string') img = await loadImage(source);
  try {
    const tw = img.naturalWidth || img.width; const th = img.naturalHeight || img.height;
    const s = tw / W;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(N * s)); canvas.height = canvas.width;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#26282b'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, Math.round(ox * s), Math.round(oy * s), tw, th);
    return canvas;
  } finally { if (url) URL.revokeObjectURL(url); }
}

const canvasBlob = (canvas) => new Promise((r) => canvas.toBlob(r, 'image/png'));

/**
 * The map made square: { terrainData, shape: { size, rects }, offset: { x, y }, padded }. footprint: rects
 * [[x, y, w, h]...] on the rectangle's own pixels (rows from the north), or null for the whole rectangle. A square map
 * comes back unchanged (with its footprint as the shape, when it has one).
 */
export async function padTerrainToSquare(td, { footprint = null, log = () => {} } = {}) {
  const W = td.width; const H = td.height;
  const own = hasShape(footprint) ? footprint : [[0, 0, W, H]];
  if (W === H) return { terrainData: td, shape: hasShape(footprint) ? { size: W, ...shiftShape(footprint, 0, 0) } : null, offset: { x: 0, y: 0 }, padded: false };
  const N = squareSideFor(W, H);
  const ox = Math.floor((N - W) / 2); const oy = Math.floor((N - H) / 2);
  const moved = shiftShape(own, ox, oy);
  // heights: the rectangle copied in, the rest stretched from the footprint's edge
  const hm = new Float32Array(N * N);
  for (let r = 0; r < H; r++) hm.set(td.heightMap.subarray(r * W, r * W + W), (r + oy) * N + ox);
  fillOutsideFootprint(hm, shapeRows(moved, N), N);
  // bounds: widened around their middle at the rectangle's own degrees per pixel (the export maps them linearly)
  const b = td.bounds; const midLat = (b.north + b.south) / 2; const midLng = (b.east + b.west) / 2;
  const latPx = (b.north - b.south) / H; const lngPx = (b.east - b.west) / W;
  const cy = oy + H / 2; const cx = ox + W / 2;   // the rectangle's middle in the square's pixels
  const bounds = {
    north: midLat + cy * latPx, south: midLat - (N - cy) * latPx,
    west: midLng - cx * lngPx, east: midLng + (N - cx) * lngPx,
  };
  // land cover: n x n over the old bounds, made n' x n' over the square (cells outside: none)
  let landCover = td.landCover;
  if (landCover?.grid && landCover.grid.length === landCover.n * landCover.n) {
    const n = landCover.n; const n2 = Math.min(4096, Math.max(64, Math.round(n * N / Math.max(W, H))));
    const g = new Uint8Array(n2 * n2);
    for (let r = 0; r < n2; r++) {
      const py = (r + 0.5) * N / n2 - oy; if (py < 0 || py >= H) continue;
      const sr = Math.min(n - 1, Math.floor(py / H * n));
      for (let c = 0; c < n2; c++) {
        const px = (c + 0.5) * N / n2 - ox; if (px < 0 || px >= W) continue;
        g[r * n2 + c] = landCover.grid[sr * n + Math.min(n - 1, Math.floor(px / W * n))];
      }
    }
    landCover = { ...landCover, grid: g, n: n2 };
  }
  const out = { ...td, width: N, height: N, heightMap: hm, bounds, landCover };
  // textures: each kind padded once, kept as a canvas (the export prefers it) and a blob
  for (const kind of ['hybrid', 'game', 'osm']) {
    const src = td[`${kind}TextureCanvas`] || td[`${kind}TextureBlob`] || td[`${kind}TextureUrl`];
    if (!src) continue;
    try {
      const canvas = await padTexture(src, W, N, ox, oy);
      out[`${kind}TextureCanvas`] = canvas; out[`${kind}TextureBlob`] = await canvasBlob(canvas); out[`${kind}TextureUrl`] = null;
    } catch (e) { log(`the ${kind} texture could not be padded (${e?.message || e}); left out`); out[`${kind}TextureCanvas`] = null; out[`${kind}TextureBlob`] = null; out[`${kind}TextureUrl`] = null; }
  }
  if (td.satelliteTextureUrl) {
    try { out.satelliteTextureUrl = URL.createObjectURL(await canvasBlob(await padTexture(td.satelliteTextureUrl, W, N, ox, oy))); } catch (e) { log(`the satellite texture could not be padded (${e?.message || e})`); out.satelliteTextureUrl = null; }
  }
  log(`a ${W}×${H} map padded to ${N}×${N} for the export (offset ${ox}, ${oy}); footprint ${moved.runs ? `${moved.runs.length} row run(s)` : `${moved.rects.length} rect(s)`}; heights outside stretched from the edge; land cover ${landCover?.n ?? 'none'}²; textures padded`);
  return { terrainData: out, shape: { size: N, ...moved }, offset: { x: ox, y: oy }, padded: true };
}
