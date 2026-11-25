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
