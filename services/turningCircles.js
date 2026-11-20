// Cul-de-sacs: OpenStreetMap's highway=turning_circle (a widened round end of a street) and highway=turning_loop (a
// ring of road round an island) at a street's dead end, built as a bulb of the street's own surface.
//
// Each one is a ring carriageway round the mapped node: its centre line a circle at half the radius and as wide as the
// radius, so the road covers the whole disc (a loop: the ring between its island and the outer edge). It runs
// counter-clockwise, so its right-hand side is the outer edge: a street with sidewalks gets one round the bulb there,
// and the curb follows it. It belongs to no route: no markings, no traffic, no signs. The ground under it is graded to
// a plane through the street's end at the street's own grade along it, level across, blended back to the ground.
import { fastHypot } from './fastMath.js';
import { buildCarriagewayIndex, isOnOtherCarriageway } from './roadMarkingCuts.js';

export const TC_MIN_R = 8;            // a bulb's radius to its curb, unless OSM gives a diameter ...
export const TC_MAX_R = 13;           // ... and never more than this (US subdivisions: 12-15 m to the curb)
export const TC_PER_HALF = 2.2;       // ... else this many times the street's half width (a 9 m street: 9.9 m)
export const TC_END_REACH_M = 6;      // the mapped node this near a street's end
export const TC_GRADE_MAX = 0.08;     // the bulb's grade along the street at most
export const TC_GRADE_BACK_M = 12;    // the street's grade read over this much before its end
export const TC_STEP_M = 1.5;         // ring nodes this far apart along its centre line
export const TC_BLEND_MIN_M = 2;      // the ground blended back over at least this ...
export const TC_BLEND_MAX_M = 12;     // ... and at most this
export const TC_BLEND_PER_M = 2;      // ... two metres for every metre of difference (a 1:2 side slope)
export const LOOP_ROAD_M = 6.5;       // a turning loop's road ring this wide
export const LOOP_ISLAND_MIN_M = 3;   // ... round an island at least this radius

// streets a cul-de-sac is built on (not tracks, paths or motorways)
const STREET_CLASSES = new Set(['residential', 'unclassified', 'service', 'living_street', 'tertiary', 'tertiary_link', 'secondary', 'road']);

/** The bulb's radius to the curb: OSM's diameter where given, else from the street's half width. */
export function turningCircleRadius(tags, half) {
  const d = parseFloat(String(tags?.diameter ?? '').replace(',', '.'));
  if (Number.isFinite(d) && d >= 8 && d <= 60) return d / 2;
  return Math.max(TC_MIN_R, Math.min(TC_MAX_R, (half || 3) * TC_PER_HALF));
}

/**
 * Plan the cul-de-sacs. points: [{ id, x, y, tags }] (the mapped nodes in world metres); carriageways: the drawn
 * ground carriageways ({ owner, nodes: [[x, y, z, half]...], half, highway, bridge, tunnel, tags }).
 * Returns [{ id, c: [x, y], r, ri, z0, grade, dir: [dx, dy], street, loop }], one per node at a street's dead end.
 */
export function planTurningCircles(points, carriageways) {
  if (!points?.length) return [];
  const streets = carriageways.filter((cw) => !cw.bridge && !cw.tunnel && !cw.turningCircle && cw.nodes?.length > 1 && STREET_CLASSES.has(cw.highway));
  // every carriageway, to tell a dead end from one that meets another road (ending there or passing)
  const index = buildCarriagewayIndex(carriageways.filter((cw) => cw.nodes?.length > 1 && !cw.turningCircle));
  const out = [];
  const taken = new Set();
  for (const p of points) {
    let best = null;
    for (const cw of streets) {
      for (const at of [0, cw.nodes.length - 1]) {
        const q = cw.nodes[at];
        const d = fastHypot(q[0] - p.x, q[1] - p.y);
        if (d <= TC_END_REACH_M && (!best || d < best.d)) best = { cw, at, d };
      }
    }
    if (!best) continue;
    const key = `${best.cw.owner}:${best.at}`;
    if (taken.has(key)) continue;
    const { cw, at } = best;
    const end = cw.nodes[at];
    // (a dead end: no other carriageway ends or passes at that end)
    if (isOnOtherCarriageway(index, end[0], end[1], 0.5, (o) => o === cw.owner)) continue;
    // the street's direction into the bulb and its grade over its last metres
    const step = at === 0 ? 1 : -1;
    let k = at; let s = 0;
    while (k + step >= 0 && k + step < cw.nodes.length && s < TC_GRADE_BACK_M) {
      s += fastHypot(cw.nodes[k + step][0] - cw.nodes[k][0], cw.nodes[k + step][1] - cw.nodes[k][1]);
      k += step;
    }
    const back = cw.nodes[k];
    const L = fastHypot(end[0] - back[0], end[1] - back[1]);
    if (L < 1) continue;
    const dir = [(end[0] - back[0]) / L, (end[1] - back[1]) / L];
    const grade = Math.max(-TC_GRADE_MAX, Math.min(TC_GRADE_MAX, (end[2] - back[2]) / L));
    const half = Array.isArray(cw.halfAt) ? cw.halfAt[at] : cw.half;
    const r = Math.max(turningCircleRadius(p.tags, half), (half || 3) + 2);
    const loop = p.tags?.highway === 'turning_loop';
    const ri = loop ? Math.max(LOOP_ISLAND_MIN_M, r - LOOP_ROAD_M) : 0;
    taken.add(key);
    out.push({ id: p.id, c: [end[0], end[1]], r, ri, z0: end[2], grade, dir, street: cw, loop });
  }
  return out;
}

/** The bulb's surface height at (x, y): a plane through the street's end at its grade along it, level across. */
export const bulbHeight = (tc, x, y) => tc.z0 + tc.grade * ((x - tc.c[0]) * tc.dir[0] + (y - tc.c[1]) * tc.dir[1]);

/**
 * The ring carriageway for a planned cul-de-sac: counter-clockwise (its right side the outer edge), starting and
 * ending at the street's mouth, closed. Nodes [x, y, z, half].
 */
export const TC_WALK_LOOK_M = 15;    // a mapped sidewalk this far past the curb: the bulb's own sidewalk left to it
export function turningCircleCarriageway(tc, { mappedWalks = [] } = {}) {
  const rc = (tc.r + tc.ri) / 2; const half = (tc.r - tc.ri) / 2;
  const n = Math.max(12, Math.ceil((2 * Math.PI * rc) / TC_STEP_M));
  const a0 = Math.atan2(-tc.dir[1], -tc.dir[0]);
  const nodes = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (2 * Math.PI * i) / n;
    const x = tc.c[0] + Math.cos(a) * rc; const y = tc.c[1] + Math.sin(a) * rc;
    nodes.push([x, y, bulbHeight(tc, x, y), half]);
  }
  const street = tc.street;
  // (sidewalks round it where the street has them: on its right, the outer edge; never on the island side)
  const streetSidewalk = String(street.tags?.sidewalk ?? '').toLowerCase();
  // (... and none of its own where a sidewalk is mapped round the bulb (footway=sidewalk): the mapped one is laid,
  // the strip between it and the curb closed as for any street; both, they met in a jagged blob at the mouth)
  const look = tc.r + TC_WALK_LOOK_M;
  const mapped = mappedWalks.some((line) => line.some((q) => fastHypot(q[0] - tc.c[0], q[1] - tc.c[1]) <= look));
  const noWalk = mapped || ['no', 'none', 'separate'].includes(streetSidewalk);
  const tags = { ...(street.tags || {}), oneway: 'yes', sidewalk: noWalk ? 'no' : 'right', 'turning_circle:mapng': 'yes' };
  delete tags['sidewalk:left']; delete tags['sidewalk:right']; delete tags['sidewalk:both']; delete tags.lanes; delete tags.name;
  return {
    owner: `tc:${tc.id}`, nodes, half, highway: street.highway, tags, urban: street.urban, curbed: street.curbed,
    wayId: `tc:${tc.id}`, oneWay: true, bridge: false, carried: false, tunnel: false, leftExtra: 0, rightExtra: 0,
    turningCircle: true, mappedWalk: mapped, continuations: [],
  };
}

/**
 * The bulb's surface as one decal's nodes [x, y, z, width]: laid along the street's axis through the centre, each
 * node as wide as the circle there (a chord), so the decal fills the disc with the street's own texture running the
 * street's way and fades only at the curb, as a road's edge does. (A decal round the ring fades at both its sides:
 * at the centre too, and the bulb showed the grass through it with the texture pinched into spokes.) Nodes closer
 * at the far tip, where the chord narrows fast. A loop keeps the ring (its island is no road).
 */
export const TC_DECAL_STEP_M = 1;
export const TC_DECAL_TIP_STEP_M = 0.35;
export const TC_DECAL_MIN_W = 0.6;
export function turningCircleDecalNodes(tc) {
  if (tc.ri > 0) return turningCircleCarriageway(tc).nodes.map((nd) => [nd[0], nd[1], nd[2], nd[3] * 2]);
  const r = tc.r;
  const ts = [];
  // (from the street's side, where the street covers it already, out past the centre to the far tip)
  for (let t = -r * 0.6; t < r * 0.7; t += TC_DECAL_STEP_M) ts.push(t);
  for (let t = r * 0.7; t < r; t += TC_DECAL_TIP_STEP_M) ts.push(t);
  ts.push(r - 0.05);
  return ts.map((t) => {
    const x = tc.c[0] + tc.dir[0] * t; const y = tc.c[1] + tc.dir[1] * t;
    return [x, y, bulbHeight(tc, x, y), Math.max(TC_DECAL_MIN_W, 2 * Math.sqrt(Math.max(0, r * r - t * t)))];
  });
}

/**
 * The ground under a cul-de-sac to its plane, blended back to the ground round it (two metres for every metre of
 * difference, TC_BLEND_MIN_M to TC_BLEND_MAX_M). hm: { at(idx), set(idx, v) } over the heightmap (heights include
 * minHeight); grid point (c, r) at ((c - W/2) sq, (H - 1 - r - H/2) sq). keep(x, y): a point not to touch (another
 * road's ground). Returns the number of grid points changed.
 */
export function gradeTurningCircle(tc, { hm, W, H, sq, minHeight = 0, keep = () => false }) {
  const reach = tc.r + 0.5 + TC_BLEND_MAX_M;
  const c0 = Math.max(0, Math.floor((tc.c[0] - reach) / sq + W / 2)); const c1 = Math.min(W - 1, Math.ceil((tc.c[0] + reach) / sq + W / 2));
  const r0 = Math.max(0, Math.floor(H - 1 - ((tc.c[1] + reach) / sq + H / 2))); const r1 = Math.min(H - 1, Math.ceil(H - 1 - ((tc.c[1] - reach) / sq + H / 2)));
  let changed = 0;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const x = (c - W / 2) * sq; const y = (H - 1 - r - H / 2) * sq;
      const d = fastHypot(x - tc.c[0], y - tc.c[1]);
      if (d > reach) continue;
      const idx = r * W + c;
      const g = hm.at(idx) - minHeight;
      const plane = bulbHeight(tc, x, y);
      let z;
      if (d <= tc.r + 0.5) {
        // (a loop's island keeps its ground, raised or lowered to the ring's height at most a curb's step off it)
        if (tc.ri > 0 && d < tc.ri - 0.5) z = plane + Math.max(-0.05, Math.min(0.15, g - plane));
        else z = plane;
      } else {
        if (keep(x, y)) continue;
        const B = Math.max(TC_BLEND_MIN_M, Math.min(TC_BLEND_MAX_M, Math.abs(g - plane) * TC_BLEND_PER_M));
        const f = (d - tc.r - 0.5) / B;
        if (f >= 1) continue;
        const w = 1 - f * f * (3 - 2 * f);
        z = g + (plane - g) * w;
      }
      if (Math.abs(z - g) < 1e-4) continue;
      hm.set(idx, z + minHeight);
      changed++;
    }
  }
  return changed;
}
