import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRoadSignProps, parseSignedSpeed } from '../services/roadSigns.js';

// ~1.1 km box centred on junction J (the world origin).
const J = 0.005;
const M = 1 / 111320;
const SQ = (0.01 * 111320) / 64;
const makeTerrainData = (osmFeatures, roadRules = {}) => ({
  width: 64, height: 64, minHeight: 0, maxHeight: 50,
  heightMap: new Float32Array(64 * 64).fill(10),
  bounds: { north: 0.01, south: 0, west: 0, east: 0.01 },
  osmFeatures,
  roadRules,
});
const road = (id, tags, coords) => ({ id, type: 'road', tags, geometry: coords.map(([lat, lng]) => ({ lat, lng })) });
const node = (id, tags, lat, lng) => ({ id, type: 'street_furniture', tags, geometry: [{ lat, lng }] });
const crossroads = (ns, ew) => [
  road('ns', ns, [[0.009, J], [J, J], [0.001, J]]),
  road('ew', ew, [[J, 0.001], [J, J], [J, 0.009]]),
];
// Sign faces local −Y: world facing (sin yaw, −cos yaw).
const facing = (sign) => [Math.sin(sign.yaw), -Math.cos(sign.yaw)];
const signs = (features, style, rules) => buildRoadSignProps(makeTerrainData(features, rules), SQ, { style }).props;

test('stop=all: a stop sign per approach, on its kerb, facing its traffic', () => {
  const props = signs([...crossroads({ highway: 'residential' }, { highway: 'residential' }), node('s', { highway: 'stop', stop: 'all' }, J, J)], 'americas');
  const stops = props.filter((p) => p.kind === 'stop');
  assert.equal(stops.length, 4);
  for (const sign of stops) {
    const [x, y] = sign.position;
    const toJunction = [-x, -y];
    const f = facing(sign);
    // Facing away from the junction = toward traffic arriving at it.
    assert.ok(f[0] * toJunction[0] + f[1] * toJunction[1] < 0, `stop sign at (${x.toFixed(1)}, ${y.toFixed(1)}) faces its traffic`);
  }
  // Northbound approach (south arm): right-hand kerb = east.
  const south = stops.find((s) => s.position[1] < -5);
  assert.ok(south.position[0] > 0);
  assert.equal(south.provenance, 'derived');
  assert.match(south.shape, /east_coast_usa.*sign_stop\.dae$/);
});

test('left-hand traffic puts signs on the left kerb', () => {
  const props = signs([...crossroads({ highway: 'residential' }, { highway: 'residential' }), node('s', { highway: 'stop', stop: 'all' }, J, J)],
    'white', { leftHandTraffic: true });
  const south = props.find((s) => s.kind === 'stop' && s.position[1] < -5);
  assert.ok(south.position[0] < 0);
  assert.match(south.shape, /italy_traf_sign_stop\.dae$/);
});

test('mapped give-way and stop signs keep their approach and provenance', () => {
  const props = signs([
    road('main', { highway: 'secondary' }, [[J, 0.001], [J, J], [J, 0.009]]),
    road('side', { highway: 'residential' }, [[0.009, J], [J + 12 * M, J], [J, J]]),
    node('gw', { highway: 'give_way' }, J + 12 * M, J),
  ], 'americas');
  assert.equal(props.length, 1);
  assert.equal(props[0].kind, 'give_way');
  assert.equal(props[0].provenance, 'osm');
  assert.ok(props[0].position[0] < 0, 'southbound traffic: west kerb');
});

test('derived give-way / priority only in Vienna-convention countries', () => {
  const features = crossroads({ highway: 'residential' }, { highway: 'secondary' });
  assert.equal(signs(features, 'americas').length, 0, 'US: nothing derived');
  const eu = signs(features, 'white');
  assert.equal(eu.filter((s) => s.kind === 'give_way').length, 2, 'both residential approaches');
  assert.equal(eu.filter((s) => s.kind === 'priority_road').length, 2, 'both secondary approaches');
  assert.ok(eu.every((s) => s.provenance === 'derived'));
});

test('speed limit signs where a mapped limit changes, and only with a mesh for it', () => {
  const ways = (a, b) => [
    road('slow', { highway: 'primary', maxspeed: a }, [[J, 0.001], [J, J]]),
    road('fast', { highway: 'primary', maxspeed: b }, [[J, J], [J, 0.009]]),
  ];
  const eu = signs(ways('50', '80'), 'white').filter((s) => s.kind === 'speed');
  assert.equal(eu.length, 2, 'one per direction entering a new limit');
  assert.ok(eu.some((s) => /speed_80/.test(s.shape)) && eu.some((s) => /speed_50/.test(s.shape)));
  assert.equal(signs(ways('50', '50'), 'white').filter((s) => s.kind === 'speed').length, 0, 'no change, no sign');
  const us = signs(ways('30 mph', '40 mph'), 'americas').filter((s) => s.kind === 'speed');
  assert.equal(us.length, 2, '30 mph (Utah) and 40 mph (East Coast USA) both have a US mesh');
  assert.ok(us.some((s) => /ut_30_speed_limit/.test(s.shape)) && us.some((s) => /sign_speedlimit_40/.test(s.shape)));
  assert.equal(signs(ways('35 mph', '40 mph'), 'americas').filter((s) => s.kind === 'speed').length, 1, 'no stock 35 mph sign: only the 40');
});

test('one way and no entry signs (Vienna convention), not on service roads', () => {
  const features = [
    road('main', { highway: 'secondary' }, [[J, 0.001], [J, J], [J, 0.009]]),
    road('one', { highway: 'residential', oneway: 'yes' }, [[J, J], [J - 0.001, J], [0.002, J], [0.001, J]]),
    road('main2', { highway: 'secondary' }, [[0.001, 0.001], [0.001, J], [0.001, 0.009]]),
  ];
  const eu = signs(features, 'white');
  assert.equal(eu.filter((s) => s.kind === 'one_way').length, 1);
  assert.equal(eu.filter((s) => s.kind === 'no_entry').length, 1);
  const service = signs([...features.slice(0, 1), road('lot', { highway: 'service', oneway: 'yes' }, [[J, J], [0.002, J]])], 'white');
  assert.equal(service.filter((s) => s.kind === 'one_way' || s.kind === 'no_entry').length, 0);
});

test('roundabout entries give way', () => {
  const r = 30 * M;
  const ring = road('ring', { highway: 'primary', junction: 'roundabout' },
    [[J, J + r], [J + r, J], [J, J - r], [J - r, J], [J, J + r]]);
  const props = signs([ring, road('in', { highway: 'secondary' }, [[J, 0.009], [J, J + r]])], 'white');
  assert.equal(props.filter((s) => s.kind === 'give_way').length, 1);
  assert.equal(props.filter((s) => s.kind === 'roundabout').length, 1);
});

test('parseSignedSpeed keeps the signed unit', () => {
  assert.deepEqual(parseSignedSpeed('35 mph'), { value: 35, unit: 'mph' });
  assert.deepEqual(parseSignedSpeed('50'), { value: 50, unit: 'km/h' });
  assert.deepEqual(parseSignedSpeed('DE:zone30'), { value: 30, unit: 'km/h' });
  assert.equal(parseSignedSpeed('DE:urban'), null);
});
