// services/roadCorridor.js: a road stretch widened either side, as a grid and row runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { corridorGrid } from '../services/roadCorridor.js';
import { shapeArea } from '../services/batchShape.js';

const D = 1 / 111320;   // ~1 m of latitude near the equator
const P = (xm, ym) => ({ lat: ym * D, lng: xm * D });
// (a pixel of Generate's grid spans the fetch box's metres over W - 1: the map's extent plus 4 m each side)
const groundM2 = (g, m) => g.areaPx * ((g.width * m + 8) / (g.width - 1)) * ((g.height * m + 8) / (g.height - 1));

test('a straight 1 km road, 100 m either side: about 1000 x 200 m plus the round ends', () => {
  const g = corridorGrid([P(-500, 0), P(500, 0)], 100, 1);
  assert.ok(Math.abs(g.lengthM - 1000) < 2, `length ${g.lengthM}`);
  assert.ok(g.width >= 1200 && g.width <= 1220 && g.height >= 200 && g.height <= 220, `${g.width} x ${g.height}`);
  const expect = 1000 * 200 + Math.PI * 100 * 100;   // the band plus the two half discs
  assert.ok(Math.abs(groundM2(g, 1) - expect) / expect < 0.01, `ground ${groundM2(g, 1)} m2 vs ${expect}`);
  assert.equal(shapeArea({ runs: g.runs }, g.height, g.width), g.areaPx);
});

test('a hairpin: the overlapping bends counted once, never more than the box', () => {
  const g = corridorGrid([P(0, 0), P(300, 0), P(300, 60), P(0, 60)], 50, 1);
  assert.ok(g.areaPx < g.width * g.height);
  // the two arms 60 m apart with 50 m either side overlap: less than the two arms' sum
  assert.ok(g.areaPx < 2 * (300 * 100 + Math.PI * 2500), `${g.areaPx}`);
  // a middle row through both arms: one merged run
  const mid = g.runs.filter(([y]) => y === Math.floor(g.height / 2));
  assert.equal(mid.length, 1);
});

test('the width is held to its limits', () => {
  assert.equal(corridorGrid([P(0, 0), P(100, 0)], 1, 1).halfWidthM, 50);
  assert.equal(corridorGrid([P(0, 0), P(100, 0)], 1e6, 1).halfWidthM, 2000);
});

test('a coarser processing resolution: fewer pixels, same ground', () => {
  const a = corridorGrid([P(-500, 0), P(500, 0)], 100, 1); const b = corridorGrid([P(-500, 0), P(500, 0)], 100, 2);
  assert.ok(Math.abs(groundM2(b, 2) - groundM2(a, 1)) / groundM2(a, 1) < 0.01, `${groundM2(b, 2)} vs ${groundM2(a, 1)}`);
});
