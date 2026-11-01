import test from 'node:test';
import assert from 'node:assert/strict';

import { planRaceways, buildRaceway, planRacewayAreas, carriagewayTest, tracksideStands } from '../services/racetracks.js';
import { racewayKind, estimateRoadHalfWidth } from '../services/roadWidth.js';

function recorder() {
  const tris = [];
  const add = (mat, pts, col) => { for (const p of pts) assert.ok(p.every(Number.isFinite), `finite ${p}`); tris.push({ mat, pts, col }); };
  return { tris, tri: (m, a, b, c, ua, ub, uc, col) => add(m, [a, b, c], col), quad: (m, a, b, c, d, ua, ub, uc, ud, col) => { add(m, [a, b, c], col); add(m, [a, c, d], col); } };
}
const drapeAt = () => 2;
// a carriageway: nodes [x, y, z, w]
const cw = (pts, tags, half) => ({ highway: 'raceway', nodes: pts.map(([x, y]) => [x, y, 2, 2 * half]), half, tags, wayId: 'w' });
// the usual oval: straights 2a long, semicircles of radius r, sampled every few metres (closed)
const oval = (a, r) => {
  const pts = [];
  const arc = (cx, a0) => { for (let i = 0; i < 24; i++) { const t = a0 + (Math.PI * i) / 24; pts.push([cx + r * Math.cos(t), r * Math.sin(t)]); } };
  const straight = (y, x0, x1) => { const n = Math.ceil(Math.abs(x1 - x0) / 4); for (let i = 0; i < n; i++) pts.push([x0 + ((x1 - x0) * i) / n, y]); };
  arc(a, -Math.PI / 2); straight(r, a, -a); arc(-a, Math.PI / 2); straight(-r, -a, a);
  pts.push([...pts[0]]);
  return pts;
};

test('raceway kinds and widths: circuits, dirt ovals, karts, motocross, pit lanes, drag strips', () => {
  assert.equal(racewayKind({ sport: 'motor' }), 'circuit');
  assert.equal(racewayKind({ sport: 'motor', surface: 'dirt' }), 'dirt');
  assert.equal(racewayKind({ sport: 'karting' }), 'kart');
  assert.equal(racewayKind({ sport: 'motocross', surface: 'dirt' }), 'moto');
  assert.equal(racewayKind({ name: 'Road Course Pit Lane' }), 'pit');
  assert.equal(racewayKind({ 'mapng:raceway': 'drag' }), 'drag');
  assert.equal(estimateRoadHalfWidth({ sport: 'motor' }, 'raceway'), 6);
  assert.equal(estimateRoadHalfWidth({ sport: 'motor', surface: 'dirt' }, 'raceway'), 8);
  assert.equal(estimateRoadHalfWidth({ width: '25', surface: 'dirt' }, 'raceway'), 12);
});

test('a kart track gets red-and-white kerbs round its bends, none on its straights, a tyre wall outside', () => {
  const [rw] = planRaceways([cw(oval(40, 15), { sport: 'karting' }, 4)]);
  const stone = recorder(); const full = recorder();
  const tee = { tri: (...a) => { stone.tri(...a); full.tri(...a); }, quad: (...a) => { stone.quad(...a); full.quad(...a); } };
  const st = buildRaceway(tee, full, rw, { drapeAt });
  assert.ok(st.kerbs >= 2, `kerbs: ${st.kerbs}`);
  const kerb = full.tris.filter((t) => t.mat === 'smoothConcrete' && t.col && t.col[0] > 0.7 && t.col[1] < 0.2);
  assert.ok(kerb.length > 0, 'red kerb pieces');
  assert.ok(kerb.every((t) => t.pts.every((q) => Math.abs(q[0]) > 32)), 'kerbs in the bends (and a few metres past them), not along the straights');
  assert.ok(st.tyres >= 2, 'tyre walls');
});

test('a dirt oval in pieces with a crossing: wall and fence round the outside only', () => {
  const pts = oval(60, 40);
  const h = Math.floor(pts.length / 2);
  const pieces = [cw(pts.slice(0, h + 1), { sport: 'motor', surface: 'dirt' }, 8), cw(pts.slice(h), { sport: 'motor', surface: 'dirt' }, 8),
    cw(Array.from({ length: 41 }, (_, i) => [-60 + 3 * i, -40 + 2 * i]), { sport: 'motor', surface: 'dirt' }, 8)];
  const rws = planRaceways(pieces);
  const fence = [];
  for (const rw of rws) { const stone = recorder(); const full = recorder(); buildRaceway(stone, full, rw, { drapeAt }); fence.push(...full.tris.filter((t) => t.mat === 'chainlink').flatMap((t) => t.pts)); }
  const inner = (q) => { const x = Math.abs(q[0]) - 60; return x > 0 ? Math.hypot(x, q[1]) : Math.abs(q[1]); };
  assert.ok(fence.length > 100);
  assert.ok(fence.every((q) => inner(q) > 48), 'no fence along the crossing or inside');
});

test('a dirt oval gets a wall and catch fence round its outside, whichever way it was drawn', () => {
  for (const pts of [oval(60, 40), oval(60, 40).reverse()]) {
    const [rw] = planRaceways([cw(pts, { sport: 'motor', surface: 'dirt' }, 8)]);
    const stone = recorder(); const full = recorder();
    buildRaceway(stone, full, rw, { drapeAt });
    const fence = full.tris.filter((t) => t.mat === 'chainlink').flatMap((t) => t.pts);
    assert.ok(fence.length > 0);
    // outside the track: beyond its outer edge (the oval's half-width 8 past the line)
    const inner = (q) => { const x = Math.abs(q[0]) - 60; return x > 0 ? Math.hypot(x, q[1]) : Math.abs(q[1]); };
    assert.ok(fence.every((q) => inner(q) > 40 + 8), 'the fence outside the oval');
  }
});

test('a drag strip: launch pad and light tree at the end nearest the other raceways, walls along both sides', () => {
  const strip = cw([[0, 0], [400, 0]], { 'mapng:raceway': 'drag' }, 6);
  const ret = cw([[-20, 30], [-20, -30], [380, -30]], { sport: 'motor' }, 3);
  const rws = planRaceways([strip, ret]);
  const stone = recorder(); const full = recorder();
  const st = buildRaceway(stone, full, rws[0], { drapeAt, others: [rws[1]] });
  assert.equal(st.trees, 1);
  const tree = stone.tris.filter((t) => t.pts.some((q) => q[2] > 2 + 3.5)).flatMap((t) => t.pts);
  assert.ok(tree.every((q) => q[0] < 30), `the tree at the start (near x=0): ${Math.max(...tree.map((q) => q[0])).toFixed(0)}`);
  const walls = stone.tris.filter((t) => t.mat === 'smoothConcrete').flatMap((t) => t.pts);
  assert.ok(walls.some((q) => q[1] > 6) && walls.some((q) => q[1] < -6), 'walls on both sides');
});

test('raceway surfaces mapped as areas', () => {
  const f = { id: 'a', type: 'road', tags: { highway: 'raceway', area: 'yes', surface: 'dirt' }, geometry: [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]].map(([x, y]) => ({ lat: y, lng: x })) };
  const areas = planRacewayAreas([f], (lat, lng) => [lng, lat, 0]);
  assert.equal(areas.length, 1);
  assert.equal(areas[0].surface, 'dirt');
});

test('no kerbs or walls on a raised stretch (a deck, a ramp): they would lie on the ground under it', () => {
  const pts = oval(40, 15);
  const c = cw(pts, { sport: 'karting' }, 4);
  c.nodes = c.nodes.map((q) => (q[0] > 0 ? [q[0], q[1], 8, q[3]] : q));   // the east half on a deck 6 m up
  const [rw] = planRaceways([c]);
  const stone = recorder(); const full = recorder();
  buildRaceway(stone, full, rw, { drapeAt });
  const all = [...stone.tris, ...full.tris].flatMap((t) => t.pts);
  assert.ok(all.length > 0, 'the grounded half still fitted');
  assert.ok(all.every((q) => q[0] < 1), 'nothing under the deck');
});

test('kerbs and tyre walls never stand on a neighbouring stretch of track', () => {
  // a kart oval, another track passing just outside its east bend (its carriageway x 59..67)
  const a = cw(oval(40, 15), { sport: 'karting' }, 4);
  const b = cw(Array.from({ length: 21 }, (_, i) => [63, -40 + 4 * i]), { sport: 'karting' }, 4);
  const rws = planRaceways([a, b]);
  const blocked = carriagewayTest(rws);
  const stone = recorder(); const full = recorder();
  const st = buildRaceway(stone, full, rws[0], { drapeAt, blocked });
  assert.ok(st.tyres >= 1, 'the west bend still has its tyre wall');
  const all = [...stone.tris, ...full.tris].flatMap((t) => t.pts);
  assert.equal(all.filter((q) => q[0] > 58.7).length, 0, 'nothing on the other track');
});

test('a paved oval: no kerbs, a wall and catch fence round the outside; a road course keeps its kerbs', () => {
  const [ov] = planRaceways([cw(oval(80, 50), { sport: 'motor', surface: 'asphalt' }, 8)]);
  assert.ok(ov.oval, 'recognised as an oval');
  const s1 = recorder(); const f1 = recorder();
  const st = buildRaceway(s1, f1, ov, { drapeAt });
  assert.equal(st.kerbs, 0);
  assert.ok(st.walls >= 1 && f1.tris.some((t) => t.mat === 'chainlink'));
  // a road course: a bend the other way (an S in the back straight)
  const pts = oval(80, 50).map(([x, y]) => (y > 0 && Math.abs(x) < 40 ? [x, y - 25 * Math.cos((x / 40) * Math.PI / 2) ** 2] : [x, y]));
  const [rc] = planRaceways([cw(pts, { sport: 'motor', surface: 'asphalt' }, 6)]);
  assert.ok(!rc.oval, 'a road course is no oval');
});

test('a drag strip in pieces is one strip: one launch pad, one light tree', () => {
  const tags = { 'mapng:raceway': 'drag' };
  const pieces = [cw([[0, 0], [120, 0]], tags, 6), cw([[250, 0], [120, 0]], tags, 6), cw([[250, 0], [400, 0]], tags, 6)];
  const rws = planRaceways(pieces);
  assert.equal(rws.length, 1);
  assert.equal(rws[0].nodes.length, 4);
  const st = buildRaceway(recorder(), recorder(), rws[0], { drapeAt });
  assert.equal(st.trees, 1);
});

test('an untagged long narrow building along a raceway is its grandstand; a drag strip starts at the end nearer it', () => {
  const proj = (lat, lng) => [lng, lat, 0];
  const ring = (pts) => pts.map(([x, y]) => ({ lat: y, lng: x }));
  const stand = { id: 's', tags: { building: 'yes' }, geometry: ring([[300, 20], [460, 20], [460, 35], [300, 35], [300, 20]]) };
  const shed = { id: 'h', tags: { building: 'yes' }, geometry: ring([[300, 60], [330, 60], [330, 80], [300, 80], [300, 60]]) };
  const across = { id: 'x', tags: { building: 'yes' }, geometry: ring([[200, 20], [215, 20], [215, 180], [200, 180], [200, 20]]) };
  const strip = cw([[0, 0], [500, 0]], { 'mapng:raceway': 'drag' }, 6);
  const set = tracksideStands([stand, shed, across], proj, [strip]);
  assert.deepEqual([...set].map((f) => f.id), ['s']);
  // the stand is near x=380: the start is the east end (x=500)
  const [rw] = planRaceways([strip]);
  const stone = recorder();
  buildRaceway(stone, recorder(), rw, { drapeAt, spectators: [[380, 27]] });
  const tree = stone.tris.filter((t) => t.pts.some((q) => q[2] > 2 + 3.5)).flatMap((t) => t.pts);
  assert.ok(tree.length && tree.every((q) => q[0] > 470), 'the light tree at the east end');
});

test('a drag strip mapped with a wobble is laid dead straight; a road joining it mid-strip stays joined', async () => {
  const { markDragStrips: markDragStripsForTest } = await import('../services/exportBeamNGLevel.js');
  const strip = { type: 'road', tags: { highway: 'raceway' }, geometry: [[0, 0], [300, 1.4], [600, -0.3], [900, 1.1], [1000, 0]].map(([x, y]) => ({ lat: y, lng: x })) };
  const lane = { type: 'road', tags: { highway: 'service' }, geometry: [[300, 1.4], [300, 50]].map(([x, y]) => ({ lat: y, lng: x })) };
  markDragStripsForTest([strip, lane], (lat, lng) => [lng, lat, 0]);
  assert.equal(strip.tags['mapng:raceway'], 'drag');
  assert.ok(strip.geometry.every((q) => Math.abs(q.lat) < 1e-9), 'every point on the straight line');
  assert.deepEqual([lane.geometry[0].lat, lane.geometry[0].lng], [strip.geometry[1].lat, strip.geometry[1].lng], 'the lane still meets the strip');
});

test('a drag strip graded smooth: the bumps gone, its grade kept, the ground beside it untouched', async () => {
  const { gradeDragStrips } = await import('../services/exportBeamNGLevel.js');
  const W = 256; const H = 256;
  // a 0.5 % grade along x with 3 cm noise everywhere
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const heightMap = new Float32Array(W * H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) heightMap[r * W + c] = 60 + 0.005 * (c - W / 2) + 0.06 * rnd();
  const td = { width: W, height: H, heightMap, minHeight: 50, maxHeight: 70 };
  const strip = { highway: 'raceway', half: 6, tags: { 'mapng:raceway': 'drag' }, nodes: [[-100, 0, 10, 12], [100, 0, 10, 12]] };
  const res = gradeDragStrips(td, 1, [strip]);
  assert.equal(res.strips, 1);
  assert.ok(res.before > 0.004 && res.after < 0.001, `bumps ${res.before} -> ${res.after}`);
  const at = (x, y) => td.heightMap[(H - 1 - (y + H / 2)) * W + (x + W / 2)];
  assert.ok(Math.abs((at(80, 0) - at(-80, 0)) / 160 - 0.005) < 0.001, 'the grade kept');
  assert.ok(Math.abs(at(0, 0) - 60) < 0.05, 'the strip at its own height (heightmap absolute, not over minHeight)');
  const far = at(0, 60); assert.ok(Math.abs(far - 60) < 0.05, 'the ground 60 m off untouched');
});
