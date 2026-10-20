import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBeamNGSignalData, buildBeamNGSignalExportBundle } from '../services/beamngSignals.js';

function makeTerrainData(osmFeatures = []) {
  const width = 16;
  const height = 16;
  return {
    width,
    height,
    minHeight: 0,
    maxHeight: 200,
    heightMap: new Float32Array(width * height).fill(40),
    bounds: {
      north: 1,
      south: 0,
      west: 0,
      east: 1,
    },
    osmFeatures,
  };
}

test('buildBeamNGSignalData returns empty schema when no supported signal features exist', () => {
  const terrainData = makeTerrainData([
    {
      id: 'road_1',
      type: 'road',
      tags: { highway: 'primary' },
      geometry: [
        { lat: 0.8, lng: 0.2 },
        { lat: 0.2, lng: 0.8 },
      ],
    },
  ]);

  const signalData = buildBeamNGSignalData(terrainData, 1);
  assert.deepEqual(signalData, { instances: [], controllers: [], sequences: [] });
});

test('buildBeamNGSignalData builds traffic light and stop sign records with valid references', () => {
  const terrainData = makeTerrainData([
    {
      id: 'road_ns',
      type: 'road',
      tags: { highway: 'primary' },
      geometry: [
        { lat: 0.9, lng: 0.5 },
        { lat: 0.1, lng: 0.5 },
      ],
    },
    {
      id: 'light_1',
      type: 'street_furniture',
      tags: { highway: 'traffic_signals' },
      geometry: [{ lat: 0.55, lng: 0.51 }],
    },
    {
      id: 'stop_1',
      type: 'street_furniture',
      tags: { highway: 'stop' },
      geometry: [{ lat: 0.35, lng: 0.49 }],
    },
  ]);

  const signalData = buildBeamNGSignalData(terrainData, 1);

  assert.equal(signalData.instances.length, 2);
  assert.ok(signalData.controllers.length >= 2);
  assert.equal(signalData.sequences.length, 0);

  const stopController = signalData.controllers.find((controller) => controller.type === 'signStop');
  assert.ok(stopController);

  const stopInstance = signalData.instances.find((instance) => instance.controllerId === stopController.id);
  assert.ok(stopInstance);
  assert.equal(stopInstance.sequenceId, 0);

  const lightInstance = signalData.instances.find((instance) => instance.name.startsWith('trafficLight '));
  assert.ok(lightInstance);
  assert.equal(lightInstance.sequenceId, 0);

  const controllerIds = new Set(signalData.controllers.map((controller) => controller.id));
  const sequenceIds = new Set(signalData.sequences.map((seq) => seq.id));
  const instanceIds = new Set(signalData.instances.map((instance) => instance.id));

  assert.equal(controllerIds.size, signalData.controllers.length);
  assert.equal(sequenceIds.size, signalData.sequences.length);
  assert.equal(instanceIds.size, signalData.instances.length);

  // IDs must be globally unique across instances/controllers/sequences.
  const allIds = new Set([...controllerIds, ...sequenceIds, ...instanceIds]);
  assert.equal(allIds.size, signalData.controllers.length + signalData.sequences.length + signalData.instances.length);
});

test('buildBeamNGSignalData creates dual-phase sequence for orthogonal intersection lights', () => {
  const terrainData = makeTerrainData([
    {
      id: 'road_ns',
      type: 'road',
      tags: { highway: 'primary' },
      geometry: [
        { lat: 0.9, lng: 0.5 },
        { lat: 0.1, lng: 0.5 },
      ],
    },
    {
      id: 'road_ew',
      type: 'road',
      tags: { highway: 'primary' },
      geometry: [
        { lat: 0.5, lng: 0.1 },
        { lat: 0.5, lng: 0.9 },
      ],
    },
    {
      id: 'light_ns',
      type: 'street_furniture',
      tags: { highway: 'traffic_signals' },
      geometry: [{ lat: 0.54, lng: 0.50002 }],
    },
    {
      id: 'light_ew',
      type: 'street_furniture',
      tags: { highway: 'traffic_signals' },
      geometry: [{ lat: 0.50002, lng: 0.54 }],
    },
  ]);

  const signalData = buildBeamNGSignalData(terrainData, 1);

  assert.equal(signalData.sequences.length, 1);
  assert.equal(signalData.sequences[0].phases.length, 2);
  assert.equal(signalData.instances.length, 2);

  const sequenceControllerIds = new Set(signalData.sequences[0].phases.flatMap((phase) => phase.controllerIds));
  assert.equal(sequenceControllerIds.size, 2);
});

// BeamNG's AI never acts on yield signals, and the old custom "stop" yield
// state made AI wait forever; give-way is expressed through drivability.
test('buildBeamNGSignalData emits no signal for give_way', () => {
  const terrainData = makeTerrainData([
    {
      id: 'road_1',
      type: 'road',
      tags: { highway: 'residential' },
      geometry: [
        { lat: 0.9, lng: 0.5 },
        { lat: 0.1, lng: 0.5 },
      ],
    },
    {
      id: 'yield_1',
      type: 'street_furniture',
      tags: { highway: 'give_way' },
      geometry: [{ lat: 0.55, lng: 0.49 }],
    },
  ]);

  const bundle = buildBeamNGSignalExportBundle(terrainData, 1);

  assert.equal(bundle.signalData.controllers.length, 0);
  assert.equal(bundle.signalData.instances.length, 0);
  assert.equal(bundle.controllerDefinitions, null);
});

test('buildBeamNGSignalData uses the EU red+amber cycle when road rules ask for it', () => {
  const lights = [
    { id: 'road_ns', type: 'road', tags: { highway: 'primary' }, geometry: [{ lat: 0.9, lng: 0.5 }, { lat: 0.1, lng: 0.5 }] },
    { id: 'road_ew', type: 'road', tags: { highway: 'primary' }, geometry: [{ lat: 0.5, lng: 0.1 }, { lat: 0.5, lng: 0.9 }] },
    { id: 'tl_n', type: 'street_furniture', tags: { highway: 'traffic_signals' }, geometry: [{ lat: 0.52, lng: 0.5 }] },
    { id: 'tl_e', type: 'street_furniture', tags: { highway: 'traffic_signals' }, geometry: [{ lat: 0.5, lng: 0.52 }] },
  ];
  const euro = buildBeamNGSignalData({ ...makeTerrainData(lights), roadRules: { euroSignals: true } }, 1);
  const us = buildBeamNGSignalData(makeTerrainData(lights), 1);

  assert.ok(euro.controllers.length > 0);
  for (const controller of euro.controllers) {
    assert.equal(controller.type, 'lightsBasicEU');
    assert.equal(controller.states[0].state, 'redYellowTrafficLight');
    assert.equal(controller.defaultIndex, 4);
  }
  assert.ok(us.controllers.every((controller) => controller.type === 'lightsBasic'));
});

test('buildBeamNGSignalData skips sequence for single-direction traffic lights', () => {
  const terrainData = makeTerrainData([
    {
      id: 'road_ns',
      type: 'road',
      tags: { highway: 'primary' },
      geometry: [
        { lat: 0.9, lng: 0.5 },
        { lat: 0.1, lng: 0.5 },
      ],
    },
    {
      id: 'light_1',
      type: 'street_furniture',
      tags: { highway: 'traffic_signals' },
      geometry: [{ lat: 0.55, lng: 0.5 }],
    },
  ]);

  const signalData = buildBeamNGSignalData(terrainData, 1);

  assert.equal(signalData.instances.length, 1);
  assert.equal(signalData.controllers.length, 1);
  assert.equal(signalData.sequences.length, 0);
  assert.equal(signalData.instances[0].sequenceId, 0);
});

test('buildBeamNGSignalData uses protected-green controller when nearby turn-lane hints exist', () => {
  const terrainData = makeTerrainData([
    {
      id: 'road_turn',
      type: 'road',
      tags: {
        highway: 'primary',
        'turn:lanes': 'left|through',
      },
      geometry: [
        { lat: 0.9, lng: 0.5 },
        { lat: 0.1, lng: 0.5 },
      ],
    },
    {
      id: 'light_1',
      type: 'street_furniture',
      tags: { highway: 'traffic_signals' },
      geometry: [{ lat: 0.55, lng: 0.5 }],
    },
  ]);

  const signalData = buildBeamNGSignalData(terrainData, 1);

  assert.equal(signalData.controllers.length, 1);
  assert.equal(signalData.controllers[0].type, 'lightsBasicProtectedGreen');
  assert.equal(signalData.controllers[0].states[0].state, 'greenFlashingTrafficLight');
});

test('buildBeamNGSignalData mixes protected and basic controllers across orthogonal phases', () => {
  const terrainData = makeTerrainData([
    {
      id: 'road_ns_turn',
      type: 'road',
      tags: {
        highway: 'primary',
        'turn:lanes': 'left|through',
      },
      geometry: [
        { lat: 0.9, lng: 0.5 },
        { lat: 0.1, lng: 0.5 },
      ],
    },
    {
      id: 'road_ew',
      type: 'road',
      tags: { highway: 'primary' },
      geometry: [
        { lat: 0.5, lng: 0.1 },
        { lat: 0.5, lng: 0.9 },
      ],
    },
    {
      id: 'light_ns',
      type: 'street_furniture',
      tags: { highway: 'traffic_signals' },
      geometry: [{ lat: 0.54, lng: 0.50002 }],
    },
    {
      id: 'light_ew',
      type: 'street_furniture',
      tags: { highway: 'traffic_signals' },
      geometry: [{ lat: 0.50002, lng: 0.54 }],
    },
  ]);

  const signalData = buildBeamNGSignalData(terrainData, 1);

  assert.equal(signalData.sequences.length, 1);
  const types = new Set(signalData.controllers.map((controller) => controller.type));
  assert.ok(types.has('lightsBasicProtectedGreen'));
  assert.ok(types.has('lightsBasic'));
});

test('buildBeamNGSignalData emits staged sequence timing for protected intersections', () => {
  const terrainData = makeTerrainData([
    {
      id: 'road_ns_turn',
      type: 'road',
      tags: {
        highway: 'primary',
        'turn:lanes': 'left|through',
      },
      geometry: [
        { lat: 0.9, lng: 0.5 },
        { lat: 0.1, lng: 0.5 },
      ],
    },
    {
      id: 'road_ew',
      type: 'road',
      tags: { highway: 'primary' },
      geometry: [
        { lat: 0.5, lng: 0.1 },
        { lat: 0.5, lng: 0.9 },
      ],
    },
    {
      id: 'light_ns',
      type: 'street_furniture',
      tags: { highway: 'traffic_signals' },
      geometry: [{ lat: 0.54, lng: 0.50002 }],
    },
    {
      id: 'light_ew',
      type: 'street_furniture',
      tags: { highway: 'traffic_signals' },
      geometry: [{ lat: 0.50002, lng: 0.54 }],
    },
  ]);

  const signalData = buildBeamNGSignalData(terrainData, 1);
  assert.equal(signalData.sequences.length, 1);

  const phases = signalData.sequences[0].phases;
  assert.ok(phases.length >= 3);
  assert.equal(phases[0].startTime, 0);

  for (let i = 1; i < phases.length; i++) {
    assert.ok(Number(phases[i].startTime) > Number(phases[i - 1].startTime));
  }

  const totalDurations = phases.map((phase) => Number(phase.totalDuration) || 0);
  assert.ok(Math.min(...totalDurations) < Math.max(...totalDurations));
});

test('buildBeamNGSignalData assigns lane-level controllers from signal direction tags', () => {
  const terrainData = makeTerrainData([
    {
      id: 'road_ns_turn',
      type: 'road',
      tags: {
        highway: 'primary',
        'turn:lanes': 'left|through',
      },
      geometry: [
        { lat: 0.9, lng: 0.5 },
        { lat: 0.1, lng: 0.5 },
      ],
    },
    {
      id: 'road_ew',
      type: 'road',
      tags: { highway: 'primary' },
      geometry: [
        { lat: 0.5, lng: 0.1 },
        { lat: 0.5, lng: 0.9 },
      ],
    },
    {
      id: 'light_ns_left',
      type: 'street_furniture',
      tags: {
        highway: 'traffic_signals',
        'traffic_signals:direction': 'left',
      },
      geometry: [{ lat: 0.54, lng: 0.50002 }],
    },
    {
      id: 'light_ns_through',
      type: 'street_furniture',
      tags: {
        highway: 'traffic_signals',
        'traffic_signals:direction': 'forward',
      },
      geometry: [{ lat: 0.56, lng: 0.50002 }],
    },
    {
      id: 'light_ew',
      type: 'street_furniture',
      tags: { highway: 'traffic_signals' },
      geometry: [{ lat: 0.50002, lng: 0.54 }],
    },
  ]);

  const signalData = buildBeamNGSignalData(terrainData, 1);
  assert.equal(signalData.sequences.length, 1);

  const types = signalData.controllers.map((controller) => controller.type);
  assert.ok(types.includes('lightsBasicProtectedGreen'));

  const multiControllerPhase = signalData.sequences[0].phases.find((phase) => (phase.controllerIds || []).length >= 2);
  assert.ok(multiControllerPhase);
});

test('buildBeamNGSignalData overlaps opposing through phase after protected axis', () => {
  const terrainData = makeTerrainData([
    {
      id: 'road_ns_turn',
      type: 'road',
      tags: {
        highway: 'primary',
        'turn:lanes': 'left|through',
      },
      geometry: [
        { lat: 0.9, lng: 0.5 },
        { lat: 0.1, lng: 0.5 },
      ],
    },
    {
      id: 'road_ew',
      type: 'road',
      tags: { highway: 'primary' },
      geometry: [
        { lat: 0.5, lng: 0.1 },
        { lat: 0.5, lng: 0.9 },
      ],
    },
    {
      id: 'light_ns_left',
      type: 'street_furniture',
      tags: {
        highway: 'traffic_signals',
        'traffic_signals:direction': 'left',
      },
      geometry: [{ lat: 0.54, lng: 0.50002 }],
    },
    {
      id: 'light_ns_through',
      type: 'street_furniture',
      tags: {
        highway: 'traffic_signals',
        'traffic_signals:direction': 'forward',
      },
      geometry: [{ lat: 0.56, lng: 0.50002 }],
    },
    {
      id: 'light_ew_through',
      type: 'street_furniture',
      tags: {
        highway: 'traffic_signals',
        'traffic_signals:direction': 'forward',
      },
      geometry: [{ lat: 0.50002, lng: 0.54 }],
    },
  ]);

  const signalData = buildBeamNGSignalData(terrainData, 1);
  assert.equal(signalData.sequences.length, 1);

  const phases = [...signalData.sequences[0].phases]
    .sort((a, b) => Number(a.startTime ?? 0) - Number(b.startTime ?? 0));
  assert.ok(phases.length >= 3);

  let hasOverlap = false;
  for (let i = 0; i < phases.length - 1; i++) {
    const currentStart = Number(phases[i].startTime ?? 0);
    const currentEnd = currentStart + Number(phases[i].totalDuration ?? 0);
    const nextStart = Number(phases[i + 1].startTime ?? 0);
    if (nextStart < currentEnd) {
      hasOverlap = true;
      break;
    }
  }

  assert.equal(hasOverlap, true);
});

test('buildBeamNGSignalData increases overlap window for denser, higher-priority opposing approaches', () => {
  const buildScenario = (ewHighway, ewSignalCount) => {
    const ewSignals = [];
    for (let i = 0; i < ewSignalCount; i++) {
      ewSignals.push({
        id: `light_ew_${i}`,
        type: 'street_furniture',
        tags: {
          highway: 'traffic_signals',
          'traffic_signals:direction': 'forward',
        },
        geometry: [{ lat: 0.50002 + (i * 0.01), lng: 0.54 }],
      });
    }

    return makeTerrainData([
      {
        id: 'road_ns_turn',
        type: 'road',
        tags: {
          highway: 'primary',
          'turn:lanes': 'left|through',
        },
        geometry: [
          { lat: 0.9, lng: 0.5 },
          { lat: 0.1, lng: 0.5 },
        ],
      },
      {
        id: 'road_ew',
        type: 'road',
        tags: { highway: ewHighway },
        geometry: [
          { lat: 0.5, lng: 0.1 },
          { lat: 0.5, lng: 0.9 },
        ],
      },
      {
        id: 'light_ns_left',
        type: 'street_furniture',
        tags: {
          highway: 'traffic_signals',
          'traffic_signals:direction': 'left',
        },
        geometry: [{ lat: 0.54, lng: 0.50002 }],
      },
      {
        id: 'light_ns_through',
        type: 'street_furniture',
        tags: {
          highway: 'traffic_signals',
          'traffic_signals:direction': 'forward',
        },
        geometry: [{ lat: 0.56, lng: 0.50002 }],
      },
      ...ewSignals,
    ]);
  };

  const getMaxAdjacentOverlap = (signalData) => {
    const phases = [...signalData.sequences[0].phases]
      .sort((a, b) => Number(a.startTime ?? 0) - Number(b.startTime ?? 0));

    let maxOverlap = 0;
    for (let i = 0; i < phases.length - 1; i++) {
      const currentStart = Number(phases[i].startTime ?? 0);
      const currentEnd = currentStart + Number(phases[i].totalDuration ?? 0);
      const nextStart = Number(phases[i + 1].startTime ?? 0);
      maxOverlap = Math.max(maxOverlap, Math.max(0, currentEnd - nextStart));
    }
    return maxOverlap;
  };

  const lowPriority = buildBeamNGSignalData(buildScenario('residential', 1), 1);
  const highPriority = buildBeamNGSignalData(buildScenario('primary', 3), 1);

  assert.equal(lowPriority.sequences.length, 1);
  assert.equal(highPriority.sequences.length, 1);

  const lowOverlap = getMaxAdjacentOverlap(lowPriority);
  const highOverlap = getMaxAdjacentOverlap(highPriority);

  assert.ok(highOverlap > lowOverlap);
});

test('buildBeamNGSignalData shortens protected lead phase when same-axis through demand is high', () => {
  const buildScenario = (throughCount) => {
    const nsThroughSignals = [];
    for (let i = 0; i < throughCount; i++) {
      nsThroughSignals.push({
        id: `light_ns_through_${i}`,
        type: 'street_furniture',
        tags: {
          highway: 'traffic_signals',
          'traffic_signals:direction': 'forward',
        },
        geometry: [{ lat: 0.56 + (i * 0.01), lng: 0.50002 }],
      });
    }

    return makeTerrainData([
      {
        id: 'road_ns_turn',
        type: 'road',
        tags: {
          highway: 'primary',
          'turn:lanes': 'left|through',
        },
        geometry: [
          { lat: 0.9, lng: 0.5 },
          { lat: 0.1, lng: 0.5 },
        ],
      },
      {
        id: 'road_ew',
        type: 'road',
        tags: { highway: 'secondary' },
        geometry: [
          { lat: 0.5, lng: 0.1 },
          { lat: 0.5, lng: 0.9 },
        ],
      },
      {
        id: 'light_ns_left',
        type: 'street_furniture',
        tags: {
          highway: 'traffic_signals',
          'traffic_signals:direction': 'left',
        },
        geometry: [{ lat: 0.54, lng: 0.50002 }],
      },
      ...nsThroughSignals,
      {
        id: 'light_ew_through',
        type: 'street_furniture',
        tags: {
          highway: 'traffic_signals',
          'traffic_signals:direction': 'forward',
        },
        geometry: [{ lat: 0.50002, lng: 0.54 }],
      },
    ]);
  };

  const getFirstLeadDuration = (signalData) => {
    const phases = [...signalData.sequences[0].phases]
      .sort((a, b) => Number(a.startTime ?? 0) - Number(b.startTime ?? 0));
    return Number(phases[0]?.totalDuration ?? 0);
  };

  const lowThrough = buildBeamNGSignalData(buildScenario(1), 1);
  const highThrough = buildBeamNGSignalData(buildScenario(4), 1);

  assert.equal(lowThrough.sequences.length, 1);
  assert.equal(highThrough.sequences.length, 1);

  const lowLead = getFirstLeadDuration(lowThrough);
  const highLead = getFirstLeadDuration(highThrough);

  assert.ok(highLead < lowLead);
});

test('buildBeamNGSignalData normalizes dense-axis cycle duration to bounded span', () => {
  const nsThroughSignals = [];
  for (let i = 0; i < 8; i++) {
    nsThroughSignals.push({
      id: `light_ns_dense_${i}`,
      type: 'street_furniture',
      tags: {
        highway: 'traffic_signals',
        'traffic_signals:direction': 'forward',
      },
      geometry: [{ lat: 0.56 + (i * 0.004), lng: 0.50002 }],
    });
  }

  const terrainData = makeTerrainData([
    {
      id: 'road_ns_turn',
      type: 'road',
      tags: {
        highway: 'primary',
        'turn:lanes': 'left|through',
      },
      geometry: [
        { lat: 0.9, lng: 0.5 },
        { lat: 0.1, lng: 0.5 },
      ],
    },
    {
      id: 'road_ew',
      type: 'road',
      tags: { highway: 'primary' },
      geometry: [
        { lat: 0.5, lng: 0.1 },
        { lat: 0.5, lng: 0.9 },
      ],
    },
    {
      id: 'light_ns_left',
      type: 'street_furniture',
      tags: {
        highway: 'traffic_signals',
        'traffic_signals:direction': 'left',
      },
      geometry: [{ lat: 0.54, lng: 0.50002 }],
    },
    ...nsThroughSignals,
    {
      id: 'light_ew_through',
      type: 'street_furniture',
      tags: {
        highway: 'traffic_signals',
        'traffic_signals:direction': 'forward',
      },
      geometry: [{ lat: 0.50002, lng: 0.54 }],
    },
  ]);

  const signalData = buildBeamNGSignalData(terrainData, 1);
  assert.equal(signalData.sequences.length, 1);

  const nsControllerIds = new Set(
    signalData.controllers
      .filter((controller) => String(controller.name).includes('_ns'))
      .map((controller) => controller.id),
  );
  assert.ok(nsControllerIds.size >= 2);

  let minStart = Number.POSITIVE_INFINITY;
  let maxEnd = Number.NEGATIVE_INFINITY;
  for (const phase of signalData.sequences[0].phases) {
    const hasNsController = (phase.controllerIds || []).some((id) => nsControllerIds.has(id));
    if (!hasNsController) continue;
    const start = Number(phase.startTime ?? 0);
    const end = start + Number(phase.totalDuration ?? 0);
    minStart = Math.min(minStart, start);
    maxEnd = Math.max(maxEnd, end);
  }

  const nsSpan = maxEnd - minStart;
  assert.ok(nsSpan > 14);
  assert.ok(nsSpan <= 35);
});
