// A GPXZ level modified or updated in the desktop app is made again from its
// saved GPXZ downloads: that needs no key (alxti, 2026-11-11: "Modify" put
// his GPXZ terrain back on the 30 m, because Modify sent an empty key and the
// GPXZ branch was skipped without one).
import test from 'node:test';
import assert from 'node:assert/strict';
import { gpxzUsable } from '../services/sourceWording.js';

test('GPXZ needs a key, except when a level\'s saved downloads are replayed', () => {
  const before = globalThis.__mapngReplayingSources;
  try {
    globalThis.__mapngReplayingSources = false;
    assert.equal(gpxzUsable(true, 'key'), true);
    assert.equal(gpxzUsable(true, ''), false);
    assert.equal(gpxzUsable(false, 'key'), false);
    globalThis.__mapngReplayingSources = true;
    assert.equal(gpxzUsable(true, ''), true);
    assert.equal(gpxzUsable(true, 'key'), true);
    assert.equal(gpxzUsable(false, ''), false);
  } finally { globalThis.__mapngReplayingSources = before; }
});
