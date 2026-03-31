/**
 * Terrain foundation pass for BeamNG level export.
 *
 * For each OSM building footprint, levels the terrain heightmap to the maximum
 * height found within that footprint and raises it slightly to simulate a
 * built-up foundation (compacted dirt, concrete pad, etc.).
 *
 * Without this pass, houses on slopes can appear to float above the low side
 * of their footprint. This pass ensures the terrain fills in underneath.
 *
 * Coordinate systems:
 *   heightMap — row-major Float32Array, row 0 = north edge, row increases southward.
 *               Index = row * width + col, col increases eastward.
 *   terrain px — used by osmTerrainMaterials: origin SW, py increases northward.
 *               heightMap row = (size - 1) - py
 */

/**
 * Convert WGS84 lat/lng to heightMap {row, col} pixel coordinates.
 * Row 0 = north (top of heightMap).
 */
function geoToHeightMapPx(lat, lng, bounds, size) {
  const col = (lng - bounds.west)  / (bounds.east  - bounds.west)  * (size - 1);
  const py  = (lat - bounds.south) / (bounds.north - bounds.south) * (size - 1);
  const row = (size - 1) - py; // flip: py=0 (south) → row = size-1
  return {
    col: Math.max(0, Math.min(size - 1, col)),
    row: Math.max(0, Math.min(size - 1, row)),
  };
}

function uniqueIndices(indices) {
  return [...new Set(indices)];
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function smoothstep01(t) {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

function percentileFromSorted(sorted, p) {
  if (!sorted.length) return NaN;
  const pos = clamp01(p) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(sorted.length - 1, lo + 1);
  const frac = pos - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

function estimateMetersPerPixel(terrainData) {
  if (Number.isFinite(terrainData?.metersPerPixel) && terrainData.metersPerPixel > 0) {
    return terrainData.metersPerPixel;
  }

  const { bounds, width } = terrainData;
  if (!bounds || !width) return 1;

  const centerLat = (bounds.north + bounds.south) / 2;
  const latRad = (centerLat * Math.PI) / 180;
  const metersPerDegreeLng = 111320 * Math.cos(latRad);
  const metersPerDegreeLat = 110574;
  const widthMeters = Math.abs(bounds.east - bounds.west) * metersPerDegreeLng;
  const heightMeters = Math.abs(bounds.north - bounds.south) * metersPerDegreeLat;
  const avgMeters = (widthMeters + heightMeters) / 2;
  return Math.max(0.01, avgMeters / width);
}

async function blurTransitionZone(
  heightMap,
  sourceHeightMap,
  size,
  fixedSet,
  regionSet,
  iterations = 1,
  options = {}
) {
  if (iterations <= 0 || !regionSet.size) return;

  const {
    yieldFn = null,
    yieldEveryPixels = 200000,
  } = options;

  const regionMask = new Uint8Array(size * size);
  const regionIndices = Array.from(regionSet);
  for (const idx of regionIndices) regionMask[idx] = 1;

  for (let iter = 0; iter < iterations; iter++) {
    const next = new Float32Array(heightMap);
    let processed = 0;
    for (const idx of regionIndices) {
      if (fixedSet.has(idx)) continue;

      const row = Math.floor(idx / size);
      const col = idx - row * size;

      let sum = 0;
      let count = 0;
      for (let dr = -1; dr <= 1; dr++) {
        const rr = row + dr;
        if (rr < 0 || rr >= size) continue;
        for (let dc = -1; dc <= 1; dc++) {
          const cc = col + dc;
          if (cc < 0 || cc >= size) continue;
          const nIdx = rr * size + cc;
          if (!regionMask[nIdx]) continue;
          sum += heightMap[nIdx];
          count++;
        }
      }

      if (!count) continue;
      const naturalH = sourceHeightMap[idx];
      const smoothed = Math.max(naturalH, sum / count);
      next[idx] = smoothed;

      processed++;
      if (yieldFn && processed % yieldEveryPixels === 0) {
        await yieldFn();
      }
    }

    processed = 0;
    for (const idx of regionIndices) {
      if (fixedSet.has(idx)) continue;
      heightMap[idx] = next[idx];

      processed++;
      if (yieldFn && processed % yieldEveryPixels === 0) {
        await yieldFn();
      }
    }
  }
}

/**
 * Scanline-fill a polygon ring (array of {row, col} in heightMap space)
 * and return the flat array of heightMap indices that fall inside.
 *
 * @param {Array<{row:number,col:number}>} ring
 * @param {number} size — terrain grid side length
 * @param {number} [margin=1] — extra pixels to expand the filled region (in each direction)
 * @returns {number[]} flat list of heightMap indices
 */
function rasterizePolygonIndices(ring, size, margin = 1) {
  if (ring.length < 3) return [];

  const indices = [];
  const n = ring.length;

  let minRow = size, maxRow = 0;
  for (const p of ring) {
    if (p.row < minRow) minRow = p.row;
    if (p.row > maxRow) maxRow = p.row;
  }
  // Expand row range by margin for the foundation perimeter.
  minRow = Math.max(0, Math.floor(minRow) - margin);
  maxRow = Math.min(size - 1, Math.ceil(maxRow) + margin);

  for (let row = minRow; row <= maxRow; row++) {
    const sy = row + 0.5;
    const xs = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const r0 = ring[i].row, r1 = ring[j].row;
      if ((r0 <= sy && r1 > sy) || (r1 <= sy && r0 > sy)) {
        xs.push(ring[i].col + (sy - r0) / (r1 - r0) * (ring[j].col - ring[i].col));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(xs[k]) - margin);
      const c1 = Math.min(size - 1, Math.floor(xs[k + 1]) + margin);
      for (let col = c0; col <= c1; col++) {
        indices.push(row * size + col);
      }
    }
  }
  return indices;
}

/**
 * Apply a foundation height pass to the terrain heightmap using OSM building footprints.
 *
 * For each building polygon:
 *   1. Rasterize the footprint to heightMap pixels (with a small margin).
 *   2. Find the maximum terrain height within the footprint.
 *   3. Set all footprint pixels to (max + foundationRaise), levelling the terrain
 *      and simulating a built-up pad on the low side of any slope.
 *
 * @param {object} terrainData — terrain data object (not mutated; a shallow clone is returned)
 * @param {object} [options]
 * @param {number} [options.foundationRaise=0.3] — meters to raise above the footprint max
 * @param {number} [options.marginPx=1] — extra pixels to include around each footprint
 * @returns {object} — new terrainData with updated heightMap and maxHeight
 */
export async function applyBuildingFoundations(terrainData, options = {}) {
  const {
    foundationRaise = 0.3,
    marginPx = 1,
    transitionPx = 6,
    foundationPercentile = 0.85,
    reliefLowPercentile = 0.15,
    reliefHighPercentile = 0.85,
    minReliefMeters = 2.5,
    minSlope = 0.22,
    blurIterations = 2,
    yieldFn = null,
    yieldEveryBuildings = 8,
    yieldEveryPixels = 200000,
    onProgress = null,
  } = options;
  const { width, bounds, osmFeatures = [], maxHeight } = terrainData;
  const size = width; // terrain is square by export time

  const buildings = osmFeatures.filter(f => f.type === 'building' && f.geometry?.length >= 3);
  if (!buildings.length) return terrainData;

  // Clone the heightMap — never mutate the original terrain data.
  const heightMap = new Float32Array(terrainData.heightMap);
  // Preserve the source terrain so feathering blends back into natural slopes.
  const sourceHeightMap = terrainData.heightMap;
  const metersPerPixel = estimateMetersPerPixel(terrainData);
  let newMaxHeight = maxHeight;
  let foundationApplied = 0;
  let foundationSkipped = 0;

  for (let i = 0; i < buildings.length; i++) {
    const building = buildings[i];
    const ring = building.geometry.map(pt => geoToHeightMapPx(pt.lat, pt.lng, bounds, size));
    const indices = uniqueIndices(rasterizePolygonIndices(ring, size, marginPx));
    if (!indices.length) continue;

    // Pick a robust foundation reference height from the upper part of the
    // footprint distribution so one noisy high pixel does not create a cliff.
    const footprintHeights = [];
    for (const idx of indices) {
      const h = sourceHeightMap[idx];
      if (isFinite(h)) footprintHeights.push(h);
    }
    if (!footprintHeights.length) continue;

    const sortedHeights = [...footprintHeights].sort((a, b) => a - b);
    const reliefLow = percentileFromSorted(sortedHeights, reliefLowPercentile);
    const reliefHigh = percentileFromSorted(sortedHeights, reliefHighPercentile);
    const terrainRelief = Math.max(0, reliefHigh - reliefLow);
    const footprintRunMeters = Math.max(1, Math.sqrt(indices.length) * metersPerPixel);
    const slopeEstimate = terrainRelief / footprintRunMeters;

    if (terrainRelief < minReliefMeters && slopeEstimate < minSlope) {
      foundationSkipped++;
      if (onProgress && (i % 25 === 0 || i === buildings.length - 1)) {
        onProgress({
          completed: i + 1,
          total: buildings.length,
          applied: foundationApplied,
          skipped: foundationSkipped,
        });
      }
      if (yieldFn && (i + 1) % yieldEveryBuildings === 0) {
        await yieldFn();
      }
      continue;
    }

    // Level the entire footprint to percentile + foundation raise.
    // Pixels that were already above this value are left untouched (e.g. a ridge
    // through a building) — only lower pixels are raised to form the flat pad.
    const foundationBase = percentileFromSorted(sortedHeights, foundationPercentile);
    const foundationH = foundationBase + foundationRaise;
    const coreSet = new Set(indices);
    const touchedSet = new Set(indices);

    for (const idx of indices) {
      if (heightMap[idx] < foundationH) {
        heightMap[idx] = foundationH;
      }
    }

    // Blend the surrounding area in a few expanding rings so hillside foundations
    // transition smoothly instead of creating an abrupt cliff.
    if (transitionPx > 0) {
      let prevRing = indices;
      for (let d = 1; d <= transitionPx; d++) {
        const expanded = uniqueIndices(rasterizePolygonIndices(ring, size, marginPx + d));
        if (!expanded.length) continue;

        const prevSet = new Set(prevRing);
        const band = expanded.filter((idx) => !prevSet.has(idx));
        if (!band.length) {
          prevRing = expanded;
          continue;
        }

        const t = d / (transitionPx + 1);
        const alpha = 1 - smoothstep01(t);
        for (const idx of band) {
          touchedSet.add(idx);
          const naturalH = sourceHeightMap[idx];
          const targetH = naturalH + alpha * Math.max(0, foundationH - naturalH);
          if (heightMap[idx] < targetH) {
            heightMap[idx] = targetH;
          }
        }

        prevRing = expanded;
      }

      await blurTransitionZone(heightMap, sourceHeightMap, size, coreSet, touchedSet, blurIterations, {
        yieldFn,
        yieldEveryPixels,
      });
    }

    if (foundationH > newMaxHeight) newMaxHeight = foundationH;
    foundationApplied++;

    if (onProgress && (i % 25 === 0 || i === buildings.length - 1)) {
      onProgress({
        completed: i + 1,
        total: buildings.length,
        applied: foundationApplied,
        skipped: foundationSkipped,
      });
    }
    if (yieldFn && (i + 1) % yieldEveryBuildings === 0) {
      await yieldFn();
    }
  }

  if (foundationSkipped > 0) {
    console.info(
      `[BeamNG] Building foundations: applied ${foundationApplied}/${buildings.length}, skipped ${foundationSkipped} flat/low-slope footprints`
    );
  }

  return { ...terrainData, heightMap, maxHeight: newMaxHeight };
}
