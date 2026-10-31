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
