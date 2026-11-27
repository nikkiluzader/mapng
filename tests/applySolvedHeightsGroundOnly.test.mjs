import test from 'node:test';
import assert from 'node:assert/strict';
import { applySolvedHeights } from '../services/structures/adapters.js';

test('applySolvedHeights groundOnly: ground stations move, deck stations and stations within 40 m of a deck keep their height', () => {
  // (the carriageways the sidewalks read follow a raised road (Sabile's Meza iela, 2026-11-27), but not between a deck's
  // wing walls, where a lifted sidewalk overhung them (the sweep's deck car park))
  const n = 51; const s = Float64Array.from({ length: n }, (_, i) => i * 4);
  const e = { seg: 7, x: Float64Array.from(s), y: new Float64Array(n), s, half: 3 };
  const z = [Float64Array.from({ length: n }, () => 12)];
  // a deck from 160 to 200 m
  const graph = { edges: [e], profile: { z }, classes: { segments: [{ edge: 0, i0: 0, i1: 39, kind: 'ground' }, { edge: 0, i0: 40, i1: 50, kind: 'deck' }] } };
  const nodes = [[20, 0, 10], [100, 0, 10], [130, 0, 10], [180, 0, 10]];
  applySolvedHeights([{ __items: [{ __owner: 7, nodes }] }], graph, { groundOnly: true });
  assert.equal(nodes[0][2], 12, 'far from the deck: moved');
  assert.equal(nodes[1][2], 12, '60 m before the deck: moved');
  assert.equal(nodes[2][2], 10, '30 m before the deck: kept');
  assert.equal(nodes[3][2], 10, 'on the deck: kept');
});
