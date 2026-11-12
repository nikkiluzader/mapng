// services/webReports.js and services/sessionGuard.js: reports from the website, and the note of a job that never ended
import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSummary, prepareReport, sendReport, installConsoleTail, consoleTail } from '../services/webReports.js';

test('the browser and system in a few words', () => {
  assert.equal(browserSummary('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'), 'Chrome 142 on Windows');
  assert.equal(browserSummary('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0'), 'Edge 142 on Windows');
  assert.equal(browserSummary('Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0'), 'Firefox 145 on Linux');
  assert.equal(browserSummary('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Safari/605.1.15'), 'Safari 19 on macOS');
});

test('the page\'s last console lines are kept, long ones cut', () => {
  const fake = { log: () => {}, warn: () => {}, error: () => {} };
  installConsoleTail(fake);
  fake.log('first line'); fake.warn('careful', { a: 1 }); fake.error(new Error('broke')); fake.log('x'.repeat(2000));
  const lines = consoleTail().split('\n');
  assert.deepEqual(lines.slice(0, 3), ['first line', 'WARN careful {"a":1}', 'ERROR Error: broke']);
  assert.equal(lines[3].length, 400);
});

test('a report is shown before it is sent; without the location it carries no place and no settings code', async () => {
  const { token, preview } = await prepareReport('export', { error: 'Maximum call stack size exceeded', build: 'abc1234', config: 'mapng:1:xyz', area: { lat: 1, lng: 2 }, options: { levelName: 'x', gpxzApiKey: 'SECRET', onProgress() {} } });
  assert.equal(preview.appVersion, 'web (abc1234)'); assert.equal(preview.hasConfig, true); assert.ok(preview.logChars > 0);
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ id: 'MR-TEST01' }), { status: 200 }); };
  const r = await sendReport(token, { includeArea: false, description: 'it stopped at the roads step' }, fetchImpl);
  assert.equal(r.id, 'MR-TEST01');
  const body = sent[0].body;
  assert.equal(sent[0].url, '/api/crash');
  assert.equal(body.platform, 'web'); assert.equal(body.kind, 'export'); assert.equal(body.description, 'it stopped at the roads step');
  assert.equal(body.area, null); assert.equal(body.config, ''); assert.equal(body.options, null);
  assert.ok(!JSON.stringify(body).includes('SECRET'));
  // with the location: the code and the options, never the key
  const again = await prepareReport('generate', { config: 'mapng:1:xyz', area: { lat: 1, lng: 2 }, options: { gpxzApiKey: 'SECRET', levelName: 'x' } });
  await sendReport(again.token, { includeArea: true }, fetchImpl);
  assert.equal(sent[1].body.config, 'mapng:1:xyz'); assert.deepEqual(sent[1].body.options, { levelName: 'x' });
  await assert.rejects(() => sendReport(again.token, {}, fetchImpl), /no longer available/);
});

test('a job that never ended leaves a note; one that ends, or a page closed the ordinary way, leaves none', async () => {
  const data = new Map();
  globalThis.localStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
  const { markJobStart, markJobEnd, unfinishedJob, watchOrdinaryClose } = await import('../services/sessionGuard.js');
  assert.equal(unfinishedJob(), null);
  markJobStart('export', { code: 'mapng:1:abc', build: 'abc1234' });
  const note = unfinishedJob();
  assert.equal(note.kind, 'export'); assert.equal(note.code, 'mapng:1:abc'); assert.equal(note.build, 'abc1234');
  markJobEnd(); assert.equal(unfinishedJob(), null);
  // an ordinary close
  const handlers = {}; watchOrdinaryClose({ addEventListener: (name, fn) => { handlers[name] = fn; } });
  markJobStart('generate', { code: 'mapng:1:abc' }); handlers.pagehide(); assert.equal(unfinishedJob(), null);
  // a code too long to keep: the note without it
  markJobStart('generate', { code: 'x'.repeat(2 * 1024 * 1024) }); assert.equal(unfinishedJob().code, '');
  markJobEnd();
});
