# Known issues: seen before, how to recognise them, why, and the fix

Problems that have come up more than once or took long to pin down. Before chasing a strange sight in the game or
an odd test result, look here first. When one is solved, add it: what it looks like, the cause, how it was proven,
the fix and where it lives, and the traps when testing it. Keep each entry short; link to code and history.

Last updated: 2026-11-24 (night).

---

## Black boxes at a distance (imposter bake on first load)

**Looks like:** solid black rectangles standing over or instead of objects far from the camera (poles, stadium
lights, palms and other billboard trees); close up the object looks right. Often a whole row of them along a
line of poles or at the map's edge. Gone on the second load of the same level.

**Cause:** a shape with an auto-billboard node (`bb_autobillboard25`, `bb__autobillboard25`) is drawn far away as a
flat picture, an *imposter*. The game keeps that picture in `temp/levels/<level>/...<shape>.dae.imposter.dds`. When
it finds none, or finds one older than the shape file, it bakes a new one ("Rebuilding imposter ...: shape file
... is newer than imposter", then "Creating imposters for: ..." in `beamng.log`). The freshly baked picture draws as
black until textures are reloaded; the file on disk is fine, so the next load is clean.

**Seen:** 2026-11-01 stadium floodlight poles (`hr_stadium_lights.dae`, Driver Training: ships no imposter);
billboard trees on first load (fixed in an earlier release); 2026-11-24 the power-line pole `powerpole4.dae` (West
Coast USA) brought in by the Perth power-line fix: a row of black boxes along the map's north edge.

**Fix (since 2026-11-24): hidden behind the loading screen.** On a first load (no sprites cached yet) the level
script holds the loading screen (`core_gamestate.requestEnterLoadingScreen('mapngSprites')`); the bake comes a
fraction of a second after the level has loaded, the textures are reloaded behind the screen, and the hold is let go
a second later (3 s at most with no bake, 20 s whatever happens, and when the level ends). A later load does not hold.
Log lines: `New shape sprites were baked: reloading textures behind the loading screen`, `Loading screen let go: ...`.

**Tried and not enough (2026-11-24):** a `.link` to the game's own imposter, beside the shape or under the zip's
`temp/levels/<level>/` path, even with the shape's link dated 2013 like the game's files: the imposter check wants a
real file. A real `.imposter.dds` beside the linked shape (dated no later than its link) does stop the bake, but a
browser export cannot copy game files and 11 of 73 billboard shapes (the traffic-signal pole among them) ship none.

**Earlier fix, still in place:** the generated `mainLevel.lua` (in `services/exportBeamNGLevel.js`, search
"spriteWatch") watches `temp/levels/<level>/**/*.imposter.dds` after the level starts and calls `reloadTextures()`
once when new ones appear, or when one was written in the last 10 minutes (a bake that finished during loading,
added 2026-11-24). It logs `mapng | New shape sprites were baked: reloading textures`. Cost: a few seconds on a big
level, first load only. The script unloads itself when its level ends (the game would otherwise keep running it on
the next map).

**What does NOT fix it (tried 2026-11-24):** linking the game's own shipped imposter (`<shape>.dae.imposter.dds`)
beside the linked shape. The copy of the shape in the level carries the export's date, so it is always newer than
the shipped picture and the game rebakes anyway (log line above). The tree library still links shipped imposters for
its trees (`SHAPE_IMPOSTER_FILES`, `scripts/build-tree-library.py`); harmless, but the reload script is what clears
the boxes.

**Proving it in the game:**
1. Look at the log for "Creating imposters for: <shape>" and the `.imposter.dds` files under
   `temp/levels/<level>/`.
2. Run `reloadTextures()` in the console: the boxes vanish at once if this is the cause.
3. To reproduce a first load, delete that level's folder under `temp/levels/` (literal path) before loading.

**Testing trap:** the reload script is `mainLevel.lua`, which only the game's **free-roam** loader loads (on
`onClientPreStartMission`) and unloads (on `onClientEndMission`). The MCP tool's `load_level` does not go through
free-roam, so the previous level's `mainLevel` (smallgrid has one) stays loaded under the same name and ours never
runs: black boxes in a test that players never see. Load test levels with
`freeroam_freeroam.startFreeroam('/levels/<level>/main.level.json')` when checking anything the level script does,
starting from smallgrid also loaded in free-roam. Check with `extensions.mainLevel.__extensionPath__`: it must name
the test level.

**Other causes of dark boxes to rule out:** distant stock traffic lights on low graphics settings (seen in Tokyo,
not ours); buildings at the map's edge seen against a bright sky look dark but are not black and do not vanish on
`reloadTextures()`.

---

## "Invalid ZIP file" when loading a test level

**Looks like:** the game refuses a level just copied into the mods folder, or loads it half-built.
**Cause:** the game reads the zip while it is still being copied. **Fix:** copy it as `<name>.zip.part`, then
rename to `<name>.zip`; check `FS:fileSize('/mods/<name>.zip')` before loading. (Memory: feedback-mods-copy-then-rename.)

---

## Test exports: the sky reflection files are 4-byte stubs

**Looks like:** in a level made by `scripts/sweep/exportArea.mjs`, `beamng.log` shows `DDSFile::readHeader -
incorrect header size` for `art/cubemaps/Universal_cubemap_reflection/cubemap/skybox*.hdr.dds`.
**Cause:** the Node test exporter writes a stub for the cubemap faces instead of the 5.5 MB files in
`public/cubemap/`. Real exports (browser and desktop app) carry the full files. Not a product bug; reflections in a
test level are not to be judged.

---

## Test exports: no grass on unmapped ground (fixed 2026-11-24)

**Looked like:** a level from `scripts/sweep/exportArea.mjs` with bare ground, short dirt-coloured tufts at most,
where the browser and desktop app grow full grass. More than half the terrain stayed `DefaultMaterial`, which no
ground cover grows on.
**Cause:** unmapped ground becomes Grass where the base texture is green (`buildVegetationMask`,
`services/exportBeamNGLevel.js`), read with `createImageBitmap` + `getImageData`. The Node polyfill
(`scripts/sweep/polyfill.mjs`) had neither pixel read, so the mask came back null without a word and every test
export (the sweep's too) had no grass there.
**Fix:** the polyfill decodes a resized bitmap to pixels (sharp) and answers `getImageData` from the window drawn.
Grass went from 3 % to 36 % of the coverage level.
**Related trap (synthetic areas):** the test painter (`scripts/sweep/gametexnode.mjs`) fetched the real satellite
image and land cover of the area's coordinates. For a synthetic area (`meta.synthetic`) it now paints without a
satellite and reads the area's own land cover.

---

## Edits to `services/` while a sweep runs

**Looks like:** a sweep result that matches neither the old nor the new code. **Cause:** the sweep runs the working
tree's code cell by cell, so a mid-run edit changes the later cells. **Fix:** do not edit `services/` (or exporters)
until the sweep is done; use a git worktree for parallel work (see `docs/handoff.md`, "Traps").

---

## Link files: what MapNG links, and what it must not

BeamNG's Link Files page (`refs/beamng-docs/Link Files.md`): a level should hold link files for shared assets and
only its own level files; links suit assets that reference nothing else (textures, raw mesh data).

**What MapNG links (reviewed 2026-11-24):**
- Every official model from another level (`.dae`): `services/beamngLinkFiles.js`, through `rewriteForLinks` on every
  object file that can hold a model (signs, street furniture, signals, fuel stations, level objects, vegetation,
  forest items, water, sky). Models in the game's shared `/art/` folder are used where they are (the page's own
  advice). The OSM tag library's models (`data/osm-tag-library.json`, `data/game-model-catalogue.json`) reach the
  level through the same path: nothing to add to the catalogue itself.
- Textures in the shape, biome, sign and fuel-station materials and on water, but only those the game ships as a
  real file under exactly that name: `services/textureLinkTargets.js`, made by
  `scripts/build-texture-link-targets.py` (re-run after a game update and after the material libraries change).

**What it must not link:**
- Terrain material textures: TerrainCellMaterial does not follow `.link` (verified 2026-07-22).
- Textures the game itself reaches through its own link file (many tree textures: `levels/jungle_rock_island/...
  /t_tro_vines_b.color.png.link` -> `/assets/...`, often a `.png` name whose cooked `.dds` lives in `/assets`). A MapNG
  link to such a path, or to where the game's chain ends, left the texture missing: `E|GFXTextureManager::_cookTexture|
  Missing source texture ...` in `beamng.log`, many times a second; the same level with direct paths had none. They
  keep their direct path; the game's own links resolve them.

**Not linkable because it is MapNG's own:** the reflection cubemap (`public/cubemap/`, 33 MB per level; not in the
game, checked against all its archives), the flag model, the facade light texture, every generated mesh.

**How to check a level:** load it in free-roam from an empty `temp/levels/<level>` and grep the log from its
"Level loading" line for `Missing source texture` / `NO TEXTURE`; there should be none.

---

## The game stuck in an error loop after many loads (seen once, 2026-11-24)

**Looked like:** the game seemed frozen; the log filled with `kdtreebox2d.lua:202: attempt to compare nil with number`
(from `gameplay/markerInteraction.lua`, mission markers) and `Cannot setCamera, camera not found: gameCamera`, many a
second, on the coverage level. **Context:** a game session about 17 hours old with dozens of test-level loads. A fresh
start loaded the same level and ran the same tour with neither error. **What to do:** restart the game; if it comes
back on a fresh session, the saved log tail is `scratch/coverage/crash_log_tail.txt`.

## Test layouts that misled a check (2026-11-24)

- A synthetic river over rolling ground lay buried under every hump (a river is held never to flow uphill): give a
  test valley a steady fall (`testLevels.mjs` terrain).
- Test roads crossing without a shared node made no junction: `run(..., through)` in `testLevels.mjs`.
- Two coast plots in one row laid their lines on top of each other: each gets its own offset.
- A 30 m square plot is no size for a canal, a track or a house: real sizes (`REAL_SIZE`, the water block).

## Headless test levels show a grey thumbnail and their file name in the game's list

- **Seen:** 2026-11-24, the first upload of the official test levels: grey cards titled "mapng_test_roads_na_east".
- **Cause:** the sweep's canvas stand-in (scripts/sweep/polyfill.mjs) draws nothing, and fixStubs.mjs filled the
  stub with grey; exportArea.mjs passed no title, so the level name became the title.
- **Fix:** fixStubs.mjs draws the real card (scripts/sweep/levelCard.mjs: the app's generatePreviewBlob on the
  desktop app's canvas, with the app's fonts); exportArea.mjs takes `--title`.
- **Also:** a level downloaded under a name the game's mod list already knows keeps that entry's on/off state
  (mods/db.json); names left switched off by a test run stay hidden from the level list.

## A road decal that overlaps another at the same render priority is not drawn at all

- **Seen:** 2026-11-24, the sidewalk test level: a cul-de-sac's bulb (a decal over the street's end) never drew, grass
  inside its curb ring; regenerating it by hand did nothing until its priority changed.
- **Cause:** the game drops a DecalRoad that overlaps another of the same `renderPriority`.
- **Fix:** the bulb one step off the street's priority (exportBeamNGLevel.js, cul-de-sacs). Any decal laid over another
  road's decal needs its own priority.

## A grass band between the asphalt and the curb on town streets

- **Seen:** 2026-11-24, every street of the sidewalk test level; brightest on the sunny side (ground cover).
- **Cause:** the base texture painted streets with the lane layout (6 m for a two-lane street) while the export
  built them 9 m curb to curb; the asphalt decal lets the ground show over its outer 2 m.
- **Fix:** osmTexture.js paints roads at the export's width (roadWidth.js estimateRoadCrossSection, same urban test).

## The game stuck in "Cannot setCamera, camera not found: gameCamera"

- **Seen:** twice on 2026-11-24, after leaving a test level with `endActiveGameMode()`; the next level never loaded.
- **Fix:** only a game restart cleared it. Switch levels with `startFreeroam` from inside the loaded level (mod
  deactivated, zip replaced, mod activated) instead of ending the game mode.


## Paving in spikes, wedges and gaps round paths that enclose a lawn

- **Seen:** 2026-11-26, St. Augustine's Flagler College courtyard (the user's review level): the paths round two
  circles came out as jagged light wedges over the lawn with holes in the paths; curbs fine.
- **Recognise it:** the paving cells (zoom/curbcheck rasters) look right, the mesh triangles (plot them) do not; the
  slab's area exceeds the paved cells' area. Happens where sidewalks and paths close a loop, the lawn a hole in one
  outline; a change far away (a corner joining two sidewalks) can bring it on.
- **Cause:** buildPavedMesh clipped the outline and each hole to every 4 m square on its own; the clipped outline
  was the whole square with seams along its edges, the hole on those same edges, and the triangulation broke.
- **Fix:** 4eadc23, squares holding a hole use polyClip.difference first. Probe: dump the tile
  (scratch/swaudit/paveddump/hook.mjs) and mesh it with scratch/stagsw/probe/meshtile.mjs / persq.mjs.
