import { createGridProjector } from './geoUtils.js';
import { makeRoadNodeKey } from './roadNetwork.js';
import { buildUrbanRoadClassifier, estimateRoadCrossSection, isOneWayRoad } from './roadWidth.js';

/**
 * Slide OSM roads sideways onto the road cut in high-resolution elevation.
 *
 * 1 m lidar already holds the real road surface — a flat bench cut into the
 * hillside — but OSM often runs a few metres beside it, so a road drawn on
 * the OSM line rides up the bank on one side (Devils Tower's monument road:
 * 15 % side slope at p95 on the OSM line, 5.5 % once moved onto the bench).
 * Moving the road is much gentler than reshaping the terrain under it.
 *
 * Per road, every SAMPLE_M along it, the offset across the road whose
 * carriageway-wide cross-section is flattest wins, if it beats the OSM line
 * clearly. Offsets are median- then box-filtered along the road, fade to zero
 * near any node another way shares (junctions, bridge ends, crossings stay
 * put), and move the way's nodes. Point features sitting on a moved node
 * (signals, stop signs, speed bumps …) move with it.
 *
 * Only for rasters fine enough to show a road cut (≤ MAX_GRID_MPP). On coarse
 * data there is no bench to find, and snapping wanders (Glacier View's 10 m
 * DEM pulled roads 7 m into the hillside).
 */

const NO_DATA_VALUE = -99999;
const MAX_GRID_MPP = 2;
const SAMPLE_M = 2;
const SEARCH_M = 8;
const SEARCH_STEP_M = 0.5;
// Cost added per metre of shift, so the OSM line wins ties.
const DISTANCE_PENALTY = 0.05;
// A shift must lower the cross-section cost by this much (m) to count.
const MIN_GAIN_M = 0.3;
const MEDIAN_RADIUS_M = 14;
const BOX_RADIUS_M = 10;
const JUNCTION_TAPER_M = 30;
// Long segments get intermediate nodes this far apart when the offset varies
// along them, so the road follows the bench instead of cutting the chord.
const DENSIFY_SPACING_M = 10;
const MOVED_EPSILON_M = 0.05;
const NODE_POINT_TYPES = new Set(['street_furniture', 'traffic_calming']);

function sampleHeight(heightMap, width, height, x, y) {
    if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return NO_DATA_VALUE;
    const x0 = Math.min(width - 2, Math.floor(x));
    const y0 = Math.min(height - 2, Math.floor(y));
    const fx = x - x0;
    const fy = y - y0;
    const i = y0 * width + x0;
    const h00 = heightMap[i];
    const h10 = heightMap[i + 1];
    const h01 = heightMap[i + width];
    const h11 = heightMap[i + width + 1];
    if (h00 === NO_DATA_VALUE || h10 === NO_DATA_VALUE || h01 === NO_DATA_VALUE || h11 === NO_DATA_VALUE) return NO_DATA_VALUE;
    return (1 - fy) * ((1 - fx) * h00 + fx * h10) + fy * ((1 - fx) * h01 + fx * h11);
}

/**
 * Side-to-side unevenness (m) of a carriageway-wide cross-section centred d
 * pixels along the normal: end-to-end height difference plus twice the worst
 * deviation from the straight chord (a bank or ditch inside the road).
 */
function crossSectionCost(heightMap, width, height, x, y, nx, ny, halfPx, d) {
    const n = Math.max(2, Math.round(2 * halfPx));
    let first = 0;
    let last = 0;
    const hs = new Array(n + 1);
    for (let k = 0; k <= n; k++) {
        const t = d - halfPx + (2 * halfPx * k) / n;
        const h = sampleHeight(heightMap, width, height, x + nx * t, y + ny * t);
        if (h === NO_DATA_VALUE) return Infinity;
        hs[k] = h;
    }
    first = hs[0];
    last = hs[n];
    let dev = 0;
    for (let k = 1; k < n; k++) {
        dev = Math.max(dev, Math.abs(hs[k] - (first + ((last - first) * k) / n)));
    }
    return Math.abs(last - first) + 2 * dev;
}

function medianFilter(values, radius) {
    return values.map((_, i) => {
        const w = values.slice(Math.max(0, i - radius), i + radius + 1).sort((a, b) => a - b);
        return w[w.length >> 1];
    });
}

function boxFilter(values, radius) {
    return values.map((_, i) => {
        let sum = 0;
        let n = 0;
        for (let j = Math.max(0, i - radius); j <= Math.min(values.length - 1, i + radius); j++) { sum += values[j]; n++; }
        return sum / n;
    });
}

/**
 * @param {Float32Array} heightMap
 * @param {number} width
 * @param {number} height
 * @param {{north:number,south:number,east:number,west:number}} bounds
 * @param {Array} osmFeatures
 * @param {number} metersPerPixel
 * @param {(feature) => boolean} isSnappableRoad  roads to move (ground-level, drawn)
 * @returns {{ features: Array, stats: { roads: number, movedRoads: number, movedShare: number, p90OffsetM: number } }}
 */
export function snapRoadsToTerrain(heightMap, width, height, bounds, osmFeatures, metersPerPixel, isSnappableRoad) {
    const stats = { roads: 0, movedRoads: 0, movedShare: 0, p90OffsetM: 0 };
    if (!osmFeatures?.length || !(metersPerPixel > 0) || metersPerPixel > MAX_GRID_MPP) return { features: osmFeatures, stats };

    const project = createGridProjector(bounds, width, height);
    const unproject = (x, y) => ({
        lng: bounds.west + (x / (width - 1)) * (bounds.east - bounds.west),
        lat: bounds.north - (y / (height - 1)) * (bounds.north - bounds.south),
    });
    const isUrbanRoad = buildUrbanRoadClassifier(osmFeatures);

    // Nodes used by more than one way (of any kind) stay where they are.
    const nodeUse = new Map();
    for (const f of osmFeatures) {
        if (f?.type !== 'road' || !Array.isArray(f.geometry)) continue;
        for (const p of f.geometry) {
            const k = makeRoadNodeKey(p);
            nodeUse.set(k, (nodeUse.get(k) || 0) + 1);
        }
    }

    const samplePx = SAMPLE_M / metersPerPixel;
    const searchPx = SEARCH_M / metersPerPixel;
    const stepPx = SEARCH_STEP_M / metersPerPixel;
    const medianR = Math.max(1, Math.round(MEDIAN_RADIUS_M / SAMPLE_M));
    const boxR = Math.max(1, Math.round(BOX_RADIUS_M / SAMPLE_M));
    const taperPx = JUNCTION_TAPER_M / metersPerPixel;

    const movedNodes = new Map();
    const allOffsets = [];
    const out = osmFeatures.map((f) => {
        if (!isSnappableRoad(f)) return f;
        stats.roads++;
        const tags = f.tags || {};
        const halfM = estimateRoadCrossSection(tags, tags.highway, isOneWayRoad(tags), { urban: isUrbanRoad(f) }).carriagewayHalfWidth;
        const halfPx = Math.max(2, halfM) / metersPerPixel;

        const pts = f.geometry.map((p) => project(p.lat, p.lng));
        const arcs = [0];
        for (let i = 1; i < pts.length; i++) arcs.push(arcs[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
        const total = arcs[arcs.length - 1];
        if (total < 4 * samplePx) return f;

        // Samples along the way, with normals from a ±3-sample chord.
        const sampleCount = Math.floor(total / samplePx) + 1;
        const S = [];
        let seg = 0;
        for (let k = 0; k < sampleCount; k++) {
            const s = Math.min(total, k * samplePx);
            while (seg < pts.length - 2 && arcs[seg + 1] < s) seg++;
            const L = arcs[seg + 1] - arcs[seg] || 1;
            const t = (s - arcs[seg]) / L;
            S.push({ x: pts[seg].x + (pts[seg + 1].x - pts[seg].x) * t, y: pts[seg].y + (pts[seg + 1].y - pts[seg].y) * t, s });
        }
        for (let k = 0; k < S.length; k++) {
            const a = S[Math.max(0, k - 3)];
            const b = S[Math.min(S.length - 1, k + 3)];
            const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            S[k].nx = -(b.y - a.y) / L;
            S[k].ny = (b.x - a.x) / L;
        }

        let off = S.map(({ x, y, nx, ny }) => {
            const c0 = crossSectionCost(heightMap, width, height, x, y, nx, ny, halfPx, 0);
            if (!Number.isFinite(c0)) return 0;
            let best = 0;
            let bestCost = c0;
            for (let d = -searchPx; d <= searchPx + 1e-9; d += stepPx) {
                const c = crossSectionCost(heightMap, width, height, x, y, nx, ny, halfPx, d) + DISTANCE_PENALTY * Math.abs(d) * metersPerPixel;
                if (c < bestCost) { bestCost = c; best = d; }
            }
            return c0 - bestCost > MIN_GAIN_M ? best : 0;
        });
        off = boxFilter(boxFilter(medianFilter(off, medianR), boxR), boxR);

        // Fade to zero towards shared nodes.
        const sharedArcs = [];
        f.geometry.forEach((p, i) => { if ((nodeUse.get(makeRoadNodeKey(p)) || 0) > 1) sharedArcs.push(arcs[i]); });
        if (sharedArcs.length > 0) {
            off = off.map((o, k) => {
                let dist = Infinity;
                for (const a of sharedArcs) dist = Math.min(dist, Math.abs(S[k].s - a));
                return o * Math.min(1, dist / taperPx);
            });
        }
        let maxAbs = 0;
        for (const o of off) { allOffsets.push(Math.abs(o) * metersPerPixel); maxAbs = Math.max(maxAbs, Math.abs(o)); }
        if (maxAbs * metersPerPixel < MOVED_EPSILON_M) return f;

        const offsetAt = (s) => {
            const k = s / samplePx;
            const k0 = Math.min(off.length - 1, Math.floor(k));
            const k1 = Math.min(off.length - 1, k0 + 1);
            return off[k0] + (off[k1] - off[k0]) * (k - k0);
        };
        const shift = (x, y, nx, ny, o) => unproject(x + nx * o, y + ny * o);

        const geometry = [];
        for (let i = 0; i < pts.length; i++) {
            const a = pts[Math.max(0, i - 1)];
            const b = pts[Math.min(pts.length - 1, i + 1)];
            const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            const o = offsetAt(arcs[i]);
            const node = f.geometry[i];
            if (Math.abs(o) * metersPerPixel < MOVED_EPSILON_M) {
                geometry.push(node);
            } else {
                const moved = { ...node, ...shift(pts[i].x, pts[i].y, -(b.y - a.y) / L, (b.x - a.x) / L, o) };
                geometry.push(moved);
                movedNodes.set(makeRoadNodeKey(node), moved);
            }
            if (i === pts.length - 1) break;
            // Intermediate nodes on long segments whose offset varies.
            const segLen = arcs[i + 1] - arcs[i];
            const spacing = DENSIFY_SPACING_M / metersPerPixel;
            if (segLen <= 2 * spacing) continue;
            const o1 = offsetAt(arcs[i + 1]);
            let varies = false;
            for (let s = arcs[i] + spacing; s < arcs[i + 1]; s += spacing) {
                if (Math.abs(offsetAt(s) - (o + ((o1 - o) * (s - arcs[i])) / segLen)) * metersPerPixel > 0.5) { varies = true; break; }
            }
            if (!varies) continue;
            const ux = (pts[i + 1].x - pts[i].x) / segLen;
            const uy = (pts[i + 1].y - pts[i].y) / segLen;
            const n = Math.floor(segLen / spacing);
            for (let j = 1; j < n; j++) {
                const s = arcs[i] + (segLen * j) / n;
                const x = pts[i].x + ux * (s - arcs[i]);
                const y = pts[i].y + uy * (s - arcs[i]);
                geometry.push(shift(x, y, -uy, ux, offsetAt(s)));
            }
        }
        stats.movedRoads++;
        return { ...f, geometry };
    });

    if (movedNodes.size > 0) {
        for (let i = 0; i < out.length; i++) {
            const f = out[i];
            if (!NODE_POINT_TYPES.has(f?.type) || f.geometry?.length !== 1) continue;
            const moved = movedNodes.get(makeRoadNodeKey(f.geometry[0]));
            if (moved) out[i] = { ...f, geometry: [{ ...f.geometry[0], lat: moved.lat, lng: moved.lng }] };
        }
    }

    allOffsets.sort((a, b) => a - b);
    stats.movedShare = allOffsets.length ? allOffsets.filter((o) => o > 0.5).length / allOffsets.length : 0;
    stats.p90OffsetM = allOffsets.length ? allOffsets[Math.floor(allOffsets.length * 0.9)] : 0;
    return { features: out, stats };
}
