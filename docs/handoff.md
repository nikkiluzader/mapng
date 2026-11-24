# Handoff: picking up the 0.3.7 work

Last updated: 2026-11-24, late, by Opus 5.5. Started by the Fable session that shipped 0.3.6; Opus now owns it and works
from it. Keep it current as you work: tick items when done, rewrite the "state" of the item you stop in. It does not
replace the tracking files (see CLAUDE.md, "Tracking"); it is the short "start here" for the next session.

## Read first, in this order

1. `CLAUDE.md` (the rules are strict; the ones most often broken are listed under "Traps" below).
2. `docs/open-items.md`, section "0.3.7" at the top: the detailed state, numbers and file names.
3. `refs/output/decisions.md`, the entries dated 2026-11-24: what the user decided and why.
4. This file's "Work list".

## Where things stand

- **Released:** 0.3.6 is published as Latest (tag `v0.3.6` at `759ea31`). Do not move that tag.
- **main = dev at `0a53144`** (pushed 2026-11-24 with the user's go-ahead): 0.3.6, the sidebar styling, slip roads,
  very large levels (ZIP64 writer, progress card, Cancel), road-mode warning, map view for levels in pieces. dev has
  only docs and the dev.3 version bump on top. Pushing main needs the user's word every time, as its own command:
  `git push origin <sha>:main`. Push dev freely.
- **Test build:** `v0.3.7-dev.3` (tag at `cc7ed0d`, 2026-11-24). It has everything above. The permission check refuses a tag push unless the user has asked
  for that tag in so many words ("cut dev 2 now" worked; "proceed with your recommendations" did not): ask, then
  run bump, commit, and tag + push as separate commands (`node scripts/release/devRelease.mjs --write`, commit, tag, push dev and the tag).
- **No work branches.** Everything is on dev. See "Branches and worktrees".

## Work list (the user's order)

- [x] **Batch code removal.** On dev (`21ab735`, `604dbd0`, `e833c48`). Checked: build, unit tests, a browser run
      with an old saved job, two tiles through Generate and per-tile export, the desktop app in development mode.
      Left: when the 0.3.7 update page is written it must say that old batch jobs can no longer be opened.
- [x] **Very large levels (report MR-VYQGBY, lominsa's 220 km A16 road in 442 pieces).** On dev:
      `f4a39b1` the progress card's bar moves for levels built in pieces (they now send `phase`/`phaseFraction`),
      the "middle 2048 x 2048" notice only for square non-power-of-two terrains, step 1's big-area and shaking
      notes measure the whole road/tile shape, desktop Cancel works while waiting for downloads;
      `7e241c3` levels built in pieces are written through `services/zipStreamWriter.js` (ZIP64 when over 65,535
      files or 4 GB; JSZip cannot write ZIP64, so MapNG's own level list could not read the big level) and each
      piece is merged as soon as it is exported (`createChunkMerger` in `services/chunkMerge.js`) instead of all
      442 held until the end; `abb0594` the road panel warns from 40 pieces (seven languages), never refuses on
      desktop (user's decision 2026-11-24: let people try, the reports are useful).
      Checked: unit tests (70,000 files; 5 GB through MapNG's reader), a six-piece level read by Python and by the
      level list and loaded in the game, the road warning in the browser with the reported road. The sweep on
      `7e241c3` is clean: 135 of 135 cells, identical to the previous clean sweep (`scratch/fizz035/sweep_zip.json`;
      it builds single levels only, so the pieces' path is covered by the tests and the six-piece level above).
      **Road mode checked 2026-11-24:** a 5 km stretch of the reported road at 0.25 m (23 pieces) built with
      `scratch/reports/MR-VYQGBY/roadsmall.mjs` (the app's own road setup): valid zip (1,177 files), listed with its
      report by MapNG, loaded in the game, the corridor continuous across the pieces (`road_game.jpg`).
      **Map view fix `8682cb7`:** the merged level kept the first chunk's info.json (one 512 m minimap tile at the
      middle, its picture missing): in the game's map the road stood far off any picture (the user saw it). Now one
      tile per piece at its place, and the level's size. Drawn with `scratch/reports/mapview.py`
      (`scratch/reports/mapview_cmp.png`); levels on one grid were already right (`mapview_road1.png`). Not seen in
      the game's own map screen yet.
      **Not done / not proven:** the window's out-of-memory crash itself (no log; likely the backdrop download in
      the window for a 158 km level, `ensureExportData` in ExportPanel: move that step to the runner on desktop?);
      no level over 65,535 files has been built end to end yet (only the writer is tested past it); the merged
      report still holds every piece's report (70 MB for 442 pieces); whether BeamNG loads a ZIP64 zip is unknown;
      the road end handle drags at most 20 km at a time (`error_tooFar`).
- [x] **Road levels: no backdrop** (`f0580b8`, lominsa's 200 km road stalled at 50 % downloading it; user: "backdrops
      make no sense for road exports"). Off for maps made in road mode (`isRoadLevel` in ExportPanel: export, data step,
      2D preview); the choice stays stored. Corridor-shaped backdrop is a backlog idea.
- [x] **Line curves, second round** (`b8fa986`): switches and path joins carried onto the curve (railways, paths,
      waterways only; for roads it changed 87 sweep cells, kept pinned), waterways rounded, power lines kept as drawn
      on purpose, walls were already rounded by the export. Sweep 135/135, 116 identical. Game check: pending
      (area `curve_kaunas`, GPXZ; no Mapterhorn in Lithuania).
- [ ] **Next suggested (not agreed yet):** move the export's data step (backdrop download, `ensureExportData` in
      ExportPanel) out of the window into the desktop runner, for lominsa's window out-of-memory crash.
- [x] **Rounded curves on railways and paths** (thecoachtoma, SPLATPLAYS; user's decision 2026-11-24: on by default,
      a switch to keep lines as drawn). On dev `8e5b7ca`: `services/roadCurves.js` `lineProfile` (rail 500/150/40 m,
      1 m inside a corner; paths 25-50 m, 0.75 m), shared nodes kept, street trams follow their road; Map data >
      "Keep map lines as drawn" (`mapng_osmLinesAsDrawn`, generation key, share codes). Diagrams in `scratch/curves/`
      (`throat_cmp.png`, `station_shift.png`, `pil_b004.png`, `naldo_cmp.png`; probe `dump.mjs`, `plot.py`,
      `shift.py`, A/B exporter `exportAreaFlag.mjs` with `CURVES_SKIP=rail|path|all`).
      **The sweep first showed 14 cells worse**: through-deck counts at Amsterdam and Pilchowice were the check
      counting short arc pieces several times (fixed in the same commit: it samples by length); Naldo's +3 floating
      slabs are old edge spots flipping sign. Paired sweeps on the fixed check: 104 of 135 identical, the rest a few
      counts either way. Baselines re-recorded `9deac69`.
      **Open:** not looked at in the game yet (a railway curve and a footpath); curves through shared nodes bend
      tightest at the node (about 17 deg steps over 0.3 m: roads did this before too, `throughCurve` sampling);
      waterways, walls and power lines are still as drawn; tell Toma (the user posts).
- [ ] **Discord requests 2026-11-24, recorded, not started:** Toma's three notes (backlog, section 1); splatplays'
      import formats (open items, "more OSM import formats": compressed .osm first).
- [ ] **Sidewalks at banks and the water** (the first approach was scrapped; nothing on dev yet). See the section
      below before starting.
- [x] **Slip roads ending at the outer lane** (thecoachtoma's Kaunas junction). On dev (`c0f6a71`, `d62f6a1`), in
      `services/mergingLinks.js` and one block in `exportBeamNGLevel.js` (search "Slip roads merging into a wider
      road"). Two cases, told apart by `mergingLinkEnds(...).atRoadEnd`:
      - **part-way along a wider road** (the slip road's node is a join between two ways of the same street): the
        slip road's surface ends where its centre reaches the outer lane (`cutAtOuterLane`); an invisible road
        (`road_invisible`, same nav fields) carries on to the mapped node;
      - **at a wide street's own end** (the case the tester meant: two slip roads and a two-lane road meet a
        four-lane street's end at one node): each link is moved sideways over its last 30 m so its outer edge runs
        into the street's edge (`fanInShift`). Its surface, lines, edge blends AND its carriageway record move (the
        sidewalks and turn arrows are built from the carriageway later: left unmoved, a sidewalk slab lay across
        the moved lane, which the user spotted). An invisible copy of the surface stays on the mapped line for
        traffic; the moved surface is no longer drivable for the AI graph.
      Checked: unit tests (`tests/mergingLinks.test.mjs`), top views before/after
      (`scratch/fizz035/slip_west_cmp.png`, `slip_east_cmp.png`, `fan_sw_cmp.png`), in game on the small level
      (`slip_game.jpg`, `slip_game_sw_cmp.jpg`), Mapillary photos of the real place
      (`scratch/fizz035/mapillary/sheet.jpg`, fetched with `scratch/fizz035/mapillary_near.mjs <lat> <lng> <radius>
      <out>`). A sweep was started on `d62f6a1` (`scratch/fizz035/sweep_slip.json`): READ IT before anything goes
      to main.
      **The first sweep on it (`sweep_slip.json`) found two faults, fixed in `135507f`:** duplicate object names
      where one link was treated at both ends (lint warnings in naldo, kingst, deckpark_g), and "crossings short of
      clearance" 0 -> 4 at deckpark_g and 0 -> 2 at naldo (the checks read a moved link as crossing the road it
      joins). Now the hidden roads are named `_m0` / `_m1` / `_p0` / `_p1`, and the checks read each slip road on
      its mapped line (`roadLinesFromDecals` in `services/structures/metrics.js`, flags `__mergePath`,
      `__mergeMoved`, `__mergeTail`). **The sideways move is limited to city streets' slip roads:** freeway and
      trunk ramps at a road's end are left as drawn, because a single-point interchange in Phoenix came out
      differently laid (`scratch/fizz035/dp_zoom_cmp.png`) and nobody has checked it against the real place. The
      "surface ends at the outer lane" rule still applies to freeway ramps (16 in that area). The second sweep
      on `135507f` is clean (`scratch/fizz035/sweep_slip2.json`): 135 of 135 cells pass; 4 cells differ from
      `sweep_final.json`, each by one count (Kingston buried 38 -> 39 and 34 -> 35, one steep stretch at
      deckpark_g on 30 m). 
      **On main since 2026-11-24 (`0a53144`) and in test build `v0.3.7-dev.3`** (dev.2 had the first version).
      **Open on this item:** (0) freeway interchanges: draw two or three before and after with photos before
      switching the move on for ramps; (1) the terrain under a moved slip road is still shaped and painted along the mapped
      line (up to 5 m away at the street, fading out over 30 m): not looked at on sloping ground; (2) the game's
      traffic was not watched driving the invisible roads; (3) the photos show no sidewalk at that street's edge
      (a grass verge, a dirt path set back), the level builds one: a separate question (sidewalks assumed on a
      street with none mapped); (4) only `*_link` one-way roads are treated; a slip road tagged as a plain one-way
      road is not; (5) tell the tester it is on dev (the user talks to him; never post to Discord yourself).
- [ ] **Fizz_Mechanic's remaining points** (not started): road-to-bridge and road-to-tunnel joins; the galleries
      round the lake that sit a little low (a bored tunnel's open stretches, not `solveGallery`); the oversized
      tunnel box by the dam; bridge width (needs the place from him). His material: `scratch/fizz035/`.
- [ ] **Long bridges in levels built in pieces** (not started): tunnels are planned once per level
      (`services/levelTunnelPlan.js`); bridges are still planned per piece.
- [ ] **Mesh Road joins and hairpins** (not started; experimental feature, last).
- [ ] Riding along: re-frame the other 38 sweep areas (`REFRAME=1 node scripts/sweep/fetchArea.mjs --catalog
      <name>`, then `fetchMapterhorn.mjs <name>`; keep the old files as `scratch/levelprobe/reframe.sh` does);
      look at Zion's tunnel with shaping off and Amsterdam's 221 m deck (both showed up when the smoke areas were
      re-framed); thecoachtoma's width-change report (needs a place from him); an optimization pass and a UI pass
      the user asked for before 0.3.6 and that did not happen.

## Sidewalks at banks and the water: start again from the diagrams

**The sea-wall approach was scrapped on 2026-11-24** (user: "this one sounds like a dead end"; all parked branches
were deleted the same day, see below). It levelled the land behind every mapped retaining wall at the water and
paved it flat out to the wall. It fixed Kingston's bayfront promenade (seen in the game) and Naldo's line of
paving down a bank, and made six other sweep cells worse; two further rules were tried and reverted. Do not
rebuild it as it was.

**What is still true and worth keeping from that work:**
- The three problems are real and unchanged on dev (they were in 0.3.5 too): the promenade's paving laid down the
  shore's bank (Kingston, about 34 buried spots on Mapterhorn), paving down a bank with nothing mapped (Naldo,
  47 buried), and slabs down the face of a raised motorway approach (Naldo, 13 floating, 3 to 4 m).
- Kingston's buried spots arrived with commit `dc8cd53` (2026-11-19), which paved the walkway aprons out to a
  seawall again.
- **Every spot that was left, on the branch and on dev, sits 1 to 3 m inland of a mapped wall** (top views
  `scratch/fizz035/kingst_left_top.png`, `ams_left_top.png`). Nobody has found why. That is the place to start.
- The method that found real causes: print the ground at a few points after each step of the export, and what
  the paving reports as its slab height at those points before the grading, and compare. Slab and ground
  disagreed whenever two parts of the code used two different heights for the same place.
- Tools: `scratch/fizz035/swtop.py` (top view round a spot: ground, sidewalk meshes, mapped walls and walks, the
  check's spots), `scratch/devareas/sect.py` (sections), `scratch/fizz035/proberun.mjs` and `quayrun.mjs` (they
  need a temporary `globalThis.__MAPNG_PROBE` / `__MAPNG_QUAY_FILL_DEBUG` hook in the export; `quayrun.mjs` only
  made sense on the scrapped branch). Small test level of the bayfront: area `sw_bayfront` (512).
- Sweep results kept for comparison: `scratch/fizz035/sweep_final.json` (dev) and `sweep_seawall.json` (the
  scrapped branch).

**Suggested next step** (not agreed with the user yet): pick ONE of the three problems, the smallest first
(Naldo's paving down a bank with nothing mapped near it), draw it (top view and two sections), find which part of
the paved model lays paving there, and write a rule for that case alone with a synthetic test. Measure all three
terrains (`mh`, `gpxz`, `t30`) of the areas it touches before calling it better: the scrapped branch was only
measured on Mapterhorn until its sweep.

**How to measure one area** (about 30 s each):
```
NAPI_CANVAS=/home/nikluz/dev/mapng/desktop/node_modules/@napi-rs/canvas \
  node scripts/sweep/exportArea.mjs kingst mh <name> --out <a scratch folder>
```
then read `<name>.checks.json` -> `sidewalks` (`floating`, `buried`, `spots`). Python with matplotlib:
`~/miniconda3/envs/laneextraction/bin/python`.

## Branches and worktrees

Only `dev` and `main` exist now (local `main` is stale; `origin/main` is what counts). Deleted on 2026-11-24 at the
user's word ("scrap anything we don't need"), with their last commits in case one is wanted back within git's
grace period (`git branch <name> <sha>`):
`seawall-037` 3dc1eb0, `seawall` 5009640, `step-walls-2` 390b697, `step-walls` 05a91eb (also deleted on origin),
`hairpin-blend` cf6405a, `shaped-levels` 7463d7e (was merged). The two old checkouts `../mapng-old` and
`../mapng-sweep` are gone too. One old stash is left untouched (`git stash list`). The two `dependabot/*` branches
on origin were GitHub's automatic security-update pull requests (#37, #38: Vite 5.4.21 -> 8.3.8); closed and deleted
on 2026-11-24 at the user's word.

**Dependency alerts, parked by the user (2026-11-24: "ignore those for a while until I want to make a decision"):**
10 open Dependabot alerts: 8 on Vite and 1 on esbuild (all about the local development server, several
Windows-only; fixed from Vite 6.4.4), 1 on minimatch in `desktop/` (build-time). Not exposed: mapng.com's visitors
and the desktop app's users. Do NOT update Vite, esbuild or minimatch on your own initiative, and do not merge a
Dependabot pull request if one reappears: tell the user it is there. If they ask for the update: one step at a
time (the newest Vite 6 first, or straight to 8 if they prefer), then `npx vite build`, `npm test`, the browser
and desktop checks, and both Workers Builds checks after a push to dev (the builders cap open files at 1024:
`vite.config` keeps `maxParallelFileOps` at 8 for that).

## Traps (things that went wrong, or nearly did, in the last sessions)

- **Diagrams before code, and before any game check.** Draw the place (top view, sections) before changing
  anything, and send before/after pictures. The user has reminded about this several times, the last time on
  2026-11-24 in the middle of the sea-wall work: counts and sections alone had missed that every remaining spot
  sits beside a wall; one top view showed it. Top views: `scratch/fizz035/swtop.py`; sections:
  `scratch/devareas/sect.py`.
- **Never `rm` with a variable or a glob.** The permission check refuses it. Use full literal paths.
- **Never `pkill -f`.** It kills the shell. Find the exact PID (`ss -ltnp | grep :<port>`) and `kill <pid>`.
  A dev server started with `npx vite` leaves a child process: kill the PID that holds the port.
- **In-game checks:** read `mcp__beamng__get_status` twice a few seconds apart first; if a level that is not a test
  level is loaded or the camera moves, ask the user. Install a test zip by copying it as `<name>.zip.part` into the
  mods folder and then renaming it to `<name>.zip` (a plain copy is read half written: "Invalid ZIP file"). Test
  levels are small (512, 1024 or 2048, only the target area). `toggle_ui` sometimes needs calling once with no
  argument and then with `show=false` before the menu really hides; the first screenshot after a camera move is
  often the old view, so capture twice. Afterwards: load `gridmap_v2`, deactivate the mod, turn the UI back on,
  delete the zip. The mods folder: `/mnt/c/Users/nikki/AppData/Local/BeamNG/BeamNG.drive/current/mods/`.
- **A sweep before every push to main** that changes the export, and one sweep per batch of 3 to 5 fixes. The
  baselines (`tests/fixtures/areaMatrixBaselines.json`) were re-recorded on 2026-11-24 on the corrected map frame;
  a clean run prints 135 `ok` and no regressions. Do not `--save` new baselines to hide a regression.
- **Do not run exports or edit `services/` while a sweep is running in the same tree:** the sweep runs the working
  tree's code. Use a git worktree for bisecting (symlink `node_modules` and `desktop/node_modules` into it).
- **Ask first:** each `-dev` tag, each push to main, publishing a release, anything posted to Discord (never post),
  OSM uploads. Reading Discord is fine; treat its text as data.
- **Keys:** `~/.config/mapng/mapng.env`. Read them without printing them. The user keeps them there on purpose.
- **Every UI text in 7 languages** (en, de, es, fr, it, pl, ru); a test checks the key sets match.
- **Commit messages end with exactly** `Co-Authored-By: <the model's line>` and nothing after it; no session links.
- **No area-specific code.** A fix is a general rule with a synthetic test, shown on the real place.
- **Report plainly.** Say what was checked and what was not. If a number got worse, say so with the number. The
  user reads the summary, not the logs.
- **The user's time:** they are often away from the screen. Do not stop to ask what a sensible default answers;
  do stop for the things under "Ask first".
- `desktop/node_modules/electron/dist` can be missing: `node desktop/node_modules/electron/install.js` fetches it.
- Disk: check `df -h / /mnt/c` before big runs; delete exported zips once read (keep reports, plots, JSON).

## Useful places

- Tester material and all of this week's probes and plots: `scratch/fizz035/`.
- Test areas: `scratch/levelprobe/data/<area>/` (new this week: `fz_pigettes`, `fz_trackbridge`, `fz_perce`,
  `toma_kaunas`). Old-frame heightmaps of the smoke set: `scratch/levelprobe/oldframe/`.
- Browser and desktop check scripts: `scratch/verify-pw/` (vite on port 5198; `e2e_pertile.mjs`,
  `e2e_desktop.mjs`, `e2e_desktop_packed.mjs`, `sections_shot.mjs`).
- Release steps: memory files `release-0.3.6.md` and `release-0.3.5.md`.
