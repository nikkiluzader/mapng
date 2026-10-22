import test from 'node:test';
import assert from 'node:assert/strict';

import {
  solveBridgeDecks, waterClear, deckHeightAt, DECK_MAX_GRADE, DECK_ROAD_CLEAR_M,
} from '../services/beamngBridges.js';

// A straight bridge along +x from x0 to x1 at y.
const part = (x0, x1, { y = 0, half = 4, layer = 1 } = {}) => ({ xy: [[x0, y], [x1, y]], half, layer });
const zAt = (deck, x) => deckHeightAt(deck.parts[0], x, deck.parts[0].xy[0][1]);
const maxGrade = (p) => {
  let g = 0;
  for (let i = 1; i < p.z.length; i++) {
    const ds = Math.hypot(p.xy[i][0] - p.xy[i - 1][0], p.xy[i][1] - p.xy[i - 1][1]);
    g = Math.max(g, Math.abs(p.z[i] - p.z[i - 1]) / ds);
  }
  return g;
};

test('a valley crossing runs straight between the rims, not down into the valley', () => {
  const valley = (x) => 100 - 40 * Math.sin((Math.PI * Math.min(Math.max(x, 0), 200)) / 200);
  const [deck] = solveBridgeDecks([part(0, 200)], { groundAt: (x) => valley(x) });
  assert.ok(Math.abs(zAt(deck, 0) - 100) < 1e-6, 'abutment at the rim');
  assert.ok(Math.abs(zAt(deck, 100) - 100) < 0.5, `mid-span ${zAt(deck, 100).toFixed(2)} stays at rim height`);
});

test('a long overpass gets (nearly) full headroom over the road under it', () => {
  const road = { layer: 0, xy: [[200, -50, 0], [200, 50, 0]] };
  const [deck] = solveBridgeDecks([part(0, 400)], { groundAt: () => 0, lowerRoads: [road] });
  const mid = zAt(deck, 200);
  assert.ok(mid >= DECK_ROAD_CLEAR_M - 1e-6, `deck ${mid.toFixed(2)} m over the road (kept after smoothing)`);
  assert.ok(maxGrade(deck.parts[0]) <= DECK_MAX_GRADE + 1e-3, `grade ${maxGrade(deck.parts[0]).toFixed(3)}`);
  assert.ok(Math.abs(zAt(deck, 0)) < 1e-6 && Math.abs(zAt(deck, 400)) < 1e-6, 'abutments at the ground');
});

test('a short overpass is limited by the grade from its abutments', () => {
  const road = { layer: 0, xy: [[40, -50, 0], [40, 50, 0]] };
  const [deck] = solveBridgeDecks([part(0, 80)], { groundAt: () => 0, lowerRoads: [road] });
  const mid = zAt(deck, 40);
  assert.ok(mid <= DECK_MAX_GRADE * 40 + 1e-6, `no steeper than ${DECK_MAX_GRADE * 100} % (${mid.toFixed(2)} m)`);
  assert.ok(mid > 0.5, 'but lifted as far as it can');
});

test('a road the deck meets right by its abutment is a junction at grade, not lifted over', () => {
  const road = { layer: 0, xy: [[5, -50, 0], [5, 50, 0]] };
  const [deck] = solveBridgeDecks([part(0, 120)], { groundAt: () => 0, lowerRoads: [road] });
  assert.ok(zAt(deck, 5) < 0.5, `deck ${zAt(deck, 5).toFixed(2)} m at the junction`);
});

test('water: clearance grows with the wet span', () => {
  assert.equal(waterClear(10), 2.5);
  assert.equal(waterClear(100), 15);
  assert.equal(waterClear(1000), 20, 'capped: a ship channel takes the navigation clearance instead');
  assert.equal(waterClear(2000), 5, 'a causeway');
  const wetAt = (x) => x > 300 && x < 400;
  const [deck] = solveBridgeDecks([part(0, 700)], { groundAt: () => 0, wetAt });
  assert.ok(zAt(deck, 350) >= waterClear(100) - 1.5, `${zAt(deck, 350).toFixed(2)} m over a 100 m river`);
});

test('a deck over a deck clears the solved lower one', () => {
  const lower = part(0, 400, { layer: 1 });
  const upper = { xy: [[200, -320], [200, 320]], half: 4, layer: 2 };
  const road = { layer: 0, xy: [[200, -60, 0], [200, 60, 0]] };   // under the lower deck's middle
  const decks = solveBridgeDecks([upper, lower], { groundAt: () => 0, lowerRoads: [road] });
  const lo = decks.find((d) => d.layer === 1);
  const hi = decks.find((d) => d.layer === 2);
  const zLower = zAt(lo, 200);
  const zUpper = deckHeightAt(hi.parts[0], 200, 0);
  assert.ok(zUpper >= zLower + DECK_ROAD_CLEAR_M - 0.5, `upper ${zUpper.toFixed(1)} over lower ${zLower.toFixed(1)}`);
});

test('two parts of one bridge join into one smooth deck', () => {
  const valley = (x) => 50 - 30 * Math.sin((Math.PI * Math.min(Math.max(x, 0), 300)) / 300);
  const decks = solveBridgeDecks([part(0, 150), part(150, 300)], { groundAt: (x) => valley(x) });
  assert.equal(decks.length, 1, 'one chain');
  const [a, b] = decks[0].parts;
  assert.ok(Math.abs(a.z[a.z.length - 1] - b.z[0]) < 0.05, 'no step at the joint');
  assert.ok(Math.abs(deckHeightAt(a, 150, 0) - 50) < 0.5, 'straight between the rims');
});

test('approach ramps: no steeper than 5 %, flat at both ends, lift limited by the road', async () => {
  const { rampLength, rampLift, liftFor, RAMP_GRADE, MAX_RAMP_LIFT_M } = await import('../services/beamngBridges.js');
  const lift = 4;
  const L = rampLength(lift);
  let steepest = 0;
  for (let d = 0; d < L; d += 0.5) steepest = Math.max(steepest, Math.abs(rampLift(d + 0.5, lift, L) - rampLift(d, lift, L)) / 0.5);
  assert.ok(steepest <= RAMP_GRADE + 1e-3, `steepest ${(steepest * 100).toFixed(2)} %`);
  assert.equal(rampLift(0, lift, L), lift);
  assert.equal(rampLift(L, lift, L), 0);
  assert.ok(Math.abs(rampLift(1, lift, L) - lift) < 0.01, 'eases out of the abutment');
  assert.equal(liftFor(20, 1e6), MAX_RAMP_LIFT_M, 'capped');
  assert.ok(liftFor(3, 1e6) > 3, 'a little more than the shortfall');
  assert.ok(liftFor(3, 40) < 1, 'a short approach carries little');
});

test('a bridge shorter than the smoothing window still gets finite heights', () => {
  // two one-way halves joined at their far end (a U), each ~22 m long
  const a = { xy: [[0, -79], [1, -90], [2, -101]], half: 3, layer: 1 };
  const b = { xy: [[2, -101], [4, -91], [6, -81]], half: 3, layer: 1 };
  const decks = solveBridgeDecks([a, b], { groundAt: (x, y) => 2 + 0.01 * y });
  for (const p of decks[0].parts) assert.ok(p.z.every(Number.isFinite), `z ${p.z.map((v) => v.toFixed(2))}`);
});

test('a deck that cannot reach full clearance is built thinner over the road', async () => {
  const { structureDepth } = await import('../services/beamngBridges.js');
  assert.equal(structureDepth(Infinity), 2.2, 'slab + girders over open ground');
  assert.equal(structureDepth(7), 2.2, 'room enough');
  assert.ok(Math.abs(structureDepth(4.1) - 0.9) < 1e-9, 'thinner, no girders');
  assert.equal(structureDepth(2), 0.4, 'at least a thin slab');
  const road = { layer: 0, xy: [[40, -50, 0], [40, 50, 0]] };
  const [deck] = solveBridgeDecks([part(0, 80)], { groundAt: () => 0, lowerRoads: [road] });
  const p = deck.parts[0];
  const gap = deckHeightAt(p, 40, 0);
  assert.ok(gap - p.depth >= Math.min(gap - 0.4, 3.2) - 1e-6, `underside ${(gap - p.depth).toFixed(2)} m over the road`);
});

test('the approach road meeting a bridge at its end is no crossing (full structure kept)', () => {
  const approach = { layer: 0, xy: [[-100, 0, 50], [0, 0, 50]] };
  const valley = (x) => 50 - 30 * Math.sin((Math.PI * Math.min(Math.max(x, 0), 300)) / 300);
  const [deck] = solveBridgeDecks([part(0, 300)], { groundAt: (x) => valley(x), lowerRoads: [approach] });
  assert.equal(deck.parts[0].depth, 2.2, 'slab and girders');
  assert.ok(Math.abs(zAt(deck, 150) - 50) < 0.5, 'and no junction-at-grade dip');
});

test('a cable-stayed bridge over a ship channel clears it by the navigation clearance', async () => {
  const { NAV_CLEAR_M } = await import('../services/beamngBridges.js');
  const wetAt = (x) => x > 1200 && x < 1700;     // a 500 m channel mid-way along a 2.9 km bridge
  const plain = solveBridgeDecks([part(0, 2900)], { groundAt: () => 0, wetAt })[0];
  const stayed = solveBridgeDecks([{ ...part(0, 2900), structure: 'cable-stayed' }], { groundAt: () => 0, wetAt })[0];
  assert.ok(zAt(plain, 1450) < 21, `a plain bridge: ${zAt(plain, 1450).toFixed(1)} m (river rule)`);
  assert.ok(zAt(stayed, 1450) >= NAV_CLEAR_M - 0.5, `cable-stayed: ${zAt(stayed, 1450).toFixed(1)} m over the channel`);
});

test('a ship channel under a plain bridge (deep_draft water) takes the navigation clearance', async () => {
  const { NAV_CLEAR_M } = await import('../services/beamngBridges.js');
  const wetAt = (x) => (x > 1200 && x < 1700 ? 2 : 0);
  const [deck] = solveBridgeDecks([part(0, 2900)], { groundAt: () => 0, wetAt });
  assert.ok(zAt(deck, 1450) >= NAV_CLEAR_M - 0.5, `${zAt(deck, 1450).toFixed(1)} m over the channel`);
});

test('water lookup: the sea by its coastline, islands of mapped land in it, ship channels', async () => {
  const { buildWaterLookup } = await import('../services/exportBeamNGLevel.js');
  // A 2 km map; a coastline running north along lng 0 (land on its left = west),
  // a wood island out in the sea, and a ship-channel river line through the sea.
  const terrainData = {
    width: 200, height: 200, heightMap: new Float32Array(200 * 200), minHeight: 0, maxHeight: 10,
    bounds: { north: 0.009, south: -0.009, east: 0.009, west: -0.009 },
    osmFeatures: [
      { type: 'coastline', tags: { natural: 'coastline' }, geometry: [{ lat: -0.009, lng: 0 }, { lat: 0.009, lng: 0 }] },
      { type: 'landuse', tags: { natural: 'wood' }, geometry: [
        { lat: 0.004, lng: 0.004 }, { lat: 0.004, lng: 0.006 }, { lat: 0.006, lng: 0.006 }, { lat: 0.006, lng: 0.004 }] },
      { type: 'water', tags: { waterway: 'river', ship: 'yes' }, geometry: [{ lat: -0.009, lng: 0.007 }, { lat: 0.003, lng: 0.007 }] },
    ],
  };
  const squareSize = (0.018 * 111320) / 200;
  const at = (lat, lng) => {
    const worldSize = 200 * squareSize;
    return [((lng + 0.009) / 0.018 - 0.5) * worldSize, (0.5 - (0.009 - lat) / 0.018) * worldSize];
  };
  const wetAt = buildWaterLookup(terrainData, squareSize);
  assert.equal(wetAt(...at(0, -0.004)), 0, 'west of the coastline: land');
  assert.equal(wetAt(...at(-0.004, 0.003)), 1, 'east of it: the sea');
  assert.equal(wetAt(...at(0.005, 0.005)), 0, 'the wood island in the sea: land');
  assert.equal(wetAt(...at(-0.002, 0.0072)), 2, 'next to the ship-channel line: a ship channel');
});

test('the ground at an abutment meets the deck: a flat pad, filled under its end, never through it', async () => {
  const { gradeAbutments } = await import('../services/exportBeamNGLevel.js');
  // 400 m map at 2 m a pixel, ground sloping across the road (y); a deck along
  // +x ending at x = 0 at 3 m, rising to 6 m by x = -100, over ground 1.5 m up
  const w = 201; const sq = 2; const size = w * sq;
  const heightMap = new Float32Array(w * w);
  const toWorld = (c, r) => [((c / (w - 1)) - 0.5) * size, (0.5 - r / (w - 1)) * size];
  for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) heightMap[r * w + c] = 3 + 0.1 * toWorld(c, r)[1] + (toWorld(c, r)[0] < 0 ? 1.5 : 0);
  const terrainData = { width: w, height: w, heightMap, minHeight: 0, maxHeight: 100 };
  const part = { xy: [[-100, 0], [-50, 0], [0, 0]], z: [6, 4.5, 3], half: 4 };
  const graded = gradeAbutments(terrainData, sq, [{ parts: [part], abutments: [[0, 0]] }]);
  assert.ok(graded > 0);
  const at = (x, y) => terrainData.heightMap[Math.round((0.5 - y / size) * (w - 1)) * w + Math.round((x / size + 0.5) * (w - 1))];
  for (const y of [-4, 0, 4]) assert.ok(Math.abs(at(2, y) - 3) < 1e-6, `flat pad across the road at y ${y}: ${at(2, y).toFixed(2)}`);
  assert.ok(Math.abs(at(-2, 0) - (3 + 0.03 - 0.05)) < 0.05, `filled up under the deck's end: ${at(-2, 0).toFixed(2)}`);
  for (let x = -28; x <= -4; x += 2) assert.ok(at(x, 0) <= 3 - 0.03 * x - 0.14, `under the deck at x ${x}: ${at(x, 0).toFixed(2)}`);
  assert.ok(Math.abs(at(40, 0) - 3) < 1e-6, 'the ground beyond the pad untouched');
});
