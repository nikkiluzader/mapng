// Railway track in the level: the formation under it, level crossings,
// the track meshes (rails, sleepers, ballast) and the tram decals.
//
// The structure solver (services/structures/) solves a railway's profile
// with the roads: the profile is the top of the rail, which is what a road
// meets at a level crossing. Under it lies the track, RAIL_DEPTH_M deep,
// on the formation the terrain composer shapes. The track is built here as
// our own mesh over the game's shared textures (rails, concrete or timber
// sleepers, gravel ballast): no level ships a track piece that bends to a
// line; West Coast USA's railway is one mesh made for its own route.
// Nothing here knows about any place.

import { BALLAST_TOP_HALF_M, RAIL_DEPTH_M, RAIL_OVER_GROUND_M, STANDARD_GAUGE_M, TRACK_SPACING_M, gaugeOf, tracksOf } from './railways.js';

// ── Level crossings and the formation under the track ─────────────────────

const CROSSING_PAD_M = 0.8;      // the crossing's surface past the road's edge, along the track
const CROSSING_RAMP_M = 8;       // the formation drops back to the track's depth over this far past it

/**
 * Railway edges of a structure graph made ready for the solve:
 *   - their ground is where the top of the rail stands over the ground the
 *     elevation data shows (g + RAIL_OVER_GROUND_M: the survey sees the
 *     ballast, a little under the rails);
 *   - e.target: what the solve pulls them to (railGroundTargets);
 *   - e.weight per station: how hard (W_RAIL, weaker than a street's, so
 *     the line runs smoother; a street's at a level crossing, so the road and
 *     the line meet at the line's height, not the road's);
 *   - e.drop per station, the formation under the top of the rail
 *     (RAIL_DEPTH_M), none at a level crossing (a road meeting the line at a
 *     node of both: the road and the rails at one height, no trench dug
 *     across the road), easing back in over CROSSING_RAMP_M;
 *   - e.crossingAt per station (1 inside a crossing's surface) and
 *     e.crossingZones, the crossings' extents along the edge [[s0, s1]...].
 * Returns the level crossings [{ node, x, y, rail: [edge], road: [edge], half, path }]
 * (path: every road there is a footway or another path).
 */
export function prepareRailEdges(graph, { pathClasses = new Set() } = {}) {
  const { edges, nodes } = graph;
  const crossings = [];
  if (!edges.some((e) => e.rail)) return crossings;
  for (const e of edges) {
    if (!e.rail) continue;
    for (let i = 0; i < e.g.length; i++) e.g[i] += RAIL_OVER_GROUND_M;
    e.drop = new Float32Array(e.s.length).fill(RAIL_DEPTH_M);
    e.crossingAt = new Uint8Array(e.s.length);
    e.crossingZones = [];
    e.weight = new Float32Array(e.s.length).fill(W_RAIL);
  }
  railGroundTargets(graph);
  for (const node of nodes.values()) {
    const rail = node.edges.filter(({ edge }) => edges[edge].rail);
    const road = node.edges.filter(({ edge }) => !edges[edge].rail);
    if (!rail.length || !road.length) continue;
    const half = Math.max(...road.map(({ edge }) => edges[edge].half || 3));
    crossings.push({
      node: node.id, x: node.x, y: node.y,
      rail: rail.map(({ edge }) => edge), road: road.map(({ edge }) => edge),
      half, path: road.every(({ edge }) => pathClasses.has(edges[edge].highway)),
    });
    for (const { edge, end } of rail) {
      const e = edges[edge];
      markCrossing(e, end === 0 ? 0 : e.s[e.s.length - 1], half);
    }
  }
  return crossings;
}

// A railway station's pull to its target, against a street's 1
// (structures/profileSolve.js W_GROUND)
const W_RAIL = 0.2;

// How wide a dip in the ground a line runs straight over (each side of a
// station, m): a main line holds its grade across a hollow, a stream's valley
// or the gap a removed viaduct left in the elevation data; a tram follows its
// street's ups and downs closely; a funicular climbs its hillside as it is.
const BRIDGE_DIP_M = { rail: 75, narrow_gauge: 50, subway: 60, light_rail: 50, monorail: 50, tram: 20, funicular: 0 };

/**
 * e.target per railway edge: the ground the profile solve pulls the line
 * to, the ground along the line with every dip narrower than twice
 * BRIDGE_DIP_M filled (a morphological closing, the highest ground either
 * side then the lowest of those). Read along the line through the nodes it
 * runs on through (at a junction the rail edge most in line), so a hollow
 * spanning a short bridge and the fills either side is one dip. The true
 * ground (e.g) still classes what stands over it: deck, embankment.
 */
export function railGroundTargets(graph) {
  const { edges, nodes } = graph;
  const SAMPLE_M = 4;
  // the rail edge going on from an edge's end, most in line with it
  const onward = (k, end) => {
    const e = edges[k];
    const node = nodes.get(end === 0 ? e.from : e.to);
    if (!node) return null;
    const n = e.s.length;
    const i0 = end === 0 ? 0 : n - 1; const i1 = end === 0 ? Math.min(n - 1, 2) : Math.max(0, n - 3);
    const dx = e.x[i0] - e.x[i1]; const dy = e.y[i0] - e.y[i1]; const L = Math.hypot(dx, dy) || 1;
    let best = null; let bestCos = 0.7;
    for (const o of node.edges) {
      if (o.edge === k || !edges[o.edge].rail) continue;
      const f = edges[o.edge]; const m = f.s.length;
      const j0 = o.end === 0 ? 0 : m - 1; const j1 = o.end === 0 ? Math.min(m - 1, 2) : Math.max(0, m - 3);
      const ex = f.x[j1] - f.x[j0]; const ey = f.y[j1] - f.y[j0]; const M = Math.hypot(ex, ey) || 1;
      const cos = (dx * ex + dy * ey) / (L * M);
      if (cos > bestCos) { bestCos = cos; best = o; }
    }
    return best;
  };
  // ground samples beyond an end, out to reach metres: [[d, g]...] (d > 0 away from the end)
  const beyond = (k, end, reach) => {
    const out = [];
    let cur = onward(k, end); let base = 0; let guard = 0;
    while (cur && base < reach && guard++ < 50) {
      const f = edges[cur.edge]; const m = f.s.length; const len = f.s[m - 1];
      for (let j = 1; j < m; j++) {
        const i = cur.end === 0 ? j : m - 1 - j;
        const d = base + (cur.end === 0 ? f.s[i] : len - f.s[i]);
        if (d > reach) break;
        out.push([d, f.g[i]]);
      }
      base += len;
      cur = onward(cur.edge, cur.end === 0 ? 1 : 0);
    }
    return out;
  };
  edges.forEach((e, k) => {
    if (!e.rail) return;
    const R = BRIDGE_DIP_M[e.rail] ?? 50;
    const n = e.s.length; const len = e.s[n - 1];
    if (!(R > 0)) { e.target = Float64Array.from(e.g); return; }
    // the line's ground from 2R before to 2R past it (dilation then erosion
    // each reach R)
    const pts = [];
    for (const [d, g] of beyond(k, 0, 2 * R).reverse()) pts.push([-d, g]);
    for (let i = 0; i < n; i++) pts.push([e.s[i], e.g[i]]);
    for (const [d, g] of beyond(k, 1, 2 * R)) pts.push([len + d, g]);
    // on a regular grid along it
    const s0 = pts[0][0]; const s1 = pts[pts.length - 1][0];
    const m = Math.max(2, Math.ceil((s1 - s0) / SAMPLE_M) + 1);
    const grid = new Float64Array(m);
    let p = 0;
    for (let q = 0; q < m; q++) {
      const s = s0 + q * SAMPLE_M;
      while (p + 1 < pts.length - 1 && pts[p + 1][0] < s) p++;
      const [sa, ga] = pts[p]; const [sb, gb] = pts[Math.min(p + 1, pts.length - 1)];
      grid[q] = sb > sa ? ga + (gb - ga) * Math.max(0, Math.min(1, (s - sa) / (sb - sa))) : ga;
    }
    const w = Math.round(R / SAMPLE_M);
    const slide = (src, pick) => Float64Array.from(src, (_, q) => {
      let v = src[q];
      for (let j = Math.max(0, q - w); j <= Math.min(m - 1, q + w); j++) v = pick(v, src[j]);
      return v;
    });
    const closed = slide(slide(grid, Math.max), Math.min);
    e.target = Float64Array.from(e.s, (s, i) => {
      const q = (s - s0) / SAMPLE_M; const qa = Math.max(0, Math.min(m - 1, Math.floor(q))); const qb = Math.min(m - 1, qa + 1);
      const c = closed[qa] + (closed[qb] - closed[qa]) * (q - qa);
      return Math.max(e.g[i], c);
    });
  });
}

// A crossing at arc length s0 along a rail edge, a road of half width
// `half` across it: its surface, the formation up to the rails' top there
// and easing back down past it, the line held at its height as hard as the road.
function markCrossing(e, s0, half) {
  const n = e.s.length;
  const zone = half + CROSSING_PAD_M;
  e.crossingZones.push([Math.max(0, s0 - zone), Math.min(e.s[n - 1], s0 + zone)]);
  for (let i = 0; i < n; i++) {
    const d = Math.abs(e.s[i] - s0);
    if (d <= zone) { e.crossingAt[i] = 1; e.weight[i] = 1; }
    const drop = RAIL_DEPTH_M * Math.max(0, Math.min(1, (d - zone) / CROSSING_RAMP_M));
    if (drop < e.drop[i]) e.drop[i] = drop;
  }
}

/**
 * Railways crossing a road at grade with no node of both (the two lines
 * pass through each other on one layer, neither a bridge nor a tunnel):
 * counted, and their track is still laid level through the road's surface
 * (no ballast bed dug across it). [{ x, y, rail, road }]
 */
export function unjoinedRailCrossings(graph) {
  const { edges } = graph;
  const out = [];
  const segsOf = (e) => { const v = []; for (let i = 0; i < e.vertex.length; i++) if (e.vertex[i]) v.push(i); return v; };
  const CELL = 64;
  const grid = new Map();
  edges.forEach((e, k) => {
    if (e.rail || e.bridge || e.tunnel) return;
    const v = segsOf(e);
    for (let j = 0; j + 1 < v.length; j++) {
      const a = v[j]; const b = v[j + 1];
      const key = `${Math.floor((e.x[a] + e.x[b]) / 2 / CELL)},${Math.floor((e.y[a] + e.y[b]) / 2 / CELL)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(k, a, b);
    }
  });
  edges.forEach((e, k) => {
    if (!e.rail || e.bridge || e.tunnel) return;
    const v = segsOf(e);
    for (let j = 0; j + 1 < v.length; j++) {
      const a = v[j]; const b = v[j + 1];
      const cx = Math.floor((e.x[a] + e.x[b]) / 2 / CELL); const cy = Math.floor((e.y[a] + e.y[b]) / 2 / CELL);
      const reach = Math.ceil(Math.hypot(e.x[b] - e.x[a], e.y[b] - e.y[a]) / CELL) + 1;
      for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) {
        const list = grid.get(`${cx + dx},${cy + dy}`) || [];
        for (let q = 0; q < list.length; q += 3) {
          const o = edges[list[q]];
          if ((o.layer || 0) !== (e.layer || 0)) continue;
          if (o.from === e.from || o.from === e.to || o.to === e.from || o.to === e.to) continue;
          const hit = segHit(e.x[a], e.y[a], e.x[b], e.y[b], o.x[list[q + 1]], o.y[list[q + 1]], o.x[list[q + 2]], o.y[list[q + 2]]);
          if (!hit) continue;
          out.push({ x: e.x[a] + (e.x[b] - e.x[a]) * hit.t, y: e.y[a] + (e.y[b] - e.y[a]) * hit.t, rail: k, road: list[q], s: e.s[a] + (e.s[b] - e.s[a]) * hit.t });
        }
      }
    }
  });
  return out;
}

function segHit(ax, ay, bx, by, cx, cy, dx, dy) {
  const rx = bx - ax; const ry = by - ay; const sx = dx - cx; const sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qx = cx - ax; const qy = cy - ay;
  const t = (qx * sy - qy * sx) / den; const u = (qx * ry - qy * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null;
}

/** A crossing without a node: its zone on the rail edge marked as a node's would be. */
export function markUnjoinedCrossing(graph, c) {
  const e = graph.edges[c.rail];
  if (!e?.drop) return;
  markCrossing(e, c.s, graph.edges[c.road]?.half || 3);
}

// ── Track geometry ───────────────────────────────────────────────────────

// Measured down from the top of the rail.
const RAIL_H_M = 0.17;
const RAIL_HEAD_HALF_M = 0.036;
const SLEEPER_TOP_M = RAIL_H_M;          // sleepers under the rails
const SLEEPER_SHOW_BURY_M = 0.03;      // its long faces this far down into the ballast
const SLEEPER_HALF_W_M = 0.13;           // along the track
const SLEEPER_HALF_L_M = 1.3;            // across it (2.6 m sleepers on standard gauge)
export const SLEEPER_EVERY_M = 0.6;
const BALLAST_TOP_M = 0.2;               // the ballast's top 3 cm under the sleepers' tops
const BALLAST_SLOPE = 1.5;               // its shoulders: 1.5 m out per 1 m down
const BALLAST_BURY_M = 0.1;              // and on down into the formation (no gap on uneven ground)
const BALLAST_UV_M = 2;                  // gravel texture repeat
const BEAM_HALF_M = 0.45;                // a monorail's concrete beam
const BEAM_D_M = 1.5;
export const RAIL_TILE_M = 256;          // one object per tile: culled by tile

// Materials, all over the game's shared textures (nothing shipped): the
// rails in the industrial steel, concrete or timber sleepers, the ballast in
// the terrain library's gravel, a monorail's beam in plain concrete.
export const RAIL_MATERIALS = {
  steel: 'mapng_rail_steel',
  concrete: 'mapng_rail_sleeper_concrete',
  timber: 'mapng_rail_sleeper_timber',
  ballast: 'mapng_rail_ballast',
  beam: 'mapng_rail_beam',
};
export function railMaterialDefs() {
  const mat = (name, annotation, stage) => ({
    name, mapTo: name, class: 'Material', version: 1.5, annotation, groundType: annotation,
    Stages: [stage, {}, {}, {}], translucentBlendOp: 'None',
  });
  const T = '/assets/materials/tileable';
  return {
    [RAIL_MATERIALS.steel]: mat(RAIL_MATERIALS.steel, 'METAL', {
      baseColorMap: `${T}/metal/ind_metal/t_ind_metal_b.color.png`,
      normalMap: `${T}/metal/ind_metal/t_ind_metal_nm.normal.png`,
      roughnessMap: `${T}/metal/ind_metal/t_ind_metal_r.data.png`,
      metallicMap: `${T}/metal/ind_metal/t_ind_metal_m.data.png`,
      metallicFactor: 1,
      diffuseColor: [0.62, 0.58, 0.55, 1],
    }),
    [RAIL_MATERIALS.concrete]: mat(RAIL_MATERIALS.concrete, 'CONCRETE', {
      ambientOcclusionMap: `${T}/concrete/concrete_precast1/t_concrete_precast1_ao.data.png`,
      baseColorMap: `${T}/concrete/concrete_precast1/t_concrete_precast1_b.color.png`,
      normalMap: `${T}/concrete/concrete_precast1/t_concrete_precast1_nm.normal.png`,
      roughnessMap: `${T}/concrete/concrete_precast1/t_concrete_precast1_r.data.png`,
    }),
    [RAIL_MATERIALS.timber]: mat(RAIL_MATERIALS.timber, 'WOOD', {
      ambientOcclusionMap: `${T}/wood/wood_rough/t_wood_rough_ao.data.png`,
      baseColorMap: `${T}/wood/wood_rough/t_wood_rough_b.color.png`,
      normalMap: `${T}/wood/wood_rough/t_wood_rough_nm.normal.png`,
      roughnessMap: `${T}/wood/wood_rough/t_wood_rough_r.data.png`,
      diffuseColor: [0.55, 0.5, 0.45, 1],
    }),
    [RAIL_MATERIALS.ballast]: mat(RAIL_MATERIALS.ballast, 'GRAVEL', {
      ambientOcclusionMap: '/assets/materials/terrain/soil/t_gravel/t_gravel_ao.png',
      baseColorMap: '/assets/materials/terrain/soil/t_gravel/t_gravel_b.png',
      normalMap: '/assets/materials/terrain/soil/t_gravel/t_gravel_nm.png',
      roughnessMap: '/assets/materials/terrain/soil/t_gravel/t_gravel_r.png',
      diffuseColor: [0.72, 0.7, 0.68, 1],
    }),
    [RAIL_MATERIALS.beam]: mat(RAIL_MATERIALS.beam, 'CONCRETE', {
      ambientOcclusionMap: `${T}/concrete/concrete_plain/t_concrete_plain_ao.data.png`,
      baseColorMap: `${T}/concrete/concrete_plain/t_concrete_plain_b.color.png`,
      normalMap: `${T}/concrete/concrete_plain/t_concrete_plain_nm.normal.png`,
      roughnessMap: `${T}/concrete/concrete_plain/t_concrete_plain_r.data.png`,
    }),
  };
}

// Embedded track, as a street's tram line or a level crossing's surface:
// the game's own decal-road tram rails (West Coast USA defines its
// 'tramline' over the shared /assets texture; a level carries its own
// definition of it).
export const TRAMLINE_MATERIAL = {
  name: 'mapng_tramline', mapTo: 'mapng_tramline', class: 'Material', persistentId: '3b0f5a2e-7c41-4d8e-9f16-2a6c8e1d4b71',
  Stages: [{
    ambientOcclusionMap: '/assets/materials/decalroad/lines/tramline/t_tramline_ao.data.png',
    baseColorMap: '/assets/materials/decalroad/lines/tramline/t_tramline_b.color.png',
    metallicFactor: 1,
    metallicMap: '/assets/materials/decalroad/lines/tramline/t_tramline_m.data.png',
    normalMap: '/assets/materials/decalroad/lines/tramline/t_tramline_nm.normal.png',
    pixelSpecular: true,
    roughnessMap: '/assets/materials/decalroad/lines/tramline/t_tramline_r.data.png',
  }, {}, {}, {}],
  alphaRef: 0, annotation: 'STREET', dynamicCubemap: true, groundType: 'ASPHALT',
  materialTag0: 'beamng', materialTag1: 'vehicle', translucent: true, translucentBlendOp: 'None', translucentRecvShadows: true, version: 1.5,
};
// the tram texture's strip across its two rails (drawn for standard gauge)
export const TRAMLINE_WIDTH_M = 2.6;

/** Timber or concrete sleepers: timber on yards, sidings and narrow lines, concrete on main lines. */
export function sleeperMaterialOf(tags = {}, kind = 'rail') {
  const service = String(tags.service || '');
  const usage = String(tags.usage || '');
  if (/wood|timber/.test(String(tags['railway:sleepers'] || tags.sleepers || ''))) return 'timber';
  if (kind === 'narrow_gauge' || ['yard', 'siding', 'spur'].includes(service) || ['industrial', 'military', 'tourism'].includes(usage)) return 'timber';
  return 'concrete';
}

const newPart = () => ({ pos: [], uv: [] });
const NO_UV = [[0, 0], [0, 0], [0, 0], [0, 0]];
function quad(part, a, b, c, d, uvs = NO_UV) {
  part.pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  if (!part.uv) return;
  const [ua, ub, uc, ud] = uvs;
  part.uv.push(...ua, ...ub, ...uc, ...ua, ...uc, ...ud);
}

/**
 * The track meshes of every railway edge of a solved graph, in tiles of
 * RAIL_TILE_M: { tiles: [{ key, origin: [x, y, z], parts: { [material]: { pos, uv } },
 * collision: { pos }, triangles }], stats } in world metres.
 *   tagsOf(edge) -> its OSM tags (tracks, gauge, service...)
 * Rails and sleepers are left out inside a level crossing (the crossing's
 * surface, crossingDecals, shows its rails); a monorail is a concrete beam.
 * The ballast and the rails' tops collide (the sleepers do not: a car
 * crossing the line rides on the ballast and the rails).
 */
export function buildTrackGeometry(graph, { tagsOf = () => ({}) } = {}) {
  const { edges } = graph;
  const z = graph.profile?.z;
  const tiles = new Map();
  const stats = { edges: 0, trackKm: 0, sleepers: 0, triangles: 0 };
  if (!z) return { tiles: [], stats };
  const tileOf = (x, y) => {
    const key = `${Math.floor(x / RAIL_TILE_M)}_${Math.floor(y / RAIL_TILE_M)}`.replace(/-/g, 'm');
    let t = tiles.get(key);
    if (!t) { t = { key, parts: {}, collision: { pos: [] } }; tiles.set(key, t); }
    return t;
  };
  const partOf = (t, m) => (t.parts[m] ||= newPart());
  edges.forEach((e, k) => {
    if (!e.rail || e.s.length < 2) return;
    const tags = tagsOf(e) || {};
    const zk = z[k]; const n = e.s.length;
    const gauge = gaugeOf(tags);
    const scale = Math.max(0.7, gauge / STANDARD_GAUGE_M);
    const nTracks = e.rail === 'monorail' ? 1 : tracksOf(tags);
    const offsets = Array.from({ length: nTracks }, (_, j) => (j - (nTracks - 1) / 2) * TRACK_SPACING_M * scale);
    const sleeper = RAIL_MATERIALS[sleeperMaterialOf(tags, e.rail)];
    // left normals per station (the mean direction of the pieces either side)
    const nx = new Float64Array(n); const ny = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1); const b = Math.min(n - 1, i + 1);
      const dx = e.x[b] - e.x[a]; const dy = e.y[b] - e.y[a]; const L = Math.hypot(dx, dy) || 1;
      nx[i] = -dy / L; ny[i] = dx / L;
    }
    // a point at arc length sv between stations i and i + 1, offset o to the
    // left of the line and dz under the top of the rail
    const at = (i, sv, o, dz) => {
      const f = (sv - e.s[i]) / ((e.s[i + 1] - e.s[i]) || 1);
      let ux = nx[i] + (nx[i + 1] - nx[i]) * f; let uy = ny[i] + (ny[i + 1] - ny[i]) * f;
      const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
      return [e.x[i] + (e.x[i + 1] - e.x[i]) * f + ux * o, e.y[i] + (e.y[i + 1] - e.y[i]) * f + uy * o, zk[i] + (zk[i + 1] - zk[i]) * f - dz];
    };
    // the level crossings along it: no ballast, sleepers or rails inside one
    // (cut exactly at its ends: whole 4 m pieces left 0.5 m of ballast in the road)
    const zones = e.crossingZones || [];
    const outside = (sa, sb) => {
      let parts = [[sa, sb]];
      for (const [za, zb] of zones) {
        parts = parts.flatMap(([p, q]) => (zb <= p || za >= q ? [[p, q]] : [[p, Math.min(q, za)], [Math.max(p, zb), q]].filter(([u, v]) => v - u > 1e-3)));
      }
      return parts;
    };
    stats.edges++;
    stats.trackKm += (nTracks * e.s[n - 1]) / 1000;
    for (let i = 0; i + 1 < n; i++) {
      if (e.s[i + 1] - e.s[i] < 1e-3) continue;
      const t = tileOf((e.x[i] + e.x[i + 1]) / 2, (e.y[i] + e.y[i + 1]) / 2);
      if (e.rail === 'monorail') {
        // the beam: its top and both sides
        const part = partOf(t, RAIL_MATERIALS.beam);
        const s0 = e.s[i]; const s1 = e.s[i + 1];
        const v0 = s0 / BALLAST_UV_M; const v1 = s1 / BALLAST_UV_M;
        const L0 = at(i, s0, BEAM_HALF_M, 0); const L1 = at(i, s1, BEAM_HALF_M, 0);
        const R0 = at(i, s0, -BEAM_HALF_M, 0); const R1 = at(i, s1, -BEAM_HALF_M, 0);
        const LB0 = at(i, s0, BEAM_HALF_M, BEAM_D_M); const LB1 = at(i, s1, BEAM_HALF_M, BEAM_D_M);
        const RB0 = at(i, s0, -BEAM_HALF_M, BEAM_D_M); const RB1 = at(i, s1, -BEAM_HALF_M, BEAM_D_M);
        const uv = (w) => [[0, v0], [w, v0], [w, v1], [0, v1]];
        for (const [q, w] of [[[R0, R1, L1, L0], 0.45], [[L0, L1, LB1, LB0], 0.75], [[RB0, RB1, R1, R0], 0.75]]) {
          quad(part, ...q, uv(w));
          quad(t.collision, ...q);
        }
        continue;
      }
      for (const [s0, s1] of outside(e.s[i], e.s[i + 1])) {
        const v0 = s0 / BALLAST_UV_M; const v1 = s1 / BALLAST_UV_M;
        // the ballast: one bed under all the tracks, its shoulders down into the formation
        const top = Math.max(...offsets.map(Math.abs)) + BALLAST_TOP_HALF_M * scale;
        const fall = (RAIL_DEPTH_M - BALLAST_TOP_M) + BALLAST_BURY_M;
        const foot = top + fall * BALLAST_SLOPE;
        const bed = partOf(t, RAIL_MATERIALS.ballast);
        const rows = [[foot, BALLAST_TOP_M + fall], [top, BALLAST_TOP_M], [-top, BALLAST_TOP_M], [-foot, BALLAST_TOP_M + fall]];
        for (let r = 0; r + 1 < rows.length; r++) {
          const [oa, da] = rows[r]; const [ob, db] = rows[r + 1];
          const a0 = at(i, s0, oa, da); const a1 = at(i, s1, oa, da); const b0 = at(i, s0, ob, db); const b1 = at(i, s1, ob, db);
          const ua = oa / BALLAST_UV_M; const ub = ob / BALLAST_UV_M;
          // (a: the left of b; counter-clockwise seen from above)
          quad(bed, a0, b0, b1, a1, [[ua, v0], [ub, v0], [ub, v1], [ua, v1]]);
          quad(t.collision, a0, b0, b1, a1);
        }
        // the rails: each head's top and both sides, down to the sleepers
        const steel = partOf(t, RAIL_MATERIALS.steel);
        for (const o of offsets) {
          for (const side of [-1, 1]) {
            const c = o + (side * gauge) / 2;
            const L0 = at(i, s0, c + RAIL_HEAD_HALF_M, 0); const L1 = at(i, s1, c + RAIL_HEAD_HALF_M, 0);
            const R0 = at(i, s0, c - RAIL_HEAD_HALF_M, 0); const R1 = at(i, s1, c - RAIL_HEAD_HALF_M, 0);
            const LB0 = at(i, s0, c + RAIL_HEAD_HALF_M, RAIL_H_M); const LB1 = at(i, s1, c + RAIL_HEAD_HALF_M, RAIL_H_M);
            const RB0 = at(i, s0, c - RAIL_HEAD_HALF_M, RAIL_H_M); const RB1 = at(i, s1, c - RAIL_HEAD_HALF_M, RAIL_H_M);
            const uv = [[0, v0], [0.05, v0], [0.05, v1], [0, v1]];
            quad(steel, L0, R0, R1, L1, uv);
            quad(steel, LB0, L0, L1, LB1, uv);
            quad(steel, R0, RB0, RB1, R1, uv);
            quad(t.collision, L0, R0, R1, L1);
          }
        }
      }
    }
    // the sleepers, every SLEEPER_EVERY_M along the line (none in a crossing)
    if (e.rail === 'monorail') return;
    let j = 0;
    for (let s = SLEEPER_EVERY_M / 2; s < e.s[n - 1]; s += SLEEPER_EVERY_M) {
      while (j + 1 < n - 1 && e.s[j + 1] < s) j++;
      if (zones.some(([za, zb]) => s > za - SLEEPER_HALF_W_M && s < zb + SLEEPER_HALF_W_M)) continue;
      const f = (s - e.s[j]) / ((e.s[j + 1] - e.s[j]) || 1);
      const x = e.x[j] + (e.x[j + 1] - e.x[j]) * f; const y = e.y[j] + (e.y[j + 1] - e.y[j]) * f;
      const zz = zk[j] + (zk[j + 1] - zk[j]) * f;
      let tx = e.x[j + 1] - e.x[j]; let ty = e.y[j + 1] - e.y[j]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const lx = -ty; const ly = tx;
      const t = tileOf(x, y);
      const part = partOf(t, sleeper);
      const hw = SLEEPER_HALF_W_M; const hl = SLEEPER_HALF_L_M * scale;
      // (only what shows over the ballast: its top and its two long faces down
      // into the ballast; its ends and the rest of its depth are buried, and
      // left out they took 40 % of a level's track triangles)
      const zt = zz - SLEEPER_TOP_M; const zb = zz - BALLAST_TOP_M - SLEEPER_SHOW_BURY_M;
      for (const o of offsets) {
        const cx = x + lx * o; const cy = y + ly * o;
        const corner = (a, b, zh) => [cx + tx * a + lx * b, cy + ty * a + ly * b, zh];
        // back / front along the track, right / left across it
        const BR = (zh) => corner(-hw, -hl, zh); const FR = (zh) => corner(hw, -hl, zh);
        const FL = (zh) => corner(hw, hl, zh); const BL = (zh) => corner(-hw, hl, zh);
        quad(part, BR(zt), FR(zt), FL(zt), BL(zt), [[0, 0], [0.13, 0], [0.13, 1.3], [0, 1.3]]);
        quad(part, FR(zb), FL(zb), FL(zt), FR(zt), [[0, 0], [1.3, 0], [1.3, 0.05], [0, 0.05]]);
        quad(part, BL(zb), BR(zb), BR(zt), BL(zt), [[0, 0], [1.3, 0], [1.3, 0.05], [0, 0.05]]);
        stats.sleepers++;
      }
    }
  });
  const out = [];
  for (const t of tiles.values()) {
    let tri = 0; let sx = 0; let sy = 0; let zMin = Infinity; let cnt = 0;
    for (const p of Object.values(t.parts)) {
      tri += p.pos.length / 9;
      for (let q = 0; q < p.pos.length; q += 3) { sx += p.pos[q]; sy += p.pos[q + 1]; zMin = Math.min(zMin, p.pos[q + 2]); cnt++; }
    }
    if (!tri) continue;
    t.origin = [Math.round((sx / cnt) * 100) / 100, Math.round((sy / cnt) * 100) / 100, Math.round(zMin * 100) / 100];
    t.triangles = tri;
    stats.triangles += tri;
    out.push(t);
  }
  stats.trackKm = Math.round(stats.trackKm * 100) / 100;
  return { tiles: out, stats };
}

// ── Decals: crossings and street-running trams ─────────────────────────────

const DECAL_STEP_M = 2;

/** Points every step metres along [[x, y, z]...] (its ends kept). */
function densify(pts, step = DECAL_STEP_M) {
  const out = [pts[0]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]; const b = pts[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(L / step));
    for (let j = 1; j <= k; j++) out.push([a[0] + (b[0] - a[0]) * (j / k), a[1] + (b[1] - a[1]) * (j / k), a[2] + (b[2] - a[2]) * (j / k)]);
  }
  return out;
}

/**
 * The surface of each level crossing: the game's tram-rail decal along each
 * track through the road, as wide as its rails' strip, at the solved height
 * (the road meets the rails there). Returns DecalRoad node lists
 * [{ nodes: [[x, y, z, width]...], tracks }] (one per track).
 */
export function crossingDecals(graph, { tagsOf = () => ({}) } = {}) {
  const z = graph.profile?.z;
  if (!z) return [];
  const out = [];
  graph.edges.forEach((e, k) => {
    if (!e.rail || !e.crossingZones?.length || e.rail === 'monorail') return;
    const tags = tagsOf(e) || {};
    const gauge = gaugeOf(tags);
    const width = TRAMLINE_WIDTH_M * (gauge / STANDARD_GAUGE_M);
    const nTracks = tracksOf(tags);
    const scale = Math.max(0.7, gauge / STANDARD_GAUGE_M);
    const n = e.s.length;
    // a point at arc length sv, offset o to the left
    const at = (sv, o) => {
      let i = 0; while (i + 2 < n && e.s[i + 1] < sv) i++;
      const f = Math.max(0, Math.min(1, (sv - e.s[i]) / ((e.s[i + 1] - e.s[i]) || 1)));
      const dx = e.x[i + 1] - e.x[i]; const dy = e.y[i + 1] - e.y[i]; const L = Math.hypot(dx, dy) || 1;
      return [e.x[i] + dx * f - (dy / L) * o, e.y[i] + dy * f + (dx / L) * o, z[k][i] + (z[k][i + 1] - z[k][i]) * f];
    };
    for (const [za, zb] of e.crossingZones) {
      // (a little past each end: over the road's edge, onto the ballast's end)
      const s0 = Math.max(0, za - CROSSING_DECAL_OVER_M); const s1 = Math.min(e.s[n - 1], zb + CROSSING_DECAL_OVER_M);
      if (s1 - s0 < 1) continue;
      const steps = Math.max(1, Math.ceil((s1 - s0) / DECAL_STEP_M));
      for (let t = 0; t < nTracks; t++) {
        const o = (t - (nTracks - 1) / 2) * TRACK_SPACING_M * scale;
        const nodes = [];
        for (let q = 0; q <= steps; q++) {
          const p = at(s0 + ((s1 - s0) * q) / steps, o);
          nodes.push([p[0], p[1], Math.round(p[2] * 1000) / 1000, width]);
        }
        out.push({ nodes, edge: k });
      }
    }
  });
  return out;
}
const CROSSING_DECAL_OVER_M = 0.3;

/**
 * Trams running in a street, drawn on its surface: the game's tram-rail
 * decal along each line, its nodes on the ground (a DecalRoad lies on the
 * terrain, where the street's own decal lies). lines: [{ xy: [[x, y]...], tags }];
 * groundAt(x, y). Returns [{ nodes }].
 */
export function streetTramDecals(lines, groundAt) {
  const out = [];
  for (const l of lines) {
    if (!(l.xy?.length >= 2)) continue;
    const width = TRAMLINE_WIDTH_M * (gaugeOf(l.tags) / STANDARD_GAUGE_M);
    const pts = densify(l.xy.map(([x, y]) => [x, y, 0]));
    out.push({ nodes: pts.map(([x, y]) => [x, y, Math.round(groundAt(x, y) * 1000) / 1000, width]) });
  }
  return out;
}

// ── Counts for the export report ─────────────────────────────────────────

const TUNNEL_KINDS = new Set(['external', 'boredTunnel', 'cutAndCover']);

/**
 * What the railways came out as: lines and km by kind, km per structure
 * kind (deck, embankment, cutting, tunnel), the rail bridges and tunnels
 * (runs of deck / tube), level crossings, and the steepest grade each kind
 * was built at.
 */
export function railwayStats(graph, segments = []) {
  const { edges } = graph;
  const z = graph.profile?.z;
  const kindAt = edges.map((e) => new Array(e.s.length).fill('ground'));
  for (const seg of graph.classes?.segments || []) for (let i = seg.i0; i <= seg.i1; i++) kindAt[seg.edge][i] = seg.kind;
  const byKind = {};
  const lines = new Map();
  const structureKm = {};
  const steepest = {};
  let deckRuns = 0; let tunnelRuns = 0;
  const bridgeNames = new Set(); const tunnelNames = new Set();
  edges.forEach((e, k) => {
    if (!e.rail) return;
    const seg = segments[e.seg];
    const kind = e.rail;
    const b = (byKind[kind] ||= { lines: 0, km: 0, bridgeKm: 0, tunnelKm: 0 });
    if (seg && !lines.has(seg.sourceFeature)) { lines.set(seg.sourceFeature, kind); b.lines++; }
    b.km += e.length / 1000;
    let prev = null;
    for (let i = 0; i + 1 < e.s.length; i++) {
      const ds = e.s[i + 1] - e.s[i];
      const kk = kindAt[k][i];
      structureKm[kk] = (structureKm[kk] || 0) + ds / 1000;
      if (kk === 'deck') b.bridgeKm += ds / 1000;
      if (TUNNEL_KINDS.has(kk)) b.tunnelKm += ds / 1000;
      if (kk !== prev) {
        if (kk === 'deck') { deckRuns++; const nm = seg?.tags?.['bridge:name'] || seg?.tags?.name; if (nm) bridgeNames.add(nm); }
        if (TUNNEL_KINDS.has(kk)) { tunnelRuns++; const nm = seg?.tags?.['tunnel:name'] || seg?.tags?.name; if (nm) tunnelNames.add(nm); }
      }
      prev = kk;
      if (z && ds > 1) {
        const g = Math.abs(z[k][i + 1] - z[k][i]) / ds;
        if (!steepest[kind] || g > steepest[kind].grade) steepest[kind] = { grade: g, x: e.x[i], y: e.y[i], edge: k };
      }
    }
  });
  for (const v of Object.values(byKind)) for (const key of ['km', 'bridgeKm', 'tunnelKm']) v[key] = Math.round(v[key] * 100) / 100;
  for (const key of Object.keys(structureKm)) structureKm[key] = Math.round(structureKm[key] * 100) / 100;
  const crossings = graph.railCrossings || [];
  return {
    byKind, structureKm, steepest,
    lines: lines.size,
    bridgeRuns: deckRuns, tunnelRuns,
    bridgeNames: [...bridgeNames], tunnelNames: [...tunnelNames],
    roadCrossings: crossings.filter((c) => !c.path).length,
    pathCrossings: crossings.filter((c) => c.path).length,
    unjoinedCrossings: (graph.railUnjoined || []).length,
  };
}
