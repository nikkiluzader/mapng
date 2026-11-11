// Road widths from the bench the survey holds (services/benchWidths.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { measureBenchWidths } from '../services/benchWidths.js';

// a 400 m square at 1 m: a hillside falling east at 60 %, a level bench
// `benchM` wide cut into it along x = 0 (running north-south)
const N = 400;
const bounds = { north: 0.0018, south: -0.0018, west: -0.0018, east: 0.0018 };
const mPerDegLat = (bounds.north - bounds.south) / N;
const hillside = (benchM, slope = 0.6) => {
  const hm = new Float32Array(N * N);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const x = c - N / 2;
    const out = Math.abs(x) - benchM / 2;
    hm[r * N + c] = 500 + (out > 0 ? -Math.sign(x) * slope * out : 0);
  }
  return hm;
};
const way = (id, y0, y1, tags = {}) => ({
  type: 'road', id, tags: { highway: 'residential', name: 'Montée', ...tags },
  geometry: Array.from({ length: 9 }, (_, i) => ({ lat: (y0 + ((y1 - y0) * i) / 8) * mPerDegLat, lng: 0 })),
});
const widthOf = (f) => Number(f.tags['mapng:carriageway_width']);

test('a hillside lane with no width in the map is drawn at its bench\'s width', () => {
  const { features, stats } = measureBenchWidths(hillside(4), N, N, bounds, [way(1, -150, 150)], 1);
  assert.equal(stats.measured, 1);
  assert.ok(Math.abs(widthOf(features[0]) - 4) <= 1, `4 m bench measured ${features[0].tags['mapng:carriageway_width']}`);
  assert.equal(features[0].tags.sidewalk, 'no', 'no room for a sidewalk beside the bench');
});

test('never wider than the default, and nothing on flat ground, tagged widths or coarse grids', () => {
  // (a 14 m bench: wider than a lane's default, left alone)
  assert.equal(measureBenchWidths(hillside(14), N, N, bounds, [way(1, -150, 150)], 1).stats.measured, 0);
  // (flat country: no bench to find; the field beside the road is not road)
  assert.equal(measureBenchWidths(hillside(4, 0), N, N, bounds, [way(1, -150, 150)], 1).stats.measured, 0);
  // (the map's own width or lane count stands)
  for (const tags of [{ lanes: '2' }, { width: '6' }]) {
    const r = measureBenchWidths(hillside(4), N, N, bounds, [way(1, -150, 150, tags)], 1);
    assert.equal(r.stats.measured, 0); assert.equal(r.features[0].tags['mapng:carriageway_width'], undefined);
  }
  // (a 10 m grid shows no bench)
  assert.equal(measureBenchWidths(hillside(4), N, N, bounds, [way(1, -150, 150)], 10).stats.measured, 0);
  // (a bridge is no bench)
  assert.equal(measureBenchWidths(hillside(4), N, N, bounds, [way(1, -150, 150, { bridge: 'yes' })], 1).stats.measured, 0);
});

test('one width for the whole road: a short piece takes its road\'s', () => {
  // the same road cut in two at y = 100; the 16 m piece is too short to measure alone
  const { features, stats } = measureBenchWidths(hillside(4), N, N, bounds, [way(1, -150, 100), way(2, 100, 116)], 1);
  assert.equal(stats.measured, 2);
  assert.equal(features[0].tags['mapng:carriageway_width'], features[1].tags['mapng:carriageway_width']);
  // another road of another name touching it keeps its own
  const other = measureBenchWidths(hillside(4), N, N, bounds, [way(1, -150, 100), way(2, 100, 116, { name: 'Autre' })], 1);
  assert.equal(other.features[1].tags['mapng:carriageway_width'], undefined);
});
