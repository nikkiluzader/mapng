import test from 'node:test';
import assert from 'node:assert/strict';
import { planGates, gateLeaves, splitAtCuts, wallOpenings, clearOf, GATE_SHAPES, isGateBarrier } from '../services/gates.js';
import { OSM_FILTER, GATE_BARRIERS } from '../services/overpassQuery.js';

const fence = (tags = {}) => ({ pts: [[-50, 0], [50, 0]], tags: { barrier: 'fence', ...tags } });
const road = (highway = 'service', half = 2.5) => ({ pts: [[0, -40], [0, 40]], half, highway });

test('gates are asked of OSM as nodes', () => {
  for (const v of GATE_BARRIERS) assert.ok(OSM_FILTER.nodeTags.some(([k, t]) => k === 'barrier' && t === v), v);
  assert.ok(isGateBarrier({ barrier: 'lift_gate' }));
  assert.ok(!isGateBarrier({ barrier: 'bollard' }));
});

test('a mapped gate on a road opens the fence to the road and a little', () => {
  const { cuts, gates } = planGates({ barriers: [fence()], ways: [road()], nodes: [{ x: 0, y: 0, tags: { barrier: 'gate' } }] });
  assert.equal(gates.length, 1);
  assert.equal(gates[0].walk, false);
  assert.equal(gates[0].width, 6.2);
  assert.deepEqual(cuts[0].map((c) => c.map((v) => +v.toFixed(1))), [[46.9, 53.1]]);
});

test('a gate on a footway, or on a fence with no road, is for walking', () => {
  const path = planGates({ barriers: [fence()], ways: [road('footway', 0.9)], nodes: [{ x: 0, y: 0, tags: { barrier: 'gate' } }] });
  assert.equal(path.gates[0].walk, true);
  assert.equal(path.gates[0].style, 'wood');
  assert.ok(path.gates[0].width < 2.5);
  const bare = planGates({ barriers: [fence()], nodes: [{ x: 10, y: 0, tags: { barrier: 'gate' } }] });
  assert.equal(bare.gates[0].walk, true);
  assert.equal(bare.gates[0].width, 1.2);
});

test('a wide or vehicle-tagged gate with no road mapped opens for cars', () => {
  const { gates } = planGates({ barriers: [fence()], nodes: [{ x: 10, y: 0, tags: { barrier: 'gate', motor_vehicle: 'yes' } }] });
  assert.equal(gates[0].walk, false);
  assert.equal(gates[0].width, 4);
});

test('a walkers\' gate stays narrow on a road', () => {
  const { gates } = planGates({ barriers: [fence()], ways: [road()], nodes: [{ x: 0, y: 0, tags: { barrier: 'kissing_gate' } }] });
  assert.equal(gates[0].walk, true);
  assert.equal(gates[0].width, 1.2);
});

test('a road through a fence with no gate mapped: a gate on a service road, a gap on a through road', () => {
  assert.equal(planGates({ barriers: [fence()], ways: [road()] }).gates[0].style, 'farm');
  const street = planGates({ barriers: [fence()], ways: [road('residential', 3)] });
  assert.equal(street.gates[0].style, 'gap');
  assert.equal(street.cuts[0].length, 1);
});

test('a road and its pavement through a fence are one opening', () => {
  const { gates, cuts } = planGates({ barriers: [fence()], ways: [{ pts: [[3, -40], [3, 40]], half: 0.9, highway: 'footway' }, road()] });
  assert.equal(gates.length, 1);
  assert.equal(cuts[0].length, 1);
  assert.equal(gates[0].walk, false);
});

test('guard rails and retaining walls take no gate', () => {
  const { gates } = planGates({ barriers: [fence({ barrier: 'guard_rail' }), fence({ barrier: 'retaining_wall' })], ways: [road()] });
  assert.equal(gates.length, 0);
});

test('a gate drawn as a way is a gate, not a length of fence', () => {
  const { gates, lines, cuts } = planGates({ barriers: [{ pts: [[-2, 0], [2, 0]], tags: { barrier: 'gate' } }, { pts: [[2, 0], [40, 0]], tags: { barrier: 'fence' } }], ways: [road()] });
  assert.ok(lines.has(0));
  assert.equal(gates.length, 1);
  assert.deepEqual(cuts[1], []);
});

test('a gate on a road with no fence stands across it', () => {
  const { gates } = planGates({ ways: [road()], nodes: [{ x: 0, y: 5, tags: { barrier: 'swing_gate' } }] });
  assert.deepEqual(gates[0].along.map(Math.abs), [1, 0]);
});

test('every kind of mapped gate takes its own kind of leaf', () => {
  const style = (barrier, line = {}) => planGates({ barriers: [{ ...fence(), ...line }], ways: [road()], nodes: [{ x: 0, y: 0, tags: { barrier } }] }).gates[0].style;
  assert.equal(style('lift_gate'), 'boom');
  assert.equal(style('sliding_gate'), 'sliding');
  assert.equal(style('cattle_grid'), 'gap');
  assert.equal(style('entrance'), 'gap');
  assert.equal(style('gate', { chainLink: true }), 'mesh');
  assert.equal(style('gate', { tags: { barrier: 'wall' } }), 'mesh');
});

test('swung leaves stand clear of the way between the jambs', () => {
  const gate = { x: 0, y: 0, along: [1, 0], width: 7, style: 'farm' };
  const leaves = gateLeaves(gate);
  assert.equal(leaves.length, 2);
  for (const l of leaves) {
    assert.ok(Math.abs(l.tip[0]) >= 3.5, 'tip beside the road');
    assert.ok(Math.abs(l.tip[1]) > 3, 'tip swung back');
    assert.ok(Math.abs(l.x) >= 3.5, 'leaf beside the road');
  }
});

test('a leaf with something behind it swings the other way', () => {
  const leaves = gateLeaves({ x: 0, y: 0, along: [1, 0], width: 3.4, style: 'farm' }, (x, y) => y < 0.1);
  assert.equal(leaves.length, 1);
  assert.ok(leaves[0].tip[1] < 0);
});

test('a leaf with no room either way lies back along the fence; none at all, no leaf', () => {
  const folded = gateLeaves({ x: 0, y: 0, along: [1, 0], width: 1.2, style: 'wood', walk: true }, (x, y) => Math.abs(y) < 0.1);
  assert.equal(folded.length, 1);
  assert.ok(Math.abs(folded[0].tip[1]) < 0.1);
  assert.equal(gateLeaves({ x: 0, y: 0, along: [1, 0], width: 1.2, style: 'wood', walk: true }, () => false).length, 0);
});

test('a gap has no leaf; a sliding gate parks past the opening; a boom stands at the jamb', () => {
  assert.equal(gateLeaves({ x: 0, y: 0, along: [1, 0], width: 7, style: 'gap' }).length, 0);
  const [slide] = gateLeaves({ x: 0, y: 0, along: [1, 0], width: 7, style: 'sliding' });
  assert.equal(slide.x, -3.5);
  assert.equal(slide.shapeName, GATE_SHAPES.sliding.shapeName);
  const [boom] = gateLeaves({ x: 0, y: 0, along: [1, 0], width: 7, style: 'boom' });
  assert.equal(boom.shapeName, GATE_SHAPES.boomLong.shapeName);
});

test('a line splits at its cuts with the points between', () => {
  const geo = [{ a: 0 }, { a: 50 }, { a: 100 }];
  const pieces = splitAtCuts(geo, [[0, 0], [50, 0], [100, 0]], [[20, 30], [70, 80]], (p, q, u) => ({ a: p.a + (q.a - p.a) * u }));
  assert.deepEqual(pieces.map((p) => p.map((q) => q.a)), [[0, 20], [30, 50, 70], [80, 100]]);
  assert.deepEqual(splitAtCuts(geo, [[0, 0], [50, 0], [100, 0]], [[-3, 3]], (p, q, u) => ({ a: p.a + (q.a - p.a) * u })).map((p) => p[0].a), [3]);
});

test('a generated wall opens for a road through it or stopping at it, and only there', () => {
  const wall = [[-50, 0], [50, 0]];
  assert.equal(wallOpenings(wall, [road()]).length, 1);
  assert.equal(wallOpenings(wall, [{ pts: [[0, -30], [0, -1]], half: 2.5, highway: 'service' }]).length, 1, 'stops short of it');
  assert.equal(wallOpenings(wall, [{ pts: [[0, -30], [0, -8]], half: 2.5, highway: 'service' }]).length, 0);
  assert.equal(wallOpenings(wall, [road('footway', 0.9)]).length, 0);
  assert.deepEqual(clearOf([-10, 0], [10, 0], [{ x: 0, y: 0, width: 6 }]), [[0, 0.35], [0.65, 1]]);
});
