import test from 'node:test';
import assert from 'node:assert/strict';

import { planPools, buildPool, poolFootprints, deckWidth, poolWaterBlocks, poolWaterLevel, squareOpens } from '../services/pools.js';

// world metres = (lng, lat); ground 5 m everywhere
const project = (lat, lng) => [lng, lat, 5];
const area = (id, pts, tags, type = 'landuse') => ({ id, type, tags, geometry: [...pts, pts[0]].map(([x, y]) => ({ lat: y, lng: x })) });
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const inRing = (x, y, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
function recorder() {
  const tris = [];
  const add = (mat, pts) => { for (const p of pts) assert.ok(p.every(Number.isFinite), `finite ${p}`); tris.push({ mat, pts }); };
  return { tris, tri: (m, a, b, c) => add(m, [a, b, c]), quad: (m, a, b, c, d) => { add(m, [a, b, c]); add(m, [a, c, d]); } };
}
const up = ([a, b, c]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

test('pools: kinds, lanes on a big public rectangle, indoor / roof / in-building ones left out', () => {
  const feats = [
    area('back', rect(0, 0, 10, 5), { leisure: 'swimming_pool', access: 'private' }),
    area('muni', rect(100, 0, 25, 12.5), { leisure: 'swimming_pool' }),
    area('kids', rect(200, 0, 6, 6), { leisure: 'swimming_pool', swimming_pool: 'wading' }),
    area('above', rect(300, 0, 5, 5), { leisure: 'swimming_pool', swimming_pool: 'above_ground' }),
    area('roof', rect(400, 0, 10, 5), { leisure: 'swimming_pool', location: 'roof' }),
    area('in', rect(500, 0, 10, 5), { leisure: 'swimming_pool', indoor: 'yes' }),
    area('hotel', rect(600, 0, 10, 5), { leisure: 'swimming_pool' }),
    area('hotelBld', rect(590, -10, 40, 30), { building: 'hotel' }, 'building'),
  ];
  const pools = planPools(feats, project);
  const by = Object.fromEntries(pools.map((p) => [p.id, p]));
  assert.deepEqual(Object.keys(by).sort(), ['above', 'back', 'kids', 'muni']);
  assert.equal(by.back.kind, 'inground');
  assert.equal(by.back.lanes, 0, 'a private pool has no lanes');
  assert.equal(by.muni.lanes, 5, '12.5 m wide: five 2.5 m lanes');
  assert.equal(by.kids.kind, 'wading');
  assert.equal(by.above.kind, 'above');
  assert.equal(planPools(feats, project, { squareSize: 4 }).length, 0, 'no pools on 4 m terrain squares');
});

test('a sunk pool: a tiled floor below the water, everything inside its deck, openings covered by the deck', () => {
  for (const [id, tags, w, h] of [['b', { access: 'private' }, 10, 5], ['m', {}, 25, 12.5], ['k', { swimming_pool: 'kids' }, 6, 6]]) {
    const [p] = planPools([area(id, rect(0, 0, w, h), { leisure: 'swimming_pool', ...tags })], project);
    const stone = recorder(); const full = recorder();
    const tee = { tri: (...a) => { stone.tri(...a); full.tri(...a); }, quad: (...a) => { stone.quad(...a); full.quad(...a); } };
    assert.ok(buildPool(tee, full, p));
    const zw = poolWaterLevel(p);
    assert.ok(zw < 5 && zw > 4.8, `${id}: water just under the deck (${zw})`);
    const floor = stone.tris.filter((x) => x.mat === 'poolTile' && up(x.pts) > 0 && x.pts.every((q) => q[2] < zw - 0.3));
    assert.ok(floor.length, `${id}: a floor under the water`);
    // a rectangle round the pool, past it by at least the deck width, within its deck
    const xs = p.deckRect.map((q) => q[0]); const ys = p.deckRect.map((q) => q[1]);
    assert.ok(Math.min(...xs) <= -deckWidth(1) && Math.max(...xs) >= w + deckWidth(1) && Math.min(...ys) <= -deckWidth(1) && Math.max(...ys) >= h + deckWidth(1), `${id}: deck round the pool`);
    const out = [[Math.min(...xs) - 0.1, Math.min(...ys) - 0.1], [Math.max(...xs) + 0.1, Math.min(...ys) - 0.1], [Math.max(...xs) + 0.1, Math.max(...ys) + 0.1], [Math.min(...xs) - 0.1, Math.max(...ys) + 0.1]];
    assert.ok(full.tris.every((x) => x.pts.every((q) => inRing(q[0], q[1], out))), `${id}: within its deck`);
    const { holes } = poolFootprints([p]);
    // on 1 m squares: every square any of the pool touches opens, every opened one lies under the deck
    for (let c = -6; c < w + 6; c++) for (let r = -6; r < h + 6; r++) {
      const sq = [[c, r], [c + 1, r], [c + 1, r + 1], [c, r + 1]];
      const opens = squareOpens(sq, holes[0]);
      let touches = false;
      for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) if (inRing(c + i / 8, r + j / 8, p.ring)) touches = true;
      if (touches) assert.ok(opens, `${id}: square (${c}, ${r}) under the pool left closed`);
      if (opens) assert.ok(sq.every(([x, y]) => inRing(x, y, holes[0].cover)), `${id}: square (${c}, ${r}) opened past the deck`);
    }
  }
});

test('pool water blocks: one for a rectangle, small ones over a round pool reaching every part of it and no further than under its coping', () => {
  const [r] = planPools([area('r', rect(0, 0, 10, 5), { leisure: 'swimming_pool' })], project);
  const rb = poolWaterBlocks(r);
  assert.equal(rb.length, 1);
  assert.ok(Math.abs(rb[0].sx - 10) < 0.01 && Math.abs(rb[0].sy - 5) < 0.01 && Math.abs(rb[0].cx - 5) < 0.01 && Math.abs(rb[0].cy - 2.5) < 0.01);
  // a round pool, 8 m across
  const circle = Array.from({ length: 32 }, (_, i) => [20 + 4 * Math.cos((2 * Math.PI * i) / 32), 20 + 4 * Math.sin((2 * Math.PI * i) / 32)]);
  const [c] = planPools([area('c', circle, { leisure: 'swimming_pool' })], project);
  const cb = poolWaterBlocks(c);
  assert.ok(cb.length > 1 && cb.length < 40, `blocks: ${cb.length}`);
  const under = (x, y) => cb.some((b) => {
    const dx = x - b.cx; const dy = y - b.cy;
    const s = dx * b.u[0] + dy * b.u[1]; const t = -dx * b.u[1] + dy * b.u[0];
    return Math.abs(s) <= b.sx / 2 + 1e-6 && Math.abs(t) <= b.sy / 2 + 1e-6;
  });
  for (let x = 16.2; x <= 23.8; x += 0.2) for (let y = 16.2; y <= 23.8; y += 0.2) {
    if (Math.hypot(x - 20, y - 20) < 3.9) assert.ok(under(x, y), `water at (${x.toFixed(1)}, ${y.toFixed(1)})`);
  }
  for (const b of cb) for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x = b.cx + (b.u[0] * sx * b.sx - b.u[1] * sy * b.sy) / 2; const y = b.cy + (b.u[1] * sx * b.sx + b.u[0] * sy * b.sy) / 2;
    assert.ok(Math.hypot(x - 20, y - 20) < 4 + 0.75, `corner (${x.toFixed(2)}, ${y.toFixed(2)}) under the coping`);
  }
});

test('pool decks: kept off a road beside them; on a slope raised to the highest ground, a fence round it and stairs down', () => {
  const road = { id: 'r', type: 'road', tags: { highway: 'residential' }, geometry: [[-50, -8], [60, -8]].map(([x, y]) => ({ lat: y, lng: x })) };
  const [p] = planPools([area('b', rect(0, 0, 10, 5), { leisure: 'swimming_pool', access: 'private' }), road], project);
  const minY = Math.min(...p.deckRect.map((q) => q[1]));
  assert.ok(minY >= -8 + 4 + 1.5 - 1e-6, `deck clear of the road and its sidewalk: ${minY.toFixed(2)}`);
  assert.ok(Math.max(...p.deckRect.map((q) => q[1])) > 5 + 1.7, 'the far side keeps its full width');
  // ground falling 0.3 m per metre to the south: the deck at the top, raised over the low side
  const groundAt = (x, y) => 5 + 0.3 * y;
  const slope = (lat, lng) => [lng, lat, groundAt(lng, lat)];
  const [q] = planPools([area('h', rect(0, 0, 10, 5), { leisure: 'swimming_pool', access: 'private' })], slope, { groundAt });
  const top = Math.max(...q.deckRect.map(([x, y]) => groundAt(x, y)));
  assert.ok(Math.abs(q.zDeck - top - 0.08) < 0.05, `deck at the highest ground: ${q.zDeck.toFixed(2)} vs ${top.toFixed(2)}`);
  const stone = recorder(); const full = recorder();
  const tee = { tri: (...a) => { stone.tri(...a); full.tri(...a); }, quad: (...a) => { stone.quad(...a); full.quad(...a); } };
  buildPool(tee, full, q);
  const metal = stone.tris.filter((x) => x.mat === 'metalWhite');
  assert.ok(metal.some((x) => x.pts.some((pt) => pt[2] > q.zDeck + 1)), 'a fence on the raised deck');
  // stairs: deck-coloured blocks stepping down outside the deck, the lowest near the ground
  const lowY = Math.min(...q.deckRect.map((c) => c[1]));
  const steps = stone.tris.filter((x) => x.mat === 'poolDeck' && x.pts.every((pt) => pt[1] < lowY - 0.05));
  assert.ok(steps.length > 0, 'stairs down from the low side');
  const lowestStep = Math.min(...steps.filter((x) => up(x.pts) > 0).map((x) => x.pts[0][2]));
  const footY = Math.min(...steps.flatMap((x) => x.pts.map((pt) => pt[1])));
  assert.ok(lowestStep - groundAt(5, footY) < STEP_TOL, `stairs reach the ground: ${lowestStep.toFixed(2)} vs ${groundAt(5, footY).toFixed(2)}`);
});
const STEP_TOL = 0.5;

test('pool outlines: a blocky free-form pool smoothed through its mapped points, square-cornered ones as mapped', () => {
  // a kidney mapped with seven points
  const kidney = [[0, 0], [5, -1], [9, 1], [10, 4], [7, 6], [4, 4.5], [1, 5]];
  const [k] = planPools([area('k', kidney, { leisure: 'swimming_pool' })], project);
  assert.ok(k.ring.length > 40, `smoothed: ${k.ring.length} points`);
  for (const q of kidney) assert.ok(k.ring.some((r) => Math.hypot(r[0] - q[0], r[1] - q[1]) < 1e-6), `through (${q})`);
  const A = (r) => Math.abs(r.reduce((a, p, i) => { const n = r[(i + 1) % r.length]; return a + p[0] * n[1] - n[0] * p[1]; }, 0)) / 2;
  // (the curve bows out between the mapped corners: the pool the corners were taken from)
  assert.ok(Math.abs(A(k.ring) - A(kidney)) / A(kidney) < 0.2, `about the same size: ${A(k.ring).toFixed(1)} vs ${A(kidney).toFixed(1)}`);
  // no sharp corner left: every turn small
  for (let i = 0; i < k.ring.length; i++) {
    const a = k.ring[(i - 1 + k.ring.length) % k.ring.length]; const b = k.ring[i]; const c = k.ring[(i + 1) % k.ring.length];
    const u = [b[0] - a[0], b[1] - a[1]]; const v = [c[0] - b[0], c[1] - b[1]];
    const cos = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v));
    assert.ok(cos > 0.7, `a turn of ${(Math.acos(cos) * 180 / Math.PI).toFixed(0)} degrees at point ${i}`);
  }
  // rectangles and L shapes as mapped
  const [r] = planPools([area('r', rect(0, 0, 10, 5), { leisure: 'swimming_pool' })], project);
  assert.equal(r.ring.length, 4);
  const L = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 8], [0, 8]];
  const [l] = planPools([area('l', L, { leisure: 'swimming_pool' })], project);
  assert.equal(l.ring.length, 6);
});

test('pool shapes drawn as mapped: rectangles, L shapes, octagons, clipped corners, trapezoids, fine circles; a lazy kidney is free-form', async () => {
  const { poolShape } = await import('../services/pools.js');
  const oct = Array.from({ length: 8 }, (_, i) => [5 * Math.cos((Math.PI * i) / 4), 5 * Math.sin((Math.PI * i) / 4)]);
  const hex = Array.from({ length: 6 }, (_, i) => [4 * Math.cos((Math.PI * i) / 3), 4 * Math.sin((Math.PI * i) / 3)]);
  const fine = Array.from({ length: 40 }, (_, i) => [4 * Math.cos((2 * Math.PI * i) / 40), 4 * Math.sin((2 * Math.PI * i) / 40)]);
  assert.equal(poolShape(rect(0, 0, 10, 5)), 'rectilinear');
  assert.equal(poolShape([[0, 0], [10, 0], [10, 4], [4, 4], [4, 8], [0, 8]]), 'rectilinear');
  assert.equal(poolShape([[0, 0], [5, 0], [10, 0], [10, 5], [0, 5]]), 'rectilinear', 'a point mid-edge is no corner');
  assert.equal(poolShape(oct), 'geometric');
  assert.equal(poolShape(hex), 'geometric');
  assert.equal(poolShape([[1, 0], [9, 0], [10, 1], [10, 4], [9, 5], [1, 5], [0, 4], [0, 1]]), 'geometric', 'Grecian: clipped corners');
  assert.equal(poolShape([[0, 0], [10, 0], [8, 5], [2, 5]]), 'simple', 'a trapezoid');
  assert.equal(poolShape(fine), 'detailed');
  assert.equal(poolShape([[0, 0], [5, -1], [9, 1], [10, 4], [7, 6], [4, 4.5], [1, 5]]), 'freeform');
});

test('pool holes: a smoothed kidney opens every square its curved wall crosses', () => {
  const kidney = [[0.3, 0.2], [5.1, -1.1], [9.2, 0.9], [10.4, 4.2], [7.3, 6.1], [4.2, 4.4], [1.1, 5.3]];
  const [k] = planPools([area('k', kidney, { leisure: 'swimming_pool' })], project);
  const { holes } = poolFootprints([k]);
  for (let c = -4; c < 15; c++) for (let r = -5; r < 11; r++) {
    const sq = [[c, r], [c + 1, r], [c + 1, r + 1], [c, r + 1]];
    let touches = false;
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) if (inRing(c + i / 8, r + j / 8, k.ring)) touches = true;
    if (touches) assert.ok(squareOpens(sq, holes[0]), `square (${c}, ${r}) under the curved wall left closed`);
  }
});
