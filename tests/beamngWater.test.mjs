import test from 'node:test';
import assert from 'node:assert/strict';

import { planRivers, planLakes, RIVER_KINDS } from '../services/beamngWater.js';

// World metres = (lng, lat) so the tests read in metres.
const toWorld = (lat, lng) => [lng, lat];
const line = (pts, tags) => ({ type: 'water', tags, geometry: pts.map(([x, y]) => ({ lat: y, lng: x })) });
const ring = (pts, tags) => line([...pts, pts[0]], tags);
const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

test('dry washes, culverts and drains make no River; chained ways make one', () => {
  const sloped = (x) => 100 - x * 0.01;
  const { rivers, stats } = planRivers({
    features: [
      line([[0, 0], [200, 0]], { waterway: 'river' }),
      line([[200, 0], [400, 0]], { waterway: 'river' }),
      line([[0, 50], [300, 50]], { waterway: 'stream', intermittent: 'yes' }),
      line([[0, 80], [300, 80]], { waterway: 'stream', tunnel: 'culvert' }),
      line([[0, 120], [300, 120]], { waterway: 'drain' }),
    ],
    toWorld,
    heightAt: (x) => sloped(x),
  });
  assert.equal(rivers.length, 1, 'the two river ways are chained');
  assert.deepEqual([stats.dry, stats.underground, stats.otherKinds], [1, 1, 1]);
  const r = rivers[0];
  assert.equal(r.flow, RIVER_KINDS.river.flow);
  assert.ok(r.nodes.length >= 20, `a node every ~20 m: ${r.nodes.length}`);
  assert.equal(r.nodes[0][3], RIVER_KINDS.river.width, 'no outline: width by kind');
  // the surface never rises downstream and sits a hand above the bed
  for (let i = 1; i < r.nodes.length; i++) assert.ok(r.nodes[i][2] <= r.nodes[i - 1][2] + 1e-9);
  assert.ok(Math.abs(r.nodes[0][2] - (sloped(r.nodes[0][0]) + 0.25)) < 0.1);
});

test('a riverbank outline gives the width and recentres the nodes', () => {
  const { rivers, stats } = planRivers({
    features: [
      line([[0, 10], [400, 10]], { waterway: 'river' }), // drawn 10 m off the middle of a 60 m wide bed
      ring(box(-10, -30, 410, 30), { natural: 'water', water: 'river' }),
    ],
    toWorld,
    heightAt: () => 0,
  });
  assert.equal(rivers.length, 1);
  assert.ok(stats.widthFromOutline > 0);
  const mid = rivers[0].nodes[Math.floor(rivers[0].nodes.length / 2)];
  assert.ok(mid[3] > 55 && mid[3] < 70, `about the bed's 60 m: ${mid[3]}`);
  assert.ok(Math.abs(mid[1]) < 2, `moved to the middle: y=${mid[1]}`);
});

test('a River keeps off a road beside it and is cut where a road crosses', () => {
  const { rivers, stats } = planRivers({
    features: [line([[0, 0], [400, 0]], { waterway: 'river' })],
    toWorld,
    heightAt: () => 0,
    roads: [
      { points: [[0, 8], [150, 8]], half: 3 }, // alongside: 5 m to its edge
      { points: [[250, -50], [250, 50]], half: 4 }, // across, at grade
    ],
  });
  assert.equal(rivers.length, 2, 'two pieces either side of the crossing');
  assert.equal(stats.cutAtRoads, 1);
  const beside = rivers[0].nodes.filter((n) => n[0] > 20 && n[0] < 130);
  assert.ok(beside.every((n) => n[3] / 2 <= 4 + 1e-6), 'half-width at most the 5 m to the road less 1 m');
  assert.ok(rivers.every((r) => r.nodes.every((n) => Math.abs(n[0] - 250) > 4)), 'no node on the crossing road');
});

test('lakes become a few rectangles inside the outline; riverbanks and dry lakes none', () => {
  // an L-shaped pond: a bounding box would cover the empty corner
  const L = [[0, 0], [200, 0], [200, 60], [60, 60], [60, 200], [0, 200]];
  const { tiles, stats } = planLakes({
    features: [
      ring(L, { natural: 'water', water: 'pond' }),
      ring(box(500, 0, 2500, 300), { natural: 'water', water: 'river', intermittent: 'yes' }),
      ring(box(0, 500, 100, 600), { natural: 'water', water: 'lake', intermittent: 'yes' }),
    ],
    toWorld,
    heightAt: (x, y) => (x > 60 && y > 60 ? 50 : 10), // the empty corner is high ground
  });
  assert.equal(stats.lakes, 1);
  assert.equal(stats.dry, 1);
  assert.ok(tiles.length >= 1);
  assert.ok(tiles.every((t) => t.z < 11), 'the level is the ground inside the lake');
  // the empty corner is high ground: the water may reach under it (hidden),
  // so the L is one or two blocks; every part of the pond is covered
  assert.ok(tiles.length <= 2, `an L under high ground is one or two blocks: ${tiles.length}`);
  const under = (x, y) => tiles.some((t) => Math.abs(x - t.cx) <= t.sx / 2 && Math.abs(y - t.cy) <= t.sy / 2);
  for (let x = 1; x < 200; x += 7) for (let y = 1; y < 200; y += 7) if (x <= 60 || y <= 60) assert.ok(under(x, y), `pond covered at ${x},${y}`);
  // and on low ground round it the water keeps to the outline
  const low = planLakes({ features: [ring(L, { natural: 'water', water: 'pond' })], toWorld, heightAt: (x, y) => (x > 60 && y > 60 ? 5 : 10) });
  for (const t of low.tiles) assert.ok(!(t.cx - t.sx / 2 > 62 && t.cy - t.sy / 2 > 62), `no water over the low corner: ${JSON.stringify(t)}`);
});

test('a steep stream drawn on a gully side slides onto the bed and never floats over its banks', () => {
  // V gully along y = 0 dropping 25 % downstream, with a 3 m deep dip in the
  // bed at x = 150; the stream is drawn 4 m up the side.
  const bed = (x) => 500 - x * 0.25 - (Math.abs(x - 150) < 6 ? 3 : 0);
  const heightAt = (x, y) => bed(x) + Math.abs(y) * 0.8;
  const { rivers } = planRivers({ features: [line([[0, 4], [300, 4]], { waterway: 'stream' })], toWorld, heightAt });
  assert.equal(rivers.length, 1);
  const { nodes } = rivers[0];
  const inner = nodes.slice(3, -3);
  assert.ok(inner.every(([, y]) => Math.abs(y) < 1.5), `snapped near the bed: ${inner.map(([, y]) => y.toFixed(1)).join(' ')}`);
  for (const [x, y, z, w] of nodes) {
    // never above the lowest ground across its width (plus the hand)
    let low = Infinity;
    for (let s = -1; s <= 1; s += 0.25) low = Math.min(low, heightAt(x, y + (s * w) / 2));
    assert.ok(z <= low + 0.25 + 1e-6, `node at x=${x.toFixed(0)} floats: ${z.toFixed(2)} over ${low.toFixed(2)}`);
    // and not sunk by the slope: within a metre of the bed it sits in
    assert.ok(z > bed(x) - 1 - 1e-6 || Math.abs(x - 150) < 30, `node at x=${x.toFixed(0)} buried: ${z.toFixed(2)} vs bed ${bed(x).toFixed(2)}`);
  }
});

test('lake beds: every lake recorded flat at its surface gets a bed, shore shallower, the ground around untouched', async () => {
  const { planLakes, carveLakeBeds } = await import('../services/beamngWater.js');
  // a 100 m grid at 1 m, ground at 5 m; a 40 m square pond whose ground the
  // data recorded at its surface (5 m), and a lower one at 1 m
  const N = 101; const SIZE = 100;
  const hm = new Float32Array(N * N).fill(5);
  const toPixel = (x, y) => [Math.round((x / SIZE + 0.5) * (N - 1)), Math.round((0.5 - y / SIZE) * (N - 1))];
  const at = (x, y) => { const [c, r] = toPixel(x, y); return hm[r * N + c]; };
  const sq = (x0, y0, s) => [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s], [x0, y0]];
  // (features in lat/lng = metres here, toWorld identity)
  const feat = (ring) => ({ type: 'water', tags: { natural: 'water' }, geometry: ring.map(([x, y]) => ({ lat: y, lng: x })) });
  for (let x = 20; x <= 40; x++) for (let y = -40; y <= -20; y++) { const [c, r] = toPixel(x, y); hm[r * N + c] = 1; }
  const plan = planLakes({ features: [feat(sq(-45, -20, 40)), feat(sq(20, -40, 20))], toWorld: (lat, lng) => [lng, lat], heightAt: at });
  assert.equal(plan.lakes.length, 2);
  const beds = carveLakeBeds(plan.lakes, { heightMap: hm, width: N, height: N, worldSize: SIZE, minHeight: 0 });
  beds.apply((idx, v) => { hm[idx] = v; });
  const level = plan.lakes[0].level;
  assert.ok(Math.abs(at(-25, 0) - (level - 1.5)) < 0.05, `middle ${at(-25, 0)} vs level ${level}`);
  assert.ok(at(-44.5, 0) > level - 0.6, 'shallow at the shore');
  assert.equal(at(-60, 0), 5, 'outside untouched');
  const level2 = plan.lakes[1].level;
  assert.ok(Math.abs(at(30, -30) - (level2 - 1.5)) < 0.05, 'the lower pond gets its own bed');
  assert.equal(at(10, -30), 5, 'between them untouched');
});

test('lake beds: no bed under ground a road keeps (its sidewalk, the quay)', async () => {
  const { planLakes, carveLakeBeds } = await import('../services/beamngWater.js');
  const N = 101; const SIZE = 100;
  const hm = new Float32Array(N * N).fill(5);
  const toPixel = (x, y) => [Math.round((x / SIZE + 0.5) * (N - 1)), Math.round((0.5 - y / SIZE) * (N - 1))];
  const at = (x, y) => { const [c, r] = toPixel(x, y); return hm[r * N + c]; };
  const ring = [[-40, -20], [0, -20], [0, 20], [-40, 20], [-40, -20]];
  const plan = planLakes({ features: [{ type: 'water', tags: { natural: 'water' }, geometry: ring.map(([x, y]) => ({ lat: y, lng: x })) }], toWorld: (lat, lng) => [lng, lat], heightAt: at });
  carveLakeBeds(plan.lakes, { heightMap: hm, width: N, height: N, worldSize: SIZE, minHeight: 0 }, { keep: (x) => x > -6 })
    .apply((idx, v) => { hm[idx] = v; });
  assert.equal(at(-3, 0), 5, 'kept beside the road');
  assert.ok(at(-20, 0) < 4, 'carved in the middle');
});

test('a wide or tidal flat river outline is area water with no ribbon; narrow or sloping ones stay Rivers', () => {
  // a 400 m wide river along y = 0..400, its ground flattened at 0.2 m, the banks at 3 m
  const wide = [
    ring(box(0, 0, 1000, 400), { natural: 'water', water: 'river' }),
    line([[0, 200], [1000, 200]], { waterway: 'river', name: 'Wide' }),
  ];
  const flat = (x, y) => (y >= 0 && y <= 400 ? 0.2 : 3);
  const lakes = planLakes({ features: wide, toWorld, heightAt: flat });
  assert.equal(lakes.stats.riverAreas, 1);
  assert.ok(lakes.tiles.length > 0 && lakes.tiles.every((t) => Math.abs(t.z - 0.25) < 0.01), 'tiles at the flattened level');
  const covered = lakes.tiles.reduce((a, t) => a + t.sx * t.sy, 0);
  assert.ok(covered > 1000 * 400 * 0.9, `tiles reach the banks: ${covered.toFixed(0)} m²`);
  const { rivers, stats } = planRivers({ features: wide, toWorld, heightAt: flat });
  assert.equal(rivers.length, 0, 'no ribbon inside area water');
  assert.ok(stats.nodesInAreaWater > 40);

  // narrow (60 m) and not tidal: a River as wide as its outline, no tiles
  const narrow = [
    ring(box(0, 0, 1000, 60), { natural: 'water', water: 'river' }),
    line([[0, 30], [1000, 30]], { waterway: 'river' }),
  ];
  const flatN = (x, y) => (y >= 0 && y <= 60 ? 0.2 : 3);
  assert.equal(planLakes({ features: narrow, toWorld, heightAt: flatN }).stats.riverAreas, 0);
  const rn = planRivers({ features: narrow, toWorld, heightAt: flatN }).rivers;
  assert.equal(rn.length, 1);
  assert.ok(rn[0].nodes[10][3] > 55, `width from the outline: ${rn[0].nodes[10][3]}`);
  // the same narrow one tagged tidal: area water
  narrow[0].tags.tidal = 'yes';
  assert.equal(planLakes({ features: narrow, toWorld, heightAt: flatN }).stats.riverAreas, 1);

  // wide but falling 10 m along its length: stays a ribbon (one flat level would flood or float)
  const sloped = (x, y) => (y >= 0 && y <= 400 ? 10 - x * 0.01 : 13 - x * 0.01);
  assert.equal(planLakes({ features: wide, toWorld, heightAt: sloped }).stats.riverAreas, 0);
  assert.equal(planRivers({ features: wide, toWorld, heightAt: sloped }).rivers.length, 1);
});

test('lake tiles reach a diagonal shore everywhere where the bank is higher; on flat ground they keep to the outline', () => {
  // a 600 m square turned 30 degrees: every shore diagonal to the grid
  const c = Math.cos(Math.PI / 6); const s = Math.sin(Math.PI / 6);
  const pts = box(-300, -300, 300, 300).map(([x, y]) => [x * c - y * s, x * s + y * c]);
  const feat = ring(pts, { natural: 'water', water: 'lake' });
  const inside = (x, y) => { const u = x * c + y * s; const v = -x * s + y * c; return Math.abs(u) <= 300 && Math.abs(v) <= 300; };
  const dist = (x, y) => Math.min(...pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length]; const vx = b[0] - a[0]; const vy = b[1] - a[1];
    const f = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / (vx * vx + vy * vy)));
    return Math.hypot(a[0] + vx * f - x, a[1] + vy * f - y);
  }));
  const measure = (heightAt) => {
    const { tiles } = planLakes({ features: [feat], toWorld, heightAt });
    const under = (x, y) => tiles.some((t) => Math.abs(x - t.cx) <= t.sx / 2 && Math.abs(y - t.cy) <= t.sy / 2);
    let missed = 0; let depthMissed = 0;
    for (let x = -420; x <= 420; x += 3) for (let y = -420; y <= 420; y += 3) {
      if (inside(x, y) && !under(x, y)) { missed++; depthMissed = Math.max(depthMissed, dist(x, y)); }
    }
    let past = 0;
    for (const t of tiles) for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = t.cx + (dx * t.sx) / 2; const y = t.cy + (dy * t.sy) / 2;
      if (!inside(x, y)) past = Math.max(past, dist(x, y));
    }
    return { tiles, missed, depthMissed, past };
  };
  // banks 2 m over the water: no gap at all, past the shore by one 4 m cell at most
  const banked = measure((x, y) => (inside(x, y) ? 1 : 3));
  assert.equal(banked.missed, 0, 'no gap between the water and the shore');
  // (under a bank that hides it the water may reach on: a few big blocks, not hundreds)
  assert.ok(banked.tiles.length <= 20, `a few blocks under hiding banks: ${banked.tiles.length}`);
  // flat ground: cells past the shore dropped, within half a cell either way
  const level = measure(() => 1);
  assert.ok(level.past <= 2 * Math.SQRT2 + 0.5, `half a cell past the shore at most: ${level.past.toFixed(1)} m`);
  assert.ok(level.depthMissed <= 2 * Math.SQRT2 + 0.5, `gaps only along the shore: ${level.depthMissed.toFixed(1)} m`);
});

test('lake beds: a bank inside the outline is left, no wall along the shore', async () => {
  const { planLakes, carveLakeBeds } = await import('../services/beamngWater.js');
  // a 100 m grid at 1 m: water recorded flat at 10 m for x < 0, a bank rising
  // 1 m per metre east of x = 0 to 40 m, and the lake outline reaching 30 m up it
  const N = 101; const SIZE = 100;
  const ground = (x) => (x < 0 ? 10 : 10 + x);
  const hm = new Float32Array(N * N);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) hm[r * N + c] = ground((c / (N - 1) - 0.5) * SIZE);
  const toPixel = (x, y) => [Math.round((x / SIZE + 0.5) * (N - 1)), Math.round((0.5 - y / SIZE) * (N - 1))];
  const at = (x, y) => { const [c, r] = toPixel(x, y); return hm[r * N + c]; };
  const ring = [[-45, -30], [30, -30], [30, 30], [-45, 30], [-45, -30]];
  const plan = planLakes({ features: [{ type: 'water', tags: { natural: 'water', water: 'reservoir' }, geometry: ring.map(([x, y]) => ({ lat: y, lng: x })) }], toWorld: (lat, lng) => [lng, lat], heightAt: at });
  const level = plan.lakes[0].level;
  carveLakeBeds(plan.lakes, { heightMap: hm, width: N, height: N, worldSize: SIZE, minHeight: 0 }).apply((idx, v) => { hm[idx] = v; });
  assert.ok(at(-20, 0) < level - 1, 'the bed under the water is cut');
  assert.equal(at(10, 0), 20, 'the bank 10 m over the water is left');
  assert.equal(at(25, 0), 35, 'and higher up too');
  // (above the water, where a wall would show: at most a short steepening at
  // the waterline, never the wall the old cut left)
  let worst = 0;
  for (let x = -44; x < 29; x++) if (Math.max(at(x, 0), at(x + 1, 0)) > level) worst = Math.max(worst, Math.abs(at(x + 1, 0) - at(x, 0)));
  assert.ok(worst <= 3, `no wall over the water: steepest step ${worst.toFixed(2)} m per metre`);
  // (the old cut took the whole 30 m of bank inside the outline down to the bed)
  assert.ok(at(29, 0) > 30, 'the top of the bank inside the outline stays');
});

test('the sea floor: where the land cover says water and the ground sits at the sea surface, it goes under the sea; land and high ground untouched', async () => {
  const { lowerSeabed } = await import('../services/beamngWater.js');
  // 100 x 100 heightmap; the east half is sea per the land cover, recorded at the
  // water surface (z 0.02 with sea 0); a sandbar at 3 m in it; the west half land at 0.1
  const W = 100; const hm = new Float32Array(W * W);
  for (let r = 0; r < W; r++) for (let c = 0; c < W; c++) hm[r * W + c] = c >= 50 ? (c >= 80 && c < 85 ? 3 : 0.02) : 0.1;
  const n = 20; const grid = new Uint8Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) grid[r * n + c] = c >= 10 ? 80 : 30;
  const res = lowerSeabed({ heightMap: hm, width: W, height: W, minHeight: 0 }, { grid, n }, 0);
  res.apply((i, v) => { hm[i] = v; });
  assert.ok(res.pixels > 0);
  assert.ok(hm[50 * W + 95] <= -1.9, `open sea under the water: ${hm[50 * W + 95]}`);
  assert.ok(hm[50 * W + 52] < 0 && hm[50 * W + 52] > -1.9, `the shore deepens gently: ${hm[50 * W + 52]}`);
  assert.equal(hm[50 * W + 82], 3, 'ground well over the sea is left');
  assert.ok(Math.abs(hm[50 * W + 20] - 0.1) < 1e-6, 'land is left');
  assert.equal(lowerSeabed({ heightMap: hm, width: W, height: W }, null, 0).pixels, 0, 'no land cover: nothing');
});

test('lake depth: from the shore slope in a valley, from an OSM depth tag, shallow for river areas, deepening off the map edge', async () => {
  const { planLakes, carveLakeBeds, tagDepthM } = await import('../services/beamngWater.js');
  assert.equal(tagDepthM({ depth: '12' }), 12);
  assert.equal(tagDepthM({ maxdepth: '40 ft' }), 12.192);
  assert.equal(tagDepthM({ 'depth:max': '7,5 m' }), 7.5);
  assert.equal(tagDepthM({ depth: 'deep' }), null);
  // a 400 m map at 2 m; a V valley along y, sides rising 0.4 m per m from x = 0;
  // the data records the water flat at 20 m where the valley floor is under it (|x| < 50)
  const N = 201; const SIZE = 400;
  const valley = (x) => Math.max(20, 20 + 0.4 * (Math.abs(x) - 50));
  const build = () => { const hm = new Float32Array(N * N); for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) hm[r * N + c] = valley((c / (N - 1) - 0.5) * SIZE); return hm; };
  const toPixel = (x, y) => [Math.round((x / SIZE + 0.5) * (N - 1)), Math.round((0.5 - y / SIZE) * (N - 1))];
  const lakeRing = [[-50, -150], [50, -150], [50, 150], [-50, 150], [-50, -150]];
  const run = (tags, ring = lakeRing) => {
    const hm = build();
    const at = (x, y) => { const [c, r] = toPixel(x, y); return hm[r * N + c]; };
    const plan = planLakes({ features: [{ type: 'water', tags, geometry: ring.map(([x, y]) => ({ lat: y, lng: x })) }], toWorld: (lat, lng) => [lng, lat], heightAt: at });
    const beds = carveLakeBeds(plan.lakes, { heightMap: hm, width: N, height: N, worldSize: SIZE, minHeight: 0 });
    beds.apply((idx, v) => { hm[idx] = v; });
    return { at, level: plan.lakes[0]?.level, beds };
  };
  // the slope (0.4) carried under the water: half of it times the 50 m to the shore = 10 m deep in the middle
  const v = run({ natural: 'water' });
  assert.equal(v.beds.lakes[0].source, 'slope');
  assert.ok(Math.abs(v.beds.lakes[0].slope - 0.4) < 0.05, `slope ${v.beds.lakes[0].slope}`);
  assert.ok(Math.abs(v.at(0, 0) - (v.level - v.beds.lakes[0].depth)) < 0.3, 'deepest in the middle');
  assert.ok(v.beds.lakes[0].depth > 8 && v.beds.lakes[0].depth < 12, `depth ${v.beds.lakes[0].depth}`);
  assert.ok(v.at(-40, 0) > v.at(-20, 0) && v.at(-20, 0) > v.at(0, 0) - 1e-6, 'deepening away from the shore');
  assert.ok(v.at(-48, 0) > v.level - 1.6, 'shallow at the shore');
  // tagged: its own depth
  const t = run({ natural: 'water', depth: '25' });
  assert.equal(t.beds.lakes[0].source, 'osm');
  assert.ok(Math.abs(t.at(0, 0) - (t.level - 25)) < 0.3);
  // a river drawn as area water: never deep
  const r = run({ natural: 'water', water: 'river' });
  if (r.beds.lakes.length) assert.ok(r.beds.lakes[0].depth <= 4 && r.at(0, 0) >= r.level - 4.01);
  // running off the map's north edge: no shore there, deeper towards it
  const off = run({ natural: 'water' }, [[-50, -150], [50, -150], [50, 260], [-50, 260], [-50, -150]]);
  assert.ok(off.at(0, 190) <= off.at(0, -100) + 1e-6, 'deeper towards the map edge than near the south shore');
});

test('a reservoir is deepest against its dam, its floor rising away from it; the dam is no shore', async () => {
  const { planLakes, carveLakeBeds } = await import('../services/beamngWater.js');
  // a 400 m map at 2 m: a valley along y (sides 0.4 per m), water flat at 20 m
  // for |x| < 50, a dam across it at y = -150 with the valley 60 m lower beyond
  const N = 201; const SIZE = 400;
  const g = (x, y) => (y < -155 ? -40 : 20) + Math.max(0, 0.4 * (Math.abs(x) - 50));
  const hm = new Float32Array(N * N);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) hm[r * N + c] = g((c / (N - 1) - 0.5) * SIZE, (0.5 - r / (N - 1)) * SIZE);
  const toPixel = (x, y) => [Math.round((x / SIZE + 0.5) * (N - 1)), Math.round((0.5 - y / SIZE) * (N - 1))];
  const at = (x, y) => { const [c, r] = toPixel(x, y); return hm[r * N + c]; };
  const ring = [[-50, -150], [50, -150], [50, 150], [-50, 150], [-50, -150]];
  const plan = planLakes({ features: [{ type: 'water', tags: { natural: 'water', water: 'reservoir' }, geometry: ring.map(([x, y]) => ({ lat: y, lng: x })) }], toWorld: (lat, lng) => [lng, lat], heightAt: at });
  const level = plan.lakes[0].level;
  const beds = carveLakeBeds(plan.lakes, { heightMap: hm, width: N, height: N, worldSize: SIZE, minHeight: 0 }, { dams: [{ line: [[-60, -152], [60, -152]], height: null }] });
  beds.apply((idx, v) => { hm[idx] = v; });
  assert.equal(beds.lakes[0].source, 'dam');
  assert.ok(beds.lakes[0].damDepth > 55 && beds.lakes[0].damDepth < 65, `depth at the dam from the valley below: ${beds.lakes[0].damDepth}`);
  // deep right against the dam (no shore there), shallower up the valley
  assert.ok(at(0, -140) < level - 30, `by the dam: ${at(0, -140)}`);
  assert.ok(at(0, 100) > at(0, -100), 'the floor rises away from the dam');
  // a height tag wins
  const hm2 = new Float32Array(N * N);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) hm2[r * N + c] = g((c / (N - 1) - 0.5) * SIZE, (0.5 - r / (N - 1)) * SIZE);
  const tagged = carveLakeBeds(plan.lakes, { heightMap: hm2, width: N, height: N, worldSize: SIZE, minHeight: 0 }, { dams: [{ line: [[-60, -152], [60, -152]], height: '100' }] });
  assert.equal(tagged.lakes[0].damDepth, 96);
});

test('lake banks: the ground over the water is left exactly as surveyed, a wall at the waterline included', async () => {
  const { planLakes, carveLakeBeds } = await import('../services/beamngWater.js');
  // a 200 m grid at 1 m: a lake recorded flat at 100 m west of x = 0; east of
  // it the hillside starts 10 m up (a reservoir surveyed at low water) and
  // climbs at 60 %; the outline reaches 20 m up the bank
  const N = 201; const SIZE = 200;
  const ground = (x) => (x <= 0 ? 100 : 110 + 0.6 * x);
  const hm = new Float32Array(N * N);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) hm[r * N + c] = ground((c / (N - 1) - 0.5) * SIZE);
  const toPixel = (x, y) => [Math.round((x / SIZE + 0.5) * (N - 1)), Math.round((0.5 - y / SIZE) * (N - 1))];
  const at = (x, y) => { const [c, r] = toPixel(x, y); return hm[r * N + c]; };
  const ring = [[-90, -80], [20, -80], [20, 80], [-90, 80], [-90, -80]];
  const plan = planLakes({ features: [{ type: 'water', tags: { natural: 'water', water: 'reservoir' }, geometry: ring.map(([x, y]) => ({ lat: y, lng: x })) }], toWorld: (lat, lng) => [lng, lat], heightAt: at });
  const beds = carveLakeBeds(plan.lakes, { heightMap: hm, width: N, height: N, worldSize: SIZE, minHeight: 0 });
  beds.apply((idx, v) => { hm[idx] = v; });
  // (cutting the bank back into a ramp lost the real shoreline: tester report, 0.2.16)
  for (let x = 1; x <= 60; x++) assert.ok(Math.abs(at(x, 0) - ground(x)) < 1e-3, `the bank at ${x} m is as surveyed`);
  assert.equal(beds.lakes[0].banksEased, undefined);
  assert.ok(at(-40, 0) < 99, 'the bed under the water is cut');
  // (and the bed starts shallow at the survey's waterline, not at the outline 20 m up the bank)
  assert.ok(at(-1, 0) > 100 - 2 && at(-1, 0) < 100, `shallow at the waterline: ${at(-1, 0).toFixed(2)}`);
});

test('lake beds: no creases down the middle of a bay; a thin low seam in the water is cut with it', async () => {
  const { planLakes, carveLakeBeds } = await import('../services/beamngWater.js');
  // a 300 m square lake recorded flat at 50 m in a 400 m grid at 1 m, banks
  // climbing at 50 % round it; a seam 2 m wide and 1 m high runs across it
  const N = 401; const SIZE = 400;
  const hm = new Float32Array(N * N);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const x = (c / (N - 1) - 0.5) * SIZE; const y = (0.5 - r / (N - 1)) * SIZE;
    const out = Math.max(Math.abs(x), Math.abs(y)) - 150;
    hm[r * N + c] = out > 0 ? 50 + 0.5 * out : (Math.abs(y - 40) <= 1 ? 51 : 50);
  }
  const toPixel = (x, y) => [Math.round((x / SIZE + 0.5) * (N - 1)), Math.round((0.5 - y / SIZE) * (N - 1))];
  const at = (x, y) => { const [c, r] = toPixel(x, y); return hm[r * N + c]; };
  const ring = [[-150, -150], [150, -150], [150, 150], [-150, 150], [-150, -150]];
  const plan = planLakes({ features: [{ type: 'water', tags: { natural: 'water', water: 'lake' }, geometry: ring.map(([x, y]) => ({ lat: y, lng: x })) }], toWorld: (lat, lng) => [lng, lat], heightAt: at });
  carveLakeBeds(plan.lakes, { heightMap: hm, width: N, height: N, worldSize: SIZE, minHeight: 0 }).apply((idx, v) => { hm[idx] = v; });
  // the seam is gone: the bed runs through it
  assert.ok(Math.abs(at(0, 40) - (at(0, 37) + at(0, 43)) / 2) < 0.2, `no ridge left at the seam: ${at(0, 40).toFixed(2)} between ${at(0, 37).toFixed(2)} and ${at(0, 43).toFixed(2)}`);
  // along the diagonal (equally far from two shores: the old bed's crease) the slope turns gently
  let worst = 0;
  for (let x = -100; x <= 100; x++) {
    // across the diagonal, at right angles to it
    const k = (d) => at(x + d, x - d);
    worst = Math.max(worst, Math.abs(k(2) - 2 * k(0) + k(-2)) / 4);
  }
  assert.ok(worst < 0.05, `the bed bends at most ${worst.toFixed(3)} m per m² across the diagonal`);
});

test('lake beds: a lake that arrives in pieces (cut along map tiles) is dug as one, no ridge along the seam', async () => {
  const { planLakes, carveLakeBeds } = await import('../services/beamngWater.js');
  // a 300 x 200 m lake recorded flat at 50 m in a 400 m grid at 1 m, banks
  // climbing at 50 % round it; mapped as two outlines meeting at x = 0
  const N = 401; const SIZE = 400;
  const hm = new Float32Array(N * N);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const x = (c / (N - 1) - 0.5) * SIZE; const y = (0.5 - r / (N - 1)) * SIZE;
    const out = Math.max(Math.abs(x) - 150, Math.abs(y) - 100);
    hm[r * N + c] = out > 0 ? 50 + 0.5 * out : 50;
  }
  const toPixel = (x, y) => [Math.round((x / SIZE + 0.5) * (N - 1)), Math.round((0.5 - y / SIZE) * (N - 1))];
  const at = (x, y) => { const [c, r] = toPixel(x, y); return hm[r * N + c]; };
  const piece = (xa, xb) => ({ type: 'water', tags: { natural: 'water', water: 'lake' }, geometry: [[xa, -100], [xb, -100], [xb, 100], [xa, 100], [xa, -100]].map(([x, y]) => ({ lat: y, lng: x })) });
  const plan = planLakes({ features: [piece(-150, 0), piece(0, 150)], toWorld: (lat, lng) => [lng, lat], heightAt: at });
  assert.equal(plan.lakes.length, 2);
  const beds = carveLakeBeds(plan.lakes, { heightMap: hm, width: N, height: N, worldSize: SIZE, minHeight: 0 });
  beds.apply((idx, v) => { hm[idx] = v; });
  assert.equal(beds.lakes.length, 1, 'one body of water in the report');
  // (dug apart, the bed stood 0.3 m under the water all along x = 0)
  assert.ok(at(0, 0) < at(-40, 0) + 0.5 && at(0, 0) < at(40, 0) + 0.5, `the seam is as deep as the bed beside it: ${at(0, 0).toFixed(2)} vs ${at(-40, 0).toFixed(2)} and ${at(40, 0).toFixed(2)}`);
  assert.ok(at(0, 0) < 50 - 5, `and deep: ${at(0, 0).toFixed(2)}`);
});

test('coarse elevation: the land\'s height carried out over the sea goes under it; a hill lake and the land do not', async () => {
  const { lowerSeabed } = await import('../services/beamngWater.js');
  // a 1 km square at 5 m a point (200 x 200), land cover at 10 m (100 x 100): land west of x = 400 m, the sea east
  // of it. As 30 m data has it: 3.3 m of "ground" at the shore falling to the sea's level 100 m out, level beyond.
  const W = 200; const n = 100; const grid = new Uint8Array(n * n);
  const hm = new Float32Array(W * W);
  const xOf = (c) => c * 5; const lake = (x, y) => Math.hypot(x - 150, y - 150) < 60;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { const x = c * 10 + 5; const y = r * 10 + 5; grid[r * n + c] = x > 400 || lake(x, y) ? 80 : 30; }
  for (let r = 0; r < W; r++) for (let c = 0; c < W; c++) {
    const x = xOf(c); const y = r * 5;
    hm[r * W + c] = x <= 400 ? 5 + (400 - x) * 0.05 : lake(x, y) ? 0 : Math.max(0, 3.3 * (1 - (x - 400) / 100));
    if (lake(x, y)) hm[r * W + c] = 40;   // a lake up on the land, its surface at 40 m
  }
  const before = hm.slice();
  // (a fine survey: only the water's own surface is lowered, the 3.3 m stays)
  { const fine = hm.slice(); lowerSeabed({ heightMap: fine, width: W, height: W, minHeight: 0 }, { grid, n }, 0).apply((idx, v) => { fine[idx] = v; }); assert.equal(fine[100 * W + 83], hm[100 * W + 83], 'fine survey: ground standing over the sea near the shore is left'); assert.ok(fine[100 * W + 160] <= -1.9, 'fine survey: the water\'s own surface far out still goes under'); }
  const res = lowerSeabed({ heightMap: hm, width: W, height: W, minHeight: 0 }, { grid, n }, 0, { coarse: true });
  res.apply((idx, v) => { hm[idx] = v; });
  const at = (x, y) => hm[Math.round(y / 5) * W + Math.round(x / 5)];
  assert.ok(at(415, 500) < -0.3, `15 m off the shore the floor is under the sea: ${at(415, 500).toFixed(2)} (was ${before[100 * W + 83].toFixed(2)})`);
  assert.ok(at(450, 500) <= -1.9, `50 m out: ${at(450, 500).toFixed(2)}`);
  assert.ok(at(800, 500) <= -1.9, `far out: ${at(800, 500).toFixed(2)}`);
  assert.equal(at(300, 500), before[100 * W + 60], 'the land is left alone');
  assert.equal(at(150, 150), 40, 'a lake up on the land is not the sea');
  // lowered only, and nothing without a sea at the sea's level to join
  for (let i = 0; i < hm.length; i++) assert.ok(hm[i] <= before[i] + 1e-6);
  const dry = new Float32Array(W * W).fill(3);   // "water" in the land cover, but all of it 3 m up: a reservoir, no sea
  assert.equal(lowerSeabed({ heightMap: dry, width: W, height: W, minHeight: 0 }, { grid, n }, 0, { coarse: true }).pixels, 0);
});
