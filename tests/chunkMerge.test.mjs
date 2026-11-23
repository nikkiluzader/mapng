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
test('a road over two seams, its pieces a few cm apart, becomes one road whatever order they come in', () => {
  const piece = (x0, x1, y, ch) => ({ o: { class: 'DecalRoad', material: 'm', nodes: [[x0, y, 0, 6], [(x0 + x1) / 2, y, 0, 6], [x1, y, 0, 6]] }, chunk: ch });
  for (const order of [[0, 1, 2], [1, 0, 2], [2, 1, 0], [1, 2, 0]]) {
    const pieces = [piece(0, 10, 0, 'a'), piece(10.1, 20, 0.05, 'b'), piece(20.1, 30, 0, 'c')];
    const list = order.map((i) => pieces[i]);
    const { joins, removed } = joinSeamRoads(list);
    assert.equal(joins, 2, `order ${order}`); assert.equal(removed.size, 2);
    const kept = list.find((r) => !removed.has(r.o));
    const xs = kept.o.nodes.map((n) => n[0]); const sorted = xs[0] < xs[xs.length - 1] ? xs : [...xs].reverse();
    assert.equal(xs.length, 7); assert.ok(sorted[0] === 0 && sorted[6] === 30, `order ${order}: ${xs}`);
    for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i] > sorted[i - 1]);
  }
  // five pieces in a row
  const five = Array.from({ length: 5 }, (_, i) => piece(i * 10, i * 10 + 9.95, 0, `c${i}`));
  assert.equal(joinSeamRoads(five).joins, 4);
});
test('a street and the viaduct over it, cut at the same seam point, are each joined to their own other half', () => {
  const at = (x0, x1, z, ch) => ({ o: { class: 'DecalRoad', material: 'm', nodes: [[x0, 0, z, 6], [x1, 0, z, 6]] }, chunk: ch });
  const streetA = at(0, 10, 0, 'a'); const streetB = at(10, 20, 0, 'b'); const deckA = at(0, 10, 8, 'a'); const deckB = at(10, 20, 8, 'b');
  const { joins } = joinSeamRoads([streetA, deckB, deckA, streetB]);
  assert.equal(joins, 2);
  for (const r of [streetA, streetB, deckA, deckB]) if (r.o.nodes.length === 3) assert.equal(new Set(r.o.nodes.map((n) => n[2])).size, 1, 'a joined road keeps one height');
  // a ramp ending 4 m above a street is never joined to it
  assert.equal(joinSeamRoads([at(0, 10, 0, 'a'), at(10, 20, 4, 'b')]).joins, 0);
});
test('a junction on a seam is left as the chunks built it', () => {
  const r = (pts, ch) => ({ o: { class: 'DecalRoad', material: 'm', nodes: pts.map(([x, y]) => [x, y, 0, 6]) }, chunk: ch });
  // one road arriving from chunk a, two branches leaving in chunk b, all at (10, 0)
  const res = joinSeamRoads([r([[0, 0], [10, 0]], 'a'), r([[10, 0], [20, 5]], 'b'), r([[10, 0.1], [20, -5]], 'b')]);
  assert.equal(res.joins, 0); assert.ok(res.ambiguous >= 1);
});
test('seam blend reads only the neighbour footprint (outside it Generate only fills)', () => {
  const size = 16; const f = { x0: 0, y0: 0, size, core: [0, 0, 12, 16], heights: new Float32Array(size * size).fill(5), runs: [[0, 0, 16]] };
  const b = seamBlendFor({ x0: 8, y0: 0, size }, [f], 4);
  assert.equal(b.weight[3], 1); assert.equal(b.weight[16 + 3], 0);   // row 1 is outside the neighbour's footprint
});
