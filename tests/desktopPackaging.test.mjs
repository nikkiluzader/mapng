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

// The runner bundles each worker the page or the export starts with
// `new URL('./x.js', import.meta.url)` beside it (scripts/stage.mjs); one
// missing there makes the installed app fall back (the resampler: a 16k map
// resampled on one thread, tens of minutes) or fail.
test('every worker module the services start is staged beside the runner', () => {
  const root = new URL('../', import.meta.url).pathname;
  const stage = fs.readFileSync(path.join(root, 'desktop/scripts/stage.mjs'), 'utf8');
  const staged = new Set([...stage.match(/WORKER_MODULES = \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
  const started = new Set();
  for (const f of fs.readdirSync(path.join(root, 'services')).filter((n) => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(root, 'services', f), 'utf8');
    for (const m of src.matchAll(/new URL\(\s*['"]\.\/([\w-]+\.js)['"]\s*,\s*import\.meta\.url\s*\)/g)) started.add(m[1]);
  }
  // (LAZ uploads are read in the page, never in the desktop runner; x.js is
  // parallel.js's usage example in a comment)
  const browserOnly = new Set(['lazWorker.js', 'x.js']);
  for (const w of started) if (!browserOnly.has(w)) assert.ok(staged.has(w), `${w} is started as a worker but not staged (desktop/scripts/stage.mjs WORKER_MODULES)`);
});
