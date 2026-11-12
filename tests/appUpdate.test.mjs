// services/appUpdate.js: telling a page that is older than the site
import test from 'node:test';
import assert from 'node:assert/strict';
import { entryScriptOf, isOlder } from '../services/appUpdate.js';

test('the entry script of a page is read from its HTML', () => {
  assert.equal(entryScriptOf('<head><script type="module" crossorigin src="/assets/index-B0PHend6.js"></script></head>'), '/assets/index-B0PHend6.js');
  assert.equal(entryScriptOf('<script src="/assets/index-AAA.js" type="module"></script>'), '/assets/index-AAA.js');
  assert.equal(entryScriptOf('<script type="module" src="/main.js"></script>'), '/main.js');
  assert.equal(entryScriptOf('<script type="application/ld+json">{}</script><script type="module" src="https://mapng.com/assets/index-Z.js"></script>'), '/assets/index-Z.js');
  assert.equal(entryScriptOf('<html></html>'), '');
  assert.equal(entryScriptOf(null), '');
});

test('a page is older only when both scripts are known and differ', () => {
  assert.equal(isOlder('/assets/index-A.js', '/assets/index-B.js'), true);
  assert.equal(isOlder('/assets/index-A.js', '/assets/index-A.js'), false);
  // the development server serves /main.js before and after: never "updated"
  assert.equal(isOlder('/main.js', '/main.js'), false);
  // an answer that could not be read (offline, an error page) is not an update
  assert.equal(isOlder('/assets/index-A.js', ''), false);
  assert.equal(isOlder('', '/assets/index-B.js'), false);
});
