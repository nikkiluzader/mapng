// Desktop test builds: version numbering, the menu's switch in every language, and what the updater is told.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextDevVersion } from '../scripts/release/devRelease.mjs';
import { menuText, MENU_LANGUAGES } from '../desktop/menuText.js';

test('the next test build: from a release, from a test build', () => {
  assert.equal(nextDevVersion('0.3.0'), '0.3.1-dev.1');
  assert.equal(nextDevVersion('0.3.1-dev.1'), '0.3.1-dev.2');
  assert.equal(nextDevVersion('0.3.1-dev.9'), '0.3.1-dev.10');
  assert.throws(() => nextDevVersion('0.3'));
});

test('the menu has the test builds switch in every language', () => {
  for (const lang of MENU_LANGUAGES) assert.ok(menuText(lang).testBuilds?.length > 5, lang);
});

test('test builds are opt-in, and the workflow publishes only suffixed tags as pre-releases', () => {
  const updater = fs.readFileSync(new URL('../desktop/updater.js', import.meta.url), 'utf8');
  assert.match(updater, /testBuilds = \(\) => settings\.read\(\)\.testBuilds === true/);
  assert.match(updater, /autoUpdater\.allowPrerelease = tests;/);
  assert.ok(!/allowPrerelease = true/.test(updater), 'never on outright');
  const wf = fs.readFileSync(new URL('../.github/workflows/desktop-release.yml', import.meta.url), 'utf8');
  assert.match(wf, /contains\(github\.ref_name, '-'\)/);
  assert.match(wf, /--prerelease --latest=false/);
});
