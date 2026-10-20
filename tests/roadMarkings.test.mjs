import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLineMarkingLayers } from '../services/exportBeamNGLevel.js';

const mats = (layers) => layers.map((l) => l.material).sort();
const byName = (layers, name) => layers.filter((l) => l.name.startsWith(name));

test('one-way major road: no center line, dashed separators, yellow travel-left edge', () => {
  const layers = buildLineMarkingLayers('trunk', { oneway: 'yes', lanes: '3' }, 5.55);

  assert.equal(byName(layers, 'line_center').length, 0, 'one-way roads must not get a center line');
  assert.ok(!mats(layers).includes('m_line_yellow_double'), 'no double-yellow on a one-way carriageway');

  const seps = byName(layers, 'line_sep_');
  assert.equal(seps.length, 2, '3 lanes → 2 separators');
  assert.ok(seps.every((l) => l.material === 'm_line_white_discontinue'));

  // Travel-left (positive offset for forward digitization) edge is yellow.
  const yellow = layers.find((l) => l.material === 'm_line_yellow');
  const white = layers.find((l) => l.material === 'm_line_white');
  assert.ok(yellow && white, 'one yellow and one white edge line');
  assert.ok(yellow.offset > 0, 'yellow edge on travel-left (positive offset)');
  assert.ok(white.offset < 0, 'white edge on travel-right (negative offset)');
});

test('oneway=-1 flips the yellow edge to the negative-offset side', () => {
  const layers = buildLineMarkingLayers('trunk', { oneway: '-1', lanes: '2' }, 5);
  const yellow = layers.find((l) => l.material === 'm_line_yellow');
  assert.ok(yellow.offset < 0, 'reverse one-way: travel-left is the negative-offset side');
});

test('two-way major road: double-yellow center, per-direction separators, white edges', () => {
  const layers = buildLineMarkingLayers('trunk', { lanes: '4' }, 7.4);

  const center = byName(layers, 'line_center');
  assert.equal(center.length, 1);
  assert.equal(center[0].material, 'm_line_yellow_double');
  assert.ok(Math.abs(center[0].offset) < 1e-9, 'symmetric lanes → center divider at offset 0');

  assert.equal(byName(layers, 'line_sep_').length, 2, '2 lanes per direction → 1 separator each side');

  const edges = layers.filter((l) => l.material === 'm_line_white' && (l.name === 'line_left' || l.name === 'line_right'));
  assert.equal(edges.length, 2, 'major two-way roads keep both white edge lines');
});

test('asymmetric lanes shift the center divider toward the minority side', () => {
  const E = 5 - 0.3; // edge lines 0.3 m inside the carriageway
  const layers = buildLineMarkingLayers('primary', { lanes: '3', 'lanes:forward': '2', 'lanes:backward': '1' }, 5);
  const center = byName(layers, 'line_center')[0];
  // Forward lanes ride the negative-offset side; 2-of-3 lanes forward puts the
  // divider at +E/3.
  assert.ok(Math.abs(center.offset - E / 3) < 1e-9, `expected ${E / 3}, got ${center.offset}`);
});

test('minor two-way road: centre line only — yellow in the Americas, dashed white elsewhere', () => {
  const americas = buildLineMarkingLayers('tertiary', {}, 4);
  assert.equal(americas.length, 1);
  assert.equal(americas[0].name, 'line_center');
  assert.equal(americas[0].material, 'm_line_yellow_double');

  const white = buildLineMarkingLayers('tertiary', {}, 4, { style: 'white' });
  assert.equal(white.length, 1);
  assert.equal(white[0].material, 'm_line_white_discontinue');
});

test('overtaking tags pick dashed or solid centre lines', () => {
  const centre = (tags, style) => buildLineMarkingLayers('primary', tags, 4, { style })
    .find((l) => l.name === 'line_center').material;
  assert.equal(centre({ overtaking: 'yes' }, 'americas'), 'm_line_yellow_discontinue');
  assert.equal(centre({}, 'americas'), 'm_line_yellow_double');
  assert.equal(centre({ overtaking: 'no' }, 'white'), 'm_line_white');
  assert.equal(centre({}, 'white'), 'm_line_white_discontinue');
});

test('narrow two-way roads get no centre line', () => {
  assert.equal(buildLineMarkingLayers('tertiary', {}, 2.5).length, 0);
});

test('urban streets with sidewalks get no edge lines; rural ones do', () => {
  const edges = (opts, tags = {}) => buildLineMarkingLayers('primary', tags, 4, opts)
    .filter((l) => l.name === 'line_left' || l.name === 'line_right').length;
  assert.equal(edges({ urban: true }, { sidewalk: 'both' }), 0);
  assert.equal(edges({ urban: true }, {}), 2, 'no sidewalk tagged: keep edge lines');
  assert.equal(edges({ urban: false }, { sidewalk: 'both' }), 2);
});

test('one-way main road: median edge yellow in the Americas, white elsewhere', () => {
  const median = (style) => buildLineMarkingLayers('trunk', { oneway: 'yes', lanes: '2' }, 4, { style })
    .find((l) => l.name === 'line_right').material;
  assert.equal(median('americas'), 'm_line_yellow');
  assert.equal(median('white'), 'm_line_white');
});

test('roundabout (implied one-way, minor class): no markings at default lane count', () => {
  const layers = buildLineMarkingLayers('tertiary', { junction: 'roundabout' }, 4);
  assert.equal(layers.length, 0, 'single default lane, non-major: nothing to paint');
});

test('absurd lane counts are capped', () => {
  const layers = buildLineMarkingLayers('trunk', { oneway: 'yes', lanes: '12' }, 9);
  assert.equal(byName(layers, 'line_sep_').length, 6);
});
