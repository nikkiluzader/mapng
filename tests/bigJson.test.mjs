// A long array saved and read back a piece at a time (services/bigJson.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { jsonArrayChunks, jsonArrayReader } from '../services/bigJson.js';

const features = Array.from({ length: 5000 }, (_, i) => ({ id: i, type: 'road', tags: { name: `Straße ${i} 東京`, note: 'a,\nb]' }, geometry: [{ lat: 35 + i / 1e5, lng: 139 }] }));
const bytesOf = (chunks) => chunks.map((c) => new TextEncoder().encode(c));

test('written in pieces it is plain JSON, and no piece is the whole', () => {
  const chunks = [...jsonArrayChunks(features, 4096)];
  assert.ok(chunks.length > 50);
  assert.deepEqual(JSON.parse(chunks.join('')), features);
  assert.deepEqual(JSON.parse([...jsonArrayChunks([])].join('')), []);
});

test('read back from byte pieces cut anywhere, even inside a character', () => {
  const all = Buffer.concat(bytesOf([...jsonArrayChunks(features, 4096)]));
  for (const step of [1000, 4097, 65536]) {
    const r = jsonArrayReader();
    for (let o = 0; o < all.length; o += step) r.push(all.subarray(o, o + step));
    assert.deepEqual(r.end(), features);
  }
});

test('a file written the old way (one line) still reads', () => {
  const r = jsonArrayReader();
  const all = new TextEncoder().encode(JSON.stringify(features));
  for (let o = 0; o < all.length; o += 7000) r.push(all.subarray(o, o + 7000));
  assert.deepEqual(r.end(), features);
  const e = jsonArrayReader(); e.push(new TextEncoder().encode('[]')); assert.deepEqual(e.end(), []);
});
