import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyGround, GROUND_CLASSES, GAME_COLORS, getFeatureColor, isUndergroundArea } from '../services/osmTexture.js';
import { isVegetationColor } from '../services/osmTerrainMaterials.js';

const cls = (r, g, b) => GROUND_CLASSES[classifyGround(r, g, b)];
const hex = (h) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));

test('satellite pixels sort into ground classes', () => {
  assert.equal(cls(38, 52, 30), 'trees', 'dark green canopy');
  assert.equal(cls(98, 122, 70), 'grass', 'lawn');
  assert.equal(cls(150, 150, 148), 'paved', 'concrete / roof grey');
  assert.equal(cls(210, 190, 150), 'sand', 'light sand');
  assert.equal(cls(140, 110, 80), 'soil', 'bare soil');
  assert.equal(cls(30, 50, 80), 'water', 'dark blue water');
  assert.equal(cls(20, 20, 22), 'shadow', 'shadows are filled from their neighbours');
});

test('game map colours: greens read as vegetation to the grass mask, paving and water do not', () => {
  for (const k of ['forest', 'grass', 'park', 'scrub', 'cemetery', 'sport', 'defaultLanduse']) {
    assert.ok(isVegetationColor(...hex(GAME_COLORS[k])), `${k} counts as vegetation`);
  }
  for (const k of ['commercial', 'industrial', 'retail', 'parking', 'building', 'buildingFill', 'water', 'sand', 'farmland', 'apron', 'runway']) {
    assert.ok(!isVegetationColor(...hex(GAME_COLORS[k])), `${k} does not grow grass`);
  }
});

test('area colours: an unknown tag value falls through to the next tag', () => {
  const base = '#000001';
  const park = getFeatureColor({ leisure: 'park' }, base);
  assert.notEqual(park, base);
  assert.equal(getFeatureColor({ leisure: 'park', surface: 'woodchips_and_mud' }, base), park, 'odd surface= no longer hides the park');
  assert.equal(getFeatureColor({ leisure: 'pitch', surface: 'artificial_turf' }, base), getFeatureColor({ leisure: 'pitch' }, base));
  for (const tags of [{ amenity: 'parking_space' }, { landuse: 'religious' }, { leisure: 'hot_tub' }, { natural: 'cliff' },
    { power: 'generator' }, { tourism: 'picnic_site' }]) {
    assert.notEqual(getFeatureColor(tags, base), base, JSON.stringify(tags));
  }
  // boundaries stay unpainted: they would flood whole districts
  assert.equal(getFeatureColor({ leisure: 'nature_reserve' }, base), base);
  assert.equal(getFeatureColor({ place: 'neighbourhood' }, base), base);
  assert.equal(getFeatureColor({ amenity: 'social_facility' }, base), base, 'care-home grounds keep the satellite ground');
  // underground areas are not drawn: a tunnel outline is not the park on top
  assert.ok(isUndergroundArea({ man_made: 'tunnel', surface: 'concrete', layer: '-1' }));
  assert.ok(isUndergroundArea({ waterway: 'stream', tunnel: 'culvert' }));
  assert.ok(isUndergroundArea({ amenity: 'parking', parking: 'underground' }));
  assert.ok(!isUndergroundArea({ leisure: 'park' }) && !isUndergroundArea({ landuse: 'grass', layer: '1' }));
});

test('dark asphalt with a green cast is paved, not canopy', () => {
  assert.equal(cls(58, 64, 57), 'paved', 'Phoenix lot asphalt');
  assert.equal(cls(56, 59, 51), 'paved');
  assert.equal(cls(40, 52, 32), 'trees', 'shaded canopy stays trees');
});

test('relief shading is taken out of the satellite before classing (sun found from the image)', async () => {
  const { removeHillshade } = await import('../services/osmTexture.js');
  // ridges running north-south, lit from the east at 40°: one green ground, shaded
  const w = 64, h = 64, n = w * h;
  const nx = new Float32Array(n), ny = new Float32Array(n), nz = new Float32Array(n);
  const rgba = new Uint8ClampedArray(n * 4);
  const L = [Math.sin(Math.PI / 2) * Math.cos(0.7), 0, Math.sin(0.7)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; const slope = Math.sin(x / 3) * 0.8;   // dz/dx
    const len = Math.hypot(slope, 0, 1); nx[i] = -slope / len; ny[i] = 0; nz[i] = 1 / len;
    const s = Math.max(0, nx[i] * L[0] + nz[i] * L[2]);
    const sky = [20, 26, 34];   // (shade is lit blue)
    const base = [90, 120, 50];
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = sky[c] + base[c] * s;
    rgba[i * 4 + 3] = 255;
  }
  const spread = () => { let lo = 255, hi = 0; for (let i = 0; i < n; i++) { const g = rgba[i * 4 + 1]; lo = Math.min(lo, g); hi = Math.max(hi, g); } return hi - lo; };
  const before = spread();
  const sun = removeHillshade(rgba, { nx, ny, nz });
  assert.ok(sun && sun.az >= 70 && sun.az <= 110, `sun from the east, got ${JSON.stringify(sun)}`);
  assert.ok(spread() < before * 0.35, `shading mostly gone: ${before} -> ${spread()}`);
  // flat ground is left alone
  const flat = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
  assert.equal(removeHillshade(flat, { nx: new Float32Array(2), ny: new Float32Array(2), nz: new Float32Array([1, 1]) }), null);
});

test('ground classes checked against the land cover and slope', async () => {
  const { groundFromLandCover } = await import('../services/osmTexture.js');
  const W = 8; const at = (cls) => GROUND_CLASSES.indexOf(cls);
  const lcOf = (k) => ({ grid: new Uint8Array(4).fill(k), n: 2 });
  // canopy over WorldCover grass (above the tree line): grass; over trees: kept
  let cls = new Uint8Array(W * W).fill(at('trees'));
  assert.equal(GROUND_CLASSES[groundFromLandCover(cls, W, W, lcOf(30))[0]], 'grass');
  cls = new Uint8Array(W * W).fill(at('trees'));
  assert.equal(GROUND_CLASSES[groundFromLandCover(cls, W, W, lcOf(10))[0]], 'trees');
  // grey on bare rock: rock; greens on bare ground with no plants: dry
  cls = new Uint8Array(W * W).fill(at('paved'));
  assert.equal(GROUND_CLASSES[groundFromLandCover(cls, W, W, lcOf(60))[0]], 'rock');
  cls = new Uint8Array(W * W).fill(at('grass'));
  assert.equal(GROUND_CLASSES[groundFromLandCover(cls, W, W, lcOf(60))[0]], 'dry');
  // flat sand stays sand (a desert), water on a slope or far from water: its neighbours
  cls = new Uint8Array(W * W).fill(at('sand'));
  assert.equal(GROUND_CLASSES[groundFromLandCover(cls, W, W, lcOf(60), { nz: new Float32Array(W * W).fill(1) })[0]], 'sand');
  cls = new Uint8Array(W * W).fill(at('grass')); cls[27] = at('water');
  assert.equal(GROUND_CLASSES[groundFromLandCover(cls, W, W, lcOf(30))[27]], 'grass');
  cls = new Uint8Array(W * W).fill(at('grass')); cls[27] = at('water');
  assert.equal(GROUND_CLASSES[groundFromLandCover(cls, W, W, lcOf(80))[27]], 'water');
  const steep = { nz: new Float32Array(W * W).fill(0.9) };
  cls = new Uint8Array(W * W).fill(at('grass')); cls[27] = at('water');
  assert.equal(GROUND_CLASSES[groundFromLandCover(cls, W, W, null, steep)[27]], 'grass');
});

test('rock rules by land cover', async () => {
  const { steepRockFrom, osmRockAllowed } = await import('../services/worldCover.js');
  assert.equal(steepRockFrom(10), Infinity);
  assert.ok(steepRockFrom(30) > steepRockFrom(60));
  assert.ok(osmRockAllowed(60) && osmRockAllowed(0) && !osmRockAllowed(30) && !osmRockAllowed(10));
});

test('pale grey and lichen-grey ground on a slope away from towns is rock', async () => {
  const { groundFromLandCover } = await import('../services/osmTexture.js');
  const W = 8; const at = (c) => GROUND_CLASSES.indexOf(c);
  const lc = (k) => ({ grid: new Uint8Array(4).fill(k), n: 2 });
  const slope = { nz: new Float32Array(W * W).fill(0.9) };   // ~26°
  let cls = new Uint8Array(W * W).fill(at('paved'));
  assert.equal(GROUND_CLASSES[groundFromLandCover(cls, W, W, lc(30), slope, new Uint8Array(W * W).fill(1))[0]], 'rock');
  cls = new Uint8Array(W * W).fill(at('grass'));
  assert.equal(GROUND_CLASSES[groundFromLandCover(cls, W, W, lc(30), slope, new Uint8Array(W * W).fill(2))[0]], 'rock');
  // in town a pale grey is a roof or a yard
  cls = new Uint8Array(W * W).fill(at('paved'));
  assert.equal(GROUND_CLASSES[groundFromLandCover(cls, W, W, lc(50), slope, new Uint8Array(W * W).fill(1))[0]], 'paved');
  // ordinary green grass stays
  cls = new Uint8Array(W * W).fill(at('grass'));
  assert.equal(GROUND_CLASSES[groundFromLandCover(cls, W, W, lc(30), slope, new Uint8Array(W * W))[0]], 'grass');
});

test('an arid scene: dull greens in its scrub and grassland are bare ground; a green scene keeps them', async () => {
  const { groundFromLandCover } = await import('../services/osmTexture.js');
  const { WC } = await import('../services/worldCover.js');
  const w = 40; const h = 40;
  const landCover = { grid: new Uint8Array(4 * 4).fill(WC.SHRUBS), n: 4 };
  // mostly dry ground with a patch of dark "trees" and "grass", muted (3)
  const make = (bareShare) => {
    const cls = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) cls[i] = (i % 100) < bareShare ? 2 : (i % 2 ? 0 : 1);
    return cls;
  };
  const muted = new Uint8Array(w * h).fill(3);
  const arid = make(80);
  groundFromLandCover(arid, w, h, landCover, null, muted);
  assert.equal([...arid].filter((c) => c === 0 || c === 1).length, 0, 'no greens left in the desert scrub');
  const green = make(30);
  const before = [...green].filter((c) => c === 0 || c === 1).length;
  groundFromLandCover(green, w, h, landCover, null, muted);
  assert.equal([...green].filter((c) => c === 0 || c === 1).length, before, 'a green scene keeps its scrub');
  // saturated greens (real leaves) stay even in a desert
  const leaves = make(80);
  const n = [...leaves].filter((c) => c === 0 || c === 1).length;
  groundFromLandCover(leaves, w, h, landCover, null, new Uint8Array(w * h));
  assert.equal([...leaves].filter((c) => c === 0 || c === 1).length, n);
});

test('open water by the land cover is water whatever colour the image has; the shore keeps the image', async () => {
  const { groundFromLandCover } = await import('../services/osmTexture.js');
  const at = (cls) => GROUND_CLASSES.indexOf(cls);
  // an island: land (grass, 30) in the middle 10 cells of a 40-cell land cover, the open sea (0) and water (80) round it
  const n = 40; const grid = new Uint8Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) grid[r * n + c] = Math.abs(r - 20) < 5 && Math.abs(c - 20) < 5 ? 30 : (r < 20 ? 0 : 80);
  const lc = { grid, n };
  const W = 160;   // four image pixels to a land cover cell
  // the image reads the whole scene as grass and trees (teal shallows)
  const cls = new Uint8Array(W * W).map((_, i) => (i % 2 ? at('grass') : at('trees')));
  const out = groundFromLandCover(cls, W, W, lc);
  const cell = (r, c) => GROUND_CLASSES[out[(r * 4 + 2) * W + c * 4 + 2]];
  assert.equal(cell(2, 2), 'water', 'the open sea (no land cover) far out');
  assert.equal(cell(36, 36), 'water', 'mapped water far out');
  assert.equal(cell(20, 9), 'water', 'six cells off the shore');
  assert.notEqual(cell(20, 20), 'water', 'the island itself');
  assert.notEqual(cell(20, 14), 'water', 'the cell at the shore keeps what the image shows');
  // no land cover: nothing changes
  const plain = new Uint8Array(W * W).fill(at('grass'));
  assert.equal(GROUND_CLASSES[groundFromLandCover(plain, W, W, null)[0]], 'grass');
  // an inland scene with no water in the land cover: nothing becomes water
  const inland = groundFromLandCover(new Uint8Array(W * W).fill(at('grass')), W, W, { grid: new Uint8Array(n * n).fill(30), n });
  assert.ok(!inland.includes(at('water')));
});
