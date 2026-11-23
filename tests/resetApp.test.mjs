// resetApp.js: what a reset clears and keeps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resetApp, settingsToClear, askLocation } from '../services/resetApp.js';

const store = (init) => { const m = new Map(Object.entries(init)); return { get length() { return m.size; }, key: (i) => [...m.keys()][i], getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };

test('a reset clears the settings, the place, the tiles and the road, and keeps keys, language, theme and privacy choices', async () => {
  const init = { mapng_center: '{}', mapng_tiles: '[]', mapng_road: '{}', mapng_area_mode: 'road', mapng_resolution: '4096', mapng_beamNGIncludeTrees: '0', mapng_background_mask: 'x',
    mapng_gpxzApiKey: 'k', mapng_customOverpassUrl: 'u', mapng_locale: 'de', theme: 'dark', mapng_share_exports: 'off', other_site_key: '1' };
  const s = store(init); let reloaded = 0;
  const res = await resetApp({ storage: s, locate: async () => null, reload: () => { reloaded++; } });
  assert.equal(reloaded, 1);
  assert.deepEqual([...s.m.keys()].sort(), ['mapng_customOverpassUrl', 'mapng_gpxzApiKey', 'mapng_locale', 'mapng_share_exports', 'other_site_key', 'theme']);
  assert.equal(res.cleared.length, 7); assert.equal(res.here, null);
  // with the location given: the app starts there
  const s2 = store(init); let order = '';
  await resetApp({ storage: s2, locate: async () => { order += s2.getItem('mapng_road') === null ? 'cleared-before-asking ' : 'NOT-cleared '; s2.setItem('mapng_zoom', '9'); return { lat: 59.9, lng: 10.7 }; }, reload: () => { order += 'reload'; } });
  assert.equal(order, 'cleared-before-asking reload');
  assert.deepEqual(JSON.parse(s2.getItem('mapng_center')), { lat: 59.9, lng: 10.7 });
  assert.equal(s2.getItem('mapng_zoom'), null);              // written while the question was open: cleared too
});

test('only the app’s own keys are ever cleared', () => {
  assert.deepEqual(settingsToClear(['mapng_zoom', 'theme', 'x', null, 'mapng_locale']), ['mapng_zoom']);
});

test('the location: given, refused or unsupported', async () => {
  assert.deepEqual(await askLocation({ getCurrentPosition: (ok) => ok({ coords: { latitude: 59.9, longitude: 10.7 } }) }), { lat: 59.9, lng: 10.7 });
  assert.equal(await askLocation({ getCurrentPosition: (_ok, no) => no(new Error('denied')) }), null);
  assert.equal(await askLocation(null), null);
});
