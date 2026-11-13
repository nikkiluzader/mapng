import test from 'node:test';
import assert from 'node:assert/strict';
import { pageGpu, gpuLine, _resetGpuInfo } from '../services/gpuInfo.js';

const fakeDoc = (make) => ({ createElement: () => ({ getContext: (kind) => make(kind) }) });
const fakeGl = (renderer, max) => ({ RENDERER: 1, VENDOR: 2, MAX_TEXTURE_SIZE: 3, getExtension: (n) => (n === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 10, UNMASKED_VENDOR_WEBGL: 11 } : null), getParameter: (p) => ({ 10: renderer, 11: 'Vendor', 3: max }[p]) });

test('the page\'s graphics in one line: card, largest picture, WebGL version', () => {
  _resetGpuInfo();
  const gpu = pageGpu(fakeDoc((kind) => (kind === 'webgl2' ? fakeGl('ANGLE (Intel, Mesa Intel(R) Arc(tm) A770 Graphics, OpenGL 4.6)', 16384) : null)));
  assert.equal(gpu.maxTextureSize, 16384); assert.equal(gpu.webgl2, true); assert.equal(gpu.software, false);
  assert.equal(gpuLine(gpu), 'ANGLE (Intel, Mesa Intel(R) Arc(tm) A770 Graphics, OpenGL 4.6), largest picture 16384 px, WebGL 2');
});

test('a software renderer and WebGL 1 are said; no WebGL at all is said', () => {
  _resetGpuInfo();
  const soft = pageGpu(fakeDoc((kind) => (kind === 'webgl' ? fakeGl('llvmpipe (LLVM 15, 256 bits)', 8192) : null)));
  assert.equal(gpuLine(soft), 'llvmpipe (LLVM 15, 256 bits), software renderer, largest picture 8192 px, WebGL 1 only');
  _resetGpuInfo();
  assert.equal(pageGpu(fakeDoc(() => null)), null);
  assert.equal(gpuLine(null), 'WebGL did not start');
  _resetGpuInfo();
  assert.equal(pageGpu(fakeDoc(() => { throw new Error('blocked'); })), null);
});

test('a satellite picture that could not be fitted is called out of memory, with the size and what to do', async () => {
  const { satelliteFitError } = await import('../services/resamplerClient.js');
  const said = satelliteFitError(8192, 8192, new Error(''));
  assert.match(said, /^out of memory: the satellite picture could not be fitted to a 8192 × 8192 map\. /);
  assert.match(said, /smaller size, or use the desktop app\.$/);
  assert.match(satelliteFitError(4096, 4096, new Error('Create skia surface failed')), /\(Create skia surface failed\)/);
  assert.doesNotMatch(satelliteFitError(4096, 4096, new Error('out of memory')), /\(/);
});
