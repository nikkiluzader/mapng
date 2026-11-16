import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlatformMeshes, bufferLine, PLATFORM_OVER_RAIL_M, PLATFORM_OVER_GROUND_M } from '../services/platforms.js';

const zs = (mesh) => { const a = mesh.geometry.attributes.position.array; const out = []; for (let i = 2; i < a.length; i += 3) out.push(a[i]); return out; };

test('a platform beside a track stands its height over the track; its sides reach below the ground', () => {
  // a 100 m track at 5 m (its bed raised over ground at 4 m), a platform area 4 m beside it
  const tracks = [{ points: [[0, 0], [100, 0]], z: [5, 5] }];
  const area = [[10, 3], [90, 3], [90, 7], [10, 7], [10, 3]];
  const { meshes, count } = buildPlatformMeshes([{ points: area }], { groundAt: () => 4, tracks });
  assert.equal(count, 1);
  const topZ = zs(meshes.find((m) => m.name === 'platforms_pavers'));
  assert.ok(topZ.every((z) => Math.abs(z - (5 + PLATFORM_OVER_RAIL_M)) < 1e-6), `top at ${topZ[0]}`);
  const sideZ = zs(meshes.find((m) => m.name === 'platforms_concrete'));
  assert.ok(Math.min(...sideZ) < 4 && Math.max(...sideZ) > 5.5);
  // the top faces up
  const n = meshes.find((m) => m.name === 'platforms_pavers').geometry.attributes.normal.array;
  assert.ok(n[2] > 0.99);
});

test('a line platform is given its width; with no track near it stands a kerb over the ground', () => {
  const ring = bufferLine([[0, 0], [50, 0]], 4);
  assert.equal(ring.length, 4);
  assert.ok(Math.abs(Math.max(...ring.map((p) => p[1])) - 2) < 1e-9);
  const { meshes, count } = buildPlatformMeshes([{ points: [[0, 0], [50, 0]], width: 4 }], { groundAt: () => 10, tracks: [] });
  assert.equal(count, 1);
  assert.ok(zs(meshes.find((m) => m.name === 'platforms_pavers')).every((z) => Math.abs(z - (10 + PLATFORM_OVER_GROUND_M)) < 1e-6));
});

test('a kerbed island is a kerb round its edge, its inside left to the ground', () => {
  const ring = [[0, 0], [20, 0], [20, 10], [0, 10], [0, 0]];
  const { meshes, count } = buildPlatformMeshes([{ points: ring, strip: true, width: 0.3, over: 0.15 }], { groundAt: () => 2, topSet: 'concrete', sideSet: 'concrete', name: 'kerb_islands' });
  assert.equal(count, 1);
  const a = meshes[0].geometry.attributes.position.array;
  // no vertex of the top near the island's middle: only the band round it
  for (let i = 0; i < a.length; i += 3) if (Math.abs(a[i + 2] - 2.15) < 1e-6) assert.ok(a[i] < 0.5 || a[i] > 19.5 || a[i + 1] < 0.5 || a[i + 1] > 9.5, `${a[i]}, ${a[i + 1]}`);
});

test('every side faces out and every top faces up, whichever way the outline was drawn', () => {
  const ccw = [[0, 0], [20, 0], [20, 6], [0, 6], [0, 0]];
  for (const ring of [ccw, ccw.slice().reverse()]) for (const pl of [{ points: ring }, { points: ring, over: 0.15 }, { points: ring, over: 0.15, strip: true, width: 0.3 }]) {
    const { meshes } = buildPlatformMeshes([pl], { groundAt: () => 0 });
    for (const m of meshes) {
      const a = m.geometry.attributes.position.array;
      for (let i = 0; i < a.length; i += 9) {
        const u = [a[i + 3] - a[i], a[i + 4] - a[i + 1], a[i + 5] - a[i + 2]]; const v = [a[i + 6] - a[i], a[i + 7] - a[i + 1], a[i + 8] - a[i + 2]];
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const L = Math.hypot(...n);
        if (L < 1e-9) continue;
        if (Math.abs(n[2] / L) > 0.7) { assert.ok(n[2] > 0, 'a top facing down'); continue; }
        // a side: facing away from the outline's middle line (y = 3), or, on a strip's inner wall, toward it
        const my = (a[i + 1] + a[i + 4] + a[i + 7]) / 3 - 3; const mx = (a[i] + a[i + 3] + a[i + 6]) / 3 - 10;
        if (!pl.strip) assert.ok(n[0] * mx + n[1] * my > 0, `a side facing in (${JSON.stringify(pl).slice(0, 40)})`);
      }
    }
  }
});
