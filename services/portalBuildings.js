// Buildings over tunnel portals. A tunnel's ventilation or control building often stands right over its
// portal, the bores opening under it (Pittsburgh's Fort Pitt and Liberty Tunnels). OSM maps it as a plain
// footprint, with no layer or min_height, so it was built down to the ground across the tunnel's mouth, a
// wall where the road comes out of the hill. A building whose footprint lies across a bored tunnel's mouth
// stands on the portal instead: its base at the headwall's top (mapng:base_z for the building builder).
// A building already standing higher than that (on the hill over the bore) is left as it is; cut-and-cover
// boxes are under their streets and change nothing.
// Only a building that stands ON the portal: most of its footprint over the mouth. A big block with one
// corner across the mouth of an underpass was lifted whole and floated 4 m over its street (Val d'Isère,
// seen in game); it stays on its own ground, as every other building beside a tunnel does.
// Pure: callers pass world-space geometry and lookups.

const MOUTH_OUT_M = 10;    // the mouth: from this far out in front of the portal ...
const MOUTH_IN_M = 25;     // ... to this far into the bore
const STEP_M = 2;
const MOUTH_SIDE_M = 6;    // ... and this far past the tube each side (the headwall's reach)
const ON_PORTAL_SHARE = 0.5;   // of the footprint over the mouth: the building stands on the portal

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * buildings: [{ f, ring: [[x, y]...] }]; tunnels: solved tunnels ({ line: [{ x, y, z, s, tx, ty }], iS, iN,
 * portals: [bool, bool], kind, W, headTop, headTops }); groundAt(x, y). Returns [{ f, baseZ, tunnel, end }].
 */
export function findPortalBuildings({ buildings = [], tunnels = [], groundAt }) {
  const out = [];
  const taken = new Set();
  for (const t of tunnels) {
    if (t.kind === 'cutcover' || !t.line?.length) continue;
    for (const end of [0, 1]) {
      if (!t.portals?.[end]) continue;
      const k = end === 0 ? t.iS : t.iN;
      const portal = t.line[k];
      if (!portal) continue;
      const top = portal.z + (t.headTops?.[end] ?? t.headTop ?? 8);
      // the mouth's samples: along the road from MOUTH_OUT_M outside to MOUTH_IN_M inside, across its width
      const inward = end === 0 ? 1 : -1;
      const pts = [];
      for (const p of t.line) {
        const d = (p.s - portal.s) * inward;   // + into the bore
        if (d < -MOUTH_OUT_M || d > MOUTH_IN_M) continue;
        const nx = -(p.ty ?? 0); const ny = p.tx ?? 0;
        for (let o = -(t.W || 5); o <= (t.W || 5) + 1e-6; o += STEP_M) pts.push([p.x + nx * o, p.y + ny * o]);
      }
      if (!pts.length) continue;
      // the mouth as a corridor, for the share of a footprint over it
      const mouthLine = t.line.filter((p) => { const d = (p.s - portal.s) * inward; return d >= -MOUTH_OUT_M && d <= MOUTH_IN_M; });
      const overMouth = (x, y) => mouthLine.some((p) => {
        const dx = x - p.x; const dy = y - p.y;
        return Math.abs(dx * -(p.ty ?? 0) + dy * (p.tx ?? 0)) <= (t.W || 5) + MOUTH_SIDE_M && Math.abs(dx * (p.tx ?? 0) + dy * (p.ty ?? 0)) <= STEP_M;
      });
      for (const b of buildings) {
        if (taken.has(b.f)) continue;
        const ring = b.ring;
        let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
        for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
        if (!pts.some(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && inRing(x, y, ring))) continue;
        // (its own ground: the lowest under its corners; already over the headwall, it stands on the hill)
        const ground = Math.min(...ring.map(([x, y]) => groundAt(x, y)).filter(Number.isFinite));
        if (!(ground < top)) continue;
        let inside = 0; let over = 0;
        for (let y = y0 + STEP_M / 2; y < y1; y += STEP_M) {
          for (let x = x0 + STEP_M / 2; x < x1; x += STEP_M) {
            if (!inRing(x, y, ring)) continue;
            inside++;
            if (overMouth(x, y)) over++;
          }
        }
        if (inside > 0 && over < ON_PORTAL_SHARE * inside) continue;
        taken.add(b.f);
        out.push({ f: b.f, baseZ: top, tunnel: t.key || null, end });
      }
    }
  }
  return out;
}

/** The building's tags with its base on the portal. */
export function portalBuildingTags(p) {
  return { ...p.f.tags, 'mapng:base_z': p.baseZ.toFixed(2) };
}
