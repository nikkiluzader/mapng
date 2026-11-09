import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_POINTS, sanitizePoints, cleanPointName, snapToCarriageway, planSpawnPoints, headingRotationMatrix,
  bearingDeg, pointInBounds, spawnReportLines, DEFAULT_SPAWN_OBJECT,
} from '../services/spawnPoints.js';
import { buildSessionConfig, describeSessionConfig, encodeSessionCode, encodeSessionCodeWithin, parseSessionText, configPoints } from '../services/sessionConfig.js';
import { summarizeExportSettings } from '../services/exportSettingsSummary.js';

const storage = { getItem: () => null, setItem() {} };
const line = (x0, y0, x1, y1, z, n = 11) => Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), y0 + ((y1 - y0) * i) / (n - 1), typeof z === 'function' ? z(i / (n - 1)) : z]);

test('points are cleaned: finite, capped, unique ids, one default, kind follows the default', () => {
  const many = Array.from({ length: 80 }, (_, i) => ({ id: 'a', lat: 10 + i * 1e-4, lng: 20, name: `P${i}`, heading: -90, isDefault: i === 3 || i === 5 }));
  const out = sanitizePoints([{ lat: 'x', lng: 1 }, { lat: 95, lng: 0 }, null, ...many]);
  assert.equal(out.length, MAX_POINTS);
  assert.equal(new Set(out.map((p) => p.id)).size, MAX_POINTS);
  assert.deepEqual(out.filter((p) => p.isDefault).map((p) => p.name), ['P3']);
  assert.equal(out[3].kind, 'spawn');
  assert.equal(out[5].kind, 'quicktravel');
  assert.equal(out[0].heading, 270);
  // an older list that marked the spawn by kind only
  const byKind = sanitizePoints([{ lat: 1, lng: 1 }, { lat: 2, lng: 2, kind: 'spawn' }]);
  assert.equal(byKind[1].isDefault, true);
  // the same input gives the same ids (codes stay stable)
  assert.deepEqual(sanitizePoints([{ lat: 1, lng: 2 }]), sanitizePoints([{ lat: 1, lng: 2 }]));
});

test('names: no translation-key look, no i18n syntax, no control characters, short', () => {
  assert.equal(cleanPointName('  levels.ui.Pit {Lane} | @home\n'), 'Pit Lane home');
  assert.equal(cleanPointName('Grand-mère’s café'), 'Grand-mère’s café');
  assert.equal(cleanPointName('x'.repeat(100)).length, 48);
});

test('bearing and rotation: 0 = north, clockwise; the car faces the sphere\'s -Y', () => {
  assert.equal(bearingDeg({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }), 90);
  assert.equal(bearingDeg({ lat: 0, lng: 0 }, { lat: -1, lng: 0 }), 180);
  // facing north: the sphere's +Y row points south (measured in game: the car drives off along -Y)
  assert.deepEqual(headingRotationMatrix(0), [-1, 0, 0, 0, -1, 0, 0, 0, 1]);
  // facing east: +Y row is -x
  assert.deepEqual(headingRotationMatrix(90), [0, 1, 0, -1, 0, 0, 0, 0, 1]);
});

// A synthetic scene: a ground street running east at z 10, an overpass deck
// crossing it north-south at z 17, and a tunnel road further east at z 4
// under a hill.
const street = { highway: 'residential', half: 4, nodes: line(-200, 0, 200, 0, 10), tags: { name: 'Low Street' } };
const deck = { highway: 'primary', half: 5, bridge: true, nodes: line(0, -100, 0, 100, 17), tags: { name: 'High Road' } };
const tunnel = { highway: 'secondary', half: 4, tunnel: true, nodes: line(150, -100, 150, 100, 4), tags: { ref: 'B 12' } };
const oneWay = { highway: 'tertiary', half: 3, oneWay: true, nodes: line(-200, 60, -100, 60, 12) };
const footway = { highway: 'footway', half: 1, nodes: line(-200, -40, 200, -40, 10) };
const roads = [street, deck, tunnel, oneWay, footway];

test('snap: at a crossing the arrow picks the deck or the street, and z is that surface', () => {
  const onDeck = snapToCarriageway(1, 2, 0, roads);
  assert.equal(onDeck.layer, 'bridge');
  assert.equal(onDeck.road, 'High Road');
  assert.ok(Math.abs(onDeck.z - 17) < 1e-9, 'deck height, not the street or terrain below');
  assert.equal(onDeck.heading, 0);
  const onStreet = snapToCarriageway(1, 2, 85, roads);
  assert.equal(onStreet.layer, 'ground');
  assert.ok(Math.abs(onStreet.z - 10) < 1e-9);
  assert.equal(onStreet.heading, 90);
  // keep right: facing east, the car is south of the centreline by a quarter of the width
  assert.ok(Math.abs(onStreet.y + 2) < 1e-9);
  const left = snapToCarriageway(1, 2, 85, roads, { leftHandTraffic: true });
  assert.ok(Math.abs(left.y - 2) < 1e-9);
  // an arrow at 45 degrees with nothing between: the ground road wins the tie
  assert.equal(snapToCarriageway(0, 0, 45, roads).layer, 'ground');
});

test('snap: tunnel roads at their own height; one-way faces its way; footways are not drivable', () => {
  const inTunnel = snapToCarriageway(148, 30, 180, roads);
  assert.equal(inTunnel.layer, 'tunnel');
  assert.equal(inTunnel.road, 'B 12');
  assert.ok(Math.abs(inTunnel.z - 4) < 1e-9);
  assert.equal(inTunnel.heading, 180);
  const ow = snapToCarriageway(-150, 61, 270, roads);
  assert.equal(ow.heading, 90);
  assert.equal(ow.againstOneWay, true);
  assert.ok(Math.abs(ow.y - 60) < 1e-9, 'one-way: on the centreline');
  // near the footway only: nothing drivable within reach
  assert.equal(snapToCarriageway(-100, -40, 0, roads), null);
});

const bounds = { north: 1, south: -1, east: 1, west: -1 };
// 1 degree = 200 m here: lat/lng straight onto the scene
const project = (lat, lng) => [lng * 200, lat * 200, 0];

test('plan: default first as spawn_default, others by id, outside skipped, off-road on the ground', () => {
  const pts = [
    { id: 'aa1', name: 'Quick one', lat: 0.01, lng: 0.005, heading: 0 },
    { id: 'bb2', name: 'Start', lat: 0.005, lng: -0.5, heading: 80, isDefault: true, description: 'By the street' },
    { id: 'cc3', name: 'Far away', lat: 5, lng: 5, heading: 0 },
    { id: 'dd4', name: '', lat: -0.6, lng: -0.6, heading: 33 },
  ];
  const plan = planSpawnPoints(pts, { bounds, project, carriageways: roads, groundAt: () => 7, autoSpawn: { position: [1, 2, 3], rotationMatrix: headingRotationMatrix(0) } });
  assert.equal(plan.used, true);
  assert.deepEqual(plan.spheres.map((s) => s.name), [DEFAULT_SPAWN_OBJECT, 'spawn_mapng_aa1', 'spawn_mapng_dd4']);
  assert.deepEqual(plan.spawnPoints.map((e) => e.translationId), ['Start', 'Quick one', 'Point 4']);
  assert.equal(plan.spawnPoints[0].description, 'By the street');
  assert.equal(plan.spawnPoints[0].preview, 'spawn_bb2.jpg');
  assert.deepEqual(plan.spheres[0].position, [-100, -2, 10.5]);          // on Low Street, keep-right lane, +0.5 m
  assert.deepEqual(plan.spheres[1].position.slice(2), [17.5]);           // on the deck
  assert.deepEqual(plan.spheres[2].position, [-120, -120, 7.5]);        // off road: the ground
  assert.deepEqual(plan.spheres[2].rotationMatrix, headingRotationMatrix(33));
  assert.equal(plan.previews.length, 3);
  const skipped = plan.report.find((r) => r.id === 'cc3');
  assert.equal(skipped.skipped, true);
  const lines = spawnReportLines(plan.report).join('\n');
  assert.match(lines, /Start \(default spawn\): on Low Street \(ground/);
  assert.match(lines, /Far away: skipped, outside the map/);
  assert.match(lines, /Point 4: off road, x -120 y -120 z 7.5/);
});

test('plan: no points keeps today\'s automatic spawn exactly; points without a default keep it first', () => {
  const autoSpawn = { position: [1, 2, 3], rotationMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
  const none = planSpawnPoints([], { bounds, project, carriageways: roads, autoSpawn });
  assert.equal(none.used, false);
  assert.deepEqual(none.spawnPoints, [{ name: 'Default', objectname: 'spawn_default', preview: 'preview.png', translationId: 'Default Spawnpoint' }]);
  assert.deepEqual(none.spheres, [{ name: 'spawn_default', position: [1, 2, 3], rotationMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] }]);
  const quick = planSpawnPoints([{ id: 'q', lat: 0, lng: 0.5, heading: 90 }], { bounds, project, carriageways: roads, autoSpawn });
  assert.deepEqual(quick.spheres.map((s) => s.name), ['spawn_default', 'spawn_mapng_q']);
  assert.deepEqual(quick.spheres[0].position, [1, 2, 3]);
  assert.equal(pointInBounds({ lat: 2, lng: 0 }, bounds), false);
});

test('session config: points travel in codes, checked on the way in; the short code drops them last', async () => {
  const pts = [{ id: 'x1', name: 'Hill top', lat: 0.5, lng: 0.5, heading: 10, isDefault: true }, { id: 'x2', name: 'Harbour', lat: 0.4, lng: 0.6, heading: 0 }];
  const cfg = buildSessionConfig({ center: { lat: 0.5, lng: 0.5 }, resolution: 1024 }, storage, { points: pts });
  const back = await parseSessionText(await encodeSessionCode(cfg));
  assert.deepEqual(configPoints(back), sanitizePoints(pts));
  assert.equal(buildSessionConfig({ center: { lat: 0.5, lng: 0.5 } }, storage, { points: [] }).points, undefined);
  const rows = describeSessionConfig(back);
  const row = rows.find((r) => r.label === 'config.points');
  assert.deepEqual(row.params, { n: 2, name: 'Hill top' });
  // a hostile code: bad entries dropped, names cleaned
  assert.deepEqual(configPoints({ points: [{ lat: 'NaN', lng: 0 }, { lat: 1, lng: 1, name: 'levels.{x}' }] }).map((p) => p.name), ['x']);
  // 64 long-named points fit a short code as they are
  const full = Array.from({ length: 64 }, (_, i) => ({ name: `Viewpoint number ${i} over the valley`, lat: 0.5 + i * 1e-3, lng: 0.5 - i * 1e-3, heading: i * 5, description: 'd'.repeat(200) }));
  const fits = await encodeSessionCodeWithin(buildSessionConfig({ center: { lat: 0.5, lng: 0.5 } }, storage, { points: full }));
  assert.deepEqual(fits.dropped, []);
  // over the cap: the mask goes first, then the points
  const big = { center: { lat: 0, lng: 0 }, backgroundMask: { version: 1, bounds: {}, lines: [Array.from({ length: 4000 }, () => [Math.random(), Math.random()])] }, points: sanitizePoints(full) };
  const squeezed = await encodeSessionCodeWithin(big, 16000);
  assert.deepEqual(squeezed.dropped, ['backgroundMask']);
  const tiny = await encodeSessionCodeWithin(big, 200);
  assert.deepEqual(tiny.dropped, ['backgroundMask', 'points']);
});

test('settings summary: a points row only when there are points', () => {
  const rows = (o) => summarizeExportSettings(o).find((g) => g.key === 'groupOutput').rows.map((r) => r.key);
  assert.equal(rows({}).includes('points'), false);
  assert.equal(rows({ points: [{ name: 'A', isDefault: true }] }).includes('points'), true);
});

test('snap: the solver\'s drawn height wins over the height a road was laid at (v2 decks)', async () => {
  const { solvedHeightAt } = await import('../services/structures/adapters.js');
  // one graph edge for road 7: a deck rising 12 → 18 m over 100 m, its carriageway still laid at the ground's 10 m
  const graph = { edges: [{ seg: 7, s: [0, 50, 100], x: [0, 0, 0], y: [-50, 0, 50] }], profile: { z: [[12, 15, 18]] } };
  assert.equal(solvedHeightAt(graph, 7, 1, 25), 16.5);
  assert.equal(solvedHeightAt(graph, 8, 1, 25), null);
  const laid = { highway: 'primary', half: 5, bridge: true, owner: 7, nodes: line(0, -50, 0, 50, 10) };
  const snap = snapToCarriageway(1, 25, 0, [laid], { surfaceAt: (cw, x, y) => solvedHeightAt(graph, cw.owner, x, y) });
  assert.ok(Math.abs(snap.z - 16.5) < 1e-9);
  // without a solved height (a tunnel road), the laid height stands
  assert.equal(snapToCarriageway(1, 25, 0, [laid], { surfaceAt: () => null }).z, 10);
});

test('an off-road point on a cliff moves to flat ground nearby; on flat ground it stays', async () => {
  const { flattestNear } = await import('../services/spawnPoints.js');
  // a cliff rising east of x = 0 (100 %), flat to the west of x = -10
  const groundAt = (x) => (x > -10 ? Math.max(0, x + 10) : 0);
  const moved = flattestNear(5, 0, groundAt);
  assert.ok(moved.moved > 0 && moved.x <= -10 + 2.5, `moved to x ${moved.x}`);
  assert.ok(moved.slope <= 0.3);
  const stays = flattestNear(-20, 0, groundAt);
  assert.equal(stays.moved, 0);
});
