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
  assert.ok(tiles.length > 1);
  assert.ok(tiles.every((t) => t.z < 11), 'the level is the ground inside the lake');
  for (const t of tiles) {
    assert.ok(!(t.cx - t.sx / 2 > 62 && t.cy - t.sy / 2 > 62), `no tile in the empty corner: ${JSON.stringify(t)}`);
  }
  const area = tiles.reduce((a, t) => a + t.sx * t.sy, 0);
  assert.ok(tiles.length <= 4, `an L is two or three rectangles: ${tiles.length}`);
  const lArea = 200 * 60 + 60 * 140;
  assert.ok(area > lArea * 0.8 && area < lArea * 1.3, `tiles cover the pond: ${area.toFixed(0)} vs ${lArea}`);
});
