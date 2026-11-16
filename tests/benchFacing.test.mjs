import test from 'node:test';
import assert from 'node:assert/strict';
import { benchFacing, boxed, directionYaw } from '../services/benchFacing.js';

const deg = (r) => Math.round((((r * 180) / Math.PI) % 360 + 360) % 360);
const river = [boxed([[-100, 20], [100, 20]])];          // a shore along y = 20, the water north of it
const walk = [boxed([[-100, 10], [100, 10]])];           // a riverside walk
const street = [boxed([[-100, -40], [100, -40]])];

test('direction=* wins: degrees from north and compass points', () => {
  assert.equal(deg(directionYaw('90')), 0);       // east
  assert.equal(deg(directionYaw('N')), 90);
  assert.equal(deg(directionYaw('sw')), 225);
  assert.equal(directionYaw('forward'), null);
  assert.equal(deg(benchFacing(0, 0, { direction: '180' }, { water: river, ways: walk })), 270);
});

test('a bench on a riverside walk looks over the water, whichever side of the path it stands', () => {
  assert.equal(deg(benchFacing(0, 12, {}, { water: river, ways: [...walk, ...street] })), 90);   // between path and water
  assert.equal(deg(benchFacing(0, 8, {}, { water: river, ways: [...walk, ...street] })), 90);    // behind the path
});

test('no water near: it looks at the way it stands beside', () => {
  assert.equal(deg(benchFacing(0, -37, {}, { water: river, ways: [...walk, ...street] })), 270);   // 3 m north of the street
  assert.equal(deg(benchFacing(5, -43, {}, { ways: street })), 90);
});

test('nothing within reach: no opinion', () => {
  assert.equal(benchFacing(0, -200, {}, { water: river, ways: street }), null);
});
