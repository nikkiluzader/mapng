// In-game test probes: points where the level's surfaces should be, sampled
// from what the export built, shipped with the level (mapng_probes.json) so
// scripts/ingame/runIngameTests.mjs can drop rays onto them in BeamNG and
// compare what is really there (terrain, a deck, a sidewalk, something in the
// way). Nothing here knows about any place.
//
// probe { k: kind, x, y, z, ... }:
//   road      a ground carriageway's surface (the terrain under its decal)
//   deck      a bridge deck's road surface (the deck mesh)
//   sidewalk  a sidewalk slab's top
//   tunnel    a tunnel's road surface, from inside (a roof over it)
//   spawn     the spawn point's ground

const ROAD_STEP_M = 40;
const DECK_STEP_M = 12;
const SIDEWALK_STEP_M = 30;
const TUNNEL_STEP_M = 15;
const MAX = { road: 600, deck: 300, sidewalk: 400, tunnel: 150 };

const r2 = (v) => Math.round(v * 100) / 100;

// points every `step` m along a node line (x, y, z), each with its heading
function along(nodes, step, offset = step / 2) {
  const out = [];
  let next = offset; let s = 0;
  for (let i = 0; i + 1 < nodes.length; i++) {
    const a = nodes[i]; const b = nodes[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (L > 1e-6 && next <= s + L) {
      const t = (next - s) / L;
      out.push({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, z: a[2] + (b[2] - a[2]) * t, dx: (b[0] - a[0]) / L, dy: (b[1] - a[1]) / L });
      next += step;
    }
    s += L;
  }
  return out;
}

// every n-th, to at most max (deterministic)
const thin = (list, max) => (list.length <= max ? list : list.filter((_, i) => i % Math.ceil(list.length / max) === 0));

/**
 * carriageways: drawn road lines [{ nodes: [[x, y, z]...], highway, carried?,
 *   bridge?, tunnel? }] (roadLinesFromDecals); sidewalkRuns: from
 *   buildSidewalkMeshes (points on the curb line at road height, side, width);
 * underStructure(x, y, z, zTop): a deck or tunnel over the point;
 * curbHeight: a slab's top over its road.
 */
export function buildIngameProbes({ carriageways = [], sidewalkRuns = [], underStructure = () => false, spawn = null, curbHeight = 0.15 }) {
  const road = []; const deck = []; const sidewalk = []; const tunnel = [];
  for (const cw of carriageways) {
    const n = cw.nodes || [];
    if (n.length < 2) continue;
    if (cw.tunnel) {
      for (const p of along(n, TUNNEL_STEP_M)) tunnel.push({ k: 'tunnel', x: r2(p.x), y: r2(p.y), z: r2(p.z), road: cw.highway });
    } else if (cw.carried || cw.bridge) {
      for (const p of along(n, DECK_STEP_M)) deck.push({ k: 'deck', x: r2(p.x), y: r2(p.y), z: r2(p.z), road: cw.highway });
    } else {
      for (const p of along(n, ROAD_STEP_M)) {
        // (a road under a deck or in a tunnel's shadow: the ray meets that first)
        if (underStructure(p.x, p.y, p.z, p.z + 60)) continue;
        road.push({ k: 'road', x: r2(p.x), y: r2(p.y), z: r2(p.z), road: cw.highway });
      }
    }
  }
  for (const run of sidewalkRuns) {
    const w = run.width;
    for (const p of along(run.points, SIDEWALK_STEP_M)) {
      const nx = -p.dy * run.side; const ny = p.dx * run.side;
      const x = p.x + nx * (w / 2 + 0.15); const y = p.y + ny * (w / 2 + 0.15);
      if (underStructure(x, y, p.z, p.z + 60)) continue;
      sidewalk.push({ k: 'sidewalk', x: r2(x), y: r2(y), z: r2(p.z + curbHeight), road: run.highway });
    }
  }
  const probes = [
    ...thin(road, MAX.road), ...thin(deck, MAX.deck), ...thin(sidewalk, MAX.sidewalk), ...thin(tunnel, MAX.tunnel),
  ];
  if (spawn) probes.push({ k: 'spawn', x: r2(spawn[0]), y: r2(spawn[1]), z: r2(spawn[2]) });
  return { version: 1, probes };
}

/**
 * Judge ray results for each probe:
 *   z, obj, cls  the first hit of a ray from far over the probe
 *   lz, lobj     ... of a ray from a car's height over it (under tree crowns)
 *   below        a sidewalk: its top over the terrain under it
 *   roof         a tunnel: the first hit up from 1.5 m over its road
 * Tree crowns over a road and a deck crossing over another are fine; a
 * building over a road or sidewalk, anything standing on it at a car's
 * height, a surface off its height or missing are not.
 * Returns { byKind: { kind: { n, fail } }, failures: [...] }.
 */
export function judgeProbes(probes, hits) {
  const byKind = {}; const failures = [];
  const fail = (p, why, extra) => failures.push({ k: p.k, why, x: p.x, y: p.y, z: p.z, road: p.road, ...extra });
  const isTerrainHit = (obj, cls) => /terrain/i.test(cls || '') || obj === 'theTerrain';
  const isTree = (obj, cls) => /forest/i.test(`${obj} ${cls}`);
  const isDeck = (obj) => /^bridge_/.test(obj || '');
  const isBuilding = (obj) => /^osm_objects|building/i.test(obj || '');
  probes.forEach((p, i) => {
    const h = hits[i] || {};
    const kind = (byKind[p.k] ||= { n: 0, fail: 0 });
    kind.n++;
    const before = failures.length;
    const obj = h.obj || 'none';
    const dz = Number.isFinite(h.z) ? h.z - p.z : null;
    const ldz = Number.isFinite(h.lz) ? h.lz - p.z : null;
    const lobj = h.lobj || 'none';
    if (p.k === 'tunnel') {
      if (dz === null || Math.abs(dz) > 0.6) fail(p, 'tunnel road surface off', { dz: dz === null ? null : r2(dz), obj });
      else if (!Number.isFinite(h.roof) || h.roof > 12) fail(p, 'no roof over the tunnel road', { roof: h.roof ?? null });
    } else if (p.k === 'spawn') {
      if (dz === null || dz < -3 || dz > 1) fail(p, 'spawn not over a surface near it', { dz: dz === null ? null : r2(dz), obj });
    } else if (ldz === null && dz === null) {
      fail(p, 'nothing under it (a hole in the world)');
    } else {
      // over it from far up: a building (not a tree crown, not a deck crossing over)
      if (dz !== null && dz > 2 && isBuilding(obj)) fail(p, `building over the ${p.k}: ${obj}`, { dz: r2(dz), obj });
      // from a car's height: the surface itself, or what stands on it
      else if (ldz !== null && ldz > 0.3 && !isTerrainHit(lobj, h.lcls) && !(p.k !== 'sidewalk' && isDeck(lobj) && ldz > 2)) {
        fail(p, `${isTree(lobj, h.lcls) ? 'tree' : 'object'} standing on the ${p.k}: ${lobj}`, { dz: r2(ldz), obj: lobj });
      } else if (p.k === 'road') {
        if (ldz > 0.5) fail(p, 'terrain over the road surface', { dz: r2(ldz) });
        else if (ldz < -0.5) fail(p, 'terrain under the road surface (dip)', { dz: r2(ldz) });
      } else if (p.k === 'deck') {
        if (ldz < -0.5) fail(p, `no deck under the road (fell to ${isTerrainHit(lobj, h.lcls) ? 'terrain' : lobj})`, { dz: r2(ldz), obj: lobj });
        else if (ldz > 0.5) fail(p, 'terrain over the deck', { dz: r2(ldz) });
      } else if (p.k === 'sidewalk') {
        if (isTerrainHit(lobj, h.lcls) && ldz > 0.15) fail(p, 'terrain over the sidewalk', { dz: r2(ldz) });
        else if (ldz < -0.3) fail(p, 'no sidewalk here', { dz: r2(ldz), obj: lobj });
        else if (Number.isFinite(h.below) && h.below > 0.45) fail(p, 'sidewalk floating over the terrain', { gap: r2(h.below) });
      }
    }
    if (failures.length > before) kind.fail++;
  });
  return { byKind, failures };
}
