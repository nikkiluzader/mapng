// Address lookups (services/nominatim.js, worker/index.js nominatimCacheKey): asked gently
import test from 'node:test';
import assert from 'node:assert/strict';
import { reverseKey, reverseLocationName } from '../services/nominatim.js';
import { nominatimCacheKey } from '../worker/index.js';

test('a place is asked for once, one request at a time, and a refusal is not asked again elsewhere', async () => {
  const calls = []; const starts = [];
  const realFetch = globalThis.fetch;
  let mode = 'ok';
  globalThis.fetch = async (url) => {
    calls.push(String(url)); starts.push(Date.now());
    if (mode === 'refuse') return new Response('slow down', { status: 429 });
    return new Response(JSON.stringify({ address: { road: 'King Street' } }), { status: 200 });
  };
  const warn = console.warn; console.warn = () => {};
  try {
    // two callers at once for nearly the same spot: queued a second apart, and the second is answered from memory
    const [a, b] = await Promise.all([reverseLocationName(29.89251, -81.31352), reverseLocationName(29.89262, -81.31361)]);
    assert.equal(a, 'King Street'); assert.equal(b, 'King Street');
    assert.equal(calls.length, 1);
    // asked at the rounded position, of the OpenStreetMap name first
    assert.match(calls[0], /^\/api\/nominatim-osm\/reverse\?lat=29\.893&lon=-81\.314&/);
    assert.equal(reverseKey(29.89251, -81.31352), '29.893,-81.314');
    assert.equal(await reverseLocationName(29.8927, -81.3138), 'King Street');
    assert.equal(calls.length, 1);
    // another place, refused: one request, not a second to the other name (it is the same server)
    mode = 'refuse';
    assert.equal(await reverseLocationName(48.8566, 2.3522), '');
    assert.equal(calls.length, 2);
    assert.ok(starts[1] - starts[0] >= 1000, `requests ${starts[1] - starts[0]} ms apart`);
    // a caller that gave up while waiting sends nothing
    const gone = new AbortController(); gone.abort();
    assert.equal(await reverseLocationName(51.5, -0.12, { signal: gone.signal }), '');
    assert.equal(calls.length, 2);
    assert.equal(await reverseLocationName(Number.NaN, 0), '');
  } finally { globalThis.fetch = realFetch; console.warn = warn; }
});

test('the site keeps address answers by rounded position, query and language', () => {
  const key = (u, path, lang) => nominatimCacheKey(new URL(u), path, lang)?.url || null;
  const a = key('https://mapng.com/api/nominatim-osm/reverse?lat=35.19831&lon=-111.65127&format=json&addressdetails=1&zoom=16', '/reverse', 'en-US,en;q=0.9');
  const b = key('https://mapng.com/api/nominatim-geocode/reverse?lon=-111.6514&lat=35.1979&zoom=16&addressdetails=1&format=json', '/reverse', 'en-US');
  assert.equal(a, b);
  assert.match(a, /lat=35\.198&lon=-111\.651/);
  assert.notEqual(a, key('https://mapng.com/api/nominatim-osm/reverse?lat=35.19831&lon=-111.65127&format=json&addressdetails=1&zoom=16', '/reverse', 'de-DE'));
  assert.notEqual(a, key('https://mapng.com/api/nominatim-osm/reverse?lat=35.2&lon=-111.65127&format=json&addressdetails=1&zoom=16', '/reverse', 'en-US'));
  assert.equal(key('https://mapng.com/api/nominatim-osm/reverse?lat=x&lon=1', '/reverse', ''), null);
  assert.equal(key('https://mapng.com/api/nominatim-osm/search?q=%20Flagstaff%20&format=json', '/search', 'en'), key('https://mapng.com/api/nominatim-osm/search?q=flagstaff&format=json', '/search', 'en'));
  assert.equal(key('https://mapng.com/api/nominatim-osm/search?q=', '/search', 'en'), null);
  assert.equal(key('https://mapng.com/api/nominatim-osm/status', '/status', 'en'), null);
});
