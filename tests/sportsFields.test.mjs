import test from 'node:test';
import assert from 'node:assert/strict';

import { pitchSport, planPitches, buildPitch, planSeating, buildSeating } from '../services/sportsFields.js';

// world metres = (lng, lat); ground 3 m everywhere
const project = (lat, lng) => [lng, lat, 3];
const groundAt = () => 3;
const area = (id, pts, tags, type = 'landuse') => ({ id, type, tags, geometry: [...pts, pts[0]].map(([x, y]) => ({ lat: y, lng: x })) });
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
function recorder() {
  const tris = [];
  const add = (mat, pts) => { for (const p of pts) assert.ok(p.every(Number.isFinite), `finite ${p} (${mat})`); tris.push({ mat, pts }); };
  return { tris, tri: (m, a, b, c) => add(m, [a, b, c]), quad: (m, a, b, c, d) => { add(m, [a, b, c]); add(m, [a, c, d]); } };
}

test('sports from tags: aliases, the first known of a list, football by where it is', () => {
  assert.equal(pitchSport({ sport: 'soccer' }), 'soccer');
  assert.equal(pitchSport({ sport: 'multi;basketball' }), 'basketball');
  assert.equal(pitchSport({ sport: 'beachvolleyball' }), 'beach_volleyball');
  assert.equal(pitchSport({ sport: 'football' }, { lat: 35, lon: -111 }), 'american_football');
  assert.equal(pitchSport({ sport: 'football' }, { lat: 51, lon: 0 }), 'soccer');
  assert.equal(pitchSport({ leisure: 'track', sport: 'athletics' }), 'track');
  assert.equal(pitchSport({ sport: 'chess' }), 'multi');
});

test('courts mapped as their lines get run-off up to halfway to the next court; the fence between them is left out', () => {
  // two tennis courts side by side, 4 m apart
  const feats = [area('a', rect(0, 0, 23.77, 10.97), { leisure: 'pitch', sport: 'tennis' }), area('b', rect(0, 14.97, 23.77, 10.97), { leisure: 'pitch', sport: 'tennis' })];
  const [a, b] = planPitches(feats, project, { groundAt });
  const ys = (p) => p.ring.map((q) => q[1]);
  assert.ok(Math.max(...ys(a)) <= 12.97 + 1e-6 && Math.min(...ys(b)) >= 12.97 - 1e-6, 'run-off meets halfway');
  assert.ok(Math.min(...a.ring.map((q) => q[0])) < -5, 'room behind the baselines');
  assert.equal(a.slab, 3 + 0.12, 'a hard court is a slab');
  assert.ok(a.fenceEdges.some((e) => !e) && a.fenceEdges.some((e) => e), 'fence on the outside edges only');
});

test('every layout builds clean geometry, with paint and its fittings', () => {
  const cases = [
    ['soccer', rect(0, 0, 105, 68), {}], ['american_football', rect(0, 0, 110, 49), {}], ['rugby', rect(0, 0, 120, 70), { sport: 'rugby_union' }],
    ['field_hockey', rect(0, 0, 92, 56), {}], ['basketball', rect(0, 0, 28, 15), {}], ['tennis', rect(0, 0, 36, 18), {}], ['netball', rect(0, 0, 31, 16), {}],
    ['handball', rect(0, 0, 40, 20), {}], ['volleyball', rect(0, 0, 18, 9), { sport: 'beachvolleyball' }], ['pickleball', rect(0, 0, 13.4, 6.1), {}],
    ['skateboard', rect(0, 0, 30, 20), {}], ['multi', rect(0, 0, 20, 20), {}],
  ];
  for (const [sport, ring, tags] of cases) {
    const [p] = planPitches([area(sport, ring, { leisure: 'pitch', sport, ...tags })], project, { groundAt });
    assert.ok(p, `${sport} planned`);
    const stone = recorder(); const full = recorder();
    const tee = { tri: (...a) => { stone.tri(...a); full.tri(...a); }, quad: (...a) => { stone.quad(...a); full.quad(...a); } };
    buildPitch(tee, full, p);
    assert.ok(full.tris.length > 20, `${sport}: geometry`);
    if (sport !== 'skateboard') assert.ok(full.tris.some((t) => t.mat === 'linePaint'), `${sport}: markings`);
    if (['soccer', 'field_hockey', 'handball'].includes(sport)) assert.ok(full.tris.some((t) => t.mat === 'netting'), `${sport}: goal nets`);
    if (sport === 'basketball') assert.ok(stone.tris.filter((t) => t.pts.some((q) => q[2] > 3 + 3)).length > 0, 'hoops');
    assert.ok(!stone.tris.some((t) => t.mat === 'netting' || t.mat === 'linePaint'), `${sport}: no paint or nets in the collision`);
  }
});

test("a baseball field: home plate at the fan's square corner, the diamond opening toward the outfield", () => {
  // a fan: home at (0, 0), foul lines along the axes, the outfield arc 100 m out
  const fan = [[0, 0], [100, 0], ...Array.from({ length: 9 }, (_, i) => [100 * Math.cos((Math.PI / 2) * (i / 8)), 100 * Math.sin((Math.PI / 2) * (i / 8))]).slice(1), [0, 100]];
  const [p] = planPitches([area('bb', fan, { leisure: 'pitch', sport: 'baseball' })], project, { groundAt });
  const stone = recorder(); const full = recorder();
  const tee = { tri: (...a) => { stone.tri(...a); full.tri(...a); }, quad: (...a) => { stone.quad(...a); full.quad(...a); } };
  buildPitch(tee, full, p);
  const dirt = full.tris.filter((t) => t.mat === 'dirt').flatMap((t) => t.pts);
  const cx = dirt.reduce((a, q) => a + q[0], 0) / dirt.length; const cy = dirt.reduce((a, q) => a + q[1], 0) / dirt.length;
  assert.ok(cx > 5 && cy > 5 && Math.abs(cx - cy) < 6, `the infield toward the middle of the fan: ${cx.toFixed(1)}, ${cy.toFixed(1)}`);
  assert.ok(full.tris.some((t) => t.mat === 'chainlink'), 'backstop and outfield fence');
});

test('bleachers face the field beside them; a large grandstand gets a roof', () => {
  const field = area('f', rect(0, 0, 105, 68), { leisure: 'pitch', sport: 'soccer' });
  const stand = area('s', rect(20, -12, 40, 8), { leisure: 'bleachers' });
  const gs = area('g', rect(20, 74, 60, 12), { building: 'grandstand' }, 'building');
  const pitches = planPitches([field], project, { groundAt });
  const seats = planSeating([stand, gs], project, pitches);
  const b = seats.find((s) => s.id === 's');
  assert.ok(b.face[1] > 0.9, 'facing north, toward the field');
  const g = seats.find((s) => s.id === 'g');
  assert.ok(g.face[1] < -0.9 && g.roof, 'the grandstand faces south and has a roof');
  const stone = recorder(); const full = recorder();
  assert.equal(buildSeating(stone, full, b), 'bleachers');
  assert.equal(buildSeating(stone, full, g), 'grandstand');
  // rows climb away from the field
  const seatTops = stone.tris.filter((t) => t.mat === 'metalWhite').flatMap((t) => t.pts).filter((q) => q[0] > 20 && q[0] < 60 && q[1] < -4);
  const nearY = Math.max(...seatTops.map((q) => q[1])); const farY = Math.min(...seatTops.map((q) => q[1]));
  const zAt = (y) => Math.max(...seatTops.filter((q) => Math.abs(q[1] - y) < 0.8).map((q) => q[2]));
  assert.ok(zAt(farY) > zAt(nearY), 'higher at the back');
});

test('a track shaped like the usual oval is drawn as that oval: lanes exact offsets, never crossing', async () => {
  // a 400 m track outline drawn with a dozen noisy points
  const pts = [];
  for (let i = 0; i < 12; i++) {
    const a = (2 * Math.PI * i) / 12; const r = 1 + (i % 3 === 0 ? 0.02 : -0.01);
    const x = Math.cos(a) > 0 ? 42.2 + 36.8 * Math.cos(a) * r : -42.2 + 36.8 * Math.cos(a) * r;
    pts.push([x, 36.8 * Math.sin(a) * r]);
  }
  const [p] = planPitches([area('t', pts, { leisure: 'track', sport: 'athletics', lanes: '8' })], project, { groundAt });
  assert.ok(p.stadium, 'fitted as the usual oval');
  const stone = recorder(); const full = recorder();
  buildPitch(stone, full, p);
  // the lane lines: every painted point at a whole number of lanes in from the oval's edge (within the line's width)
  const W = p.box.t1 - p.box.t0; const r0 = W / 2;
  const a = p.box.s0 + r0; const b = p.box.s1 - r0;
  const dist = (x, y) => { const s = x * p.box.u[0] + y * p.box.u[1]; const t = -x * p.box.u[1] + y * p.box.u[0] - (p.box.t0 + p.box.t1) / 2; const sc = Math.max(a, Math.min(b, s)); return r0 - Math.hypot(s - sc, t); };
  const paint = full.tris.filter((t) => t.mat === 'linePaint').flatMap((t) => t.pts);
  for (const q of paint) {
    const d = dist(q[0], q[1]); const k = Math.round(d / 1.22);
    assert.ok(Math.abs(d - k * 1.22) < 0.35 || Math.abs(d - (8 * 1.22 + 0.3)) < 0.35, `paint ${d.toFixed(2)} m in: not on a lane line`);
  }
});

test("home plate where the foul lines meet, even at a rounded corner; the outfield fence on the arc only, none inside a neighbour", async () => {
  const { homePlate } = await import('../services/sportsFields.js');
  // foul lines along +x and +y from a corner rounded by two short edges, the outfield arc 70 m out
  const fan = [[3, 0], [70, 0], ...Array.from({ length: 10 }, (_, i) => [70 * Math.cos((Math.PI / 2) * ((i + 1) / 11)), 70 * Math.sin((Math.PI / 2) * ((i + 1) / 11))]), [0, 70], [0, 3], [1, 1]];
  const tennis = area('tn', rect(-40, 40, 23.77, 10.97), { leisure: 'pitch', sport: 'tennis' });
  const ps = planPitches([area('bb', fan, { leisure: 'pitch', sport: 'baseball' }), tennis], project, { groundAt });
  const p = ps.find((q) => q.id === 'bb');
  const { home, dir } = homePlate(p);
  assert.ok(Math.hypot(home[0], home[1]) < 1.5, `home at the rounded corner: ${home.map((v) => v.toFixed(1))}`);
  assert.ok(dir[0] > 0.5 && dir[1] > 0.5, 'facing the outfield');
  const stone = recorder(); const full = recorder();
  const tee = { tri: (...a) => { stone.tri(...a); full.tri(...a); }, quad: (...a) => { stone.quad(...a); full.quad(...a); } };
  buildPitch(tee, full, p);
  const fencePts = full.tris.filter((t) => t.mat === 'chainlink').flatMap((t) => t.pts);
  const t = ps.find((q) => q.id === 'tn');
  const inR = (x, y, r) => { let o = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i]; const [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) o = !o; } return o; };
  assert.ok(!fencePts.some((q) => inR(q[0], q[1], t.ring)), 'no fence inside the tennis court');
  // outfield fence: points on the arc, none along the foul lines beyond the infield
  const foul = fencePts.filter((q) => (Math.abs(q[1]) < 0.5 && q[0] > 40) || (Math.abs(q[0]) < 0.5 && q[1] > 40));
  assert.equal(foul.length, 0, 'no fence down the foul lines');
});

test('the infield fits inside a field drawn along its foul lines', () => {
  // a Little League fan: foul lines along the axes, the fence 60 m out
  const fan = [[0, 0], [60, 0], ...Array.from({ length: 9 }, (_, i) => [60 * Math.cos((Math.PI / 2) * ((i + 1) / 10)), 60 * Math.sin((Math.PI / 2) * ((i + 1) / 10))]), [0, 60]];
  const [p] = planPitches([area('ll', fan, { leisure: 'pitch', sport: 'baseball' })], project, { groundAt });
  const stone = recorder(); const full = recorder();
  const tee = { tri: (...a) => { stone.tri(...a); full.tri(...a); }, quad: (...a) => { stone.quad(...a); full.quad(...a); } };
  buildPitch(tee, full, p);
  const dirt = full.tris.filter((t) => t.mat === 'dirt').flatMap((t) => t.pts);
  assert.ok(dirt.length > 0);
  // every bit of the infield within a metre of the outline: above both foul lines, inside the fence
  for (const q of dirt) assert.ok(q[0] > -1.01 && q[1] > -1.01 && Math.hypot(q[0], q[1]) < 61, `dirt at (${q[0].toFixed(1)}, ${q[1].toFixed(1)})`);
  const bases = stone.tris.filter((t) => t.mat === 'smoothConcrete').flatMap((t) => t.pts).filter((q) => q[2] > 3.05);
  assert.ok(bases.every((q) => q[0] > 0 && q[1] > 0), 'the bases inside the foul lines');
});

test('dugouts stand in foul territory beside the foul lines', () => {
  const fan = [[0, 0], [100, 0], ...Array.from({ length: 9 }, (_, i) => [100 * Math.cos((Math.PI / 2) * ((i + 1) / 10)), 100 * Math.sin((Math.PI / 2) * ((i + 1) / 10))]), [0, 100]];
  // room for them: the outline's own foul territory, 12 m either side of the foul lines
  const big = [[-12, -12], [100, -12], ...fan.slice(2, -1), [-12, 100]];
  const [p] = planPitches([area('bb', big, { leisure: 'pitch', sport: 'baseball' })], project, { groundAt });
  const stone = recorder(); const full = recorder();
  const tee = { tri: (...a) => { stone.tri(...a); full.tri(...a); }, quad: (...a) => { stone.quad(...a); full.quad(...a); } };
  buildPitch(tee, full, p);
  const walls = stone.tris.filter((t) => t.mat === 'blockwall').flatMap((t) => t.pts);
  assert.ok(walls.length > 0, 'dugouts built');
  // in foul territory: beyond a foul line (the field opens to +x +y from about the corner)
  assert.ok(walls.every((q) => q[0] < 1 || q[1] < 1), `dugout walls in foul territory`);
});

test('the base paths from home to first and third are dirt', () => {
  // foul lines along +x and +y: home sits in on the diagonal, the base lines run along +x and +y from it
  const fan = [[0, 0], [100, 0], ...Array.from({ length: 9 }, (_, i) => [100 * Math.cos((Math.PI / 2) * ((i + 1) / 10)), 100 * Math.sin((Math.PI / 2) * ((i + 1) / 10))]), [0, 100]];
  const [p] = planPitches([area('bb', fan, { leisure: 'pitch', sport: 'baseball' })], project, { groundAt });
  const full = recorder();
  buildPitch(full, full, p);
  const dirt = full.tris.filter((t) => t.mat === 'dirt');
  const inTri = (x, y, [a, b, c]) => { const s = (p1, p2) => (p2[0] - p1[0]) * (y - p1[1]) - (p2[1] - p1[1]) * (x - p1[0]); const d1 = s(a, b); const d2 = s(b, c); const d3 = s(c, a); return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)); };
  const covered = (x, y) => dirt.some((t) => inTri(x, y, t.pts));
  // home plate: the painted pad nearest the corner on the diagonal
  const pads = full.tris.filter((t) => t.mat === 'smoothConcrete').flatMap((t) => t.pts).filter((q) => Math.abs(q[0] - q[1]) < 0.5);
  const h = Math.min(...pads.map((q) => (q[0] + q[1]) / 2));
  const base = 27.43;   // 100 m out: baseball
  for (const [ux, uy] of [[1, 0], [0, 1]]) {
    for (const f of [0.3, 0.5, 0.7]) {
      const x = h + ux * base * f; const y = h + uy * base * f;
      assert.ok(covered(x, y), `dirt on the base line ${ux ? 'to first' : 'to third'} at ${Math.round(f * 100)}%`);
    }
  }
});

test('a track drawn in its tagged colour (colour=blue), else red tartan', () => {
  const oval = (id, tags) => area(id, [[0, 0], [160, 0], [160, 80], [0, 80]], { leisure: 'track', sport: 'athletics', ...tags });
  const colourOf = (tags) => {
    const [p] = planPitches([oval('t', tags)], project, { groundAt });
    const full = recorder();
    // record colours too
    const cols = [];
    const m = { tri: (mat, a, b, c, ua, ub, uc, col) => { if (mat === 'smoothConcrete') cols.push(col); full.tri(mat, a, b, c); }, quad: (mat, a, b, c, d, ua, ub, uc, ud, col) => { if (mat === 'smoothConcrete') cols.push(col); full.quad(mat, a, b, c, d); } };
    buildPitch(m, m, p);
    return cols[0];
  };
  const blue = colourOf({ colour: 'blue' });
  assert.ok(blue[2] > blue[0], `blue: ${blue}`);
  const red = colourOf({});
  assert.ok(red[0] > red[2], `red by default: ${red}`);
});

test('a field mapped over a road leaves the road clear', () => {
  const road = { id: 'r', type: 'road', tags: { highway: 'residential' }, geometry: [[-20, 10], [200, 10]].map(([x, y]) => ({ lat: y, lng: x })) };
  const [p] = planPitches([area('t', [[0, 0], [160, 0], [160, 80], [0, 80]], { leisure: 'track', sport: 'athletics' }), road], project, { groundAt, drape: { drapeAt: () => 3, grid: { sq: 1, ox: -1024, oy: -1024 } } });
  const full = recorder();
  buildPitch(full, full, p);
  const onRoad = full.tris.filter((t) => { const cy = (t.pts[0][1] + t.pts[1][1] + t.pts[2][1]) / 3; return Math.abs(cy - 10) < 4; });
  assert.equal(onRoad.length, 0, 'nothing on the road');
  assert.ok(full.tris.some((t) => t.pts.every((q) => q[1] > 20)), 'the rest of the track built');
});

test('American handball is one-wall courts, no goals', async () => {
  const { pitchSport } = await import('../services/sportsFields.js');
  assert.equal(pitchSport({ leisure: 'pitch', sport: 'american_handball' }, { lat: 40.7, lon: -74 }), 'wallball');
});
