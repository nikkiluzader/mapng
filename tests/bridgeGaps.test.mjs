import test from 'node:test';
import assert from 'node:assert/strict';

import { bridgeOverShortGaps } from '../services/exportBeamNGLevel.js';

// Ways along a meridian; ~11 m per 0.0001° of latitude.
const way = (id, lat0, lat1, tags = {}) => ({
  id, type: 'road', tags: { highway: 'motorway_link', ...tags },
  geometry: [{ lat: lat0, lng: -76.29 }, { lat: lat1, lng: -76.29 }],
});
const byId = (fs) => Object.fromEntries(fs.map((f) => [f.id, f]));

test('a short untagged way between two bridges becomes bridge', () => {
  const out = byId(bridgeOverShortGaps([
    way('a', 36.8000, 36.8002, { bridge: 'yes', layer: '1' }),
    way('gap', 36.8002, 36.8004),
    way('b', 36.8004, 36.8006, { bridge: 'yes', layer: '2' }),
  ]));
  assert.equal(out.gap.tags.bridge, 'yes');
  assert.equal(out.gap.tags.layer, '2');
});

test('gaps that are long, joined by another road, or not bridge-bounded stay on the ground', () => {
  const long = byId(bridgeOverShortGaps([
    way('a', 36.8000, 36.8002, { bridge: 'yes' }), way('gap', 36.8002, 36.8010), way('b', 36.8010, 36.8012, { bridge: 'yes' }),
  ]));
  assert.equal(long.gap.tags.bridge, undefined);
  const joined = byId(bridgeOverShortGaps([
    way('a', 36.8000, 36.8002, { bridge: 'yes' }), way('gap', 36.8002, 36.8004), way('b', 36.8004, 36.8006, { bridge: 'yes' }),
    { ...way('ramp', 36.8004, 36.8004), geometry: [{ lat: 36.8004, lng: -76.29 }, { lat: 36.8004, lng: -76.2895 }] },
  ]));
  assert.equal(joined.gap.tags.bridge, undefined);
  const oneSide = byId(bridgeOverShortGaps([way('a', 36.8000, 36.8002, { bridge: 'yes' }), way('gap', 36.8002, 36.8004)]));
  assert.equal(oneSide.gap.tags.bridge, undefined);
});
