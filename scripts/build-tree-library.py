#!/usr/bin/env python3
"""
Generate services/beamngTreeLibrary.js: MapNG's regional tree palette.

Groups of stock BeamNG tree / bush shapes with their measured heights, after
BeamNG.Earth's catalog (refs/BeamNG.Earth-main, mod/.../beamngEarth/trees.lua,
MIT; heights measured from TSStatic world boxes in-game), so an export can
pick a regionally sensible species and the model nearest a tree's real height.

Each shape becomes a TSForestItemData template whose wind / physics fields
are copied from the vanilla level that owns it (any level's
managedItemData.json entry with the same shapeFile), so trees sway like they
do in the official maps. Item names are the shape's file name; a clash
between levels is an error.

The materials these shapes bind are harvested by
scripts/build-shape-material-library.py (it reads this file as the
"tree_library" set) and checked by scripts/audit-official-paths.py.

Run from the repo root after every BeamNG update:
    python3 scripts/build-tree-library.py
    python3 scripts/build-shape-material-library.py
    python3 scripts/audit-official-paths.py
"""
import glob
import json
import os
import re
import sys
import zipfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = os.path.join(REPO, "refs/beamng/content")
OUT = os.path.join(REPO, "services/beamngTreeLibrary.js")

ECA = "/levels/east_coast_usa/art/shapes/"
WCA = "/levels/west_coast_usa/art/shapes/"
UT = "/levels/Utah/art/shapes/"
JV = "/levels/johnson_valley/art/shapes/"
JRI = "/levels/jungle_rock_island/art/shapes/"
IT = "/levels/italy/art/shapes/"

# group -> [(shape path without .dae, measured height m)]
GROUPS = {
    "deciduous": [
        (ECA + "trees/trees_oak/tree_oak_sml_a", 8.6), (ECA + "trees/trees_oak/tree_oak_sml_b", 9.5),
        (ECA + "trees/trees_aspen/tree_aspen_small_a", 8.3), (ECA + "trees/trees_aspen/tree_aspen_small_c", 9.7),
        (ECA + "trees/trees_beech/tree_beech_small_c", 9.9), (ECA + "trees/trees_oak/tree_oak_large_a", 13.2),
        (ECA + "trees/trees_oak/tree_oak_large_b", 15.9), (ECA + "trees/trees_oak/tree_oak_large_c", 15.5),
        (ECA + "trees/trees_oak/tree_oak_forest_a", 15.9), (ECA + "trees/trees_oak/tree_oak_forest_b", 16.0),
        (ECA + "trees/trees_beech/tree_beech_large_c", 17.4), (ECA + "trees/trees_aspen/tree_aspen_forest_b", 18.5),
        (ECA + "trees/trees_beech/tree_beech_forest_a", 20.2), (ECA + "trees/trees_beech/tree_beech_large_b", 21.1),
    ],
    "conifer": [
        (ECA + "trees/trees_douglasfir/tree_douglasfir_small_b", 11.2),
        (ECA + "trees/trees_douglasfir/tree_douglasfir_small_a", 13.4),
        (ECA + "trees/trees_douglasfir/tree_douglasfir_large_c", 18.9),
        (ECA + "trees/trees_douglasfir/tree_douglasfir_large_a", 19.6),
        (ECA + "trees/trees_douglasfir/tree_douglasfir_large_b", 21.4),
        (ECA + "trees/trees_douglasfir/tree_douglasfir_large_d", 21.7),
        (IT + "trees/trees_italy/scots_pine", 18.9),
    ],
    "shrub": [
        (ECA + "trees/ECA_coast_bush/generibush", 1.8), (ECA + "trees/trees_aspen/tree_aspen_bush_a", 2.2),
        (ECA + "trees/trees_douglasfir/tree_douglasfir_bush_a", 2.7), (ECA + "trees/trees_oak/tree_oak_bush_c", 3.1),
        (ECA + "trees/trees_beech/tree_beech_bush_b", 3.3), (ECA + "trees/trees_beech/tree_beech_bush_c", 3.9),
        (ECA + "trees/trees_oak/tree_oak_bush_b", 4.1),
    ],
    "pine_west": [
        (WCA + "trees/trees_conifer/pine_radiata_small", 8.6), (WCA + "trees/trees_conifer/pine_radiata_forest", 13.3),
        (WCA + "trees/trees_conifer/pine_radiata_large", 13.2), (WCA + "trees/trees_conifer/pine_radiata_weathered", 13.2),
        (ECA + "trees/trees_douglasfir/tree_douglasfir_large_a", 19.6),
        (ECA + "trees/trees_douglasfir/tree_douglasfir_large_d", 21.7),
        (IT + "trees/trees_italy/scots_pine", 18.9), (WCA + "trees/trees_conifer/redwood_tall", 38.5),
        (WCA + "trees/trees_conifer/redwood_split", 38.1), (WCA + "trees/trees_conifer/redwood_broad", 38.5),
    ],
    "oak_west": [
        (WCA + "trees/trees_oak/oak_d", 7.1), (WCA + "trees/trees_oak/oak_b", 8.2), (WCA + "trees/trees_oak/oak_c", 8.4),
        (WCA + "trees/trees_oak/oak_a", 9.6), (WCA + "trees/trees_eucalyptus/eucalyptus_double", 14.7),
        (WCA + "trees/trees_eucalyptus/eucalyptus_tall", 22.5),
    ],
    "palm": [
        # (not palm_short: it binds leaves_strong_005 / leaves_thin_005, which no game file defines)
        (JRI + "trees/trees_palm/palm_small", 8.9),
        (WCA + "trees/trees_palm/fanpalm_short", 10.6), (WCA + "trees/trees_palm/fanpalm_skirt", 11.7),
        (WCA + "trees/trees_palm/fanpalm_full", 13.8), (JRI + "trees/trees_palm/palm_medium", 18.0),
        (WCA + "trees/trees_palm/fanpalm_tall", 18.5), (WCA + "trees/trees_palm/fanpalm_slim", 20.8),
        (JRI + "trees/trees_palm/palm_tall", 25.3),
    ],
    "juniper": [
        (UT + "trees/Juniper/Juniper_bush_large_01", 2.6), (UT + "trees/Juniper/Juniper_tree_04", 4.5),
        (UT + "trees/Juniper/Juniper_tree_03", 5.2), (UT + "trees/Juniper/Juniper_tree_01", 6.3),
        (UT + "trees/Juniper/Juniper_tree_02", 7.4), (UT + "trees/Juniper/Juniper_ancient_01", 7.5),
    ],
    # (not JV's deserttree_bush_tiny: it ships no imposter, and BeamNG.Earth found the one the
    # engine baked while its leaf material was unresolved stays orange for good)
    "desert_shrub": [
        (UT + "groundcover/s_gc_utah_grey_bush_01", 0.7), (JV + "groundcover/s_gc_jv_dry_bush_01", 0.7),
        (UT + "groundcover/s_gc_utah_grey_bush_03", 1.0), (JV + "groundcover/s_gc_jv_dry_bush_03", 1.0),
        (UT + "trees/Juniper/Juniper_bush_small_01", 1.2), (UT + "trees/Juniper/Juniper_bush_small_dry_01", 2.0),
        (UT + "trees/Juniper/Juniper_bush_medium_01", 2.4), (JV + "trees/deserttrees/deserttree_bush_medium", 2.9),
    ],
    "tropical": [
        (JRI + "trees/bush_tropical_1/tro_bush_huge", 5.5), (JRI + "trees/bush_tropical_2/tro_bush_2_small", 6.1),
        (JRI + "trees/trees_tropical_2/tro_tree_2_filler", 20.2), (JRI + "trees/trees_tropical_1/tro_tree_1_huge", 20.6),
        (JRI + "trees/trees_tropical_1/tro_tree_1_filler", 33.0),
    ],
}

WIND_FIELDS = ("radius", "tightnessCoefficient", "detailFreq", "windScale", "detailAmp", "branchAmp",
               "trunkBendScale", "dampingCoefficient", "mass", "rigidity", "annotation", "collidable")
# fallbacks when no vanilla entry exists (vanilla medians for trees / bushes)
DEFAULT_TREE = {"radius": 0.5, "windScale": 0.5, "trunkBendScale": 0.01, "branchAmp": 0.05,
                "detailAmp": 0.2, "detailFreq": 0.5, "mass": 1, "rigidity": 10, "dampingCoefficient": 0.7,
                "tightnessCoefficient": 0.4}
DEFAULT_BUSH = {"radius": 0.3, "windScale": 0.4, "trunkBendScale": 0.02, "branchAmp": 0.05,
                "detailAmp": 0.3, "detailFreq": 0.5, "collidable": False}


def lenient_json(b):
    return json.loads(re.sub(r",\s*([}\]])", r"\1", b.decode("utf-8", "replace")))


def main():
    zips = glob.glob(os.path.join(CONTENT, "levels/*.zip")) + glob.glob(os.path.join(CONTENT, "assets/*.zip"))
    entries = {}
    vanilla = {}          # lowercase shape path (no leading /) -> item data
    for z in zips:
        with zipfile.ZipFile(z) as zf:
            for n in zf.namelist():
                entries.setdefault(n.lower(), n)
                if n.endswith("managedItemData.json"):
                    try:
                        d = lenient_json(zf.read(n))
                    except Exception:
                        continue
                    for v in d.values():
                        if isinstance(v, dict) and v.get("shapeFile"):
                            vanilla.setdefault(v["shapeFile"].lstrip("/").lower(), v)

    items, groups, problems = {}, {}, []
    for group, shapes in GROUPS.items():
        groups[group] = []
        for path, height in shapes:
            dae = path + ".dae"
            rel = dae.lstrip("/").lower()
            if rel not in entries and rel[:-4] + ".cdae" not in entries:
                problems.append(f"{dae}: not in game")
                continue
            name = os.path.basename(path)
            if name in items and items[name]["shapeFile"].lower() != dae.lower():
                problems.append(f"{name}: two shapes share the name")
                continue
            if name not in items:
                src = vanilla.get(rel)
                base = DEFAULT_BUSH if height < 3.0 else DEFAULT_TREE
                fields = {k: src[k] for k in WIND_FIELDS if src and k in src} if src else dict(base)
                items[name] = {"name": name, "internalName": name, "class": "TSForestItemData",
                               "shapeFile": dae, **fields}
            groups[group].append([name, height])

    for p in problems:
        print("PROBLEM:", p, file=sys.stderr)
    if problems:
        return 1

    version = "unknown"
    integrity = os.path.join(REPO, "refs/beamng/integrity.json")
    if os.path.exists(integrity):
        version = json.load(open(integrity)).get("version", version)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// GENERATED by scripts/build-tree-library.py from the BeamNG install; do not edit.\n")
        f.write("// Tree groups and measured heights after BeamNG.Earth (MIT, refs/BeamNG.Earth-main).\n")
        f.write(f"export const TREE_LIBRARY_VERSION = '{version}';\n\n")
        f.write("// group -> [[item name, measured height m], ...]\n")
        f.write("export const TREE_GROUPS = {\n")
        for group, members in groups.items():
            f.write(f"  {group}: [\n")
            for name, height in members:
                f.write(f"    [{json.dumps(name)}, {height}],\n")
            f.write("  ],\n")
        f.write("};\n\n")
        f.write("// item name -> TSForestItemData template (wind / physics from the owning vanilla level)\n")
        f.write("export const TREE_ITEMS = {\n")
        for name in sorted(items):
            it = items[name]
            body = ",\n".join(f"    {k}: {json.dumps(v)}" if k != "shapeFile" else f"    shapeFile: '{v}'"
                              for k, v in it.items())
            f.write(f"  {json.dumps(name)}: {{\n{body},\n  }},\n")
        f.write("};\n")
    print(f"Wrote {OUT}: {len(items)} items in {len(groups)} groups (game {version}); "
          f"{sum(1 for n in items if items[n].get('windScale') is not None)} with wind data")
    return 0


if __name__ == "__main__":
    sys.exit(main())
