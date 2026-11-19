import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceWithNearest, makeGrid, buildPavedGrid, cornerApex, ROAD, WALK, GAP, VERGE } from '../services/pavedArea.js';

test('distanceWithNearest: exact squared distance and a nearest seed, as brute force', () => {
  let seed = 3; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (const [w, h] of [[17, 11], [40, 40], [1, 9]]) {
    const s = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) s[i] = rnd() < 0.05 ? 1 : 0;
    const { d2, near } = distanceWithNearest(s, w, h);
    for (let i = 0; i < w * h; i++) {
      let best = Infinity;
      for (let j = 0; j < w * h; j++) if (s[j]) { const dx = (i % w) - (j % w); const dy = ((i / w) | 0) - ((j / w) | 0); best = Math.min(best, dx * dx + dy * dy); }
      if (best === Infinity) { assert.equal(near[i], -1); continue; }
      assert.equal(d2[i], best);
      const j = near[i]; const dx = (i % w) - (j % w); const dy = ((i / w) | 0) - ((j / w) | 0);
      assert.ok(s[j] && dx * dx + dy * dy === best);
    }
  }
});

// A synthetic street: an east-west road 8 m wide (y from -4 to 4), a sidewalk footway 5 m north of the curb
// (y = 9.5, 2 m wide), a plain footway 5 m south (y = -9.5), and a second sidewalk 10 m behind the first.
const scene = (extra = {}) => {
  const g = makeGrid(-30, -30, 30, 30);
  const { cells } = buildPavedGrid(g, {
    roads: [{ pts: [[-40, 0], [40, 0]], half: 4 }],
    walks: [
      { pts: [[-40, 9.5], [40, 9.5]], half: 1, sidewalk: true },
      { pts: [[-40, -9.5], [40, -9.5]], half: 1, sidewalk: false },
      { pts: [[-40, 20.5], [40, 20.5]], half: 1, sidewalk: true },
    ],
    ...extra,
  });
  const at = (x, y) => cells[Math.floor((30 - y) / g.res) * g.w + Math.floor((x + 30) / g.res)];
  return at;
};

test('a sidewalk footway is paved from the curb; a plain one 5 m off is not; nothing past a walk', () => {
  const at = scene();
  assert.ok(at(0, 0) & ROAD);
  assert.ok(at(0, 9.5) & WALK);
  for (const y of [4.5, 6, 8]) assert.ok(at(0, y) & GAP, `strip at y ${y} paved`);
  for (const y of [-5, -7]) assert.equal(at(0, y), 0, `plain footway's strip at y ${y} left`);
  for (const y of [11.5, 14, 18]) assert.ok(!(at(0, y) & GAP), `past the first walk at y ${y} not filled`);
});

test('mapped greenery keeps the strip as a verge', () => {
  const at = scene({ greenery: [[[-10, 4.2], [10, 4.2], [10, 8.4], [-10, 8.4]]] });
  assert.ok(at(0, 6) & VERGE && !(at(0, 6) & GAP));
  assert.ok(at(20, 6) & GAP, 'outside the greenery still paved');
});

test('cornerApex: where a rounded corner\'s two road edges meet', () => {
  // a quarter circle from (5, 0) round (5, 5) to (0, 5), its tangents along y = 0 and x = 0: they meet at (0, 0)
  const arc = Array.from({ length: 9 }, (_, i) => { const a = -Math.PI / 2 - (i / 8) * (Math.PI / 2); return [5 + 5 * Math.cos(a), 5 + 5 * Math.sin(a)]; });
  const q = cornerApex(arc);
  assert.ok(q && Math.abs(q[0]) < 0.1 && Math.abs(q[1]) < 0.1, JSON.stringify(q));
});

test('traceOutlines: a disc traces to one ring of its area; a square with a hole to an outer and a hole', async () => {
  const { traceOutlines, ringSignedArea, makeGrid: mk, markPolygon } = await import('../services/pavedArea.js');
  const g = mk(-10, -10, 10, 10);
  const cells = new Uint8Array(g.w * g.h);
  for (let r = 0; r < g.h; r++) for (let c = 0; c < g.w; c++) { const x = -10 + (c + 0.5) * g.res; const y = 10 - (r + 0.5) * g.res; if (x * x + y * y <= 36) cells[r * g.w + c] = 4; }
  const rings = traceOutlines(cells, g, 4);
  assert.equal(rings.length, 1);
  const area = Math.abs(ringSignedArea(rings[0]));
  assert.ok(Math.abs(area - Math.PI * 36) < 2, `area ${area}`);
  assert.ok(rings[0].length < 120, `simplified to ${rings[0].length} points`);
  const sq = new Uint8Array(g.w * g.h);
  markPolygon(sq, g, [[-6, -6], [6, -6], [6, 6], [-6, 6]], 2);
  for (let r = 0; r < g.h; r++) for (let c = 0; c < g.w; c++) { const x = -10 + (c + 0.5) * g.res; const y = 10 - (r + 0.5) * g.res; if (Math.abs(x) < 2 && Math.abs(y) < 2) sq[r * g.w + c] = 0; }
  const r2 = traceOutlines(sq, g, 2);
  assert.equal(r2.length, 2);
  const signs = r2.map((r) => Math.sign(ringSignedArea(r))).sort();
  assert.deepEqual(signs, [-1, 1], 'one outer, one hole, opposite windings');
  assert.ok(r2.every((r) => r.length <= 8), `square rings simplified to corners: ${r2.map((r) => r.length)}`);
});

test('buildPavedMesh: the slab covers the outline\'s area; the edge facing the road is a curb, the far edge a skirt', async () => {
  const THREE = await import('three');
  const { makeGrid: mk, buildPavedGrid: build, traceOutlines, buildPavedMesh, WALK: W, GAP: G, ringSignedArea } = await import('../services/pavedArea.js');
  const g = mk(-30, -30, 30, 30);
  const { cells } = build(g, { roads: [{ pts: [[-40, 0], [40, 0]], half: 4 }], walks: [{ pts: [[-40, 9.5], [40, 9.5]], half: 1, sidewalk: true }] });
  const rings = traceOutlines(cells, g, W | G);
  const area = rings.reduce((a, r) => a + ringSignedArea(r), 0);
  const m = buildPavedMesh(rings, cells, g, { THREE, heightAt: (x, y) => 0.15 + 0.01 * x });
  let tri = 0;
  for (let i = 0; i < m.slab.length; i += 9) tri += Math.abs((m.slab[i + 3] - m.slab[i]) * (m.slab[i + 7] - m.slab[i + 1]) - (m.slab[i + 6] - m.slab[i]) * (m.slab[i + 4] - m.slab[i + 1])) / 2;
  assert.ok(Math.abs(tri - area) < 0.5, `slab ${tri.toFixed(2)} m2 vs outline ${area.toFixed(2)} m2`);
  // curb faces sit along y = 4 (the road edge), skirts along y = 10.5 (the walk's far edge)
  const ys = (arr) => { const out = []; for (let i = 0; i < arr.length; i += 18) out.push((arr[i + 1] + arr[i + 4]) / 2); return out; };
  assert.ok(m.curb.length && ys(m.curb).every((y) => Math.abs(y - 4) < 0.5), 'curbs along the road edge');
  assert.ok(ys(m.skirt).some((y) => Math.abs(y - 10.5) < 0.5), 'a skirt along the walk\'s far edge');
  // the slab follows heightAt (a 1 % grade along x)
  let worst = 0; for (let i = 0; i < m.slab.length; i += 3) worst = Math.max(worst, Math.abs(m.slab[i + 2] - (0.15 + 0.01 * m.slab[i])));
  assert.ok(worst < 1e-5);
});

test('gradePaved: ground under the pavement just below the slab, blending back to the natural ground, roads left', async () => {
  const { makeGrid: mk, buildPavedGrid: build, gradePaved, GRADE_UNDER_M } = await import('../services/pavedArea.js');
  const g = mk(-30, -30, 30, 30);
  const { cells } = build(g, { roads: [{ pts: [[-40, 0], [40, 0]], half: 4 }], walks: [{ pts: [[-40, 9.5], [40, 9.5]], half: 1, sidewalk: true }] });
  // a 64 m terrain at 1 m, flat at 1 m over the slab's 0.2 m top (the ground stands higher beside the street)
  const W = 64; const heightMap = new Float32Array(W * W).fill(1);
  const { idx, z } = gradePaved(cells, g, { heightMap, width: W, height: W, worldSize: W, minHeight: 0 }, { heightAt: () => 0.2 });
  const edit = new Map(); idx.forEach((i, k) => edit.set(i, z[k]));
  const pix = (x, y) => Math.round((0.5 - y / W) * W - 1) * W + Math.round((x / W + 0.5) * W);
  assert.ok(Math.abs(edit.get(pix(0, 7)) - (0.2 - GRADE_UNDER_M)) < 1e-9, 'under the strip');
  assert.ok(!edit.has(pix(0, 0)), 'the road is left to the road grading');
  // (0.94 m of difference blends over 1.88 m: 1 m out is partway back up, 2 m out is the natural ground)
  const near = edit.get(pix(0, 11)); const far = edit.get(pix(0, 12));
  assert.ok(near > 0.06 && near < 1, `blending back up 1 m out: ${near}`);
  assert.ok(far === undefined, `natural ground 2 m out: ${far}`);
  assert.ok(!edit.has(pix(0, 25)), 'far ground untouched');
});

test('buildPavedMesh: a curb top band runs along the curb edge, inside it and just over the slab', async () => {
  const THREE = await import('three');
  const { makeGrid: mk, buildPavedGrid: build, traceOutlines, buildPavedMesh, WALK: W, GAP: G, CURB_TOP_LIFT_M } = await import('../services/pavedArea.js');
  const g = mk(-30, -30, 30, 30);
  const { cells } = build(g, { roads: [{ pts: [[-40, 0], [40, 0]], half: 4 }], walks: [{ pts: [[-40, 9.5], [40, 9.5]], half: 1, sidewalk: true }] });
  const m = buildPavedMesh(traceOutlines(cells, g, W | G), cells, g, { THREE, heightAt: () => 0.15, curbW: 0.15 });
  assert.ok(m.curbTop.length > 0);
  for (let i = 0; i < m.curbTop.length; i += 3) {
    const y = m.curbTop[i + 1]; const z = m.curbTop[i + 2];
    if (Math.abs(m.curbTop[i]) > 25) continue;   // (the band along the street's middle)
    assert.ok(y > 3.5 && y < 4.5, `band at y ${y}`);
    assert.ok(Math.abs(z - (0.15 + CURB_TOP_LIFT_M)) < 1e-5);
  }
});

test('a residential street (houses near) keeps its verge between curb and sidewalk as lawn; downtown paves it', async () => {
  const { makeGrid: mk, buildPavedGrid: build, GAP: G, VERGE: V } = await import('../services/pavedArea.js');
  const g = mk(-30, -30, 30, 30);
  const base = { roads: [{ pts: [[-40, 0], [40, 0]], half: 4 }], walks: [{ pts: [[-40, 8.5], [40, 8.5]], half: 1, sidewalk: true }] };
  const at = (cells, x, y) => cells[Math.floor((30 - y) / g.res) * g.w + Math.floor((x + 30) / g.res)];
  const town = build(g, base).cells;
  assert.ok(at(town, 0, 6) & G, 'downtown: paved to the curb');
  const house = [[-5, 14], [5, 14], [5, 22], [-5, 22]];
  const sub = build(g, { ...base, houses: [house] }).cells;
  assert.ok(at(sub, 0, 6) & V && !(at(sub, 0, 6) & G), 'with a house behind: lawn');
});

// The paved tiles on worker threads give the same grid and outlines as on this thread (the optimization rules: one
// function, both paths; results back in order).
test('paved tiles: worker threads and this thread agree', async () => {
  const { parallelMap } = await import('../services/parallel.js');
  const { pavedTiles } = await import('../services/pavedWorker.js');
  const item = (dx) => ({
    box: [-30 + dx, -30, 30 + dx, 30],
    roads: [{ pts: [[-40 + dx, 0], [40 + dx, 0]], half: 4 }],
    walks: [{ pts: [[-40 + dx, 9.5], [40 + dx, 9.5]], half: 1, sidewalk: true }, { pts: [[-40 + dx, -6], [40 + dx, -6]], half: 1, sidewalk: false }],
    buildings: [[[-5 + dx, 14], [5 + dx, 14], [5 + dx, 25], [-5 + dx, 25]]],
  });
  const batches = [[item(0), item(60)], [item(120)]];
  const threaded = (await parallelMap(batches, { local: pavedTiles, module: new URL('../services/pavedWorker.js', import.meta.url).href, fn: 'pavedTiles', threads: 2 })).flat();
  const inline = batches.flatMap(pavedTiles);
  assert.equal(threaded.length, 3);
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(Array.from(threaded[i].cells), Array.from(inline[i].cells));
    assert.deepEqual(threaded[i].rings, inline[i].rings);
    assert.ok(inline[i].rings.length > 0);
  }
});
