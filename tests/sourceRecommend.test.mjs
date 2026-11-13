// services/sourceRecommend.js: which of the compared elevation sources to use
import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendSource, levelWhereItSlopes } from '../services/sourceRecommend.js';

const PX = 512; const CELL = 1;
const grid = (f) => { const h = new Float32Array(PX * PX); for (let y = 0; y < PX; y++) for (let x = 0; x < PX; x++) h[y * PX + x] = f(x, y); return h; };
const slope = grid((x, y) => 10 + y * 0.03);                         // a hillside: 3 %, 15 m across the square
const bumpy = (base) => grid((x, y) => base(x, y) + ((x >> 3) + (y >> 3)) % 2 * 0.4);

test('the finest source loaded is suggested', () => {
  const lidar = bumpy((x, y) => 10 + y * 0.03);
  assert.deepEqual(recommendSource({ standard: { h: slope }, mapterhorn: { h: lidar, res: 2 } }, PX, CELL), { pick: 'mapterhorn', why: 'finest' });
  assert.deepEqual(recommendSource({ standard: { h: slope }, mapterhorn: { h: lidar, res: 2 }, gpxz: { h: lidar, res: 1 } }, PX, CELL), { pick: 'gpxz', why: 'finest' });
  assert.deepEqual(recommendSource({ standard: { h: slope } }, PX, CELL), { pick: 'standard', why: 'noLidar' });
  assert.equal(recommendSource({}, PX, CELL), null);
});

test('lidar lying level where the 30 m data slopes, metres away, is not suggested (the Arnhem shelf)', () => {
  // the hillside's lower two thirds replaced by a level shelf at the river's height
  const shelf = grid((x, y) => (y > 170 ? 8.5 : 10 + y * 0.03));
  const r = levelWhereItSlopes(shelf, slope, PX, CELL);
  assert.ok(r.share > 0.25 && r.apartM > 4, JSON.stringify(r));
  assert.equal(recommendSource({ standard: { h: slope }, mapterhorn: { h: shelf, res: 3 } }, PX, CELL).pick, 'standard');
  const withGpxz = recommendSource({ standard: { h: slope }, mapterhorn: { h: shelf, res: 3 }, gpxz: { h: slope, res: 1 } }, PX, CELL);
  assert.equal(withGpxz.pick, 'gpxz'); assert.equal(withGpxz.why, 'lidarLevel');
});

test('trees and buildings (the 30 m data above level lidar, but not sloping) raise no doubt', () => {
  const flat = grid(() => 5);
  const canopy = grid((x, y) => 5 + 14 + ((x >> 5) + (y >> 5)) % 2 * 3);      // 14-17 m of forest over flat ground
  assert.equal(levelWhereItSlopes(flat, canopy, PX, CELL).share < 0.05, true);
  assert.equal(recommendSource({ standard: { h: canopy }, mapterhorn: { h: flat, res: 1 } }, PX, CELL).pick, 'mapterhorn');
});

test('a real slope in both, however far apart, raises no doubt', () => {
  const lower = grid((x, y) => 2 + y * 0.03);
  assert.equal(levelWhereItSlopes(lower, slope, PX, CELL).share, 0);
});

test('a region\'s own survey: picked where the free lidar is missing or coarse, not over fine free lidar', () => {
  const h = new Float32Array(64 * 64).map((_, i) => 100 + (i % 64) * 0.5);
  assert.deepEqual(recommendSource({ standard: { h, res: 30 }, usgs: { h, res: 1 } }, 64, 8), { pick: 'usgs', why: 'finest' });
  assert.equal(recommendSource({ standard: { h, res: 30 }, mapterhorn: { h, res: 10 }, kron86: { h, res: 1 } }, 64, 8).pick, 'kron86');
  assert.equal(recommendSource({ standard: { h, res: 30 }, mapterhorn: { h, res: 1 }, usgs: { h, res: 1 } }, 64, 8).pick, 'mapterhorn');
});
