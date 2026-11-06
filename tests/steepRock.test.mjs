import test from 'node:test';
import assert from 'node:assert/strict';
import { paintSteepRock } from '../services/osmTexture.js';

// a stand-in 2D context: one RGBA buffer
function fakeCanvas(w, h, fill) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(fill(i % w, Math.floor(i / w)), i * 4);
  const ctx = {
    getImageData: (x, y, cw, ch) => ({ data: data.slice((y * w + x) * 4, ((y + ch) * w) * 4) }),
    putImageData: (img, x, y) => data.set(img.data, (y * w + x) * 4),
  };
  return { canvas: { width: w, height: h }, ctx, at: (x, y) => [...data.slice((y * w + x) * 4, (y * w + x) * 4 + 3)] };
}

test('steep ground is painted rock on the game texture; flat ground and roads keep their colour', () => {
  const W = 64;
  // flat west half, a 60° face (rise 1.73 m per metre) east of x = 32
  const heightMap = new Float32Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) heightMap[y * W + x] = x < 32 ? 0 : (x - 32) * 1.73;
  const green = [0x52, 0x5a, 0x31, 255]; const road = [0x45, 0x45, 0x45, 255];
  // a grey road crossing the face at y = 10
  const { canvas, ctx, at } = fakeCanvas(W, W, (x, y) => (y === 10 ? road : green));
  const share = paintSteepRock(ctx, canvas, { heightMap, width: W, height: W, processingMetersPerPixel: 1 });
  assert.ok(share > 0.4 && share < 0.55, `about the east half: ${share.toFixed(2)}`);
  assert.deepEqual(at(10, 30), green.slice(0, 3), 'flat ground keeps its green');
  assert.notDeepEqual(at(50, 30), green.slice(0, 3), 'the face is rock');
  assert.deepEqual(at(50, 10), road.slice(0, 3), 'the road across the face keeps its colour');
});
