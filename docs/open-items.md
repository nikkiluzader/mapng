# MapNG open items

Last reviewed: 2026-11-23 (security pass: fixed on dev, the user's part listed)

The short "now" board: current work, what waits on someone, and checks owed on shipped work. The other tracking
files: `refs/output/backlog.md` holds everything wanted later, by area; `refs/output/releases.md` what shipped;
`refs/output/history.md` finished narratives; `refs/output/decisions.md` choices made and why. Items move between
these files; they are never copied.

## State of the branches

As of 2026-11-20 night (late):

- `main` = `dev` at d73b5f9: **0.3.5 published 2026-11-20 23:04 UTC as Latest** (tag v0.3.5; notes in
  refs/output/releases.md). It carries the coast / terrain seams / side-slope blend, the point cloud fill, the hairpin
  bends, the movable upload square and the experimental "Ground as models" switch for single exports. Checked: unit
  tests, the smoke matrix (identical to the last committed sweep, 135 cells), web and desktop end to end with ground
  models on, the packed AppImage from the release draft. Not checked: the Windows installer and portable builds.
  Branches: `seawall` (5009640, local: the promenade, for 0.3.6), `step-walls-2` (390b697), `hairpin-blend` (unswept),
  `step-walls` (older, superseded by -2).
- The sweep's known pre-existing flags: sidewalk drift at naldo, kingst, deckpark_g, stelvio; ams_centraal mh/ready;
  dev_szczyrk cross; ams t30/noshape swBuried; Michiel de Ruijtertunnel joint steps (check 4).

## Now: tiles in step 1 (one workflow, any shape)

- **Tiles in step 1 replace the Single tile / Batch modes** (user, 2026-11-20; decision in refs/output/decisions.md).
  Status: steps 1, 2a, 2b and the core of 2c done on dev (25977dc): any-shape Generate and export, the Tiles section,
  tiles on the map, the 3D preview's proportions. Not in a release or test build yet.
  - Whole plan: refs/output/tiles-plan.md (steps 1-4).
  - **Now: the rest of step 2**, planned part by part in refs/output/tiles-step2-plan.md: A the tiled map says what it
    is, B map data clipped at Generate, C previews show the footprint, D share codes / saved settings / Modify,
    E tests (drag, desktop, languages, game), F step 2d (edge skirt, buildings at the edge, masked minimap).
  - **Road mode** (user 2026-11-21): pick a road, follow it, a width either side; plan refs/output/road-mode-plan.md.
    Built after part A-B of step 2 (shared footprint code), alongside C.
  - **Chunked pipeline** (user 2026-11-21, after a 23 km diagonal road was refused): long and diagonal shapes built in
    chunks along the footprint, merged into one level; plan refs/output/chunked-pipeline-plan.md (progress there).
    Status 2026-11-21: works end to end in the app's entry points and on dev (c5aaa71): a road or tiles shape past a
    16384 square is chunked; seams meet exactly, roads joined across, AI drives across. Open:
    - a long bridge or tunnel reaching more than 128 m past its owner chunk's core is cut (the chunk has no data
      beyond its overlap): move the core boundary round it, or a wider overlap where one crosses;
    - the previews show the overview over the whole box (part C: mask to the footprint);
    - desktop: a chunked level's downloads saved with its project (Modify), the app run end to end, memory measured;
    - the 23 km road end to end (web and desktop), in game;
    - the per-chunk prefetch at Generate runs the whole Generate (a downloads-only pass would halve it);
    - the export report is the first chunk's; the merged zip is built in memory (stream it for the biggest).
  - Then step 3 (Batch mode retired) and step 4 (speed for big shapes).

## Now: Fizz_Mechanic's 0.3.3 list (2026-11-19; on hold until after the 0.3.5 release, user 2026-11-20)

Held items are listed on the release page under "Moved to the next release".

His 16 km Tignes / Val d'Isère map, 0.3.3 (screenshots with Mesh Roads on; the report is a Decal Roads export of the same map). Report and his 24 screenshots: scratch/fizz033 (report_0.3.3.txt,
shots/); re-checks on today's code: scratch/fizz033/run; diagrams scratch/fizz033/diag; Mapillary scratch/fizz033/mly.

**Order of work (2026-11-19, after compaction start here).** Numbers are his (table in the session; shots fzNN in
scratch/fizz033/shots). Test areas in scratch/levelprobe/data: fz_d87a, fz_foret, fz_funival, gt_chevril,
gt_chevril_full, gt_tignes, val_disere. Rules: diagrams first, in game both ways, sweep before each commit, then
push dev and main (standing go-ahead for this list).

2. **2.4, the rest:** the 15-20 m terrain cliff beside a covered bore on a steep valley side (t001 at 285-294 m,
   scratch/fizz033/diag/g283_sections_wall.png); Val d'Isère t001's south portal juts (its ground 7 m up); a bright
   side opening in t001 at 75 % (driver's view); his fz07 cuts.
3. **2.8 leftover.** Found 2026-11-20 midday (plots scratch/steps/rdp_long.png, rdp_sections.png, rdp_osm_top.png,
   teeth_vs_wall.png): Rue de la Poste is NOT raised in reality (survey 51 m); the export lifts it 2.5-3.8 m onto a
   ridge because the apex of two short driveways (404256743, 1154846462, joining the street at two junctions) is held
   3.6-4.8 m over the survey, with a generated deck b001 on the driveway. Removing the driveways puts the street back
   on the survey (scratch/levelprobe/data/tgx_drive); removing the garage tunnel's or the passage's tags does not. The
   apex hold is probably a pin (services/structures: shaping.js / rings.js / junctionMouths.js push pins); find which.
   The 1.6 m step walls already cover 99 % of the grid steps in plan, so thicker walls would not help: fix the lift.
   Step walls are on branch `step-walls` (not on dev). services/terrainSteps.js traces
   the 1.5-8 m steps the shaping leaves beside roads, keeping only those not in the survey, straightens them and stands
   them as thick concrete retaining walls. Result at Rue de la Poste (scratch/fizz033/diag/rdp_stepwalls2.jpg,
   plot scratch/steps/tig_steps.png): the lower edge between the bridge ends is walled; the upper edge by the
   buildings and a few teeth remain. At the D 87A the cutting tops lie inside the tunnel's own cut (its wing walls too
   low to hold the ground: a tunnel fix, scratch/steps/d87a_skip.png). Open: why the upper edge's steps go unwalled
   (the road-surface skip?), whether the walls belong in Ready-to-drive maps everywhere (sweep them), and the
   alternative of fixing the shaping to slope instead. Earlier note: (2026-11-20: tried giving the walled fill near a deck's end the ordinary slope on sides with
   another road beside it; no change at gt_tignes (-110, 745): the stepped vertical sides there run the whole raised
   street, not only near the deck, so they come from elsewhere in terrainCompose. In game (scratch/fizz033/diag/
   tigw_sheet.jpg): Rue de la Poste on a shelf, its downhill edge a vertical sawtooth on the 1 m grid with no wall
   over it, the sidewalk's edge jagged with it: the general "vertical fill sides with no wall" fault, to fix with
   item 4's road edges (4.4, 9.2) and the user's sidewalk jagged edges; plot scratch/fizz033/diag/wing_teeth.png): where a wing wall is left out beside another road (a service road crossing a raised street in
   Tignes) the fill's steep sides show as teeth: terrainCompose walls the fill before the walls are known; run the
   wall rule first and give those stations the ordinary slope.
4. **Roads on every map** (his "most important"). All his screenshots are 0.3.3 with Mesh Roads on (his words);
   the report he shared is a Decal Roads export of the same map (D902_0.3.3_decalroads, build 1456410). His own read:
   most road issues come from the Decal Roads' geometry and layout, Mesh and Hero Roads being layers that follow the
   decal paths. So fix them in the shared road geometry, and check each point with both road kinds, on small exports
   of just the spot (512-2048, never the 16 km map); what shows only with Mesh Roads goes to item 8. Sidewalks were rebuilt since
   his build: recheck every sidewalk point (4.3, curbs, 1.2) fresh. Points: 1.3 road pieces not joined (offset ends, wedges at junctions and
   bends, 8 shots); 1.6 hairpins (inner wedge, folding over); 1.8 buildings and street lights in the road (seen too in bt_chicago at (-80, -196): a small building in the
   middle of a junction, scratch/rel035/chi_5.jpg); 4.3
   sidewalks along mountain-bike trails; 4.4 spikes along road edges; 9.2 terrain edges beside a road wrong (his
   diagram); 9.3 junctions with walls, slabs and tilted pieces; 1.1 narrow roads, corners tighter than the terrain;
   check 1.2 (a curb strip through a roundabout) and 1.5 (up and down under a gallery) on today's code.
5. **Regional look (must-fix, user):** done for the Alps 2026-11-20 (the alpine look, history); the Andes and Colorado
   left (backlog). The bigger per-asset plan in the bullet below stays.
6. **Buildings:** 4.1 done 2026-11-20 (the "Base nautique" on Lac de Tignes is tagged building=no: no longer built); 4.2 a building over
   a portal juts onto the road.
7. **Check on today's code** (2026-11-20: the D 87A box under the D 902 checked in game, inside both ways and outside:
   the box, its headroom and the D 902 over it are sound; its approach cuttings' tops are the same vertical sawtooth
   as 2.8's, scratch/fizz033/diag/d87_now_sheet.jpg; 3.5 and 2.7 still to look at): 3.5 the D 902 road/gallery/tunnel junction (probably the D 87A crossing, fixed);
   2.7 bridges' heights and shapes; the D 87A box's ends beside the lower road (headroom now fitted, 3.81 m).
8. **Mesh Roads only** (experimental, off by default, but his chosen mode: worked together with item 4): 1.4 Mesh and Decal Roads at one height, layers showing;
   1.7 small steps; 7.1 triangles visible in the light; 7.2 a texture layer floating over the Decal Road with Mesh
   Roads hidden; 9.1 a thin band of terrain along Mesh and Hero Road edges (request).
9. **5.1 World Editor:** buildings, sidewalks and lake walls grouped in big blocks; he wants single objects.
10. **Answers owed to Fizz** (draft for the user to post: scratch/fizz033/replies_draft.md, 2026-11-20): 2.2 one continuous road (the solver works that way; the breaks are where it falls
    short); 3.4 OSM tells galleries apart (tunnel=avalanche_protector); 4.5 chevrons for both directions now share their posts, back to back (2026-11-20; they stood on a second row of posts beside the first); ask him to
    recheck 2.6 (now a flat-roofed gallery, no walls) and the portals on a new build.
11. **After the list:** a desktop dev build (ask before the -dev tag) and an end-to-end test of everything.

Also open, outside this list: point cloud layers steps 2-4 (trees, building heights, markings from intensity:
refs/output/backlog.md); "Processing resolution" naming (backlog, waiting on the user); brokenbraincells_ asked on
Discord (2026-11-20 01:42Z) whether the Game texture paints real tileable materials (the user to answer).

- **Desktop Cancel did not cancel** (brokenbraincells_, Discord #general 2026-11-20). Screenshot: the export card at
  0 % "Preparing", "Waiting for the downloads... Surroundings: Fetching USGS1M data for tile ...", 2:29 elapsed, with
  the Cancel button. Fixed by the user, not in a release yet: goes in the next desktop build's notes. Open question
  for the user: the export was waiting on a surroundings download, where downloads are meant to happen at Generate.

- **Regional look must always make sense (user, 2026-11-19).** The French Alps came out "Utah (high rock and ice)":
  red-rock textures, sagebrush, Utah lamps. Every automatic asset choice (look, textures, trees, rocks, lamps,
  ground cover) has to fit the place from its position and its OSM / land cover. Italy (cypress, olive, palm) and
  East Coast (broadleaf) don't fit the Alps either: needs a mountain look built from what the game has (alpine
  conifers, grey rock, meadow), or per-asset choices instead of one level's whole kit. To do: list what each
  official level offers, pick per climate band and height, test on Tignes, Zermatt, the Rockies, the Andes.

Finished points of this list and their measurements: refs/output/history.md, "Fizz_Mechanic's 0.3.3 list: what was done (2026-11-19)".

## Before 0.3.5

- **Sawtooth along steep roads** (user 2026-11-20: "roads close to steep edges ... a lot of sawtooth drops"). Probe
  scratch/saw/saw.py (kinks 1 m apart along each road's edge, ready vs untouched). On dev 7db9fe6: side slopes blended
  by nearness (stelvio kinks > 0.6 m 2.77 -> 1.76 %, survey 0.77; in game scratch/saw/shots/stelvio_dev_*.jpg). Left:
  - *a bump in the road at a tight hairpin's apex* (user 2026-11-20; stelvio 912, 438: 1.8 m): the decal is eased
    4.5 m inside a bend tighter than its half width (easeTightNodes, against folding) while the terrain is shaped along
    the OSM line, and its node heights take the nearest station in plan, which flips half at the apex
    (scratch/saw/hairpin_cause.png). Fix: one eased line for decal and terrain (junction nodes pinned), heights by
    distance along the road. In the released code too. Fixed 2026-11-20 night: tight bends eased once for the whole
    export before the solver's graph (mapped nodes kept, shared ones pinned), not again for the decals; stelvio lane
    bumps > 0.3 m 96 -> 9, > 0.6 m 29 -> 0 (scratch/saw/hairpin_fixed.png, hp/hairpin_ba.jpg in game).
  - *hairpin arms whose road surfaces touch*: a sheer step on the grid between them (stelvio shots 4, 6, 7). Branch
    `step-walls-2` (390b697): step walls traced from the terrain cover only parts of it in game (stelvio_ba_*.jpg).
    Next: wall lines from the composer itself (the lower road's core edge where two cores meet on two levels).
  - *steep cut/fill faces on hillsides* rise up to 2 m between neighbours (the blend makes up the hillside's rise too).
    Tried: slopes 1.5x longer (no gain), an offset blend on the survey (worse: carries per-point noise). Open.
  - the steps the app's road levelling makes at Generate reach the export as "survey" (no unlevelled copy kept).
- **Jagged terrain from our own steps** (user 2026-11-20: jagged edges on almost every export, coasts, tunnel mouths,
  cliffs and roads; "the smoothing tool does fix these things really well"). Probe scratch/jag/jag.py (source DEM vs
  untouched vs ready export; jaggedness = |4h - 4 neighbours|), plots there. Findings:
  - *Coast*: the sea floor step (beamngWater.js lowerSeabed) cut 10 m land-cover squares and 0.67 m terraces, and on
    fine data cut the beach below the mapped coastline into a bank. Fixed in the working tree (depth from a distance
    blended between cell centres; on fine data a cell over the water's level is land and the coastline rule takes only
    water-level ground). kingst untouched: points > 0.5 m off their neighbours 1.65 % -> 0.63 % (source 0.10 %).
    kingst_shore_after.png. On dev 7db9fe6 with the seam pass (services/terrainSeams.js): 1.75 -> 0.38 %.
  - *Marsh under the sea's surface*: not the lake beds but the sea step's spread, which set a fixed shallow depth in
    patches (kingst -800, 560). Fixed in 7db9fe6 (the spread takes the same blended depth).
  - *Road edges on steep ground*: the edits' biggest share (gt_chevril -300, 580: bands up to 1.5 m along the graded
    band's edges). Open: relax the seam the way the in-game brush does.
  - *Tunnel mouths*: no heightmap change at the portals (gt_chevril); the jags there are the 1 m hole squares: hide with
    the structure (CLAUDE.md), not smoothing.
  - *The game's brushes* (measured in game, scratch/jag/brushtest.png): "Really smooth (new)" = each point pulled toward
    its near neighbours' average (Gaussian ~1 m), ~0.75 at the centre fading to 0 at the brush edge; "Average Height
    (old)" flattens toward one mean (tilts slopes); "Smooth Slope" evens toward one slope (cut 1.25 m off a cliff edge).
    The engine does these in C++; Lua only sets size/pressure/softness/slope mask (terrainEditor.lua). The Lua
    terraform tool (editor/terraform/terraform.lua, bCDDL: reimplement, don't copy) relaxes the band beside a held road.

- **Sea walls: the promenade behind a wall at the water** (for 0.3.6, user 2026-11-20 night; user 2026-11-20: "bring the pavement out to the retaining
  wall and make sure it's flat"). On branch `seawall` (5009640), not on dev; dev.2 went without it (decisions.md).
  Works at cordova (flat_after.png, in-game shots); sweep regressions left, all at kingst mh (+19 floating):
  - a walled sunken garden (218, 680): the fill flattens the garden floor, its steps' slab stands up to 1.1 m over it;
  - between the inner wall and the sea wall (250, 246): slab 3.13 m over ground 2.72 m, nothing grades it up;
  - two sidewalks at bridge ends by the river wall (306, 60) and (334, -168).
  Where to look: services/quayFill.js, exportBeamNGLevel.js quayLandStrips/quayWaterGround, pavedSidewalks.js landLevel;
  plots scratch/bisect (kingst_two_walls.png, kingst_sections.png, ams_fill.png), scratch/quay (flat_plan/flat_after).
  Already fixed on the branch: inner walls, restore under slabs, band only where the land was raised, far rule gone.
  Done when: a full sweep against sweep_alp.json shows no sidewalk regressions; then in game at cordova and kingst.

- **Release page draft** (user, 2026-11-19): `public/updates/0.3.5/` (marked as a preview, noindex), on dev for
  testers to read ahead. Covers every commit through 2026-11-20 morning (cul-de-sacs, sidewalk paths and edges
  included). Pictures in: cul-de-sacs, sidewalks (corner, suburb, hillside), gallery outside and driver's view,
  funicular, footbridges, the long box under Rue du Cocor, the 0.5 m hint, memory estimate, Send report, point cloud
  UI and ground. One placeholder left on purpose: wing walls (the user: not until the road and terrain round them are
  fixed). At release: drop the preview tag and noindex, add the updates index link (worker/updates.js LATEST_UPDATE),
  notes in refs/output/releases.md. Any main push before then carries the draft to mapng.com/updates/0.3.5/.
- **Sidewalk fixes** (user, 2026-11-20), after cul-de-sacs:
  1. Jagged edges across many levels and situations. Found and fixed 2026-11-20 (history): the lawn-or-paving choice
     made cell by cell (ragged edges, one side paved); a second sidewalk at the curb where one is mapped behind a
     lawn. More examples from the user wanted. Tool: scratch/swaudit/paveddump (dump a tile via the
     `__MAPNG_PAVED_DUMP` hook, plot its cells by rule).
  2. Sidewalks must never tilt sideways: mostly done 2026-11-20 with 3 (the leaning slabs were mostly unpaved paths
     paved on hillsides). Left: terrain shaping off
     still blends the slab onto the ground (tried level across: worse, tall curbs and floating skirts; history).
     Probe: scratch/swaudit/tilt.py (slope across the nearest road; a walk climbing away from a road reads as across).
  3. Done 2026-11-20 (history): only raised walks are paved; an untagged footway out of town or tagged as a trail is
     a dirt path.

- **End-to-end on dev before the dev build** (2026-11-20 morning, dev 4d481e5): web (production build, `vite preview`,
  STUB_PICKER=1: headless Chromium's save window reports a cancel, which since 9afaada stops the export as Cancel
  should): Generate and export 0-100 %, done window, 40 MB written, no errors; the script's "About" and "Data"
  buttons not found (its selectors, not the app). Desktop (development mode): Generate from MapNG tiles and export
  0-100 %, 38.7 MB level in the scratch mods folder, My Levels lists it, no errors. Left for the packaged build:
  Cancel during an export (brokenbraincells_'s report), the AppImage and the Windows portable.

- **thecoachtoma's LAZ upload level is rough** (Discord #general 2026-11-20 13:49-14:44Z; the user: "pretty rough ... let's
  get back to that later"). 10 cm untouched point cloud of a racetrack (nemuno_iedas, Lithuania), Decal Roads. Where the
  scan angle was poor and points are sparse the ground comes out as "a stalactite field"; their idea: treat gaps as the
  average of the nearest points, not 0. They sent the whole level (nemuno_iedas.zip, 830 MB) and four LAZ tiles
  (56_37_11/12/16/17.laz, 84-105 MB each) in #general. Next: fetch the LAZ, rebuild the area, plot the gaps and spikes.
  Update 17:00Z: re-exported interpolated to 0.3 m (new nemuno_iedas.zip, 316 MB, #general): "this actually kinda
  rips", drives fine, still some manual work. So the spikes come mostly from the sparse 10 cm grid; the gap fill still
  worth doing for fine resolutions.
  Fixed 2026-11-20 night (scratch/laz: probe.mjs, run.mjs drives the real worker in Node, footprint_fix.png,
  stalactites_mg.png): the cause was not outliers. (1) Empty cells joined to the grid's edge counted as outside the
  cloud: in sparse ground under trees (1.2 points per m2, 89 % of 10 cm cells empty) the base elevation filled them and
  every point stood as a spike or pit among its heights; now outside = beyond every tile's footprint. (2) The pyramid
  fill relaxed only at full resolution, so a lone point in a wide gap sat at the bottom of a 3-4 m funnel; now each
  level is relaxed on the way down (lazGrid.relaxLevel). A two-sided outlier filter was simulated: 0.1-0.5 % of points,
  no visible gain; left out. Next: Toma checks it on a dev build.
  Toma's recipe (Discord 2026-11-20 13:26-13:30): 1) discard irrelevant classes, 2) prune statistical outliers, 3) a
  Kriging fill (CloudCompare). Ours (lazWorker.js, lazGrid.js): 1) done (ground 2 + water 9 only); 2) weak: only cells
  > 25 m ABOVE their 8 neighbours' median are dropped, nothing low (the likely stalactites); 3) a pyramid fill relaxed
  into a membrane (measured cells kept). Next: a two-sided statistical outlier filter (median/MAD per neighbourhood,
  weighted by point count) before the fill; Kriging only for uploads, later, if the membrane falls short.

## Now: more OSM import formats

- **More file formats for the OSM file import** (SPLATPLAYS, Discord #general 2026-11-21 05:10-05:12 UTC, after
  .osm.pbf and GeoJSON shipped in 0.3.5, commit 393897a). Asked for: Shapefile, "generic pbf", o5m, .osm.bz2/gz/xz,
  obf; and explicitly o5c, osc, osh. Status: not started. Where: services/osmFormats.js (decoders to Overpass JSON),
  services/osmFile.js (format detection, the "not an OpenStreetMap file" message), the format names in 7 languages.
  First take (not checked against the code yet):
  - .osm.bz2 / .gz / .xz: cheapest, a decompress step in front of the existing readers (gzip via the browser's
    DecompressionStream; bz2 and xz need a small decoder);
  - o5m: a compact binary sibling of .osm; a decoder is moderate work;
  - o5c, osc, osh: change and history files, not map snapshots; poor fit for a one-off level import;
  - Shapefile, obf (OsmAnd): other data models; most work.

## Now: crash reports 2026-11-20 to 2026-11-22

- **What is left from the 14 reports since the last review** (2026-11-21; copies in scratch/reports/r1121, R2
  crash-reports/). Fixed the same day (cached buildings, save step, desktop wording, desktop Generate log): see
  history.md, "Crash reports 2026-11-20 to 2026-11-22".
  - **Desktop Generate out of memory at 8192 x 2 m on 16 GB (MR-PM849Z, then a window crash dump MR-WNMAMX, then
    16384 x 1 m MR-NTHDMB; same machine, Essex UK).** The resampler worker died with a bare "Worker error". 8192
    should fit on 16 GB: check the satellite resample's peak with scratch/memprobe at 8192 and lower it if it is
    the cause; log the worker's message.
  - **Website exports die in big cities (MR-A7KRF8 + MR-FYTC2E same area twice, MR-9RGDN8, MR-ZHEMFQ; page closed,
    Chrome/Brave on 16-32 GB; MR-BY8N7H Seattle 16384 x 1 m, Array buffer allocation failed after 22 min).** The log
    tail (90fe27e) shows three during "Building bridge models", one after the terrain shaping, all heavy networks
    (up to 26k roads, 456 km of rail, 6.6 M track triangles). Probably tab memory. Options: measure the web export's
    peak at bridge models on such an area; warn before the export when the road/rail load is past what a tab holds.
  - **Closed-page reports have no area (area null).** Decode the session code into lat/lng/size when the report is
    made.

## Now: security pass 2026-11-23

- **Third security pass: fixed on dev, waiting on main and on the user's part** (user, 2026-11-23: "fix all of the
  issues in your recommended order"). Fixed and tested (1,442 tests; packaged Linux app generated and exported;
  the dashboard page driven under its policy):
  - updater: the first look's checked result is awaited before a second look; the download refuses anything but
    the update that was checked and offered; a test build is refused where test builds are off;
  - Electron 44.11.5, bundled Node 26.13.1, their checksums and the runner packages' recorded in `stage.mjs`;
  - release workflow: read-only by default, token not left in the checkout, Azure secrets only on a tag's Windows
    leg, an unsigned Windows tag build fails, the manifest is signed in a job of its own (`sign-manifest`),
    environments `release` (v* tags only) and `manual-build`;
  - desktop: fuses (run-as-Node off, NODE_OPTIONS ignored, asar only), so the runner starts with `spawn` + a
    message channel, not `fork`; permission handler; the runner's guard judges every redirect;
  - worker: report body read with a cap; a sender's reports a day (20) and stored Mapterhorn tiles a day (40,000),
    counted in the Durable Object's memory only; rate limit on `/api/terrarium` and `/api/worldcover`;
    `crash-reports.html` and `/api/crash/list|file` removed (the alert email links to `/admin.html#<id>`);
  - dashboard: its script is `public/admin.js`, the page is answered by the worker with `adminContentPolicy`;
  - data.html and security.html say the GPXZ key goes by way of mapng.com;
  - GitHub: ruleset "main and dev: admins only" (27899025), Dependabot alerts and security updates on.
- **Left for the user:**
  - move the four secrets from the repository into the `release` environment, then delete the repository ones
    (until then a branch workflow can still read them);
  - take `UPDATE_SIGNING_KEY` out of mapng.env (keep it offline), and make a second key pair so the first can be
    retired (its public half into `UPDATE_KEYS`);
  - after main deploys: delete the `CRASH_ADMIN_TOKEN` worker secret (both workers) and its line in mapng.env;
  - decide on GitHub's immutable releases (a published release could then not be rebuilt in place);
  - the Azure identity's role and its secret's expiry (two `az` commands, given to the user 2026-11-23).
- **Checked 2026-11-23 with the user's token:** Workers Builds has one trigger per worker (`main` for mapng, `dev`
  for dev-mapng), no other branch builds, no build variables; Access: the admin app covers `mapng.com/admin*` and
  `/api/admin/*` for one address (its cookie now HttpOnly, SameSite Lax), the dev app covers dev.mapng.com for 35
  addresses; the repo has no webhooks and no deploy keys.
- **Checks owed:** the new workflow has not run (first tag: watch `sign-manifest`, and that both `.sig` files are
  on the release before a test build is published); the Windows build with fuses has not been started on Windows;
  on mapng.com after main: `/admin` carries the policy and Cloudflare's injected script takes its nonce.

## Waiting on someone

- **The next desktop test build (0.3.3-dev.6)** with the next batch of fixes: ask before the -dev tag (planned after
  the Fizz list, item 11).
- **A BeamNG developer:** whether dev.7 ends the console errors and the low frame rate on a lake-country level.
- **A BeamNG developer:** whether `utcOffset` reads right (it tested correct in game here).
- **The tester who asked about smooth roads:** what he makes of Mesh Roads.
- **Questions for the project owner:**
  - A Performance / Balanced / Quality preset (needs measuring on more than one PC first; backlog area 9, "Export
    quality for weaker PCs").
  - System specs optional in reports, plus the CPU model.
  - Geo data back in Basic mode.
  - Removing the old `osm/` archives from storage.
  - The Base Texture size behind a 2:36 Generate; what was seen with the desktop comparison report; the map size
    where the blend slider lagged.

## Checks owed on shipped work

1. "Extremely heavy" card, the Mapterhorn base tile and the new size selector looked at in the running app.
2. The new 3D model rows (Area, Tiles, Point spacing) in all seven languages.
3. The two sweep areas BeamNG developers exported (dev_szczyrk, dev_pilchowice, added 2026-11-16) have baselines
   recorded as they are, not looked at in game: the dam area shows ground through a deck at 3 places and 5 spikes
   on the coarse survey with Ready to drive, and 4 spikes on the fine one.
4. Amsterdam Centraal after the river-width fix (2026-11-16): the station's island is back on its surveyed ground,
   and the ground now comes through the raised decks in far more places (Mapterhorn Ready 42 -> 323, 30 m Ready
   11 -> 63; baselines re-recorded). Not looked at in game. In 2D (2026-11-16, scratch/devareas/amc_comb.png) the worst
   spots are the road ramps diving under the station: the export cuts the two carriageways to -3 m where the survey
   has one gentle ramp down to about +1 m, and leaves a ridge at +5 m under the deck between them (b019). Needs the
   structure solver looked at for a tunnel approach beside a deck; not fixed.
5. tychonas on GPXZ (30 m there, not lidar): the centre street is still held to its class grade in a trench up to
   6 m deep with toothed sides. By design on coarse data; on the 1 m lidar it follows the hill (checked in game
   2026-11-16). A small deck fragment at the map's east edge (500, -338) is a mess of slabs.
