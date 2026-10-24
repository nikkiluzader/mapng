import { makeRoadNodeKey } from './roadNetwork.js';
import { NON_DRIVEABLE_HIGHWAYS } from './roadWidth.js';

/**
 * Round the corners of OSM roads into tangent arcs.
 *
 * OSM draws a curve as a polyline; mappers often put one vertex at a bend.
 * The BeamNG export lays its DecalRoad nodes every 2 m along that polyline,
 * which pins the engine's spline to the straight chords, so every bend
 * rendered as a visible corner. Real roads are tangent–arc–tangent: each
 * interior vertex here becomes a circular arc tangent to both segments, as
 * wide as its road class allows without passing more than MAX_CUT_M inside
 * the mapped vertex, shrunk to fit when the neighbouring segments are short (a densely mapped curve then becomes a
 * chain of arcs meeting at segment midpoints — smooth, and still within a
 * fraction of a metre of the mapped vertices).
 *
 * Where exactly two roads meet end to end (OSM splits ways mid-bend at every
 * tag change) the bend is rounded across both, and the shared node moves to
 * the middle of the arc so they still meet. Real junctions (three or more
 * ways, or a way passing through) and dead ends stay exactly where they are;
 * a road still bends smoothly through such a node, just without cutting
 * inside it.
 * A point feature (signal, stop sign, speed bump) on a rounded vertex moves
 * to the middle of its arc.
 *
 * Runs once on the OSM features at generation time, so the terrain leveler,
 * terrain textures, 3D preview and the export all follow the same curve.
 */

// Largest curve radius (m) per highway class — generous design radii. Gentle vertices on sparsely mapped roads stand for long sweeping
// curves, so they get up to this; MAX_CUT_M keeps sharp corners tight.
const RADIUS_BY_HIGHWAY = {
    motorway: 800, trunk: 600, primary: 400, secondary: 300, tertiary: 200,
    motorway_link: 120, trunk_link: 120, primary_link: 100, secondary_link: 100, tertiary_link: 80,
    unclassified: 120, residential: 80, road: 80, living_street: 30, service: 30, track: 60,
    busway: 80, raceway: 120,
};
const DEFAULT_RADIUS_M = 80;
// An arc may pass at most this far inside its mapped vertex — under half a
// road's width, so the drawn road still covers where OSM put the bend.
const MAX_CUT_M = 3;
// Arcs may use at most this share of each neighbouring segment, so two
// rounded vertices never overlap and a long segment keeps its straight.
const MAX_SEGMENT_SHARE = 0.5;
const FIXED_SEGMENT_SHARE = 0.9;
// Turns gentler than this stay as they are.
const MIN_TURN_RAD = (1 * Math.PI) / 180;
// Hairpins past this are degenerate data, left to the export's spike filter.
const MAX_TURN_RAD = (170 * Math.PI) / 180;
// Arc sampling: at most this angle and this chord length per step.
const ARC_STEP_RAD = (5 * Math.PI) / 180;
const ARC_STEP_M = 1;
const NODE_POINT_TYPES = new Set(['street_furniture', 'traffic_calming']);

const isRoundableRoad = (f) => f?.type === 'road'
    && Array.isArray(f.geometry) && f.geometry.length >= 2
    && f.tags?.highway && !NON_DRIVEABLE_HIGHWAYS.has(f.tags.highway)
    && f.tags.area !== 'yes';

/**
 * Tangent arc replacing the corner a → b → c, as lat/lng points from the
 * point on ab to the point on bc, or null when the corner is too gentle,
 * degenerate, or a hairpin (left to the export's spike filter).
 */
function filletArc(a, b, c, radius, shareIn, shareOut, pinned = false) {
    const mx = 111320 * Math.cos((b.lat * Math.PI) / 180);
    const my = 111320;
    const ax = (a.lng - b.lng) * mx;
    const ay = (a.lat - b.lat) * my;
    const cx0 = (c.lng - b.lng) * mx;
    const cy0 = (c.lat - b.lat) * my;
    const lenIn = Math.hypot(ax, ay);
    const lenOut = Math.hypot(cx0, cy0);
    if (lenIn < 1e-6 || lenOut < 1e-6) return null;
    const ux = -ax / lenIn;
    const uy = -ay / lenIn;
    const vx = cx0 / lenOut;
    const vy = cy0 / lenOut;
    const turn = Math.acos(Math.max(-1, Math.min(1, ux * vx + uy * vy)));
    if (turn < MIN_TURN_RAD || turn > MAX_TURN_RAD) return null;

    const half = Math.tan(turn / 2);
    // Distance from vertex to arc middle is r·(1/cos(turn/2) − 1).
    const cutLimited = MAX_CUT_M / (1 / Math.cos(turn / 2) - 1);
    const tangent = Math.min(Math.min(radius, cutLimited) * half, shareIn * lenIn, shareOut * lenOut);
    if (pinned) return throughCurve(b, ux, uy, vx, vy, tangent, turn, mx, my);
    const r = tangent / half;
    const sx = -ux * tangent;
    const sy = -uy * tangent;
    // Centre on the inside of the turn, r from the arc's start.
    const side = Math.sign(ux * vy - uy * vx) || 1;
    const ox = sx - uy * r * side;
    const oy = sy + ux * r * side;
    const a0 = Math.atan2(sy - oy, sx - ox);
    const steps = Math.max(2, Math.ceil(Math.max(turn / ARC_STEP_RAD, (r * turn) / ARC_STEP_M)));
    const arc = [];
    for (let k = 0; k <= steps; k++) {
        let x;
        let y;
        if (k === 0) { x = sx; y = sy; } else if (k === steps) { x = vx * tangent; y = vy * tangent; } else {
            const ang = a0 + side * turn * (k / steps);
            x = ox + r * Math.cos(ang);
            y = oy + r * Math.sin(ang);
        }
        arc.push({ lat: b.lat + y / my, lng: b.lng + x / mx });
    }
    return arc;
}

/**
 * Smooth curve through a vertex another way is attached to (a driveway, a
 * footpath crossing): two cubic Hermite pieces from the tangent points to b,
 * leaving b along the bisector, so the shared node stays put and the road
 * still bends without a corner.
 */
function throughCurve(b, ux, uy, vx, vy, tangent, turn, mx, my) {
    let wx = ux + vx;
    let wy = uy + vy;
    const wl = Math.hypot(wx, wy) || 1;
    wx /= wl;
    wy /= wl;
    const steps = Math.max(2, Math.ceil(Math.max(turn / 2 / ARC_STEP_RAD, tangent / ARC_STEP_M)));
    const hermite = (p0x, p0y, m0x, m0y, p1x, p1y, m1x, m1y, s) => {
        const s2 = s * s;
        const s3 = s2 * s;
        const h00 = 2 * s3 - 3 * s2 + 1;
        const h10 = s3 - 2 * s2 + s;
        const h01 = -2 * s3 + 3 * s2;
        const h11 = s3 - s2;
        return [h00 * p0x + h10 * m0x + h01 * p1x + h11 * m1x, h00 * p0y + h10 * m0y + h01 * p1y + h11 * m1y];
    };
    const pts = [];
    for (let k = 0; k <= steps; k++) {
        pts.push(hermite(-ux * tangent, -uy * tangent, ux * tangent, uy * tangent, 0, 0, wx * tangent, wy * tangent, k / steps));
    }
    for (let k = 1; k <= steps; k++) {
        pts.push(hermite(0, 0, wx * tangent, wy * tangent, vx * tangent, vy * tangent, vx * tangent, vy * tangent, k / steps));
    }
    return pts.map(([x, y], k) => (k === steps ? b : { lat: b.lat + y / my, lng: b.lng + x / mx }));
}

/**
 * @param {Array} osmFeatures
 * @returns {{ features: Array, stats: { roads: number, roundedVertices: number, roundedJoins: number } }}
 */
export function roundRoadCorners(osmFeatures) {
    const stats = { roads: 0, roundedVertices: 0, roundedJoins: 0 };
    if (!Array.isArray(osmFeatures) || osmFeatures.length === 0) return { features: osmFeatures, stats };

    const nodeUse = new Map();
    const endUse = new Map();
    osmFeatures.forEach((f, fi) => {
        if (f?.type !== 'road' || !Array.isArray(f.geometry)) return;
        const g = f.geometry;
        g.forEach((p, i) => {
            const k = makeRoadNodeKey(p);
            nodeUse.set(k, (nodeUse.get(k) || 0) + 1);
            if (i === 0 || i === g.length - 1) {
                if (!endUse.has(k)) endUse.set(k, []);
                endUse.get(k).push({ fi, atStart: i === 0 });
            }
        });
    });
    const radiusOf = (f) => RADIUS_BY_HIGHWAY[f.tags.highway] ?? DEFAULT_RADIUS_M;

    // Pass-through joins: two different roundable ways ending at a node nothing
    // else touches.
    const joinOf = new Map();
    for (const [k, ends] of endUse) {
        if (ends.length !== 2 || nodeUse.get(k) !== 2 || ends[0].fi === ends[1].fi) continue;
        if (!ends.every((e) => isRoundableRoad(osmFeatures[e.fi]))) continue;
        joinOf.set(k, ends);
    }
    // A vertex keeps its position when it is a junction, a dead end or
    // anything shared.
    const isFixed = (p, isEnd) => {
        const k = makeRoadNodeKey(p);
        if (joinOf.has(k)) return false;
        return isEnd || (nodeUse.get(k) || 0) > 1;
    };
    // A segment is split between its two ends when both get a curve; an end
    // that stays as it is (dead end, junction, straight-through vertex) leaves
    // most of it to the other.
    const turnAt = (a, b, c) => {
        const mx = Math.cos((b.lat * Math.PI) / 180);
        const ux = (b.lng - a.lng) * mx; const uy = b.lat - a.lat;
        const vx = (c.lng - b.lng) * mx; const vy = c.lat - b.lat;
        const l = Math.hypot(ux, uy) * Math.hypot(vx, vy);
        return l > 0 ? Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / l))) : 0;
    };
    const curves = (g, j) => {
        if (j === 0 || j === g.length - 1) return joinOf.has(makeRoadNodeKey(g[j]));
        const t = turnAt(g[j - 1], g[j], g[j + 1]);
        return t >= MIN_TURN_RAD && t <= MAX_TURN_RAD;
    };
    const shareFor = (g, j) => (curves(g, j) ? MAX_SEGMENT_SHARE : FIXED_SEGMENT_SHARE);

    // Arc halves per join: the way ending there gets the half on its side.
    const joinHalves = new Map(); // `${fi}:${atStart}` -> points ordered away from the way's interior
    const movedNodes = new Map();
    for (const [k, [e1, e2]] of joinOf) {
        const g1 = osmFeatures[e1.fi].geometry;
        const g2 = osmFeatures[e2.fi].geometry;
        const j1 = e1.atStart ? 1 : g1.length - 2;
        const j2 = e2.atStart ? 1 : g2.length - 2;
        const node = e1.atStart ? g1[0] : g1[g1.length - 1];
        const radius = Math.min(radiusOf(osmFeatures[e1.fi]), radiusOf(osmFeatures[e2.fi]));
        const arc = filletArc(g1[j1], node, g2[j2], radius, shareFor(g1, j1), shareFor(g2, j2));
        if (!arc) continue;
        const m = arc.length >> 1;
        joinHalves.set(`${e1.fi}:${e1.atStart}`, arc.slice(0, m + 1));
        joinHalves.set(`${e2.fi}:${e2.atStart}`, arc.slice(m).reverse());
        movedNodes.set(k, arc[m]);
        stats.roundedJoins++;
    }

    const out = osmFeatures.map((f, fi) => {
        if (!isRoundableRoad(f)) return f;
        stats.roads++;
        const g = f.geometry;
        const radius = radiusOf(f);
        const geometry = [];
        let changed = false;
        // Neighbouring arcs meet at segment midpoints; keep that point once.
        const push = (...pts) => {
            for (const p of pts) {
                const last = geometry[geometry.length - 1];
                if (last && Math.abs(last.lat - p.lat) < 1e-7 && Math.abs(last.lng - p.lng) < 1e-7) continue;
                geometry.push(p);
            }
        };

        const startHalf = joinHalves.get(`${fi}:true`);
        if (startHalf) { push(...[...startHalf].reverse()); changed = true; } else push(g[0]);
        for (let i = 1; i < g.length - 1; i++) {
            const pinned = isFixed(g[i], false);
            const arc = filletArc(g[i - 1], g[i], g[i + 1], radius, shareFor(g, i - 1), shareFor(g, i + 1), pinned);
            if (!arc) { push(g[i]); continue; }
            push(...arc);
            if (!pinned) movedNodes.set(makeRoadNodeKey(g[i]), arc[arc.length >> 1]);
            stats.roundedVertices++;
            changed = true;
        }
        const endHalf = joinHalves.get(`${fi}:false`);
        if (endHalf) { push(...endHalf); changed = true; } else push(g[g.length - 1]);
        return changed ? { ...f, geometry } : f;
    });

    if (movedNodes.size > 0) {
        for (let i = 0; i < out.length; i++) {
            const f = out[i];
            if (!NODE_POINT_TYPES.has(f?.type) || f.geometry?.length !== 1) continue;
            const moved = movedNodes.get(makeRoadNodeKey(f.geometry[0]));
            if (moved) out[i] = { ...f, geometry: [{ ...f.geometry[0], ...moved }] };
        }
    }
    return { features: out, stats };
}
