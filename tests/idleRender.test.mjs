// The 3D preview draws only the frames worth drawing (components/three/useIdleRender.js)
// and the Satellite detail slider's cross-fade (services/gameTextureBlend.js).
import test from 'node:test';
import assert from 'node:assert/strict';

test('active: every frame; idle: a few a second', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../components/three/useIdleRender.js', import.meta.url), 'utf8');
  // (the rule itself, without Vue or three: evaluated from its source)
  const body = /export function idleDrawRule\(([^)]*)\) \{([\s\S]*?)\n\}/.exec(src);
  const idleDrawRule = new Function('IDLE_AFTER_MS', 'IDLE_FPS', `return function(${body[1]}) {${body[2]}}`)(1500, 4);
  assert.equal(idleDrawRule({ now: 10000, lastActive: 9900, lastDrawn: 9990 }), true, 'the camera moved 100 ms ago');
  assert.equal(idleDrawRule({ now: 10000, lastActive: 8000, lastDrawn: 9900 }), false, 'still for 2 s, drawn 100 ms ago');
  assert.equal(idleDrawRule({ now: 10000, lastActive: 8000, lastDrawn: 9700 }), true, 'still, but 300 ms since the last draw');
  // (a still minute: about four draws a second, not sixty)
  let drawn = 0; let last = 0;
  for (let t = 5000; t < 65000; t += 1000 / 60) if (idleDrawRule({ now: t, lastActive: 0, lastDrawn: last })) { drawn++; last = t; }
  assert.ok(drawn >= 200 && drawn <= 245, `${drawn} draws in a still minute`);
});

test('the slider\'s cross-fade: 0, 50 and 100 % are the paintings themselves, between them a mix of two', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
  const { blendMix } = await import('../services/gameTextureBlend.js');
  assert.deepEqual(blendMix(0), { from: 'c0', to: 'c50', t: 0 });
  assert.deepEqual(blendMix(50), { from: 'c0', to: 'c50', t: 1 });
  assert.deepEqual(blendMix(100), { from: 'c50', to: 'c100', t: 1 });
  assert.deepEqual(blendMix(25), { from: 'c0', to: 'c50', t: 0.5 });
  assert.deepEqual(blendMix(75), { from: 'c50', to: 'c100', t: 0.5 });
  assert.deepEqual(blendMix(140), { from: 'c50', to: 'c100', t: 1 });
});
