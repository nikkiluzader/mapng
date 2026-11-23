// The export runner's fetch (desktop/runner/browserShims.mjs) with the network guard on: every address a
// request is sent on to is judged like the first, so a listed server cannot pass the app on to an unlisted one.
// Run in a process of its own: the shims replace the process's fetch and document.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = `
import http from 'node:http';
import { installBrowserShims } from ${JSON.stringify(fileURLToPath(new URL('../desktop/runner/browserShims.mjs', import.meta.url)))};
const seen = [];
const serve = (handler) => new Promise((resolve) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => resolve(s)); });
const other = await serve((req, res) => { seen.push({ at: 'other', method: req.method, key: req.headers['x-api-key'] || null }); res.end('other'); });
const main = await serve((req, res) => {
  seen.push({ at: req.url, method: req.method, key: req.headers['x-api-key'] || null });
  if (req.url === '/out') { res.writeHead(302, { location: 'http://unlisted.invalid/x' }); res.end(); }
  else if (req.url === '/hop') { res.writeHead(302, { location: '/end' }); res.end(); }
  else if (req.url === '/cross') { res.writeHead(307, { location: 'http://localhost:' + other.address().port + '/' }); res.end(); }
  else if (req.url === '/post') { res.writeHead(303, { location: '/end' }); res.end(); }
  else if (req.url === '/file') { res.writeHead(302, { location: 'file:///etc/hostname' }); res.end(); }
  else res.end('end');
});
const base = 'http://127.0.0.1:' + main.address().port;
installBrowserShims({ assetsDir: null });
const out = {};
out.unlisted = await fetch(base + '/out').then(() => 'answered', (e) => String(e.message));
out.hop = await (await fetch(base + '/hop')).text();
out.cross = await (await fetch(base + '/cross', { headers: { 'x-api-key': 'secret' } })).text();
out.post = await (await fetch(base + '/post', { method: 'POST', body: 'a=1' })).text();
out.file = await fetch(base + '/file').then(() => 'answered', (e) => String(e.message));
out.manual = (await fetch(base + '/hop', { redirect: 'manual' })).status;
out.seen = seen;
console.log(JSON.stringify(out));
main.close(); other.close();
process.exit(0);
`;

test('the runner judges every address a request is sent on to', () => {
  const text = execFileSync(process.execPath, ['--input-type=module', '-e', SCRIPT], { env: { ...process.env, MAPNG_NET_GUARD: '1' }, timeout: 30000 }).toString();
  const out = JSON.parse(text.trim().split('\n').pop());
  // an unlisted address is never asked, and the error names it
  assert.match(out.unlisted, /did not connect to unlisted\.invalid/);
  // a redirect on the same, allowed server is followed
  assert.equal(out.hop, 'end');
  // to another allowed server: followed, without the key meant for the first
  assert.equal(out.cross, 'other');
  assert.deepEqual(out.seen.find((s) => s.at === 'other'), { at: 'other', method: 'GET', key: null });
  assert.equal(out.seen.find((s) => s.at === '/cross').key, 'secret');
  // a POST answered 303 is asked again as a GET
  assert.equal(out.post, 'end');
  // never to a file
  assert.match(out.file, /did not follow a redirect to a file: address/);
  // a caller that asked for no following gets the redirect itself
  assert.equal(out.manual, 302);
});
