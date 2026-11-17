import test from 'node:test';
import assert from 'node:assert/strict';
import { ownMapAvailable, OWN_MAP_ARCHIVE } from '../services/ownBaseMap.js';
import { OSM_TILES_KEY_RE } from '../worker/index.js';

const answer = (status, bytes) => async () => ({ ok: status >= 200 && status < 300, status, arrayBuffer: async () => new Uint8Array(bytes).buffer });
const HEADER = [...'PMTiles'].map((c) => c.charCodeAt(0)).concat([3, 0, 0, 0, 0, 0, 0, 0, 0]);

test('the own map is there only when its archive answers with a PMTiles header', async () => {
  assert.equal(await ownMapAvailable(answer(206, HEADER)), true);
  assert.equal(await ownMapAvailable(answer(404, [])), false);
  assert.equal(await ownMapAvailable(answer(200, [...'<!doctype html>'].map((c) => c.charCodeAt(0)))), false);   // a page served in its place
  assert.equal(await ownMapAvailable(async () => { throw new Error('offline'); }), false);
});

test('the worker serves the basemap archive by the same rule as the map data archives, and nothing else', () => {
  assert.ok(OSM_TILES_KEY_RE.test(OWN_MAP_ARCHIVE));
  assert.ok(OSM_TILES_KEY_RE.test('osm-all/planet-3-4-2-2026-11-12.pmtiles'));
  for (const bad of ['basemap/../crash-reports/x.pmtiles', 'asset-page/data.json', 'basemap/a/b.pmtiles', 'crash-reports/a.pmtiles', 'basemap/x.json']) assert.ok(!OSM_TILES_KEY_RE.test(bad), bad);
});

test('street map styles: the chosen one when known, else light or dark with the app', async () => {
  const { OWN_MAP_STYLES, ownMapStyle } = await import('../services/ownBaseMap.js');
  assert.deepEqual(OWN_MAP_STYLES, ['light', 'dark', 'white', 'grayscale', 'black']);
  assert.equal(ownMapStyle('', false), 'light'); assert.equal(ownMapStyle('', true), 'dark'); assert.equal(ownMapStyle(null, true), 'dark');
  assert.equal(ownMapStyle('grayscale', true), 'grayscale'); assert.equal(ownMapStyle('black', false), 'black');
  assert.equal(ownMapStyle('neon', false), 'light', 'an unknown stored value is ignored');
  const fs = await import('node:fs');
  for (const lang of ['en', 'de', 'es', 'fr', 'it', 'pl', 'ru']) { const t = JSON.parse(fs.readFileSync(new URL(`../locales/${lang}.json`, import.meta.url), 'utf8')).mapSelector.streetStyle; for (const s of OWN_MAP_STYLES) assert.ok(t?.[s], `${lang}: ${s}`); }
});
