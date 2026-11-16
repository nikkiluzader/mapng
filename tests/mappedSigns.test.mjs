import test from 'node:test';
import assert from 'node:assert/strict';
import { mappedSignKinds } from '../services/roadSigns.js';
import SIGN_CODES from '../data/traffic-signs.json' with { type: 'json' };

test('a mapped sign\'s value: OSM\'s words, country codes, numbers in brackets or after a dash, several at once', () => {
  const k = (tags) => mappedSignKinds(tags);
  assert.deepEqual(k({ traffic_sign: 'DE:274[50]' }), [{ kind: 'speed', value: 50 }]);
  assert.deepEqual(k({ traffic_sign: 'DE:274-70;DE:276' }), [{ kind: 'speed', value: 70 }, { kind: 'no_overtaking' }]);
  assert.deepEqual(k({ traffic_sign: 'US:R2-1', maxspeed: '35 mph' }), [{ kind: 'speed', value: 35 }]);
  assert.deepEqual(k({ traffic_sign: 'DE:103-10' }), [{ kind: 'hazard:curve_left' }]);
  assert.deepEqual(k({ traffic_sign: 'hazard', hazard: 'slippery' }), [{ kind: 'hazard:slippery' }]);
  assert.deepEqual(k({ traffic_sign: 'US:R1-1' }), [{ kind: 'stop' }]);
  assert.deepEqual(k({ traffic_sign: 'PL:A-7' }), [{ kind: 'give_way' }]);
  // (a place-name or route sign, and an unknown code: nothing)
  assert.deepEqual(k({ traffic_sign: 'city_limit' }), []);
  assert.deepEqual(k({ traffic_sign: 'NL:G11' }), []);
  assert.deepEqual(k({ traffic_sign: 'XX:999' }), []);
});

test('every kind a code or word names has a model in at least one sign set', () => {
  const named = new Set([...Object.values(SIGN_CODES.words), ...Object.values(SIGN_CODES.hazard), ...Object.values(SIGN_CODES.codes).flatMap((t) => Object.values(t))].filter(Boolean));
  for (const kind of named) if (kind !== 'speed') assert.ok(SIGN_CODES.kinds[kind] && (SIGN_CODES.kinds[kind].white || SIGN_CODES.kinds[kind].americas), kind);
});
