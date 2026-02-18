/**
 * segmentation.js — Fast mean-shift-like segmentation for satellite imagery.
 *
 * Produces a simplified "flat color blobs" version of the satellite texture,
 * ideal as a PBR base color map in game engines where land cover should be
 * represented as large uniform-color regions rather than noisy photo detail.
 *
 * Algorithm: aggressive downscale → iterative separable box blur (O(n) per
 * pass) → color quantization → flood-fill region labelling → small-region
 * merging → nearest-neighbor upscale. Runs in a Web Worker when available.
 */

// ─── Web Worker (inline) ─────────────────────────────────────────────
// The heavy pixel work runs off the main thread so the UI stays responsive.

const WORKER_CODE = `
"use strict";

// Horizontal box blur pass — O(n), constant per pixel regardless of radius
function blurH(r, g, b, w, h, rad) {
  const diam = rad * 2 + 1;
  const invDiam = 1 / diam;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sr = 0, sg = 0, sb = 0;
    // seed the accumulator with the leftmost (rad+1) pixels, mirrored
    for (let k = -rad; k <= rad; k++) {
      const idx = row + Math.min(Math.max(k, 0), w - 1);
      sr += r[idx]; sg += g[idx]; sb += b[idx];
    }
    for (let x = 0; x < w; x++) {
      r[row + x] = sr * invDiam;
      g[row + x] = sg * invDiam;
      b[row + x] = sb * invDiam;
      // slide window
      const addIdx = row + Math.min(x + rad + 1, w - 1);
      const subIdx = row + Math.max(x - rad, 0);
      sr += r[addIdx] - r[subIdx];
      sg += g[addIdx] - g[subIdx];
      sb += b[addIdx] - b[subIdx];
    }
  }
}

// Vertical box blur pass — O(n)
function blurV(r, g, b, w, h, rad) {
  const diam = rad * 2 + 1;
  const invDiam = 1 / diam;
  for (let x = 0; x < w; x++) {
    let sr = 0, sg = 0, sb = 0;
    for (let k = -rad; k <= rad; k++) {
      const idx = Math.min(Math.max(k, 0), h - 1) * w + x;
      sr += r[idx]; sg += g[idx]; sb += b[idx];
    }
    for (let y = 0; y < h; y++) {
      const idx = y * w + x;
      r[idx] = sr * invDiam;
      g[idx] = sg * invDiam;
      b[idx] = sb * invDiam;
      const addIdx = Math.min(y + rad + 1, h - 1) * w + x;
      const subIdx = Math.max(y - rad, 0) * w + x;
      sr += r[addIdx] - r[subIdx];
      sg += g[addIdx] - g[subIdx];
      sb += b[addIdx] - b[subIdx];
    }
  }
}

self.onmessage = function(e) {
  const { pixels, w, h, blurRadius, blurPasses, quantLevels, minRegionSize } = e.data;
  const n = w * h;

  // Unpack to typed arrays
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    r[i] = pixels[i * 4];
    g[i] = pixels[i * 4 + 1];
    b[i] = pixels[i * 4 + 2];
  }

  // Iterative box blur (3 passes of box blur ≈ Gaussian)
  for (let p = 0; p < blurPasses; p++) {
    blurH(r, g, b, w, h, blurRadius);
    blurV(r, g, b, w, h, blurRadius);
  }

  // Color quantization — snap each channel to nearest level
  const step = 256 / quantLevels;
  const halfStep = step * 0.5;
  for (let i = 0; i < n; i++) {
    r[i] = Math.min(255, Math.floor(r[i] / step) * step + halfStep);
    g[i] = Math.min(255, Math.floor(g[i] / step) * step + halfStep);
    b[i] = Math.min(255, Math.floor(b[i] / step) * step + halfStep);
  }

  // Flood-fill labelling of connected same-color regions
  const labels = new Int32Array(n).fill(-1);
  let regionCount = 0;
  const regionColors = []; // [{r,g,b,count}]

  for (let i = 0; i < n; i++) {
    if (labels[i] >= 0) continue;
    const rid = regionCount++;
    const seedR = r[i], seedG = g[i], seedB = b[i];
    const queue = [i];
    let count = 0;
    while (queue.length > 0) {
      const ci = queue.pop();
      if (labels[ci] >= 0) continue;
      if (r[ci] !== seedR || g[ci] !== seedG || b[ci] !== seedB) continue;
      labels[ci] = rid;
      count++;
      const cx = ci % w;
      const cy = (ci - cx) / w;
      if (cx > 0)     queue.push(ci - 1);
      if (cx < w - 1) queue.push(ci + 1);
      if (cy > 0)     queue.push(ci - w);
      if (cy < h - 1) queue.push(ci + w);
    }
    regionColors.push({ r: seedR, g: seedG, b: seedB, count });
  }

  // Build per-region pixel lists for small-region merging (indexed once)
  if (minRegionSize > 1) {
    // Build adjacency: for each small region, find best large neighbor
    const regionNeighborBest = new Int32Array(regionCount).fill(-1);
    const regionNeighborScore = new Int32Array(regionCount);

    // Scan border pixels once
    for (let i = 0; i < n; i++) {
      const rid = labels[i];
      if (regionColors[rid].count >= minRegionSize) continue;
      const x = i % w;
      const y = (i - x) / w;
      const check = (ni) => {
        const nrid = labels[ni];
        if (nrid !== rid && nrid >= 0) {
          // Prefer larger neighbor
          if (regionNeighborBest[rid] < 0 ||
              regionColors[nrid].count > regionColors[regionNeighborBest[rid]].count) {
            regionNeighborBest[rid] = nrid;
          }
        }
      };
      if (x > 0)     check(i - 1);
      if (x < w - 1) check(i + 1);
      if (y > 0)     check(i - w);
      if (y < h - 1) check(i + w);
    }

    // Reassign small regions
    for (let rid = 0; rid < regionCount; rid++) {
      if (regionColors[rid].count >= minRegionSize || regionNeighborBest[rid] < 0) continue;
      const target = regionNeighborBest[rid];
      for (let i = 0; i < n; i++) {
        if (labels[i] === rid) labels[i] = target;
      }
      regionColors[target].count += regionColors[rid].count;
      regionColors[rid].count = 0;
    }
  }

  // Write output RGBA
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const rc = regionColors[labels[i]];
    out[i * 4]     = rc.r;
    out[i * 4 + 1] = rc.g;
    out[i * 4 + 2] = rc.b;
    out[i * 4 + 3] = 255;
  }

  self.postMessage({ out, w, h }, [out.buffer]);
};
`;

let _workerBlobUrl = null;
function getWorkerUrl() {
  if (!_workerBlobUrl) {
    _workerBlobUrl = URL.createObjectURL(new Blob([WORKER_CODE], { type: 'application/javascript' }));
  }
  return _workerBlobUrl;
}

/**
 * Apply fast segmentation to satellite imagery.
 * @param {string} satelliteTextureUrl - URL/dataURL of the satellite image
 * @param {object} [options]
 * @param {number} [options.blurRadius=6]      - Box blur kernel radius
 * @param {number} [options.blurPasses=3]      - Number of blur iterations (3 ≈ Gaussian)
 * @param {number} [options.quantLevels=12]    - Color quantization levels per channel
 * @param {number} [options.minRegionSize=100] - Merge regions smaller than this
 * @param {number} [options.maxSize=512]       - Max processing dimension (flat blobs don't need detail)
 * @param {Function} [options.onProgress]      - Progress callback
 * @returns {Promise<{url: string, canvas: HTMLCanvasElement}>}
 */
export async function segmentSatelliteTexture(satelliteTextureUrl, options = {}) {
  const {
    blurRadius = 6,
    blurPasses = 3,
    quantLevels = 12,
    minRegionSize = 100,
    maxSize = 512,
    onProgress,
  } = options;

  onProgress?.('Loading satellite image for segmentation...');
  const img = await loadImage(satelliteTextureUrl);

  // Downscale for processing — flat blobs don't need high res
  let procW = img.width;
  let procH = img.height;
  const scale = Math.min(1, maxSize / Math.max(procW, procH));
  if (scale < 1) {
    procW = Math.round(procW * scale);
    procH = Math.round(procH * scale);
  }

  const procCanvas = document.createElement('canvas');
  procCanvas.width = procW;
  procCanvas.height = procH;
  const procCtx = procCanvas.getContext('2d');
  procCtx.drawImage(img, 0, 0, procW, procH);

  const imageData = procCtx.getImageData(0, 0, procW, procH);

  onProgress?.('Segmenting (worker)...');

  // Run heavy work in a Web Worker
  const resultPixels = await new Promise((resolve, reject) => {
    try {
      const worker = new Worker(getWorkerUrl());
      worker.onmessage = (e) => {
        resolve(e.data.out);
        worker.terminate();
      };
      worker.onerror = (err) => {
        worker.terminate();
        reject(err);
      };
      // Transfer the pixel buffer to avoid copy
      const pixelsCopy = new Uint8ClampedArray(imageData.data);
      worker.postMessage(
        { pixels: pixelsCopy, w: procW, h: procH, blurRadius, blurPasses, quantLevels, minRegionSize },
        [pixelsCopy.buffer],
      );
    } catch {
      // Fallback: run inline (e.g. if Workers are blocked)
      resolve(runSegmentationSync(imageData.data, procW, procH, blurRadius, blurPasses, quantLevels, minRegionSize));
    }
  });

  // Write result
  const outData = new ImageData(resultPixels, procW, procH);
  procCtx.putImageData(outData, 0, 0);

  // Upscale to original resolution with nearest-neighbor (preserve crisp blocks)
  const outCanvas = document.createElement('canvas');
  outCanvas.width = img.width;
  outCanvas.height = img.height;
  const outCtx = outCanvas.getContext('2d');
  outCtx.imageSmoothingEnabled = false;
  outCtx.drawImage(procCanvas, 0, 0, img.width, img.height);

  const url = await new Promise((resolve) => {
    outCanvas.toBlob(
      (blob) => resolve(blob ? URL.createObjectURL(blob) : ''),
      'image/png',
    );
  });

  onProgress?.('Segmentation complete.');
  return { url, canvas: outCanvas };
}

// ─── Synchronous fallback (same logic as worker) ─────────────────────
function runSegmentationSync(pixels, w, h, blurRadius, blurPasses, quantLevels, minRegionSize) {
  const n = w * h;
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    r[i] = pixels[i * 4];
    g[i] = pixels[i * 4 + 1];
    b[i] = pixels[i * 4 + 2];
  }

  const blurH = (rad) => {
    const diam = rad * 2 + 1;
    const inv = 1 / diam;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sr = 0, sg = 0, sb = 0;
      for (let k = -rad; k <= rad; k++) {
        const idx = row + Math.min(Math.max(k, 0), w - 1);
        sr += r[idx]; sg += g[idx]; sb += b[idx];
      }
      for (let x = 0; x < w; x++) {
        r[row + x] = sr * inv;
        g[row + x] = sg * inv;
        b[row + x] = sb * inv;
        const a = row + Math.min(x + rad + 1, w - 1);
        const s = row + Math.max(x - rad, 0);
        sr += r[a] - r[s]; sg += g[a] - g[s]; sb += b[a] - b[s];
      }
    }
  };

  const blurV = (rad) => {
    const diam = rad * 2 + 1;
    const inv = 1 / diam;
    for (let x = 0; x < w; x++) {
      let sr = 0, sg = 0, sb = 0;
      for (let k = -rad; k <= rad; k++) {
        const idx = Math.min(Math.max(k, 0), h - 1) * w + x;
        sr += r[idx]; sg += g[idx]; sb += b[idx];
      }
      for (let y = 0; y < h; y++) {
        const idx = y * w + x;
        r[idx] = sr * inv; g[idx] = sg * inv; b[idx] = sb * inv;
        const a = Math.min(y + rad + 1, h - 1) * w + x;
        const s = Math.max(y - rad, 0) * w + x;
        sr += r[a] - r[s]; sg += g[a] - g[s]; sb += b[a] - b[s];
      }
    }
  };

  for (let p = 0; p < blurPasses; p++) {
    blurH(blurRadius);
    blurV(blurRadius);
  }

  const step = 256 / quantLevels;
  const half = step * 0.5;
  for (let i = 0; i < n; i++) {
    r[i] = Math.min(255, Math.floor(r[i] / step) * step + half);
    g[i] = Math.min(255, Math.floor(g[i] / step) * step + half);
    b[i] = Math.min(255, Math.floor(b[i] / step) * step + half);
  }

  // Flood fill
  const labels = new Int32Array(n).fill(-1);
  let regionCount = 0;
  const regionColors = [];

  for (let i = 0; i < n; i++) {
    if (labels[i] >= 0) continue;
    const rid = regionCount++;
    const sr2 = r[i], sg2 = g[i], sb2 = b[i];
    const queue = [i];
    let count = 0;
    while (queue.length > 0) {
      const ci = queue.pop();
      if (labels[ci] >= 0) continue;
      if (r[ci] !== sr2 || g[ci] !== sg2 || b[ci] !== sb2) continue;
      labels[ci] = rid;
      count++;
      const cx = ci % w;
      const cy = (ci - cx) / w;
      if (cx > 0) queue.push(ci - 1);
      if (cx < w - 1) queue.push(ci + 1);
      if (cy > 0) queue.push(ci - w);
      if (cy < h - 1) queue.push(ci + w);
    }
    regionColors.push({ r: sr2, g: sg2, b: sb2, count });
  }

  if (minRegionSize > 1) {
    const best = new Int32Array(regionCount).fill(-1);
    for (let i = 0; i < n; i++) {
      const rid = labels[i];
      if (regionColors[rid].count >= minRegionSize) continue;
      const x = i % w, y = (i - x) / w;
      const check = (ni) => {
        const nrid = labels[ni];
        if (nrid !== rid && nrid >= 0 && (best[rid] < 0 || regionColors[nrid].count > regionColors[best[rid]].count)) {
          best[rid] = nrid;
        }
      };
      if (x > 0) check(i - 1);
      if (x < w - 1) check(i + 1);
      if (y > 0) check(i - w);
      if (y < h - 1) check(i + w);
    }
    for (let rid = 0; rid < regionCount; rid++) {
      if (regionColors[rid].count >= minRegionSize || best[rid] < 0) continue;
      const t = best[rid];
      for (let i = 0; i < n; i++) { if (labels[i] === rid) labels[i] = t; }
      regionColors[t].count += regionColors[rid].count;
      regionColors[rid].count = 0;
    }
  }

  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const rc = regionColors[labels[i]];
    out[i * 4] = rc.r; out[i * 4 + 1] = rc.g; out[i * 4 + 2] = rc.b; out[i * 4 + 3] = 255;
  }
  return out;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
