import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStructureGraph, structureOf, STATION_M } from '../services/structures/graph.js';
import { STRUCTURE_SCENES, runStructureScene } from './helpers/structureScenes.mjs';

// segments straight from local metres (lat = y, lng = x, 1 deg = 1 m here)
const seg = (pts, tags = {}, layer) => ({
  geometry: pts.map(([x, y]) => ({ lat: y, lng: x })), tags, highway: tags.highway || 'secondary',
  layer: layer ?? (Number.parseInt(tags.layer, 10) || (structureOf(tags).bridge ? 1 : structureOf(tags).tunnel ? -1 : 0)),
  sourceFeature: { id: 'w', tags },
});
const project = (lat, lng) => [lng, lat, 10];

test('structureOf reads bridge, tunnel and earthwork tags', () => {
  assert.equal(structureOf({ bridge: 'viaduct' }).bridge, true);
  assert.equal(structureOf({ bridge: 'no' }).bridge, false);
  assert.equal(structureOf({ location: 'underground' }).tunnel, true);
  assert.equal(structureOf({ cutting: 'yes' }).cutting, true);
});

test('a bridge and its approaches meet at joints even on different layers', () => {
  const g = buildStructureGraph([
    seg([[0, 0], [100, 0]]),
    seg([[100, 0], [160, 0]], { bridge: 'yes' }),
    seg([[160, 0], [260, 0]]),
  ], { project });
  assert.equal(g.stats.edges, 3);
  assert.equal(g.stats.joints, 2, 'both deck ends are joints');
  assert.equal(g.stats.ends, 2);
  const joint = [...g.nodes.values()].find((n) => n.kind === 'joint');
  assert.deepEqual(joint.layers, [0, 1]);
});

test('a plain continuation is a through node, a three-way meeting a junction', () => {
  const g = buildStructureGraph([
    seg([[0, 0], [50, 0]]), seg([[50, 0], [100, 0]]), seg([[50, 0], [50, 60]]),
  ], { project });
  assert.equal(g.stats.junctions, 1);
  assert.equal(g.stats.multiLevelJunctions, 0);
  const g2 = buildStructureGraph([seg([[0, 0], [50, 0]]), seg([[50, 0], [100, 0]])], { project });
  assert.equal(g2.stats.through, 1);
  assert.equal(g2.stats.joints, 0);
});

test('roads leaving the map end at edgeOfMap nodes', () => {
  const g = buildStructureGraph([seg([[0, 0], [500, 0]])], { project, isFreeEnd: (x) => Math.abs(x) >= 490 });
  assert.equal(g.stats.edgeOfMap, 1);
  assert.equal(g.stats.ends, 1);
});

test('stations every STATION_M and at every vertex, with ground', () => {
  const g = buildStructureGraph([seg([[0, 0], [10, 0], [10, 7]])], { project, groundAt: (x, y) => x + y });
  const e = g.edges[0];
  assert.equal(e.length, 17);
  assert.equal(e.vertex.reduce((n, v) => n + v, 0), 3, 'three vertices kept');
  for (let i = 1; i < e.s.length; i++) assert.ok(e.s[i] - e.s[i - 1] <= STATION_M + 1e-9);
  assert.equal(e.g[e.g.length - 1], 17);
  // without groundAt: the projected vertices' ground
  const g2 = buildStructureGraph([seg([[0, 0], [10, 0]])], { project: (lat, lng) => [lng, lat, lng] });
  assert.equal(g2.edges[0].g[0], 0);
  assert.equal(g2.edges[0].g[g2.edges[0].g.length - 1], 10);
});

test('scenes: the overpass has two joints and no node where the motorway passes under', async () => {
  const log = console.log; console.log = () => {};
  try {
    const { groups } = await runStructureScene(STRUCTURE_SCENES.find((s) => s.name === 'overpass on flat ground'));
    const st = groups.structureGraph.stats;
    assert.equal(st.joints, 2);
    assert.equal(st.junctions, 0, 'the motorway crosses under, not through a node');
    assert.equal(st.bridgeEdges, 1);
    const ramp = await runStructureScene(STRUCTURE_SCENES.find((s) => s.name === 'ramp joint between decks of different layers'));
    assert.ok(ramp.groups.structureGraph.stats.multiLevelJunctions >= 1, 'the layer-2 ramp meets the layer-1 deck at a mixed-layer junction');
  } finally { console.log = log; }
});

test('a road joining another mid-way splits it there, across layers', () => {
  const g = buildStructureGraph([
    seg([[0, 0], [50, 0], [100, 0]], { bridge: 'yes', layer: '1' }),
    seg([[50, 80], [50, 0]], { bridge: 'yes', layer: '2' }),
  ], { project });
  assert.equal(g.stats.edges, 3, 'the deck split at the shared vertex');
  assert.equal(g.stats.multiLevelJunctions, 1);
});
