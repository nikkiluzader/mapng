import test from 'node:test';
import assert from 'node:assert/strict';

import { placeStreetProps, wireLines, WIRE_ARMS, WIRE_Z } from '../services/streetProps.js';
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

test('town streets: hydrants, and bins + benches on major ones, on the sidewalk', () => {
  const cws = [road(1, { highway: 'tertiary', tags: { lit: 'yes' } })];
  const runs = buildSidewalkRuns(cws);
  const { hydrants, bins, benches, poles } = placeStreetProps({ carriageways: cws, runs, heightAt: () => 10 });
  // 600 m, both sides, 120 m apart per side
  assert.ok(hydrants.length >= 6 && hydrants.length <= 10, `${hydrants.length} hydrants`);
  assert.ok(bins.length >= 8, `${bins.length} bins`);
  assert.ok(benches.length >= 4, `${benches.length} benches`);
  for (const h of hydrants) {
    assert.ok(Math.abs(Math.abs(h.y) - 4.45) < 0.01, `hydrant 0.45 m past the curb (y ${h.y})`);
    assert.ok(Math.abs(h.z - 10.15) < 1e-6, 'standing on the sidewalk top');
  }
  assert.equal(poles.length, 0, 'a lit main street gets lamps, not wooden poles');
});

test('mapped hydrants keep generated ones away', () => {
  const cws = [road(1)];
  const runs = buildSidewalkRuns(cws);
  const free = placeStreetProps({ carriageways: cws, runs }).hydrants.length;
  const mapped = { hydrants: Array.from({ length: 7 }, (_, i) => [i * 100, 5]) };
  const withMapped = placeStreetProps({ carriageways: cws, runs, mapped }).hydrants.length;
  assert.ok(withMapped < free / 2, `${withMapped} generated next to mapped ones (${free} without)`);
});

test('country roads: a wired run of poles off one side', () => {
  const cws = [road(1, { highway: 'tertiary', urban: false, half: 3 })];
  const { poles, wires, hydrants } = placeStreetProps({ carriageways: cws, heightAt: (x) => 20 + x * 0.01 });
  assert.equal(hydrants.length, 0);
  assert.ok(poles.length >= 11 && poles.length <= 14, `${poles.length} poles every 45 m`);
  const ys = new Set(poles.map((p) => Math.sign(p.y)));
  assert.equal(ys.size, 1, 'one side of the road');
  for (const p of poles) assert.ok(Math.abs(Math.abs(p.y) - 5.4) < 1e-6, '2.4 m past the edge');
  assert.equal(wires.length, (poles.length - 1) * WIRE_ARMS.length, 'three wires per span');
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
  assert.equal(wires.length, 12 * 3);
});

test('wires hang from the cross-arm ends and sag mid-span', () => {
  const [a, b] = [{ x: 0, y: 0, z: 0, yaw: Math.PI / 2 }, { x: 40, y: 0, z: 0, yaw: Math.PI / 2 }];
  const lines = wireLines([a, b]);
  assert.equal(lines.length, 3);
  const outer = lines[0];
  assert.ok(Math.abs(outer[0][1] - WIRE_ARMS[0]) < 1e-9, 'cross-arm along the pole yaw');
  assert.equal(outer[0][2], WIRE_Z);
  const mid = outer[Math.floor(outer.length / 2)];
  assert.ok(mid[2] < WIRE_Z - 0.3, `sags (${mid[2].toFixed(2)})`);
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
  assert.equal(wires.length, (poles.length - 1) * 3, 'one continuous wired line, across both junctions');
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
