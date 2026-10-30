import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { lintLevelZip } from '../scripts/lib/levelLint.mjs';

// a tiny hand-built level with one fault of each kind the linter checks
async function brokenLevel() {
  const zip = new JSZip();
  const L = 'levels/lint_demo';
  const nd = (objs) => objs.map((o) => JSON.stringify(o)).join('\n');
  // .ter v9, 128 x 128, two materials, one layer sample past them
  const size = 128;
  const names = ['grass', 'missing_mat'];
  const nameBytes = names.reduce((n, s) => n + 1 + s.length, 0);
  const ter = new Uint8Array(5 + size * size * 3 + 4 + nameBytes);
  const dv = new DataView(ter.buffer);
  dv.setUint8(0, 9); dv.setUint32(1, size, true);
  ter[5 + size * size * 2 + 7] = 5;
  let off = 5 + size * size * 3; dv.setUint32(off, names.length, true); off += 4;
  for (const s of names) { ter[off++] = s.length; for (const ch of s) ter[off++] = ch.charCodeAt(0); }
  zip.file(`${L}/art/terrains/theTerrain.ter`, ter);
  zip.file(`${L}/art/terrains/main.materials.json`, JSON.stringify({
    grass: { class: 'TerrainMaterial', internalName: 'grass', baseColorBaseTex: `/${L}/art/terrains/grass.png` },
    set: { class: 'TerrainMaterialTextureSet', name: 'set' },
  }));
  zip.file(`${L}/main.materials.json`, JSON.stringify({ road_mat: { name: 'road_mat', mapTo: 'road_mat', Stages: [{ baseColorMap: `/${L}/art/road.color.png` }] } }));
  zip.file(`${L}/info.json`, JSON.stringify({ defaultSpawnPointName: 'spawn_default', spawnPoints: [{ objectname: 'spawn_missing' }] }));
  zip.file(`${L}/main/items.level.json`, nd([
    { name: 'MissionGroup', class: 'SimGroup' },
    { name: 'theTerrain', class: 'TerrainBlock', __parent: 'MissionGroup', terrainFile: `/${L}/art/terrains/theTerrain.ter`, materialTextureSet: 'set', position: [-64, -64, 0], squareSize: 1 },
    { name: 'r1', class: 'DecalRoad', __parent: 'MissionGroup', persistentId: 'a', material: 'road_mat', nodes: [[0, 0, 0, 4], [10, 0, 0, 4]] },
    { name: 'r2', class: 'DecalRoad', __parent: 'MissionGroup', persistentId: 'a', material: 'nope', nodes: [[0, 0, 0, 4]] },
    { name: 'bad', class: 'TSStatic', __parent: 'Ghost', shapeName: `/${L}/art/shapes/none.dae`, position: [0, Number.NaN, 0] },
  ]).replace('null', 'null'));
  zip.file(`${L}/main/MissionGroup/items.level.json`, '{"class":"SimGroup","name":"x"\n');
  zip.file('stray/readme.txt', 'x');
  return zip.generateAsync({ type: 'uint8array' });
}

test('level lint: catches each kind of fault in a broken level', async () => {
  const { findings } = await lintLevelZip(await brokenLevel(), { gameMaterials: new Set(), gameHas: () => false });
  const has = (check, re) => findings.some((f) => f.check === check && re.test(f.msg));
  assert.ok(has('layout', /stray/), 'stray top folder');
  assert.ok(has('json', /does not parse/), 'bad NDJSON line');
  assert.ok(has('scene', /duplicate persistentId/), 'duplicate persistentId');
  assert.ok(has('scene', /Ghost/), 'missing parent group');
  assert.ok(has('transform', /non-finite/), 'NaN position (JSON null)');
  assert.ok(has('info', /spawn_default/), 'default spawn not listed');
  assert.ok(has('info', /spawn_missing/), 'spawn names no object');
  assert.ok(has('terrain', /missing_mat/), '.ter material undefined');
  assert.ok(has('terrain', /layer map/), 'layer index past the materials');
  assert.ok(has('textures', /grass\.png/), 'missing terrain texture');
  assert.ok(has('textures', /road\.color\.png/), 'missing material texture');
  assert.ok(has('roads', /1 node/), 'one-node road');
  assert.ok(has('materials', /"nope"/), 'undefined road material');
  assert.ok(has('shapes', /none\.dae/), 'missing shape');
  assert.ok(findings.every((f) => ['error', 'warn'].includes(f.level)));
});
