// chunkedGenerate.js: when a shape is chunked, the overview's footprint, and the Generate calls made.
import test from 'node:test';
import assert from 'node:assert/strict';
import { needsChunks, scaleFootprint, generateChunked, paddedSide } from '../services/chunkedGenerate.js';

test('chunked only past the one-grid cap', () => {
  assert.equal(paddedSide(12425, 18544), 32768);
  assert.equal(needsChunks(12425, 18544), true); assert.equal(needsChunks(16000, 300), false);
});
test('overview footprint: every coarse pixel any fine footprint touches', () => {
  const s = scaleFootprint({ runs: [[0, 5, 9], [7, 0, 2]] }, 10, 8, 4);
  assert.equal(s.width, 3); assert.equal(s.height, 2);
  assert.deepEqual(s.runs, [[0, 1, 3], [1, 0, 1]]);
});
test('Generate: every chunk fetched (cached), then the overview, which carries what the export needs', async () => {
  const calls = [];
  const fetch = async (c, size, o) => { calls.push({ size, o }); return { width: typeof size === 'object' ? size.width : size }; };
  const td = await generateChunked({ fetch, center: { lat: 10, lng: 20 }, W: 3000, H: 1000, mpp: 1, footprint: [[0, 0, 3000, 1000]], size: 1024, overlap: 256 });
  const chunkCalls = calls.filter((c) => c.o.targetBounds);
  assert.ok(chunkCalls.length >= 4); assert.ok(chunkCalls.every((c) => c.o.targetBounds && c.size === 1024));
  assert.equal(calls.at(-1).o.targetBounds, undefined);
  assert.equal(td.chunked.W, 3000); assert.equal(td.chunked.size, 1024); assert.ok(td.chunked.footprint.runs.length === 1000);
});
