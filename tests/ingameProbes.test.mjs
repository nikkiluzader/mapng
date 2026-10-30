import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIngameProbes, judgeProbes } from '../services/ingameProbes.js';

const line = (z, extra = {}) => ({ nodes: [[-200, 0, z], [200, 0, z]], highway: 'primary', ...extra });

test('probes: roads, decks, sidewalks, tunnels and the spawn, none under a structure', () => {
  const { probes } = buildIngameProbes({
    carriageways: [line(10), line(20, { carried: true }), line(-5, { tunnel: true })],
    sidewalkRuns: [{ points: [[-100, 4, 10], [100, 4, 10]], side: 1, width: 2, highway: 'primary' }],
    underStructure: (x) => x > 150,
    spawn: [0, 0, 10.5],
  });
  const kinds = new Set(probes.map((p) => p.k));
  for (const k of ['road', 'deck', 'sidewalk', 'tunnel', 'spawn']) assert.ok(kinds.has(k), k);
  assert.ok(probes.filter((p) => p.k === 'road').every((p) => p.x <= 150), 'none under a structure');
  assert.ok(probes.filter((p) => p.k === 'sidewalk').every((p) => p.z === 10.15 && p.y > 4), 'on the slab');
});

test('judge: tree crowns over a road pass; a building over it, a gap under a sidewalk, a missing deck fail', () => {
  const probes = [
    { k: 'road', x: 0, y: 0, z: 10 }, { k: 'road', x: 1, y: 0, z: 10 }, { k: 'road', x: 2, y: 0, z: 10 },
    { k: 'sidewalk', x: 0, y: 5, z: 10.15 }, { k: 'deck', x: 0, y: 9, z: 20 }, { k: 'deck', x: 0, y: 9, z: 20 },
    { k: 'tunnel', x: 0, y: 0, z: -5 },
  ];
  const hits = [
    { z: 25, obj: 'theForest', cls: 'Forest', lz: 10.02, lobj: 'theTerrain', lcls: 'TerrainBlock' },
    { z: 30, obj: 'osm_objects_b', cls: 'TSStatic', lz: 10, lobj: 'theTerrain', lcls: 'TerrainBlock' },
    { z: 10, obj: 'theTerrain', cls: 'TerrainBlock', lz: 11.2, lobj: 'lamp_3', lcls: 'TSStatic' },
    { z: 10.16, obj: 'sidewalks', lz: 10.16, lobj: 'sidewalks', below: 2.4 },
    { z: 20.01, obj: 'bridge_b001_deck', lz: 20.01, lobj: 'bridge_b001_deck' },
    { z: 12, obj: 'theTerrain', cls: 'TerrainBlock', lz: 12, lobj: 'theTerrain', lcls: 'TerrainBlock' },
    { z: -5.02, obj: 'tunnel_t001_tube1', roof: 6.1 },
  ];
  const { byKind, failures } = judgeProbes(probes, hits);
  assert.deepEqual(byKind.road, { n: 3, fail: 2 });
  assert.match(failures.find((f) => f.x === 1).why, /building over the road/);
  assert.match(failures.find((f) => f.x === 2).why, /object standing on the road/);
  assert.match(failures.find((f) => f.k === 'sidewalk').why, /floating/);
  assert.deepEqual(byKind.deck, { n: 2, fail: 1 });
  assert.match(failures.find((f) => f.k === 'deck').why, /no deck under the road/);
  assert.deepEqual(byKind.tunnel, { n: 1, fail: 0 });
});

test('probes: road lines, and roads under a deck probed for clearance', () => {
  const { probes, lines, version } = buildIngameProbes({
    carriageways: [line(10, { half: 4, tags: { junction: 'roundabout' } }), line(20, { carried: true })],
    sidewalkRuns: [{ points: [[-100, 4, 10], [100, 4, 10]], side: 1, width: 2, highway: 'primary' }],
    underStructure: (x) => x > 150,
    inTunnel: () => false,
  });
  assert.equal(version, 3);
  assert.deepEqual(lines.map((l) => l.k), ['road', 'deck', 'sidewalk']);
  assert.equal(lines[0].rb, 1);
  assert.equal(lines[0].hw, 4);
  assert.ok(lines[0].p.length >= 2 && lines[0].p.every((q) => q.length === 3));
  const under = probes.filter((p) => p.k === 'under');
  assert.ok(under.length >= 3 && under.every((p) => p.x > 150), 'roads under the deck');
});

test('judge: a road under a deck with too little headroom fails', () => {
  const probes = [{ k: 'under', x: 0, y: 0, z: 10 }, { k: 'under', x: 5, y: 0, z: 10 }];
  const hits = [
    { z: 10.02, lz: 10.02, lobj: 'theTerrain', lcls: 'TerrainBlock', roof: 5.4, roofObj: 'bridge_b001' },
    { z: 10.02, lz: 10.02, lobj: 'theTerrain', lcls: 'TerrainBlock', roof: 3.1, roofObj: 'bridge_b001' },
  ];
  const { byKind, failures } = judgeProbes(probes, hits);
  assert.deepEqual(byKind.under, { n: 2, fail: 1 });
  assert.match(failures[0].why, /low clearance/);
});
