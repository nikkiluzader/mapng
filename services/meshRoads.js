// The export's Road surfaces > Mesh Roads (experimental) choice: a BeamNG MeshRoad under each paved road on the
// ground, so cars drive on a smooth deck instead of the terrain's grid. MeshRoad is a level object the game
// documents (documentation.beamng.com/modding/levels/level_classes/meshroad): it is saved in the level, so
// nothing is built when the level loads and the World Editor shows nothing extra.
//
// The road's look stays MapNG's own. Each decal that lies over a deck (surface, lines, junction markings,
// crossings) is lifted onto it and told to draw over objects (DecalRoad overObjects), as on a bridge deck; the
// DecalRoads also stay what traffic and navigation read. The deck's own material shows only where no decal
// covers it.
//
// The deck's height along a road:
//   - a base line: the road's own smoothed height along its line (what the terrain under it was levelled to);
//   - over it, what the deck must clear: the highest ground across the inner road at each node (the terrain's
//     grid stands a few centimetres over the road's line here and there: the bumps the deck is for), and any
//     other deck it crosses or meets at its own level (two roads at a junction share one height, or the higher
//     deck is a step);
//   - that need spread along the road at a gentle slope, so one high node is a long ramp and not a bump.
// The deck is level across (its normals point up): a road on a slope the terrain was not levelled for stands
// out of the ground on its low side, and its depth reaches down to cover that.

export const MESH_ROAD_MATERIAL = 'mapng_meshroad_asphalt';
export const MESH_ROAD_MATERIAL_DEF = {
  name: MESH_ROAD_MATERIAL, mapTo: MESH_ROAD_MATERIAL, class: 'Material', annotation: 'ASPHALT', groundType: 'ASPHALT',
  Stages: [{
    ambientOcclusionMap: '/assets/materials/tileable/road/road_asphalt_light/t_road_asphalt1_ao.data.png',
    baseColorMap: '/assets/materials/decalroad/asphalt/road_rubber_sticky/t_road_asphalt1_b.color.png',
    normalMap: '/assets/materials/tileable/road/road_asphalt_light/t_road_asphalt1_nm.normal.png',
    roughnessMap: '/assets/materials/decalroad/asphalt/road_rubber_sticky/t_asphalt1_r.data.png',
  }, {}, {}, {}],
  translucentBlendOp: 'None', version: 1.5,
};

const NODE_GAP_M = 5;          // a deck node about this often (the docs: reasonably even spacing, few nodes)
const MIN_WIDTH_M = 3;
const OVER_GROUND_M = 1.0;     // a road line this far over or under the ground is a bridge, ramp or tunnel: no deck
const CLEAR_M = 0.03;          // the deck over the highest ground under it
// The ground the deck must clear is looked at over this share of the road's half-width. At the very edge the
// terrain's squares already blend into the bank, kerb or wall beside the road (measured: level within 4 cm out
// to 75 % at 90 % of nodes, 8 cm higher at the edge at half of them): a deck lifted over that stood 15 cm to 2 m
// over the road it replaced.
const INNER = 0.75;
const MAX_NEED_M = 0.3;       // ground higher than this over the road's line is left to stand through the deck's edge
const RAMP_SLOPE = 0.03;       // a height taken from the ground or another deck is eased along the road at this slope
const MIN_DEPTH_M = 0.3;
const MAX_DEPTH_M = 3;
// A deck over the same spot within this of a road's own height is the same surface, and the road takes its
// height there; further apart they are two levels (a road beside an embankment, a road under a ramp: at 1 m two
// carriageways 0.7 m apart at an interchange were pulled to one height).
const SAME_LEVEL_M = 0.45;
const END_LEVEL_M = 2.0;         // ... and an end that shares its point with another deck, within this
const CROSS_TUCK_M = 0.5;      // a road crossing a deck ends at least this far inside that deck's edge
const CROSS_SINK_M = 0.02;     // ... and this far under its surface there (two tops at one height flicker)
const END_ZONE_M = 6;          // near an end that meets another deck the road is at that deck's level
const SCAN_M = 0.25;          // how finely a road's line is looked along for the decks it lies in
const CAMBER_AT = [-0.9, -0.675, -0.45, -0.225, 0, 0.225, 0.45, 0.675, 0.9];   // where the ground is read across a road, in half widths
const CAMBER_SPAN = 5;           // ... and how many of those in a row make the half width a lean is read from
const CAMBER_MIN = 0.01;         // the ground leaning less than this across a road: a level road
const CAMBER_MAX = 0.1;          // ... and no deck leans more than this to follow it
const LEAN_EASE = 0.0075;       // how fast a deck's lean eases out beyond the deck it took it from, per metre
const TILT_EDGE_M = 0.25;       // a deck is tilted to another's slope by no more than lifts its edge this much
const END_NEED_M = 0.05;        // a deck's end with no deck beyond it: this far over the road's own line
const DECAL_OVER_DECK_M = 0.02;
const CELL_M = 16;
const EDGE_NODE_MIN_M = 0.4;   // no extra node this close to one that is there
const JOIN_MAX_M = 400;       // pieces are joined into one deck up to this length
const JUNCTION_REACH_M = 4;    // a deck runs on this far into a junction (the widest road's half-width there at most)
const CORNER_COS = Math.cos(60 * Math.PI / 180);    // two ends alone join into one deck up to a 60 degree bend
const THROUGH_COS = Math.cos(35 * Math.PI / 180);   // two ends within 35 degrees of straight are one road through a junction

const isPavedSurface = (decal) => /asphalt|concrete/i.test(String(decal.material || ''));
const isBase = (name) => /^dr_.*_s\d+_b$/.test(name);
// (not lifted: the grass blends beside a road lie outside its deck; the AI path is not drawn)
const stayOnGround = (name) => /_(ebl|ebr|ai)(_\d+)?$/.test(name);

/** A line resampled to a node about every gap metres, its ends kept. */
function resample(nodes, gap) {
  const out = [];
  let acc = 0;
  out.push([nodes[0][0], nodes[0][1], nodes[0][2]]);
  for (let i = 1; i < nodes.length; i++) {
    let ax = nodes[i - 1][0]; let ay = nodes[i - 1][1]; let az = nodes[i - 1][2];
    const bx = nodes[i][0]; const by = nodes[i][1]; const bz = nodes[i][2];
    let d = Math.hypot(bx - ax, by - ay);
    while (acc + d >= gap) {
      const t = (gap - acc) / d;
      ax += (bx - ax) * t; ay += (by - ay) * t; az += (bz - az) * t;
      out.push([ax, ay, az]);
      d = Math.hypot(bx - ax, by - ay);
      acc = 0;
    }
    acc += d;
  }
  const last = nodes[nodes.length - 1];
  const tail = out[out.length - 1];
  // (the end always a node; a node almost on it gives way to it)
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) < gap * 0.4 && out.length > 1) out.pop();
  out.push([last[0], last[1], last[2]]);
  return out;
}

/**
 * The decks for the paved ground roads among groups (the export's DecalRoad groups: [{ __items: [decal] }]), and
 * the decals over them lifted onto them. drapeAt(x, y): the drawn terrain's height. Returns
 * { meshRoads, stats: { decks, skipped, lifted, nodes } }; the decals are changed in place.
 */
export function buildMeshRoads(groups, drapeAt, { makeId = () => undefined } = {}) {
  const stats = { decks: 0, skipped: 0, lifted: 0, nodes: 0, joined: 0, crossings: 0 };
  // one piece for each paved road surface on the ground: its line resampled, each node { x, y, base, hw }
  let pieces = [];
  for (const group of groups) {
    for (const decal of group.__items || []) {
      if (decal?.class !== 'DecalRoad' || !isBase(String(decal.name || '')) || !Array.isArray(decal.nodes) || decal.nodes.length < 2) continue;
      const width = Number(decal.nodes[decal.nodes.length >> 1][3]);
      if (!isPavedSurface(decal) || !(width >= MIN_WIDTH_M) || decal.overObjects
        || decal.nodes.some((n) => Math.abs(n[2] - drapeAt(n[0], n[1])) > OVER_GROUND_M)) { stats.skipped++; continue; }
      const pts = resample(decal.nodes, NODE_GAP_M);
      if (pts.length < 2) { stats.skipped++; continue; }
      // (the base line: the road's own height along its line, MapNG's smoothed profile, which the terrain under
      // the road was levelled to; measured on a hill town: the ground on the centre line is within a centimetre
      // of it at 99 % of nodes)
      pieces.push({ name: String(decal.name), nodes: pts.map((q) => ({ x: q[0], y: q[1], base: q[2], hw: width / 2 })) });
    }
  }

  // Pieces joined end to end into one deck where just two of them meet (a road cut in pieces at a junction that
  // is none for the deck, or where its width changes): every MeshRoad ends square to its own line, so two that
  // met at a bend left an open wedge between them, seen in game on the first trial. A deck's width is per node,
  // so joined pieces keep their own. Not past JOIN_MAX_M: the game draws a MeshRoad whole or not at all.
  const endKey = (q) => `${Math.round(q.x * 10)},${Math.round(q.y * 10)}`;
  const lengthOf = (nodes) => { let L = 0; for (let i = 1; i < nodes.length; i++) L += Math.hypot(nodes[i].x - nodes[i - 1].x, nodes[i].y - nodes[i - 1].y); return L; };
  for (const pc of pieces) { pc.length = lengthOf(pc.nodes); pc.keys = new Set([endKey(pc.nodes[0]), endKey(pc.nodes[pc.nodes.length - 1])]); }
  const meetAt = () => {
    const at = new Map();
    for (const pc of pieces) for (const q of [pc.nodes[0], pc.nodes[pc.nodes.length - 1]]) { const k = endKey(q); if (!at.has(k)) at.set(k, []); at.get(k).push(pc); }
    return at;
  };
  const met = new Map([...meetAt()].map(([k, list]) => [k, { n: list.length, hw: Math.max(...list.map((pc) => pc.nodes[0].hw)) }]));
  // (the direction a piece leaves its end at key k)
  const awayFrom = (pc, k) => {
    const first = endKey(pc.nodes[0]) === k;
    const e = first ? pc.nodes[0] : pc.nodes[pc.nodes.length - 1];
    const q = first ? pc.nodes[1] : pc.nodes[pc.nodes.length - 2];
    const L = Math.hypot(q.x - e.x, q.y - e.y) || 1;
    return [(q.x - e.x) / L, (q.y - e.y) / L];
  };
  for (let again = true; again;) {
    again = false;
    for (const [k, all] of meetAt()) {
      const list = all.filter((pc) => !pc.gone);
      if (list.length < 2 || new Set(list).size !== list.length) continue;
      // two ends: one road. More (a junction): the pair that runs straightest through it is the through road,
      // one deck across the junction; the others end in it (below).
      // (two ends at a sharp corner stay two decks, each run on past the corner: one deck bent sharply
      // there is pinched by its own spline)
      let pair = null; let best = list.length === 2 ? CORNER_COS : THROUGH_COS;
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const u = awayFrom(list[i], k); const v = awayFrom(list[j], k);
        const straight = -(u[0] * v[0] + u[1] * v[1]);   // 1: dead straight through
        if (straight > best) { best = straight; pair = [list[i], list[j]]; }
      }
      if (!pair || pair[0].length + pair[1].length > JOIN_MAX_M) continue;
      // (not into a ring: a deck that came back through a junction it had already crossed lay over itself
      // there at two heights)
      if ([...pair[1].keys].some((q) => q !== k && pair[0].keys.has(q))) continue;
      const [a, b] = pair;
      if (endKey(a.nodes[a.nodes.length - 1]) !== k) a.nodes.reverse();
      if (endKey(b.nodes[0]) !== k) b.nodes.reverse();
      if (endKey(a.nodes[a.nodes.length - 1]) !== k || endKey(b.nodes[0]) !== k) continue;
      a.nodes.push(...b.nodes.slice(1));
      a.length += b.length;
      for (const q of b.keys) a.keys.add(q);
      b.gone = true;
      stats.joined++;
      again = true;
    }
    pieces = pieces.filter((pc) => !pc.gone);
  }
  // An end left at a junction or a corner runs on into it, so it lies well inside the other road's deck (its
  // height there is taken from that deck, below) and no wedge is left open between the two. Only as far as its
  // two corners stay inside the decks it meets: run straight on for 4 m past a bend, an end stood out over the
  // sidewalk on the outside of it (seen in game).
  const through = new Map();   // junction -> the pieces at or through it
  for (const pc of pieces) for (const k of pc.keys) { if (!through.has(k)) through.set(k, []); through.get(k).push(pc); }
  const inside = (pc, x, y) => {
    const nd = pc.nodes;
    for (let i = 1; i < nd.length; i++) {
      const a = nd[i - 1]; const b = nd[i];
      const dx = b.x - a.x; const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t)) <= a.hw + (b.hw - a.hw) * t + 0.05) return true;
    }
    return false;
  };
  const added = [];
  for (const pc of pieces) { pc.orig0 = pc.nodes[0]; pc.orig1 = pc.nodes[pc.nodes.length - 1]; }
  for (const pc of pieces) {
    for (const end of [0, 1]) {
      const nodes = pc.nodes;
      const e = end ? nodes[nodes.length - 1] : nodes[0];
      const inner = end ? nodes[nodes.length - 2] : nodes[1];
      const k = endKey(e);
      const m = met.get(k);
      // (an end no other deck meets: the road ends there, or goes on without a deck. Brought down to the ground.)
      if (!m || m.n < 2) { e.loose = true; continue; }
      e.meet = true;
      const others = (through.get(k) || []).filter((o) => o !== pc);
      const L = Math.hypot(e.x - inner.x, e.y - inner.y) || 1;
      const ux = (e.x - inner.x) / L; const uy = (e.y - inner.y) / L;
      const full = Math.min(JUNCTION_REACH_M, m.hw);
      let reach = 0;
      for (const share of [1, 0.75, 0.5, 0.25]) {
        const x = e.x + ux * full * share; const y = e.y + uy * full * share;
        const corners = [[x - uy * e.hw, y + ux * e.hw], [x + uy * e.hw, y - ux * e.hw]];
        if (corners.every(([cx, cy]) => others.some((o) => inside(o, cx, cy)))) { reach = full * share; break; }
      }
      // (the run-on carries the road's own grade on. Level, it stood 0.4 m proud 4 m down a 10 % hill: where the
      // next piece of the same road took its height from it, a 0.48 m face across the road, seen in game)
      const grade = (e.base - inner.base) / L;
      if (reach > 0) added.push({ pc, end, extra: { x: e.x + ux * reach, y: e.y + uy * reach, base: e.base + grade * reach, hw: e.hw, meet: true } });
    }
  }
  // (added after all are worked out: an end is judged against the other decks as they were)
  for (const { pc, end, extra } of added) { if (end) pc.nodes.push(extra); else pc.nodes.unshift(extra); }
  for (const pc of pieces) pc.length = lengthOf(pc.nodes);
  // The order the decks' heights are set in: a deck takes its height from the decks before it where it lies in
  // them, so the road that runs through a junction must come before the roads that end in it. (Ordered by width
  // alone, a wide side street came first: its end, lifted over the sloping ground of the junction's mouth, then
  // stood 20 to 30 cm across the through road: 97 such steps round one town's junctions.) Among roads that
  // do not end in each other: the wider first, then the longer.
  const rank = (a, b) => Math.max(...b.nodes.map((q) => q.hw)) - Math.max(...a.nodes.map((q) => q.hw)) || b.length - a.length || (a.name < b.name ? -1 : 1);
  const endsOf = (pc) => [endKey(pc.orig0), endKey(pc.orig1)];
  for (const pc of pieces) { pc.before = new Set(); pc.waits = 0; }
  for (const [k, list] of through) {
    const ending = list.filter((pc) => endsOf(pc).includes(k));
    const passing = list.filter((pc) => !endsOf(pc).includes(k));
    for (const a of passing) for (const b of ending) if (!a.before.has(b)) { a.before.add(b); b.waits++; }
  }
  const ordered = []; const left = new Set(pieces);
  while (left.size) {
    let ready = [...left].filter((pc) => pc.waits <= 0);
    if (!ready.length) ready = [...left];   // (a ring of roads ending in each other: the widest breaks it)
    ready.sort(rank);
    const pc = ready[0];
    left.delete(pc); ordered.push(pc);
    for (const b of pc.before) b.waits--;
  }
  pieces = ordered;

  const decks = pieces.map((pc) => {
    const nd = pc.nodes; const n = nd.length;
    const pts = nd.map((q) => [q.x, q.y]);
    const s = new Float64Array(n); const low = new Float64Array(n); const need = new Float64Array(n); const hw = Float64Array.from(nd, (q) => q.hw);
    const base = Float64Array.from(nd, (q) => q.base);
    // 1: an end that meets another deck (and its run-on); 2: an end with no deck beyond it
    const flag = Uint8Array.from(nd, (q) => (q.meet ? 1 : q.loose ? 2 : 0));
    // The ground's own lean across the road at each node (a banked bend the elevation data shows, a road left
    // on a side slope where the terrain was not levelled for it): the deck leans with it. A native MeshRoad is
    // flat across and takes no shape from the ground; level on leaning ground, one edge stood out of it and
    // the ground came through the other. Read from the ground across the road, evened along the road; under CAMBER_MIN it is a level road, over CAMBER_MAX it is a bank, not a camber.
    const camber = new Float64Array(n);
    {
      const raw = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(n - 1, i + 1)];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const nx = -(b[1] - a[1]) / len; const ny = (b[0] - a[0]) / len;
        // (the lean of the flattest half of the width: the road itself. A line fitted across the whole width took
        // in the hillside beside a road on a bench, or beside a line drawn a few metres off its road, and leaned
        // a level road 10 % into the slope: plain in cross-sections drawn against raw lidar)
        const offs = CAMBER_AT.map((o) => hw[i] * o); const hs = offs.map((off) => drapeAt(pts[i][0] + nx * off, pts[i][1] + ny * off));
        let best = 0; let bestAbs = Infinity;
        for (let w = 0; w + CAMBER_SPAN <= offs.length; w++) {
          let mo = 0; let mh = 0; for (let q = w; q < w + CAMBER_SPAN; q++) { mo += offs[q]; mh += hs[q]; } mo /= CAMBER_SPAN; mh /= CAMBER_SPAN;
          let sxy = 0; let sxx = 0; for (let q = w; q < w + CAMBER_SPAN; q++) { sxy += (offs[q] - mo) * (hs[q] - mh); sxx += (offs[q] - mo) ** 2; }
          const g = sxx > 0 ? sxy / sxx : 0;
          if (Math.abs(g) < bestAbs) { bestAbs = Math.abs(g); best = g; }
        }
        raw[i] = best;
      }
      for (let i = 0; i < n; i++) {
        let sum = 0; let cnt = 0;
        for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) { sum += raw[j]; cnt++; }
        const c = sum / cnt;
        camber[i] = Math.abs(c) < CAMBER_MIN ? 0 : Math.max(-CAMBER_MAX, Math.min(CAMBER_MAX, c));
      }
    }
    for (let i = 0; i < n; i++) {
      if (i) s[i] = s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(n - 1, i + 1)];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = -(b[1] - a[1]) / len; const ny = (b[0] - a[0]) / len;
      // (the ground the node answers for: across the inner road, and along it half-way to the nodes either
      // side; looked at only at the nodes, a hump of the terrain's grid between two of them stood through the deck)
      // (each spot against the road's own height there: on a hill the ground 2 m on is higher by the hill)
      let over = -Infinity; let lo = drapeAt(pts[i][0], pts[i][1]);
      for (const along of [-0.4, -0.2, 0, 0.2, 0.4]) {
        const j = along < 0 ? Math.max(0, i - 1) : Math.min(n - 1, i + 1);
        const o2 = pts[j];
        const baseHere = base[i] + (base[j] - base[i]) * Math.abs(along);
        const cx = pts[i][0] + (o2[0] - pts[i][0]) * Math.abs(along); const cy = pts[i][1] + (o2[1] - pts[i][1]) * Math.abs(along);
        for (const o of [-INNER, -INNER / 2, 0, INNER / 2, INNER]) {
          const h = drapeAt(cx + nx * hw[i] * o, cy + ny * hw[i] * o);
          // (against the deck as it leans there)
          const top = baseHere + camber[i] * hw[i] * o;
          if (h - top > over) over = h - top;
          if (h < lo) lo = h;
        }
      }
      low[i] = lo;
      need[i] = Math.max(CLEAR_M, Math.min(MAX_NEED_M, over + CLEAR_M));
    }
    return { name: pc.name, pts, s, hw, base, need, low, flag, camber, z: new Float64Array(n) };
  });

  // every set deck's pieces by cell: which decks lie under a point, and how high
  const cells = new Map();
  const key = (cx, cy) => cx * 65536 + cy;
  const indexDeck = (d, k) => {
    for (let i = 1; i < d.pts.length; i++) {
      const a = d.pts[i - 1]; const b = d.pts[i];
      const hw = Math.max(d.hw[i - 1], d.hw[i]);
      const x0 = Math.floor((Math.min(a[0], b[0]) - hw) / CELL_M); const x1 = Math.floor((Math.max(a[0], b[0]) + hw) / CELL_M);
      const y0 = Math.floor((Math.min(a[1], b[1]) - hw) / CELL_M); const y1 = Math.floor((Math.max(a[1], b[1]) + hw) / CELL_M);
      for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
        const c = key(cx, cy);
        let list = cells.get(c);
        if (!list) cells.set(c, (list = []));
        list.push(k, i);
      }
    }
  };
  // the deck under (x, y) nearest height `near` and within `reach` of it, of the decks already set, but for deck
  // `not`; -Infinity where there is none
  const slopeAt = [0, 0];      // set by deckAt: the found deck's rise a metre east and a metre north
  const deckAt = (x, y, near, reach, not = -1) => {
    const list = cells.get(key(Math.floor(x / CELL_M), Math.floor(y / CELL_M)));
    let best = -Infinity; let bestSide = false;
    slopeAt[0] = 0; slopeAt[1] = 0;
    if (!list) return best;
    for (let q = 0; q < list.length; q += 2) {
      const k = list[q]; if (k === not) continue;
      const d = decks[k]; const i = list[q + 1];
      const a = d.pts[i - 1]; const b = d.pts[i];
      const dx = b[0] - a[0]; const dy = b[1] - a[1];
      const L2 = dx * dx + dy * dy || 1;
      const raw = ((x - a[0]) * dx + (y - a[1]) * dy) / L2;
      // (a deck ends square: past its last node it is not there. Taken as rounded off there, a deck counted as
      // lying under the first metres of the next piece of its own road, which then took its end's height and
      // ran 0.2 to 0.45 m under its own line: the sunk stretches after every cut in a long road.)
      if ((i === 1 && raw < 0) || (i === d.pts.length - 1 && raw > 1)) continue;
      const t = Math.max(0, Math.min(1, raw));
      if (Math.hypot(x - (a[0] + dx * t), y - (a[1] + dy * t)) > d.hw[i - 1] + (d.hw[i] - d.hw[i - 1]) * t) continue;
      // (the deck's height there: along its line, and across it by its lean)
      const L = Math.sqrt(L2); const off = ((x - a[0]) * -dy + (y - a[1]) * dx) / L;
      const leanHere = d.lean ? d.lean[i - 1] + (d.lean[i] - d.lean[i - 1]) * t : 0;
      const z = d.z[i - 1] + (d.z[i] - d.z[i - 1]) * t + leanHere * off;
      // (a stretch the point lies beside counts before one it lies past the end of: taken by height alone, a
      // point beside a node 3 m along a climbing deck was given the node's own height, 18 cm off at 6 %)
      const side = raw >= 0 && raw <= 1;
      if (Math.abs(z - near) <= reach && (best === -Infinity || (side && !bestSide) || (side === bestSide && Math.abs(z - near) < Math.abs(best - near)))) {
        best = z; bestSide = side;
        // (how that deck's surface rises there: along its line, level across)
        const g = (d.z[i] - d.z[i - 1]) / L2;
        slopeAt[0] = g * dx + (leanHere * -dy) / L; slopeAt[1] = g * dy + (leanHere * dx) / L;
      }
    }
    return best;
  };

  // The heights, the wider roads first. A node inside a deck already set takes that deck's height (a side road's
  // end inside the through road, two roads crossing): one surface, no step. The other nodes take what they need
  // over their own line, and both are eased along the road at RAMP_SLOPE.
  // (by index, not forEach: a deck cut at a crossing puts its far part in the list right after itself)
  for (let k = 0; k < decks.length; k++) {
    const d = decks[k];
    // (tried: a road counted as in another deck as soon as its edge reached it. Worse in game: 35 steps over
    // 8 cm where this had 20, roads beside each other on a slope pulled to one height)
    // (an end that shares its point with another deck is at that deck's level whatever their lines say there:
    // a side street 0.44 m under the road it joins was taken for another level and left as a wall across itself)
    const under = (x, y, base, flag = 0) => deckAt(x, y, base, flag === 1 ? END_LEVEL_M : SAME_LEVEL_M, k);
    // Where the road lies inside decks already set, found along its whole line (not node to node: a road
    // passing from one deck straight into the next, 5 m between its nodes, was never seen to leave the first).
    // - It does not go on through such a deck: it ends just inside that deck's edge, on either side of a
    //   crossing, or at its own end in a through road, and what lay inside is left out. One deck through a
    //   crossing lay level across the other and could lean one way only; where the crossed road had a crest or
    //   a change of slope at the junction it stood 15 to 20 cm over that road's deck on one side: a step across
    //   the crossed road's lane, measured in game at 14 junctions of two towns. Each end is as far inside as
    //   puts both its corners inside, and a little under that deck's surface; left out only where all of it
    //   lies wholly under the other deck.
    // - A node stands where it passes each such edge, at that deck's height. Without it the road's own deck ran
    //   from its last node inside to its first outside (5 m off, at its own height) and stood over or under the
    //   other deck's edge by the slope between them: a step of 10 to 20 cm, measured in game.
    let out = d.ready;
    if (!out) {
      const nodes = d.pts.map((q, i) => ({ x: q[0], y: q[1], base: d.base[i], hw: d.hw[i], need: d.need[i], low: d.low[i], flag: d.flag[i], camber: d.camber ? d.camber[i] : 0 }));
      const S = [0];
      for (let i = 1; i < nodes.length; i++) S.push(S[i - 1] + Math.hypot(nodes[i].x - nodes[i - 1].x, nodes[i].y - nodes[i - 1].y));
      const total = S[S.length - 1];
      const meet0 = nodes[0].flag === 1; const meet1 = nodes[nodes.length - 1].flag === 1;
      const at = (s) => {
        let i = 1; while (i < nodes.length - 1 && S[i] < s) i++;
        const a = nodes[i - 1]; const b = nodes[i]; const L = S[i] - S[i - 1] || 1; const u = Math.max(0, Math.min(1, (s - S[i - 1]) / L));
        // (near an end that meets another deck: at that deck's level whatever the two lines say there)
        const flag = (meet0 && s < END_ZONE_M) || (meet1 && s > total - END_ZONE_M) ? 1 : 0;
        return { s, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, base: a.base + (b.base - a.base) * u, hw: a.hw + (b.hw - a.hw) * u, need: Math.max(a.need, b.need), low: Math.min(a.low, b.low), camber: (a.camber || 0) + ((b.camber || 0) - (a.camber || 0)) * u, flag, ux: (b.x - a.x) / L, uy: (b.y - a.y) / L };
      };
      const inside = (s) => { const q = at(s); return under(q.x, q.y, q.base, q.flag) > -Infinity; };
      const whole = (s) => { const q = at(s); return under(q.x, q.y, q.base, q.flag) > -Infinity && under(q.x - q.uy * q.hw, q.y + q.ux * q.hw, q.base, q.flag) > -Infinity && under(q.x + q.uy * q.hw, q.y - q.ux * q.hw, q.base, q.flag) > -Infinity; };
      const spans = []; let open = null; let ps = 0; let pin = inside(0); if (pin) open = 0;
      for (let s = SCAN_M; ps < total; s += SCAN_M) {
        const ss = Math.min(s, total); const now = inside(ss);
        if (now !== pin) {
          let lo = pin ? ps : ss; let hi = pin ? ss : ps;   // (lo: the inside end)
          for (let it = 0; it < 8; it++) { const mid = (lo + hi) / 2; if (inside(mid)) lo = mid; else hi = mid; }
          if (now) open = lo; else { spans.push([open, lo]); open = null; }
        }
        ps = ss; pin = now;
      }
      if (open !== null) spans.push([open, total]);
      const drops = []; const edges = [];
      for (const [a, b] of spans) {
        const from0 = a <= 0; const to1 = b >= total;
        if (from0 && to1) continue;   // (all of it inside other decks: left as it is)
        let sa = from0 ? 0 : a + CROSS_TUCK_M; let sb = to1 ? total : b - CROSS_TUCK_M;
        while (!from0 && sa < b && !whole(sa)) sa += SCAN_M;
        while (!to1 && sb > a && !whole(sb)) sb -= SCAN_M;
        let clear = sa < sb - 0.05 && (from0 || sa < b) && (to1 || sb > a);
        for (let s = sa; clear && s <= sb; s += 1) if (!whole(s)) clear = false;
        if (clear && !whole(sb)) clear = false;
        if (!from0) edges.push(a);
        if (!to1) edges.push(b);
        if (clear) drops.push([sa, sb]);
      }
      const parts = []; let p = 0;
      for (const [a, b] of [...drops, [total, total]]) {
        if (a > p + 0.05 || (a === total && p === 0)) parts.push([p, a]);
        p = b;
      }
      const lists = [];
      for (const [a, b] of parts) {
        const list = [];
        if (a > 0) list.push({ ...at(a), flag: 1, sink: true });
        for (let i = 0; i < nodes.length; i++) {
          if (S[i] < a - 1e-9 || S[i] > b + 1e-9) continue;
          if ((a > 0 && S[i] - a < EDGE_NODE_MIN_M) || (b < total && b - S[i] < EDGE_NODE_MIN_M)) continue;
          list.push({ ...nodes[i], s: S[i] });
        }
        if (b < total) list.push({ ...at(b), flag: 1, sink: true });
        for (const e of edges) {
          if (e <= a || e >= b || list.some((q) => Math.abs(q.s - e) < EDGE_NODE_MIN_M)) continue;
          list.push({ ...at(e), flag: 0 });
        }
        list.sort((u, v) => u.s - v.s);
        if (list.length >= 2 && list[list.length - 1].s - list[0].s > 0.5) lists.push(list);
      }
      if (!lists.length) lists.push(nodes);
      stats.crossings += drops.length;
      out = lists[0];
      const stem = d.name.replace(/_b$/, '');
      for (let j = lists.length - 1; j >= 1; j--) decks.splice(k + 1, 0, { name: `${stem}_x${j}_b`, ready: lists[j] });
    }
    d.sink = Uint8Array.from(out, (q) => (q.sink ? 1 : 0));
    d.camber = Float64Array.from(out, (q) => q.camber || 0);
    const n = out.length;
    d.pts = out.map((q) => [q.x, q.y]);
    d.base = Float64Array.from(out, (q) => q.base); d.hw = Float64Array.from(out, (q) => q.hw);
    d.need = Float64Array.from(out, (q) => q.need); d.low = Float64Array.from(out, (q) => q.low); d.flag = Uint8Array.from(out, (q) => q.flag || 0);
    d.s = new Float64Array(n); d.z = new Float64Array(n);
    for (let i = 1; i < n; i++) d.s[i] = d.s[i - 1] + Math.hypot(d.pts[i][0] - d.pts[i - 1][0], d.pts[i][1] - d.pts[i - 1][1]);
    const r = new Float64Array(n); const fixed = new Uint8Array(n);
    // A node inside another deck also takes that deck's tilt across this road's width (its normal). A deck is
    // level across its own line: a side road ending in a through road that climbs lay level across the climb,
    // its end standing 20 to 35 cm out of the through road's deck on the downhill side. Only the tilt across
    // the road counts (leaning a deck forward along its own line does nothing but turn its end face), and no
    // more than lifts its edge TILT_EDGE_M: a 21 m carriageway given a crossing ramp's 11 % stood 2.3 m out of
    // the ground along one side.
    d.nrm = []; const lean = new Float64Array(n); const leanFree = new Uint8Array(n); const across = [];
    for (let i = 0; i < n; i++) {
      const a = d.pts[Math.max(0, i - 1)]; const b = d.pts[Math.min(n - 1, i + 1)];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = -(b[1] - a[1]) / L; const ny = (b[0] - a[0]) / L;
      across.push([nx, ny]);
      // (the other deck's height under this road's two edges, where it lies under both: its true lean across
      // this road, also where that deck's slope changes under it)
      const zl = under(d.pts[i][0] + nx * d.hw[i], d.pts[i][1] + ny * d.hw[i], d.base[i], d.flag[i]);
      const zr = under(d.pts[i][0] - nx * d.hw[i], d.pts[i][1] - ny * d.hw[i], d.base[i], d.flag[i]);
      const other = under(d.pts[i][0], d.pts[i][1], d.base[i], d.flag[i]);
      if (other > -Infinity) {
        r[i] = other - d.base[i] - (d.sink[i] ? CROSS_SINK_M : 0); fixed[i] = 1;
        const lim = TILT_EDGE_M / Math.max(1, d.hw[i]);
        const slope = zl > -Infinity && zr > -Infinity ? (zl - zr) / (2 * d.hw[i]) : slopeAt[0] * nx + slopeAt[1] * ny;
        lean[i] = Math.max(-lim, Math.min(lim, slope));
      } else if (d.flag[i] === 2) {
        // (no deck beyond this end: down to just over the road's own line, the deck easing down to it, so the
        // road goes on from it without a 10 to 25 cm step)
        r[i] = Math.min(d.need[i], END_NEED_M); fixed[i] = 1; leanFree[i] = 1;
        lean[i] = d.camber[i];
      } else { r[i] = d.need[i]; leanFree[i] = 1; lean[i] = d.camber[i]; }
    }
    // The lean changes along the road by no more than LEAN_EASE a metre: from another deck's lean at a junction
    // to the road's own camber (none, on most roads), and along the camber itself. Leaning at the other deck's
    // edge and level again at the next node 2 m on, the surface between was one twisted quad, which the game
    // folds along a diagonal: a ridge 10 to 13 cm high across the lane just outside the junction (measured in
    // game: 19.06 and 19.12 at the two nodes, 19.19 between them). (A lean taken from another deck stays.)
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < n; i++) if (leanFree[i]) { const lim = LEAN_EASE * (d.s[i] - d.s[i - 1]); lean[i] = Math.max(lean[i - 1] - lim, Math.min(lean[i - 1] + lim, lean[i])); }
      for (let i = n - 2; i >= 0; i--) if (leanFree[i]) { const lim = LEAN_EASE * (d.s[i + 1] - d.s[i]); lean[i] = Math.max(lean[i + 1] - lim, Math.min(lean[i + 1] + lim, lean[i])); }
    }
    for (let i = 0; i < n; i++) if (Math.abs(lean[i]) < 1e-4) lean[i] = 0;
    d.lean = lean;
    for (let i = 0; i < n; i++) { const g = lean[i]; const len = Math.hypot(g, 1); d.nrm[i] = g ? [(-g * across[i][0]) / len, (-g * across[i][1]) / len, 1 / len] : [0, 0, 1]; }
    d.leans = lean.some((g) => g !== 0);
    for (let i = 1; i < n; i++) if (!fixed[i]) r[i] = Math.max(r[i], r[i - 1] - RAMP_SLOPE * (d.s[i] - d.s[i - 1]));
    for (let i = n - 2; i >= 0; i--) if (!fixed[i]) r[i] = Math.max(r[i], r[i + 1] - RAMP_SLOPE * (d.s[i + 1] - d.s[i]));
    // (and down to a deck that lies lower than the road's own need: eased the same way, or the road's deck
    // stepped up 10 to 20 cm at that deck's edge)
    const cap = new Float64Array(n).fill(Infinity);
    for (let i = 0; i < n; i++) { if (fixed[i]) cap[i] = r[i]; else if (i) cap[i] = cap[i - 1] + RAMP_SLOPE * (d.s[i] - d.s[i - 1]); }
    for (let i = n - 2; i >= 0; i--) if (!fixed[i]) cap[i] = Math.min(cap[i], cap[i + 1] + RAMP_SLOPE * (d.s[i + 1] - d.s[i]));
    for (let i = 0; i < n; i++) if (!fixed[i] && cap[i] < r[i]) r[i] = cap[i];
    for (let i = 0; i < n; i++) d.z[i] = d.base[i] + r[i];
    indexDeck(d, k);
  }

  const r3 = (v) => Math.round(v * 1000) / 1000;
  const meshRoads = decks.map((d) => {
    stats.nodes += d.pts.length;
    const name = d.name.replace(/^dr_/, 'mr_').replace(/_b$/, '');
    return {
      name, class: 'MeshRoad', persistentId: makeId(), __parent: 'mesh_roads',
      position: [r3(d.pts[0][0]), r3(d.pts[0][1]), r3(d.z[0])],
      topMaterial: MESH_ROAD_MATERIAL, bottomMaterial: MESH_ROAD_MATERIAL, sideMaterial: MESH_ROAD_MATERIAL,
      // (a deck that leans anywhere has a line of vertices along its middle: what twist is left between two of
      // its nodes then folds within each half, and the road's own line stays true)
      textureLength: 8, breakAngle: 3, widthSubdivisions: d.leans ? 1 : 0,
      // [x, y, z, width, depth, normal x, y, z]
      nodes: d.pts.map((p, i) => [r3(p[0]), r3(p[1]), r3(d.z[i]), r3(d.hw[i] * 2),
        r3(Math.max(MIN_DEPTH_M, Math.min(MAX_DEPTH_M, d.z[i] - d.low[i] + 0.15))), ...d.nrm[i].map((v) => Math.round(v * 1e5) / 1e5)]),
    };
  });
  stats.decks = meshRoads.length;

  // the decals over a deck: on it
  for (const group of groups) {
    for (const decal of group.__items || []) {
      if (decal?.class !== 'DecalRoad' || !Array.isArray(decal.nodes) || stayOnGround(String(decal.name || ''))) continue;
      let any = false;
      for (const node of decal.nodes) {
        // (a deck well over or under the decal's own height is another level: the road above at a hillside fork)
        const z = deckAt(node[0], node[1], node[2], SAME_LEVEL_M + MAX_NEED_M);
        // (where decks overlap at a junction this is the one nearest the decal's own height; they are level there)
        if (z === -Infinity) continue;
        node[2] = r3(z + DECAL_OVER_DECK_M);
        any = true;
      }
      if (any) {
        decal.overObjects = true;
        if (Array.isArray(decal.position)) decal.position = [decal.nodes[0][0], decal.nodes[0][1], decal.nodes[0][2]];
        stats.lifted++;
      }
    }
  }
  return { meshRoads, stats };
}
