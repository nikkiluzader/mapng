// A roof the survey shows as ground at a tunnel's end, and thin ground over a bore: the road stays where it is.
// (Fizz_Mechanic's D 902 along Lac du Chevril, 0.3.0: avalanche galleries' roofs are the "ground" in lidar. The
// road was ramped up onto a roof before each tunnel and sagged 3.5 m inside one for cover. Synthetic scenes.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { fitApproachHeight, solveTunnel } from '../services/beamngTunnels.js';
import { smoothRoadsInHeightmap } from '../services/roadSmoother.js';

// ── the approach's height at a tunnel end ──
const approach = [[0, 0], [0, -120]];                       // from the tunnel's end outwards
const roadZ = (d) => 100 - 0.01 * d;                         // the road: falling 1 % away from the tunnel

test('a roof blended into the last 22 m before the tunnel does not lift the end', () => {
  const ground = (x, y) => { const d = -y; return roadZ(d) + (d < 22 ? (22 - d) * 0.25 : 0); };   // +5.5 m at the end
  const z = fitApproachHeight(approach, ground);
  assert.ok(Math.abs(z - 100) < 0.4, `end at ${z.toFixed(2)}, the road is at 100`);
});

test('a plain approach is fitted as before', () => {
  assert.ok(Math.abs(fitApproachHeight(approach, (x, y) => roadZ(-y)) - 100) < 0.05);
});

test('a road that really climbs 10 % to its portal keeps its height', () => {
  const z = fitApproachHeight(approach, (x, y) => 100 - 0.10 * -y);
  assert.ok(Math.abs(z - 100) < 0.2, `end at ${z.toFixed(2)}`);
});

test('a hump only at the portal (a headwall over the mouth) is ignored, a dip there too', () => {
  const hood = fitApproachHeight(approach, (x, y) => roadZ(-y) + (-y < 8 ? 6 : 0));
  assert.ok(Math.abs(hood - 100) < 0.4, `under a hood: ${hood.toFixed(2)}`);
  const dip = fitApproachHeight(approach, (x, y) => roadZ(-y) - (-y < 30 ? 2 : 0));
  assert.ok(dip < 99, `a road really lower near the tunnel is not raised to the far line: ${dip.toFixed(2)}`);
});

// ── the road smoothing at Generate ──
const N = 513; const SIZE = 512; const DEG = SIZE / 111320;
const bounds = { south: -DEG / 2, north: DEG / 2, west: -DEG / 2, east: DEG / 2 };
const ll = (x, y) => ({ lat: (y / SIZE) * DEG, lng: (x / SIZE) * DEG });
const grid = (h) => { const hm = new Float32Array(N * N); for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) hm[r * N + c] = h((c / (N - 1) - 0.5) * SIZE, (0.5 - r / (N - 1)) * SIZE); return hm; };
const at = (hm, x, y) => hm[Math.round((0.5 - y / SIZE) * (N - 1)) * N + Math.round((x / SIZE + 0.5) * (N - 1))];
const way = (id, xs, tags) => ({ id, type: 'road', tags, geometry: xs.map((x) => ll(x, 0)) });

test('a road running into a tunnel is not ramped up onto the roof over its mouth', () => {
  const roof = (x) => (x < -12 ? 10 : 16.5);                 // the gallery's roof starts 12 m before the tagged tunnel
  const roads = (tunnelTag) => [way('open', [-220, -150, -80, 0], { highway: 'primary' }), way('tube', [0, 100, 200], { highway: 'primary', ...tunnelTag })];
  const hm = grid(roof);
  smoothRoadsInHeightmap(hm, N, N, bounds, roads({ tunnel: 'yes' }), 1, { fine: true });
  for (const x of [-60, -40, -25]) assert.ok(at(hm, x, 0) < 10.6, `the open road at x = ${x} stays on its ground: ${at(hm, x, 0).toFixed(2)}`);
  assert.ok(at(hm, -6, 0) < 11.5, `the last metres under the roof follow the road's grade: ${at(hm, -6, 0).toFixed(2)}`);
  // the same step with no tunnel behind it is still lifted on a fill (a structure bare earth took out)
  const plain = grid(roof);
  smoothRoadsInHeightmap(plain, N, N, bounds, [way('open', [-220, -150, -80, 0, 100, 200], { highway: 'primary' })], 1, { fine: true });
  assert.ok(at(plain, -30, 0) > 12, `no tunnel: lifted as before (${at(plain, -30, 0).toFixed(2)})`);
});

// ── thin ground over a bore ──
test('a bore under ground a little too thin keeps its grade: the cover is made up, the road does not sag', () => {
  const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
  // a ridge 60 m over the road, with a 160 m shelf in the middle only 7 m over it (a gallery's roof)
  const ground = (x, y) => (Math.abs(y) < 80 ? 27 : 20 + 60 * smooth((300 - Math.abs(y)) / 60));
  const t = solveTunnel({ xy: [[0, -300], [0, 300]], half: 4 }, { groundAt: ground, approaches: [{ xy: [[0, -300], [0, -500]] }, { xy: [[0, 300], [0, 500]] }] });
  assert.ok(t.ok, t.reason);
  const zs = t.line.filter((p) => p.kind === 'tube').map((p) => p.z);
  assert.ok(Math.min(...zs) > 20 - 0.6, `the road sags to ${Math.min(...zs).toFixed(2)} under a 20 m grade`);
});
