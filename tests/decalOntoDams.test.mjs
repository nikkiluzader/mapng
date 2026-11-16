import test from 'node:test';
import assert from 'node:assert/strict';
import { decalOntoDams } from '../services/exportBeamNGLevel.js';

// a dam 100 m long across x, 10 m wide, its crest at 50 m
const dam = { ring: [[0, -5], [100, -5], [100, 5], [0, 5]], crest: 50 };
const road = (xs, z = (x) => (x < 0 || x > 100 ? 50 : 20)) => ({ name: 'dr_x', class: 'DecalRoad', nodes: xs.map((x) => [x, 0, z(x), 4]) });

test('a ground-following road across a dam: its piece on the dam at the crest, drawn on the crest object', () => {
  const out = decalOntoDams(road([-40, -20, -5, 10, 30, 50, 70, 90, 105, 120]), [dam]);
  assert.equal(out.length, 3);
  const mid = out.find((d) => d.overObjects);
  assert.ok(mid, 'one piece over objects');
  assert.ok(mid.nodes.slice(2, -2).every((n) => Math.abs(n[2] - 50.02) < 1e-6), 'at the crest');
  assert.equal(mid.nodes[0][2], 50); assert.equal(mid.nodes.at(-1)[2], 50);   // its ends at the banks' ground
  assert.ok(mid.nodes.every((n) => n[2] >= 50 && n[2] <= 50.02), 'coming up to the crest between');
  assert.equal(mid.nodes[0][0], -5); assert.equal(mid.nodes.at(-1)[0], 105);   // one node out onto each bank
  assert.equal(new Set(out.map((d) => d.name)).size, 3, 'each piece its own name');
  const ground = out.filter((d) => !d.overObjects);
  assert.ok(ground.every((d) => d.nodes.every((n) => n[2] === 50)), 'the banks as they were');
  assert.equal(mid.nodes[0][3], 4, 'widths kept');
});

test('a road that touches no dam is left as it is', () => {
  const d = road([200, 220, 240]);
  assert.deepEqual(decalOntoDams(d, [dam]), [d]);
  assert.deepEqual(decalOntoDams(d, []), [d]);
});
