// The location map's Height colours, Shaded relief and Slope layers
// (services/reliefTileLayer.js): the parts that turn an elevation tile into a picture.
import test from 'node:test';
import assert from 'node:assert/strict';

const S = 16;
const tileOf = (fn) => { const h = new Float32Array(S * S); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] = fn(x, y); return h; };
const px = (data, x, y) => [...data.slice((y * S + x) * 4, (y * S + x) * 4 + 4)];

test('Terrarium pixels decode to metres; no-data reads as sea level', async () => {
  const { decodeTerrariumTile } = await import('../services/reliefTileLayer.js');
  // 100 m = 32868 = 128*256 + 100; -10.5 m = 32757.5 = 127*256 + 245 + 128/256; no-data = 0,0,0
  const h = decodeTerrariumTile(new Uint8ClampedArray([128, 100, 0, 255, 127, 245, 128, 255, 0, 0, 0, 255, 128, 0, 0, 255]), 2);
  assert.deepEqual([...h], [100, -10.5, 0, 0]);
});

test('a tile is finer near the poles and halves with each zoom', async () => {
  const { tileMetersPerPixel } = await import('../services/reliefTileLayer.js');
  assert.ok(Math.abs(tileMetersPerPixel(0, 0) - 156543.03) < 0.1);
  assert.ok(Math.abs(tileMetersPerPixel(15, 0) - 4.777) < 0.01);
  assert.ok(Math.abs(tileMetersPerPixel(15, 60) - 2.389) < 0.01);
});

test('the land range leaves the sea out', async () => {
  const { tileLandRange } = await import('../services/reliefTileLayer.js');
  assert.deepEqual(tileLandRange(tileOf((x) => (x < 8 ? -50 : 20 + x)), S), [28, 32]);   // (sampled every 4th pixel)
  assert.equal(tileLandRange(tileOf(() => -200), S), null);
});

test('height colours stretch over the range given; the sea is blue', async () => {
  const { shadeReliefTile, heightColour } = await import('../services/reliefTileLayer.js');
  const flatLow = shadeReliefTile(tileOf(() => 100), { size: S, mpp: 10, mode: 'height', range: [100, 140] });
  const flatHigh = shadeReliefTile(tileOf(() => 140), { size: S, mpp: 10, mode: 'height', range: [100, 140] });
  // flat ground is drawn at the palette's own colour (shading 1)
  assert.deepEqual(px(flatLow, 8, 8).slice(0, 3), heightColour(0));
  assert.deepEqual(px(flatHigh, 8, 8).slice(0, 3), heightColour(1));
  // the same 40 m read just as clearly on a mountain range's scale as on a town's
  const town = shadeReliefTile(tileOf(() => 120), { size: S, mpp: 10, mode: 'height', range: [100, 140] });
  const peak = shadeReliefTile(tileOf(() => 2100), { size: S, mpp: 10, mode: 'height', range: [100, 4100] });
  assert.deepEqual(px(town, 8, 8), px(peak, 8, 8));
  const sea = px(shadeReliefTile(tileOf(() => -300), { size: S, mpp: 10, mode: 'height', range: [0, 100] }), 8, 8);
  assert.ok(sea[2] > sea[0] + 40, `sea should be blue: ${sea}`);
});

test('slope colours follow the true steepness, whatever the tile\'s scale', async () => {
  const { shadeReliefTile, slopeColour } = await import('../services/reliefTileLayer.js');
  const close = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
  for (const mpp of [5, 300]) {
    // a ramp rising east at 25 degrees
    const rise = Math.tan((25 * Math.PI) / 180) * mpp;
    const ramp = shadeReliefTile(tileOf((x) => x * rise), { size: S, mpp, mode: 'slope' });
    const c = px(ramp, 8, 8).slice(0, 3);
    const want = slopeColour(25);
    // (the light shading darkens it by 18% at most)
    assert.ok(c.every((v, i) => v <= want[i] + 1 && v >= want[i] * 0.8), `mpp ${mpp}: ${c} vs ${want}`);
    const flat = px(shadeReliefTile(tileOf(() => 50), { size: S, mpp, mode: 'slope' }), 8, 8).slice(0, 3);
    assert.ok(close(flat, slopeColour(0), 1), `flat at mpp ${mpp}: ${flat}`);
  }
});

test('shaded relief: slopes facing the north-west light are brighter than those facing away', async () => {
  const { shadeReliefTile } = await import('../services/reliefTileLayer.js');
  // a ridge running north-east to south-west: its north-west face rises towards the south-east
  const facingLight = px(shadeReliefTile(tileOf((x, y) => (x + y) * 4), { size: S, mpp: 10, mode: 'relief' }), 8, 8)[0];
  const facingAway = px(shadeReliefTile(tileOf((x, y) => -(x + y) * 4), { size: S, mpp: 10, mode: 'relief' }), 8, 8)[0];
  const flat = px(shadeReliefTile(tileOf(() => 0), { size: S, mpp: 10, mode: 'relief' }), 8, 8)[0];
  assert.ok(facingLight > flat && flat > facingAway, `${facingLight} > ${flat} > ${facingAway}`);
  assert.equal(px(shadeReliefTile(tileOf(() => 0), { size: S, mpp: 10, mode: 'relief' }), 0, 0)[3], 255);
});
