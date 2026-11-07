// Buildings that are part of a bridge: a drawbridge's tower houses (the Bridge of Lions' four towers at its
// bascule span), a bridge tender's house, a toll house out on the deck.
//
// OSM maps them as plain buildings (building=yes) inside the bridge's outline (man_made=bridge) or over the
// water beside the deck. Built as buildings they stood on the river bed, their roofs at the waterline
// under the deck. Here: a building whose footprint's middle is inside a bridge outline, or over water and
// against a deck's edge, small (a house, not a block), with the deck well over the ground there: its
// house stands at the deck's road height (mapng:base_z for the building builder) and, where it is out
// beside the deck, on a pier of its own outline from the ground (the water's bed) up to the deck.
// Not a building beside an elevated road on land (only inside an outline or over water).

const MAX_AREA_M2 = 400;        // a tower or a tender's house; bigger is a building of its own
const EDGE_REACH_M = 3;         // against the deck: its footprint within this of the deck's edge
const DECK_OVER_M = 2.5;        // the deck at least this over the ground there (else on the ground anyway)
const PARAPET_M = 0.45;
const PIER_PAD_M = 0.3;         // the pier this much wider than the house all round
const PIER_FOOT_M = 1;          // ... from this far under the ground

const ringArea = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i]; const q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const inRing = (x, y, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** The nearest deck part's centreline to (x, y): { deck, part, d, z } or null. */
function nearestDeck(decks, x, y) {
  let best = null;
  for (const deck of decks) {
    for (const part of deck.parts || []) {
      const { xy, z } = part;
      for (let i = 0; i + 1 < xy.length; i++) {
        const vx = xy[i + 1][0] - xy[i][0]; const vy = xy[i + 1][1] - xy[i][1];
        const L2 = vx * vx + vy * vy || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - xy[i][0]) * vx + (y - xy[i][1]) * vy) / L2));
        const d = Math.hypot(xy[i][0] + vx * t - x, xy[i][1] + vy * t - y);
        if (!best || d < best.d) best = { deck, part, d, z: z[i] + (z[i + 1] - z[i]) * t };
      }
    }
  }
  return best;
}

/**
 * buildings: [{ f, ring }] (world xy rings); outlines: [{ ring }] (man_made=bridge); decks: solved decks;
 * groundAt(x, y); wetAt(x, y) > 0 over water. Returns [{ f, ring, deck, top, pier }]: top the deck's road
 * height at the house, pier whether it stands out beside the deck on a pier of its own.
 */
export function findBridgeTowers({ buildings = [], outlines = [], decks = [], groundAt, wetAt = () => 0 }) {
  if (!decks.length) return [];
  const out = [];
  for (const { f, ring } of buildings) {
    if (!ring || ring.length < 3) continue;
    const area = Math.abs(ringArea(ring));
    if (area < 4 || area > MAX_AREA_M2) continue;
    const cx = ring.reduce((n, p) => n + p[0], 0) / ring.length; const cy = ring.reduce((n, p) => n + p[1], 0) / ring.length;
    const r = Math.max(...ring.map((p) => Math.hypot(p[0] - cx, p[1] - cy)));
    const near = nearestDeck(decks, cx, cy);
    if (!near) continue;
    const edge = near.part.half + PARAPET_M;
    const against = near.d - r < edge + EDGE_REACH_M;
    const inOutline = outlines.some((o) => inRing(cx, cy, o.ring));
    if (!against || !(inOutline || wetAt(cx, cy) > 0)) continue;
    const g = groundAt(cx, cy);
    if (!(near.z - g > DECK_OVER_M)) continue;
    out.push({ f, ring, deck: near.deck, top: near.z, pier: near.d - r > near.part.half - 0.5 });
  }
  // one look per deck: the seed of its first tower's id
  const seeds = new Map();
  for (const t of out) {
    if (!seeds.has(t.deck)) seeds.set(t.deck, `bridge-towers:${t.f.id ?? out.indexOf(t)}`);
    t.lookSeed = seeds.get(t.deck);
  }
  return out;
}

/** A tower's pier: its outline (padded) from under the ground up to the deck's road height. */
export function towerPierGeometry(b, towers, groundAt) {
  for (const t of towers) {
    if (!t.pier) continue;
    const cx = t.ring.reduce((n, p) => n + p[0], 0) / t.ring.length; const cy = t.ring.reduce((n, p) => n + p[1], 0) / t.ring.length;
    let ring = t.ring.map(([x, y]) => { const dx = x - cx; const dy = y - cy; const l = Math.hypot(dx, dy) || 1; return [x + (dx / l) * PIER_PAD_M, y + (dy / l) * PIER_PAD_M]; });
    if (ringArea(ring) < 0) ring = ring.slice().reverse();
    const bottom = Math.min(...ring.map(([x, y]) => groundAt(x, y))) - PIER_FOOT_M;
    const top = t.top - 0.02;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]; const q = ring[(i + 1) % ring.length];
      const nx = q[1] - p[1]; const ny = -(q[0] - p[0]); const l = Math.hypot(nx, ny) || 1;
      b.quad([p[0], p[1], bottom], [q[0], q[1], bottom], [q[0], q[1], top], [p[0], p[1], top], [nx / l, ny / l, 0]);
    }
    // its top: a fan from the middle (a convex house outline)
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]; const q = ring[(i + 1) % ring.length];
      b.quad([cx, cy, top], [p[0], p[1], top], [q[0], q[1], top], [cx, cy, top], [0, 0, 1]);
    }
  }
}

const TOWER_LEVELS = '2';       // a bridge's tower house with no height mapped: two storeys over the deck
const COMPACT_ASPECT = 1.6;     // a footprint this near square: a tower (a pyramid roof), else a tender's house

/** The tags a tower house is built with: its own where mapped; else a tower's storeys and roof. */
export function towerHouseTags(t) {
  // (one look for the deck's towers: they are one design)
  const tags = { ...t.f.tags, 'mapng:base_z': t.top.toFixed(2), 'mapng:look_seed': t.lookSeed || `tower:${t.f.id ?? ''}` };
  if (!tags.height && !tags['building:levels']) tags['building:levels'] = TOWER_LEVELS;
  if (!tags['roof:shape']) {
    const xs = t.ring.map((p) => p[0]); const ys = t.ring.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs); const h = Math.max(...ys) - Math.min(...ys);
    if (Math.max(w, h) / Math.max(0.1, Math.min(w, h)) < COMPACT_ASPECT) tags['roof:shape'] = 'pyramidal';
  }
  return tags;
}
