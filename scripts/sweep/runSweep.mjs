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
//   ... --matrix                                     each area on every terrain quality it has data for
//                                                    (1 m lidar, global 30 m) x every Terrain choice
//                                                    (ready, noshape, untouched): MATRIX below. Its own
//                                                    baselines (tests/fixtures/areaMatrixBaselines.json),
//                                                    one per cell, and a table per area at the end.
//   ... --jobs N                                     N exports at a time (default 1; the matrix: 3)
//
// Roads, bridges, tunnels and paths have to hold on every setting and on
// both fine and coarse terrain: a fix checked on one cell only is not
// checked (2026-11: roads zigzagged on flat lidar only; skyways only with
// shaping on). Run --matrix on the smoke set for any change to them.
//
// A metric regresses when it is worse than its baseline by more than
// max(2, 10 %); lint errors regress on any increase. Exit code 1 on any
// regression or failed export. Exports land in scratch/sweep (MAPNG_SWEEP_OUT).
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { lintLevelZip } from '../lib/levelLint.mjs';
import { gameIndex } from '../lib/gameIndex.mjs';
import { AREAS_DIR, OUT_DIR, REPO, areas } from './env.mjs';

const args = process.argv.slice(2);
const MATRIX_MODE = args.includes('--matrix');
const BASELINE = path.join(REPO, MATRIX_MODE ? 'tests/fixtures/areaMatrixBaselines.json' : 'tests/fixtures/areaBaselines.json');
// The Terrain choices of the app, as exportArea.mjs takes them:
//   ready      Ready to drive: roads conditioned into the terrain, every export edit on
//   noshape    Custom with the export's edits off (roads, bridges, overpasses, tunnels, extras):
//              structures are built on the terrain as it is
//   untouched  the elevation as downloaded (no road snap or smoothing) and no export edits
const MATRIX = {
  ready: {},
  noshape: { EXPORT_OPTS: JSON.stringify({ shapeRoads: false, shapeBridges: false, shapeOverpasses: false, shapeTunnels: false, shapeExtras: false }) },
  untouched: { RAW: '1', EXPORT_OPTS: JSON.stringify({ shapeTerrain: false }) },
};
const DEMS = ['gpxz', 't30'];
const jobsArg = args.includes('--jobs') ? Math.max(1, Number(args[args.indexOf('--jobs') + 1]) || 1) : (MATRIX_MODE ? 3 : 1);
const catalogue = areas();
let list;
if (args.includes('--all')) list = catalogue;
else if (args.includes('--smoke')) list = catalogue.filter((a) => a.smoke);
else {
  const named = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--json' && args[i - 1] !== '--jobs');
  list = named.map((n) => catalogue.find((a) => a.name === n) || { name: n, dem: 'gpxz', categories: [] });
}
if (!list.length) { console.error('usage: runSweep.mjs --smoke | --all | <area>... [--save] [--json out.json]'); process.exit(2); }

// metrics kept per area; for every one, lower is better
const METRICS = [
  'steps', 'steepStruct', 'steepGround', 'shortX', 'groundGaps', 'thruDeck', 'spikes',
  'bumps', 'cross', 'junctions', 'creases', 'swFloat', 'swBuried', 'lintErrors', 'lintWarnings',
  'snapMovedPct', 'snapP90cm',
];
const rowOf = (c) => ({
  steps: c.joints.steps, steepStruct: c.grades.structure.count, steepGround: c.grades.ground.count,
  shortX: c.crossings.short, groundGaps: c.groundGaps?.off ?? 0, thruDeck: c.throughDecks?.through ?? 0, spikes: c.spikes.spikes,
  bumps: c.surface?.kinks.count ?? 0, cross: c.surface?.cross.count ?? 0, junctions: c.surface?.junctions.count ?? 0,
  creases: c.surface?.creases?.count ?? 0, swFloat: c.sidewalks?.floating ?? 0, swBuried: c.sidewalks?.buried ?? 0,
  // the lidar road snap (fine terrain, conditioned): share of road length moved, and how far (p90)
  ...(c.roadSnap ? { snapMovedPct: Math.round(c.roadSnap.movedShare * 100), snapP90cm: Math.round(c.roadSnap.p90OffsetM * 100) } : {}),
});

const game = gameIndex();
const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : { areas: {} };
const results = {};
const regressions = [];
// one export per cell: an area in its catalogue terrain, or (--matrix) on every terrain x setting
const cells = [];
for (const a of list) {
  if (!MATRIX_MODE) { cells.push({ a, key: a.name, dem: a.dem || 'gpxz', level: `sw_${a.name}`, env: {} }); continue; }
  for (const dem of DEMS) {
    if (!fs.existsSync(path.join(AREAS_DIR, a.name, `${dem}.f32`))) continue;
    for (const [setting, env] of Object.entries(MATRIX)) cells.push({ a, key: `${a.name}@${dem}/${setting}`, dem, setting, level: `mx_${a.name}_${dem}_${setting}`, env });
  }
}
const run = (file, argv, opts) => new Promise((resolve, reject) => execFile(file, argv, opts, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(stdout))));
async function runCell({ a, key: cellKey, dem, level, env }) {
  const t0 = Date.now();
  try {
    await run('node', ['--max-old-space-size=12288', path.join(REPO, 'scripts/sweep/exportArea.mjs'), a.name, dem, level],
      { cwd: REPO, timeout: 1800_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } });
  } catch (e) {
    console.error(`${cellKey}: export failed (${String(e.stderr || e.message).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)})`);
    regressions.push(`${cellKey}: export failed`);
    return;
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
    row.deckKm = +(rep.match(/- deck: \d+ stretch\(es\), ([\d.]+) km/)?.[1] ?? rep.match(/classes: deck \d+ \(([\d.]+) km\)/)?.[1] ?? 0);
    // (the longest single deck: a runaway lift is one long "bridge")
    const lens = [...rep.matchAll(/^  - b\d+: \d+ part\(s\), (\d+) m,/gm)].map((m) => +m[1]);
    row.maxDeckLen = lens.length ? Math.max(...lens) : 0;
    row.tunnels = +(rep.match(/^- Tunnels built: (\d+)/m)?.[1] ?? 0);
    row.tunnelsLeft = +(rep.match(/tunnel=yes roads left on the ground: (\d+)/)?.[1] ?? 0);
  } catch { /* report missing */ }
  row.seconds = Math.round((Date.now() - t0) / 1000);
  results[cellKey] = row;
  const b = baseline.areas[cellKey];
  const worse = [];
  if (b) {
    for (const m of METRICS) {
      if (!Number.isFinite(b[m]) || !Number.isFinite(row[m])) continue;
      const allowed = m === 'lintErrors' ? 0 : Math.max(2, b[m] * 0.1);
      if (row[m] - b[m] > allowed) worse.push(`${m} ${b[m]} -> ${row[m]}`);
    }
    // a structure suddenly much taller or longer is how a runaway lift shows
    if (Number.isFinite(b.maxDeckH) && row.maxDeckH > b.maxDeckH * 1.5 + 5) worse.push(`maxDeckH ${b.maxDeckH} -> ${row.maxDeckH}`);
    if (Number.isFinite(b.deckKm) && row.deckKm > b.deckKm * 1.5 + 0.5) worse.push(`deckKm ${b.deckKm} -> ${row.deckKm}`);
    if (Number.isFinite(b.maxDeckLen) && row.maxDeckLen > b.maxDeckLen * 1.5 + 50) worse.push(`maxDeckLen ${b.maxDeckLen} -> ${row.maxDeckLen}`);
  }
  for (const w of worse) regressions.push(`${cellKey}: ${w}`);
  const errs = lint.findings.filter((f) => f.level === 'error');
  console.log(`${worse.length || errs.length ? 'FAIL' : 'ok  '} ${cellKey.padEnd(MATRIX_MODE ? 32 : 16)} ${String(row.seconds).padStart(3)}s  steps ${row.steps}  steep ${row.steepStruct}/${row.steepGround}  shortX ${row.shortX}  thruDeck ${row.thruDeck}  spikes ${row.spikes}  sw ${row.swFloat}/${row.swBuried}  decks ${row.decks} (max ${row.maxDeckH} m up, ${row.maxDeckLen} m long)  tunnels ${row.tunnels}+${row.tunnelsLeft} left${Number.isFinite(row.snapMovedPct) ? `  snap ${row.snapMovedPct}% p90 ${row.snapP90cm} cm` : ''}  lint ${row.lintErrors}/${row.lintWarnings}${b ? '' : '  (no baseline)'}`);
  for (const w of worse) console.log(`       worse: ${w}`);
  for (const e of errs.slice(0, 3)) console.log(`       lint: ${e.check}: ${e.msg}`);
}
{
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(jobsArg, cells.length) }, async () => { while (next < cells.length) await runCell(cells[next++]); }));
}

// --matrix: one table per area, terrain x setting, the numbers that show a structure gone wrong
if (MATRIX_MODE) {
  const cols = ['thruDeck', 'spikes', 'shortX', 'steepStruct', 'swFloat', 'swBuried', 'maxDeckH', 'maxDeckLen', 'tunnels', 'tunnelsLeft', 'snapMovedPct'];
  for (const a of list) {
    const rows = cells.filter((c) => c.a === a && results[c.key]);
    if (!rows.length) continue;
    console.log(`\n${a.name}\n  ${'terrain / setting'.padEnd(18)}${cols.map((c) => c.padStart(13)).join('')}`);
    for (const c of rows) console.log(`  ${`${c.dem === 'gpxz' ? '1 m lidar' : '30 m'} / ${c.setting}`.padEnd(18)}${cols.map((k) => String(results[c.key][k] ?? '-').padStart(13)).join('')}`);
  }
  console.log('');
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
