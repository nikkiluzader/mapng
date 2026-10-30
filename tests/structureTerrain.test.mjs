import test from 'node:test';
import assert from 'node:assert/strict';
import { composeTerrain } from '../services/structures/terrainCompose.js';
import { STRUCTURE_SCENES, runStructureScene } from './helpers/structureScenes.mjs';

const composedScene = async (name) => {
  const log = console.log; console.log = () => {};
  try {
    const { groups, td, squareSize } = await runStructureScene(STRUCTURE_SCENES.find((s) => s.name === name));
    const g = groups.structureGraph;
    const out = composeTerrain(g, { heightMap: td.heightMap, width: td.width, height: td.height, worldSize: td.width * squareSize, minHeight: td.minHeight });
    return { g, out };
  } finally { console.log = log; }
};

test('overpass: road cores at the solved height, nothing under the deck reaches its underside', async () => {
  const { g, out } = await composedScene('overpass on flat ground');
  const kindAt = new Map(g.classes.segments.map((s) => [s, s.kind]));
  for (const seg of kindAt.keys()) {
    const e = g.edges[seg.edge]; const z = g.profile.z[seg.edge];
    for (let i = seg.i0; i <= seg.i1; i += 3) {
      const h = out.heightAt(e.x[i], e.y[i]);
      const fromEnds = Math.min(e.s[i] - e.s[seg.i0], e.s[seg.i1] - e.s[i]);
      if (seg.kind === 'deck' && fromEnds < 8) continue;   // resting on its abutment
      if (seg.kind === 'embankment' && fromEnds < 2) continue;   // the abutment wall at the deck end
      if (seg.kind === 'deck') assert.ok(h <= z[i] - 2.2 - 0.45, `ground ${h.toFixed(2)} under deck at ${z[i].toFixed(2)}`);
      else if (seg.kind === 'ground' || seg.kind === 'embankment') assert.ok(Math.abs(h - z[i]) < 0.15, `${seg.kind} core ${h.toFixed(2)} vs road ${z[i].toFixed(2)}`);
    }
  }
  assert.ok(out.stats.pixels > 0);
});

test('a junction over a round bump comes out flat at the solved height', () => {
  // four roads meeting at the origin, all solved at z = 0; the ground has a
  // 0.6 m round bump at the junction
  const width = 201; const height = 201; const worldSize = 200;
  const hm = new Float32Array(width * height);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
    const x = c - 100; const y = 100 - r;
    hm[r * width + c] = Math.hypot(x, y) < 8 ? 0.6 : 0;
  }
  const arm = (dx, dy) => {
    const n = 21; const x = []; const y = []; const s = []; const g = [];
    for (let i = 0; i < n; i++) { x.push(dx * i * 4); y.push(dy * i * 4); s.push(i * 4); g.push(i * 4 < 8 ? 0.6 : 0); }
    return { x: Float64Array.from(x), y: Float64Array.from(y), s: Float64Array.from(s), g: Float64Array.from(g), half: 3.5, highway: 'residential' };
  };
  const edges = [arm(1, 0), arm(-1, 0), arm(0, 1), arm(0, -1)];
  const graph = {
    edges,
    profile: { z: edges.map((e) => new Float64Array(e.s.length)) },
    classes: { segments: edges.map((e, k) => ({ edge: k, i0: 0, i1: e.s.length - 1, kind: 'ground' })) },
  };
  const out = composeTerrain(graph, { heightMap: hm, width, height, worldSize, minHeight: 0 });
  for (const [x, y] of [[0, 0], [3, 2], [-2, -3], [6, 0], [0, -6]]) {
    assert.ok(Math.abs(out.heightAt(x, y)) < 0.02, `bump left at ${x},${y}: ${out.heightAt(x, y).toFixed(3)}`);
  }
  // writing applies the same values
  const written = new Map();
  out.apply((idx, v) => written.set(idx, v));
  assert.ok(Math.abs(written.get(100 * width + 100)) < 0.02);
});

test('tunnels: no edit over a bored tunnel', async () => {
  const { g, out } = await composedScene('mountain tunnel through a ridge');
  const seg = g.classes.segments.find((s) => s.kind === 'boredTunnel');
  assert.ok(seg, 'a bored stretch');
  const e = g.edges[seg.edge]; const mid = (seg.i0 + seg.i1) >> 1;
  assert.ok(Math.abs(out.heightAt(e.x[mid], e.y[mid]) - e.g[mid]) < 0.05, 'the ridge over the tube untouched');
});

test('a road into a tunnel: no corridor past the portal; a tunnel builder\'s ground kept beside the road', () => {
  // an approach along +x to a portal at x = 0 (its node shared with a tube
  // stretch another builder owns); ground 8 m over the cut road everywhere
  const width = 201; const height = 201; const worldSize = 200;
  const hm = new Float32Array(width * height).fill(8);
  const line = (x0, n) => {
    const x = []; const y = []; const s = []; const g = [];
    for (let i = 0; i < n; i++) { x.push(x0 + i * 3); y.push(0); s.push(i * 3); g.push(8); }
    return { x: Float64Array.from(x), y: Float64Array.from(y), s: Float64Array.from(s), g: Float64Array.from(g), half: 4, highway: 'primary' };
  };
  const approach = { ...line(-60, 21), from: 'a', to: 'portal' };
  const tube = { ...line(0, 21), from: 'portal', to: 'b' };
  const graph = {
    edges: [approach, tube],
    profile: { z: [new Float64Array(21).fill(-4), new Float64Array(21).fill(-4)] },
    classes: { segments: [{ edge: 0, i0: 0, i1: 20, kind: 'cutting' }, { edge: 1, i0: 0, i1: 20, kind: 'external' }] },
  };
  const idx = (x, y) => Math.round(100 - y) * width + Math.round(x + 100);
  // the builder's cutting beside the road, a band 8 to 10 m out (a lone
  // pixel would be despiked)
  const kept = new Set();
  for (let x = -40; x <= -10; x++) for (const y of [8, 9, 10, -8, -9, -10]) kept.add(idx(x, y));
  const out = composeTerrain(graph, { heightMap: hm, width, height, worldSize, minHeight: 0, keep: (i) => kept.has(i) });
  assert.ok(Math.abs(out.heightAt(-20, 0) + 4) < 0.05, 'the cut road');
  for (const x of [2, 4, 6]) assert.ok(Math.abs(out.heightAt(x, 0) - 8) < 0.05, `no cut ${x} m into the tube: ${out.heightAt(x, 0).toFixed(2)}`);
  const written = new Map(); out.apply((i, v) => written.set(i, v));
  assert.ok(!written.has(idx(-20, 9)) && !written.has(idx(-20, -9)), 'the kept ground untouched');
  assert.ok(written.has(idx(-20, 6)), 'beside it the side slope is composed');
});
