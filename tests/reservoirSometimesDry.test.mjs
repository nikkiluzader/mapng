// A reservoir mapped as sometimes dry (intermittent=yes) that the elevation data shows full (services/beamngWater.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { planLakes, planRivers } from '../services/beamngWater.js';

const toWorld = (lat, lng) => [lng * 1e5, lat * 1e5];
const ll = (x, y) => ({ lat: y / 1e5, lng: x / 1e5 });
const ring = (pts) => [...pts, pts[0]].map(([x, y]) => ll(x, y));
const lake = (tags) => ({ type: 'water', tags: { natural: 'water', water: 'reservoir', ...tags }, geometry: ring([[-200, -100], [200, -100], [200, 100], [-200, 100]]) });
const dam = { type: 'water', tags: { waterway: 'dam' }, geometry: [ll(205, -100), ll(205, 100)] };
const river = { type: 'water', tags: { waterway: 'river' }, geometry: [ll(-400, 0), ll(-100, 0), ll(100, 0), ll(400, 0)] };
// water in the data: level inside the outline, a little higher in one half (two survey sheets)
const full = (x, y) => (Math.abs(x) <= 200 && Math.abs(y) <= 100 ? (x > 50 ? 31.9 : 30) : 40);
const emptied = (x, y) => (Math.abs(x) <= 200 && Math.abs(y) <= 100 ? 40 - 25 * (1 - Math.abs(y) / 100) : 40);

test('behind a dam and level in the data: built as a lake, and the river does not run through it as a ribbon', () => {
  const feats = [lake({ intermittent: 'yes' }), dam, river];
  const lakes = planLakes({ features: feats, toWorld, heightAt: full });
  assert.equal(lakes.lakes.length, 1);
  assert.equal(lakes.stats.fullBehindDam, 1);
  assert.ok(lakes.tiles.length >= 1);
  assert.ok(planRivers({ features: feats, toWorld, heightAt: full }).stats.nodesInAreaWater >= 1);
});

test('no dam, or a bed with relief (surveyed empty): it stays dry, as before', () => {
  assert.equal(planLakes({ features: [lake({ intermittent: 'yes' }), river], toWorld, heightAt: full }).lakes.length, 0);
  assert.equal(planLakes({ features: [lake({ intermittent: 'yes' }), dam, river], toWorld, heightAt: emptied }).lakes.length, 0);
  // (mapped dry outright: never a lake)
  assert.equal(planLakes({ features: [lake({ intermittent: 'yes', water: 'dry' }), dam], toWorld, heightAt: full }).lakes.length, 0);
  // (an ordinary lake is untouched by any of this)
  assert.equal(planLakes({ features: [lake({})], toWorld, heightAt: full }).lakes.length, 1);
});
