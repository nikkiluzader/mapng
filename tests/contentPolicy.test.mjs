// The app page's content policy (worker/index.js appContentPolicy, desktop/main.js APP_CONTENT_POLICY).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import worker, { adminContentPolicy, appContentPolicy } from '../worker/index.js';
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

// The dashboard shows reports, written by whoever sent them: nothing written into its page may run.
test("the dashboard's page runs only its own script file, and is answered with that policy", async () => {
  const policy = adminContentPolicy('abc');
  const script = /script-src ([^;]*)/.exec(policy)[1];
  assert.ok(!script.includes("'unsafe-inline'") && !script.includes("'unsafe-eval'") && !/\shttps:(\s|$)/.test(script) && !script.includes('*'), script);
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /connect-src 'self' https:\/\/api\.github\.com/);
  assert.match(policy, /frame-ancestors 'none'/);
  // the page itself: one script, by its address, and no handler written into a tag
  const page = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
  const scripts = [...page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.match(scripts[0][1], /src="\/admin\.js"/);
  assert.equal(scripts[0][2].trim(), '');
  assert.ok(!/\son[a-z]+\s*=\s*["']/i.test(page), 'an inline event handler would be blocked by the policy');
  // every address the script asks is one the policy allows
  const js = readFileSync(new URL('../public/admin.js', import.meta.url), 'utf8');
  const asked = [...js.matchAll(/(?:fetch|getJson)\(\s*[`'"](https?:\/\/[^/`'"$]+)/g)].map((m) => m[1]);
  assert.ok(asked.length > 0);
  for (const origin of asked) assert.ok(policy.includes(origin), `${origin} is asked by admin.js but not in adminContentPolicy`);
  const env = { ASSETS: { fetch: async () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) } };
  const nonces = new Set();
  for (const path of ['/admin', '/admin.html', '/admin']) {
    const got = (await worker.fetch(new Request(`https://mapng.com${path}`), env, { waitUntil: () => {} })).headers.get('Content-Security-Policy');
    assert.match(got, /script-src 'self' 'nonce-[A-Za-z0-9+/=]{20,}'/);
    nonces.add(/'nonce-([^']+)'/.exec(got)[1]);
  }
  assert.equal(nonces.size, 3);
});
