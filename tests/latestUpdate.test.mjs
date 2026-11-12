// /updates/latest must point at the newest update page: a release that adds public/updates/<version>/ and
// forgets worker/updates.js fails here (0.3.0 went out with the link still on 0.2.17).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LATEST_UPDATE } from '../worker/updates.js';

test('the latest-update link names the newest update page', () => {
  const versions = fs.readdirSync(new URL('../public/updates/', import.meta.url)).filter((d) => /^\d+\.\d+\.\d+$/.test(d));
  const newest = versions.sort((a, b) => { const x = a.split('.').map(Number); const y = b.split('.').map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; }).pop();
  assert.equal(LATEST_UPDATE, newest);
  assert.ok(fs.existsSync(new URL(`../public/updates/${LATEST_UPDATE}/index.html`, import.meta.url)));
});
