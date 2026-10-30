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
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lintLevelZip } from './lib/levelLint.mjs';

const args = process.argv.slice(2);
const zips = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--json');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
if (!zips.length) { console.error('usage: lintLevel.mjs <level.zip>... [--json out.json] [--no-game]'); process.exit(2); }

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
function gameIndex() {
  if (args.includes('--no-game')) return null;
  const content = path.join(repo, 'refs/beamng/content');
  if (!fs.existsSync(content)) return null;
  const cache = path.join(os.homedir(), '.cache/mapng/game-files.txt');
  const stamp = fs.statSync(content).mtimeMs;
  let list = null;
  try {
    const [head, ...rest] = fs.readFileSync(cache, 'utf8').split('\n');
    if (Number(head) === stamp) list = rest;
  } catch { /* rebuild */ }
  if (!list) {
    process.stderr.write('indexing the game\'s content zips (once per game update)...\n');
    // files in the content zips and loose under content/ (assets/), and the
    // material names every stock *.materials.json defines ('M ' lines)
    const py = `import zipfile,glob,os,sys,json
root=sys.argv[1]
import re
TEX=re.compile(rb'"(/(?:assets|levels|art)/[^"]+\\.(?:png|dds|jpg|jpeg))"', re.I)
def mats(data):
  try:
    for t in set(TEX.findall(data)): print('T '+t.decode('utf-8','replace').lower())
    d=json.loads(data)
    for k,v in d.items():
      print('M '+k)
      if isinstance(v,dict):
        for f in ('name','mapTo','internalName'):
          if isinstance(v.get(f),str): print('M '+v[f])
  except Exception: pass
for z in glob.glob(os.path.join(root,'**','*.zip'),recursive=True):
  try:
    zf=zipfile.ZipFile(z)
    for n in zf.namelist():
      if n.endswith('/'): continue
      print(n.lower())
      if n.endswith('materials.json'): mats(zf.read(n))
  except Exception: pass
for d,_,fs in os.walk(root):
  for f in fs:
    if f.endswith('.zip'): continue
    p=os.path.relpath(os.path.join(d,f),root).replace(os.sep,'/')
    print(p.lower())
    if f.endswith('materials.json'):
      try: mats(open(os.path.join(d,f),'rb').read())
      except Exception: pass`;
    list = execFileSync('python3', ['-c', py, content], { maxBuffer: 1 << 30 }).toString().split('\n');
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.writeFileSync(cache, `${stamp}\n${list.join('\n')}`);
  }
  const set = new Set(); const mats = new Set(); const refs = new Set();
  for (const l of list) {
    if (!l) continue;
    if (l.startsWith('M ')) mats.add(l.slice(2));
    else if (l.startsWith('T ')) refs.add(l.slice(2).replace(/^\//, ''));
    else set.add(l);
  }
  const has = (rel) => {
    const r = rel.toLowerCase();
    const alts = [r, r.replace(/\.(png|dds|jpg)$/, '.dds'), r.replace(/\.(png|dds|jpg)$/, '.png'), r.replace(/\.(png|dds|jpg)$/, '.jpg'), `${r}.link`];
    return alts.some((a) => set.has(a));
  };
  return { has, mats, stockRefs: refs };
}

const game = gameIndex();
const gameHas = game?.has || null;
const results = [];
let anyError = false;
for (const z of zips) {
  const r = await lintLevelZip(fs.readFileSync(z), { gameHas, gameMaterials: game?.mats || null, gameDangling: game ? (rel) => game.stockRefs.has(rel.toLowerCase()) : null });
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
