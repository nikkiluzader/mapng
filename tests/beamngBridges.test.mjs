import test from 'node:test';
import assert from 'node:assert/strict';

import {
  solveBridgeDecks, waterClear, deckHeightAt, DECK_MAX_GRADE, DECK_ROAD_CLEAR_M, mergeOverlaps, buildDeckGeometry, deckEdges, alongDeck,
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

test('an overpass baked into the elevation: the road under it is not drawn over the hump', async () => {
  const { generateDecalRoads } = await import('../services/exportBeamNGLevel.js');
  // 1 km flat at 10 m; a 6.5 m ridge along y = 0 (the bridge and its
  // embankments in the DEM), as I-65 under SR 114 in 30 m Terrarium
  const N = 512; const size = 1000; const sq = size / (N - 1); const deg = size / 111320;
  const hm = new Float32Array(N * N);
  for (let r = 0; r < N; r++) {
    const y = (0.5 - r / (N - 1)) * size;
    for (let c = 0; c < N; c++) hm[r * N + c] = 10 + 6.5 * Math.exp(-((y / 15) ** 2));
  }
  const ll = (x, y) => ({ lat: (y / size) * deg, lng: (x / size) * deg });
  const way = (id, pts, tags) => ({ id, type: 'road', geometry: pts.map(([x, y]) => ll(x, y)), tags });
  const groups = generateDecalRoads({
    width: N, height: N, minHeight: 10, maxHeight: 16.5, heightMap: hm,
    bounds: { south: -deg / 2, north: deg / 2, west: -deg / 2, east: deg / 2 },
    roadRules: { countryCode: 'US', region: 'Americas' },
    osmFeatures: [
      way('1', [[-300, 0], [-40, 0]], { highway: 'secondary', name: 'SR 114' }),
      way('2', [[-40, 0], [40, 0]], { highway: 'secondary', name: 'SR 114', bridge: 'yes', layer: '1' }),
      way('3', [[40, 0], [300, 0]], { highway: 'secondary', name: 'SR 114' }),
      way('4', [[0, -300], [0, 300]], { highway: 'motorway', name: 'I-65', oneway: 'yes' }),
    ],
  }, sq);
  const base = groups.flatMap((g) => g.__items).filter((d) => d.name.startsWith('dr_I_65') && d.material === 'road_asphalt_2lane');
  const nodes = base.flatMap((d) => d.nodes);
  const zNear = (y0) => nodes.reduce((best, n) => (Math.abs(n[1] - y0) < Math.abs(best[1] - y0) ? n : best))[2];
  assert.ok(zNear(0) - zNear(80) < 0.6, `I-65 climbs ${(zNear(0) - zNear(80)).toFixed(2)} m under the bridge`);
  assert.ok(groups.bridges.humps.length > 0, 'the hump was found');
  const deck = groups.bridges.decks[0].parts[0];
  const mid = deck.z[deck.xy.findIndex(([x]) => x >= 0)];
  assert.ok(mid - zNear(0) > 5.5, `deck ${(mid - zNear(0)).toFixed(2)} m over I-65`);
});

test('a short flyover whose embankment cannot be raised is carried on along its approach', async () => {
  const { generateDecalRoads } = await import('../services/exportBeamNGLevel.js');
  // flat 1 km; a 60 m trunk_link bridge over a motorway, a frontage road
  // right beside its approaches (no room for an embankment)
  const N = 512; const size = 1000; const sq = size / (N - 1); const deg = size / 111320;
  const ll = (x, y) => ({ lat: (y / size) * deg, lng: (x / size) * deg });
  const way = (id, pts, tags) => ({ id, type: 'road', geometry: pts.map(([x, y]) => ll(x, y)), tags });
  const groups = generateDecalRoads({
    width: N, height: N, minHeight: 0, maxHeight: 1, heightMap: new Float32Array(N * N),
    bounds: { south: -deg / 2, north: deg / 2, west: -deg / 2, east: deg / 2 },
    roadRules: { countryCode: 'US', region: 'Americas' },
    osmFeatures: [
      way('1', [[-400, 0], [-30, 0]], { highway: 'trunk_link', oneway: 'yes' }),
      way('2', [[-30, 0], [30, 0]], { highway: 'trunk_link', oneway: 'yes', bridge: 'yes', layer: '1' }),
      way('3', [[30, 0], [400, 0]], { highway: 'trunk_link', oneway: 'yes' }),
      way('4', [[0, -400], [0, 400]], { highway: 'motorway', name: 'I-1', oneway: 'yes' }),
      way('5', [[-400, 9], [-40, 9]], { highway: 'residential', name: 'Frontage West' }),
      way('6', [[40, 9], [400, 9]], { highway: 'residential', name: 'Frontage East' }),
    ],
  }, sq);
  const b = groups.bridges;
  assert.ok(b.carried > 0, 'carried on');
  assert.ok(b.decks[0].roadShortfall < 0.6, `short ${b.decks[0].roadShortfall.toFixed(2)} m over the motorway`);
  const ramp = groups.flatMap((g) => g.__items).filter((d) => d.class === 'DecalRoad' && d.overObjects && d.material === 'road_asphalt_2lane');
  assert.ok(ramp.length >= 3, 'the approaches are drawn on the deck');
});

// A ramp forking off a deck at a shallow angle: two branches from (0, 0),
// one straight on, one bearing 15° left.
const forkDeck = () => {
  const n = 60;
  const straight = Array.from({ length: n }, (_, k) => [2 * k, 0]);
  const ramp = Array.from({ length: n }, (_, k) => [2 * k * Math.cos(0.26), 2 * k * Math.sin(0.26)]);
  return {
    parts: [
      { xy: [[-60, 0], [-30, 0], [0, 0]], z: [8, 8, 8], half: 5 },
      { xy: straight, z: straight.map(([x]) => 8 + 0.03 * x), half: 5 },
      { xy: ramp, z: ramp.map(([x]) => 8 - 0.02 * x), half: 4 },
    ],
  };
};

test('a fork: the branches take one height while they overlap', () => {
  const deck = forkDeck();
  const [, a, b] = deck.parts;
  mergeOverlaps(deck.parts);
  // 20 m out the branches still overlap (5 m apart, halves 5 + 4)
  const k = 10;
  assert.ok(Math.abs(a.z[k] - deckHeightAt(b, a.xy[k][0], a.xy[k][1])) < 0.15, `step ${(a.z[k] - b.z[k]).toFixed(2)} m at 20 m`);
  // 110 m out they are apart and keep their own heights
  assert.ok(Math.abs(a.z[55] - (8 + 0.03 * 110)) < 0.05 && Math.abs(b.z[55] - (8 - 0.02 * 110 * Math.cos(0.26))) < 0.05);
});

test('a fork: no parapet stands on the other branch, none at the joins', () => {
  const deck = forkDeck();
  mergeOverlaps(deck.parts);
  const { positions } = buildDeckGeometry(deck, { groundAt: () => -50 });
  // parapet tops (0.9 m over the deck) inside the other branch's road
  const [, a, b] = deck.parts;
  let onRoad = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const [x, y, z] = [positions[i], positions[i + 1], positions[i + 2]];
    for (const [p, q] of [[a, b], [b, a]]) {
      const zp = deckHeightAt(p, x, y);
      if (Math.abs(z - zp - 0.9) > 0.05) continue;
      // a parapet top: along p's own edge
      const dp = Math.min(...p.xy.map(([px, py]) => Math.hypot(px - x, py - y)));
      if (dp < p.half - 0.1 || dp > p.half + 1.5) continue;
      // inside q's road (not its parapet strip), alongside it
      const t = q.xy.findIndex(([qx]) => qx > x);
      if (t < 1 || t > q.xy.length - 2) continue;
      const d = Math.abs((x - q.xy[t][0]) * -(q.xy[t + 1][1] - q.xy[t][1]) + (y - q.xy[t][1]) * (q.xy[t + 1][0] - q.xy[t][0])) / 2;
      if (d < q.half - 0.3) onRoad++;
    }
  }
  assert.equal(onRoad, 0, 'parapet vertices on the other branch');
});

test('a fork: the branches start as wide as the deck coming in, then narrow to their own', () => {
  const deck = forkDeck();
  deck.parts[0].half = 8;   // a wide deck forking into a 5 m and a 4 m ramp
  const e = deckEdges(deck);
  // the straight branch is the right one (the ramp bears left)
  assert.ok(Math.abs(e[2].hl[0] - 8) < 1e-6, `left edge of the left branch at the joint ${e[2].hl[0]}`);
  assert.ok(Math.abs(e[1].hr[0] - 8) < 1e-6, `right edge of the right branch at the joint ${e[1].hr[0]}`);
  assert.equal(e[2].hr[0], 4, 'inner sides keep their own width');
  assert.equal(e[1].hr[e[1].hr.length - 1], 5, 'far out its own width');
  // a plain join: the narrower part tapers up to the wider
  const plain = { parts: [{ xy: [[-40, 0], [0, 0]], z: [0, 0], half: 6 }, { xy: [[0, 0], [20, 0], [40, 0], [60, 0]], z: [0, 0, 0, 0], half: 4 }] };
  const ep = deckEdges(plain);
  assert.equal(ep[1].hl[0], 6);
  assert.equal(ep[1].hl[3], 4);
});

// A flat 1 km map for the network cases below.
const flatMap = async (features) => {
  const { generateDecalRoads } = await import('../services/exportBeamNGLevel.js');
  const N = 512; const size = 1000; const sq = size / (N - 1); const deg = size / 111320;
  const ll = (x, y) => ({ lat: (y / size) * deg, lng: (x / size) * deg });
  // (20 m above the sea: a road under a bridge sinks no lower than it)
  const groups = generateDecalRoads({
    width: N, height: N, minHeight: 20, maxHeight: 21, heightMap: new Float32Array(N * N).fill(20),
    bounds: { south: -deg / 2, north: deg / 2, west: -deg / 2, east: deg / 2 },
    roadRules: { countryCode: 'US', region: 'Americas' },
    osmFeatures: features.map(([id, pts, tags]) => ({ id, type: 'road', geometry: pts.map(([x, y]) => ll(x, y)), tags })),
  }, sq);
  return groups;
};

test('a crossroads on an overpass is one deck: one height, no parapet across either road', async () => {
  // two bridge ways crossing at a shared node (both running on through it)
  // over a motorway along x = 0
  const groups = await flatMap([
    ['1', [[-300, 0], [-60, 0]], { highway: 'primary', name: 'A' }],
    ['2', [[-60, 0], [0, 0], [60, 0]], { highway: 'primary', name: 'A', bridge: 'yes', layer: '1' }],
    ['3', [[60, 0], [300, 0]], { highway: 'primary', name: 'A' }],
    ['4', [[0, -300], [0, -60]], { highway: 'secondary', name: 'B' }],
    ['5', [[0, -60], [0, 0], [0, 60]], { highway: 'secondary', name: 'B', bridge: 'yes', layer: '1' }],
    ['6', [[0, 60], [0, 300]], { highway: 'secondary', name: 'B' }],
    ['7', [[-30, -400], [-30, 400]], { highway: 'motorway', name: 'M', oneway: 'yes' }],
  ]);
  const { decks } = groups.bridges;
  assert.equal(decks.length, 1, 'one deck');
  const { buildDeckGeometry: build } = await import('../services/beamngBridges.js');
  const P = build(decks[0], { groundAt: () => 0 }).positions;
  const zAt0 = deckHeightAt(decks[0].parts.find((p) => p.xy.some(([x, y]) => Math.hypot(x, y) < 1)), 0, 0);
  // no parapet top across the other road's carriageway: A's edge lines
  // (|y| ~ hA) inside B's road (|x| < hB), and B's inside A's
  const halfOf = (dx, dy) => decks[0].parts.find((p) => {
    const [a, c] = [p.xy[0], p.xy[p.xy.length - 1]];
    return Math.abs((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) < 1e-6 * Math.hypot(c[0] - a[0], c[1] - a[1]) + 1e-3 && p.xy.some(([x, y]) => Math.hypot(x, y) < 1);
  }).half;
  const hA = halfOf(1, 0); const hB = halfOf(0, 1);
  let across = 0;
  for (let i = 0; i < P.length; i += 3) {
    const [x, y, z] = [P[i], P[i + 1], P[i + 2]];
    if (Math.abs(z - zAt0 - 0.9) > 0.05) continue;
    if (Math.abs(x) < hB - 0.2 && Math.abs(y) < hA + 0.6) across++;
    if (Math.abs(y) < hA - 0.2 && Math.abs(x) < hB + 0.6) across++;
  }
  assert.equal(across, 0, 'parapet vertices across the crossing roads');
});

test('carriageways merging into the street at the ends of their bridge: the deck comes down to it', async () => {
  // a one-way pair over a motorway, each carried down its approach; the pair
  // meets the two-way street beyond at a node no bridge reaches
  const groups = await flatMap([
    ['1', [[-6, -140], [-6, -60]], { highway: 'primary', name: 'A', oneway: 'yes' }],
    ['2', [[-6, -60], [-6, 60]], { highway: 'primary', name: 'A', oneway: 'yes', bridge: 'yes', layer: '1' }],
    ['3', [[6, 60], [6, -60]], { highway: 'primary', name: 'A', oneway: 'yes', bridge: 'yes', layer: '1' }],
    ['4', [[-6, 60], [0, 200]], { highway: 'primary', name: 'A', oneway: 'yes' }],
    ['5', [[0, 200], [6, 60]], { highway: 'primary', name: 'A', oneway: 'yes' }],
    ['6', [[6, -60], [6, -140]], { highway: 'primary', name: 'A', oneway: 'yes' }],
    ['8', [[0, 200], [0, 400]], { highway: 'primary', name: 'A' }],
    ['7', [[-400, 0], [400, 0]], { highway: 'motorway', name: 'M', oneway: 'yes' }],
  ]);
  // every open end of every deck sits on the ground (no dead end in the air)
  for (const deck of groups.bridges.decks) {
    for (const [x, y] of deck.abutments) {
      const part = deck.parts.find((p) => [p.xy[0], p.xy[p.xy.length - 1]].some((e) => Math.hypot(e[0] - x, e[1] - y) < 1));
      assert.ok(Math.abs(deckHeightAt(part, x, y)) < 0.3, `deck end at (${x.toFixed(0)}, ${y.toFixed(0)}) ${deckHeightAt(part, x, y).toFixed(2)} m up`);
    }
  }
});

test('a street with junctions right by its bridge: the road under sinks instead', async () => {
  // a 60 m bridge over a motorway, cross streets 20 m beyond each end (no room
  // to ramp up 6.5 m)
  const groups = await flatMap([
    ['1', [[-200, -50], [-200, 50]], { highway: 'residential', name: 'W' }],
    ['2', [[200, -50], [200, 50]], { highway: 'residential', name: 'E' }],
    ['3', [[-200, 0], [-50, 0]], { highway: 'secondary', name: 'S' }],
    ['4', [[-50, 0], [-30, 0]], { highway: 'secondary', name: 'S' }],
    ['5', [[-30, 0], [30, 0]], { highway: 'secondary', name: 'S', bridge: 'yes', layer: '1' }],
    ['6', [[30, 0], [50, 0]], { highway: 'secondary', name: 'S' }],
    ['7', [[50, 0], [200, 0]], { highway: 'secondary', name: 'S' }],
    ['8', [[-50, -50], [-50, 0], [-50, 50]], { highway: 'residential', name: 'X1' }],
    ['9', [[50, -50], [50, 0], [50, 50]], { highway: 'residential', name: 'X2' }],
    ['10', [[0, -400], [0, 400]], { highway: 'motorway', name: 'M', oneway: 'yes' }],
  ]);
  const b = groups.bridges;
  assert.ok(b.sunk > 0, 'the motorway sank');
  // (sunk at most 5 m: a full 6.5 m cut flooded a coastal city's interchange)
  assert.ok(b.decks[0].roadShortfall < 1.5, `short ${b.decks[0].roadShortfall.toFixed(2)} m`);
  const m = groups.flatMap((g) => g.__items).filter((d) => d.name.startsWith('dr_M') && d.material === 'road_asphalt_2lane').flatMap((d) => d.nodes);
  const zNear = (y0) => m.reduce((best, n) => (Math.abs(n[1] - y0) < Math.abs(best[1] - y0) ? n : best))[2];
  assert.ok(zNear(0) < -3, `the motorway under the bridge at ${zNear(0).toFixed(2)} m`);
  assert.ok(Math.abs(zNear(350)) < 0.3, 'back at the ground away from it');
});

test('a road passing under a short bridge near its abutment is cleared, not met at grade', async () => {
  // a 26 m motorway bridge; a link loops under it 8 m from one abutment and
  // joins nothing there (Norfolk: I-264 over its loop ramps)
  const groups = await flatMap([
    ['1', [[-300, 0], [-13, 0]], { highway: 'motorway', name: 'M', oneway: 'yes' }],
    ['2', [[-13, 0], [13, 0]], { highway: 'motorway', name: 'M', oneway: 'yes', bridge: 'yes', layer: '1' }],
    ['3', [[13, 0], [300, 0]], { highway: 'motorway', name: 'M', oneway: 'yes' }],
    // (nodes every 5 m, as a curving ramp is mapped)
    ['4', Array.from({ length: 121 }, (_, i) => [5, -300 + 5 * i]), { highway: 'motorway_link', name: 'L', oneway: 'yes' }],
  ]);
  const deck = groups.flatMap((g) => g.__items).filter((d) => d.name.startsWith('dr_M') && d.material === 'road_asphalt_2lane').flatMap((d) => d.nodes);
  const link = groups.flatMap((g) => g.__items).filter((d) => d.name.startsWith('dr_L') && d.material === 'road_asphalt_2lane').flatMap((d) => d.nodes);
  const near = (nodes, x, y) => nodes.reduce((b, n) => (Math.hypot(n[0] - x, n[1] - y) < Math.hypot(b[0] - x, b[1] - y) ? n : b))[2];
  const gap = near(deck, 5, 0) - near(link, 5, 0);
  assert.ok(gap > 5, `deck ${gap.toFixed(2)} m over the link`);
});

test('a railing along a deck over it is the deck\'s own; one crossing under it is not', () => {
  // a deck along +x at 8 m, 4 m half width
  const decks = [{ parts: [{ xy: [[0, 0], [100, 0]], z: [8, 8], half: 4 }] }];
  assert.ok(alongDeck(decks, 50, 3, 0, 0), 'along the deck, under its edge');
  assert.ok(!alongDeck(decks, 50, 3, 0, Math.PI / 2), 'across under it');
  assert.ok(!alongDeck(decks, 50, 12, 0, 0), 'alongside, clear of it');
  assert.ok(!alongDeck(decks, 50, 3, 7.5, 0), 'on the deck itself');
  // 2 m past its edge: the railing of a real overpass, a ground road's beside a low ramp
  assert.ok(alongDeck(decks, 50, 6.5, 0, 0), 'just outside an overpass 8 m up');
  assert.ok(!alongDeck(decks, 50, 6.5, 6, 0), 'just outside a deck 2 m up');
});
