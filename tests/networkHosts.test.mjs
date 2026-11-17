import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { NETWORK_HOSTS, NETWORK_KINDS, LINKS_ONLY, networkHost } from '../desktop/networkHosts.js';

const REPO = new URL('..', import.meta.url).pathname;
// (what MapNG's own server asks other servers for, never the app: Cloudflare's figures for the stats and admin pages)
const SERVER_ONLY = ['api.cloudflare.com'];

test('every address in the app\'s code is on the list of what MapNG connects to, or named as a link only', () => {
  const files = execFileSync('git', ['ls-files', 'services', 'components', 'composables', 'stores', 'utils', 'src', 'worker', 'desktop', 'App.vue', 'main.js'], { cwd: REPO, encoding: 'utf8' })
    .split('\n').filter((f) => /\.(js|mjs|cjs|vue)$/.test(f) && !f.includes('node_modules') && !f.startsWith('desktop/scripts/'));
  const missing = new Map();
  for (const f of files) {
    const text = fs.readFileSync(REPO + f, 'utf8');
    for (const m of text.matchAll(/https?:\/\/([a-zA-Z0-9{}.$_-]+\.[a-z]{2,})/g)) {
      const host = m[1].replace(/^\{s\}/, '').toLowerCase();
      if (host.endsWith('.internal') || host.includes('$')) continue;   // (cache key names; addresses built from a variable)
      if (networkHost(host) || LINKS_ONLY.includes(host) || SERVER_ONLY.includes(host)) continue;
      missing.set(host, f);
    }
  }
  assert.deepEqual([...missing], [], 'add each to desktop/networkHosts.js (and to public/data.html), or to LINKS_ONLY when it only opens in the browser');
});

test('the list: known kinds, suffix entries, and the page public/data.html names every address', () => {
  for (const e of NETWORK_HOSTS) assert.ok(NETWORK_KINDS.includes(e.kind), `${e.host}: kind ${e.kind}`);
  assert.equal(networkHost('prd-tnm.s3.amazonaws.com')?.kind, 'elevation');
  assert.equal(networkHost('a.tile.openstreetmap.org')?.kind, 'pictures');
  assert.equal(networkHost('objects.githubusercontent.com')?.kind, 'updates');
  assert.equal(networkHost('MAPNG.com.')?.kind, 'mapng');
  assert.equal(networkHost('example.com'), null);
  assert.equal(networkHost('evilmapng.com'), null, 'no match by ending without a dot entry');
  const page = fs.readFileSync(REPO + 'public/data.html', 'utf8');
  for (const e of NETWORK_HOSTS) assert.ok(page.includes(e.host.startsWith('.') ? `*${e.host}` : e.host), `public/data.html does not name ${e.host}`);
});

test('network activity: requests are counted by host, unlisted addresses come first and are marked', async () => {
  const { noteHost, activityRows, activityHtml, resetActivity } = await import('../desktop/networkActivity.js');
  const { networkText } = await import('../desktop/menuText.js');
  resetActivity();
  noteHost('https://mapng.com/api/osm?bbox=1,2,3,4'); noteHost('mapng.com'); noteHost('https://s3.amazonaws.com/elevation-tiles-prod/x.png', true);
  noteHost('https://my-overpass.example.org/api/interpreter'); noteHost('app://mapng/index.html'); noteHost('http://localhost:5173/');
  const rows = activityRows();
  assert.deepEqual(rows.map((r) => [r.host, r.count, r.listed]), [['my-overpass.example.org', 1, false], ['mapng.com', 2, true], ['s3.amazonaws.com', 1, true]]);
  assert.equal(rows[2].failed, 1);
  for (const lang of ['en', 'de', 'es', 'fr', 'it', 'pl', 'ru']) {
    const t = networkText(lang); const html = activityHtml(t, '1.2.3');
    assert.ok(html.includes('my-overpass.example.org') && html.includes(t.notListed.replace(/'/g, '&#39;')) && !html.includes('bbox='), lang);
    assert.ok(!/<script/i.test(html), 'no script in the window');
    for (const k of ['mapng', 'elevation', 'pictures', 'mapdata', 'search', 'landcover', 'trees', 'projection', 'updates', 'analytics']) assert.ok(t.kinds[k], `${lang}: ${k}`);
  }
  noteHost('<img src=x onerror=1>.example'); assert.ok(!activityHtml(networkText('en'), '1').includes('<img'), 'names are escaped');
});

test('the address guard: listed addresses and the user\'s own server pass, everything else is refused', async () => {
  const { allowedUrl, setOwnServer } = await import('../desktop/networkGuard.js');
  setOwnServer('');
  for (const ok of ['https://mapng.com/api/osm', 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/1/1/1.png', 'https://prd-tnm.s3.amazonaws.com/x.tif',
    'https://b.tile.openstreetmap.org/1/1/1.png', 'https://objects.githubusercontent.com/x', 'https://rockyweb.usgs.gov/vdelivery/x', 'app://mapng/index.html',
    'data:text/plain,hi', 'blob:app://mapng/123', 'devtools://devtools/bundled/x', 'http://localhost:5173/', 'ws://127.0.0.1:5173/', 'not an address']) assert.equal(allowedUrl(ok).ok, true, ok);
  for (const no of ['https://example.com/', 'http://evil.test/x', 'https://mapng.com.evil.test/', 'https://evilmapng.com/', 'wss://tracker.example/', 'https://amazonaws.com.evil.test/x', 'https://192.0.2.7/x']) {
    const v = allowedUrl(no); assert.equal(v.ok, false, no); assert.ok(v.host, 'the refused host is named');
  }
  assert.equal(allowedUrl('https://my-overpass.example.org/api/interpreter').ok, false, 'not before it is set');
  assert.equal(setOwnServer('https://user:key@my-overpass.example.org/overpass/KEY/interpreter'), 'my-overpass.example.org');
  assert.equal(allowedUrl('https://my-overpass.example.org/api/interpreter').ok, true);
  assert.equal(allowedUrl('https://other.example.org/api/interpreter').ok, false);
  assert.equal(setOwnServer('http://insecure.example.org/'), '', 'https only');
  assert.equal(allowedUrl('https://my-overpass.example.org/api/interpreter').ok, false, 'cleared with the setting');
  setOwnServer('');
});

test('network activity: a refused address is counted apart and shown as refused', async () => {
  const { noteHost, activityRows, activityHtml, resetActivity } = await import('../desktop/networkActivity.js');
  const { networkText } = await import('../desktop/menuText.js');
  resetActivity();
  noteHost('mapng.com'); noteHost('tracker.example', false, true); noteHost('tracker.example', false, true);
  const rows = activityRows();
  assert.deepEqual(rows.map((r) => [r.host, r.count, r.blocked]), [['tracker.example', 0, 2], ['mapng.com', 1, 0]]);
  for (const lang of ['en', 'de', 'es', 'fr', 'it', 'pl', 'ru']) { const t = networkText(lang); assert.ok(activityHtml(t, '1').includes(t.blocked.replace(/'/g, '&#39;')), lang); assert.ok(t.blockedDetail.includes('{host}') && t.blockedTitle && t.refused, lang); }
});
