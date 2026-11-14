#!/usr/bin/env node
// Mesh Roads measured in the running game: each area is exported with Road surfaces > Mesh Roads, installed,
// loaded through the game's MCP server (the beamng-mcp mod), and every paved road's line is walked with rays at
// an even 0.5 m (scripts/ingame/meshRoadProfile.lua). Counted: the places where the driving surface changes
// slope by more than 8 cm (and 3 cm) in half a metre, by what the ray met, and how much road has no deck.
// The export's own checks cannot see these: they look at MapNG's data, this looks at what the game built.
//
//   node scripts/ingame/meshRoadProfile.mjs <area>[:<terrain>[:raw]] ...   compare with the baselines
//   node scripts/ingame/meshRoadProfile.mjs --all                          every area in the baselines
//   ... --save                                                             record the results as baselines
//
// Needs BeamNG running with the MCP mod, the areas fetched (scripts/sweep/fetchArea.mjs) and NAPI_CANVAS set
// as for exportArea.mjs. The mods folder is asked from the game (BEAMNG_MODS overrides; a Windows path is
// mapped to /mnt/<drive>/ under WSL). The test level is removed again through the game's mod manager.
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { REPO, AREAS_DIR, OUT_DIR } from '../sweep/env.mjs';

const URL_MCP = process.env.BEAMNG_MCP_URL || 'http://127.0.0.1:29292/mcp';
const BASELINE = path.join(REPO, 'tests/fixtures/meshRoadProfileBaselines.json');
const args = process.argv.slice(2); const SAVE = args.includes('--save');
const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : { areas: {} };
const specs = args.includes('--all') ? Object.keys(baseline.areas) : args.filter((a) => !a.startsWith('--'));
if (!specs.length) { console.error('usage: meshRoadProfile.mjs <area>[:<terrain>[:raw]] ... | --all  [--save]'); process.exit(2); }
const OUT = path.join(OUT_DIR, 'meshprofile'); fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let id = 0;
async function lua(code) {
  // (a connection kept from before an export, which blocks this process for a minute, is dead by now: again)
  let res;
  for (let attempt = 0; ; attempt++) {
    try { res = await fetch(URL_MCP, { method: 'POST', headers: { 'Content-Type': 'application/json', Connection: 'close' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: 'run_lua', arguments: { code } } }), signal: AbortSignal.timeout(240000) }); break; }
    catch (e) { if (attempt >= 3) throw e; await sleep(1500); }
  }
  const b = await res.json(); const t = b?.result?.content?.[0]?.text;
  if (b.error || b?.result?.isError) throw new Error(`lua: ${JSON.stringify(b.error || t).slice(0, 300)}`);
  return t;
}
const toLocal = (p) => { const m = /^([A-Za-z]):[\\/](.*)$/.exec(p); return m && process.platform !== 'win32' ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : p; };
const userDir = toLocal(String(await lua('return FS:getUserPath()')).trim()).replace(/[\\/]+$/, '');
const MODS = process.env.BEAMNG_MODS || path.join(userDir, 'mods');
const MEASURE = fs.readFileSync(path.join(REPO, 'scripts/ingame/meshRoadProfile.lua'), 'utf8');
const waitFor = async (name) => { for (let i = 0; i < 50; i++) { await sleep(6000); const s = await lua(`return tostring(getMissionFilename()) .. '|' .. tostring(core_gamestate.loading())`).catch(() => ''); if (s.includes(name) && s.endsWith('|false')) return true; } return false; };

/** The steps of a profile: places (6 m apart) where the surface's slope changes by more than `over` metres in half a metre. */
function steps(prof, over) {
  const rows = [];
  for (const r of prof.roads) {
    const p = r.pts;
    for (let i = 1; i + 1 < p.length; i++) {
      if (Math.min(p[i - 1][2], p[i][2], p[i + 1][2]) < -900) continue;
      const d = Math.abs(p[i + 1][2] - 2 * p[i][2] + p[i - 1][2]);
      if (d > over) rows.push({ d, road: r.name, at: p[i], cls: new Set([p[i - 1][3], p[i][3], p[i + 1][3]]), objs: new Set([p[i - 1][4], p[i][4], p[i + 1][4]]) });
    }
  }
  rows.sort((a, b) => b.d - a.d);
  const places = [];
  for (const r of rows) if (!places.some((q) => Math.hypot(r.at[0] - q.at[0], r.at[1] - q.at[1]) < 6)) places.push(r);
  const kindOf = (r) => (r.cls.has(3) ? 'structure' : r.cls.has(2) ? 'deckTerrain' : r.objs.size > 1 ? 'deckToDeck' : 'oneDeck');
  const kinds = {}; for (const r of places) kinds[kindOf(r)] = (kinds[kindOf(r)] || 0) + 1;
  return { places: places.length, kinds, worst: places.slice(0, 5).map((r) => `${(r.d * 100).toFixed(0)} cm ${r.road.replace(/^dr_/, '').slice(0, 28)} (${r.at[0].toFixed(0)},${r.at[1].toFixed(0)}) ${kindOf(r)}`) };
}

const results = {}; const worse = [];
for (const spec of specs) {
  const [area, terrainArg, mode] = spec.split(':');
  const terrain = terrainArg || (fs.existsSync(path.join(AREAS_DIR, area, 'gpxz.f32')) ? 'gpxz' : 't30');
  const level = `mrp_${area}${mode === 'raw' ? '_raw' : ''}`.toLowerCase(); const zip = path.join(OUT, `${level}.zip`);
  try {
    execFileSync('node', [path.join(REPO, 'scripts/sweep/exportArea.mjs'), area, terrain, level, '--out', OUT], { cwd: REPO, env: { ...process.env, ...(mode === 'raw' ? { RAW: '1' } : {}), EXPORT_OPTS: JSON.stringify({ roadSurface: 'mesh', ...(mode === 'raw' ? { shapeTerrain: false } : {}) }) }, maxBuffer: 1 << 28, timeout: 1200000 });
    execFileSync('node', [path.join(REPO, 'scripts/sweep/fixStubs.mjs'), zip], { cwd: REPO });
    fs.copyFileSync(zip, path.join(MODS, `${level}.part`)); fs.renameSync(path.join(MODS, `${level}.part`), path.join(MODS, `${level}.zip`));
    await lua(`core_modmanager.initDB() freeroam_freeroam.startFreeroam('/levels/${level}/main.level.json') return 'ok'`);
    if (!(await waitFor(level))) throw new Error('level did not load');
    await sleep(8000);
    await lua(MEASURE);
    const prof = JSON.parse(fs.readFileSync(path.join(userDir, 'temp/mapng_profile.json'), 'utf8'));
    const n = [0, 0, 0, 0]; for (const r of prof.roads) for (const q of r.pts) n[q[3]]++;
    const s8 = steps(prof, 0.08); const s3 = steps(prof, 0.03);
    const row = { terrain, mode: mode || 'ready', decks: prof.decks.length, samples: n[0] + n[1] + n[2] + n[3], bareRoad: n[2], steps8: s8.places, steps3: s3.places, kinds: s8.kinds, worst: s8.worst };
    results[spec] = row;
    const base = baseline.areas[spec];
    const flag = base && (row.steps8 > base.steps8 + 1 || row.bareRoad > base.bareRoad * 1.5 + 50) ? 'WORSE' : 'ok   ';
    if (flag === 'WORSE') worse.push(`${spec}: steps over 8 cm ${base.steps8} -> ${row.steps8}, bare road ${base.bareRoad} -> ${row.bareRoad}`);
    console.log(`${flag} ${spec.padEnd(26)} decks ${String(row.decks).padStart(4)} | steps over 8 cm ${String(row.steps8).padStart(3)}${base ? ` (was ${base.steps8})` : ''} ${JSON.stringify(row.kinds)} | over 3 cm ${row.steps3} | road with no deck ${row.bareRoad} of ${row.samples} samples`);
  } catch (e) { console.log(`FAIL  ${spec}: ${String(e.stderr || e.message || e).slice(-300)}`); worse.push(`${spec}: failed`); }
  finally {
    await lua(`freeroam_freeroam.startFreeroam('/levels/gridmap_v2/main.level.json') return 'ok'`).catch(() => {});
    await waitFor('gridmap');
    await lua(`core_modmanager.deleteMod('${level}') return 'ok'`).catch(() => {});
    for (const f of [path.join(MODS, `${level}.zip`), zip]) if (fs.existsSync(f)) fs.rmSync(f);
  }
}
if (SAVE) {
  let commit = ''; try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO }).toString().trim(); } catch { /* none */ }
  const areas = { ...baseline.areas }; for (const [k, v] of Object.entries(results)) areas[k] = { terrain: v.terrain, steps8: v.steps8, steps3: v.steps3, bareRoad: v.bareRoad, kinds: v.kinds };
  fs.writeFileSync(BASELINE, `${JSON.stringify({ _note: 'Mesh Roads in-game baselines (scripts/ingame/meshRoadProfile.mjs --save): places with a step over 8 cm and 3 cm, and road samples with no deck.', recorded: new Date().toISOString().slice(0, 10), commit, areas }, null, 1)}\n`);
  console.log(`baselines saved: ${path.relative(REPO, BASELINE)} (${Object.keys(results).length} area(s))`);
}
if (worse.length) { console.log(`\n${worse.length} worse:`); for (const w of worse) console.log(`  ${w}`); process.exit(1); }
