import test from 'node:test';
import assert from 'node:assert/strict';
import { countRequest, netRows, netTotal, clearNet, __resetNet } from '../composables/useNetworkMonitor.js';

test('requests are counted by host, beside what the published list says each is for; an unlisted host comes first', () => {
  __resetNet();
  countRequest('https://server.arcgisonline.com/a/1.png', { bytes: 2000, at: 10, ownHost: 'mapng.com' });
  countRequest('https://server.arcgisonline.com/a/2.png', { bytes: 3000, at: 20, ownHost: 'mapng.com' });
  countRequest('https://mapng.com/api/usage', { at: 30, ownHost: 'mapng.com' });
  countRequest('https://example.org/x', { at: 5, ownHost: 'mapng.com' });
  countRequest('blob:https://mapng.com/abc', { ownHost: 'mapng.com' });   // (not a network address)
  const rows = netRows();
  assert.deepEqual(rows.map((r) => r.host), ['example.org', 'mapng.com', 'server.arcgisonline.com']);
  assert.equal(rows[0].listed, false);
  const esri = rows.find((r) => r.host === 'server.arcgisonline.com');
  assert.deepEqual([esri.count, esri.bytes, esri.kind, esri.listed], [2, 5000, 'pictures', true]);
  assert.equal(rows.find((r) => r.host === 'mapng.com').kind, 'mapng');
  assert.equal(netTotal(), 4);
  clearNet(); assert.equal(netTotal(), 0);
});

test('the site\'s own host counts as MapNG\'s server wherever the page is served from', () => {
  __resetNet();
  countRequest('/assets/index.js', { ownHost: 'localhost' });
  const [r] = netRows(); assert.equal(r.kind, 'mapng'); assert.equal(r.listed, true);
});
