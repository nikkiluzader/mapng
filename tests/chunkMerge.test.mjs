// chunkMerge.js and chunkedExport.js seamBlendFor: outputs moved into the level's frame, seams taken from neighbours.
import test from 'node:test';
import assert from 'node:assert/strict';
import { moveObject, rewritePaths } from '../services/chunkMerge.js';
import { seamBlendFor } from '../services/chunkedExport.js';

test('an object and a road move by the chunk offset and get the chunk in their name', () => {
  const o = moveObject({ class: 'TSStatic', name: 'b1', position: [1, 2, 3] }, 10, 20, 5, '1_0');
  assert.deepEqual(o.position, [11, 22, 8]); assert.equal(o.name, 'b1_c1_0');
  const r = moveObject({ class: 'DecalRoad', name: 'r', nodes: [[0, 0, 1, 6]] }, 1, 1, 1, 'k');
  assert.deepEqual(r.nodes[0], [1, 1, 2, 6]);
});
test('paths: own assets under chunks/<key>, the game models at the root, ground materials per chunk', () => {
  const t = rewritePaths('levels/a_c0/ground/x.dae levels/a_c0/map_assets/official_assets/m.dae mapng_ground_grass', 'a_c0', 'a', '0_0');
  assert.equal(t, 'levels/a/chunks/0_0/ground/x.dae levels/a/map_assets/official_assets/m.dae mapng_ground_c0_0_grass');
});
test('seam blend: weight 1 on the neighbour core edge, easing to 0', () => {
  const size = 16; const f = { x0: 0, y0: 0, size, core: [0, 0, 12, 16], heights: new Float32Array(size * size).fill(5) };
  const c = { x0: 8, y0: 0, size };
  const b = seamBlendFor(c, [f], 4);
  // chunk px 3 = global 11 (inside f's core): weight 1, target 5; global 12 (edge, d=1): 1; global 15 (d=4): 0.25
  assert.equal(b.weight[3], 1); assert.equal(b.target[3], 5); assert.equal(b.weight[4], 1); assert.equal(b.weight[7], 0.25);
  assert.equal(seamBlendFor({ x0: 100, y0: 100, size }, [f]), null);
});
test('level-wide objects keep their names (the spawn point, the forest)', () => {
  assert.equal(moveObject({ class: 'SpawnSphere', name: 'spawn_default', position: [0, 0, 0] }, 1, 1, 1, 'k').name, 'spawn_default');
  assert.equal(moveObject({ class: 'Forest', name: 'theForest' }, 1, 1, 1, 'k').name, 'theForest');
});
test('the anchor terrain files stay at the root', () => {
  assert.equal(rewritePaths('levels/a_c0/art/terrains/terrain.ter levels/a_c0/art/terrains/terrain_b.color.png', 'a_c0', 'a', '0_0'), 'levels/a/art/terrains/terrain.ter levels/a/chunks/0_0/art/terrains/terrain_b.color.png');
});
import { mergeLevelData } from '../services/chunkMerge.js';
test('level data joined: signal ids per chunk, positions moved, zones from both', () => {
  const sig = { instances: [{ id: 3, name: 'stop 3', controllerId: 1, sequenceId: 0, pos: [0, 0, 0] }], controllers: [{ id: 1 }], sequences: [] };
  let d = mergeLevelData(null, { signals: sig }, 10, 0, 0, 'a', 0);
  d = mergeLevelData(d, { signals: sig }, 20, 0, 0, 'b', 1);
  const ids = d.signals.instances.map((i) => i.id); assert.equal(new Set(ids).size, 2);
  assert.equal(d.signals.instances[1].controllerId, d.signals.controllers[1].id); assert.equal(d.signals.instances[1].sequenceId, 0);
  assert.deepEqual(d.signals.instances[1].pos, [20, 0, 0]);
  d = mergeLevelData(d, { sites: { zones: [{ name: 'A', vertices: [[0, 0, 0]] }], parkingSpots: [] } }, 5, 5, 1, 'a', 0);
  assert.deepEqual(d.sites.zones[0].vertices[0], [5, 5, 1]);
});
import { joinSeamRoads } from '../services/chunkMerge.js';
test('a road cut at a seam is joined back into one; a one-way road is not reversed', () => {
  const a = { o: { class: 'DecalRoad', material: 'm', nodes: [[0, 0, 0, 6], [10, 0, 0, 6]] }, chunk: 'a' };
  const b = { o: { class: 'DecalRoad', material: 'm', nodes: [[20, 0, 0, 6], [10, 0, 0, 6]] }, chunk: 'b' };
  const { removed, joins } = joinSeamRoads([a, b]);
  assert.equal(joins, 1); assert.ok(removed.has(b.o)); assert.deepEqual(a.o.nodes.map((n) => n[0]), [0, 10, 20]);
  const c = { o: { class: 'DecalRoad', material: 'm', oneWay: true, nodes: [[0, 0, 0, 6], [10, 0, 0, 6]] }, chunk: 'a' };
  const d = { o: { class: 'DecalRoad', material: 'm', oneWay: true, nodes: [[20, 0, 0, 6], [10, 0, 0, 6]] }, chunk: 'b' };
  assert.equal(joinSeamRoads([c, d]).joins, 0);
});
test('a road and its centre line meeting at the same seam point are each joined', () => {
  const r = (m, x0, x1, ch) => ({ o: { class: 'DecalRoad', material: m, nodes: [[x0, 0, 0, 6], [x1, 0, 0, 6]] }, chunk: ch });
  assert.equal(joinSeamRoads([r('asphalt', 0, 10, 'a'), r('line', 0, 10, 'a'), r('asphalt', 10, 20, 'b'), r('line', 10, 20, 'b')]).joins, 2);
});
test('road ends a few cm apart at a seam are joined at their midpoint', () => {
  const a = { o: { class: 'DecalRoad', material: 'm', nodes: [[0, 0, 0, 6], [10, 0, 0, 6]] }, chunk: 'a' };
  const b = { o: { class: 'DecalRoad', material: 'm', nodes: [[10, 0.16, 0, 6], [20, 0, 0, 6]] }, chunk: 'b' };
  assert.equal(joinSeamRoads([a, b]).joins, 1); assert.deepEqual(a.o.nodes[1].slice(0, 2), [10, 0.08]); assert.equal(a.o.nodes.length, 3);
});
