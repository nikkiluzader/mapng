// The app page's content policy (worker/index.js appContentPolicy, desktop/main.js APP_CONTENT_POLICY).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import worker, { appContentPolicy } from '../worker/index.js';
import { REPORT_SCRIPT, qualityReportHtml } from '../services/sourceQuality.js';

const desktopMain = readFileSync(new URL('../desktop/main.js', import.meta.url), 'utf8');
const desktopPolicy = /export const APP_CONTENT_POLICY = \[([\s\S]*?)\]\.join/.exec(desktopMain)[1];

test("the one script allowed by its hash is the quality report's, on the site and in the desktop app", () => {
  const hash = `'sha256-${crypto.createHash('sha256').update(REPORT_SCRIPT).digest('base64')}'`;
  assert.ok(appContentPolicy('x').includes(hash), 'worker/index.js REPORT_SCRIPT_HASH is out of step: ' + hash);
  assert.ok(desktopPolicy.includes(hash), 'desktop/main.js APP_CONTENT_POLICY is out of step: ' + hash);
  assert.equal(typeof qualityReportHtml, 'function');
});

test('no script written into the page may run, on the site or in the desktop app', () => {
  for (const policy of [appContentPolicy('abc'), desktopPolicy]) {
    const script = /script-src ([^;"]*)/.exec(policy)[1];
    assert.ok(!script.includes("'unsafe-inline'") && !script.includes("'unsafe-eval'") && !/\shttps:(\s|$)/.test(script) && !script.includes('*'), script);
    assert.match(policy, /object-src 'none'/);
    assert.match(policy, /base-uri 'self'/);
  }
  assert.match(appContentPolicy('abc'), /'nonce-abc'/);
  assert.ok(!desktopPolicy.includes('nonce-'));
});

test("the app's page is answered with the policy and a nonce of its own each time; other pages are left alone", async () => {
  const env = { ASSETS: { fetch: async (req) => new Response('<html></html>', { headers: { 'Content-Type': new URL(req.url).pathname.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' } }) } };
  const get = (path) => worker.fetch(new Request(`https://mapng.com${path}`), env, { waitUntil: () => {} });
  const nonces = new Set();
  for (const path of ['/', '/index.html', '/']) {
    const policy = (await get(path)).headers.get('Content-Security-Policy');
    assert.match(policy, /script-src 'self' 'wasm-unsafe-eval' 'nonce-[A-Za-z0-9+/=]{20,}'/);
    nonces.add(/'nonce-([^']+)'/.exec(policy)[1]);
  }
  assert.equal(nonces.size, 3);
  assert.equal((await get('/data.html')).headers.get('Content-Security-Policy'), null);
  // (the page's storage answering something that is not a page: passed on as it is)
  const odd = { ASSETS: { fetch: async () => new Response('x', { headers: { 'Content-Type': 'text/plain' } }) } };
  assert.equal((await worker.fetch(new Request('https://mapng.com/'), odd, {})).headers.get('Content-Security-Policy'), null);
});
