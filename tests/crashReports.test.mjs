import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCrashReports, reportSummary } from '../worker/crashReports.js';

// an in-memory stand-in for the R2 bucket binding
function fakeBucket() {
  const store = new Map();
  return {
    store,
    async put(key, value, opts) { store.set(key, { value: typeof value === 'string' ? value : Buffer.from(value).toString('latin1'), type: opts?.httpMetadata?.contentType }); },
    async get(key) {
      const o = store.get(key);
      if (!o) return null;
      return { body: o.value, httpMetadata: { contentType: o.type }, json: async () => JSON.parse(o.value) };
    },
    async list({ prefix }) { return { objects: [...store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }; },
  };
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ctx = { waitUntil: (p) => p };
const call = (env, path, init = {}) => handleCrashReports(new Request(`https://mapng.com${path}`, init), env, ctx, new URL(`https://mapng.com${path}`), json);
const post = (env, body, ip = '1.2.3.4') => call(env, '/api/crash', { method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify(body) });

test('a report is stored privately with its log and dump, and read back only with the token', async () => {
  const mails = [];
  const env = { OSM_TILES: fakeBucket(), CRASH_ADMIN_TOKEN: 'secret-token', CRASH_MAIL: { send: async (m) => mails.push(m) }, CRASH_MAIL_TO: 'dev@example.com', CRASH_MAIL_FROM: 'reports@mapng.com' };
  const r = await post(env, { kind: 'export', appVersion: '0.2.4', error: 'out of memory', log: 'a\nb', minidump: Buffer.from('MDMP').toString('base64'), area: { lat: 1, lng: 2 } }, '9.9.9.1');
  const { id } = await r.json();
  assert.match(id, /^MR-[A-Z0-9]{6}$/);
  const keys = [...env.OSM_TILES.store.keys()];
  assert.equal(keys.length, 3);
  assert.ok(keys.every((k) => k.startsWith('crash-reports/') && k.includes(id)));
  assert.equal(mails.length, 1);
  assert.match(mails[0].subject, new RegExp(id));
  assert.equal(mails[0].to, 'dev@example.com');

  assert.equal((await call(env, '/api/crash/list')).status, 401);
  assert.equal((await call(env, '/api/crash/list', { headers: { Authorization: 'Bearer wrong-token!' } })).status, 401);
  const list = await (await call(env, '/api/crash/list', { headers: { Authorization: 'Bearer secret-token' } })).json();
  assert.equal(list.total, 1);
  assert.equal(list.reports[0].id, id);
  assert.equal(list.reports[0].hasDump, true);
  const log = await call(env, `/api/crash/file?key=${encodeURIComponent(`${list.reports[0].key}log.txt`)}`, { headers: { Authorization: 'Bearer secret-token' } });
  assert.equal(await log.text(), 'a\nb');
  // nothing outside crash-reports/ is readable through it
  assert.equal((await call(env, '/api/crash/file?key=osm/manifest.json', { headers: { Authorization: 'Bearer secret-token' } })).status, 404);
});

test('without a token secret nobody can read reports; bad input is refused', async () => {
  const env = { OSM_TILES: fakeBucket() };
  assert.equal((await call(env, '/api/crash/list', { headers: { Authorization: 'Bearer ' } })).status, 503);
  assert.equal((await call(env, '/api/crash')).status, 405);
  assert.equal((await call(env, '/api/crash', { method: 'POST', body: 'not json', headers: { 'CF-Connecting-IP': '9.9.9.2' } })).status, 400);
  assert.equal((await post(env, { appVersion: 'no kind' }, '9.9.9.2')).status, 400);
});

test('at most 10 reports an hour from one address', async () => {
  const env = { OSM_TILES: fakeBucket() };
  const codes = [];
  for (let i = 0; i < 12; i++) codes.push((await post(env, { kind: 'manual', description: `n${i}` }, '9.9.9.3')).status);
  assert.deepEqual(codes.slice(0, 10), Array(10).fill(200));
  assert.deepEqual(codes.slice(10), [429, 429]);
});

test('the summary keeps only known fields, clipped', () => {
  const s = reportSummary({ kind: 'crash', error: 'x'.repeat(9000), secret: 'nope', log: 'l' }, 'MR-AAAAAA', 't');
  assert.equal(s.error.length, 4000);
  assert.equal('secret' in s, false);
  assert.equal('log' in s, false);
  assert.equal(s.hasLog, true);
});

test('desktop reports drop keys, home folders and (if asked) the location', async () => {
  const { cleanOptions, scrubText } = await import('../desktop/reportScrub.js');
  const o = cleanOptions({ backdropGpxzApiKey: 'abc', overpass: { url: 'u', authToken: 't' }, center: { lat: 1, lng: 2 }, resolution: 4096, onProgress: () => {} });
  assert.deepEqual(o, { overpass: { url: 'u' }, center: { lat: 1, lng: 2 }, resolution: 4096 });
  assert.deepEqual(cleanOptions({ center: { lat: 1 }, bounds: [1, 2], resolution: 1 }, { keepLocation: false }), { resolution: 1 });
  const t = scrubText('saved C:\\Users\\nikki\\AppData\\x.zip and /home/nikki/a; GPXZ key=SECRET123 apiKey: "zzz"', 'C:\\Users\\nikki');
  assert.ok(t.includes('saved ~\\AppData\\x.zip'));
  assert.ok(!t.includes('SECRET123') && !t.includes('zzz'));
  assert.ok(scrubText('/home/nikki/a', '/home/nikki').startsWith('~/a'));
});

test('a report keeps a session code, and only a session code, in config', () => {
  assert.equal(reportSummary({ kind: 'export', config: 'mapng:1:abc' }, 'MR-AAAAAA', 't').config, 'mapng:1:abc');
  assert.equal(reportSummary({ kind: 'export', config: '<script>' }, 'MR-AAAAAA', 't').config, '');
});

test('a level report keeps the level\'s export report as its own file, read back only with the token', async () => {
  const env = { OSM_TILES: fakeBucket(), CRASH_ADMIN_TOKEN: 'secret-token' };
  const r = await post(env, { kind: 'level', appVersion: '0.2.18', level: 'Aerotie', description: 'two bridges at different heights', exportReport: 'MapNG BeamNG Level Export Report\n- Bridge decks: 30' }, '7.7.7.7');
  const { id } = await r.json();
  const key = [...env.OSM_TILES.store.keys()].find((k) => k.endsWith('export_report.txt'));
  assert.ok(key && key.includes(id));
  const list = await (await call(env, '/api/crash/list', { headers: { Authorization: 'Bearer secret-token' } })).json();
  assert.equal(list.reports[0].hasExportReport, true);
  assert.equal(list.reports[0].level, 'Aerotie');
  assert.equal(list.reports[0].exportReport, undefined);          // (the text is its own file, not in the summary)
  assert.equal((await call(env, `/api/crash/file?key=${encodeURIComponent(key)}`)).status, 401);
  const got = await call(env, `/api/crash/file?key=${encodeURIComponent(key)}`, { headers: { Authorization: 'Bearer secret-token' } });
  assert.match(await got.text(), /Bridge decks: 30/);
});
