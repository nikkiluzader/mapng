// /api/stats and the public stats page: counts only, from fixed lists (public/data.html#stats).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COUNTRY_FLOOR, REPORT_CAUSES, REPORT_KINDS, REPORT_SYSTEMS, addToTally, causeOf, cleanTally, emptyTally,
  publicStats, shapeDownloads, shapeVisits,
} from '../worker/publicStats.js';

const SECRET = 'Rue des Secrets 12, C:\\Users\\somebody\\levels';
const report = (over = {}) => ({
  id: 'MR-ABC234', receivedAt: '2026-11-14T10:00:00.000Z', kind: 'export', appVersion: '0.3.1', platform: 'win32',
  os: 'Windows_NT 10.0', error: `Invalid string length at ${SECRET}`, description: `my street is ${SECRET}`,
  area: { lat: 48.85, lng: 2.35 }, level: 'my_home_town', config: 'mapng:1:abc', gpu: 'Some GPU', ...over,
});

test('a report is counted under fixed headings and nothing of it is kept', () => {
  let t = emptyTally();
  t = addToTally(t, report());
  t = addToTally(t, report({ kind: 'generate', platform: 'web', appVersion: 'web', error: 'out of memory: the satellite picture could not be fitted' }));
  t = addToTally(t, report({ kind: 'surprise', platform: 'beos', appVersion: `1.0 ${SECRET}`, error: SECRET, receivedAt: 'nonsense' }));
  assert.equal(t.total, 3);
  assert.deepEqual(t.byKind, { export: 1, generate: 1, other: 1 });
  assert.deepEqual(t.bySystem, { windows: 1, web: 1, other: 1 });
  assert.deepEqual(t.byCause, { memory: 2, other: 1 });
  assert.deepEqual(t.byVersion, { '0.3.1': 1, web: 1, other: 1 });
  assert.deepEqual(t.byDay, { '2026-11-14': 2 });
  const text = JSON.stringify(t);
  for (const word of ['Secrets', 'somebody', 'MR-ABC234', '48.85', 'my_home_town', 'mapng:1', 'GPU', 'Windows_NT']) assert.ok(!text.includes(word), word);
  for (const k of Object.keys(t.byKind)) assert.ok(REPORT_KINDS.includes(k));
  for (const k of Object.keys(t.bySystem)) assert.ok(REPORT_SYSTEMS.includes(k));
  for (const k of Object.keys(t.byCause)) assert.ok(REPORT_CAUSES.includes(k));
});

test('test reports are not counted, and adding does not change the tally it was given', () => {
  const before = addToTally(emptyTally(), report());
  const copy = JSON.stringify(before);
  assert.equal(addToTally(before, report({ platform: 'test' })).total, 1);
  assert.equal(addToTally(before, report({ appVersion: 'test' })).total, 1);
  assert.equal(addToTally(before, report()).total, 2);
  assert.equal(JSON.stringify(before), copy);
});

test('causes: each error lands under the heading a person would give it', () => {
  const of = (kind, error) => causeOf({ kind, error });
  assert.equal(of('generate', 'Array buffer allocation failed'), 'memory');
  assert.equal(of('crash', 'The MapNG window stopped (oom, exit code -536870904).'), 'memory');
  assert.equal(of('export', 'An export was still running when the page closed (build 1234567).'), 'closed');
  assert.equal(of('generate', 'ENOSPC: no space left on device, write'), 'disk');
  assert.equal(of('generate', 'Failed to download elevation terrain tiles (6/6 failed).'), 'download');
  assert.equal(of('generate', 'Create skia surface failed'), 'graphics');
  assert.equal(of('crash', 'The MapNG window stopped (crashed, exit code 132).'), 'crash');
  assert.equal(of('manual', ''), 'byHand');
  assert.equal(of('level', ''), 'byHand');
  assert.equal(of('export', 'Maximum call stack size exceeded'), 'other');
});

test('a stored tally is shown only through the fixed lists', () => {
  const shown = cleanTally({ total: 4, byKind: { export: 2, [SECRET]: 1 }, bySystem: { web: 1, nope: 3 }, byCause: { memory: 1, 'x<script>': 2 }, byVersion: { '0.3.1': 1, '0.3.1-dev.4': 1, [SECRET]: 1 }, byDay: { '2026-11-14': 2, yesterday: 1, '2026-11-13': 'many' }, extra: SECRET });
  assert.deepEqual(shown, { total: 4, byKind: { export: 2 }, bySystem: { web: 1 }, byCause: { memory: 1 }, byVersion: { '0.3.1': 1, '0.3.1-dev.4': 1 }, byDay: { '2026-11-14': 2 } });
  assert.deepEqual(cleanTally(null), { total: 0, byKind: {}, bySystem: {}, byCause: {}, byVersion: {}, byDay: {} });
});

test('visits: small countries are left out, browsers keep only a family name', () => {
  const v = shapeVisits({
    days: [{ dimensions: { date: '2026-11-13' }, sum: { requests: 100, pageViews: 40, bytes: 5000, cachedBytes: 1000, threats: 2, browserMap: [{ uaBrowserFamily: 'Chrome', pageViews: 20 }, { uaBrowserFamily: 'ChromeMobile', pageViews: 5 }, { uaBrowserFamily: 'Curl', pageViews: 3 }, { uaBrowserFamily: 'Firefox', pageViews: 12 }] }, uniq: { uniques: 30 } }],
    countries: [{ count: 900, dimensions: { clientCountryName: 'US' } }, { count: COUNTRY_FLOOR, dimensions: { clientCountryName: 'IS' } }, { count: COUNTRY_FLOOR - 1, dimensions: { clientCountryName: 'TV' } }, { count: 500, dimensions: { clientCountryName: 'XX' } }, { count: 500, dimensions: { clientCountryName: 'T1' } }, { count: 500, dimensions: { clientCountryName: 'not a code' } }],
  });
  assert.deepEqual(v.countries, [['US', 900], ['IS', COUNTRY_FLOOR]]);
  assert.deepEqual(v.browsers, [['Chrome', 25], ['Firefox', 12], ['other', 3]]);
  assert.deepEqual(v.days, [{ date: '2026-11-13', pageViews: 40, visitors: 30, requests: 100, bytes: 5000, cachedBytes: 1000, blocked: 2 }]);
});

test('downloads: drafts are skipped, files are sorted into three kinds', () => {
  const d = shapeDownloads({ stargazers_count: 7, forks_count: 2 }, [
    { tag_name: 'v1.0.0', published_at: '2026-11-01T00:00:00Z', assets: [{ name: 'MapNG-Setup-1.0.0.exe', download_count: 10 }, { name: 'MapNG-Setup-1.0.0.exe.blockmap', download_count: 99 }, { name: 'MapNG-1.0.0-windows-portable.zip', download_count: 4 }, { name: 'MapNG-1.0.0-x86_64.AppImage', download_count: 3 }, { name: 'latest.yml', download_count: 500 }] },
    { tag_name: 'v1.0.1-dev.1', prerelease: true, published_at: '2026-11-02T00:00:00Z', assets: [{ name: 'MapNG-Setup-1.0.1-dev.1.exe', download_count: 2 }] },
    { tag_name: 'v1.1.0', draft: true, assets: [{ name: 'MapNG-Setup-1.1.0.exe', download_count: 50 }] },
  ]);
  assert.deepEqual(d, { stars: 7, forks: 2, total: 19, releases: [{ tag: 'v1.0.0', day: '2026-11-01', test: false, windowsInstaller: 10, windowsPortable: 4, linux: 3 }, { tag: 'v1.0.1-dev.1', day: '2026-11-02', test: true, windowsInstaller: 2, windowsPortable: 0, linux: 0 }] });
});

test('the whole answer: only the listed parts, and it stands when nothing is set up', async () => {
  const failing = async () => { throw new Error('offline'); };
  const bare = await publicStats({}, failing, Date.UTC(2026, 10, 14));
  assert.deepEqual(Object.keys(bare).sort(), ['about', 'at', 'countryFloor', 'downloads', 'reports', 'settingValues', 'visits', 'windowDays']);
  assert.equal(bare.visits, null);
  assert.equal(bare.downloads, null);
  assert.equal(bare.reports.total, 0);
  assert.ok(bare.settingValues.resolution.includes('8192'));
  // (a stored tally with something odd in it never gets out)
  const env = { OSM_TILES: { get: async (k) => (k.endsWith('_stats.json') ? { json: async () => ({ total: 1, byKind: { export: 1 }, note: SECRET }) } : null), put: async () => {} } };
  const withTally = await publicStats(env, failing, Date.UTC(2026, 10, 14));
  assert.equal(withTally.reports.total, 1);
  assert.ok(!JSON.stringify(withTally).includes('Secrets'));
});

test('the page has a name for every heading, and the data page explains the stats page', () => {
  const page = readFileSync(new URL('../public/stats.html', import.meta.url), 'utf8');
  for (const k of [...REPORT_CAUSES, ...REPORT_KINDS]) assert.ok(new RegExp(`\\b${k}: ['"]`).test(page), `stats.html names "${k}"`);
  for (const k of REPORT_SYSTEMS) assert.ok(new RegExp(`\\b${k}: ['"]`).test(page), `stats.html names "${k}"`);
  assert.ok(page.includes(`fewer than ${COUNTRY_FLOOR} visits`));
  const data = readFileSync(new URL('../public/data.html', import.meta.url), 'utf8');
  assert.ok(data.includes('id="stats"') && data.includes('/api/stats') && data.includes(`at least ${COUNTRY_FLOOR} visits`));
});

// ---- the security pass of 2026-11-14 (worker/index.js) ----
import worker, { hardenApiResponse, nominatimUpstreamSearch } from '../worker/index.js';

test('every /api/ answer: no sniffing, never a page of mapng.com, no cookie from a passed-through server', () => {
  const r = hardenApiResponse(new Response('<script>alert(1)</script>', { status: 200, headers: { 'Content-Type': 'text/html', 'Set-Cookie': 'a=b', 'X-Keep': 'yes' } }));
  assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(r.headers.get('Content-Security-Policy'), /^sandbox;/);
  assert.match(r.headers.get('Strict-Transport-Security'), /max-age=\d+/);
  assert.equal(r.headers.get('Set-Cookie'), null);
  assert.equal(r.headers.get('X-Keep'), 'yes');
  assert.equal(r.status, 200);
});

test('an address lookup sends on only what its cache key is made of', () => {
  const u = (s) => new URL(`https://mapng.com/api/nominatim-osm${s}`);
  assert.equal(nominatimUpstreamSearch(u('/search?q=paris&format=json&limit=5&countrycodes=us&json_callback=x&viewbox=1,2,3,4'), '/search'), 'q=paris&format=json&limit=5');
  assert.equal(nominatimUpstreamSearch(u('/reverse?lat=40.7&lon=-74&lat=10&lon=10&format=json&zoom=16&accept-language=xx'), '/reverse'), 'lat=40.7&lon=-74&zoom=16&format=json');
  assert.equal(nominatimUpstreamSearch(u('/status'), '/status'), null);
});

test('the pass-through routes serve only the paths the app uses', async () => {
  const asked = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { asked.push([String(url), init?.method]); return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'x=1' } }); };
  globalThis.caches = { default: { match: async () => null, put: async () => {}, delete: async () => {} } };
  const env = { ASSETS: { fetch: async () => new Response('asset') } };
  const ctx = { waitUntil: () => {} };
  const get = (path, init) => worker.fetch(new Request(`https://mapng.com${path}`, init), env, ctx);
  try {
    for (const path of ['/api/nominatim-osm/status', '/api/nominatim-osm/details?osmtype=W&osmid=1', '/api/nominatim-osm/search?q=x&format=html', '/api/kron86/', '/api/kron86/index.html?x=<script>', '/api/kron86/wss/service/../../etc', '/api/kron86-opendata/somewhere/page.html', '/api/gpxz/v1/account', '/api/gpxz/v2/anything']) {
      assert.equal((await get(path)).status, 404, path);
    }
    assert.equal((await get('/api/gpxz/v1/elevation/point?lat=0&lon=0', { method: 'DELETE' })).status, 405);
    assert.deepEqual(asked, []);
    const ok = await get('/api/gpxz/v1/elevation/point?lat=0&lon=0', { headers: { 'x-api-key': 'k' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('Set-Cookie'), null);
    assert.equal(ok.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal((await get('/api/kron86/wss/service/PZGIK/NumerycznyModelTerenuEVRF2007/WFS/Skorowidze?SERVICE=WFS')).status, 200);
    assert.equal((await get('/api/kron86-opendata/NumDaneWys/NMT/82047/82047_1474735_M-33-44-A-b-1-4.asc')).status, 200);
    assert.equal((await get('/api/nominatim-osm/search?q=paris&format=json&countrycodes=us')).status, 200);
    assert.deepEqual(asked.map(([u]) => u), [
      'https://api.gpxz.io/v1/elevation/point?lat=0&lon=0',
      'https://mapy.geoportal.gov.pl/wss/service/PZGIK/NumerycznyModelTerenuEVRF2007/WFS/Skorowidze?SERVICE=WFS',
      'https://opendata.geoportal.gov.pl/NumDaneWys/NMT/82047/82047_1474735_M-33-44-A-b-1-4.asc',
      'https://nominatim.openstreetmap.org/search?q=paris&format=json',
    ]);
    // (pages are not touched: the app's own headers file covers those)
    assert.equal((await get('/stats.html')).headers.get('Content-Security-Policy'), null);
  } finally { globalThis.fetch = realFetch; }
});
