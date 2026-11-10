import test from 'node:test';
import assert from 'node:assert/strict';

import { choosePoleType, placeStreetProps, POLE_TYPES, wireLines } from '../services/streetProps.js';
import { buildSidewalkRuns } from '../services/beamngSidewalks.js';

// A straight road along +x at y = y0, nodes every 5 m, at height z.
const road = (owner, { y0 = 0, len = 600, half = 4, highway = 'residential', urban = true, tags = {}, z = 10 } = {}) => ({
  owner,
  wayId: `w${owner}`,
  nodes: Array.from({ length: len / 5 + 1 }, (_, i) => [i * 5, y0, z, half * 2]),
  half,
  highway,
  urban,
  tags,
});

test('town streets: benches on major ones; no hydrants or bins OSM does not map', () => {
  const cws = [road(1, { highway: 'tertiary', tags: { lit: 'yes', sidewalk: 'both' } })];
  const runs = buildSidewalkRuns(cws);
  const { hydrants, bins, benches, poles } = placeStreetProps({ carriageways: cws, runs, heightAt: () => 10 });
  assert.equal(hydrants.length, 0, 'hydrants only where mapped');
  assert.equal(bins.length, 0, 'bins only where mapped');
  assert.ok(benches.length >= 4, `${benches.length} benches`);
  assert.equal(poles.length, 0, 'a lit main street gets lamps, not wooden poles');
});

test('country roads: a wired run of poles off one side', () => {
  const cws = [road(1, { highway: 'tertiary', urban: false, half: 3 })];
  const { poles, wires, hydrants } = placeStreetProps({ carriageways: cws, heightAt: (x) => 20 + x * 0.01 });
  assert.equal(hydrants.length, 0);
  assert.ok(poles.length >= 11 && poles.length <= 14, `${poles.length} poles every 45 m`);
  const ys = new Set(poles.map((p) => Math.sign(p.y)));
  assert.equal(ys.size, 1, 'one side of the road');
  for (const p of poles) assert.ok(Math.abs(Math.abs(p.y) - 5.4) < 1e-6, '2.4 m past the edge');
  assert.ok(poles.every((p) => p.type === poles[0].type), 'one pole type along the run');
  assert.equal(wires.length, (poles.length - 1) * POLE_TYPES[poles[0].type].wires.length, 'a wire per fitting, every span');
  assert.ok(poles.every((p) => !p.lamp), 'no lamps in the country');
});

test('town poles only where asked (North America), with a lamp on every other one', () => {
  const cws = [road(1, { highway: 'residential' })];
  const runs = buildSidewalkRuns(cws);
  assert.equal(placeStreetProps({ carriageways: cws, runs }).poles.length, 0);
  const { poles } = placeStreetProps({ carriageways: cws, runs, townPoles: true });
  assert.ok(poles.length >= 12, `${poles.length} town poles`);
  const lamps = poles.filter((p) => p.lamp).length;
  assert.ok(Math.abs(lamps - poles.length / 2) <= 1, `${lamps} lamps on ${poles.length} poles`);
});

test('a mapped power line gets poles at its vertices and no generated poles beside it', () => {
  const cws = [road(1, { highway: 'tertiary', urban: false, half: 3 })];
  const line = Array.from({ length: 13 }, (_, i) => [i * 50, 6, 20]);
  const { poles, wires } = placeStreetProps({ carriageways: cws, mapped: { powerLines: [line] } });
  assert.equal(poles.length, 13, 'one pole per vertex, none generated along the road');
  assert.equal(wires.length, 12 * POLE_TYPES[poles[0].type].wires.length);
});

test('wires hang from the pole type\'s fittings and sag mid-span', () => {
  const [a, b] = [{ x: 0, y: 0, z: 0, yaw: Math.PI / 2, type: 'wood_short' }, { x: 40, y: 0, z: 0, yaw: Math.PI / 2, type: 'wood_short' }];
  const lines = wireLines([a, b]);
  const fits = POLE_TYPES.wood_short.wires;
  assert.equal(lines.length, fits.length);
  const outer = lines[0];
  assert.ok(Math.abs(outer[0][1] - fits[0][0]) < 1e-9, 'cross-arm along the pole yaw');
  assert.ok(Math.abs(outer[0][2] - fits[0][2]) < 1e-9);
  const mid = outer[Math.floor(outer.length / 2)];
  assert.ok(mid[2] < fits[0][2] - 0.3, `sags (${mid[2].toFixed(2)})`);
  // a pole turned a quarter (its bracket along local y): its fittings turn with it
  const t = POLE_TYPES.wood_tall;
  const [c] = wireLines([{ x: 0, y: 0, z: 0, yaw: 0, type: 'wood_tall' }, { x: 0, y: 40, z: 0, yaw: 0, type: 'wood_tall' }]);
  const want = [-Math.sin(t.yawOffset) * t.wires[0][1], Math.cos(t.yawOffset) * t.wires[0][1]];
  assert.ok(Math.abs(c[0][0] - want[0]) < 1e-9 && Math.abs(c[0][1] - want[1]) < 1e-9);
});

test('utility poles: the region\'s own, a steel or concrete one where mapped so, the nearest a mapped height', () => {
  const east = new Set(); const west = new Set(); const world = new Set();
  for (let i = 0; i < 200; i++) {
    east.add(choosePoleType({ lat: 29.9, lon: -81.3, seed: `e${i}` }));
    west.add(choosePoleType({ lat: 34, lon: -118, seed: `w${i}` }));
    world.add(choosePoleType({ lat: 48.8, lon: 2.3, seed: `p${i}` }));
  }
  assert.deepEqual([...east].sort(), ['wood_short', 'wood_town', 'wood_wide']);
  assert.ok(west.has('wood_tall') && west.has('wood_arm'));
  assert.deepEqual([...world].sort(), ['steel', 'wood_short']);
  assert.equal(choosePoleType({ lat: 29.9, lon: -81.3, tags: { material: 'concrete' } }), 'steel');
  assert.equal(choosePoleType({ lat: 29.9, lon: -81.3, tags: { height: '8' } }), 'wood_short');
  assert.equal(choosePoleType({ lat: 29.9, lon: -81.3, tags: { height: '11' } }), 'wood_wide');
  for (const t of Object.values(POLE_TYPES)) assert.ok(t.wires.length >= 1 && t.wires.every(([, , z]) => z <= t.top), 'fittings on the pole');
});

test('poles run along a street through its junctions, wired across them', () => {
  // One residential way drawn as three 70 m segments with 12 m junction gaps,
  // crossed by two side streets at the gaps.
  const seg = (owner, x0) => ({
    owner, wayId: 'main', half: 3, highway: 'residential', urban: false, tags: {},
    nodes: Array.from({ length: 15 }, (_, i) => [x0 + i * 5, 0, 10, 6]),
  });
  const cross = (owner, x) => ({
    owner, wayId: `x${owner}`, half: 3, highway: 'service', urban: false, tags: {},
    nodes: Array.from({ length: 21 }, (_, i) => [x, -50 + i * 5, 10, 6]),
  });
  const cws = [seg(1, 0), seg(2, 82), seg(3, 164), cross(4, 76), cross(5, 158)];
  const { poles, wires } = placeStreetProps({ carriageways: cws, heightAt: () => 10 });
  assert.ok(poles.length >= 4, `${poles.length} poles along 234 m`);
  assert.equal(new Set(poles.map((p) => Math.sign(p.y))).size, 1, 'one side all along the street');
  assert.equal(wires.length, (poles.length - 1) * POLE_TYPES[poles[0].type].wires.length, 'one continuous wired line, across both junctions');
});

test('a street split into separate OSM ways at junctions still gets one line', () => {
  const seg = (owner, x0, name = 'Elm St') => ({
    owner, wayId: `w${owner}`, half: 3, highway: 'residential', urban: false, tags: { name },
    nodes: Array.from({ length: 15 }, (_, i) => [x0 + i * 5, 0, 10, 6]),
  });
  const cross = (owner, x) => ({
    owner, wayId: `x${owner}`, half: 3, highway: 'residential', urban: false, tags: { name: 'Oak St' },
    nodes: Array.from({ length: 21 }, (_, i) => [x, -50 + i * 5, 10, 6]),
  });
  const cws = [seg(1, 0), seg(2, 82), seg(3, 164), cross(4, 76), cross(5, 158)];
  const { poles, wires } = placeStreetProps({ carriageways: cws, heightAt: () => 10 });
  const along = poles.filter((p) => Math.abs(p.y) < 10);
  assert.ok(along.length >= 3, `${along.length} poles along Elm St`);
  // The two cross streets have their own lines; Elm St's is one continuous run.
  const elmWires = wires.filter((w) => Math.abs(w[0][1]) < 10 && Math.abs(w[w.length - 1][1]) < 10);
  assert.equal(elmWires.length, (along.length - 1) * 3, 'wired across both junctions');
});

test('pole lines along country roads: added where they are the norm, mapped ones everywhere', async () => {
  const { placeStreetProps, roadsidePolesRegion } = await import('../services/streetProps.js');
  assert.equal(roadsidePolesRegion(35.2, -111.6), true, 'Arizona');
  assert.equal(roadsidePolesRegion(35.7, 139.7), true, 'Tokyo');
  assert.equal(roadsidePolesRegion(-37.8, 145), true, 'Melbourne');
  assert.equal(roadsidePolesRegion(49.3, 0.95), false, 'Normandy');
  assert.equal(roadsidePolesRegion(45.45, 6.98), false, 'the Alps');
  // a kilometre of country lane
  const lane = { owner: 'w1', wayId: 'w1', highway: 'unclassified', urban: false, half: 2.5, nodes: Array.from({ length: 51 }, (_, i) => [i * 20, 0, 10, 5]) };
  const here = placeStreetProps({ carriageways: [lane], countryPoles: true });
  assert.ok(here.poles.length > 15, `${here.poles.length} poles`);
  const mappedPole = Object.assign([500, 30, 10], { tags: { power: 'pole' }, id: 'n1' });
  const there = placeStreetProps({ carriageways: [lane], countryPoles: false, mapped: { poles: [mappedPole] } });
  assert.equal(there.poles.length, 1, 'only the mapped pole');
  assert.equal(there.wires.length, 0);
});
