# The coverage level

A synthetic level built from MapNG's own lists, so every tag MapNG builds, every game model it places and every model
it generates can be checked in one export, without exporting a real town (asked for by the user, 2026-11-24).

## Steps

```
# 1. the synthetic test area(s), 2048 m at 1 m: a hill with a road and a rail tunnel, a river with a bridge of each
#    structure type, a footbridge and a dam, the sea with a coastline and piers, a railway with a level crossing, a
#    station platform and a siding, power lines, a lake, a wood, a scrub, an arboretum of single trees 30 m apart,
#    and one 60 m plot per tag of data/osm-tag-library.json MapNG builds (and per model-pick rule of
#    data/tag-models.json), each with the context MapNG needs (a fence for a gate, a junction for a stop sign...)
node scripts/coverage/buildCoverageArea.mjs na_east        # or: na_west | europe | tropical | asia | all

# 2. the export, offline (the area carries its own land cover and tree mix; the game texture is painted without
#    a satellite, as for a user without imagery)
NAPI_CANVAS=$PWD/desktop/node_modules/@napi-rs/canvas \
  node scripts/sweep/exportArea.mjs coverage_na_east mh mapng_coverage_na_east --out scratch/coverage --fix-stubs

# 3. the offline check against the game's files (refs/beamng): exit 1 on a missing material or texture
python3 scripts/coverage/check_coverage.py scratch/coverage/mapng_coverage_na_east.zip na_east --json scratch/coverage/na_east.check.json

# 4. in the game: install the zip as .zip.part then rename, clear temp/levels/<level>, load with
#    freeroam_freeroam.startFreeroam('/levels/<level>/main.level.json') (docs/known-issues.md has why free-roam),
#    then the tour: one framed shot per asset, about half a second each, the sun held at noon
python3 scripts/coverage/tour_targets.py coverage_na_east scratch/coverage/mapng_coverage_na_east.zip scratch/coverage/tour_targets.lua
#    copy tour_targets.lua to <userfolder>/covtour/targets.lua and ingame_tour.lua to <userfolder>/covtour/tour.lua,
#    then in the game's Lua: ui_visibility.set(false); loadstring(readFile('/covtour/tour.lua'))()
#    shots land in <userfolder>/screenshots/mcp/cov/, the log in <userfolder>/covtour/log.tsv

# 5. contact sheets, 12 labelled shots each, for the review
conda run -n laneextraction python scripts/coverage/contact_sheets.py <shots folder> scratch/coverage/tour_targets.lua scratch/coverage/sheets
```

## What the check reports

- **models**: placed (official, generated) and, of the tag library's models in use for the region, which were not
  placed (variants are picked by region and seed; a gap in the layout to close, not a failure).
- **materials undefined**: a placed model uses a material no level or game materials file defines: in game, the
  orange NO TEXTURE. Official models seen textured in game although nothing defines their materials (the engine
  falls back to the model's own data) are listed in `seen_in_game.json` and reported as warnings.
- **textures missing**: a level material names a texture that is not in the level, not behind a working link, and not
  in the game; textures the game's own materials name and lack too are warnings.
- **billboard models**: official models with an auto-billboard node, for the in-game step (black boxes on a first
  load unless the level script reloads textures).

## Runs

- **2026-11-24, na_east, 1024 m (two tours, 238 and 280 shots).** Every official model drew textured; no black
  boxes; zero missing textures. Found and fixed: test exports had no grass (Node polyfill, docs/known-issues.md);
  the OSM reader dropped line piers (closed longer ones), single shrubs and line platforms (services/osm.js, tests in
  tests/osmClip.test.mjs). Found, in the backlog: `building=roof` built as a closed shed; greenhouse, container,
  ruins and small churches look like other buildings; land cover alone plants no trees; line breakwaters and groynes
  not built; short rivers and canals on ground with no channel are a 0.2 m film of water that barely shows.
  Layout faults fixed for the next run: 20 m-high coast, lake across the tunnels, railway across the hill's foot (it
  came out on a viaduct), side roads ending in the next street's sidewalk.
