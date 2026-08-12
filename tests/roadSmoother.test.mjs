import test from 'node:test';
import assert from 'node:assert/strict';

import { smoothRoadsInHeightmap } from '../services/roadSmoother.js';

const W = 256;
const H = 256;
const CENTER_LAT = 47.0;
const CENTER_LNG = 8.0;

function makeBounds(widthPx, heightPx, mpp) {
  const halfWidthM = (widthPx * mpp) / 2;
  const halfHeightM = (heightPx * mpp) / 2;
  const dLat = halfHeightM / 111320;
  const dLng = halfWidthM / (111320 * Math.cos((CENTER_LAT * Math.PI) / 180));
  return {
    north: CENTER_LAT + dLat,
    south: CENTER_LAT - dLat,
    east: CENTER_LNG + dLng,
    west: CENTER_LNG - dLng,
  };
}

// Inverse of the metric projector's (approximately linear) pixel mapping.
function lngAtPx(bounds, x) {
  return bounds.west + (x / (W - 1)) * (bounds.east - bounds.west);
}
function latAtPy(bounds, y) {
  return bounds.north - (y / (H - 1)) * (bounds.north - bounds.south);
}

// Stair-stepped slope along +x: 1 m riser every 30 m — the quantized-DEM
// pattern the smoother exists to remove.
function makeStairHeightmap(mpp) {
  const hm = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      hm[y * W + x] = Math.floor((x * mpp) / 30);
    }
  }
  return hm;
}

function maxAdjacentDiffAlongRow(hm, row, xFrom, xTo) {
  let maxDiff = 0;
  for (let x = xFrom; x < xTo; x++) {
    maxDiff = Math.max(maxDiff, Math.abs(hm[row * W + x + 1] - hm[row * W + x]));
  }
  return maxDiff;
}

function maxAdjacentDiffAlongCol(hm, col, yFrom, yTo) {
  let maxDiff = 0;
  for (let y = yFrom; y < yTo; y++) {
    maxDiff = Math.max(maxDiff, Math.abs(hm[(y + 1) * W + col] - hm[y * W + col]));
  }
  return maxDiff;
}

test('removes DEM stair-steps along a straight road', () => {
  const mpp = 2;
  const bounds = makeBounds(W, H, mpp);
  const hm = makeStairHeightmap(mpp);
  const raw = hm.slice();

  const road = {
    type: 'road',
    id: 'a',
    tags: { highway: 'residential' },
    geometry: [
      { lat: CENTER_LAT, lng: lngAtPx(bounds, 20) },
      { lat: CENTER_LAT, lng: lngAtPx(bounds, 235) },
    ],
  };

  smoothRoadsInHeightmap(hm, W, H, bounds, [road], mpp, false, true);

  // Center row (the road runs along y≈127.5; row 127 is inside the flat core).
  const rawMax = maxAdjacentDiffAlongRow(raw, 127, 40, 215);
  const smoothMax = maxAdjacentDiffAlongRow(hm, 127, 40, 215);
  assert.equal(rawMax, 1, 'fixture should contain 1 m risers');
  assert.ok(
    smoothMax < 0.2,
    `road profile should be smooth (max adjacent diff ${smoothMax.toFixed(3)} m, raw ${rawMax} m)`,
  );

  // Sanity: the smoother actually rewrote the road corridor.
  let changed = 0;
  for (let x = 40; x <= 215; x++) {
    if (Math.abs(hm[127 * W + x] - raw[127 * W + x]) > 0.05) changed++;
  }
  assert.ok(changed > 20, `expected the corridor to be modified (changed=${changed})`);
});

test('crossing roads stay continuous through the junction', () => {
  const mpp = 2;
  const bounds = makeBounds(W, H, mpp);
  const hm = makeStairHeightmap(mpp);

  // Both ways share the exact center node, like OSM intersections do.
  const roadA = {
    type: 'road',
    id: 'a',
    tags: { highway: 'residential' },
    geometry: [
      { lat: CENTER_LAT, lng: lngAtPx(bounds, 20) },
      { lat: CENTER_LAT, lng: CENTER_LNG },
      { lat: CENTER_LAT, lng: lngAtPx(bounds, 235) },
    ],
  };
  const roadB = {
    type: 'road',
    id: 'b',
    tags: { highway: 'residential' },
    geometry: [
      { lat: latAtPy(bounds, 235), lng: CENTER_LNG },
      { lat: CENTER_LAT, lng: CENTER_LNG },
      { lat: latAtPy(bounds, 20), lng: CENTER_LNG },
    ],
  };

  smoothRoadsInHeightmap(hm, W, H, bounds, [roadA, roadB], mpp, false, true);

  // Walk each road's core straight through the junction: no vertical crease.
  const alongA = maxAdjacentDiffAlongRow(hm, 127, 40, 215);
  const alongB = maxAdjacentDiffAlongCol(hm, 127, 40, 215);
  assert.ok(alongA < 0.25, `road A should be continuous through the junction (max diff ${alongA.toFixed(3)} m)`);
  assert.ok(alongB < 0.25, `road B should be continuous through the junction (max diff ${alongB.toFixed(3)} m)`);

  // The two roads must agree on the junction elevation itself: compare the
  // terrain a few metres out along each arm against the junction pixel.
  const cz = hm[127 * W + 127];
  const alongANear = hm[127 * W + 122];
  const alongBNear = hm[122 * W + 127];
  assert.ok(Math.abs(alongANear - cz) < 0.5, `road A approach disagrees with junction (${Math.abs(alongANear - cz).toFixed(3)} m)`);
  assert.ok(Math.abs(alongBNear - cz) < 0.5, `road B approach disagrees with junction (${Math.abs(alongBNear - cz).toFixed(3)} m)`);
});

test('bridges and elevated roads leave the heightmap untouched', () => {
  const mpp = 2;
  const bounds = makeBounds(W, H, mpp);
  const hm = makeStairHeightmap(mpp);
  const raw = hm.slice();

  const bridge = {
    type: 'road',
    id: 'br',
    tags: { highway: 'primary', bridge: 'yes' },
    geometry: [
      { lat: CENTER_LAT, lng: lngAtPx(bounds, 20) },
      { lat: CENTER_LAT, lng: lngAtPx(bounds, 235) },
    ],
  };

  smoothRoadsInHeightmap(hm, W, H, bounds, [bridge], mpp, false, true);
  assert.deepEqual(hm, raw);
});

test('levelRoads flattens the cross-section; delta mode preserves it', () => {
  const mpp = 1;
  const bounds = makeBounds(W, H, mpp);
  // Constant transverse slope (along y); flat along the road direction (x).
  const makeSlope = () => {
    const hm = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) hm[y * W + x] = y * 0.5;
    }
    return hm;
  };
  const road = {
    type: 'road',
    id: 'a',
    tags: { highway: 'residential' },
    geometry: [
      { lat: CENTER_LAT, lng: lngAtPx(bounds, 20) },
      { lat: CENTER_LAT, lng: lngAtPx(bounds, 235) },
    ],
  };

  // levelRoads=true: zero transverse tilt within the road core.
  const leveled = makeSlope();
  smoothRoadsInHeightmap(leveled, W, H, bounds, [road], mpp, false, true);
  for (let x = 40; x <= 215; x += 5) {
    const tilt = Math.abs(leveled[126 * W + x] - leveled[129 * W + x]);
    assert.ok(tilt < 0.02, `expected flat cross-section at x=${x} (tilt ${tilt.toFixed(3)} m)`);
  }

  // levelRoads=false: the longitudinal profile is already flat, so the delta
  // is ~0 and the original transverse slope must survive.
  const delta = makeSlope();
  const rawSlope = makeSlope();
  smoothRoadsInHeightmap(delta, W, H, bounds, [road], mpp, true, false);
  let maxChange = 0;
  for (let i = 0; i < delta.length; i++) {
    maxChange = Math.max(maxChange, Math.abs(delta[i] - rawSlope[i]));
  }
  assert.ok(maxChange < 0.05, `delta mode should not reshape flat-profile terrain (max change ${maxChange.toFixed(3)} m)`);
});

test('levelRoads flattens the full width the export draws the road at', () => {
  const mpp = 1;
  const bounds = makeBounds(W, H, mpp);
  // Constant transverse slope (along y); flat along the road direction (x).
  const makeSlope = () => {
    const hm = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) hm[y * W + x] = y * 0.5;
    }
    return hm;
  };

  const roadAtY = (highway, py) => ({
    type: 'road',
    id: highway,
    tags: { highway },
    geometry: [
      { lat: latAtPy(bounds, py), lng: lngAtPx(bounds, 20) },
      { lat: latAtPy(bounds, py), lng: lngAtPx(bounds, 235) },
    ],
  });

  // A wide road must be flat all the way to its own edge, not just across a
  // fixed 6 m core — the export draws these at 2·halfWidth, and terrain left
  // tilted under the outer lanes is the bug this guards.
  const cases = [
    // highway, half-width the export uses (services/roadWidth.js)
    ['trunk', 7.4],
    ['motorway', 3.7], // implicitly one-way: 2 lanes per carriageway
    ['primary', 3.5],
    ['residential', 3.0],
  ];

  for (const [highway, halfWidth] of cases) {
    const hm = makeSlope();
    smoothRoadsInHeightmap(hm, W, H, bounds, [roadAtY(highway, 128)], mpp, false, true);

    // Sample just inside each edge of the road surface.
    const edge = Math.floor(halfWidth) - 1;
    for (let x = 40; x <= 215; x += 25) {
      const drop = Math.abs(hm[(128 - edge) * W + x] - hm[(128 + edge) * W + x]);
      assert.ok(
        drop < 0.05,
        `${highway}: expected flat surface across ±${edge} m at x=${x} (drop ${drop.toFixed(3)} m)`,
      );
    }

    // Sanity: the flattening must stop somewhere — terrain well outside the
    // road plus its feather is untouched.
    const outside = Math.ceil(halfWidth) + 8;
    const untouched = hm[(128 + outside) * W + 128];
    assert.ok(
      Math.abs(untouched - (128 + outside) * 0.5) < 0.05,
      `${highway}: terrain ${outside} m off the centerline should be untouched`,
    );
  }
});

test('a neighbouring road embankment does not tilt an adjacent road core', () => {
  const mpp = 1;
  const bounds = makeBounds(W, H, mpp);
  // Flat ground with a step: the two roads sit on shelves 4 m apart in height,
  // close enough (10 m centre to centre) that each one's feather reaches into
  // the other's surface — a divided highway or a frontage road beside a highway.
  const hm = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) hm[y * W + x] = y < 128 ? 0 : 4;
  }

  const road = (py, name) => ({
    type: 'road',
    id: name,
    tags: { highway: 'primary', name },
    geometry: [
      { lat: latAtPy(bounds, py), lng: lngAtPx(bounds, 20) },
      { lat: latAtPy(bounds, py), lng: lngAtPx(bounds, 235) },
    ],
  });

  smoothRoadsInHeightmap(hm, W, H, bounds, [road(123, 'upper'), road(133, 'lower')], mpp, false, true);

  // primary → 3.5 m half-width; sample just inside each road's own surface.
  for (const centre of [123, 133]) {
    for (let x = 40; x <= 215; x += 25) {
      const drop = Math.abs(hm[(centre - 2) * W + x] - hm[(centre + 2) * W + x]);
      assert.ok(
        drop < 0.05,
        `road at y=${centre} should stay flat across its own core at x=${x} (drop ${drop.toFixed(3)} m)`,
      );
    }
  }
});

test('does not carve terrain for paths the export never draws as roads', () => {
  const mpp = 1;
  const bounds = makeBounds(W, H, mpp);
  const slope = () => {
    const hm = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) hm[y * W + x] = y * 0.5;
    }
    return hm;
  };

  const trail = (highway) => ({
    type: 'road',
    id: highway,
    tags: { highway },
    geometry: [
      { lat: latAtPy(bounds, 128), lng: lngAtPx(bounds, 20) },
      { lat: latAtPy(bounds, 128), lng: lngAtPx(bounds, 235) },
    ],
  });

  for (const highway of ['path', 'footway', 'steps', 'cycleway', 'bridleway', 'proposed']) {
    const hm = slope();
    const before = Float32Array.from(hm);
    smoothRoadsInHeightmap(hm, W, H, bounds, [trail(highway)], mpp, true, true);
    let changed = 0;
    for (let i = 0; i < hm.length; i++) if (Math.abs(hm[i] - before[i]) > 1e-4) changed++;
    assert.equal(changed, 0, `${highway} should leave the terrain untouched (${changed} px changed)`);
  }

  // A track is driveable and still gets levelled.
  const hm = slope();
  smoothRoadsInHeightmap(hm, W, H, bounds, [trail('track')], mpp, false, true);
  const drop = Math.abs(hm[127 * W + 128] - hm[129 * W + 128]);
  assert.ok(drop < 0.05, `track should still be levelled (drop ${drop.toFixed(3)} m)`);
});
