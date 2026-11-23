// levelTunnelPlan.js: a long tunnel's line worked out once for a chunked level.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planLevelTunnels } from '../services/levelTunnelPlan.js';
import { metresPerDegree } from '../services/mapFrame.js';

const center = { lat: 46.5, lng: 8.0 }; const k = metresPerDegree(center.lat);
const at = (x, y) => ({ lat: center.lat + y / k.lat, lng: center.lng + x / k.lng });
const way = (pts, tags = { tunnel: 'yes', highway: 'primary' }, type = 'road') => ({ type, tags, geometry: pts.map(([x, y]) => at(x, y)) });
// the ground: 1000 m at the west portal, 1060 m at the east one, a mountain of 1800 m between
const groundAt = (lat, lng) => { const x = (lng - center.lng) * k.lng; return Math.abs(x) > 1400 ? (x < 0 ? 1000 : 1060) : 1800; };

test('a tunnel of several ways is one line from portal to portal, at the straight grade between them', () => {
  const plan = planLevelTunnels([way([[-1500, 0], [-500, 0]]), way([[500, 0], [-500, 0]]), way([[500, 0], [1500, 0]]), way([[-1500, 50], [1500, 50]], { highway: 'primary' })], { center, groundAt });
  assert.equal(plan.tunnels.length, 1);
  assert.ok(Math.abs(plan.tunnels[0].length - 3000) < 0.01);
  const mid = at(0, 0); const quarter = at(-750, 1);
  assert.ok(Math.abs(plan.zAt(mid.lat, mid.lng) - 1030) < 0.05, 'the middle, under 770 m of mountain: on the line, not near the surface');
  assert.ok(Math.abs(plan.zAt(quarter.lat, quarter.lng) - 1015) < 0.05);
  // beside the tunnel (the open road 50 m north), or nowhere near: no plan
  const beside = at(0, 50); assert.equal(plan.zAt(beside.lat, beside.lng), null);
});

test('a tunnel cut at the level’s edge, a bridge, a short stub and another layer are left to the chunks', () => {
  const inLevel = (lat, lng) => Math.abs((lng - center.lng) * k.lng) < 1450;
  const cut = planLevelTunnels([way([[-1500, 0], [1500, 0]])], { center, groundAt, inLevel });
  assert.equal(cut.tunnels.length, 0);
  const none = planLevelTunnels([way([[-100, 0], [100, 0]], { tunnel: 'yes', bridge: 'yes' }), way([[-100, 9], [100, 9]], { tunnel: 'building_passage' }), way([[0, 20], [30, 20]])], { center, groundAt, minLength: 100 });
  assert.equal(none.tunnels.length, 0);
  // two tunnels on different layers meeting end to end are two lines; a road and a railway never chain
  const two = planLevelTunnels([way([[-1500, 0], [0, 0]], { tunnel: 'yes', layer: '-1' }), way([[0, 0], [1500, 0]], { tunnel: 'yes', layer: '-2' }), way([[-1500, 90], [1500, 90]], { tunnel: 'yes', railway: 'rail' }, 'railway')], { center, groundAt });
  assert.equal(two.tunnels.length, 3);
});
