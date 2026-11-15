// worker/limits.js: who a sender is, and that a missing binding limits nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DAILY, overBudget, overRate, senderKey } from '../worker/limits.js';
import { ExportHotspots } from '../worker/hotspots.js';

const from = (ip) => new Request('https://mapng.com/', { headers: ip ? { 'CF-Connecting-IP': ip } : {} });

test('a sender is its address, or the /64 of an IPv6 one', () => {
  assert.equal(senderKey(from('203.0.113.9')), '203.0.113.9');
  assert.equal(senderKey(from('2001:db8:aa:bb:1:2:3:4')), '2001:db8:aa:bb::/64');
  assert.equal(senderKey(from('2001:DB8:aa:bb:ffff:ffff:ffff:ffff')), '2001:db8:aa:bb::/64');
  assert.equal(senderKey(from('2001:db8::1')), '2001:db8:0:0::/64');
  assert.equal(senderKey(from('2001:db8:aa:bb::9')), '2001:db8:aa:bb::/64');
  assert.equal(senderKey(from('')), 'unknown');
});

test('the per-sender limiter is asked with the scope and the sender; without one nothing is limited', async () => {
  const asked = [];
  const env = { RL_WRITE: { limit: async ({ key }) => { asked.push(key); return { success: asked.length < 3 }; } } };
  assert.equal(await overRate(env, 'RL_WRITE', from('2001:db8:aa:bb:1:2:3:4'), 'crash'), false);
  assert.equal(await overRate(env, 'RL_WRITE', from('2001:db8:aa:bb:9:9:9:9'), 'crash'), false);
  assert.equal(await overRate(env, 'RL_WRITE', from('2001:db8:aa:bb:5:5:5:5'), 'crash'), true);
  assert.deepEqual([...new Set(asked)], ['crash:2001:db8:aa:bb::/64']);
  assert.equal(await overRate({}, 'RL_WRITE', from('1.2.3.4'), 'crash'), false);
  assert.equal(await overRate({ RL_WRITE: { limit: async () => { throw new Error('down'); } } }, 'RL_WRITE', from('1.2.3.4'), 'crash'), false);
  assert.equal(await overBudget({}, 'reports', DAILY.reports), false);
});

// (a stand-in for the Durable Object's SQLite: just the budgets table's three statements)
function fakeSql() {
  const rows = new Map();
  return { rows, exec(q, ...a) {
    if (q.startsWith('CREATE')) return { toArray: () => [] };
    if (q.startsWith('SELECT count FROM budgets')) { const v = rows.get(`${a[0]}|${a[1]}`); return { toArray: () => (v == null ? [] : [{ count: v }]) }; }
    if (q.startsWith('INSERT INTO budgets')) { const k = `${a[0]}|${a[1]}`; rows.set(k, rows.has(k) ? rows.get(k) + a[3] : a[2]); return { toArray: () => [] }; }
    if (q.startsWith('DELETE FROM budgets')) { for (const k of [...rows.keys()]) if (k.split('|')[0] < a[0]) rows.delete(k); return { toArray: () => [] }; }
    throw new Error(`unexpected: ${q}`);
  } };
}

test("a day's total is taken until it is used up, then refused", async () => {
  const object = new ExportHotspots({ storage: { sql: fakeSql() } });
  const env = { HOTSPOTS: { idFromName: () => 'id', get: () => ({ fetch: (url, init) => object.fetch(new Request(url, init)) }) } };
  assert.equal(await overBudget(env, 'reports', 3), false);
  assert.equal(await overBudget(env, 'reports', 3), false);
  assert.equal(await overBudget(env, 'reports', 3), false);
  assert.equal(await overBudget(env, 'reports', 3), true);
  assert.equal(await overBudget(env, 'reports', 3), true);
  // (another total is its own; a batch takes several at once and may pass the line once)
  assert.equal(await overBudget(env, 'mapterhornTiles', 100, 50), false);
  assert.equal(await overBudget(env, 'mapterhornTiles', 100, 50), false);
  assert.equal(await overBudget(env, 'mapterhornTiles', 100, 50), true);
  // (a name that is not a plain word is refused, not stored)
  assert.equal(object.takeBudget("x'; DROP", 5), false);
});

// ---- desktop: keys and private addresses stay out of what is written down ----
import { shownUrl } from '../desktop/runner/browserShims.mjs';
import { scrubText } from '../desktop/reportScrub.js';

test("the user's own Overpass server and user:password parts are never written down", () => {
  const custom = 'https://overpass.example.org/k/SECRETKEY/api/interpreter?key=ALSOSECRET';
  assert.equal(shownUrl('https://overpass.example.org/k/SECRETKEY/api/interpreter?data=x', custom), 'custom-overpass:');
  assert.equal(shownUrl('https://tiles.mapterhorn.com/12/1/2.webp', custom), 'https://tiles.mapterhorn.com/12/1/2.webp');
  assert.equal(shownUrl('https://user:pass@host.example/api?x=1', ''), 'https://host.example/api?x=1');
  assert.equal(shownUrl('/api/osm?bbox=1,2,3,4', custom), '/api/osm?bbox=1,2,3,4');
  assert.equal(scrubText('fetch failed https://me:hunter2@host.example/x and key=abc123', '/home/someone'), 'fetch failed https://host.example/x and key=[hidden]');
});

// ---- a config from someone else ----
import { describeSessionConfig, sanitizeSessionConfig, shareIdFrom, isShareHash } from '../services/sessionConfig.js';

test('a pasted config is brought into range before it is shown or applied', () => {
  const c = sanitizeSessionConfig({ center: { lat: 999, lng: 5 }, processingMetersPerPixel: 1e9, zoom: 400, elevationUnitOverride: 'furlongs', backgroundMask: { version: 1, bounds: {}, paint: new Array(50000).fill(0) }, resolution: 4096 });
  assert.deepEqual(c, { processingMetersPerPixel: 64, zoom: 22, resolution: 4096 });
  const fine = { center: { lat: 29.89, lng: -81.31 }, processingMetersPerPixel: 2, elevationUnitOverride: 'feet', backgroundMask: { version: 1, bounds: {}, lines: [[1, 2]] } };
  assert.deepEqual(sanitizeSessionConfig(fine), fine);
  assert.equal(sanitizeSessionConfig({ processingMetersPerPixel: -3 }).processingMetersPerPixel, undefined);
});

test('the confirm dialog names the risky settings in any mode and counts the rest', () => {
  const rows = describeSessionConfig({ advancedMode: false, measureRoadWidths: true, zoom: 14, overtureBuildings: false, export: { baseTexture: 'game', safeCaps: false, roadSurface: 'hero', seaLevelOffset: 3, treeKindsOff: ['oak'], shapeTerrain: true } });
  const by = Object.fromEntries(rows.map((r) => [r.label, r]));
  assert.equal(by['config.buildEverything'].valueKey, 'config.on');
  assert.equal(by['config.roadSurface'].valueKey, 'exportPanel.ui.roadSurface_hero');
  assert.equal(by['controlPanel.measureRoadWidths'].valueKey, 'config.on');
  assert.equal(by['config.otherSettings'].params.n, 5);      // zoom, overtureBuildings, seaLevelOffset, treeKindsOff, shapeTerrain
  assert.equal(describeSessionConfig({ center: { lat: 1, lng: 2 }, export: { baseTexture: 'osm' } }).some((r) => r.label === 'config.otherSettings'), false);
});

test('send codes: eight characters, old six-character ones still read', () => {
  assert.equal(shareIdFrom('k7f2-9qxm'), 'K7F29QXM');
  assert.equal(shareIdFrom('https://mapng.com/#K7F2-9QXM'), 'K7F29QXM');
  assert.equal(shareIdFrom('K7F-29Q'), 'K7F29Q');
  assert.equal(shareIdFrom('K7F2-9Q'), null);
  assert.equal(isShareHash('#K7F2-9QXM'), true);
  assert.equal(isShareHash('#K7F-29Q'), true);
  assert.equal(isShareHash('#section-one'), false);
});
