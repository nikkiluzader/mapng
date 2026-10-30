#!/usr/bin/env node
// Scores from street-compare reviews (streetCompare.mjs writes review.json
// per level; each pair scored 0 wrong .. 2 matches per rubric item, null not
// visible). Prints the mean per rubric item, overall and per spot category,
// and the pairs scored 0 with their notes.
//
//   node scripts/ingame/reviewSummary.mjs <review.json | dir>...
import fs from 'node:fs';
import path from 'node:path';

const files = [];
const walk = (p) => {
  if (!fs.existsSync(p)) return;
  if (fs.statSync(p).isDirectory()) { for (const f of fs.readdirSync(p)) walk(path.join(p, f)); return; }
  if (path.basename(p) === 'review.json' || p.endsWith('.review.json')) files.push(p);
};
for (const a of process.argv.slice(2)) walk(a);
if (!files.length) { console.error('usage: reviewSummary.mjs <review.json | dir>...'); process.exit(2); }

const reviews = files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
const rubric = reviews[0].rubric;
const acc = new Map();   // group -> item -> [sum, n]
const add = (group, item, v) => {
  if (!acc.has(group)) acc.set(group, new Map());
  const g = acc.get(group);
  if (!g.has(item)) g.set(item, [0, 0]);
  const a = g.get(item); a[0] += v; a[1]++;
};
const zeros = [];
let pairs = 0; let scored = 0;
for (const r of reviews) {
  for (const p of r.pairs) {
    pairs++;
    const vals = rubric.map((k) => p.scores?.[k]).filter((v) => Number.isFinite(v));
    if (vals.length) scored++;
    for (const k of rubric) {
      const v = p.scores?.[k];
      if (!Number.isFinite(v)) continue;
      add('all', k, v); add(p.category || 'other', k, v);
      if (v === 0) zeros.push(`${r.level} #${p.n} [${p.category}] ${k}: ${p.notes || ''}`);
    }
  }
}
const fmt = (a) => (a ? (a[0] / a[1]).toFixed(2) : '  - ');
console.log(`${reviews.length} review(s), ${pairs} pairs, ${scored} scored\n`);
console.log(['group'.padEnd(12), ...rubric.map((k) => k.slice(0, 9).padStart(10))].join(''));
for (const [group, g] of [...acc].sort((a, b) => (a[0] === 'all' ? -1 : b[0] === 'all' ? 1 : a[0].localeCompare(b[0])))) {
  console.log([group.padEnd(12), ...rubric.map((k) => fmt(g.get(k)).padStart(10))].join(''));
}
if (zeros.length) { console.log(`\nscored 0 (${zeros.length}):`); for (const z of zeros.slice(0, 60)) console.log(`  ${z}`); }
