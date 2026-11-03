import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import polyClip, { snapGeom } from '../services/polyClip.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('snapGeom puts every coordinate of a multipolygon on the centimetre grid', () => {
  const g = [[[[0.123456, 1.987654], [2.004999, 3.005001], [0.123456, 1.987654]]]];
  assert.deepEqual(snapGeom(g), [[[[0.12, 1.99], [2, 3.01], [0.12, 1.99]]]]);
});

test('polyClip still clips: a square minus its half', () => {
  const sq = [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]];
  const half = [[[1, -1], [3, -1], [3, 3], [1, 3], [1, -1]]];
  const out = polyClip.difference(sq, half);
  assert.equal(out.length, 1);
  const xs = out[0][0].map((q) => q[0]);
  assert.equal(Math.max(...xs), 1);
});

// a walkway strip with 409 curb-cut rings (a real export's): off the grid,
// polygon-clipping's sweep never returned (the export sat at "Building
// sidewalks" for half an hour); run apart so a hang fails the test, not the suite
test('a strip whose unsnapped cut never returned is clipped in a moment', () => {
  const code = `
    import fs from 'node:fs';
    import polyClip from './services/polyClip.js';
    const d = JSON.parse(fs.readFileSync('tests/fixtures/clipSweepHang.json'));
    const t = Date.now();
    const out = polyClip.difference(d.strip, ...d.near);
    console.log(JSON.stringify({ pieces: out.length, ms: Date.now() - t }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, timeout: 15000, encoding: 'utf8' });
  assert.equal(r.signal, null, 'the clip did not finish within 15 s');
  const { pieces } = JSON.parse(r.stdout.trim());
  assert.ok(pieces >= 1);
});
