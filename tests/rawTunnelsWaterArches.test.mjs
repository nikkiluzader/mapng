// Rules from the Pittsburgh review (2026-11-09), on synthetic scenes: tunnels opening onto bridges and
// tunnels kept with terrain shaping off, water bodies that meet, no river ribbon over a lake, a shallow
// bed under the survey's water surface, one arch over twin decks, buildings over tunnel portals.
import test from 'node:test';
import assert from 'node:assert/strict';

import { solveTunnel } from '../services/beamngTunnels.js';
import { tunnelGroundMisfit } from '../services/exportBeamNGLevel.js';
import { planLakes, planRivers, carveLakeBeds, SHALLOW_BED_M } from '../services/beamngWater.js';
import { styleDecks, linkArchCrossings, buildStyleGeometry } from '../services/bridgeStyles.js';
import { findPortalBuildings } from '../services/portalBuildings.js';

const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
// a 70 m ridge across y = 0, flanks from |y| 150 to 230, flat at 20 beyond
const ridge = (x, y) => 20 + 70 * smooth((230 - Math.abs(y)) / 80);

test('a tunnel opening onto a bridge: a bridge portal, no approach eased down to the ground under the deck', () => {
  // the south end opens over a valley (the ground falls to 0 past the ridge's foot), its road on a bridge
  const groundAt = (x, y) => (y < -235 ? 0 : ridge(x, y));
  const bridge = { xy: [[0, -200], [0, -260], [0, -420]], onBridge: true };
  const t = solveTunnel({ xy: [[0, -200], [0, 200]], half: 4 }, { groundAt, approaches: [bridge, null], raw: true });
  assert.ok(t.ok, t.reason);
  assert.equal(t.portalKind[0], 'bridge');
  // nothing laid out past the start (over the valley): the line starts at the tube
  assert.ok(t.line[0].s >= -1e-6, `first station at s ${t.line[0].s}`);
  assert.ok(t.line.slice(0, t.iS).every((p) => p.y > -236), 'no station out over the valley');
  // the portal at least under the hill by the cover at the tunnel's end, not down at the valley floor
  assert.ok(t.line[t.iS].z > 10, `portal road at ${t.line[t.iS].z}`);
});

// a solved-tunnel stand-in: stations every 2 m, tube between iS and iN
const stationsOf = (rows) => rows.map(([s, z, g, kind]) => ({ s, z, g, kind, x: s, y: 0 }));
test('shaping off: a short hump over an approach (a street crossing over it) is no misfit; a long deep bore tolerates a little', () => {
  const tube = []; for (let s = 0; s <= 800; s += 2) tube.push([s, 10, 10 + 100 * Math.sin((Math.PI * s) / 800) + 10, 'tube']);
  const approach = (f) => { const a = []; for (let s = 802; s <= 900; s += 2) a.push([s, 10, f(s), 'cut']); return a; };
  const hump = { line: stationsOf([...tube, ...approach((s) => (s > 840 && s < 852 ? 18 : 10.2))]), iS: 0, iN: tube.length - 1, kind: 'bored' };
  assert.equal(tunnelGroundMisfit(hump).ok, true, 'a 12 m hump over the road');
  const off = { line: stationsOf([...tube, ...approach(() => 12.5)]), iS: 0, iN: tube.length - 1, kind: 'bored' };
  assert.equal(tunnelGroundMisfit(off).ok, true, '2.5 m off its ground under a 100 m hill');
  const shallowTube = tube.map(([s, z]) => [s, z, z + 15, 'tube']);
  const offShallow = { line: stationsOf([...shallowTube, ...approach(() => 12.5)]), iS: 0, iN: shallowTube.length - 1, kind: 'bored' };
  assert.equal(tunnelGroundMisfit(offShallow).ok, false, 'the same under 15 m of cover: still left on the ground');
});

const toWorld = (lat, lng) => [lng, lat];
const wline = (pts, tags) => ({ type: 'water', tags, geometry: pts.map(([x, y]) => ({ lat: y, lng: x })) });
const wring = (pts, tags) => wline([...pts, pts[0]], tags);
const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

test('water bodies that meet stand at one level and are tiled as one; a step of a dam stays', () => {
  // two outlines sharing an edge at x = 300, the survey's surface 0.16 m apart (one pool)
  const groundAt = (x) => (x < 300 ? 0.05 : 0.21);
  const { lakes, tiles, stats } = planLakes({
    features: [wring(box(0, 0, 300, 200), { natural: 'water' }), wring(box(300, 0, 600, 200), { natural: 'water', water: 'lake' })],
    toWorld, heightAt: groundAt,
  });
  assert.equal(lakes.length, 2);
  assert.equal(lakes[0].level, lakes[1].level, 'one level');
  assert.equal(stats.joined, 2);
  assert.ok(tiles.every((t) => t.z === lakes[0].level));
  // no tile reaching across the shared edge from one side only is needed: some tile spans it
  assert.ok(tiles.some((t) => t.cx - t.sx / 2 < 299 && t.cx + t.sx / 2 > 301), 'tiled across the seam');
  // a reservoir 3 m over the river below its dam: two levels
  const dam = planLakes({
    features: [wring(box(0, 0, 300, 200), { natural: 'water' }), wring(box(300, 0, 600, 200), { natural: 'water' })],
    toWorld, heightAt: (x) => (x < 300 ? 0 : 3),
  });
  assert.notEqual(dam.lakes[0].level, dam.lakes[1].level);
});

test('no River ribbon over a lake outline: its centreline is covered by the lake\'s blocks', () => {
  const { rivers, stats } = planRivers({
    features: [
      wline([[-300, 100], [900, 100]], { waterway: 'river' }),
      wring(box(0, 0, 600, 200), { natural: 'water', name: 'a pool' }),
    ],
    toWorld, heightAt: () => 0,
  });
  for (const r of rivers) for (const n of r.nodes) assert.ok(n[0] <= 1 || n[0] >= 599, `ribbon node at x ${n[0]} inside the lake`);
  assert.ok(stats.nodesInAreaWater > 0);
});

test('shaping off: a shallow bed only under the survey\'s flat water surface, no bank cut', () => {
  const W = 201; const hm = new Float32Array(W * W);
  // a 100 m pond's surface at 10 (flat), a bank at 11 round it inside the outline's last metres
  for (let r = 0; r < W; r++) for (let c = 0; c < W; c++) { const x = c - 100; const y = 100 - r; hm[r * W + c] = Math.max(Math.abs(x), Math.abs(y)) > 45 ? 11 : 10; }
  const { lakes } = planLakes({ features: [wring(box(-50, -50, 50, 50), { natural: 'water' })], toWorld, heightAt: (x, y) => hm[(100 - Math.round(y)) * W + Math.round(x) + 100] });
  const beds = carveLakeBeds(lakes, { heightMap: hm, width: W, height: W, worldSize: W - 1 }, { shallow: true });
  const out = hm.slice(); beds.apply((i, v) => { out[i] = v; });
  const level = lakes[0].level;
  assert.ok(out[100 * W + 100] <= level - 1 && out[100 * W + 100] >= level - SHALLOW_BED_M - 1e-6, `middle at ${out[100 * W + 100]}`);
  assert.equal(out[(100 - 48) * W + 100], 11, 'the bank inside the outline left');
});

// a straight part along x at height z over flat ground at 0
const part = (x0, x1, y, z, extra = {}) => { const xy = []; for (let x = x0; x <= x1 + 1e-9; x += 2) xy.push([x, y]); return { xy, z: xy.map(() => z), half: 4, ...extra }; };
const builder = () => ({ pos: [], tri(a, b, c) { this.pos.push(...a, ...b, ...c); }, quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); } });
test('one steel arch over twin decks side by side, its ribs outside both; a lone deck keeps its own', () => {
  const up = { parts: [part(0, 300, 0, 14, { structure: 'arch' })] };
  const down = { parts: [part(0, 300, 14, 8, { structure: 'arch' })] };   // the lower deck, 14 m beside
  styleDecks([up, down], { groundAt: () => 0 });
  assert.equal(linkArchCrossings([up, down], { groundAt: () => 0 }), 1);
  const gu = buildStyleGeometry(up, { groundAt: () => 0, newBuilder: builder });
  const gd = buildStyleGeometry(down, { groundAt: () => 0, newBuilder: builder });
  assert.equal(gd.steel.pos.length, 0, 'the lower deck draws no arch of its own');
  const ys = []; for (let i = 1; i < gu.steel.pos.length; i += 3) ys.push(gu.steel.pos[i]);
  assert.ok(Math.max(...ys) > 14 + 4 && Math.min(...ys) < -4, `ribs from y ${Math.min(...ys).toFixed(1)} to ${Math.max(...ys).toFixed(1)}`);
});

test('a steel arch never follows a ramp curving off its span', () => {
  // the span joined end to end with a quarter circle (a ramp leaving its end)
  const main = part(0, 200, 0, 12, { structure: 'arch' });
  const curve = { xy: [], half: 4, structure: 'arch' };
  for (let a = 0; a <= 90; a += 3) curve.xy.push([200 + 120 * Math.sin((a * Math.PI) / 180), 120 - 120 * Math.cos((a * Math.PI) / 180)]);
  curve.z = curve.xy.map(() => 12);
  const deck = { parts: [main, curve] };
  styleDecks([deck], { groundAt: () => 0 });
  linkArchCrossings([deck], { groundAt: () => 0 });
  const g = buildStyleGeometry(deck, { groundAt: () => 0, newBuilder: builder });
  let zmax = 0; for (let i = 2; i < g.steel.pos.length; i += 3) zmax = Math.max(zmax, g.steel.pos[i]);
  assert.ok(zmax < 12 + 8, `no steel rib high over the curve (top ${zmax.toFixed(1)})`);
});

test('a building across a tunnel\'s mouth stands on the portal; one on the hill above is left', () => {
  const line = []; for (let s = -20; s <= 200; s += 2) line.push({ s, x: 0, y: s, z: 10, tx: 0, ty: 1 });
  const t = { line, iS: line.findIndex((p) => p.s === 0), iN: line.length - 1, portals: [true, false], kind: 'bored', W: 6, headTop: 9 };
  const groundAt = (x, y) => (y < 0 ? 10 : 10 + y);   // the hill rises from the portal
  const sq = (cx, cy, h) => [[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h]];
  const vent = { f: { id: 'vent', tags: { building: 'yes' } }, ring: sq(0, 2, 8) };
  const hilltop = { f: { id: 'house', tags: { building: 'house' } }, ring: sq(0, 60, 5) };
  const got = findPortalBuildings({ buildings: [vent, hilltop], tunnels: [t], groundAt });
  assert.deepEqual(got.map((g) => g.f.id), ['vent']);
  assert.equal(got[0].baseZ, 19);
});

test('a bridge the survey saw along part of it: its runs clear of the ground pinned, not a stray reading', async () => {
  const { clearRuns } = await import('../services/lidarDecks.js');
  const N = NaN;
  // ground at 0: a 6-station run 8 m up, a 3-station run (too short), a run at 1 m (the ground or a road under it)
  const z = [N, 8, 8, 8.1, 8.2, 8.2, 8.3, N, 9, 9, 9, N, 1, 1, 1, 1, 1, 1, N];
  assert.deepEqual(clearRuns(z, () => 0), [[1, 10]], 'the run and the short one 1 gap after it joined');
  // every other station read (a lower deck between the beams of the deck over it): one run
  assert.deepEqual(clearRuns([5, N, 5, N, 5, N, 5, N, 5], () => 0), [[0, 8]]);
  // a stray station: no run
  assert.deepEqual(clearRuns([N, N, 9, N, N, N, 9, N], () => 0), []);
});
