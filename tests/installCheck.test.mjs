// desktop/installCheck.js: the portable app started from inside its zip
import test from 'node:test';
import assert from 'node:assert/strict';
import { missingParts, inArchiveTemp, incompleteMessage } from '../desktop/installCheck.js';

test('missing files are named; a whole app has none', () => {
  const files = [{ path: '/a/runner', what: 'resources/runner' }, { path: '/a/node', what: 'resources/node' }];
  assert.deepEqual(missingParts(files, () => true), []);
  assert.deepEqual(missingParts(files, (p) => p !== '/a/runner'), ['resources/runner']);
  assert.deepEqual(missingParts(files, () => { throw new Error('no access'); }), ['resources/runner', 'resources/node']);
});

test('an archive viewer\'s temporary folder is recognised', () => {
  // (the path in problem report MR-QWWD99, the user's name left out)
  assert.equal(inArchiveTemp('C:\\Users\\someone\\AppData\\Local\\Temp\\Rar$EXa8132.4440.rartemp\\MapNG.exe'), true);
  assert.equal(inArchiveTemp('C:\\Users\\someone\\AppData\\Local\\Temp\\7zO4A1B2C3D\\MapNG.exe'), true);
  assert.equal(inArchiveTemp('C:\\Users\\someone\\AppData\\Local\\Temp\\Temp1_MapNG-0.3.0-windows-portable.zip\\MapNG.exe'), true);
  assert.equal(inArchiveTemp('C:\\Games\\MapNG\\MapNG.exe'), false);
  assert.equal(inArchiveTemp('/home/someone/Apps/MapNG.AppImage'), false);
});

test('the message says to extract the zip, and names what is missing', () => {
  const m = incompleteMessage(['resources/runner'], 'C:\\Temp\\Rar$EXa1.2.rartemp\\MapNG.exe');
  assert.match(m.message, /inside the zip/);
  assert.match(m.detail, /Extract the whole zip/);
  assert.match(m.detail, /resources\/runner/);
  assert.match(incompleteMessage(['resources/node'], 'C:\\Games\\MapNG\\MapNG.exe').message, /files are missing/);
});

test('the app\'s own menu is worded in every language the window has', async () => {
  const { menuText, MENU_LANGUAGES } = await import('../desktop/menuText.js');
  const fs = await import('node:fs');
  const locales = fs.readdirSync(new URL('../locales/', import.meta.url)).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', '')).sort();
  assert.deepEqual([...MENU_LANGUAGES].sort(), locales);
  const keys = Object.keys(menuText('en')).sort();
  for (const lang of MENU_LANGUAGES) { const m = menuText(lang); assert.deepEqual(Object.keys(m).sort(), keys, lang); for (const k of keys) assert.ok(m[k] && typeof m[k] === 'string', `${lang}.${k}`); }
  assert.equal(menuText('pl-PL').help, 'Pomoc'); assert.equal(menuText('ja').help, 'Help'); assert.equal(menuText(undefined).file, 'File');
});

test('the update dialogs are worded in every language, with the same placeholders', async () => {
  const { updaterText, fill, MENU_LANGUAGES } = await import('../desktop/menuText.js');
  const en = updaterText('en'); const keys = Object.keys(en).sort();
  const holes = (t) => (t.match(/\{\w+\}/g) || []).sort().join(',');
  for (const lang of MENU_LANGUAGES) { const u = updaterText(lang); assert.deepEqual(Object.keys(u).sort(), keys, lang); for (const k of keys) { assert.ok(u[k], `${lang}.${k}`); assert.equal(holes(u[k]), holes(en[k]), `${lang}.${k} placeholders`); } }
  assert.equal(fill(en.available, { new: '0.3.1', have: '0.3.0' }), 'MapNG 0.3.1 is available (you have 0.3.0).');
  assert.equal(updaterText('xx').later, 'Later');
});
