import { createMetricProjector } from './geoUtils.js';
import { buildRoadNetwork, mergeLinearRoadSegments } from './roadNetwork.js';
import { estimateRoadHalfWidth, isOneWayRoad, NON_DRIVEABLE_HIGHWAYS } from './roadWidth.js';

const NO_DATA_VALUE = -99999;

// Profile sample spacing along the road centerline (metres).
const SAMPLE_SPACING_M = 5;
// Box-filter window for ONE smoothing pass (metres). The filter is applied
// SMOOTH_PASSES times: iterated box filters converge on a Gaussian, which
// (unlike the single box average used previously) has no pass-band ripple,
// so DEM quantization stair-steps come out as one continuous grade instead
// of a chain of ramps.
const SMOOTH_WINDOW_M = 30;
const SMOOTH_PASSES = 3;
// Distance over which a corridor's elevation profile is blended into the
// shared consensus height at a junction (metres).
const JUNCTION_RAMP_M = 60;
// Embankment feather width outside the flat road core (metres).
const FEATHER_M = 6.0;
// How close two corridors' claims on a pixel must be (in quantized weight, so
// 13/255 ≈ 0.05) to count as the same claim and be averaged rather than one
// winning outright. Wide enough for junction overlaps and touching embankments,
// far below the gap between a road core (1.0) and a neighbour's feather.
const TIE_WEIGHT = 13;

/**
 * Computes distance and projection parameter t of point (x,y) onto line segment (x1,y1)-(x2,y2)
 */
function pointLineProjection(x, y, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;

    if (lenSq === 0) {
        const dx0 = x - x1;
        const dy0 = y - y1;
        return { t: 0, dist: Math.sqrt(dx0 * dx0 + dy0 * dy0) };
    }

    let t = ((x - x1) * dx + (y - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const px = x1 + t * dx;
    const py = y1 + t * dy;
    const dist = Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));

    return { t, dist };
}

/**
 * Resample a polyline so that segments are no longer than maxSegmentLength (in pixels).
 */
function resamplePolyline(points, maxSegmentLength) {
    if (points.length < 2) return points;
    const resampled = [points[0]];

    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > maxSegmentLength) {
            const numSegments = Math.ceil(dist / maxSegmentLength);
            for (let j = 1; j < numSegments; j++) {
                const t = j / numSegments;
                resampled.push({
                    x: p1.x + t * dx,
                    y: p1.y + t * dy
                });
            }
        }
        resampled.push(p2);
    }
    return resampled;
}

/**
 * Samples heightmap at a specific pixel coordinate (bilinear interpolation).
 */
function sampleHeight(heightMap, width, height, px, py) {
    const cx = Math.max(0, Math.min(width - 1, px));
    const cy = Math.max(0, Math.min(height - 1, py));
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);

    const h00 = heightMap[y0 * width + x0];
    const h10 = heightMap[y0 * width + x1];
    const h01 = heightMap[y1 * width + x0];
    const h11 = heightMap[y1 * width + x1];

    // Average valid corners when some are NO_DATA; fall back to full bilinear
    // when all four corners are valid.
    let sum = 0, count = 0;
    if (h00 !== NO_DATA_VALUE) { sum += h00; count++; }
    if (h10 !== NO_DATA_VALUE) { sum += h10; count++; }
    if (h01 !== NO_DATA_VALUE) { sum += h01; count++; }
    if (h11 !== NO_DATA_VALUE) { sum += h11; count++; }
    if (count === 0) return NO_DATA_VALUE;
    if (count < 4) return sum / count;

    const dx = cx - x0;
    const dy = cy - y0;

    const top = h00 * (1 - dx) + h10 * dx;
    const bottom = h01 * (1 - dx) + h11 * dx;
    return top * (1 - dy) + bottom * dy;
}

/**
 * Smooths an array of Z values using a moving average window.
 *
 * Out-of-range samples are point-reflected (odd extension: f(-j) = 2·f(0) −
 * f(j)) so the window stays full at the array ends and linear grades pass
 * through unchanged. A truncated one-sided window would bias endpoint values
 * toward the interior, pinching the profile exactly where roads meet
 * junctions.
 */
function smooth1DArray(arr, windowSize) {
    const n = arr.length;
    const result = new Float32Array(n);
    const half = Math.floor(windowSize / 2);
    for (let i = 0; i < n; i++) {
        let sum = 0;
        let count = 0;
        for (let j = -half; j <= half; j++) {
            const idx = i + j;
            let v;
            if (idx < 0) {
                const r = -idx;
                v = (r < n && arr[0] !== NO_DATA_VALUE && arr[r] !== NO_DATA_VALUE)
                    ? 2 * arr[0] - arr[r]
                    : NO_DATA_VALUE;
            } else if (idx >= n) {
                const r = 2 * n - 2 - idx;
                v = (r >= 0 && arr[n - 1] !== NO_DATA_VALUE && arr[r] !== NO_DATA_VALUE)
                    ? 2 * arr[n - 1] - arr[r]
                    : NO_DATA_VALUE;
            } else {
                v = arr[idx];
            }
            if (v !== NO_DATA_VALUE) {
                sum += v;
                count++;
            }
        }
        result[i] = count > 0 ? sum / count : arr[i];
    }
    return result;
}

function isGroundLevelRoad(feature) {
    if (feature?.type !== 'road') return false;
    const tags = feature.tags || {};
    // Only carve terrain for something that will actually be a road. Footpaths
    // and trails are never drawn, so flattening them just terraces hillsides —
    // and they are the roughest corridors in the data, since they climb where
    // no vehicle road would.
    if (NON_DRIVEABLE_HIGHWAYS.has(tags.highway)) return false;
    const layer = Number.parseInt(tags.layer, 10) || 0;
    // Skip bridges, overpasses, tunnels, and elevated roads
    if (layer > 0 || tags.bridge === 'yes' || tags.tunnel === 'yes' || tags.covered === 'yes' || tags.location === 'elevated') {
        return false;
    }
    return Array.isArray(feature.geometry) && feature.geometry.length >= 2;
}

/**
 * Half-width in metres of the terrain strip to flatten for a corridor.
 *
 * This has to agree with the width the BeamNG export draws the DecalRoad at
 * (services/roadWidth.js), otherwise the outer lanes of anything wider than a
 * residential street sit on unflattened terrain and keep the original
 * cross-slope — which is exactly what "Level Roads" is supposed to remove.
 * The old fixed 6 m corridor left ~80% of the tilt on a default motorway.
 *
 * Merged corridors take the widest of their member ways, mirroring the
 * export's stable-width pass: OSM segmentation splits a constant-width road
 * into differently-tagged pieces, and the road is drawn at the wider value.
 */
function corridorHalfWidthMeters(corridor) {
    const members = Array.isArray(corridor.members) && corridor.members.length > 0
        ? corridor.members
        : [corridor];

    let half = 0;
    for (const member of members) {
        const tags = member?.tags || {};
        const highway = member?.highway || tags.highway || corridor.highway;
        const w = estimateRoadHalfWidth(tags, highway, isOneWayRoad(tags));
        if (Number.isFinite(w) && w > half) half = w;
    }
    return half > 0 ? half : 3.0;
}

/**
 * Build per-corridor elevation profiles: pixel-space sample points, original
 * and smoothed Z arrays, and cumulative arc length in metres.
 */
function buildCorridorProfiles(corridors, heightMap, width, height, project, metersPerPixel) {
    const maxSegmentLengthPx = Math.max(1, SAMPLE_SPACING_M / metersPerPixel);
    const windowSamples = Math.max(3, Math.round(SMOOTH_WINDOW_M / SAMPLE_SPACING_M));
    const profiles = [];

    for (const corridor of corridors) {
        const geom = corridor.geometry;
        if (!geom || geom.length < 2) continue;

        const rawPoints = geom.map((pt) => project(pt.lat, pt.lng));
        const points = resamplePolyline(rawPoints, maxSegmentLengthPx);
        if (points.length < 2) continue;

        const zOrig = new Float32Array(points.length);
        for (let i = 0; i < points.length; i++) {
            zOrig[i] = sampleHeight(heightMap, width, height, points[i].x, points[i].y);
        }

        let zSmooth = zOrig;
        for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
            zSmooth = smooth1DArray(zSmooth, windowSamples);
        }

        const cumLenM = new Float32Array(points.length);
        for (let i = 1; i < points.length; i++) {
            const dx = points[i].x - points[i - 1].x;
            const dy = points[i].y - points[i - 1].y;
            cumLenM[i] = cumLenM[i - 1] + Math.hypot(dx, dy) * metersPerPixel;
        }

        profiles.push({ corridor, points, zOrig, zSmooth, cumLenM });
    }
    return profiles;
}

/**
 * Pin every corridor's profile to a single consensus elevation at each shared
 * junction node, tapering the correction over JUNCTION_RAMP_M. Without this,
 * each road arrives at an intersection with its own independently smoothed
 * height and the strongest-weight blend produces a vertical crease exactly at
 * the junction (OSM ways usually END at intersections, so the smoothing
 * window is one-sided there — maximizing the disagreement).
 */
function pinJunctionElevations(profiles) {
    const endpointCounts = new Map();
    const bump = (key) => endpointCounts.set(key, (endpointCounts.get(key) || 0) + 1);
    for (const p of profiles) {
        bump(p.corridor.startKey);
        bump(p.corridor.endKey);
    }

    const junctionAgg = new Map();
    const addSample = (key, z) => {
        if (z === NO_DATA_VALUE || !Number.isFinite(z)) return;
        const agg = junctionAgg.get(key) || { sum: 0, count: 0 };
        agg.sum += z;
        agg.count++;
        junctionAgg.set(key, agg);
    };
    for (const p of profiles) {
        if ((endpointCounts.get(p.corridor.startKey) || 0) >= 2) addSample(p.corridor.startKey, p.zSmooth[0]);
        if ((endpointCounts.get(p.corridor.endKey) || 0) >= 2) addSample(p.corridor.endKey, p.zSmooth[p.zSmooth.length - 1]);
    }
    if (junctionAgg.size === 0) return;

    for (const p of profiles) {
        const { zSmooth, cumLenM } = p;
        const n = zSmooth.length;
        const totalLen = cumLenM[n - 1];
        // Cap each ramp at half the corridor so the two end corrections never
        // overlap — guaranteeing the endpoints land exactly on consensus.
        const ramp = Math.min(JUNCTION_RAMP_M, totalLen / 2);
        if (!(ramp > 0)) continue;

        const startAgg = junctionAgg.get(p.corridor.startKey);
        if (startAgg && zSmooth[0] !== NO_DATA_VALUE) {
            const delta = startAgg.sum / startAgg.count - zSmooth[0];
            for (let i = 0; i < n; i++) {
                const f = 1 - cumLenM[i] / ramp;
                if (f <= 0) break;
                if (zSmooth[i] !== NO_DATA_VALUE) zSmooth[i] += delta * f;
            }
        }
        const endAgg = junctionAgg.get(p.corridor.endKey);
        if (endAgg && zSmooth[n - 1] !== NO_DATA_VALUE) {
            const delta = endAgg.sum / endAgg.count - zSmooth[n - 1];
            for (let i = n - 1; i >= 0; i--) {
                const f = 1 - (totalLen - cumLenM[i]) / ramp;
                if (f <= 0) break;
                if (zSmooth[i] !== NO_DATA_VALUE) zSmooth[i] += delta * f;
            }
        }
    }
}

/**
 * Modifies the heightMap in-place so the terrain under roads follows a
 * smoothed, junction-consistent elevation profile.
 *
 * Corridors come from the same road-network builder the BeamNG export uses:
 * OSM ways are split at shared nodes and re-merged through pass-through
 * nodes, so a profile is smoothed per continuous roadway, and all roads
 * meeting at a junction are pinned to one shared height there.
 *
 * levelRoads=true flattens the road cross-section onto the smoothed
 * centerline (terracing); otherwise only the longitudinal smoothing delta is
 * applied and the transverse micro-relief is preserved.
 */
export function smoothRoadsInHeightmap(heightMap, width, height, bounds, osmFeatures, metersPerPixel, enhanceRoads, levelRoads) {
    if (!osmFeatures || osmFeatures.length === 0) return;

    const groundRoads = osmFeatures.filter(isGroundLevelRoad);
    if (groundRoads.length === 0) return;

    const network = buildRoadNetwork(groundRoads);
    const corridors = mergeLinearRoadSegments(network.segments, network.intersections);
    if (corridors.length === 0) return;

    const project = createMetricProjector(bounds, width, height);
    const profiles = buildCorridorProfiles(corridors, heightMap, width, height, project, metersPerPixel);
    if (profiles.length === 0) return;

    pinJunctionElevations(profiles);

    // Global accumulators. roadZ is the target height, roadW the strongest
    // claim any corridor has on the pixel (quantized to 1/255 — the weight only
    // scales a blend, and a byte here keeps an 8192² map under 400 MB), and
    // roadCount how many near-tied claims were averaged into roadZ.
    const roadZ = new Float32Array(width * height);
    const roadW = new Uint8Array(width * height);
    const roadCount = new Uint8Array(width * height);
    let hasRoads = false;

    for (const profile of profiles) {
        const { corridor, points, zOrig, zSmooth } = profile;

        const radiusMeters = corridorHalfWidthMeters(corridor);
        // The core is flat. We add an extra margin for feathering back to the terrain.
        const radiusPx = Math.max(1, (radiusMeters + FEATHER_M) / metersPerPixel);
        const coreRadiusPx = Math.max(1, radiusMeters / metersPerPixel);

        // Per-corridor strongest-weight pass: adjacent 5 m segments of one
        // corridor overlap heavily, and summing their weights would distort
        // the feather. Within a corridor the max weight wins; weight ties
        // (all core pixels are w=1) go to the NEAREST segment — otherwise the
        // first segment whose bbox covers a pixel supplies a clamped-t
        // projection, which rasterizes the smooth profile as a subtle
        // staircase. Corridors are then blended into the global buffers by
        // weighted average.
        const wMap = new Map();
        const zMap = new Map();
        const dMap = new Map();

        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];
            const z1 = zSmooth[i];
            const z2 = zSmooth[i + 1];

            if (z1 === NO_DATA_VALUE || z2 === NO_DATA_VALUE) continue;
            hasRoads = true;

            const minX = Math.max(0, Math.floor(Math.min(p1.x, p2.x) - radiusPx));
            const maxX = Math.min(width - 1, Math.ceil(Math.max(p1.x, p2.x) + radiusPx));
            const minY = Math.max(0, Math.floor(Math.min(p1.y, p2.y) - radiusPx));
            const maxY = Math.min(height - 1, Math.ceil(Math.max(p1.y, p2.y) + radiusPx));

            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) {
                    const { t, dist } = pointLineProjection(x, y, p1.x, p1.y, p2.x, p2.y);
                    if (dist > radiusPx) continue;

                    let w = 1.0;
                    if (dist > coreRadiusPx) {
                        // Feather from 1.0 to 0.0 using cosine for a smooth curve
                        const f = (dist - coreRadiusPx) / (radiusPx - coreRadiusPx);
                        w = 0.5 * (1 + Math.cos(Math.PI * f));
                    }

                    const idx = y * width + x;
                    const prevW = wMap.get(idx) || 0;
                    if (w < prevW || (w === prevW && dist >= (dMap.get(idx) ?? Infinity))) continue;

                    // The flat target elevation is determined by the smoothed centerline
                    let zTarget = z1 + t * (z2 - z1);

                    if (!levelRoads) {
                        // If not leveling, we only apply the longitudinal smoothing delta.
                        // delta = smoothed_centerline - original_centerline
                        const origZ = zOrig[i] + t * (zOrig[i + 1] - zOrig[i]);
                        const delta = zTarget - origZ;

                        // Apply this vertical shift to the pixel's original height
                        const pxOrigZ = heightMap[idx];
                        if (pxOrigZ !== NO_DATA_VALUE) {
                            zTarget = pxOrigZ + delta;
                        }
                    }

                    wMap.set(idx, w);
                    zMap.set(idx, zTarget);
                    dMap.set(idx, dist);
                }
            }
        }

        for (const [idx, w] of wMap) {
            const z = zMap.get(idx);
            const wq = Math.max(1, Math.round(w * 255));
            const best = roadW[idx];

            if (wq > best + TIE_WEIGHT) {
                // Stronger claim: this corridor's surface covers the pixel, so it
                // replaces the weaker one outright. Averaging here is what let a
                // neighbouring road's embankment drag the core of the road that
                // actually owns the pixel — the highway lane next to a parallel
                // service road came out tilted by a fraction of their height gap.
                roadZ[idx] = z;
                roadW[idx] = wq;
                roadCount[idx] = 1;
            } else if (wq + TIE_WEIGHT >= best) {
                // Comparable claims — two corridors meeting at a junction, or two
                // embankments overlapping. Averaging them is what keeps crossing
                // corridors from creasing, so it stays for near-ties only.
                const n = roadCount[idx];
                roadZ[idx] = (roadZ[idx] * n + z) / (n + 1);
                if (n < 255) roadCount[idx] = n + 1;
                if (wq > best) roadW[idx] = wq;
            }
        }
    }

    if (!hasRoads) return;

    // Blend the leveled roads back into the heightmap
    for (let i = 0; i < heightMap.length; i++) {
        const w = roadW[i] / 255;
        if (w > 0 && heightMap[i] !== NO_DATA_VALUE) {
            heightMap[i] = heightMap[i] * (1 - w) + roadZ[i] * w;
        }
    }
}
