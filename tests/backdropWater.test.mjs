import test from 'node:test';
import assert from 'node:assert/strict';
import { planBackdropWater, backdropHeightSampler, insidePart, EDGE_HANDOVER_M, BACKDROP_CELL_M, BACKDROP_MIN_AREA_M2 } from '../services/backdropWater.js';
import { planLakes } from '../services/beamngWater.js';

// a 1000 m map over lat/lng = metres / 1e5; a lake from inside the map out past its south edge
const ws = 1000;
const bounds = { north: 0.005, south: -0.005, west: -0.005, east: 0.005 };
const ll = (x, y) => ({ lat: y / 1e5, lng: x / 1e5 });
const lakeRing = [[-200, -300], [200, -300], [200, -900], [-200, -900], [-200, -300]].map(([x, y]) => ll(x, y));
const feature = { id: 'l1', type: 'water', tags: { natural: 'water' }, geometry: lakeRing };
const river = { id: 'r1', type: 'water', tags: { waterway: 'river' }, geometry: [ll(400, 0), ll(400, -700)] };

test('water over the backdrop: a lake running off the map continues outside it at the map\'s level, handed over flush; rivers outside', () => {
  // ground: 10 m everywhere, the lake recorded flat at 5 m
  const ground = (x, y) => (Math.abs(x) <= 200 && y <= -300 && y >= -900 ? 5 : 10);
  // the map's own lake (its part inside the map), at level 5.05
  const mapLakes = planLakes({ features: [{ ...feature, geometry: [[-200, -300], [200, -300], [200, -500], [-200, -500], [-200, -300]].map(([x, y]) => ll(x, y)) }], toWorld: (lat, lng) => [lng * 1e5, lat * 1e5], heightAt: ground }).lakes;
  mapLakes[0].level = 4.9;   // (as the map's own data had it)
  const r = planBackdropWater({ features: [feature, river], bounds, worldSize: ws, groundAt: ground, mapLakes });
  assert.ok(r.tiles.length > 0, 'water outside the map');
  assert.ok(r.tiles.every((t) => t.z === 4.9), 'at the map lake\'s level');
  const inner = ws / 2 - EDGE_HANDOVER_M;
  // (the backdrop's tiles are coarse, BACKDROP_CELL_M: past the shore by a cell at most)
  assert.ok(r.tiles.every((t) => Math.abs(t.cx) + t.sx / 2 <= 200.6 + BACKDROP_CELL_M && (t.cy - t.sy / 2 < -inner + 1e-6)), 'only from the handover line outward');
  assert.ok(r.tiles.some((t) => t.cy + t.sy / 2 > -ws / 2 + 1), 'reaching into the map to the handover line');
  assert.equal(r.mapTrim.size, 0, 'the map\'s own blocks stay whole (the two overlap in the strip)');
  // the map's tiles trimmed there
  const kept = insidePart({ cx: 0, cy: -400, sx: 100, sy: 100 }, inner);
  assert.ok(kept && Math.abs(kept.cy - kept.sy / 2 + inner) < 1e-6, 'a map tile across the line keeps its part inside');
  assert.equal(insidePart({ cx: 0, cy: -490, sx: 10, sy: 10 }, inner), null);
  // the river's run outside, with one node inside to meet the map's
  assert.equal(r.rivers.length, 1);
  assert.ok(r.rivers[0].nodes.some((n) => n[1] < -ws / 2) && r.rivers[0].nodes.some((n) => n[1] >= -ws / 2));
});

test('backdrop heights: sampled from the tiles round the map, NaN off them', () => {
  const tile = { pos: 'S', bounds: { north: -0.005, south: -0.015, west: -0.005, east: 0.005 }, width: 2, height: 2, heightMap: new Float32Array([110, 110, 120, 120]) };
  const at = backdropHeightSampler([tile], { bounds, worldSize: ws, minHeight: 100 });
  assert.ok(Math.abs(at(0, -1000) - 15) < 0.6);
  assert.ok(Number.isNaN(at(0, 2000)));
});

test('the backdrop gets few, coarse lake tiles, and no small ponds that lie wholly outside the map', () => {
  const ground = () => 10;
  const sq = (cx, cy, half) => ({ ...feature, id: `${cx}_${cy}`, geometry: [[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half], [cx - half, cy - half]].map(([x, y]) => ll(x, y)) });
  const pond = sq(-1200, -1200, 15);        // 900 m2, out in the backdrop
  const lake = sq(1300, -1200, 150);        // 9 ha, out in the backdrop
  const r = planBackdropWater({ features: [pond, lake], bounds, worldSize: ws, groundAt: ground, mapLakes: [] });
  assert.equal(r.stats.smallLeftOut, 1);
  assert.equal(r.stats.lakes, 1);
  assert.ok(r.tiles.length >= 1 && r.tiles.length <= 4, `${r.tiles.length} tiles for a square lake`);
  assert.ok(BACKDROP_MIN_AREA_M2 > 900 && BACKDROP_MIN_AREA_M2 < 90000);
});
