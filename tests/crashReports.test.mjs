import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCrashReports, listReports, reportFile, reportSummary } from '../worker/crashReports.js';
import { readCapped } from '../worker/limits.js';

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

test('a report is stored privately with its log and dump, and read back only by the dashboard', async () => {
  const mails = [];
  const env = { OSM_TILES: fakeBucket(), CRASH_MAIL: { send: async (m) => mails.push(m) }, CRASH_MAIL_TO: 'dev@example.com', CRASH_MAIL_FROM: 'reports@mapng.com' };
  const r = await post(env, { kind: 'export', appVersion: '0.2.4', error: 'out of memory', log: 'a\nb', minidump: Buffer.from('MDMP').toString('base64'), area: { lat: 1, lng: 2 } }, '9.9.9.1');
  const { id } = await r.json();
  assert.match(id, /^MR-[A-Z0-9]{6}$/);
  // (beside the day's counter of reports and alert emails, and the public stats page's totals,
  // which hold the report's headings and nothing of the report: tests/publicStats.test.mjs)
  const tally = JSON.parse(env.OSM_TILES.store.get('crash-reports/_stats.json').value);
  assert.deepEqual([tally.total, tally.byKind, tally.byCause], [1, { export: 1 }, { memory: 1 }]);
  assert.ok(!JSON.stringify(tally).includes(id));
  const keys = [...env.OSM_TILES.store.keys()].filter((k) => !k.includes('/_counters/') && !k.endsWith('/_stats.json'));
  assert.equal(keys.length, 3);
  assert.ok(keys.every((k) => k.startsWith('crash-reports/') && k.includes(id)));
  assert.equal(mails.length, 1);
  assert.match(mails[0].subject, new RegExp(id));
  assert.equal(mails[0].to, 'dev@example.com');

  // (this route takes reports and gives none back: the old token routes are gone, whatever is sent with them)
  env.CRASH_ADMIN_TOKEN = 'secret-token';
  assert.equal((await call(env, '/api/crash/list')).status, 404);
  assert.equal((await call(env, '/api/crash/list', { headers: { Authorization: 'Bearer secret-token' } })).status, 404);
  assert.equal((await call(env, '/api/crash/file?key=x', { headers: { Authorization: 'Bearer secret-token' } })).status, 404);
  const list = await listReports(env, 50);
  assert.equal(list.total, 1);
  assert.equal(list.reports[0].id, id);
  assert.equal(list.reports[0].hasDump, true);
  const log = await reportFile(env, `${list.reports[0].key}log.txt`);
  assert.equal(await log.text(), 'a\nb');
  // nothing outside crash-reports/ is readable through it
  assert.equal(await reportFile(env, 'osm/manifest.json'), null);
});

test('bad input is refused, and a body past the limit is not read to its end', async () => {
  const env = { OSM_TILES: fakeBucket() };
  // (a body sent in pieces, with no length named: given up on at the limit)
  let pulled = 0;
  const endless = new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(1024)); } });
  assert.equal(await readCapped(new Request('https://mapng.com/api/crash', { method: 'POST', body: endless, duplex: 'half' }), 8 * 1024), null);
  assert.ok(pulled < 64);
  assert.equal(await readCapped(new Request('https://mapng.com/api/crash', { method: 'POST', body: 'abc' }), 8), 'abc');
  assert.equal(await readCapped(new Request('https://mapng.com/api/crash', { method: 'POST', body: 'abcdefghi' }), 8), null);
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
  // (a code with background areas is long: kept whole, a code cut short cannot be pasted back)
  const long = `mapng:1:${'a'.repeat(60000)}`;
  assert.equal(reportSummary({ kind: 'export', config: long }, 'MR-AAAAAA', 't').config, long);
});

test('a level report keeps the level\'s export report as its own file, read back only by the dashboard', async () => {
  const env = { OSM_TILES: fakeBucket() };
  const r = await post(env, { kind: 'level', appVersion: '0.2.18', level: 'Aerotie', description: 'two bridges at different heights', exportReport: 'MapNG BeamNG Level Export Report\n- Bridge decks: 30' }, '7.7.7.7');
  const { id } = await r.json();
  const key = [...env.OSM_TILES.store.keys()].find((k) => k.endsWith('export_report.txt'));
  assert.ok(key && key.includes(id));
  const list = await listReports(env, 50);
  assert.equal(list.reports[0].hasExportReport, true);
  assert.equal(list.reports[0].level, 'Aerotie');
  assert.equal(list.reports[0].exportReport, undefined);          // (the text is its own file, not in the summary)
  assert.equal((await call(env, `/api/crash/file?key=${encodeURIComponent(key)}`)).status, 404);
  const got = await reportFile(env, key);
  assert.match(await got.text(), /Bridge decks: 30/);
});

test('alert emails are capped an hour and a day whoever sends; reports are still stored', async () => {
  const { MAIL_PER_HOUR, MAIL_PER_DAY, mailAllowance } = await import('../worker/crashReports.js');
  const mails = [];
  const env = { OSM_TILES: fakeBucket(), CRASH_MAIL: { send: async (m) => mails.push(m) }, CRASH_MAIL_TO: 'dev@example.com', CRASH_MAIL_FROM: 'reports@mapng.com' };
  // 30 reports within the hour, each from another address (the per-address limit does not help here)
  for (let i = 0; i < 30; i++) assert.equal((await post(env, { kind: 'manual', description: `spam ${i}` }, `10.0.${i}.1`)).status, 200);
  assert.equal(mails.length, MAIL_PER_HOUR);
  assert.match(mails[MAIL_PER_HOUR - 1].text, /no more alert emails until the next hour/);
  assert.ok(!/no more alert emails/.test(mails[0].text));
  const stored = [...env.OSM_TILES.store.keys()].filter((k) => k.endsWith('report.json')).length;
  assert.equal(stored, 30);
  // the counters are not readable as report files, and not listed as reports
  const list = await listReports(env, 50);
  assert.equal(list.total, 30);
  // the day's cap, over the hours
  assert.deepEqual(mailAllowance({ mails: MAIL_PER_DAY, hours: {} }, '09'), { send: false, note: '' });
  assert.equal(mailAllowance({ mails: 0, hours: { '09': MAIL_PER_HOUR } }, '09').send, false);
  assert.equal(mailAllowance({ mails: 3, hours: { '09': MAIL_PER_HOUR } }, '10').send, true);
  assert.match(mailAllowance({ mails: MAIL_PER_DAY - 1, hours: {} }, '10').note, /until tomorrow/);
});

test('at most a set number of reports are stored a day in all', async () => {
  const { REPORTS_PER_DAY } = await import('../worker/crashReports.js');
  const env = { OSM_TILES: fakeBucket() };
  const day = new Date().toISOString().slice(0, 10);
  await env.OSM_TILES.put(`crash-reports/_counters/${day}.json`, JSON.stringify({ reports: REPORTS_PER_DAY - 1, mails: 0, hours: {} }));
  assert.equal((await post(env, { kind: 'manual', description: 'last one in' }, '10.9.9.1')).status, 200);
  assert.equal((await post(env, { kind: 'manual', description: 'one too many' }, '10.9.9.2')).status, 429);
});

// A level report also carries the level's JSON report (map data included), gzipped by the app, stored as its own file.
test('a level report keeps its JSON report gzipped, read back only by the dashboard; not gzip is dropped', async () => {
  const zlib = await import('node:zlib');
  const env = { OSM_TILES: fakeBucket() };
  const json = JSON.stringify({ format: 'mapng-export-report', mapData: { features: [{ id: '1' }] } });
  const r = await post(env, { kind: 'level', appVersion: '0.3.5', level: 'T', exportReport: '# r', exportReportJsonGz: zlib.gzipSync(json).toString('base64') }, '7.7.7.8');
  const { id } = await r.json();
  const key = [...env.OSM_TILES.store.keys()].find((k) => k.endsWith('export_report.json.gz'));
  assert.ok(key && key.includes(id));
  const list = await listReports(env, 50);
  assert.equal(list.reports[0].hasExportJson, true);
  assert.equal(list.reports[0].exportReportJsonGz, undefined);
  assert.equal((await call(env, `/api/crash/file?key=${encodeURIComponent(key)}`)).status, 404);
  const got = await reportFile(env, key);
  assert.equal(got.status, 200);
  // (the fake bucket keeps bytes as a latin1 string: read them from it)
  assert.equal(zlib.gunzipSync(Buffer.from(env.OSM_TILES.store.get(key).value, 'latin1')).toString(), json);
  const env2 = { OSM_TILES: fakeBucket() };
  await post(env2, { kind: 'level', appVersion: '0.3.5', level: 'T', exportReport: '# r', exportReportJsonGz: Buffer.from('not gzip').toString('base64') }, '7.7.7.9');
  assert.ok(![...env2.OSM_TILES.store.keys()].some((k) => k.endsWith('.gz')));
});

// The app packs the JSON report: keys and home folders out, gzipped; the map data left out past the size cap.
test('the JSON report is packed for sending: scrubbed, gzipped, map data dropped when too large', async () => {
  const zlib = await import('node:zlib');
  const { packExportJson } = await import('../desktop/reportScrub.js');
  const features = Array.from({ length: 3000 }, (_, i) => ({ id: String(i), tags: { name: `street ${Math.random()}` } }));
  const text = JSON.stringify({ format: 'mapng-export-report', jobLog: ['gpxzApiKey=ak_abcdefghijk'], mapData: { checksum: 'x', features } });
  const p = packExportJson(text);
  assert.equal(p.features, 3000); assert.equal(p.mapDataLeftOut, false);
  const back = zlib.gunzipSync(Buffer.from(p.gz, 'base64')).toString();
  assert.ok(!back.includes('ak_abcdefghijk'));
  const small = packExportJson(text, 4000);
  assert.equal(small.mapDataLeftOut, true); assert.equal(small.features, 0);
  assert.equal(JSON.parse(zlib.gunzipSync(Buffer.from(small.gz, 'base64')).toString()).mapData.checksum, 'x');
  assert.equal(packExportJson('{"not":"a report"}'), null);
  assert.equal(packExportJson(''), null);
});
