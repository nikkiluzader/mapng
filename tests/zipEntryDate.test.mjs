import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ZIP entry times are local clock time, and BeamNG reads them so: stamped with
// the UTC clock, west of Greenwich the level's meshes stood hours newer than the
// shape cache the game writes at load, and were imported again every load.
// (run in New York time, so the test means something on a UTC machine too)
test('the level ZIP stamps its entries with the local clock', () => {
  const code = `
    import JSZip from 'jszip';
    import { zipEntryDate } from './services/exportBeamNGLevel.js';
    const now = new Date(2026, 10, 3, 9, 20, 46);   // 09:20:46 local
    const zip = new JSZip();
    zip.file('a.dae', 'x', { date: zipEntryDate(now) });
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    // the local file header: DOS time at byte 10, date at byte 12
    const t = buf.readUInt16LE(10), d = buf.readUInt16LE(12);
    console.log(JSON.stringify({ h: t >> 11, m: (t >> 5) & 63, day: d & 31 }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: root, encoding: 'utf8', env: { ...process.env, TZ: 'America/New_York' },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').pop()), { h: 9, m: 20, day: 3 });
});
