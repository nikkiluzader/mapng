import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { addPavedSidewalks, DIP_LIP_M } from '../services/pavedSidewalks.js';

// a builder that keeps every triangle by material
const collector = () => {
  const tris = { slab: [], curb: [] };
  return { tris, tri(mat, a, b, c) { (tris[mat] || (tris[mat] = [])).push([a, b, c]); } };
};

// An east-west street 8 m wide on flat ground at 0 (y from -4 to 4), its sidewalk footway 5 m north of the curb, and a
// driveway crossing the sidewalk at x = 0 toward the street.
const scene = (driveways) => {
  const b = collector();
  const out = addPavedSidewalks(b, {
    carriageways: [{ nodes: [[-60, 0, 0], [60, 0, 0]], half: 4, highway: 'residential' }],
    walks: [{ nodes: [[-60, 9.5], [60, 9.5]], half: 1, sidewalk: true }],
    driveways, curbH: 0.15, THREE, groundAt: () => 0,
  });
  return { b, out };
};
// the curb's height at x: the faces along the street's edge (y under 5: skirts round the walk's far side are not curbs)
// whose top edge spans x, interpolated along it
const curbHeightNear = (b, x) => {
  let h = 0;
  for (let i = 0; i + 1 < b.tris.curb.length; i += 2) {
    const [a, top2, bot2] = b.tris.curb[i]; const [, , bot1] = b.tris.curb[i + 1];
    if (Math.max(a[1], top2[1]) > 5) continue;
    const x0 = Math.min(a[0], top2[0]); const x1 = Math.max(a[0], top2[0]);
    if (x < x0 || x > x1 || x1 - x0 < 1e-9) continue;
    const f = (x - a[0]) / (top2[0] - a[0]);
    h = Math.max(h, (a[2] - bot1[2]) * (1 - f) + (top2[2] - bot2[2]) * f);
  }
  return h;
};
test('the curb stands its full height along the street, and its face reaches the road surface', () => {
  const { b, out } = scene([]);
  assert.ok(out.stats.tiles >= 1 && b.tris.curb.length > 0);
  assert.ok(Math.abs(curbHeightNear(b, 20) - 0.15) < 0.02, `curb ${curbHeightNear(b, 20)}`);
  // every face along the street's edge reaches down to the road (z 0 here; the skirts round the walk's far side
  // run into the ground on purpose)
  const bottoms = b.tris.curb.filter((t) => t.every((p) => p[1] < 5 && Math.abs(p[0]) < 50)).flat().map((p) => p[2]);
  assert.ok(Math.min(...bottoms) > -0.01 && Math.min(...bottoms) < 0.01);
});

test('a driveway drops the curb to a lip across its width, ramping back up beside it', () => {
  const { b } = scene([[[0, 30], [0, 3]]]);
  const atDip = curbHeightNear(b, 0); const beside = curbHeightNear(b, 6);
  assert.ok(atDip <= DIP_LIP_M + 0.01, `curb at the driveway ${atDip}`);
  assert.ok(Math.abs(beside - 0.15) < 0.02, `curb 6 m along ${beside}`);
  // the slab there is down at the lip too (no step from the driveway onto the sidewalk)
  const slabAt = b.tris.slab.flat().filter((p) => Math.abs(p[0]) < 1 && p[1] > 4 && p[1] < 8).map((p) => p[2]);
  assert.ok(slabAt.length && Math.max(...slabAt) < 0.1, `slab in the dip up to ${Math.max(...slabAt)}`);
});

test('a bare curb (no sidewalk) keeps a curb along the road, open across its dips', () => {
  const b = collector();
  addPavedSidewalks(b, {
    carriageways: [{ nodes: [[-60, 0, 0], [60, 0, 0]], half: 4, highway: 'residential' }],
    // the curb line along the road's north edge, bare, with a dip (a car park right at the street) from 50 to 70 m
    runs: [{ points: [[-60, 4], [60, 4]], width: 0.15, side: 1, dips: [[50, 70]] }],
    curbH: 0.15, curbOnlyM: 0.15, THREE, groundAt: () => 0,
  });
  const faces = b.tris.curb.filter((t) => t.every((p) => p[1] < 4.3));
  assert.ok(faces.length > 0, 'a curb along the bare curb');
  // none in the open stretch (x from -10 to 10)
  assert.ok(!faces.some((t) => t.every((p) => p[0] > -8 && p[0] < 8)), 'open along the car park');
});
