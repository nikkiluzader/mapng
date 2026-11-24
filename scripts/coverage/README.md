# The coverage level

A synthetic level built from MapNG's own lists, so every tag MapNG builds, every game model it places and every model
it generates can be checked in one export, without exporting a real town (asked for by the user, 2026-11-24).

## Steps

```
# 1. the synthetic test area(s): a heightmap with a hill, river, sea; one plot per built tag of
#    data/osm-tag-library.json; bridges of every structure, tunnels, railway, power lines, pier, coast
node scripts/coverage/buildCoverageArea.mjs all            # or one region: na_east | na_west | europe | tropical | asia

# 2. the export, offline (the area carries its own land cover and tree mix)
NAPI_CANVAS=$PWD/desktop/node_modules/@napi-rs/canvas \
  node scripts/sweep/exportArea.mjs coverage_na_east mh mapng_coverage_na_east --out scratch/coverage --fix-stubs

# 3. the offline check against the game's files (refs/beamng): exit 1 on a missing material or texture
python3 scripts/coverage/check_coverage.py scratch/coverage/mapng_coverage_na_east.zip na_east --json scratch/coverage/na_east.check.json

# 4. in the game (docs/known-issues.md has why free-roam): install the zip as .zip.part then rename, clear
#    temp/levels/<level>, load with freeroam_freeroam.startFreeroam('/levels/<level>/main.level.json'), then grep
#    beamng.log from the level's "Level loading" line for: Missing source texture, NO TEXTURE, Failed to create
#    resource, and check the "mapng | New shape sprites were baked: reloading textures" line after a first load.
```

## What the check reports

- **models**: placed (official, generated) and, of the tag library's models in use for the region, which were not
  placed (variants are picked by region and seed; not a failure, but a gap in the layout to close).
- **materials undefined**: a placed model uses a material the level does not define and the game does not define
  globally (`/art`, `/assets`): in game, the orange NO TEXTURE.
- **textures missing**: a level material names a texture that is not in the level, not behind a working link, and not
  in the game: in game, a missing texture.
- **billboard models**: official models with an auto-billboard node, for the in-game step (black boxes on a first
  load unless the level script reloads textures).

## First run (2026-11-24, na_east)

146 models placed (65 official, 81 generated); 42 of the 123 tag-library models in use for the region placed.
Found: 5 official models with materials nobody defines (Italy stone wall, boom gate, Utah picnic table, Italy
electric box, Johnson Valley water tank); 2 beech foliage textures named in
`services/beamngRuntimeMaterialCatalog.js` that the game no longer ships; the palm bark overlay texture. Open in
`docs/handoff.md`.
