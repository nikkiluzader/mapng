// The game's stock files and material names, for the level linter: indexed
// once per game update from refs/beamng/content (zips and loose files) into
// ~/.cache/mapng/game-files.txt. null without a game install.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
export function gameIndex() {
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
  // a missing path the game's own materials reference too (dangling there)
  const dangling = (rel) => refs.has(rel.toLowerCase());
  return { has, mats, stockRefs: refs, dangling };
}

