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

test('texture scale as today: the slab at a metre over SLAB_TILE_M, curb faces in the curb sheet\'s face band', async () => {
  const { SLAB_TILE_M } = await import('../services/sidewalkPanels.js');
  const tris = [];
  const b = { tri(mat, a, bb, c, ua, ub, uc) { tris.push({ mat, p: [a, bb, c], uv: [ua, ub, uc] }); } };
  addPavedSidewalks(b, {
    carriageways: [{ nodes: [[-60, 0, 0], [60, 0, 0]], half: 4, highway: 'residential' }],
    walks: [{ nodes: [[-60, 9.5], [60, 9.5]], half: 1, sidewalk: true }],
    curbH: 0.15, THREE, groundAt: () => 0,
    uvBands: { curbRepeat: 9, face: [0.88, 0.92], top: [0.92, 0.998] },
  });
  // (a slab's UVs were once raw metres: the texture repeated ten times too densely, seen only in game)
  for (const t of tris.filter((x) => x.mat === 'slab')) {
    for (let k = 0; k < 3; k++) {
      assert.ok(Math.abs(t.uv[k][0] - t.p[k][0] / SLAB_TILE_M) < 1e-9 && Math.abs(t.uv[k][1] - t.p[k][1] / SLAB_TILE_M) < 1e-9);
    }
  }
  // curb faces (vertical) in the face band, the top band (flat) in the top band
  const curbs = tris.filter((x) => x.mat === 'curb');
  assert.ok(curbs.length > 0);
  for (const t of curbs) {
    // (a face is vertical when it has no footprint from above; the top band follows the slab's slight slope)
    const [p0, p1, p2] = t.p;
    const flat = Math.abs((p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1])) > 1e-6;
    const [lo, hi] = flat ? [0.92, 0.998] : [0.88, 0.92];
    for (const uv of t.uv) assert.ok(uv[1] >= lo - 1e-9 && uv[1] <= hi + 1e-9, `v ${uv[1]} outside ${lo}..${hi}`);
  }
});

// A street on a fill: the ground level with the road to 1 m past the curb, then down a bank 4 m to the walk at its
// foot (y = 9.5). The closed strip down the bank is left as terrain; the walk and the curb strip stay paved.
test('no paving down a bank: the strip between the curb and a walk below it is left unpaved', () => {
  const ground = (x, y) => (Math.abs(y) <= 5 ? 0 : -Math.min(4, (Math.abs(y) - 5) * 1.5));
  const build = (groundAt) => {
    const b = collector();
    addPavedSidewalks(b, {
      carriageways: [{ nodes: [[-60, 0, 0], [60, 0, 0]], half: 4, highway: 'residential' }],
      walks: [{ nodes: [[-60, 9.5, -4], [60, 9.5, -4]], half: 1, sidewalk: true }],
      curbH: 0.15, THREE, groundAt,
    });
    return b.tris.slab.filter((t) => t.every((p) => Math.abs(p[0]) < 40));
  };
  const area = (tris, y0, y1) => tris.filter((t) => { const y = (t[0][1] + t[1][1] + t[2][1]) / 3; return y > y0 && y < y1; })
    .reduce((s, [a, b, c]) => s + Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2, 0);
  const flat = build(() => 0); const bank = build(ground);
  // flat: paved from the curb to the walk; on the bank, the slope (y 6 to 8.5) is not
  assert.ok(area(flat, 6, 8.4) > 100, `flat ${area(flat, 6, 8.4)}`);
  assert.ok(area(bank, 6, 8.4) < 0.1 * area(flat, 6, 8.4), `bank ${area(bank, 6, 8.4)}`);
  // the walk itself is still paved
  assert.ok(area(bank, 8.6, 10.4) > 100, `walk ${area(bank, 8.6, 10.4)}`);
});

// The ground check's lattice samples of the built slab: the plane's height where a triangle covers a point, NaN off it.
test('sampleSlab: the slab height on the check lattice, NaN where there is none', async () => {
  const { sampleSlab } = await import('../services/pavedSidewalks.js');
  const g = { x0: 0, y1: 20, w: 80, h: 80, res: 0.25 };
  // a sloping square over x 0..10, y 10..20 (z = x / 10), two triangles
  const slab = [0, 10, 0, 10, 10, 1, 10, 20, 1, 0, 10, 0, 10, 20, 1, 0, 20, 0];
  const s = sampleSlab(slab, g, 2);
  assert.equal(s.k, 8); assert.equal(s.cols, 10);
  const at = (ri, ci) => s.z[ri * s.cols + ci];
  // lattice point (0, 1): x = 2.125, y = 19.875
  assert.ok(Math.abs(at(0, 1) - 0.2125) < 1e-5);
  // x = 12.125: off the slab
  assert.ok(Number.isNaN(at(0, 6)));
});

// A mapped path the export does not raise (dirt, gravel, a highway=path, a footway on a bridge) is no paving: it stays a
// path on the ground. Paved, a hillside gravel path came out a concrete strip leaning with the slope (dev_szczyrk).
test('only raised walks are paved: an unpaved path far from the street is left on the ground', () => {
  const slabArea = (walk) => {
    const b = collector();
    addPavedSidewalks(b, {
      carriageways: [{ nodes: [[-60, 0, 0], [60, 0, 0]], half: 4, highway: 'residential' }],
      walks: [walk], curbH: 0.15, THREE, groundAt: () => 0,
    });
    return b.tris.slab.filter((t) => t.every((p) => p[1] > 20)).reduce((s, [a, p, c]) => s + Math.abs((p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1])) / 2, 0);
  };
  const path = { nodes: [[-30, 30, 0], [30, 30, 0]], half: 1 };
  assert.ok(slabArea({ ...path, sidewalk: true }) > 80, 'a paved footway is paved');
  assert.equal(slabArea({ ...path, sidewalk: false }), 0, 'a dirt path is not');
});
