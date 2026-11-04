import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The packaged desktop app carries only the files electron-builder.yml
// lists: a module main.js imports but the list leaves out crashes the
// installed app at start (development runs from the folder and never sees it).
test('every desktop module the app imports is packaged', () => {
  const dir = new URL('../desktop/', import.meta.url).pathname;
  const yml = fs.readFileSync(path.join(dir, 'electron-builder.yml'), 'utf8');
  const listed = new Set();
  let inFiles = false;
  for (const line of yml.split('\n')) {
    if (/^files:/.test(line)) { inFiles = true; continue; }
    if (inFiles && /^\S/.test(line) && !line.startsWith('#')) inFiles = false;
    const m = inFiles && line.match(/^\s+-\s+(\S+)/);
    if (m) listed.add(m[1]);
  }
  const seen = new Set(); const queue = ['main.js', 'preload.cjs'];
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    seen.add(f);
    assert.ok(listed.has(f), `${f} is imported but not in electron-builder.yml files`);
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/(?:from|require\()\s*['"]\.\/([^'"]+)['"]/g)) queue.push(m[1]);
  }
});
