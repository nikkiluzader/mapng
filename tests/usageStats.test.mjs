import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { USAGE_FIELDS, usageFromConfig, validUsage } from '../services/usageStats.js';
import { buildSessionConfig } from '../services/sessionConfig.js';
import { ExportHotspots } from '../hotspotsObject.js';

const storage = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const run = { center: { lat: 30.1, lng: -81.4 }, resolution: 4096, includeOSM: true, elevationSource: 'default', processingMetersPerPixel: 1, rawTerrain: true };

test('a settings report holds only listed settings and values, never the location', () => {
  const config = buildSessionConfig(run, storage({ mapng_beamNGBaseTexture: 'game', mapng_beamNGIncludeTrees: 'false', mapng_beamNGSeaLevelOffset: '3' }));
  const u = usageFromConfig(config, 'desktop');
  assert.equal(u.platform, 'desktop');
  assert.equal(u.baseTexture, 'game');
  assert.equal(u.trees, 'off');
  assert.equal(u.seaLevelOffset, 'changed');
  assert.equal(u.rawTerrain, 'off');               // raw terrain only counts in Advanced mode
  assert.equal(u.resolution, '4096');
  assert.ok(!JSON.stringify(u).includes('30.1'));
  for (const [k, v] of Object.entries(u)) assert.ok(USAGE_FIELDS[k].includes(v), `${k}=${v}`);
});

test('free-form or unknown values are dropped', () => {
  assert.deepEqual(validUsage({ platform: 'web', baseTexture: 'my house', lat: '30', resolution: '4096' }), { platform: 'web', resolution: '4096' });
});

test("the data page's example is exactly the settings the app sends", () => {
  const html = readFileSync(new URL('../public/data.html', import.meta.url), 'utf8');
  const example = JSON.parse(/POST \/api\/usage\nContent-Type: application\/json\n\n([\s\S]*?)<\/code>/.exec(html)[1]).settings;
  const sent = usageFromConfig(buildSessionConfig({ ...run, rawTerrain: false }, storage({ mapng_beamNGBaseTexture: 'game' })), 'desktop');
  assert.deepEqual(Object.keys(example).sort(), Object.keys(sent).sort());
  assert.deepEqual(validUsage(example), example);
});

test('the Durable Object keeps only running totals', async () => {
  const db = new DatabaseSync(':memory:');
  const sql = { exec: (q, ...args) => { const st = db.prepare(q); const rows = /^\s*(SELECT)/i.test(q) ? st.all(...args) : (st.run(...args), []); return { toArray: () => rows }; } };
  const obj = new ExportHotspots({ storage: { sql } });
  assert.equal(await obj.reportUsage({ platform: 'web', baseTexture: 'game', trees: 'off' }, 'a'), 'ok');
  assert.equal(await obj.reportUsage({ platform: 'desktop', baseTexture: 'game', trees: 'on', lat: '30' }, 'b'), 'ok');
  assert.equal(await obj.reportUsage({ platform: 'web' }, 'c'), 'invalid');
  const u = await obj.usage();
  assert.equal(u.exports, 2);
  assert.deepEqual(u.rows.find((r) => r[0] === 'baseTexture'), ['baseTexture', 'game', 2]);
  assert.ok(!u.rows.some((r) => r[0] === 'lat'));
  for (let i = 0; i < 30; i++) await obj.reportUsage({ platform: 'web', baseTexture: 'osm', trees: 'on' }, 'spam');
  assert.equal(await obj.reportUsage({ platform: 'web', baseTexture: 'osm', trees: 'on' }, 'spam'), 'limited');
});
