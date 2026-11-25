import test from 'node:test';
import assert from 'node:assert/strict';
import { placementShift, placementShiftAt, laneCounts } from '../services/lanePlacement.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('no placement: the line is the middle (no shift)', () => {
  assert.equal(placementShift({ highway: 'primary', lanes: '2' }, { half: 3.5 }), null);
  assert.equal(placementShift({ highway: 'primary', oneway: 'yes', lanes: '2', placement: 'right_of:1' }, { half: 3.5 }), null, 'right_of:1 of 2 lanes is the middle');
  assert.equal(placementShift({ highway: 'primary', oneway: 'yes', placement: 'transition' }, { half: 3.5 }), null, 'transition: no fixed place');
});

test('one-way: a left-turn lane added beside the line, a right-turn lane, the line on a lane', () => {
  // 3 lanes, 9.75 m (3.25 each); the line between lanes 2 and 3: the road reaches one lane further left
  near(placementShift({ oneway: 'yes', lanes: '3', placement: 'right_of:2' }, { half: 4.875 }).start, 3.25 / 2, 'left lane added');
  near(placementShift({ oneway: 'yes', lanes: '3', placement: 'right_of:1' }, { half: 4.875 }).start, -3.25 / 2, 'right lane added');
  near(placementShift({ oneway: 'yes', lanes: '2', placement: 'middle_of:1' }, { half: 3.5 }).start, -1.75, 'on the left lane: the road to its right');
  near(placementShift({ oneway: 'yes', lanes: '2', placement: 'middle_of:2' }, { half: 3.5 }).start, 1.75, 'on the right lane');
  // left-hand traffic counts the same way (along the way, from its left)
  near(placementShift({ oneway: 'yes', lanes: '3', placement: 'right_of:2' }, { half: 4.875, leftHand: true }).start, 3.25 / 2, 'left-hand traffic');
});

test('two-way: placement:forward and placement:backward, right- and left-hand traffic', () => {
  const t = { lanes: '3', 'lanes:forward': '2', 'lanes:backward': '1' };
  // the line on the divider (left of forward lane 1): two forward lanes to its right, one backward to its left
  near(placementShift({ ...t, 'placement:forward': 'left_of:1' }, { half: 4.875 }).start, -3.25 / 2, 'forward=left_of:1');
  near(placementShift({ ...t, 'placement:backward': 'left_of:1' }, { half: 4.875 }).start, -3.25 / 2, 'backward=left_of:1 is the same line');
  // left-hand traffic: the forward lanes on the left
  near(placementShift({ ...t, 'placement:forward': 'right_of:2' }, { half: 4.875, leftHand: true }).start, 3.25 / 2, 'left-hand: forward=right_of:2');
  assert.deepEqual(laneCounts({ lanes: '4' }), { oneway: false, forward: 2, backward: 2, total: 4 });
});

test('start and end: the line moving across the lanes along the way', () => {
  const s = placementShift({ oneway: 'yes', lanes: '2', 'placement:start': 'middle_of:1', 'placement:end': 'middle_of:2' }, { half: 3.5 });
  near(s.start, -1.75, 'start'); near(s.end, 1.75, 'end'); near(placementShiftAt(s, 0.5), 0, 'half way');
  // a lane number past the road's lanes is a slip: ignored
  assert.equal(placementShift({ oneway: 'yes', lanes: '2', placement: 'middle_of:5' }, { half: 3.5 }), null);
});

test('a tagged width with its lanes counted is not held to the class cap: a bus stop lane widens the road on one side', async () => {
  const { estimateRoadCrossSection } = await import('../services/roadWidth.js');
  const t6 = { highway: 'primary', lanes: '6', 'lanes:forward': '3', 'lanes:backward': '3', width: '24', 'placement:backward': 'middle_of:1' };
  const t7 = { ...t6, lanes: '7', 'lanes:forward': '4', width: '28' };
  const c6 = estimateRoadCrossSection(t6, 'primary', false, { urban: true });
  const c7 = estimateRoadCrossSection(t7, 'primary', false, { urban: true });
  near(c6.drivingHalfWidth, 12, 'six lanes, 24 m'); near(c7.drivingHalfWidth, 14, 'seven lanes, 28 m');
  const s6 = placementShift(t6, { half: c6.drivingHalfWidth }).start; const s7 = placementShift(t7, { half: c7.drivingHalfWidth }).start;
  // the left (backward) edge stays where it was; the seventh lane goes on the right
  near(s6 + c6.drivingHalfWidth, s7 + c7.drivingHalfWidth, 'left edge kept');
  near((s6 - c6.drivingHalfWidth) - (s7 - c7.drivingHalfWidth), 4, 'right edge out by a lane');
});

test('signal poles: the clear-spot check sees a placed road where it is drawn', async () => {
  const { makeRoadClearance } = await import('../services/beamngSignals.js');
  const K = 1 / 111320;
  const projector = { project: (p) => [p.lng / K, p.lat / K], unproject: (x, y) => ({ lat: y * K, lng: x * K }) };
  // a one-way three-lane road along x = 0 northward, width 12, mapped along its left edge: drawn from x 0 to 12
  const road = { tags: { highway: 'secondary', oneway: 'yes', lanes: '3', width: '12', placement: 'left_of:1' }, geometry: [{ lat: -50 * K, lng: 0 }, { lat: 50 * K, lng: 0 }] };
  const isClear = makeRoadClearance([road], projector);
  assert.equal(isClear(9, 0), false, 'inside the drawn road');
  assert.equal(isClear(-4, 0), true, 'west of its line is clear');
});

test('per-lane widths (width:lanes): the road their sum, the line placed in metres, the lines at their widths', async () => {
  const { estimateRoadCrossSection } = await import('../services/roadWidth.js');
  const { laneWidthsAcross } = await import('../services/lanePlacement.js');
  // thecoachtoma's Savanoriu pr. pieces: 4 backward + 3 forward lanes, the line in the middle of backward lane 2
  const base = { highway: 'primary', lanes: '7', 'lanes:backward': '4', 'lanes:forward': '3', 'placement:backward': 'middle_of:2', 'width:lanes:forward': '3.9|3.6|4' };
  const a = { ...base, 'width:lanes:backward': '3.6|3.6|4|3.6' };
  const b = { ...base, 'width:lanes:backward': '2|3.6|4|3.6' };
  const across = laneWidthsAcross(a);
  assert.deepEqual(across.map((l) => `${l.dir}${l.idx}:${l.w}`), ['b4:3.6', 'b3:4', 'b2:3.6', 'b1:3.6', 'f1:3.9', 'f2:3.6', 'f3:4'], 'left to right, backward lane 1 by the divider');
  const ca = estimateRoadCrossSection(a, 'primary', false, { urban: true }); const cb = estimateRoadCrossSection(b, 'primary', false, { urban: true });
  near(2 * ca.drivingHalfWidth, 26.3, 'width: the lanes summed'); near(2 * cb.drivingHalfWidth, 24.7, 'the narrow turn lane too');
  const sa = placementShift(a, { half: ca.drivingHalfWidth }).start; const sb = placementShift(b, { half: cb.drivingHalfWidth }).start;
  near(sa, -3.75, 'piece a'); near(sb, -2.95, 'piece b');
  // the left (backward) edge 9.4 m from the line on both: the narrower turn lane takes in the right side
  near(sa + ca.drivingHalfWidth, 9.4, 'left edge a'); near(sb + cb.drivingHalfWidth, 9.4, 'left edge b');
  // a count that does not match the lanes: ignored
  assert.equal(laneWidthsAcross({ ...a, 'width:lanes:forward': '3.9|3.6' }), null);
});

test('lane lines at the mapped lane widths', async () => {
  const { buildLineMarkingLayers } = await import('../services/exportBeamNGLevel.js');
  // a one-way road, lanes 2 m and 4 m from its left: the dashed line between them a third of the way from the left edge
  // line, two thirds from the right one
  const layers = buildLineMarkingLayers('primary', { oneway: 'yes', lanes: '2', 'width:lanes': '2|4' }, 3, { style: 'white' });
  const sep = layers.find((l) => l.name === 'line_sep_1');
  const edge = layers.reduce((m, l) => Math.max(m, Math.abs(l.offset)), 0) || 3;
  // (offsets are left of the way positive: counted from the right edge, the 4 m lane comes first)
  const want = -edge + 2 * edge * (4 / 6);
  assert.ok(Math.abs(sep.offset - want) < 1e-9, `separator at ${sep.offset}, want ${want}`);
});

test('lane line shares: the mapped widths from the right edge', async () => {
  const { laneLineShares } = await import('../services/exportBeamNGLevel.js');
  const sh = laneLineShares({ oneway: 'yes', lanes: '2', 'width:lanes': '2|4' }, { oneWay: true, lanes: 2, nF: 2, nB: 0 });
  near(sh[1], 4 / 6, 'the 4 m right lane first'); near(sh[2], 1, 'all of it');
  assert.equal(laneLineShares({ oneway: 'yes', lanes: '2' }, { oneWay: true, lanes: 2, nF: 2, nB: 0 }), null);
});
