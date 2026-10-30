#!/usr/bin/env node
// Lint exported BeamNG level zips against BeamNG's documented formats
// (scripts/lib/levelLint.mjs).
//
//   node scripts/lintLevel.mjs <level.zip>... [--json out.json] [--no-game]
//
// Stock paths (/assets/..., /levels/west_coast_usa/...) are checked against
// the game's content zips under refs/beamng/content when present (their file
// list is cached in ~/.cache/mapng/game-files.txt, rebuilt when the game
// updates). Exit code 1 when any level has an error.
import fs from 'node:fs';
import path from 'node:path';
import { lintLevelZip } from './lib/levelLint.mjs';
import { gameIndex } from './lib/gameIndex.mjs';

const args = process.argv.slice(2);
const zips = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--json');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
if (!zips.length) { console.error('usage: lintLevel.mjs <level.zip>... [--json out.json] [--no-game]'); process.exit(2); }

const gameIndexOrNull = () => (args.includes('--no-game') ? null : gameIndex());
const game = gameIndexOrNull();
const gameHas = game?.has || null;
const results = [];
let anyError = false;
for (const z of zips) {
  const r = await lintLevelZip(fs.readFileSync(z), { gameHas, gameMaterials: game?.mats || null, gameDangling: game?.dangling || null });
  results.push({ zip: z, ...r });
  const errors = r.findings.filter((f) => f.level === 'error');
  const warns = r.findings.filter((f) => f.level === 'warn');
  anyError ||= errors.length > 0;
  console.log(`${errors.length ? 'FAIL' : 'ok  '} ${path.basename(z)}: ${errors.length} error(s), ${warns.length} warning(s) · ${r.counts.objects ?? 0} objects, ${r.counts.decalRoads ?? 0} roads, ${r.counts.statics ?? 0} statics, ${r.counts.textures ?? 0} texture refs${gameHas ? '' : ' (stock paths not checked)'}`);
  const byCheck = new Map();
  for (const f of r.findings) {
    const k = `${f.level} ${f.check}`;
    if (!byCheck.has(k)) byCheck.set(k, []);
    byCheck.get(k).push(f);
  }
  for (const [k, list] of [...byCheck].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    console.log(`  ${k} x${list.length}: ${list.slice(0, 3).map((f) => f.msg).join(' | ')}`);
  }
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results, null, 1));
process.exit(anyError ? 1 : 0);
