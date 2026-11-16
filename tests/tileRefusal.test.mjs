import test from 'node:test';
import assert from 'node:assert/strict';
import { tileRefusalWatch } from '../services/tileRefusal.js';

test('six failures with nothing loaded: refused, told once', () => {
  let n = 0; const w = tileRefusalWatch(() => n++);
  for (let i = 0; i < 5; i++) w.error();
  assert.equal(n, 0); w.error(); assert.equal(n, 1); w.error(); w.error(); assert.equal(n, 1);
});

test('a tile that loads means the server answers: stray failures are not a refusal', () => {
  let n = 0; const w = tileRefusalWatch(() => n++);
  w.error(); w.error(); w.load(); for (let i = 0; i < 20; i++) w.error();
  assert.equal(n, 0);
});

test('reset starts over (the layer shown again)', () => {
  let n = 0; const w = tileRefusalWatch(() => n++);
  for (let i = 0; i < 6; i++) w.error(); w.reset(); for (let i = 0; i < 6; i++) w.error();
  assert.equal(n, 2);
});
