import { createGridProjector } from './geoUtils.js';
import { buildRoadNetwork, makeRoadNodeKey, mergeLinearRoadSegments } from './roadNetwork.js';
import { buildUrbanRoadClassifier, estimateRoadCrossSection, isOneWayRoad, NON_DRIVEABLE_HIGHWAYS } from './roadWidth.js';

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
// Where two claims of different heights meet (a side street's level surface
// on the avenue's, the inside of a fork) the winner-takes-it switch leaves a
// short step; the road surface is blurred over this radius (metres) to make
// it a ramp.
const SEAM_BLUR_M = 2;
// Height difference up to which the seam blur mixes two neighbouring claims
// (metres; it fades out by twice this). Junction seams are a few tenths.
const SEAM_BLUR_RANGE_M = 0.5;
// A seam: two claims of at least this road weight (in 1/255: 0.5) on one
// pixel, more than SEAM_MIN_DZ_M apart in height. Flags in roadCount's top bits.
const SEAM_MIN_W8 = 128;
// A side road ending on a through road (two other arms carrying on in line
// through the node, within THROUGH_COS of straight): the through road keeps
// its own surface across the junction. The side road's strip claims the
// ground under the through road's lanes at SIDE_ARM_W only (below a tie, so
// it never averages in), and its profile is pinned to the through road's
// surface where it leaves those lanes, not at the node on the centre line.
// Averaged in at full weight, a side street's level strip stood as a shelf
// across a trunk road on a 12% hill, a 0.5 m step at its edge.
const THROUGH_COS = -0.7;
const SIDE_ARM_W = 0.45;
const FORK_COS = 0.7;      // (an arm this close to a through arm's direction is a slip road forking from it: no side road)
const ARM_DIR_M = 10;
const SEAM_MIN_DZ_M = 0.02;
const SEAM_FLAG = 0x80;
const NEAR_SEAM = 0x40;
const COUNT_MASK = 0x3f;
// Bare-earth (lidar) elevation has bridges taken out: the approach embankment
// ends in a cliff, and the OSM node where the road meets its bridge often
// lands at its foot (Jacksonville: 10 m down in the last 5 m). Where a ground
// road ends on a bridge, its last BRIDGE_END_TRIM_M follow the grade the road
// arrives with (fitted BRIDGE_END_FIT_M further back) wherever the ground
// drops away from it by more than BRIDGE_END_TOL_M; the smoothing window
// would otherwise drag the cliff 30 m up the approach.
const BRIDGE_END_TRIM_M = 20;
const BRIDGE_END_FIT_M = 45;
const BRIDGE_END_TOL_M = 1;
// A step in a road's ground no road has (more than CLIFF_M between samples
// SAMPLE_SPACING_M apart): a structure bare-earth elevation took out that OSM
// does not tag as a bridge (Deck Park's HOV ramps climbing 9 m out of the
// I-10 median to 3rd Street: the lidar flat to the headwall, then a wall).
// The low side is lifted on a fill at CLIFF_GRADE from the top of the step
// until it meets its ground; the smoothing left a hump no car could climb.
const CLIFF_M = 3;
const CLIFF_GRADE = 0.1;
// Only an isolated step is a removed structure: the ground within
// CLIFF_SIDE_M before and after it no steeper than CLIFF_SIDE_GRADE. A road
// down a steep hillside (or an OSM line across one) steps at every sample,
// and lifting each built fake embankments up to 21 m tall on mountain lidar.
// Nor is a fill taller than CLIFF_MAX_LIFT_M a removed ramp.
const CLIFF_SIDE_M = 15;
const CLIFF_SIDE_GRADE = 0.1;
const CLIFF_MAX_LIFT_M = 10;
// Fine rasters (lidar-resolution GPXZ / USGS / KRON86) already hold the
// real road surface: the coarse tuning above (30 m x 3 smoothing, 60 m
// junction ramps) is for lumpy 30 m data and on lidar cut real crests and
// filled real sags, leaving the corridor in a trench or on a ridge with
// creases along its edges. Fine mode keeps the flat cross-section (what
// hides OSM running a metre or two off the bench) and only takes out
// elevation noise along the road.
const TUNING = {
  coarse: { window: SMOOTH_WINDOW_M, passes: SMOOTH_PASSES, ramp: JUNCTION_RAMP_M, feather: FEATHER_M },
  fine: { window: 20, passes: 2, ramp: 40, feather: 6 },
};

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
 * Resample a polyline at a uniform arc-length spacing (pixels), keeping both
 * ends. The profile smoothing window is counted in samples, so it must not
 * depend on how densely the way was drawn: curves rounded into 1 m arc
 * points (roadCurves.js) shrank the window to a few metres there and left
 * the road profile stepped.
 */
function resampleUniform(points, spacing) {
    if (points.length < 2) return points;
    const out = [points[0]];
    let carry = 0;
    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        const L = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        let s = spacing - carry;
        while (s < L) {
            out.push({ x: p1.x + ((p2.x - p1.x) * s) / L, y: p1.y + ((p2.y - p1.y) * s) / L });
            s += spacing;
        }
        carry = L - (s - spacing);
    }
    const last = points[points.length - 1];
    const tail = out[out.length - 1];
    if (Math.hypot(last.x - tail.x, last.y - tail.y) > spacing * 0.25) out.push(last);
    else out[out.length - 1] = last;
    return out;
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

/**
 * The same box average, over a length of road instead of a count of samples:
 * the mean of the profile (straight between its samples) from halfM before
 * each sample to halfM after it, the profile carried on past its ends by the
 * same reflection. Samples are not evenly spaced (every vertex of the road is
 * one, and a rounded corner has one every metre): averaged by count, a
 * sample 3 m from a junction was smoothed as if 5 m from it, and stood
 * 0.25 m off the grade its road arrived with, three passes over: a step
 * across the road beside every junction on a hill.
 */
function smoothProfileByLength(arr, cumLenM, halfM) {
    const n = arr.length;
    const L = cumLenM[n - 1];
    for (let i = 0; i < n; i++) if (arr[i] === NO_DATA_VALUE || !Number.isFinite(arr[i])) return null;
    if (!(L > 0)) return null;
    const half = Math.min(halfM, L);
    // the integral of the profile from its start to each sample
    const I = new Float64Array(n);
    for (let i = 1; i < n; i++) I[i] = I[i - 1] + (arr[i] + arr[i - 1]) / 2 * (cumLenM[i] - cumLenM[i - 1]);
    let k = 0;
    const within = (x) => {
        if (x <= 0) return 0;
        if (x >= L) return I[n - 1];
        while (k + 1 < n - 1 && cumLenM[k + 1] < x) k++;
        while (k > 0 && cumLenM[k] > x) k--;
        const ds = cumLenM[k + 1] - cumLenM[k];
        if (!(ds > 0)) return I[k];
        const d = x - cumLenM[k];
        const zx = arr[k] + (arr[k + 1] - arr[k]) * (d / ds);
        return I[k] + (arr[k] + zx) / 2 * d;
    };
    const integral = (x) => {
        if (x < 0) return 2 * arr[0] * x + within(-x);
        if (x > L) return 2 * arr[n - 1] * (x - L) + within(2 * L - x);
        return within(x);
    };
    const result = new Float32Array(n);
    for (let i = 0; i < n; i++) result[i] = (integral(cumLenM[i] + half) - integral(cumLenM[i] - half)) / (2 * half);
    return result;
}

export function isGroundLevelRoad(feature) {
    if (feature?.type !== 'road') return false;
    const tags = feature.tags || {};
    // Only carve terrain for something that will actually be a road. Footpaths
    // and trails are never drawn, so flattening them just terraces hillsides —
    // and they are the roughest corridors in the data, since they climb where
    // no vehicle road would.
    if (NON_DRIVEABLE_HIGHWAYS.has(tags.highway)) return false;
    const layer = Number.parseInt(tags.layer, 10) || 0;
    // Skip bridges, overpasses, tunnels, and elevated roads. Any bridge value
    // but "no" is a bridge (viaduct, cantilever, boardwalk, movable...), as the
    // structure solver reads it (structures/graph.js structureOf): an
    // elevated highway tagged bridge=viaduct with no layer was levelled as a
    // ground road. Tunnels as its tunnel builder (beamngTunnels.js
    // isBoredTunnelTag); a building passage or culvert stays on the ground.
    const bridge = (!!tags.bridge && tags.bridge !== 'no') || tags.man_made === 'bridge'
        || tags.location === 'elevated' || tags.location === 'overground';
    const tunnel = tags.tunnel === 'yes' || tags.tunnel === 'avalanche_protector'
        || tags.location === 'underground' || tags.location === 'underwater';
    if (layer > 0 || bridge || tunnel || tags.covered === 'yes') {
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
 * The width is the whole carriageway (parking lanes / shoulders included):
 * that is what the export paves.
 */
function corridorHalfWidthMeters(corridor, isUrbanRoad) {
    const members = Array.isArray(corridor.members) && corridor.members.length > 0
        ? corridor.members
        : [corridor];

    let half = 0;
    for (const member of members) {
        const tags = member?.tags || {};
        const highway = member?.highway || tags.highway || corridor.highway;
        const w = estimateRoadCrossSection(tags, highway, isOneWayRoad(tags), {
            urban: isUrbanRoad(corridor),
        }).carriagewayHalfWidth;
        if (Number.isFinite(w) && w > half) half = w;
    }
    return half > 0 ? half : 3.0;
}

/**
 * Build per-corridor elevation profiles: pixel-space sample points, original
 * and smoothed Z arrays, and cumulative arc length in metres.
 */
function buildCorridorProfiles(corridors, heightMap, width, height, project, metersPerPixel, bridgeNodes = new Set(), tuning = TUNING.coarse, tunnelNodes = new Set()) {
    const maxSegmentLengthPx = Math.max(1, SAMPLE_SPACING_M / metersPerPixel);
    const windowSamples = Math.max(3, Math.round(tuning.window / SAMPLE_SPACING_M));
    const profiles = [];

    for (const corridor of corridors) {
        const geom = corridor.geometry;
        if (!geom || geom.length < 2) continue;

        const rawPoints = geom.map((pt) => project(pt.lat, pt.lng));
        const points = resampleUniform(rawPoints, maxSegmentLengthPx);
        if (points.length < 2) continue;

        const zOrig = new Float32Array(points.length);
        for (let i = 0; i < points.length; i++) {
            zOrig[i] = sampleHeight(heightMap, width, height, points[i].x, points[i].y);
        }

        const cumLenM = new Float32Array(points.length);
        for (let i = 1; i < points.length; i++) {
            const dx = points[i].x - points[i - 1].x;
            const dy = points[i].y - points[i - 1].y;
            cumLenM[i] = cumLenM[i - 1] + Math.hypot(dx, dy) * metersPerPixel;
        }
        const baseKey = (key) => String(key).split('|')[0];
        const bridgeAtStart = bridgeNodes.has(baseKey(corridor.startKey));
        const bridgeAtEnd = bridgeNodes.has(baseKey(corridor.endKey));
        if (bridgeAtStart) holdGradeToBridge(zOrig, cumLenM, false);
        if (bridgeAtEnd) holdGradeToBridge(zOrig, cumLenM, true);
        // A road running into a tunnel: fine elevation shows what stands over the mouth as the ground (an
        // avalanche gallery's roof, a portal hood, the hillside over the bore), a step of several metres in
        // the road's last metres. liftOverCliffs then built a 10 % ramp up onto the roof and the tunnel
        // started 3.5 m too high (D 902 along Lac du Chevril: the road dipped and climbed back between its
        // galleries). The last metres follow the grade the road arrives with, as at a bridge.
        if (!bridgeAtStart && tunnelNodes.has(baseKey(corridor.startKey))) holdGradeToBridge(zOrig, cumLenM, false, true);
        if (!bridgeAtEnd && tunnelNodes.has(baseKey(corridor.endKey))) holdGradeToBridge(zOrig, cumLenM, true, true);

        liftOverCliffs(zOrig, cumLenM);

        let zSmooth = zOrig;
        // (as wide as the old window of samples was on evenly spaced ones)
        const halfWindowM = (Math.floor(windowSamples / 2) + 0.5) * SAMPLE_SPACING_M;
        for (let pass = 0; pass < tuning.passes; pass++) {
            zSmooth = smoothProfileByLength(zSmooth, cumLenM, halfWindowM) || smooth1DArray(zSmooth, windowSamples);
        }

        profiles.push({ corridor, points, zOrig, zSmooth, cumLenM, bridgeAtStart, bridgeAtEnd });
    }
    return profiles;
}

/**
 * In place: the samples within BRIDGE_END_TRIM_M of one end of a profile (the
 * end meeting a bridge) that stand off the grade fitted behind them, run
 * from the end inwards, laid on that grade.
 */
function holdGradeToBridge(z, cumLenM, atEnd, onlyAbove = false) {
    const n = z.length;
    const total = cumLenM[n - 1];
    const dist = (i) => (atEnd ? total - cumLenM[i] : cumLenM[i]);
    const fit = [];
    for (let i = 0; i < n; i++) {
        const d = dist(i);
        if (d >= BRIDGE_END_TRIM_M && d <= BRIDGE_END_TRIM_M + BRIDGE_END_FIT_M && z[i] !== NO_DATA_VALUE) fit.push([d, z[i]]);
    }
    if (fit.length < 4) return;
    // Theil-Sen: robust to a stretch of the fit still on the cliff
    const slopes = [];
    for (let i = 0; i < fit.length; i++) {
        for (let j = i + 1; j < fit.length; j++) slopes.push((fit[j][1] - fit[i][1]) / (fit[j][0] - fit[i][0]));
    }
    const median = (v) => { const q = [...v].sort((a, b) => a - b); return q[q.length >> 1]; };
    const slope = median(slopes);
    const at0 = median(fit.map(([d, v]) => v - slope * d));
    const order = atEnd ? Array.from({ length: n }, (_, k) => n - 1 - k) : Array.from({ length: n }, (_, k) => k);
    let replace = -1;   // index (in order) of the innermost sample to lay on the grade
    order.forEach((i, k) => {
        // (onlyAbove, at a tunnel: only ground standing over the grade is a roof; ground under it is a road
        // coming down into its tunnel, or a structure bare earth took out, which liftOverCliffs sees to)
        const off = z[i] === NO_DATA_VALUE ? Infinity : z[i] - (at0 + slope * dist(i));
        if (dist(i) <= BRIDGE_END_TRIM_M && (onlyAbove ? off > BRIDGE_END_TOL_M : Math.abs(off) > BRIDGE_END_TOL_M)) replace = k;
    });
    for (let k = 0; k <= replace; k++) z[order[k]] = at0 + slope * dist(order[k]);
}

/**
 * In place: at each step of more than CLIFF_M between neighbouring samples,
 * the low side raised to the grade CLIFF_GRADE down from the step's top,
 * outwards until the ground stands over that grade.
 */
function liftOverCliffs(z, cumLenM) {
    const n = z.length;
    for (let i = 0; i + 1 < n; i++) {
        if (z[i] === NO_DATA_VALUE || z[i + 1] === NO_DATA_VALUE) continue;
        const rise = z[i + 1] - z[i];
        if (Math.abs(rise) <= CLIFF_M) continue;
        // the ground's grade over CLIFF_SIDE_M before and after the step
        const sideGrade = (from, dir) => {
            let k = from;
            while (k + dir >= 0 && k + dir < n && z[k + dir] !== NO_DATA_VALUE && Math.abs(cumLenM[k + dir] - cumLenM[from]) <= CLIFF_SIDE_M) k += dir;
            const run = Math.abs(cumLenM[k] - cumLenM[from]);
            return run > 0 ? Math.abs(z[k] - z[from]) / run : 0;
        };
        if (sideGrade(i, -1) > CLIFF_SIDE_GRADE || sideGrade(i + 1, 1) > CLIFF_SIDE_GRADE) continue;
        const top = rise > 0 ? i + 1 : i;
        const step = rise > 0 ? -1 : 1;   // from the top down the low side
        const lifts = [];
        let tall = false;
        for (let k = top + step; k >= 0 && k < n; k += step) {
            if (z[k] === NO_DATA_VALUE) break;
            const want = z[top] - CLIFF_GRADE * Math.abs(cumLenM[top] - cumLenM[k]);
            if (z[k] >= want) break;
            if (want - z[k] > CLIFF_MAX_LIFT_M) { tall = true; break; }
            lifts.push([k, want]);
        }
        if (!tall) for (const [k, want] of lifts) z[k] = want;
    }
}

/**
 * Pin every corridor's profile to a single consensus elevation at each shared
 * junction node, tapering the correction over JUNCTION_RAMP_M. Without this,
 * each road arrives at an intersection with its own independently smoothed
 * height and the strongest-weight blend produces a vertical crease exactly at
 * the junction (OSM ways usually END at intersections, so the smoothing
 * window is one-sided there — maximizing the disagreement).
 */
function pinJunctionElevations(profiles, tuning = TUNING.coarse) {
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
        const ramp = Math.min(tuning.ramp, totalLen / 2);
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
 * Side roads at their through roads (see THROUGH_COS). In place: each side
 * arm's profile re-pinned to the through road's surface at the edge of its
 * lanes. Returns, per profile, how far from its start / end (metres along
 * it) its strip lies under a through road's lanes: { start, end }.
 */
function seatSideRoads(profiles, halfWidths, metersPerPixel, tuning) {
    const arms = new Map();
    profiles.forEach((p, k) => {
        const n = p.points.length;
        for (const atEnd of [false, true]) {
            const key = atEnd ? p.corridor.endKey : p.corridor.startKey;
            // (a loop meeting itself: left as it is)
            if (p.corridor.startKey === p.corridor.endKey) continue;
            const i0 = atEnd ? n - 1 : 0; const step = atEnd ? -1 : 1;
            let i = i0;
            while (i + step >= 0 && i + step < n && Math.abs(p.cumLenM[i] - p.cumLenM[i0]) < ARM_DIR_M) i += step;
            const dx = p.points[i].x - p.points[i0].x; const dy = p.points[i].y - p.points[i0].y; const l = Math.hypot(dx, dy);
            if (!(l > 0)) continue;
            const list = arms.get(key) || [];
            list.push({ k, atEnd, dx: dx / l, dy: dy / l });
            arms.set(key, list);
        }
    });
    const under = new Map();
    for (const list of arms.values()) {
        if (list.length < 3) continue;
        const through = new Set();
        for (let a = 0; a < list.length; a++) {
            for (let b = a + 1; b < list.length; b++) {
                if (list[a].dx * list[b].dx + list[a].dy * list[b].dy <= THROUGH_COS) { through.add(a); through.add(b); }
            }
        }
        if (through.size === 0 || through.size === list.length) continue;
        const mains = [...through].map((a) => list[a]);
        // the through road's surface under a point: [distance from its centre line (px), height, its half width (m)]
        const surfaceAt = (x, y) => {
            let best = null;
            for (const m of mains) {
                const p = profiles[m.k]; const n = p.points.length;
                const i0 = m.atEnd ? n - 1 : 0; const step = m.atEnd ? -1 : 1;
                for (let i = i0; i + step >= 0 && i + step < n && Math.abs(p.cumLenM[i] - p.cumLenM[i0]) < 80; i += step) {
                    const a = p.points[i]; const b = p.points[i + step];
                    const za = p.zSmooth[i]; const zb = p.zSmooth[i + step];
                    if (za === NO_DATA_VALUE || zb === NO_DATA_VALUE) continue;
                    const { t, dist } = pointLineProjection(x, y, a.x, a.y, b.x, b.y);
                    if (!best || dist < best[0]) best = [dist, za + t * (zb - za), halfWidths[m.k]];
                }
            }
            return best;
        };
        list.forEach((arm, a) => {
            if (through.has(a)) return;
            if (mains.some((m) => arm.dx * m.dx + arm.dy * m.dy >= FORK_COS)) return;
            const p = profiles[arm.k]; const { zSmooth, cumLenM, points } = p; const n = points.length;
            const i0 = arm.atEnd ? n - 1 : 0; const step = arm.atEnd ? -1 : 1;
            const from = (i) => Math.abs(cumLenM[i] - cumLenM[i0]);
            const total = cumLenM[n - 1];
            // the first station clear of the through road's lanes (never past the arm's middle)
            let edge = -1; let zEdge = 0;
            for (let i = i0 + step; i >= 0 && i < n && from(i) <= total / 2; i += step) {
                const s = surfaceAt(points[i].x, points[i].y);
                if (!s) break;
                if (s[0] * metersPerPixel >= s[2]) { edge = i; zEdge = s[1]; break; }
            }
            if (edge < 0 || zSmooth[edge] === NO_DATA_VALUE || zSmooth[i0] === NO_DATA_VALUE) return;
            const reach = from(edge);
            // beyond the edge: the correction tapered out; inside: the through road's surface under each station
            const delta = zEdge - zSmooth[edge];
            const ramp = Math.min(tuning.ramp, total / 2 - reach);
            for (let i = edge; i >= 0 && i < n; i += step) {
                const f = ramp > 0 ? 1 - (from(i) - reach) / ramp : (i === edge ? 1 : 0);
                if (f <= 0) break;
                if (zSmooth[i] !== NO_DATA_VALUE) zSmooth[i] += delta * f;
            }
            for (let i = i0 + step; i !== edge; i += step) {
                const s = surfaceAt(points[i].x, points[i].y);
                if (s && zSmooth[i] !== NO_DATA_VALUE) zSmooth[i] = s[1];
            }
            const u = under.get(arm.k) || { start: 0, end: 0 };
            if (arm.atEnd) u.end = reach; else u.start = reach;
            under.set(arm.k, u);
        });
    }
    return under;
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
 * Smoothing and leveling are one operation: the road surface is laid on the
 * smoothed centerline profile with a flat cross-section (no side-to-side
 * tilt), feathered back into the surrounding terrain. fetchTerrainData runs
 * it on every source: on global 30 m (and coarse GPXZ) terrain it hides the
 * stair-steps and lumps; on 1 m lidar, after snapRoadsToTerrain has moved the
 * roads onto their cut, it only evens out what is left. skipTracks keeps it
 * off unpaved tracks there — flattening them on real hillsides cut terraces.
 */
export function smoothRoadsInHeightmap(heightMap, width, height, bounds, osmFeatures, metersPerPixel, { skipTracks = false, fine = false, tuning: override = null } = {}) {
    const tuning = { ...(fine ? TUNING.fine : TUNING.coarse), ...(override || {}) };
    if (!osmFeatures || osmFeatures.length === 0) return;

    const groundRoads = osmFeatures.filter((f) => isGroundLevelRoad(f) && !(skipTracks && f.tags?.highway === 'track'));
    if (groundRoads.length === 0) return;

    const network = buildRoadNetwork(groundRoads);
    const corridors = mergeLinearRoadSegments(network.segments, network.intersections);
    if (corridors.length === 0) return;

    const project = createGridProjector(bounds, width, height);
    const isUrbanRoad = buildUrbanRoadClassifier(osmFeatures);
    // nodes where a ground road meets a bridge (or any raised way)
    const bridgeNodes = new Set();
    for (const f of osmFeatures) {
        if (f?.type !== 'road' || !Array.isArray(f.geometry) || isGroundLevelRoad(f) || NON_DRIVEABLE_HIGHWAYS.has(f.tags?.highway)) continue;
        const tags = f.tags || {};
        if (tags.tunnel === 'yes' || tags.covered === 'yes') continue;
        for (const p of f.geometry) bridgeNodes.add(makeRoadNodeKey(p));
    }
    // nodes where a ground road runs into a tunnel or an avalanche gallery
    // (fine elevation only: 30 m data has no roofs in it, only the hillside smeared over the mouth, and
    // a road held to its grade there was cut 20 m into it beside its bridges: D 87A at Tignes)
    const tunnelNodes = new Set();
    for (const f of (fine ? osmFeatures : [])) {
        if (f?.type !== 'road' || !Array.isArray(f.geometry) || NON_DRIVEABLE_HIGHWAYS.has(f.tags?.highway)) continue;
        const t = f.tags?.tunnel;
        if (t !== 'yes' && t !== 'avalanche_protector') continue;
        for (const p of [f.geometry[0], f.geometry[f.geometry.length - 1]]) tunnelNodes.add(makeRoadNodeKey(p));
    }
    const profiles = buildCorridorProfiles(corridors, heightMap, width, height, project, metersPerPixel, bridgeNodes, tuning, tunnelNodes);
    if (profiles.length === 0) return;

    pinJunctionElevations(profiles, tuning);
    const halfWidths = profiles.map((p) => corridorHalfWidthMeters(p.corridor, isUrbanRoad));
    const underThrough = seatSideRoads(profiles, halfWidths, metersPerPixel, tuning);

    // Global accumulators. roadZ is the target height, roadW the strongest
    // claim any corridor has on the pixel (quantized to 1/255 — the weight only
    // scales a blend, and a byte here keeps an 8192² map under 400 MB), and
    // roadCount how many near-tied claims were averaged into roadZ.
    const roadZ = new Float32Array(width * height);
    const roadW = new Uint8Array(width * height);
    const roadCount = new Uint8Array(width * height);
    let hasRoads = false;

    // Ends where another corridor meets this one (a junction, or the same road
    // carrying on with another lane count). There the end is not rounded: the
    // road's cross-section carries on past it and fades out. A flat round disc
    // at the end's height sat on the continuing road (which keeps climbing on a
    // slope) and tied with its core, and the averaged disc edge showed as a
    // ring at every junction.
    const endpointCounts = new Map();
    for (const p of profiles) for (const k of [p.corridor.startKey, p.corridor.endKey]) endpointCounts.set(k, (endpointCounts.get(k) || 0) + 1);

    for (let pk = 0; pk < profiles.length; pk++) {
        const profile = profiles[pk];
        const { corridor, points, zSmooth, cumLenM, bridgeAtStart, bridgeAtEnd } = profile;
        const side = underThrough.get(pk);
        const totalLenM = cumLenM[cumLenM.length - 1];
        const sharedStart = (endpointCounts.get(corridor.startKey) || 0) >= 2;
        const sharedEnd = (endpointCounts.get(corridor.endKey) || 0) >= 2;

        const radiusMeters = halfWidths[pk];
        // The core is flat. We add an extra margin for feathering back to the terrain.
        const radiusPx = Math.max(1, (radiusMeters + tuning.feather) / metersPerPixel);
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

        // The ground past a shared end (not one at a bridge: its approach keeps
        // its fill to the abutment) is
        // the first / last segment's alone, as its fading cap: the segments
        // behind it, within the strip's reach of the end, stop at the end's
        // line too. A road wider than its samples are apart (a trunk road's
        // 8 m half width, a sample every 5 m or less) laid its second
        // segment's round end past the junction at full weight and at that
        // segment's height, which tied with the road carrying on: a pad
        // across every junction of a wide road, 0.5 m off on a 12% hill.
        const nPts = points.length;
        const reachM = radiusMeters + tuning.feather;
        const endLine = (a, b) => { const dx = b.x - a.x; const dy = b.y - a.y; const l = Math.hypot(dx, dy) || 1; return { x: a.x, y: a.y, dx: dx / l, dy: dy / l }; };
        const startLine = sharedStart && !bridgeAtStart ? endLine(points[0], points[1]) : null;
        const finishLine = sharedEnd && !bridgeAtEnd ? endLine(points[nPts - 1], points[nPts - 2]) : null;

        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];
            const z1 = zSmooth[i];
            const behindStart = startLine && i > 0 && cumLenM[i] <= reachM ? startLine : null;
            const behindFinish = finishLine && i < nPts - 2 && totalLenM - cumLenM[i + 1] <= reachM ? finishLine : null;
            const z2 = zSmooth[i + 1];

            if (z1 === NO_DATA_VALUE || z2 === NO_DATA_VALUE) continue;
            hasRoads = true;
            // (a side road's stretch under its through road's lanes: a weak claim, and no carrying on past its end)
            const sideStart = !!side && side.start > 0; const sideEnd = !!side && side.end > 0;
            const weak = (sideStart && cumLenM[i + 1] <= side.start + 1e-3) || (sideEnd && totalLenM - cumLenM[i] <= side.end + 1e-3);

            const minX = Math.max(0, Math.floor(Math.min(p1.x, p2.x) - radiusPx));
            const maxX = Math.min(width - 1, Math.ceil(Math.max(p1.x, p2.x) + radiusPx));
            const minY = Math.max(0, Math.floor(Math.min(p1.y, p2.y) - radiusPx));
            const maxY = Math.min(height - 1, Math.ceil(Math.max(p1.y, p2.y) + radiusPx));

            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) {
                    const { t, dist } = pointLineProjection(x, y, p1.x, p1.y, p2.x, p2.y);
                    if (dist > radiusPx) continue;
                    if (behindStart && (x - behindStart.x) * behindStart.dx + (y - behindStart.y) * behindStart.dy < 0) continue;
                    if (behindFinish && (x - behindFinish.x) * behindFinish.dx + (y - behindFinish.y) * behindFinish.dy < 0) continue;
                    // (a road meeting a bridge ends square there: its rounded
                    // end reached on under the deck and lifted the road
                    // passing below toward the approach's height)
                    const first = i === 0, last = i === points.length - 2;
                    let inCap = false;
                    if ((first && (bridgeAtStart || sharedStart)) || (last && (bridgeAtEnd || sharedEnd))) {
                        const along = ((x - p1.x) * (p2.x - p1.x) + (y - p1.y) * (p2.y - p1.y)) / (((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2) || 1);
                        if ((bridgeAtStart && first && along < 0) || (bridgeAtEnd && last && along > 1)) continue;
                        inCap = (sharedStart && first && along < 0) || (sharedEnd && last && along > 1);
                        if (inCap && ((first && along < 0 && sideStart) || (last && along > 1 && sideEnd))) continue;
                    }

                    let w = 1.0;
                    if (inCap) {
                        // (past a shared end: the road's own cross-section, faded out
                        // over the feather by the distance past the end, so the claim
                        // carries on continuously from the road and never stands flat)
                        const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
                        const ex = first ? p1.x : p2.x, ey = first ? p1.y : p2.y;
                        const past = Math.abs((x - ex) * (p2.x - p1.x) + (y - ey) * (p2.y - p1.y)) / len;
                        const side = Math.abs((x - ex) * (p2.y - p1.y) - (y - ey) * (p2.x - p1.x)) / len;
                        const fadePx = Math.max(1, radiusPx - coreRadiusPx);
                        if (side > radiusPx || past >= fadePx) continue;
                        const across = side > coreRadiusPx ? 0.5 * (1 + Math.cos(Math.PI * (side - coreRadiusPx) / (radiusPx - coreRadiusPx))) : 1;
                        w = across * 0.5 * (1 + Math.cos(Math.PI * past / fadePx));
                    } else if (dist > coreRadiusPx) {
                        // Feather from 1.0 to 0.0 using cosine for a smooth curve
                        const f = (dist - coreRadiusPx) / (radiusPx - coreRadiusPx);
                        w = 0.5 * (1 + Math.cos(Math.PI * f));
                    }
                    if (weak) w *= SIDE_ARM_W;

                    const idx = y * width + x;
                    const prevW = wMap.get(idx) || 0;
                    if (w < prevW || (w === prevW && dist >= (dMap.get(idx) ?? Infinity))) continue;

                    // The flat target elevation is determined by the smoothed centerline
                    const zTarget = z1 + t * (z2 - z1);

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
            // (two road surfaces claiming the pixel at different heights: a
            // seam, which the seam blur below rounds off)
            const seam = best >= SEAM_MIN_W8 && wq >= SEAM_MIN_W8 && Math.abs(z - roadZ[idx]) > SEAM_MIN_DZ_M ? SEAM_FLAG : 0;

            if (wq > best + TIE_WEIGHT) {
                // Stronger claim: this corridor's surface covers the pixel, so it
                // replaces the weaker one outright. Averaging here is what let a
                // neighbouring road's embankment drag the core of the road that
                // actually owns the pixel — the highway lane next to a parallel
                // service road came out tilted by a fraction of their height gap.
                roadZ[idx] = z;
                roadW[idx] = wq;
                roadCount[idx] = 1 | seam | (roadCount[idx] & SEAM_FLAG);
            } else if (wq + TIE_WEIGHT >= best) {
                // Comparable claims — two corridors meeting at a junction, or two
                // embankments overlapping. Averaging them is what keeps crossing
                // corridors from creasing, so it stays for near-ties only.
                // (low 7 bits: how many claims were averaged; top bit: seam)
                const n = roadCount[idx] & COUNT_MASK;
                roadZ[idx] = (roadZ[idx] * n + z) / (n + 1);
                roadCount[idx] = Math.min(COUNT_MASK, n + 1) | seam | (roadCount[idx] & SEAM_FLAG);
                if (wq > best) roadW[idx] = wq;
            } else if (seam) {
                roadCount[idx] |= SEAM_FLAG;
            }
        }
    }

    if (!hasRoads) return;

    // Round off the steps where two claims of different heights meet (see
    // SEAM_BLUR_M), on the road surfaces only: each pixel counts by its road
    // weight^8, so a road's own surface counts far above a neighbour's
    // embankment, and only within SEAM_BLUR_RANGE_M of the pixel's height, so
    // real shelves stay. Only pixels near a marked seam
    // change (blurring a straight road's edge shifts it by a few cm on a
    // slope). Runs in place on roadZ.
    const r = Math.max(1, Math.round(SEAM_BLUR_M / metersPerPixel));
    seamBlurPass(roadZ, roadW, roadCount, width, height, r, 1, width, height, SEAM_FLAG, NEAR_SEAM);
    seamBlurPass(roadZ, roadW, roadCount, width, height, r, width, height, width, SEAM_FLAG | NEAR_SEAM, 0);

    // Blend the leveled roads back into the heightmap
    for (let i = 0; i < heightMap.length; i++) {
        const w = roadW[i] / 255;
        if (w > 0 && heightMap[i] !== NO_DATA_VALUE) {
            heightMap[i] = heightMap[i] * (1 - w) + roadZ[i] * w;
        }
    }
}

// One direction of the seam blur, in place on z along every line (step 1:
// rows, step width: columns). A triangle kernel of radius 2r; a neighbour
// counts by its road weight^8 (w8 in 1/255), and only while its height is
// within SEAM_BLUR_RANGE_M of this pixel's (fading out by twice that). A pixel
// changes only with a pixel flagged `near` within the kernel on its line, and
// gets `mark` set then (the row pass marks, the column pass reads both: a
// square around each seam).
const SEAM_WEIGHT = new Float64Array(256).map((_, b) => (b / 255) ** 8);
function seamBlurPass(z, w8, flags, width, height, r, step, lineLen, lines, near, mark) {
    const zl = new Float64Array(lineLen), wl = new Float64Array(lineLen);
    const lastNear = new Int32Array(lineLen), nextNear = new Int32Array(lineLen);
    const R = 2 * r, tau = SEAM_BLUR_RANGE_M;
    const lineStride = step === 1 ? width : 1;
    for (let l = 0; l < lines; l++) {
        const o = l * lineStride;
        let any = false, prev = -1e9;
        for (let k = 0; k < lineLen; k++) {
            const i = o + k * step;
            zl[k] = z[i]; wl[k] = SEAM_WEIGHT[w8[i]];
            if (flags[i] & near) { prev = k; any = true; }
            lastNear[k] = prev;
        }
        if (!any) continue;
        let next = 1e9;
        for (let k = lineLen - 1; k >= 0; k--) { if (flags[o + k * step] & near) next = k; nextNear[k] = next; }
        for (let k = 0; k < lineLen; k++) {
            if (!(wl[k] > 1e-6) || (k - lastNear[k] > R && nextNear[k] - k > R)) continue;
            const z0 = zl[k];
            let sw = 0, sz = 0;
            for (let d = -R; d <= R; d++) {
                const j = k + d;
                if (j < 0 || j >= lineLen) continue;
                const wj = wl[j];
                if (!(wj > 0)) continue;
                const dz = Math.abs(zl[j] - z0);
                if (dz >= 2 * tau) continue;
                const c = (R + 1 - Math.abs(d)) * wj * (dz <= tau ? 1 : 2 - dz / tau);
                sw += c; sz += c * zl[j];
            }
            const i = o + k * step;
            if (sw > 0) z[i] = sz / sw;
            if (mark) flags[i] |= mark;
        }
    }
}

