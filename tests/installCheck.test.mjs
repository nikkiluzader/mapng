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
