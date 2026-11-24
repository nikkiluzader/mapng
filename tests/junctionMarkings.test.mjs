import test from 'node:test';
import assert from 'node:assert/strict';

import { generateJunctionMarkingDecals, generateTurnArrowDecals } from '../services/exportBeamNGLevel.js';
import { buildCarriagewayIndex } from '../services/roadMarkingCuts.js';

const W = 256;
const SQUARE_SIZE = 2; // 512 m world
const CENTER_LAT = 30.0;
const CENTER_LNG = -81.5;

function makeTerrainData(osmFeatures) {
  const halfM = (W * SQUARE_SIZE) / 2;
  const dLat = halfM / 111320;
  const dLng = halfM / (111320 * Math.cos((CENTER_LAT * Math.PI) / 180));
  return {
    width: W,
    height: W,
    heightMap: new Float32Array(W * W).fill(5),
    minHeight: 5,
    bounds: {
      north: CENTER_LAT + dLat,
      south: CENTER_LAT - dLat,
      east: CENTER_LNG + dLng,
      west: CENTER_LNG - dLng,
    },
    osmFeatures,
  };
}

const point = (lat, lng, tags) => ({ id: 'n1', type: 'poi', geometry: [{ lat, lng }], tags });

test('stop node paints a bar on the approach half; crossing paints two lines', () => {
  const lat = CENTER_LAT;
  const dLng = 0.001; // ~96 m steps along x
  // A cross street 0.2 · dLng (~19 m) past the stop: the stop applies there.
  const junctionLng = CENTER_LNG + 1.2 * dLng;
  const road = {
    id: 'w1', type: 'road',
    tags: { highway: 'residential' },
    geometry: [...[-2, -1, 0, 1].map((k) => ({ lat, lng: CENTER_LNG + k * dLng })), { lat, lng: junctionLng }, { lat, lng: CENTER_LNG + 2 * dLng }],
  };
  const cross = {
    id: 'w2', type: 'road', tags: { highway: 'secondary' },
    geometry: [{ lat: lat - 0.001, lng: junctionLng }, { lat, lng: junctionLng }, { lat: lat + 0.001, lng: junctionLng }],
  };
  const stop = point(lat, CENTER_LNG + dLng, { highway: 'stop', direction: 'forward' });
  const crossing = point(lat, CENTER_LNG - dLng, { highway: 'crossing', crossing: 'marked' });

  const decals = generateJunctionMarkingDecals(makeTerrainData([road, cross, stop, crossing]), SQUARE_SIZE);

  const bars = decals.filter((d) => d.name.startsWith('jm_stopline'));
  const cw = decals.filter((d) => d.name.startsWith('jm_crosswalk'));
  assert.equal(bars.length, 1);
  assert.equal(cw.length, 2, 'transverse crosswalk = two lines');

  const bar = bars[0];
  assert.equal(bar.class, 'DecalRoad');
  assert.equal(bar.material, 'm_line_white');
  assert.equal(bar.nodes.length, 2);
  assert.equal(bar.nodes[0][3], 0.45, 'stop bar thickness');
  // Road runs west→east; forward approach right side is south (negative world Y).
  assert.ok(bar.nodes.every((n) => n[1] <= 0.01), 'bar on the approach (south) half');
  const span = Math.hypot(bar.nodes[1][0] - bar.nodes[0][0], bar.nodes[1][1] - bar.nodes[0][1]);
  assert.ok(span > 1 && span < 4, `bar spans the approach lanes (got ${span.toFixed(2)} m)`);

  // Crosswalk lines are perpendicular to the road (constant x per line) and
  // straddle the crossing node 2.4 m apart along it.
  const xs = cw.map((d) => (d.nodes[0][0] + d.nodes[1][0]) / 2).sort((a, b) => a - b);
  assert.ok(Math.abs(xs[1] - xs[0] - 2.4) < 0.05, `lines 2.4 m apart (got ${(xs[1] - xs[0]).toFixed(2)})`);
});

test('a crossing mapped with its paved outline is painted once, in the line\'s style', () => {
  // A road along x (y = 0, 8 m wide); a crossing line across it at x = 0
  // tagged lines, and the same crossing's area:highway outline round it.
  const td = makeTerrainData([]);
  const m = (W * SQUARE_SIZE) / 2;
  const ll = (x, y) => ({
    lat: td.bounds.south + ((y + m) / (2 * m)) * (td.bounds.north - td.bounds.south),
    lng: td.bounds.west + ((x + m) / (2 * m)) * (td.bounds.east - td.bounds.west),
  });
  const line = { id: 'w3', type: 'road', tags: { highway: 'footway', footway: 'crossing', 'crossing:markings': 'lines' }, geometry: [ll(0, -7), ll(0, 0), ll(0, 7)] };
  const area = { id: 'w4', type: 'area', tags: { 'area:highway': 'footway', footway: 'crossing' }, geometry: [ll(-1.5, -7), ll(1.5, -7), ll(1.5, 7), ll(-1.5, 7), ll(-1.5, -7)] };
  const road = { id: 'w5', type: 'road', tags: { highway: 'residential' }, geometry: [ll(-60, 0), ll(0, 0), ll(60, 0)] };
  td.osmFeatures = [road, line, area];
  const carriageways = buildCarriagewayIndex([{ owner: 'r', half: 4, nodes: [[-60, 0, 5, 8], [60, 0, 5, 8]] }]);
  const decals = generateJunctionMarkingDecals(td, SQUARE_SIZE, { carriageways });
  assert.equal(decals.filter((d) => d.name.startsWith('jm_zebra')).length, 0, 'no zebra from the outline');
  assert.equal(decals.filter((d) => d.name.startsWith('jm_crosswalk')).length, 2);
});

test('a signal on the junction node paints a bar on every approach, outside the junction', () => {
  const lat = CENTER_LAT;
  const dLng = 0.001;
  const dLat = 0.001;
  const roadA = {
    id: 'wa', type: 'road', tags: { highway: 'residential' },
    geometry: [-1, 0, 1].map((k) => ({ lat, lng: CENTER_LNG + k * dLng })),
  };
  const roadB = {
    id: 'wb', type: 'road', tags: { highway: 'residential' },
    geometry: [-1, 0, 1].map((k) => ({ lat: lat + k * dLat, lng: CENTER_LNG })),
  };
  // Signal mapped on the junction node itself (common older mapping).
  const junctionSignal = point(lat, CENTER_LNG, { highway: 'traffic_signals' });
  // Unmarked crossing → no crosswalk.
  const unmarked = point(lat, CENTER_LNG + dLng, { highway: 'crossing', crossing: 'unmarked' });

  const decals = generateJunctionMarkingDecals(
    makeTerrainData([roadA, roadB, junctionSignal, unmarked]),
    SQUARE_SIZE,
  );
  const bars = decals.filter((d) => d.name.startsWith('jm_stopline'));
  assert.equal(bars.length, 4, 'one stop bar per approach');
  assert.equal(decals.filter((d) => d.name.startsWith('jm_crosswalk')).length, 0);
  for (const bar of bars) {
    const mid = [(bar.nodes[0][0] + bar.nodes[1][0]) / 2, (bar.nodes[0][1] + bar.nodes[1][1]) / 2];
    assert.ok(Math.hypot(...mid) >= 6, 'bar stands outside the junction (world origin)');
  }
});

test('turn:lanes places one arrow per lane, ordered left-to-right across travel', () => {
  const lat = CENTER_LAT;
  const dLng = 0.001;
  // West→east one-way approach ending at a junction with a cross road.
  const approach = {
    id: 'w1', type: 'road',
    tags: { highway: 'primary', oneway: 'yes', lanes: '3', 'turn:lanes': 'left|through|right' },
    geometry: [-2, -1, 0].map((k) => ({ lat, lng: CENTER_LNG + k * dLng })),
  };
  const cross = {
    id: 'w2', type: 'road', tags: { highway: 'residential' },
    geometry: [{ lat: lat - 0.001, lng: CENTER_LNG }, { lat, lng: CENTER_LNG }, { lat: lat + 0.001, lng: CENTER_LNG }],
  };

  const arrows = generateTurnArrowDecals(makeTerrainData([approach, cross]), SQUARE_SIZE);
  assert.equal(arrows.length, 3);

  // Travel is +x; driver-right is -y (south). Leftmost lane (left arrow)
  // sits at the largest y.
  const sorted = [...arrows].sort((a, b) => b[4] - a[4]); // by world Y desc
  assert.deepEqual(sorted.map((a) => a[0]), [0, 2, 1], 'left, through, right across the roadway');
  // All set back from the junction end (junction at x=0).
  assert.ok(arrows.every((a) => a[3] < -2), 'arrows sit before the junction');
  // Tangent = driver-LEFT = +y (the stencil renders its "up" along
  // −(normal × tangent); driver-right tangents drew arrows 180° rotated).
  assert.ok(arrows.every((a) => a[10] > 0.99), 'tangent points driver-left');

  // No arrows when the tagged end is a dead end.
  const deadEnd = { ...approach, id: 'w3', geometry: approach.geometry.map((p) => ({ ...p, lat: p.lat + 0.01 })) };
  assert.equal(generateTurnArrowDecals(makeTerrainData([deadEnd]), SQUARE_SIZE).length, 0);
});

test('on the drawn carriageway the arrows stand in the lanes its lines divide, behind the stop bar', () => {
  // a two-way street along x, 12 m driving width, two lanes each way (lanes:forward 2), its forward end at x = 0;
  // turn:lanes:forward left|through; a stop bar 10 m back from the junction
  const lat = CENTER_LAT;
  const dLng = 0.001;
  const street = {
    id: 'w1', type: 'road',
    tags: { highway: 'secondary', lanes: '4', 'lanes:forward': '2', 'lanes:backward': '2', 'turn:lanes:forward': 'left|through' },
    geometry: [-2, -1, 0].map((k) => ({ lat, lng: CENTER_LNG + k * dLng })),
  };
  const cross = {
    id: 'w2', type: 'road', tags: { highway: 'residential' },
    geometry: [{ lat: lat - 0.001, lng: CENTER_LNG }, { lat, lng: CENTER_LNG }, { lat: lat + 0.001, lng: CENTER_LNG }],
  };
  const nodes = []; for (let x = -190; x <= 0.01; x += 2) nodes.push([x, 0, 0, 6]);
  const carriageways = [{ wayId: 'w1', nodes, half: 6, drivingHalf: 6, laneShift: 0, highway: 'secondary', tags: street.tags, trimEnd: 4, trimStart: 0 }];
  const stops = [{ x: -10, y: -3, dir: [1, 0] }];
  const arrows = generateTurnArrowDecals(makeTerrainData([street, cross]), SQUARE_SIZE, { carriageways, stops });
  assert.equal(arrows.length, 2);
  // the lines: edge offset 6 - 0.3 = 5.7, the centre line at 0, the forward lanes on the right (-y): [-5.7, -2.85], [-2.85, 0]
  const left = arrows.find((a) => a[0] === 0); const through = arrows.find((a) => a[0] === 2);
  assert.ok(Math.abs(left[4] - -1.425) < 0.05, `left arrow in the lane next to the centre line: y ${left[4]}`);
  assert.ok(Math.abs(through[4] - -4.275) < 0.05, `through arrow in the kerb lane: y ${through[4]}`);
  // behind the stop bar: the tip (centre + size / 2) at least 1.5 m before x = -10
  for (const a of arrows) assert.ok(a[3] + a[1] / 2 <= -10 - 1.49, `tip behind the stop bar: x ${a[3]}, size ${a[1]}`);
  // the stencil at most a little wider than its lane (the glyph is a third of it)
  for (const a of arrows) assert.ok(a[1] <= 2.85 * 1.35 + 0.01);
});

test('a crossing node tagged as a zebra paints the zebra bars, in the Americas too (coverage level, 2026-11-24)', () => {
  const lat = CENTER_LAT; const dLng = 0.001;
  const road = { id: 'w1', type: 'road', tags: { highway: 'residential' }, geometry: [-2, -1, 0, 1, 2].map((k) => ({ lat, lng: CENTER_LNG + k * dLng })) };
  for (const tags of [{ highway: 'crossing', crossing: 'zebra' }, { highway: 'crossing', crossing_ref: 'zebra' }, { highway: 'crossing', 'crossing:markings': 'zebra' }]) {
    const decals = generateJunctionMarkingDecals(makeTerrainData([road, point(lat, CENTER_LNG, tags)]), SQUARE_SIZE);
    assert.equal(decals.filter((d) => d.name.startsWith('jm_zebra')).length, 1, `zebra bars for ${JSON.stringify(tags)}`);
    assert.equal(decals.filter((d) => d.name.startsWith('jm_crosswalk')).length, 0, 'no lines then');
  }
  const plain = generateJunctionMarkingDecals(makeTerrainData([road, point(lat, CENTER_LNG, { highway: 'crossing', crossing: 'marked' })]), SQUARE_SIZE);
  assert.equal(plain.filter((d) => d.name.startsWith('jm_crosswalk')).length, 2, 'unsaid, the Americas\' two lines');
});

import { parseOverpassResponse } from '../services/osm.js';
test('a crossing mapped only as a node on the road is read, and painted (coverage level, 2026-11-24)', () => {
  const lat = CENTER_LAT; const dLng = 0.001;
  const b = makeTerrainData([]).bounds;
  const els = [-2, -1, 0, 1, 2].map((k, i) => ({ type: 'node', id: 100 + i, lat, lon: CENTER_LNG + k * dLng }));
  els[2].tags = { highway: 'crossing', crossing: 'marked' };
  els.push({ type: 'way', id: 9, nodes: els.map((e) => e.id), geometry: els.map((e) => ({ lat: e.lat, lon: e.lon })), tags: { highway: 'residential' } });
  const features = parseOverpassResponse({ elements: els }, b);
  assert.equal(features.filter((f) => f.type === 'crossing').length, 1, 'the node is kept');
  const decals = generateJunctionMarkingDecals(makeTerrainData(features), SQUARE_SIZE);
  assert.equal(decals.filter((d) => d.name.startsWith('jm_crosswalk')).length, 2, 'and painted');
});
