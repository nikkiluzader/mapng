#!/usr/bin/env python3
"""The coverage level's offline check: what an exported level places, against what MapNG says it uses, and whether
every material and texture it needs is there. Reads the game's own files (refs/beamng) for the official models.

    python scripts/coverage/check_coverage.py <level.zip> [region] [--json out.json]

region: na_east | na_west | europe | tropical | asia (which of the tag library's model regions apply).
Exit code 1 when a material or texture is missing (a model would show NO TEXTURE or a texture would go missing in
game); the model coverage is reported, not failed on (which variant the code picks is seeded).

Checks:
  1. models: every model the level places (TSStatic shapes, forest items, ground cover), the official ones mapped
     back from their link paths; against data/osm-tag-library.json's usedToday models for the region.
  2. materials: every material a placed model uses (its .dae's materials; official models read from the game's zips)
     must be defined in one of the level's main.materials.json files (by name or mapTo).
  3. textures: every texture a level material names must exist: in the level, through a level link to a game file,
     or as a game file or game link (real file, or its .dds beside a .png name, as the game's loader takes).
  4. billboards: placed official models with an auto-billboard node (bb_autobillboard*): black boxes on a first load
     unless the level script reloads textures (docs/known-issues.md). Listed, for the in-game step to watch.
"""
import glob
import json
import os
import re
import sys
import zipfile

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GAME = os.path.join(REPO, 'refs', 'beamng', 'content')
REGION_OK = {
    'na_east': {'any', 'north-america'}, 'na_west': {'any', 'north-america'}, 'europe': {'any', 'europe'},
    'tropical': {'any', 'tropical'}, 'asia': {'any'},
}
TEX = re.compile(r'\.(dds|png|jpe?g)$', re.I)
# official models seen textured in game although no materials file defines their materials (scripts/coverage)
SEEN = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'seen_in_game.json'), encoding='utf-8'))['models']


def game_index():
    """Every game file (real), the game's link files, its .dae files, and the materials it defines for every level
    (those in /art and /assets materials files load whatever level is played)."""
    real, links, zips, global_mats = set(), {}, {}, set()
    vanilla_tex = set()   # textures the game's own materials name (to tell its dangling references from ours)
    folder_mats = {}      # a game folder -> the materials its materials files define (loaded with a shape from it)
    for zp in glob.glob(os.path.join(GAME, '**', '*.zip'), recursive=True):
        try:
            z = zipfile.ZipFile(zp)
        except zipfile.BadZipFile:
            continue
        for n in z.namelist():
            low = n.lower()
            if low.endswith('.link'):
                links[low[:-5]] = (zp, n)
            elif not low.endswith('/'):
                real.add(low)
                if low.endswith('.dae'):
                    zips[low] = (zp, n)
                if low.endswith('materials.json'):
                    try:
                        vanilla_tex.update(t.lower().lstrip('/') for t in re.findall(r'"(/?(?:levels|art|assets)/[^"]+?\.(?:dds|png|jpe?g))"', z.read(n).decode('utf-8', 'replace'), re.I))
                    except (KeyError, zipfile.BadZipFile):
                        pass
                if low.endswith('materials.json'):
                    try:
                        d = json.loads(z.read(n))
                        fm = folder_mats.setdefault(low.rsplit('/', 1)[0], set())
                        for k, v in (d.items() if isinstance(d, dict) else []):
                            fm.add(k.lower())
                            if isinstance(v, dict) and isinstance(v.get('mapTo'), str):
                                fm.add(v['mapTo'].lower())
                    except (ValueError, KeyError, zipfile.BadZipFile):
                        pass
                if low.endswith('materials.json') and not low.startswith('levels/'):
                    try:
                        d = json.loads(z.read(n))
                    except ValueError:
                        continue
                    for k, v in (d.items() if isinstance(d, dict) else []):
                        global_mats.add(k.lower())
                        if isinstance(v, dict) and isinstance(v.get('mapTo'), str):
                            global_mats.add(v['mapTo'].lower())
    return real, links, zips, global_mats, vanilla_tex, folder_mats


def dae_materials(text):
    """The material names the game looks up for a model: each <material>'s name (its id when it has none)."""
    out = set()
    for m in re.finditer(r'<material\s+([^>]*?)/?>', text):
        attrs = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
        n = attrs.get('name') or attrs.get('id')
        if n:
            out.add(re.sub(r'-material$', '', n))
    return out


def dae_has_billboard(text):
    return bool(re.search(r'name="bb_+autobillboard', text, re.I))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    zpath = args[0]; region = args[1] if len(args) > 1 else 'na_east'
    out_json = sys.argv[sys.argv.index('--json') + 1] if '--json' in sys.argv else None
    z = zipfile.ZipFile(zpath)
    names = z.namelist(); lower = {n.lower(): n for n in names}
    level = next(n.split('/')[1] for n in names if re.match(r'levels/[^/]+/info\.json$', n))
    base = f'levels/{level}/'.lower()
    real, glinks, gzips, global_mats, vanilla_tex, folder_mats = game_index()

    def level_link_target(p):
        n = lower.get(p + '.link')
        return json.loads(z.read(n))['path'].lstrip('/').lower() if n else None

    def official_of(p):
        """A level path through a link back to the game path it stands for."""
        p = p.lstrip('/').lower()
        m = re.match(rf'{re.escape(base)}map_assets/official_assets/[^/]+_assets/(levels/.+)$', p)
        return m.group(1) if m else (p if not p.startswith(base) else None)

    # 1. placed models
    placed = {}
    for n in names:
        if not n.endswith('.json'):
            continue
        t = z.read(n).decode('utf-8', 'replace')
        for m in re.finditer(r'"(?:shapeName|shapeFile|shapeFilename)"\s*:\s*"([^"]+?\.c?dae)"', t):
            p = m.group(1).lstrip('/').lower().replace('.cdae', '.dae')
            placed.setdefault(p, set()).add(n.split('/')[-1])
    official = {}; generated = set()
    for p in placed:
        o = official_of(p)
        if o and o.startswith('levels/') and not o.startswith(base) or (o and o.startswith('art/')):
            official[p] = o
        else:
            generated.add(p)
    lib = json.load(open(os.path.join(REPO, 'data', 'osm-tag-library.json'), encoding='utf-8'))
    want = {}
    for tag, e in list(lib['tags'].items()) + list((lib.get('untagged') or {}).items()):
        for a in e.get('assets', []):
            if a.get('usedToday') and a.get('region', 'any') in REGION_OK.get(region, {'any'}):
                want.setdefault(a['shape'].lstrip('/').lower(), set()).add(tag)
    have = set(official.values())
    missing_models = {s: sorted(t) for s, t in want.items() if s not in have}

    # 2. materials defined in the level
    defined = set(global_mats)
    for n in names:
        if n.endswith('main.materials.json') or n.endswith('materials.json'):
            try:
                d = json.loads(z.read(n))
            except ValueError:
                continue
            for k, v in (d.items() if isinstance(d, dict) else []):
                defined.add(k.lower())
                if isinstance(v, dict):
                    for f in ('name', 'mapTo', 'internalName'):
                        if isinstance(v.get(f), str):
                            defined.add(v[f].lower())
    undefined = {}; billboards = []; fallback_ok = {}
    for p, o in official.items():
        src = gzips.get(o)
        if not src:
            undefined[o] = ['(model not found in the game files)']
            continue
        text = zipfile.ZipFile(src[0]).read(src[1]).decode('utf-8', 'replace')
        # (the game also loads the materials files in a shape's own folder with it, the link's target: seen in game,
        # 2026-11-24, every model the level does not define materials for drew textured this way)
        own = folder_mats.get(o.rsplit('/', 1)[0], set())
        miss = sorted(m for m in dae_materials(text) if m.lower() not in defined and m.lower() not in own)
        if miss:
            # (an undefined material falls back to the textures the model file names, relative to its folder: seen
            # drawing correctly in game for all five such models, 2026-11-24. Warning only when those all exist)
            folder = o.rsplit('/', 1)[0]
            imgs = [re.sub(r'^\./', '', i.strip()) for i in re.findall(r'<init_from>([^<]+?\.(?:dds|png|jpe?g))</init_from>', text, re.I)]
            def img_ok(i):
                q = (i if i.startswith(('levels/', 'art/', 'assets/', '/')) else f'{folder}/{i}').lstrip('/').lower()
                return q in real or TEX.sub('.dds', q) in real or q in glinks
            if o in SEEN or (imgs and all(img_ok(i) for i in imgs)):
                fallback_ok[o] = miss
            else:
                undefined[o] = miss
        if dae_has_billboard(text):
            billboards.append(o)
    for p in generated:
        n = lower.get(p)
        if not n:
            undefined[p] = ['(generated model missing from the level)']
            continue
        miss = sorted(m for m in dae_materials(z.read(n).decode('utf-8', 'replace')) if m.lower() not in defined)
        if miss:
            undefined[p] = miss

    # 3. textures named by level materials
    def tex_ok(p):
        p = p.lstrip('/').lower()
        if p in lower:
            return True
        tgt = level_link_target(p)
        if tgt is not None:
            p = tgt
        dds = TEX.sub('.dds', p)
        return p in real or dds in real or p in glinks
    missing_tex = {}; vanilla_dangling = {}
    for n in names:
        if not n.endswith('materials.json'):
            continue
        t = z.read(n).decode('utf-8', 'replace')
        for m in re.finditer(r'"(/?(?:levels|art|assets)/[^"]+?\.(?:dds|png|jpe?g))"', t, re.I):
            if not tex_ok(m.group(1)):
                bucket = vanilla_dangling if m.group(1).lstrip('/').lower() in vanilla_tex else missing_tex
                bucket.setdefault(m.group(1), set()).add(n.split(level + '/')[-1])

    report = {
        'level': level, 'region': region,
        'models': {'placed': len(placed), 'official': len(official), 'generated': len(generated),
                   'tag library models in use for the region': len(want), 'of them placed': len(want) - len(missing_models),
                   'not placed': missing_models},
        'materials undefined': undefined,
        'materials undefined, drawn from the model\'s own textures (warning)': fallback_ok,
        'textures missing in the game itself too (its own materials name them)': {k: sorted(v) for k, v in vanilla_dangling.items()},
        'textures missing': {k: sorted(v) for k, v in missing_tex.items()},
        'billboard models (black boxes on a first load unless reloaded)': sorted(billboards),
    }
    print(f"level {level} ({region}): {len(placed)} models placed ({len(official)} official, {len(generated)} generated)")
    print(f"  tag library models in use here: {len(want)}, placed: {len(want) - len(missing_models)}, not placed: {len(missing_models)}")
    print(f"  materials undefined: {len(undefined)} model(s)" + ''.join(f"\n    {k}: {v[:6]}" for k, v in list(undefined.items())[:12]))
    print(f"  textures missing: {len(missing_tex)}" + ''.join(f"\n    {k} (in {sorted(v)[:2]})" for k, v in list(missing_tex.items())[:12]))
    print(f"  warnings: {len(fallback_ok)} model(s) drawn from their own textures (no material defined); {len(vanilla_dangling)} texture(s) missing in the game itself too")
    print(f"  billboard models: {len(billboards)}")
    if out_json:
        with open(out_json, 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=1, default=sorted)
    sys.exit(1 if undefined or missing_tex else 0)


if __name__ == '__main__':
    main()
