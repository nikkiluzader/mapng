#!/usr/bin/env python3
"""
Generate public/beamng_shape_materials.json from a BeamNG install.

For each asset set in beamngBiomeCatalog.js ASSET_SETS, collects the .dae
shapes that set places, parses each collada for the materials it actually
binds (<instance_material>), and harvests every such material's definition
from the 0.39 game files — preferring the main.materials.json in the dae's
own folder, falling back to a game-wide search.

Why this must exist: exports only ship the material defs WE write. The
official level that owns a shape is not loaded when playing an exported map,
so any bound material we fail to define falls back to the collada's embedded
info, which resolves textures relative to the link-mirrored shape folder —
the NO-TEXTURE tro_tree bug from the 2026-07-22 jungle test.

Texture paths inside harvested defs are kept as the game ships them (0.39
official defs reference /assets/... or real level-local files); dangling ones
are reported. scripts/audit-official-paths.py verifies the output and also
fails if any dae binds a material that neither this library nor the runtime
catalogs define.

Run from the repo root:  python3 scripts/build-shape-material-library.py
Re-run after every BeamNG update, then run scripts/audit-official-paths.py.
"""
import glob
import json
import os
import re
import sys
import zipfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = os.path.join(REPO, "refs/beamng/content")
OUT = os.path.join(REPO, "public/beamng_shape_materials.json")
CATALOG = os.path.join(REPO, "services/beamngBiomeCatalog.js")
TREE_LIBRARY = os.path.join(REPO, "services/beamngTreeLibrary.js")


def lenient_json(b):
    return json.loads(re.sub(r",\s*([}\]])", r"\1", b.decode("utf-8", "replace")))


def parse_asset_set_daes():
    """Return {assetSetId: [dae paths]} by brace-matching ASSET_SETS blocks."""
    src = open(CATALOG, encoding="utf-8").read()
    start = src.index("const ASSET_SETS = {")
    i = src.index("{", start)
    depth, j = 0, i
    while True:
        c = src[j]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                break
        j += 1
    body = src[i + 1:j]

    sets = {}
    # top-level keys of ASSET_SETS appear at depth 0 within body
    depth = 0
    key = None
    key_start = None
    for k, c in enumerate(body):
        if c == "{":
            if depth == 0:
                m = re.search(r"(\w+)\s*:\s*$", body[:k])
                key = m.group(1) if m else None
                key_start = k + 1
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0 and key is not None:
                block = body[key_start:k]
                sets[key] = sorted(set(re.findall(r"shapeFile:\s*'([^']+\.(?:dae|cdae))'", block)))
                key = None
    return sets


def main():
    if not os.path.isdir(CONTENT):
        print(f"No game install at {CONTENT}", file=sys.stderr)
        return 2

    zips = (glob.glob(os.path.join(CONTENT, "levels/*.zip"))
            + glob.glob(os.path.join(CONTENT, "assets/**/*.zip"), recursive=True)
            + [os.path.join(CONTENT, "art_shapes.zip")])
    entries = {}
    for z in zips:
        with zipfile.ZipFile(z) as zf:
            for n in zf.namelist():
                entries.setdefault(n.lower(), (z, n))

    def read(lp):
        z, n = entries[lp]
        with zipfile.ZipFile(z) as zf:
            return zf.read(n)

    def absolutize(def_obj, source_folder, context):
        """Rewrite relative texture refs against the def's source folder.

        Official defs may reference textures by bare filename, resolved
        relative to their materials.json's folder. Our export re-homes defs
        to map_assets/official_assets/shape_materials/ where no textures
        live, so every ref must be an absolute game path (the utah_rocks_a
        missing-rock-texture bug from the 2026-07-23 Utah test).
        """
        d = json.loads(json.dumps(def_obj))
        stages = d.get("Stages") if isinstance(d.get("Stages"), list) else [d]
        for st in stages:
            if not isinstance(st, dict):
                continue
            for f, v in st.items():
                if not (isinstance(v, str) and v and ("Map" in f or "Tex" in f)):
                    continue
                if v.startswith("/"):
                    continue
                if v.lower().startswith(("levels/", "assets/")):
                    st[f] = "/" + v
                    continue
                candidate = f"{source_folder}/{v}"
                if candidate.lower() not in entries:
                    problems.append((context, v, "relative texture not found beside def"))
                st[f] = "/" + candidate
        return d

    # all official material defs, keyed by name/mapTo; folder-local index too
    all_defs = {}      # lowercase name -> (official name, def, source folder)
    folder_defs = {}   # folder -> same mapping
    for lp in entries:
        if not lp.endswith(".materials.json"):
            continue
        try:
            mats = lenient_json(read(lp))
        except Exception:
            continue
        folder = os.path.dirname(lp)
        # original-case folder for absolutized refs (VFS is case-insensitive,
        # but emit paths as the game ships them)
        folder_cased = os.path.dirname(entries[lp][1])
        fd = folder_defs.setdefault(folder, {})
        for k, v in mats.items():
            if not isinstance(v, dict) or v.get("class") not in (None, "Material"):
                continue
            # keyed lowercase: BeamNG material lookup is case-insensitive
            # (e.g. daes bind 'Juniper_bark', the official def is 'juniper_bark')
            for name in {k, v.get("mapTo"), v.get("name")} - {None}:
                fd.setdefault(name.lower(), (name, v, folder_cased))
                all_defs.setdefault(name.lower(), (name, v, folder_cased))

    sets = parse_asset_set_daes()
    # The regional tree palette (scripts/build-tree-library.py) is its own set,
    # emitted for every biome alongside the biome's asset sets.
    if os.path.exists(TREE_LIBRARY):
        tree_src = open(TREE_LIBRARY, encoding="utf-8").read()
        sets["tree_library"] = sorted(set(re.findall(r"shapeFile:\s*'([^']+\.(?:dae|cdae))'", tree_src)))
    out = {}
    problems = []
    for set_id, daes in sets.items():
        defs = {}
        for dae in daes:
            rel = dae.lstrip("/").lower()
            if rel not in entries:
                problems.append((set_id, dae, "<dae not in game>"))
                continue
            xml = read(rel).decode("utf-8", "replace")
            used = set(re.findall(r'<instance_material\s+symbol="([^"]+)"', xml))
            used |= {m.split("#")[-1] for m in re.findall(r'<instance_material[^>]*target="([^"]+)"', xml)}
            used = {re.sub(r"-material$", "", u) for u in used}
            folder = os.path.dirname(rel)
            for name in sorted(used):
                hit = folder_defs.get(folder, {}).get(name.lower()) or all_defs.get(name.lower())
                if hit is None:
                    problems.append((set_id, dae, f"no official def for '{name}'"))
                    continue
                official_name, d, source_folder = hit
                if official_name not in defs:
                    defs[official_name] = absolutize(d, source_folder, f"{set_id}/{official_name}")
        if defs:
            out[set_id] = dict(sorted(defs.items()))

    for p in problems:
        print("PROBLEM:", *p, file=sys.stderr)
    if problems:
        return 1

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, sort_keys=True)
        f.write("\n")
    total = sum(len(v) for v in out.values())
    print(f"Wrote {OUT}: {len(out)} asset sets, {total} material defs")
    for set_id in sorted(out):
        print(f"  {set_id:24s} {len(out[set_id])} defs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
