import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import { LATEST_UPDATE } from '../updates.js';

test('/updates/latest and /updates point at the newest update page', async () => {
  for (const path of ['/updates/latest', '/updates/latest/', '/updates', '/updates/']) {
    const res = await worker.fetch(new Request(`https://mapng.com${path}`), {}, {});
    assert.equal(res.status, 302, path);
    assert.equal(res.headers.get('Location'), `/updates/${LATEST_UPDATE}/`);
  }
});

test('the newest update page exists', async () => {
  const fs = await import('node:fs');
  assert.ok(fs.existsSync(new URL(`../public/updates/${LATEST_UPDATE}/index.html`, import.meta.url)));
});
