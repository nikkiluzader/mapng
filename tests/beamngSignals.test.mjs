import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBeamNGSignalData, buildBeamNGSignalExportBundle } from '../services/beamngSignals.js';

// Real-world scale: a ~1.1 km box centred on junction J, so J is the world
// origin. Crossing roads share their junction vertex, as in OSM.
const J = 0.005;
const M = 1 / 111320; // degrees per metre
// squareSize so 64 cells span the ~1113 m box (world metres ≈ real metres).
const SQ = (0.01 * 111320) / 64;

function makeTerrainData(osmFeatures = [], extra = {}) {
  const width = 64;
  const height = 64;
  return {
    width,
    height,
    minHeight: 0,
    maxHeight: 200,
    heightMap: new Float32Array(width * height).fill(40),
    bounds: { north: 0.01, south: 0, west: 0, east: 0.01 },
    osmFeatures,
    ...extra,
  };
}

const road = (id, tags, coords) => ({ id, type: 'road', tags, geometry: coords.map(([lat, lng]) => ({ lat, lng })) });
const node = (id, tags, lat, lng) => ({ id, type: 'street_furniture', tags, geometry: [{ lat, lng }] });

// North–south and east–west roads crossing at J.
const crossroads = (nsTags = { highway: 'primary' }, ewTags = { highway: 'primary' }) => [
  road('ns', nsTags, [[0.009, J], [J, J], [0.001, J]]),
  road('ew', ewTags, [[J, 0.001], [J, J], [J, 0.009]]),
];
const distToJ = (instance) => Math.hypot(instance.pos[0], instance.pos[1]);

test('buildBeamNGSignalData returns empty schema when no supported signal features exist', () => {
  const signalData = buildBeamNGSignalData(makeTerrainData(crossroads()), SQ);
  assert.deepEqual(signalData, { instances: [], controllers: [], sequences: [] });
});

test('a signal mapped on the junction node controls every approach, facing the junction', () => {
  const signalData = buildBeamNGSignalData(makeTerrainData([...crossroads(), node('tl', { highway: 'traffic_signals' }, J, J)]), SQ);

  assert.equal(signalData.instances.length, 4, 'one instance per incoming road');
  assert.equal(signalData.sequences.length, 1);
  assert.equal(signalData.sequences[0].phases.length, 2, 'two phases');

  for (const instance of signalData.instances) {
    const toJ = [-instance.pos[0], -instance.pos[1]];
    const dot = (toJ[0] * instance.dir[0] + toJ[1] * instance.dir[1]) / Math.hypot(...toJ);
    assert.ok(dot > 0.99, `${instance.name} must face the junction`);
  }

  // Opposite approaches share a controller (same phase); crossing ones don't.
  const axisController = (axis) => new Set(signalData.instances
    .filter((i) => (Math.abs(i.dir[0]) > Math.abs(i.dir[1])) === (axis === 'ew'))
    .map((i) => i.controllerId));
  assert.equal(axisController('ns').size, 1);
  assert.equal(axisController('ew').size, 1);
  assert.notDeepEqual([...axisController('ns')], [...axisController('ew')]);
});

test('stop points sit 6–10 m before the junction on the road surface', () => {
  const signalData = buildBeamNGSignalData(makeTerrainData([...crossroads(), node('tl', { highway: 'traffic_signals' }, J, J)]), SQ);
  for (const instance of signalData.instances) {
    const d = distToJ(instance);
    assert.ok(d >= 6 && d <= 10, `stop point ${d.toFixed(2)} m from the junction`);
    assert.ok(Math.abs(instance.pos[2] - 40.1) < 1e-6, 'on the road surface (terrain 40 m)');
  }
});

test('signals mapped on each approach mark the stop line there', () => {
  const signalData = buildBeamNGSignalData(makeTerrainData([
    road('ns', { highway: 'primary' }, [[0.009, J], [J + 15 * M, J], [J, J], [J - 15 * M, J], [0.001, J]]),
    road('ew', { highway: 'primary' }, [[J, 0.001], [J, J], [J, 0.009]]),
    node('tl_n', { highway: 'traffic_signals', 'traffic_signals:direction': 'forward' }, J + 15 * M, J),
    node('tl_s', { highway: 'traffic_signals', 'traffic_signals:direction': 'backward' }, J - 15 * M, J),
  ]), SQ);
  assert.equal(signalData.instances.length, 4, 'the cross street gets signals too');
  for (const instance of signalData.instances.filter((i) => Math.abs(i.dir[1]) > 0.9)) {
    assert.ok(Math.abs(distToJ(instance) - 15) < 1.5, 'N/S stop points at the mapped signals');
  }
});

test('diagonal junctions split phases by road axis, not compass quadrant', () => {
  const d = 0.003;
  const signalData = buildBeamNGSignalData(makeTerrainData([
    road('ne_sw', { highway: 'primary' }, [[J + d, J + d], [J, J], [J - d, J - d]]),
    road('nw_se', { highway: 'primary' }, [[J + d, J - d], [J, J], [J - d, J + d]]),
    node('tl', { highway: 'traffic_signals' }, J, J),
  ]), SQ);
  assert.equal(signalData.instances.length, 4);
  const controllerOf = (sx, sy) => signalData.instances
    .find((i) => Math.sign(i.dir[0]) === sx && Math.sign(i.dir[1]) === sy).controllerId;
  assert.equal(controllerOf(1, 1), controllerOf(-1, -1), 'NE-bound and SW-bound share a phase');
  assert.equal(controllerOf(1, -1), controllerOf(-1, 1));
  assert.notEqual(controllerOf(1, 1), controllerOf(1, -1));
});

test('a one-way road leaving the junction gets no signal', () => {
  const signalData = buildBeamNGSignalData(makeTerrainData([
    road('ns', { highway: 'primary' }, [[0.009, J], [J, J], [0.001, J]]),
    road('ew_out', { highway: 'secondary', oneway: 'yes' }, [[J, J], [J, 0.009]]),
    road('ew_in', { highway: 'secondary' }, [[J, 0.001], [J, J]]),
    node('tl', { highway: 'traffic_signals' }, J, J),
  ]), SQ);
  assert.equal(signalData.instances.length, 3);
  assert.ok(!signalData.instances.some((i) => i.dir[0] < -0.9), 'no westbound approach from the one-way exit');
});

test('a mid-block crossing signal controls both directions with one controller', () => {
  const both = buildBeamNGSignalData(makeTerrainData([
    road('ns', { highway: 'primary' }, [[0.009, J], [J, J], [0.001, J]]),
    node('tl', { highway: 'traffic_signals', crossing: 'traffic_signals' }, J, J),
  ]), SQ);
  assert.equal(both.instances.length, 2);
  assert.equal(both.controllers.length, 1);
  assert.equal(both.sequences.length, 0);
  assert.ok(both.instances.every((i) => i.sequenceId === 0));

  const forward = buildBeamNGSignalData(makeTerrainData([
    road('ns', { highway: 'primary' }, [[0.009, J], [J, J], [0.001, J]]),
    node('tl', { highway: 'traffic_signals', 'traffic_signals:direction': 'forward' }, J, J),
  ]), SQ);
  assert.equal(forward.instances.length, 1);
  assert.ok(forward.instances[0].dir[1] < -0.9, 'forward = along the way (southbound)');
});

test('stop signs: mapped approach, stop=all, and junction-node stops on minor roads', () => {
  const mapped = buildBeamNGSignalData(makeTerrainData([
    road('main', { highway: 'secondary' }, [[J, 0.001], [J, J], [J, 0.009]]),
    road('side', { highway: 'residential' }, [[0.009, J], [J + 10 * M, J], [J, J]]),
    node('stop', { highway: 'stop' }, J + 10 * M, J),
  ]), SQ);
  assert.equal(mapped.instances.length, 1);
  assert.equal(mapped.controllers[0].type, 'signStop');
  assert.ok(mapped.instances[0].dir[1] < -0.9, 'faces the junction (southbound)');

  const allWay = buildBeamNGSignalData(makeTerrainData([
    ...crossroads({ highway: 'residential' }, { highway: 'residential' }),
    node('stop', { highway: 'stop', stop: 'all' }, J, J),
  ]), SQ);
  assert.equal(allWay.instances.length, 4, 'stop=all stops every approach');
  assert.equal(new Set(allWay.instances.map((i) => i.controllerId)).size, 1);

  const onNode = buildBeamNGSignalData(makeTerrainData([
    ...crossroads({ highway: 'residential' }, { highway: 'secondary' }),
    node('stop', { highway: 'stop' }, J, J),
  ]), SQ);
  assert.equal(onNode.instances.length, 2, 'only the minor (residential) approaches');
  assert.ok(onNode.instances.every((i) => Math.abs(i.dir[1]) > 0.9));
});

// BeamNG's AI never acts on yield signals, and the old custom "stop" yield
// state made AI wait forever; give-way is expressed through drivability.
test('buildBeamNGSignalData emits no signal for give_way', () => {
  const bundle = buildBeamNGSignalExportBundle(makeTerrainData([
    ...crossroads({ highway: 'residential' }),
    node('gw', { highway: 'give_way' }, J + 10 * M, J),
  ]), SQ);
  assert.equal(bundle.signalData.controllers.length, 0);
  assert.equal(bundle.signalData.instances.length, 0);
  assert.equal(bundle.controllerDefinitions, null);
});

test('buildBeamNGSignalData uses the EU red+amber cycle when road rules ask for it', () => {
  const features = [...crossroads(), node('tl', { highway: 'traffic_signals' }, J, J)];
  const euro = buildBeamNGSignalData(makeTerrainData(features, { roadRules: { euroSignals: true } }), SQ);
  const us = buildBeamNGSignalData(makeTerrainData(features), SQ);

  assert.ok(euro.controllers.length > 0);
  for (const controller of euro.controllers) {
    assert.equal(controller.type, 'lightsBasicEU');
    assert.equal(controller.states[0].state, 'redYellowTrafficLight');
    assert.equal(controller.defaultIndex, 4);
  }
  assert.ok(us.controllers.length > 0 && us.controllers.every((controller) => controller.type === 'lightsBasic'));
});

test('turn lanes on an approach give it a protected-green controller with staged phases', () => {
  const signalData = buildBeamNGSignalData(makeTerrainData([
    ...crossroads({ highway: 'primary', 'turn:lanes': 'left|through' }),
    node('tl', { highway: 'traffic_signals' }, J, J),
  ]), SQ);

  assert.equal(signalData.sequences.length, 1);
  const types = new Set(signalData.controllers.map((controller) => controller.type));
  assert.ok(types.has('lightsBasicProtectedGreen'));
  assert.ok(types.has('lightsBasic'));

  const phases = [...signalData.sequences[0].phases].sort((a, b) => a.startTime - b.startTime);
  assert.ok(phases.length >= 3);
  assert.equal(phases[0].startTime, 0);
  for (let i = 1; i < phases.length; i++) assert.ok(phases[i].startTime > phases[i - 1].startTime);

  // The through phase after the protected axis starts before it fully ends.
  const overlaps = phases.some((phase, i) => i + 1 < phases.length
    && phases[i + 1].startTime < phase.startTime + phase.totalDuration);
  assert.equal(overlaps, true);
});

test('a higher-priority cross road gets a longer overlap after the protected axis', () => {
  const overlapFor = (ewHighway) => {
    const signalData = buildBeamNGSignalData(makeTerrainData([
      ...crossroads({ highway: 'primary', 'turn:lanes': 'left|through' }, { highway: ewHighway }),
      node('tl', { highway: 'traffic_signals' }, J, J),
    ]), SQ);
    const phases = [...signalData.sequences[0].phases].sort((a, b) => a.startTime - b.startTime);
    let max = 0;
    for (let i = 0; i + 1 < phases.length; i++) {
      max = Math.max(max, phases[i].startTime + phases[i].totalDuration - phases[i + 1].startTime);
    }
    return max;
  };
  assert.ok(overlapFor('primary') > overlapFor('residential'));
});

test('signal props: North America hangs heads from a mast arm; elsewhere a post per approach', () => {
  const features = [...crossroads(), node('tl', { highway: 'traffic_signals' }, J, J)];
  const { signalData, props } = buildBeamNGSignalExportBundle(makeTerrainData(features, { roadRules: { countryCode: 'US' } }), SQ);
  const heads = props.filter((p) => p.kind === 'signal_head');
  const masts = props.filter((p) => p.kind === 'signal_mast');
  assert.equal(masts.length, 4);
  assert.equal(props.filter((p) => p.kind === 'signal_pole').length, 0);
  assert.ok(heads.length >= 4);
  const names = new Set(signalData.instances.map((i) => i.name));
  for (const head of heads) assert.ok(names.has(head.signalInstance), 'head links to a real instance');
  // Clear of both primaries (2 lanes → half width 3.25 m) crossing at the origin.
  for (const mast of masts) {
    const offRoad = Math.min(Math.abs(mast.position[0]), Math.abs(mast.position[1]));
    assert.ok(offRoad > 3.25, `mast ${offRoad.toFixed(2)} m from a road centreline`);
  }
  // each head hangs over the carriageway its lenses face
  for (const head of heads) {
    const across = Math.abs(Math.cos(head.yaw)) > 0.5 ? Math.abs(head.position[1]) : Math.abs(head.position[0]);
    assert.ok(across < 3.25 + 0.5, `head ${across.toFixed(2)} m off its road's centreline`);
  }
  // the arm (local +X) reaches from the kerb over the lanes, to the driver's left
  const instance = signalData.instances.find((i) => i.dir[1] > 0.9);
  const head = heads.find((h) => h.signalInstance === instance.name);
  const mast = masts.reduce((best, m) => (Math.hypot(m.position[0] - head.position[0], m.position[1] - head.position[1])
    < Math.hypot(best.position[0] - head.position[0], best.position[1] - head.position[1]) ? m : best));
  assert.ok(Math.cos(mast.yaw) < -0.999, 'northbound: the arm reaches west');

  const de = buildBeamNGSignalExportBundle(makeTerrainData(features, { roadRules: { countryCode: 'DE' } }), SQ).props;
  assert.equal(de.filter((p) => p.kind === 'signal_pole').length, 4);
  assert.equal(de.filter((p) => p.kind === 'signal_mast').length, 0);
});

test('signal props: far side in North America, stop line elsewhere; kerb follows driving side', () => {
  const features = [...crossroads(), node('tl', { highway: 'traffic_signals' }, J, J)];
  const northboundHead = ({ props, signalData }) => {
    const name = signalData.instances.find((i) => i.dir[1] > 0.9).name;
    return props.find((p) => p.kind === 'signal_head' && p.signalInstance === name);
  };
  const us = northboundHead(buildBeamNGSignalExportBundle(makeTerrainData(features, { roadRules: { countryCode: 'US' } }), SQ));
  const de = northboundHead(buildBeamNGSignalExportBundle(makeTerrainData(features, { roadRules: { countryCode: 'DE' } }), SQ));
  const gb = northboundHead(buildBeamNGSignalExportBundle(makeTerrainData(features, { roadRules: { countryCode: 'GB', leftHandTraffic: true } }), SQ));

  assert.ok(us.position[1] > 0, 'US: across the junction from a northbound driver');
  assert.ok(de.position[1] < 0, 'DE: at the stop line, before the junction');
  assert.ok(de.position[0] > 0, 'right-hand traffic: right kerb (east)');
  assert.ok(gb.position[0] < 0, 'left-hand traffic: left kerb (west)');
  // Lenses (+X) face oncoming traffic: south for a northbound approach.
  assert.ok(Math.abs(us.yaw - (-Math.PI / 2)) < 1e-6);
});
