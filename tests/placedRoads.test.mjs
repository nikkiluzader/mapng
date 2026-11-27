// placedRoads.js: placement=transition ways joined to their neighbours' drawn roads (thecoachtoma, Discord 2026-11-27)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transitionPlans, transitionMoveAt, placeRoadFeatures, isTransition } from '../services/placedRoads.js';
import { placementShift } from '../services/lanePlacement.js';

test('isTransition reads plain and directional placement', () => {
  assert.equal(isTransition({ placement: 'transition' }), true);
  assert.equal(isTransition({ 'placement:forward': 'transition' }), true);
  assert.equal(isTransition({ placement: 'left_of:1' }), false);
});

test('a transition between two placed ways: each end lands where its neighbour is drawn', () => {
  // A: east along y = 0 to x = 50, its carriageway 3.75 m right of the line; T: (50,0) -> (60,4); B: on east from (60,4),
  // its carriageway 1.5 m left of the line
  const ways = [
    { xy: [[0, 0], [50, 0]], shift: { start: -3.75, end: -3.75 }, transition: false, half: 3.75 },
    { xy: [[50, 0], [60, 4]], shift: null, transition: true, half: 1.75 },
    { xy: [[60, 4], [110, 4]], shift: { start: 1.5, end: 1.5 }, transition: false, half: 5 },
  ];
  const plans = transitionPlans(ways);
  const p = plans.get(1);
  assert.deepEqual(p.from, [0, 2]);
  // (A drawn at (50, -3.75); B at (60, 5.5))
  const s = transitionMoveAt(p, 50, 0); const e = transitionMoveAt(p, 60, 4);
  assert.ok(Math.abs(50 + s.dx - 50) < 1e-9 && Math.abs(0 + s.dy + 3.75) < 1e-9, JSON.stringify(s));
  assert.ok(Math.abs(60 + e.dx - 60) < 1e-9 && Math.abs(4 + e.dy - 5.5) < 1e-9, JSON.stringify(e));
  assert.equal(s.half, 3.75); assert.equal(e.half, 5);
  // (half way: blended)
  const m = transitionMoveAt(p, 55, 2); assert.ok(Math.abs(m.dy - (-3.75 + 1.5) / 2) < 1e-9 && Math.abs(m.half - 4.375) < 1e-9);
});

test('placeRoadFeatures on lat/lng: placed ways moved, transitions joined, others untouched', () => {
  const lat = 54.9; const ky = 111320; const kx = ky * Math.cos((lat * Math.PI) / 180);
  const P = (x, y) => ({ lat: lat + y / ky, lng: 23.9 + x / kx });
  const cs = () => ({ drivingHalfWidth: 3.5, carriagewayHalfWidth: 3.5, leftExtra: 0, rightExtra: 0 });
  const A = { id: 'a', type: 'road', tags: { highway: 'primary', oneway: 'yes', lanes: '2', placement: 'left_of:1' }, geometry: [P(0, 0), P(50, 0)] };
  const T = { id: 't', type: 'road', tags: { highway: 'primary', oneway: 'yes', lanes: '1', placement: 'transition' }, geometry: [P(50, 0), P(60, 4)] };
  const B = { id: 'b', type: 'road', tags: { highway: 'primary', oneway: 'yes', lanes: '2' }, geometry: [P(60, 4), P(110, 4)] };
  const C = { id: 'c', type: 'building', tags: {}, geometry: [P(0, 20), P(5, 20), P(5, 25)] };
  const out = placeRoadFeatures([A, T, B, C], { crossSectionOf: cs });
  const sh = placementShift(A.tags, { half: 3.5 }).start;   // (left_of:1 of two lanes: -3.5)
  const xy = (q) => [(q.lng - 23.9) * kx, (q.lat - lat) * ky];
  assert.ok(Math.abs(xy(out[0].geometry[1])[1] - sh) < 1e-6, 'A moved by its shift');
  // (T's start on A's drawn end, its end on B's line: B is not placed)
  assert.ok(Math.abs(xy(out[1].geometry[0])[1] - sh) < 1e-6 && Math.abs(xy(out[1].geometry[1])[1] - 4) < 1e-6);
  assert.deepEqual(out[1].builtHalfWidth, [3.5, 3.5]);
  assert.equal(out[2], B); assert.equal(out[3], C);
});

test('no placement tag anywhere: the same list back', () => {
  const f = [{ id: 1, type: 'road', tags: { highway: 'residential' }, geometry: [{ lat: 1, lng: 1 }, { lat: 1.001, lng: 1 }] }];
  assert.equal(placeRoadFeatures(f, { crossSectionOf: () => ({}) }), f);
});
