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
  const [rw] = planRaceways([cw(oval(40, 15), { sport: 'karting', name: 'Kart' }, 4)]);
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
  // (the game's own light tree and barrier pieces, as placed props)
  const tree = st.props.filter((p) => p.shape === 'dragTree');
  assert.ok(tree.length === 1 && tree[0].x < 30, `the tree at the start (near x=0): ${tree[0]?.x.toFixed(0)}`);
  const walls = st.props.filter((p) => p.shape === 'raceConcreteWall');
  assert.ok(walls.some((q) => q.y > 6) && walls.some((q) => q.y < -6), 'walls on both sides');
  assert.ok(walls.every((q) => Math.abs(Math.sin(q.yaw)) < 1e-6), 'each along the strip');
});

test('raceway surfaces mapped as areas', () => {
  const f = { id: 'a', type: 'road', tags: { highway: 'raceway', area: 'yes', surface: 'dirt' }, geometry: [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]].map(([x, y]) => ({ lat: y, lng: x })) };
  const areas = planRacewayAreas([f], (lat, lng) => [lng, lat, 0]);
  assert.equal(areas.length, 1);
  assert.equal(areas[0].surface, 'dirt');
});

test('no kerbs or walls on a raised stretch (a deck, a ramp): they would lie on the ground under it', () => {
  const pts = oval(40, 15);
  const c = cw(pts, { sport: 'karting', name: 'Kart' }, 4);
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
  const a = cw(oval(40, 15), { sport: 'karting', name: 'Kart' }, 4);
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
  assert.ok(!planRaceways([cw(oval(80, 50), { sport: 'motor' }, 8)])[0].oval, 'an unnamed, untagged loop is no oval');
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
  const st = buildRaceway(stone, recorder(), rw, { drapeAt, spectators: [[380, 27]] });
  const tree = st.props.filter((p) => p.shape === 'dragTree');
  assert.ok(tree.length === 1 && tree[0].x > 470, 'the light tree at the east end');
});

test('a drag strip walked from its far end keeps its walls: the track is no obstacle to itself', () => {
  const tags = { 'mapng:raceway': 'drag' };
  const walls = (spectators) => {
    const strip = cw(Array.from({ length: 101 }, (_, i) => [i * 4, 0]), tags, 6);
    const rws = planRaceways([strip]);
    const r = recorder();
    const st = buildRaceway(r, r, rws[0], { drapeAt, blocked: carriagewayTest(rws), spectators });
    const concrete = st.props.filter((p) => p.shape === 'raceConcreteWall');
    return [Math.max(...concrete.map((q) => q.x)) - Math.min(...concrete.map((q) => q.x)), concrete.length];
  };
  const [lengthForward, trisForward] = walls([[0, 30]]);
  const [lengthTurned, trisTurned] = walls([[400, 30]]);
  assert.ok(lengthForward > 385, `pieces the whole length (${lengthForward.toFixed(0)})`);
  assert.ok(lengthTurned > 385);
  assert.equal(trisTurned, trisForward);
});

test('a height only Overture guessed leaves a stand a stand; a mapped height makes it a building', () => {
  const proj = (lat, lng) => [lng, lat];
  const strip = cw([[0, 0], [500, 0]], { 'mapng:raceway': 'drag' }, 6);
  const footprint = (tags) => ({ type: 'building', id: 1, tags: { building: 'yes', ...tags }, geometry: [[20, 100], [20, 200], [32, 200], [32, 100], [20, 100]].map(([lat, lng]) => ({ lat, lng })) });
  assert.equal(tracksideStands([footprint({})], proj, [strip]).size, 1);
  assert.equal(tracksideStands([footprint({ height: '9.5', 'mapng:height_source': 'overture' })], proj, [strip]).size, 1);
  assert.equal(tracksideStands([footprint({ height: '9.5' })], proj, [strip]).size, 0);
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

test('a motocross raceway with no surface is dirt; racing lines mapped as leisure=track are recognised', async () => {
  const { prepareRaceways } = await import('../services/exportBeamNGLevel.js');
  const { isRacingTrackLine } = await import('../services/roadWidth.js');
  const mx = { type: 'road', tags: { highway: 'raceway', sport: 'motocross' }, geometry: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }] };
  prepareRaceways([mx]);
  assert.equal(mx.tags.surface, 'dirt');
  assert.ok(isRacingTrackLine({ leisure: 'track', sport: 'bmx' }));
  assert.ok(!isRacingTrackLine({ leisure: 'track', sport: 'athletics' }));
  assert.ok(!isRacingTrackLine({ leisure: 'track', sport: 'bmx', area: 'yes' }));
});

test('a circuit straight is no drag strip; a lone strip and one with a return road are', async () => {
  const { markDragStrips } = await import('../services/exportBeamNGLevel.js');
  const proj = (lat, lng) => [lng, lat, 0];
  const way = (pts) => ({ type: 'road', tags: { highway: 'raceway', sport: 'motor' }, geometry: pts.map(([x, y]) => ({ lat: y, lng: x })) });
  const straight = way([[0, 0], [600, 0]]);
  const lap = way([[600, 0], [900, 900], [0, 1400], [-300, 700], [0, 0]]);
  markDragStrips([straight, lap], proj);
  assert.equal(straight.tags['mapng:raceway'], undefined);
  const strip = way([[0, 0], [600, 0]]); const back = way([[600, 0], [600, 40], [0, 40], [0, 0]]);
  markDragStrips([strip, back], proj);
  assert.equal(strip.tags['mapng:raceway'], 'drag');
});

test('kerbs only on a raceway known to be paved: tagged or named', () => {
  const kerbs = (tags) => buildRaceway(recorder(), recorder(), planRaceways([cw(oval(40, 15).slice(0, 30), tags, 4)])[0], { drapeAt }).kerbs;
  assert.equal(kerbs({ sport: 'motor' }), 0);
  assert.ok(kerbs({ sport: 'motor', name: 'Climbing Turn' }) > 0);
  assert.ok(kerbs({ sport: 'motor', surface: 'asphalt' }) > 0);
});

test('a raceway outline round a whole venue is no surface; one the lines fill, or with none inside, is', () => {
  const proj = (lat, lng) => [lng, lat, 0];
  const g = (pts) => pts.map(([x, y]) => ({ lat: y, lng: x }));
  const box = (s) => g([[0, 0], [s, 0], [s, s], [0, s], [0, 0]]);
  const area = (s) => ({ id: 'a', type: 'road', tags: { highway: 'raceway', area: 'yes', surface: 'dirt' }, geometry: box(s) });
  const line = { id: 'l', type: 'road', tags: { highway: 'raceway', sport: 'motocross', surface: 'dirt' }, geometry: g([[5, 5], [95, 5]]) };
  assert.equal(planRacewayAreas([area(400), line], proj).length, 0, 'the venue');
  assert.equal(planRacewayAreas([area(100)], proj).length, 1, 'no lines: the outline is all we have');
  const wide = { ...line, tags: { highway: 'raceway', sport: 'motor', surface: 'dirt' }, geometry: g([[5, 20], [95, 20], [95, 40], [5, 40], [5, 60], [95, 60], [95, 80], [5, 80]]) };
  assert.equal(planRacewayAreas([area(100), wide], proj).length, 1, 'the lines fill it');
});

test('one unbroken kerb to a corner: mapped wobble, piece ends and kinks do not chop it', () => {
  // a straight, a 90 degree left of radius 40 in two pieces with noise, a straight
  const pts = [];
  for (let x = -100; x < 0; x += 2) pts.push([x, 0]);
  for (let a = 0; a <= 45; a++) { const t = (a * 2 * Math.PI) / 180; const r = 40 + (a % 3) * 0.25; pts.push([r * Math.sin(t), 40 - r * Math.cos(t)]); }
  for (let y = 40 + 2; y < 140; y += 2) pts.push([40, y]);
  const h = Math.floor(pts.length / 2);
  const tags = { sport: 'motor', name: 'Turn', surface: 'asphalt' };
  const pieces = [cw(pts.slice(0, h + 1), tags, 6), cw(pts.slice(h), tags, 6)].map((c) => ({ ...c, oneWay: true }));
  const rws = planRaceways(pieces);
  assert.equal(rws.length, 1, 'one line');
  const full = recorder();
  const st = buildRaceway(recorder(), full, rws[0], { drapeAt });
  assert.equal(st.kerbs, 1, 'one corner');
  const kerb = full.tris.filter((k) => k.mat === 'smoothConcrete').flatMap((k) => k.pts);
  assert.ok(kerb.every((q) => q[0] > -30 && q[1] < 80), 'not along the straights');
  // the inside (toward the corner's centre 0,40) and the outside exit only
  const r = (q) => Math.hypot(q[0], q[1] - 40);
  assert.ok(kerb.some((q) => r(q) < 34.5), 'the inside');
  const outer = kerb.filter((q) => r(q) > 45 && q[1] < 40);
  assert.ok(outer.every((q) => q[1] > 12), 'the outside only from past the middle of the corner');
});

test('a kink is no corner: no kerb', () => {
  const pts = [];
  for (let x = 0; x <= 200; x += 2) pts.push([x, x > 100 ? (x - 100) * 0.2 : 0]);   // 11 degrees
  const [rw] = planRaceways([cw(pts, { sport: 'motor', surface: 'asphalt' }, 6)]);
  assert.equal(buildRaceway(recorder(), recorder(), rw, { drapeAt }).kerbs, 0);
});

test('a racing line flows: a corner in few points turns smoothly, and ways still meet', async () => {
  const { roundRoadCorners } = await import('../services/roadCurves.js');
  const K = 1 / 111320;
  const way = (id, pts, tags = {}) => ({ id, type: 'road', tags: { highway: 'raceway', sport: 'motor', ...tags }, geometry: pts.map(([x, y]) => ({ lat: y * K, lng: x * K })) });
  const a = way('a', [[0, 0], [100, 0], [130, 12], [150, 40]]);
  const b = way('b', [[150, 40], [158, 80], [158, 200]]);
  const side = { id: 's', type: 'road', tags: { highway: 'service' }, geometry: [{ lat: 40 * K, lng: 150 * K }, { lat: 40 * K, lng: 220 * K }] };
  const out = roundRoadCorners([a, b, side]).features;
  const [ga, gb, gs] = out.map((f) => f.geometry);
  const near = (p, q) => Math.hypot((p.lat - q.lat) / K, (p.lng - q.lng) / K) < 0.05;
  assert.ok(near(ga[ga.length - 1], gb[0]), 'the two ways still meet');
  assert.ok(near(ga[ga.length - 1], gs[0]), 'a road ending on the lap stays joined');
  assert.ok(near(ga[0], { lat: 0, lng: 0 }) && near(gb[gb.length - 1], { lat: 200 * K, lng: 158 * K }), 'the ends stay put');
  // heading never jumps: at most a few degrees per 2 m step along both ways
  const pts = [...ga, ...gb.slice(1)].map((p) => [p.lng / K, p.lat / K]);
  let worst = 0;
  for (let i = 1; i + 1 < pts.length; i++) {
    const u = [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]; const v = [pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]];
    if (Math.hypot(...u) < 0.2 || Math.hypot(...v) < 0.2) continue;
    worst = Math.max(worst, Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1])));
  }
  assert.ok((worst * 180) / Math.PI < 8, `worst heading step ${(worst * 180 / Math.PI).toFixed(1)} deg`);
});

test('a long oval is walled down its straights too', () => {
  const [rw] = planRaceways([cw(oval(200, 50), { sport: 'motor', surface: 'dirt' }, 8)]);
  const full = recorder();
  buildRaceway(recorder(), full, rw, { drapeAt });
  const fence = full.tris.filter((k) => k.mat === 'chainlink').flatMap((k) => k.pts);
  for (const x of [-180, -90, 0, 90, 180]) assert.ok(fence.some((q) => Math.abs(q[0] - x) < 10 && q[1] > 50), `the north straight at x=${x}`);
});

test('an oval in several pieces has an unbroken wall, joints and the lap closing included', () => {
  const pts = oval(100, 50); const tags = { sport: 'motor', surface: 'dirt', name: 'Oval' };
  const cuts = [0, 20, 45, 70, pts.length - 1];
  const pieces = cuts.slice(1).map((c, i) => cw(pts.slice(cuts[i], c + 1), tags, 8));
  const rws = planRaceways(pieces);
  assert.equal(rws.length, 1, 'one line');
  const full = recorder();
  buildRaceway(recorder(), full, rws[0], { drapeAt });
  // each fence panel's bottom edge: every end meets the next panel's start
  const seg = full.tris.filter((k) => k.mat === 'chainlink').filter((_, i) => i % 2 === 0).map((k) => [k.pts[0], k.pts[1]]);
  let worst = 0;
  for (let i = 0; i < seg.length; i++) { const nx = seg[(i + 1) % seg.length]; worst = Math.max(worst, Math.hypot(seg[i][1][0] - nx[0][0], seg[i][1][1] - nx[0][1])); }
  assert.ok(worst < 0.5, `largest gap ${worst.toFixed(2)} m`);
});

test('floodlights as real venues: a stadium field 6 poles outside it, tennis 4 low ones, lit=no none; poles stand clear', async () => {
  const { planFieldPoles, planTrackPoles, planStandLights, beamRotation } = await import('../services/sportsLights.js');
  const box = (L, W) => ({ u: [1, 0], s0: -L / 2, s1: L / 2, t0: -W / 2, t1: W / 2 });
  const ring = (L, W) => [[-L / 2, -W / 2], [L / 2, -W / 2], [L / 2, W / 2], [-L / 2, W / 2]];
  const inside = (q, L, W) => Math.abs(q.x) < L / 2 && Math.abs(q.y) < W / 2;
  const free = () => true;
  const foot = { sport: 'american_football', box: box(110, 50), ring: ring(110, 50), tags: {} };
  const poles = planFieldPoles([foot], [], free);
  assert.equal(poles.length, 6);
  assert.ok(poles.every((p) => p.h >= 24 && !inside(p, 110, 50)), 'tall, outside the field');
  const tennis = { sport: 'tennis', box: box(36, 18), ring: ring(36, 18), tags: {} };
  const tp = planFieldPoles([tennis], [], free);
  assert.equal(tp.length, 4);
  assert.ok(tp.every((p) => p.h <= 12 && !inside(p, 36, 18)));
  assert.equal(planFieldPoles([{ ...foot, tags: { lit: 'no' } }], [], free).length, 0);
  assert.equal(planFieldPoles([{ ...foot, sport: 'cricket' }], [], free).length, 0, 'cricket: usually unlit');
  assert.equal(planFieldPoles([{ ...foot, sport: 'cricket', tags: { lit: 'yes' } }], [], free).length, 6);
  // a pole that cannot stand is dropped
  assert.equal(planFieldPoles([foot], [], () => false).length, 0);
  // a field inside a running track shares the track's poles
  const track = { sport: 'track', box: box(170, 80), ring: ring(170, 80), tags: {} };
  const both = planFieldPoles([track, foot], [], free);
  assert.equal(both.length, 6);
  assert.ok(both.every((p) => !inside(p, 170, 80)), 'outside the track');
  // road courses stay dark unless tagged; a drag strip's poles line both sides of the racing distance
  const lap = { kind: 'circuit', half: 6, tags: {}, nodes: [[0, 0, 0], [500, 0, 0]] };
  assert.equal(planTrackPoles([lap], free).length, 0);
  assert.ok(planTrackPoles([{ ...lap, tags: { lit: 'yes' } }], free).length > 4);
  const strip = { kind: 'drag', half: 6, tags: {}, nodes: [[0, 0, 0], [1300, 0, 0]] };
  const dp = planTrackPoles([strip], free);
  assert.ok(dp.some((p) => p.y > 6) && dp.some((p) => p.y < -6) && dp.every((p) => p.x <= 701));
  // a downward-tilted beam comes out as the engine's matrix (the beam its second column)
  const r = beamRotation([0, 0, -1]);
  assert.deepEqual(r.slice(3, 6), [0, 0, -1]);
  assert.equal(planStandLights([{ roof: false, box: box(60, 15), z1: 5, tags: {} }]).length, 0);
  assert.equal(planStandLights([{ roof: true, box: box(60, 15), z1: 5, tags: {} }]).length, 4);
});

test('a road node too tight for its width is eased, the ends staying put', async () => {
  const { easeTightNodes } = await import('../services/exportBeamNGLevel.js');
  const K = 1 / 111320;
  const pts = [];
  for (let x = 0; x <= 40; x += 2) pts.push({ lat: 0, lng: x * K });
  for (let y = 2; y <= 40; y += 2) pts.push({ lat: y * K, lng: 40 * K });   // a right angle at one node
  const out = easeTightNodes(pts, 5);
  const xy = out.map((p) => [p.lng / K, p.lat / K]);
  let tightest = Infinity;
  for (let i = 1; i + 1 < xy.length; i++) {
    const u = [xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]]; const v = [xy[i + 1][0] - xy[i][0], xy[i + 1][1] - xy[i][1]];
    const a = Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]));
    if (a > 1e-3) tightest = Math.min(tightest, (Math.hypot(...u) + Math.hypot(...v)) / 2 / a);
  }
  assert.ok(tightest >= 5, `tightest ${tightest.toFixed(1)} m on a road of half width 5`);
  assert.deepEqual([out[0].lat, out[0].lng], [pts[0].lat, pts[0].lng]);
  assert.deepEqual([out.at(-1).lat, out.at(-1).lng], [pts.at(-1).lat, pts.at(-1).lng]);
  assert.equal(easeTightNodes(pts.slice(0, 20), 5)[10], pts.slice(0, 20)[10], 'a straight road untouched');
});

test('lit= goes by length when a lap joins: one lit pit entry does not light the lap', () => {
  const a = cw([[0, 0], [1000, 0]], { sport: 'motor', name: 'Lap' }, 6);
  const b = cw([[1000, 0], [1100, 0]], { sport: 'motor', lit: 'yes' }, 6);
  const [r] = planRaceways([a, b]);
  assert.ok(!r.tags.lit, `not lit: ${r.tags.lit}`);
  const [l] = planRaceways([cw([[0, 0], [1000, 0]], { sport: 'motor', lit: 'yes' }, 6), cw([[1000, 0], [1100, 0]], { sport: 'motor' }, 6)]);
  assert.equal(l.tags.lit, 'yes');
});

test('an unnamed piece touching a named circuit counts as known (kerbs), an isolated one does not', () => {
  const named = cw([[0, 0], [250, 0], [500, 0]], { sport: 'motor', name: 'Lap' }, 6);
  const fork = cw([[250, 0], [250, 400]], { sport: 'motor' }, 6);
  const alone = cw([[0, 900], [500, 900]], { sport: 'motor' }, 6);
  const rws = planRaceways([named, fork, alone]);
  assert.equal(rws.filter((r) => r.known).length, 2);
});
