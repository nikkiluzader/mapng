import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// (updater.js imports electron: the function is read out of the file and run on its own)
const src = fs.readFileSync(new URL('../desktop/updater.js', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('export function plainNotes'), src.indexOf('\n}\n', src.indexOf('export function plainNotes')) + 2).replace('export function', 'function');
const plainNotes = new Function(`${body}; return plainNotes;`)();

test('update dialog notes: tags gone, character references read back, no tag made out of them', () => {
  assert.equal(plainNotes('<p>for testers who turned on Help &gt; Get Test Builds.</p>'), 'for testers who turned on Help > Get Test Builds.');
  assert.equal(plainNotes('Tom &amp; Jerry &#39;quoted&#39; &quot;x&quot; &#x2014; &nbsp;end'), 'Tom & Jerry \'quoted\' "x" —  end');
  assert.equal(plainNotes('&lt;script&gt;alert(1)&lt;/script&gt;'), '<script>alert(1)</script>', 'shown as text in a native dialog: nothing runs it');
  assert.equal(plainNotes('a &unknown; b'), 'a &unknown; b');
  assert.equal(plainNotes('one\n\n\n\n\ntwo'), 'one\n\ntwo');
  assert.equal(plainNotes(null), '');
  assert.ok(plainNotes('x'.repeat(5000)).length === 1200);
});
