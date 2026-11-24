# Known issues: seen before, how to recognise them, why, and the fix

Problems that have come up more than once or took long to pin down. Before chasing a strange sight in the game or
an odd test result, look here first. When one is solved, add it: what it looks like, the cause, how it was proven,
the fix and where it lives, and the traps when testing it. Keep each entry short; link to code and history.

Last updated: 2026-11-24.

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

**Fix (in every exported level):** the generated `mainLevel.lua` (in `services/exportBeamNGLevel.js`, search
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

## Edits to `services/` while a sweep runs

**Looks like:** a sweep result that matches neither the old nor the new code. **Cause:** the sweep runs the working
tree's code cell by cell, so a mid-run edit changes the later cells. **Fix:** do not edit `services/` (or exporters)
until the sweep is done; use a git worktree for parallel work (see `docs/handoff.md`, "Traps").
