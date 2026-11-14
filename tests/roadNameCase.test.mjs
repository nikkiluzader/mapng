// Two roads whose names differ only in letter case must not share an object name: the game's names are not
// case-sensitive, and the second road's fields landed on the first (its 240 m of nodes moved 670 m across town).
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDecalRoads } from '../services/exportBeamNGLevel.js';

const deg = 1000 / 111320;
const bounds = { south: -deg / 2, north: deg / 2, west: -deg / 2, east: deg / 2 };
const line = (lat0, lng0, lat1, lng1) => [{ lat: lat0, lng: lng0 }, { lat: lat1, lng: lng1 }];
const terrain = (osmFeatures) => ({
  width: 512, height: 512, minHeight: 0, maxHeight: 10, heightMap: new Float32Array(512 * 512).fill(5),
  bounds, osmFeatures, roadRules: { countryCode: 'US', region: 'Americas' },
});

test('roads named alike but for letter case get object and folder names that differ without it', () => {
  const k = deg / 4;
  const groups = generateDecalRoads(terrain([
    { id: '1', type: 'road', geometry: line(-k, -k, -k, k), tags: { highway: 'primary', name: 'BRTS Bus Lane' } },
    { id: '2', type: 'road', geometry: line(0, -k, 0, k), tags: { highway: 'primary', name: 'BRTS Bus lane' } },
    { id: '3', type: 'road', geometry: line(k, -k, k, k), tags: { highway: 'primary', name: 'BRTS Bus lane' } },
    { id: '4', type: 'road', geometry: line(k / 2, -k, k / 2, k), tags: { highway: 'primary', name: 'brts bus lane' } },
  ]), 1000 / 511);
  const names = []; const folders = [];
  const walk = (items) => { for (const it of items || []) { if (it.class === 'SimGroup') folders.push(it.name); else if (it.name) names.push(it.name); walk(it.__items); } };
  walk(groups);
  assert.ok(names.length >= 4 && folders.length >= 4);
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length, 'object names');
  assert.equal(new Set(folders.map((n) => n.toLowerCase())).size, folders.length, 'folder names');
});

test('a road surface carries its lanes and the width of its driving lanes for the Hero Roads script', async () => {
  const k = deg / 4;
  const groups = generateDecalRoads(terrain([
    { id: '1', type: 'road', geometry: line(-k, -k, -k, k), tags: { highway: 'secondary', name: 'Polna' } },
  ]), 1000 / 511);
  const base = groups.flatMap((g) => g.__items || []).find((d) => d.class === 'DecalRoad' && /_s\d+_b$/.test(d.name));
  assert.ok(base && typeof base.mapngLanes === 'string', 'the note is on the road surface');
  const [f, b, lht, tagged, driving] = base.mapngLanes.split(' ').map(Number);
  assert.equal(f, 1); assert.equal(b, 1); assert.ok(lht === 0 && tagged === 0);
  const width = base.nodes[base.nodes.length >> 1][3];
  // the driving lanes are no wider than the surface, and narrower where the surface has shoulders
  assert.ok(driving >= 4 && driving <= width + 1e-6, `driving ${driving} of a ${width} m surface`);
  // the script reads the fifth number and gives the lanes the driving width only
  const { HERO_ROADS_LUA } = await import('../services/heroRoadsLua.js');
  assert.ok(HERO_ROADS_LUA.includes("'^%d+ %d+ %d %d ([%d%.]+)'") && HERO_ROADS_LUA.includes('gm.setLaneProfile(g, lanesLeft, lanesRight, laneWidth)'));
  console.log(`      (a secondary road with no width tag: surface ${width} m, driving lanes ${driving} m, lane ${(driving / 2).toFixed(2)} m; before: ${((width - 0.6) / 2).toFixed(2)} m)`);
});
