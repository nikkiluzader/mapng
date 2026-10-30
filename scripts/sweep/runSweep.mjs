#!/usr/bin/env node
// Sweep test areas: export each (its own process), measure its structure
// checks and lint the level, and compare with the committed baselines
// (tests/fixtures/areaBaselines.json).
//
//   node scripts/sweep/runSweep.mjs --smoke          the smoke set (areas.json smoke: true)
//   node scripts/sweep/runSweep.mjs --all            every area in the catalogue
//   node scripts/sweep/runSweep.mjs <area>...        just these
//   ... --save                                       record the results as the new baselines
//   ... --json out.json                              all rows
//
// A metric regresses when it is worse than its baseline by more than
// max(2, 10 %); lint errors regress on any increase. Exit code 1 on any
// regression or failed export. Exports land in scratch/sweep (MAPNG_SWEEP_OUT).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { lintLevelZip } from '../lib/levelLint.mjs';
import { gameIndex } from '../lib/gameIndex.mjs';
import { OUT_DIR, REPO, areas } from './env.mjs';

const args = process.argv.slice(2);
const BASELINE = path.join(REPO, 'tests/fixtures/areaBaselines.json');
const catalogue = areas();
let list;
if (args.includes('--all')) list = catalogue;
else if (args.includes('--smoke')) list = catalogue.filter((a) => a.smoke);
else {
  const named = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--json');
  list = named.map((n) => catalogue.find((a) => a.name === n) || { name: n, dem: 'gpxz', categories: [] });
}
if (!list.length) { console.error('usage: runSweep.mjs --smoke | --all | <area>... [--save] [--json out.json]'); process.exit(2); }

// metrics kept per area; for every one, lower is better
const METRICS = [
  'steps', 'steepStruct', 'steepGround', 'shortX', 'groundGaps', 'thruDeck', 'spikes',
  'bumps', 'cross', 'junctions', 'creases', 'swFloat', 'swBuried', 'lintErrors', 'lintWarnings',
];
const rowOf = (c) => ({
  steps: c.joints.steps, steepStruct: c.grades.structure.count, steepGround: c.grades.ground.count,
  shortX: c.crossings.short, groundGaps: c.groundGaps?.off ?? 0, thruDeck: c.throughDecks?.through ?? 0, spikes: c.spikes.spikes,
  bumps: c.surface?.kinks.count ?? 0, cross: c.surface?.cross.count ?? 0, junctions: c.surface?.junctions.count ?? 0,
  creases: c.surface?.creases?.count ?? 0, swFloat: c.sidewalks?.floating ?? 0, swBuried: c.sidewalks?.buried ?? 0,
});

const game = gameIndex();
const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : { areas: {} };
const results = {};
const regressions = [];
for (const a of list) {
  const level = `sw_${a.name}`;
  const t0 = Date.now();
  try {
    execFileSync('node', ['--max-old-space-size=12288', path.join(REPO, 'scripts/sweep/exportArea.mjs'), a.name, a.dem || 'gpxz', level],
      { cwd: REPO, stdio: ['ignore', 'ignore', 'pipe'], timeout: 1800_000 });
  } catch (e) {
    console.error(`${a.name}: export failed (${String(e.stderr || e.message).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)})`);
    regressions.push(`${a.name}: export failed`);
    continue;
  }
  const zipPath = path.join(OUT_DIR, `${level}.zip`);
  const checks = JSON.parse(fs.readFileSync(zipPath.replace(/\.zip$/, '.checks.json'), 'utf8'));
  const bytes = fs.readFileSync(zipPath);
  const lint = await lintLevelZip(bytes, { gameHas: game?.has || null, gameMaterials: game?.mats || null, gameDangling: game?.dangling || null });
  const row = { ...rowOf(checks), lintErrors: lint.findings.filter((f) => f.level === 'error').length, lintWarnings: lint.findings.filter((f) => f.level === 'warn').length };
  // structure summary from the report (decks, how high, deck length, tunnels)
  try {
    const rep = await (await JSZip.loadAsync(bytes)).file(`levels/${level}/export_report.txt`).async('string');
    const decks = [...rep.matchAll(/Deck over ground: max (-?[\d.]+) m/g)].map((m) => +m[1]);
    row.decks = decks.length; row.maxDeckH = decks.length ? Math.max(...decks) : 0;
    row.deckKm = +(rep.match(/classes: deck \d+ \(([\d.]+) km\)/)?.[1] ?? 0);
    row.tunnels = +(rep.match(/^- Tunnels built: (\d+)/m)?.[1] ?? 0);
  } catch { /* report missing */ }
  row.seconds = Math.round((Date.now() - t0) / 1000);
  results[a.name] = row;
  const b = baseline.areas[a.name];
  const worse = [];
  if (b) {
    for (const m of METRICS) {
      if (!Number.isFinite(b[m]) || !Number.isFinite(row[m])) continue;
      const allowed = m === 'lintErrors' ? 0 : Math.max(2, b[m] * 0.1);
      if (row[m] - b[m] > allowed) worse.push(`${m} ${b[m]} -> ${row[m]}`);
    }
    // a structure suddenly much taller is how a runaway lift shows
    if (Number.isFinite(b.maxDeckH) && row.maxDeckH > b.maxDeckH * 1.5 + 5) worse.push(`maxDeckH ${b.maxDeckH} -> ${row.maxDeckH}`);
    if (Number.isFinite(b.deckKm) && row.deckKm > b.deckKm * 1.5 + 0.5) worse.push(`deckKm ${b.deckKm} -> ${row.deckKm}`);
  }
  for (const w of worse) regressions.push(`${a.name}: ${w}`);
  const errs = lint.findings.filter((f) => f.level === 'error');
  console.log(`${worse.length || errs.length ? 'FAIL' : 'ok  '} ${a.name.padEnd(16)} ${row.seconds}s  steps ${row.steps}  steep ${row.steepStruct}/${row.steepGround}  shortX ${row.shortX}  thruDeck ${row.thruDeck}  spikes ${row.spikes}  sidewalks ${row.swFloat}/${row.swBuried}  decks ${row.decks} (${row.maxDeckH} m, ${row.deckKm} km)  lint ${row.lintErrors}/${row.lintWarnings}${b ? '' : '  (no baseline)'}`);
  for (const w of worse) console.log(`       worse: ${w}`);
  for (const e of errs.slice(0, 3)) console.log(`       lint: ${e.check}: ${e.msg}`);
}

if (args.includes('--json')) fs.writeFileSync(args[args.indexOf('--json') + 1], JSON.stringify(results, null, 1));
if (args.includes('--save')) {
  let commit = '';
  try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO }).toString().trim(); } catch { /* none */ }
  const next = { _note: 'Area baselines for scripts/sweep/runSweep.mjs: re-record with --save after a change that improves an area (commit the file with it).', recorded: new Date().toISOString().slice(0, 10), commit, areas: { ...baseline.areas, ...results } };
  fs.writeFileSync(BASELINE, `${JSON.stringify(next, null, 1)}\n`);
  console.log(`baselines saved: ${path.relative(REPO, BASELINE)} (${Object.keys(results).length} area(s))`);
}
if (regressions.length) {
  console.log(`\n${regressions.length} regression(s):`);
  for (const r of regressions) console.log(`  ${r}`);
  process.exit(1);
}
