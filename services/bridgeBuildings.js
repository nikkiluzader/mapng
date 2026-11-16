// Buildings that are part of a bridge, left to the bridge's own builder. Nothing here knows about any place.
//
// 1. A building a road passes through up on a bridge (tunnel=building_passage on layer 1 or more): a bridge's
//    tower or gatehouse. Built from the ground as a house, its walls stood across the deck (Tower Bridge).
// 2. A building whose middle lies inside a bridge's own outline (man_made=bridge), with one of the bridge's roads
//    for traffic through it or within TOWER_REACH_M of it (past its sidewalks): its towers, split round the road's
//    arches (the Roebling Bridge's four parts). Shops on a bridge for walking stay: footways and pedestrian
//    streets are not roads for traffic here.

const TOWER_REACH_M = 7;
const WALK = new Set(['footway', 'pedestrian', 'path', 'cycleway', 'steps', 'bridleway', 'corridor']);

const inRing = (p, g) => {
  let k = false;
  for (let i = 0, j = g.length - 1; i < g.length; j = i++) {
    if (((g[i].lat > p.lat) !== (g[j].lat > p.lat)) && (p.lng < ((g[j].lng - g[i].lng) * (p.lat - g[i].lat)) / (g[j].lat - g[i].lat) + g[i].lng)) k = !k;
  }
  return k;
};

/**
 * features: parsed OSM features ({ type, tags, geometry: [{ lat, lng }] }). Returns { features (without the
 * bridges' buildings), passage: n left by rule 1, towers: n left by rule 2 }.
 */
export function leaveBridgeBuildings(features = []) {
  let out = features; let passage = 0; let towers = 0;
  const isBuilding = (f) => f.type === 'building' && f.geometry?.length > 2;
  const raised = out.filter((f) => f.type === 'road' && f.tags?.tunnel === 'building_passage' && (Number.parseInt(f.tags.layer, 10) || 0) >= 1 && f.geometry?.length > 1);
  if (raised.length) {
    // (each vertex and each stretch's middle: a short passage may have no vertex inside the building)
    const pts = raised.flatMap((f) => f.geometry.flatMap((p, i) => (i ? [p, { lat: (p.lat + f.geometry[i - 1].lat) / 2, lng: (p.lng + f.geometry[i - 1].lng) / 2 }] : [p])));
    const kept = out.filter((f) => !(isBuilding(f) && pts.some((p) => inRing(p, f.geometry))));
    passage = out.length - kept.length; out = kept;
  }
  const bridgeRings = out.filter((f) => f.type === 'bridge_infra' && f.geometry?.length > 3).map((f) => f.geometry);
  if (bridgeRings.length) {
    const deckRoads = out.filter((f) => f.type === 'road' && f.tags?.bridge && f.tags.bridge !== 'no' && !WALK.has(f.tags.highway) && f.geometry?.length > 1);
    const near = (g, road) => {
      const kx = 111320 * Math.cos((g[0].lat * Math.PI) / 180); const ky = 110574;
      for (const p of g) for (let i = 0; i + 1 < road.length; i++) {
        const ax = (road[i].lng - p.lng) * kx; const ay = (road[i].lat - p.lat) * ky; const bx = (road[i + 1].lng - p.lng) * kx; const by = (road[i + 1].lat - p.lat) * ky;
        const vx = bx - ax; const vy = by - ay; const u = Math.max(0, Math.min(1, -(ax * vx + ay * vy) / (vx * vx + vy * vy || 1e-9)));
        if (Math.hypot(ax + vx * u, ay + vy * u) < TOWER_REACH_M) return true;
      }
      return road.some((q) => inRing(q, g));
    };
    const kept = out.filter((f) => {
      if (!isBuilding(f)) return true;
      const c = { lat: f.geometry.reduce((s, p) => s + p.lat, 0) / f.geometry.length, lng: f.geometry.reduce((s, p) => s + p.lng, 0) / f.geometry.length };
      if (!bridgeRings.some((r) => inRing(c, r))) return true;
      return !deckRoads.some((rd) => near(f.geometry, rd.geometry));
    });
    towers = out.length - kept.length; out = kept;
  }
  return { features: out, passage, towers };
}
