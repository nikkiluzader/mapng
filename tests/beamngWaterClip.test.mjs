import test from 'node:test';
import assert from 'node:assert/strict';

import { solveTunnel } from '../services/beamngTunnels.js';
import { tunnelDryZones, tunnelsBelow, planSeaBlocks, clipRiverNodes, clipLakeTile, waterFloorIn } from '../services/beamngWaterClip.js';

// A cut-and-cover tunnel under a river at sea level: the ground at 2 m on
// the banks, the water surface (0 m) across |y| < 60.
const ground = (x, y) => (Math.abs(y) < 60 ? 0 : 2);
const tunnel = () => solveTunnel({ xy: [[0, -200], [0, 200]], half: 4 }, {
  groundAt: ground, approaches: [{ xy: [[0, -200], [0, -600]] }, { xy: [[0, 200], [0, 600]] }],
});

test('dry zones: water over the tube stops at its roof, none over its trenches', () => {
  const t = tunnel();
  assert.equal(t.ok, true, t.reason);
  const zones = tunnelDryZones([t]);
  const roof = waterFloorIn(zones, -1, -1, 1, 1);
  const mid = t.line[(t.iS + t.iN) >> 1];
  assert.ok(roof > mid.z + t.crown && roof < 0, `water may reach ${roof.toFixed(2)} (road ${mid.z.toFixed(2)})`);
  const trench = t.line[Math.max(0, t.iS - 10)];
  assert.equal(waterFloorIn(zones, trench.x - 1, trench.y - 1, trench.x + 1, trench.y + 1), Infinity, 'no water in a trench');
  assert.equal(waterFloorIn(zones, 300, 0, 302, 2), -Infinity, 'away from it: any depth');
  assert.equal(tunnelsBelow([t], 0), true);
});

test('the sea as blocks: over the river, none in the trench, shallow over the tube', () => {
  const t = tunnel();
  const zones = tunnelDryZones([t]);
  const blocks = planSeaBlocks({ size: 1024, seaZ: 0.5, heightAt: ground, zones, minZ: -20 });
  assert.ok(blocks.length > 0);
  const at = (x, y) => blocks.filter((b) => Math.abs(x - b.cx) <= b.sx / 2 && Math.abs(y - b.cy) <= b.sy / 2);
  // the river far from the tunnel: full depth
  assert.ok(at(300, 0).some((b) => b.depth > 10), 'deep sea away from the tunnel');
  // over the tube: no deeper than to its roof
  const over = at(0, 0);
  assert.ok(over.length > 0 && over.every((b) => 0.5 - b.depth >= waterFloorIn(zones, -1, -1, 1, 1) - 0.11), 'held over the roof');
  // the banks are dry ground (2 m > sea): no block, and none in the trench
  assert.equal(at(300, 150).length, 0);
  const trench = t.line[Math.max(0, t.iS - 10)];
  assert.equal(at(trench.x, trench.y).length, 0, 'the trench is dry');
});

test('rivers and lakes over a tunnel are held over its roof', () => {
  const t = tunnel();
  const zones = tunnelDryZones([t]);
  const { nodes, clipped } = clipRiverNodes([[-100, 0, 0, 20, 4], [0, 0, 0, 20, 4], [100, 0, 0, 20, 4]], zones);
  assert.equal(clipped, 1);
  assert.equal(nodes[0][4], 4);
  assert.ok(nodes[1][4] < 4 && 0 - nodes[1][4] >= waterFloorIn(zones, -10, -10, 10, 10) - 1e-6);
  assert.ok(clipLakeTile({ cx: 0, cy: 0, sx: 10, sy: 10, z: 0 }, 6, zones) < 6);
  assert.equal(clipLakeTile({ cx: 300, cy: 0, sx: 10, sy: 10, z: 0 }, 6, zones), 6);
});
