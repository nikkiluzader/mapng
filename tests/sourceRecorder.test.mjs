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
