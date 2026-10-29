import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkJoints, checkGrades, checkCrossings, checkGroundGaps, checkThroughDecks, checkSpikes,
} from '../services/structures/metrics.js';

// a straight carriageway from (x0, y0) to (x1, y1), z from z0 to z1, nodes every 4 m
const road = (x0, y0, z0, x1, y1, z1, extra = {}) => {
  const L = Math.hypot(x1 - x0, y1 - y0); const n = Math.max(1, Math.round(L / 4));
  const nodes = [];
  for (let i = 0; i <= n; i++) nodes.push([x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, z0 + (z1 - z0) * i / n, 3.5]);
  return { nodes, highway: 'secondary', tags: {}, half: 3.5, ...extra };
};

test('joints: a level join passes, a step between a deck and its ramp is found', () => {
  const ok = checkJoints([road(0, 0, 10, 40, 0, 10), road(40, 0, 10, 80, 0, 10)]);
  assert.equal(ok.joints, 1);
  assert.equal(ok.steps, 0);
  const bad = checkJoints([road(0, 0, 10, 40, 0, 10, { bridge: true }), road(40, 0, 7.5, 80, 0, 7.5)]);
  assert.equal(bad.steps, 1);
  assert.equal(bad.worst.dz, 2.5);
  assert.deepEqual(bad.worst.at, [40, 0]);
});

test('grades: a motorway ramp too steep for its class is counted, a gentle one is not', () => {
  const g = checkGrades([
    road(0, 0, 0, 100, 0, 4, { highway: 'motorway', bridge: true }),     // 4 %
    road(0, 50, 0, 100, 50, 12, { highway: 'motorway', bridge: true }),  // 12 %
    road(0, 90, 0, 100, 90, 25),                                         // 25 % ground
  ]);
  assert.equal(g.structure.count > 0, true);
  assert.equal(g.structure.worst.grade, 0.12);
  assert.equal(g.ground.worst.grade, 0.25);
});

test('crossings: an overpass with room passes, one 3 m over the road under it is short', () => {
  const under = road(-50, 0, 0, 50, 0, 0);
  const high = road(0, -50, 7, 0, 50, 7, { bridge: true });
  const low = road(10, -50, 3, 10, 50, 3, { bridge: true });
  const c = checkCrossings([under, high, low]);
  assert.equal(c.crossings, 2);
  assert.equal(c.short, 1);
  assert.equal(c.worst.gap, 3);
  // two ground roads crossing level on one layer are an unjoined junction, not counted
  assert.equal(checkCrossings([road(-50, 0, 0, 50, 0, 0), road(0, -50, 0, 0, 50, 0)]).crossings, 0);
});

test('ground gaps: a road floating 2 m over flat ground is found; bridges are skipped', () => {
  const flat = () => 5;
  const r = checkGroundGaps([road(0, 0, 5, 40, 0, 5), road(0, 10, 7, 40, 10, 7), road(0, 20, 12, 40, 20, 12, { bridge: true })], flat);
  assert.equal(r.off, 11);
  assert.equal(r.worst.dz, 2);
});

test('through decks: a hill standing into a deck is found', () => {
  const deck = { parts: [{ xy: [[0, 0], [40, 0]], z: [10, 10], half: 4 }] };
  assert.equal(checkThroughDecks([deck], () => 0).through, 0);
  const hill = (x) => (x > 15 && x < 25 ? 9 : 0);
  const r = checkThroughDecks([deck], (x) => hill(x));
  assert.ok(r.through > 0);
  assert.equal(r.worst.deck, 'b001');
  assert.equal(r.worst.by, 1.2);
});

test('spikes: an isolated pillar beside a deck is found, a retaining-wall step is not', () => {
  const width = 101; const height = 101; const worldSize = 100;
  const hm = new Float32Array(width * height);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) hm[r * width + c] = c > 70 ? 6 : 0;  // a wall step
  const deck = { parts: [{ xy: [[-20, 0], [20, 0]], z: [10, 10], half: 4 }] };
  assert.equal(checkSpikes([deck], [], { heightMap: hm, width, height, worldSize }).spikes, 0);
  hm[50 * width + 55] = 9;   // a pillar of terrain
  const r = checkSpikes([deck], [], { heightMap: hm, width, height, worldSize });
  assert.equal(r.spikes, 1);
  assert.equal(r.worst.off, 9);
});
