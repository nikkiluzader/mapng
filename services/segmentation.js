/**
 * segmentation.js — K-means color segmentation for satellite imagery.
 *
 * Produces a simplified "flat color blobs" version of the satellite texture,
 * ideal as a PBR base color map in game engines where land cover should be
 * represented by a small number of uniform-color regions.
 *
 * Algorithm: aggressive downscale → iterative separable box blur (noise
 * reduction) → k-means clustering with k-means++ init (exactly k colors)
 * → flood-fill region labelling → small-region merging → nearest-neighbor
 * upscale. Runs in a Web Worker when available.
 */

// ─── Web Worker (inline) ─────────────────────────────────────────────
// The heavy pixel work runs off the main thread so the UI stays responsive.

const WORKER_CODE = `
"use strict";

// ── Box blur (separable, O(n) per pass) ──────────────────────────────

function blurH(r, g, b, w, h, rad) {
  const diam = rad * 2 + 1;
  const invDiam = 1 / diam;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sr = 0, sg = 0, sb = 0;
    for (let k = -rad; k <= rad; k++) {
      const idx = row + Math.min(Math.max(k, 0), w - 1);
      sr += r[idx]; sg += g[idx]; sb += b[idx];
    }
    for (let x = 0; x < w; x++) {
      r[row + x] = sr * invDiam;
      g[row + x] = sg * invDiam;
      b[row + x] = sb * invDiam;
      const addIdx = row + Math.min(x + rad + 1, w - 1);
      const subIdx = row + Math.max(x - rad, 0);
      sr += r[addIdx] - r[subIdx];
      sg += g[addIdx] - g[subIdx];
      sb += b[addIdx] - b[subIdx];
    }
  }
}

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

// ── K-means++ initialization ─────────────────────────────────────────
// Picks k diverse seed centroids: first one random, each subsequent one
// chosen with probability proportional to squared distance from the
// nearest already-chosen centroid.

function kmeansppInit(r, g, b, n, k) {
  const centroids = new Float32Array(k * 3);
  const dist = new Float32Array(n);

  // First centroid: pick pixel closest to the mean (most representative)
  let mr = 0, mg = 0, mb = 0;
  for (let i = 0; i < n; i++) { mr += r[i]; mg += g[i]; mb += b[i]; }
  mr /= n; mg /= n; mb /= n;
  let bestIdx = 0, bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const d = (r[i] - mr) ** 2 + (g[i] - mg) ** 2 + (b[i] - mb) ** 2;
    if (d < bestD) { bestD = d; bestIdx = i; }
  }
  centroids[0] = r[bestIdx]; centroids[1] = g[bestIdx]; centroids[2] = b[bestIdx];

  // Initialize distances to first centroid
  let totalDist = 0;
  for (let i = 0; i < n; i++) {
    const d = (r[i] - centroids[0]) ** 2 + (g[i] - centroids[1]) ** 2 + (b[i] - centroids[2]) ** 2;
    dist[i] = d;
    totalDist += d;
  }

  // Pick remaining centroids
  for (let c = 1; c < k; c++) {
    // Weighted random selection proportional to dist²
    let target = Math.random() * totalDist;
    let chosen = 0;
    for (let i = 0; i < n; i++) {
      target -= dist[i];
      if (target <= 0) { chosen = i; break; }
    }
    centroids[c * 3]     = r[chosen];
    centroids[c * 3 + 1] = g[chosen];
    centroids[c * 3 + 2] = b[chosen];

    // Update distances (min with new centroid)
    totalDist = 0;
    for (let i = 0; i < n; i++) {
      const d = (r[i] - centroids[c * 3]) ** 2 +
                (g[i] - centroids[c * 3 + 1]) ** 2 +
                (b[i] - centroids[c * 3 + 2]) ** 2;
      if (d < dist[i]) dist[i] = d;
      totalDist += dist[i];
    }
  }

  return centroids;
}

// ── K-means clustering ───────────────────────────────────────────────

function kmeans(r, g, b, n, k, maxIter) {
  const centroids = kmeansppInit(r, g, b, n, k);
  const assignments = new Uint8Array(n);
  const sumR = new Float64Array(k);
  const sumG = new Float64Array(k);
  const sumB = new Float64Array(k);
  const counts = new Uint32Array(k);

  for (let iter = 0; iter < maxIter; iter++) {
    // Assign each pixel to nearest centroid
    let changed = 0;
    for (let i = 0; i < n; i++) {
      const pr = r[i], pg = g[i], pb = b[i];
      let bestC = 0, bestDist = Infinity;
      for (let c = 0; c < k; c++) {
        const dr = pr - centroids[c * 3];
        const dg = pg - centroids[c * 3 + 1];
        const db = pb - centroids[c * 3 + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestDist) { bestDist = d; bestC = c; }
      }
      if (assignments[i] !== bestC) { changed++; assignments[i] = bestC; }
    }

    // Recompute centroids
    sumR.fill(0); sumG.fill(0); sumB.fill(0); counts.fill(0);
    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      sumR[c] += r[i]; sumG[c] += g[i]; sumB[c] += b[i]; counts[c]++;
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) continue;
      centroids[c * 3]     = sumR[c] / counts[c];
      centroids[c * 3 + 1] = sumG[c] / counts[c];
      centroids[c * 3 + 2] = sumB[c] / counts[c];
    }

    // Converged when < 0.1% of pixels changed
    if (changed < n * 0.001) break;
  }

  return { centroids, assignments };
}

// ── Main worker entry ────────────────────────────────────────────────

self.onmessage = function(e) {
  const { pixels, w, h, blurRadius, blurPasses, numColors, minRegionSize } = e.data;
  const n = w * h;
  const k = Math.max(2, Math.min(numColors, 256));

  // Unpack to float channels
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    r[i] = pixels[i * 4];
    g[i] = pixels[i * 4 + 1];
    b[i] = pixels[i * 4 + 2];
  }

  // Iterative box blur (noise reduction before clustering)
  for (let p = 0; p < blurPasses; p++) {
    blurH(r, g, b, w, h, blurRadius);
    blurV(r, g, b, w, h, blurRadius);
  }

  // K-means clustering to exactly k colors
  const { centroids, assignments } = kmeans(r, g, b, n, k, 30);

  // Snap every pixel to its centroid color (integer values)
  const finalR = new Uint8Array(k);
  const finalG = new Uint8Array(k);
  const finalB = new Uint8Array(k);
  for (let c = 0; c < k; c++) {
    finalR[c] = Math.round(Math.min(255, Math.max(0, centroids[c * 3])));
    finalG[c] = Math.round(Math.min(255, Math.max(0, centroids[c * 3 + 1])));
    finalB[c] = Math.round(Math.min(255, Math.max(0, centroids[c * 3 + 2])));
  }
  for (let i = 0; i < n; i++) {
    r[i] = finalR[assignments[i]];
    g[i] = finalG[assignments[i]];
    b[i] = finalB[assignments[i]];
  }

  // Flood-fill labelling of connected same-color regions
  const labels = new Int32Array(n).fill(-1);
  let regionCount = 0;
  const regionColors = [];

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

  // Small-region merging
  if (minRegionSize > 1) {
    const regionNeighborBest = new Int32Array(regionCount).fill(-1);
    for (let i = 0; i < n; i++) {
      const rid = labels[i];
      if (regionColors[rid].count >= minRegionSize) continue;
      const x = i % w;
      const y = (i - x) / w;
      const check = (ni) => {
        const nrid = labels[ni];
        if (nrid !== rid && nrid >= 0) {
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
 * Apply k-means color segmentation to satellite imagery.
 * @param {string} satelliteTextureUrl - URL/dataURL of the satellite image
 * @param {object} [options]
 * @param {number} [options.blurRadius=6]      - Box blur kernel radius (noise reduction)
 * @param {number} [options.blurPasses=3]      - Number of blur iterations (3 ≈ Gaussian)
 * @param {number} [options.numColors=10]      - Exact number of output colors (k-means k)
 * @param {number} [options.minRegionSize=100] - Merge regions smaller than this
 * @param {number} [options.maxSize=512]       - Max processing dimension
 * @param {Function} [options.onProgress]      - Progress callback
 * @returns {Promise<{url: string, canvas: HTMLCanvasElement}>}
 */
export async function segmentSatelliteTexture(satelliteTextureUrl, options = {}) {
  const {
    blurRadius = 6,
    blurPasses = 3,
    numColors = 10,
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

  onProgress?.('Segmenting (k-means, k=' + numColors + ')...');

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
      const pixelsCopy = new Uint8ClampedArray(imageData.data);
      worker.postMessage(
        { pixels: pixelsCopy, w: procW, h: procH, blurRadius, blurPasses, numColors, minRegionSize },
        [pixelsCopy.buffer],
      );
    } catch {
      // Fallback: run inline (e.g. if Workers are blocked)
      resolve(runSegmentationSync(imageData.data, procW, procH, blurRadius, blurPasses, numColors, minRegionSize));
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

// ─── Synchronous fallback (mirrors worker logic) ─────────────────────

function runSegmentationSync(pixels, w, h, blurRadius, blurPasses, numColors, minRegionSize) {
  const n = w * h;
  const k = Math.max(2, Math.min(numColors, 256));

  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    r[i] = pixels[i * 4];
    g[i] = pixels[i * 4 + 1];
    b[i] = pixels[i * 4 + 2];
  }

  // Box blur
  const blurH = (rad) => {
    const diam = rad * 2 + 1;
    const inv = 1 / diam;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sr = 0, sg = 0, sb = 0;
      for (let kk = -rad; kk <= rad; kk++) {
        const idx = row + Math.min(Math.max(kk, 0), w - 1);
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
      for (let kk = -rad; kk <= rad; kk++) {
        const idx = Math.min(Math.max(kk, 0), h - 1) * w + x;
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
  for (let p = 0; p < blurPasses; p++) { blurH(blurRadius); blurV(blurRadius); }

  // K-means++ init
  const centroids = new Float32Array(k * 3);
  const dist = new Float32Array(n);

  let mr = 0, mg = 0, mb = 0;
  for (let i = 0; i < n; i++) { mr += r[i]; mg += g[i]; mb += b[i]; }
  mr /= n; mg /= n; mb /= n;
  let bestIdx = 0, bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const d = (r[i] - mr) ** 2 + (g[i] - mg) ** 2 + (b[i] - mb) ** 2;
    if (d < bestD) { bestD = d; bestIdx = i; }
  }
  centroids[0] = r[bestIdx]; centroids[1] = g[bestIdx]; centroids[2] = b[bestIdx];

  let totalDist = 0;
  for (let i = 0; i < n; i++) {
    const d = (r[i] - centroids[0]) ** 2 + (g[i] - centroids[1]) ** 2 + (b[i] - centroids[2]) ** 2;
    dist[i] = d;
    totalDist += d;
  }
  for (let c = 1; c < k; c++) {
    let target = Math.random() * totalDist;
    let chosen = 0;
    for (let i = 0; i < n; i++) {
      target -= dist[i];
      if (target <= 0) { chosen = i; break; }
    }
    centroids[c * 3] = r[chosen]; centroids[c * 3 + 1] = g[chosen]; centroids[c * 3 + 2] = b[chosen];
    totalDist = 0;
    for (let i = 0; i < n; i++) {
      const d = (r[i] - centroids[c * 3]) ** 2 + (g[i] - centroids[c * 3 + 1]) ** 2 + (b[i] - centroids[c * 3 + 2]) ** 2;
      if (d < dist[i]) dist[i] = d;
      totalDist += dist[i];
    }
  }

  // K-means iterations
  const assignments = new Uint8Array(n);
  const sumR = new Float64Array(k);
  const sumG = new Float64Array(k);
  const sumB = new Float64Array(k);
  const counts = new Uint32Array(k);

  for (let iter = 0; iter < 30; iter++) {
    let changed = 0;
    for (let i = 0; i < n; i++) {
      const pr = r[i], pg = g[i], pb = b[i];
      let bestC = 0, bestDist2 = Infinity;
      for (let c = 0; c < k; c++) {
        const dr = pr - centroids[c * 3];
        const dg = pg - centroids[c * 3 + 1];
        const db = pb - centroids[c * 3 + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestDist2) { bestDist2 = d; bestC = c; }
      }
      if (assignments[i] !== bestC) { changed++; assignments[i] = bestC; }
    }
    sumR.fill(0); sumG.fill(0); sumB.fill(0); counts.fill(0);
    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      sumR[c] += r[i]; sumG[c] += g[i]; sumB[c] += b[i]; counts[c]++;
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) continue;
      centroids[c * 3] = sumR[c] / counts[c];
      centroids[c * 3 + 1] = sumG[c] / counts[c];
      centroids[c * 3 + 2] = sumB[c] / counts[c];
    }
    if (changed < n * 0.001) break;
  }

  // Snap pixels to centroid colors
  const finalR = new Uint8Array(k);
  const finalG = new Uint8Array(k);
  const finalB = new Uint8Array(k);
  for (let c = 0; c < k; c++) {
    finalR[c] = Math.round(Math.min(255, Math.max(0, centroids[c * 3])));
    finalG[c] = Math.round(Math.min(255, Math.max(0, centroids[c * 3 + 1])));
    finalB[c] = Math.round(Math.min(255, Math.max(0, centroids[c * 3 + 2])));
  }
  for (let i = 0; i < n; i++) {
    r[i] = finalR[assignments[i]];
    g[i] = finalG[assignments[i]];
    b[i] = finalB[assignments[i]];
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

  // Small-region merging
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
