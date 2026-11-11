// Desktop rebuilds replay a level's recorded sources (desktop/runner/browserShims.mjs).
// A request the first run never got must not be fetched again for OSM: the
// rebuild would take today's OpenStreetMap instead of the map's.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installSourceRecorder } from '../desktop/runner/browserShims.mjs';

function withFetch(fake, fn) {
  const saved = globalThis.fetch;
  globalThis.fetch = fake;
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = saved; });
}

test('a rebuild replays recorded requests and never fetches a missing OSM request', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapng-sources-'));
  const online = [];
  const fake = async (url) => { online.push(String(url)); return new Response('live', { status: 200 }); };

  // 1. the first run records what it fetched (a tile, and OSM from one mirror)
  await withFetch(fake, async () => {
    installSourceRecorder({ dir, mode: 'record' });
    await (await fetch('https://tiles.example/1/2/3.png')).text();
    await (await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=q1' })).text();
  });
  assert.equal(online.length, 2);
  online.length = 0;

  // 2. the rebuild replays them, with the online fallback on
  await withFetch(fake, async () => {
    const stats = installSourceRecorder({ dir, mode: 'replay', fallback: true });
    // recorded: served from disk (OSM from any mirror: the key ignores the host)
    assert.equal(await (await fetch('https://tiles.example/1/2/3.png')).text(), 'live');
    assert.equal(await (await fetch('https://overpass.kumi.systems/api/interpreter', { method: 'POST', body: 'data=q1' })).text(), 'live');
    // OSM the first run did not get: fails, as it did then (no download)
    await assert.rejects(fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=other' }), /not in the recorded sources/);
    await assert.rejects(fetch('/api/osm?bbox=1,2,3,4'), /not in the recorded sources/);
    // anything else missing still falls back online
    assert.equal(await (await fetch('https://tiles.example/9/9/9.png')).text(), 'live');
    assert.deepEqual({ replayed: stats.replayed, missed: stats.missed, downloaded: stats.downloaded }, { replayed: 2, missed: 3, downloaded: 1 });
  });
  assert.deepEqual(online, ['https://tiles.example/9/9/9.png']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a rebuild of a level made from the backup map data asks the OpenStreetMap servers again', async () => {
  const { savedFromBackupMapData } = await import('../desktop/runner/browserShims.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapng-sources-'));
  const rec = fs.mkdtempSync(path.join(os.tmpdir(), 'mapng-sources-new-'));
  const online = [];
  // 1. the first run: Overpass down (a 504 is not OSM data), the backup's road tiles fetched
  let overpassUp = false;
  const fake = async (url) => {
    online.push(String(url));
    if (/api\/interpreter/.test(String(url))) return overpassUp ? new Response('osm', { status: 200 }) : new Response('busy', { status: 504 });
    return new Response('tile', { status: 200 });
  };
  await withFetch(fake, async () => {
    installSourceRecorder({ dir, mode: 'record' });
    await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=q1' });
    await (await fetch('https://tiles.overturemaps.org/2026-10-21.0/transportation.pmtiles', { headers: { range: 'bytes=0-99' } })).text();
  });
  assert.equal(savedFromBackupMapData(dir), true);
  online.length = 0;
  // 2. an update while the servers are still down: the saved answers, as before
  await withFetch(fake, async () => {
    const stats = installSourceRecorder({ dir, mode: 'replay', recordDir: rec, refreshOsm: 'ifBackup' });
    assert.equal(stats.refreshOsm, true);
    assert.equal((await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=q1' })).status, 504);
    assert.equal(stats.refreshed, 0);
  });
  // 3. an update once they answer: today's map data, recorded for the next one
  overpassUp = true;
  await withFetch(fake, async () => {
    const stats = installSourceRecorder({ dir, mode: 'replay', recordDir: rec, refreshOsm: 'ifBackup' });
    assert.equal(await (await fetch('https://overpass.kumi.systems/api/interpreter', { method: 'POST', body: 'data=q1' })).text(), 'osm');
    assert.equal(stats.refreshed, 1);
    assert.ok(fs.readdirSync(rec).some((n) => n.endsWith('.bin')), 'recorded');
    // other saved requests are still replayed, not fetched
    const before = online.length;
    await (await fetch('https://tiles.overturemaps.org/2026-10-21.0/transportation.pmtiles', { headers: { range: 'bytes=0-99' } })).text();
    assert.equal(online.length, before);
  });
  // a level made from OpenStreetMap itself is never asked again
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'mapng-sources-'));
  await withFetch(fake, async () => {
    installSourceRecorder({ dir: plain, mode: 'record' });
    await (await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=q1' })).text();
  });
  assert.equal(savedFromBackupMapData(plain), false);
  await withFetch(fake, async () => { assert.equal(installSourceRecorder({ dir: plain, mode: 'replay', refreshOsm: 'ifBackup' }).refreshOsm, false); });
  for (const d of [dir, rec, plain]) fs.rmSync(d, { recursive: true, force: true });
});
