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
