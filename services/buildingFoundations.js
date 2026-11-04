/**
 * Terrain grading under multi-storey car parks for the BeamNG level export:
 * the ground under a garage is levelled to its flat deck and blended out.
 *
 * (Buildings themselves no longer reshape the terrain: each building is
 * generated with its own foundation underneath, services/beamngBuildings.js.
 * The old "Apply foundations" terrain pass was removed.)
 *
 * Coordinate systems:
 *   heightMap — row-major Float32Array, row 0 = north edge, row increases southward.
 *               Index = row * width + col, col increases eastward.
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
  if (Number.isFinite(terrainData?.processingMetersPerPixel) && terrainData.processingMetersPerPixel > 0) {
    return terrainData.processingMetersPerPixel;
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

const GARAGE_GRADE = 0.125;
const GARAGE_MIN_BLEND_M = 6;
const GARAGE_MAX_BLEND_M = 20;

export async function gradeGarageFootprints(terrainData, isGarage, { yieldFn = null } = {}) {
  const { width, bounds, osmFeatures = [] } = terrainData;
  const size = width;
  const garages = osmFeatures.filter((f) => f?.type === 'building' && f.geometry?.length >= 3 && isGarage(f));
  if (!garages.length) return terrainData;
  const heightMap = new Float32Array(terrainData.heightMap);
  const source = terrainData.heightMap;
  const mpp = estimateMetersPerPixel(terrainData);
  let maxHeight = terrainData.maxHeight;
  let minHeight = terrainData.minHeight;
  for (const garage of garages) {
    const ring = garage.geometry.map((pt) => geoToHeightMapPx(pt.lat, pt.lng, bounds, size));
    const core = uniqueIndices(rasterizePolygonIndices(ring, size, 1));
    if (!core.length) continue;
    const heights = core.map((i) => source[i]).filter(Number.isFinite).sort((a, b) => a - b);
    if (!heights.length) continue;
    const target = percentileFromSorted(heights, 0.5);
    const relief = Math.max(target - heights[0], heights[heights.length - 1] - target);
    if (relief < 0.05) continue;
    for (const i of core) heightMap[i] = target;
    // blend out ring by ring: the band d px out takes (1 - smoothstep) of the
    // way to the deck height
    const blendM = Math.max(GARAGE_MIN_BLEND_M, Math.min(GARAGE_MAX_BLEND_M, relief / GARAGE_GRADE));
    const blendPx = Math.max(1, Math.round(blendM / mpp));
    const done = new Set(core);
    for (let d = 1; d <= blendPx; d++) {
      const band = uniqueIndices(rasterizePolygonIndices(ring, size, 1 + d)).filter((i) => !done.has(i));
      const alpha = 1 - smoothstep01(d / (blendPx + 1));
      for (const i of band) {
        done.add(i);
        const natural = source[i];
        if (!Number.isFinite(natural)) continue;
        heightMap[i] = natural + alpha * (target - natural);
      }
    }
    maxHeight = Math.max(maxHeight, target);
    minHeight = Math.min(minHeight, target);
    if (yieldFn) await yieldFn();
  }
  return { ...terrainData, heightMap, maxHeight, minHeight };
}
