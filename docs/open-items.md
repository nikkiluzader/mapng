# MapNG open items

Last reviewed: 2026-11-24, night (0.3.6 Latest; main = b39ed0e; dev 5026c75; test build v0.3.7-dev.7)

The short "now" board: current work, what waits on someone, and checks owed on shipped work. The other tracking
files: `refs/output/backlog.md` holds everything wanted later, by area; `refs/output/releases.md` what shipped;
`refs/output/history.md` finished narratives; `refs/output/decisions.md` choices made and why. Items move between
these files; they are never copied.

## 0.3.7 (started 2026-11-24, night)

- **Report MR-VYQGBY (desktop crash, read 2026-11-24).** App 0.3.6-dev.5 (c174537), Windows, 16 GB (6.7 free), AMD
  RX 7600. "During export the app crashed." No log, a crash dump. The dump (read with `scratch/reports/dumpinfo.py`):
  exception 0xE0000008, Chromium's out-of-memory, in the window process (renderer), asking for 256 KB: the window
  ran out of memory, not the export runner. Which step it was in is not known (no log).
  The map (`scratch/reports/decode.mjs` on the report's share code): road mode on the A16 motorway in Italy,
  220 km, a 500 m corridor at 0.5 m per pixel, ground as models, satellite texture. Through the app's own layout
  (`scratch/reports/MR-VYQGBY/layout.mjs`): a box of 157.7 x 110.8 km, 107 km² of corridor, **442 pieces**.
  Found on the way: step 1's big-area and "objects shake far from the centre" notes measure one tile's side
  (resolution x m per pixel: 4.1 km here), not the road's or the tiles' whole extent, so neither showed; the far
  ends of this level sit about 78 km from its centre (BeamNG: objects shake past about 30 km). Road mode has no
  limit on length or on the number of pieces. Not changed yet: proposed to the user.
  **Correction and more from the tester's Discord thread (lominsa, shown by the user 2026-11-24):** the export
  panel's "How heavy is this level? Extremely heavy ... Are you serious?" card DID show (158 km across, corners
  111 km out, 16 GB at its peak); only step 1's notes did not. What he saw, run by run:
  - Generate of the 442 pieces took about an hour (25 min in: "Chunk 212 of 442, loading elevation").
  - The road's end handle drags only 20 km at a time (he worked in 50 km steps).
  - First export (0.5 m, backdrop on): stuck on "Preparing / Waiting for the downloads" (the backdrop), Cancel did
    nothing; overnight it did not finish: this crash report. Likely, not proven: the data step (backdrop download
    for a 158 km level) runs in the WINDOW process (`ensureExportData` in ExportPanel), and the dump says the
    window ran out of memory.
  - Second export (1 m): 70 minutes at 0 % on the progress card ("Chunk 208 of 442: generating from the cache")
    while the Windows taskbar bar filled; then it finished, but "The report could not be read" and the level is
    in the mods folder but not in MapNG's level list.
  Causes found in the code (2026-11-24):
  1. **Progress card at 0 %:** the chunked export's progress messages carry `pct` but no `phase` /
     `phaseFraction` (exportBeamNGLevel.js, "Chunk ${p.chunk} of ${p.of}"), and the card draws its bar from the
     phase. The taskbar uses `pct`. Confirmed in code, current dev too.
  2. **Report unreadable, level not listed:** the merged level is written with JSZip, which cannot write ZIP64.
     Tested: 70,000 files give an end record saying 4,466 entries and no ZIP64 record; MapNG's own zip reader
     (`desktop/levelLibrary.js` zipEntries) trusts that count, so it misses the level's info.json / report. Over
     4 GB the offsets would wrap too. Whether this level passed 65,535 files is not verified (likely at 442 pieces).
     Whether BeamNG itself reads such a zip is not known.
  3. **Runner memory:** `services/chunkedExport.js` keeps every finished piece's zip loaded (JSZip) until the merge:
     442 of them.
  4. **Misleading warning:** the heavy-level card says "the level will be the middle 2048 x 2048: 36 % of the
     area ... generate again at 27.051 m/px": it reads the overview's grid, which means nothing for a level built
     in pieces.
  5. **Cancel** does not stop the data step's downloads.
  6. Step 1's notes measure one tile (above).

**A new session starts with `docs/handoff.md`** (the user asked for it 2026-11-24: the next sessions may run on
another model; keep it current, tick items as they finish).

Order agreed with the user: batch code removal, then sidewalks at banks and the water, then slip roads ending at
the outer lane; after those Fizz_Mechanic's remaining structure points, long bridges in levels built in pieces,
Mesh Road joins. Riding along: the other 38 sweep areas re-framed, Zion's tunnel with shaping off and Amsterdam's
221 m deck, thecoachtoma's width-change report, the optimization and UI passes.

- **Done:** the sidebar's sections are cards with a soft orange header and edge (dev and main 8e692fa, the user:
  "that looks amazing"); test build v0.3.7-dev.1 (tag at 677fcc6, both builds and the signing succeeded).
- **Slip roads at the outer lane: done on dev 2026-11-24** (c0f6a71, d62f6a1; thecoachtoma's Kaunas junction, moved
  here from the backlog). A slip road merging part-way along a wider road ends its surface at the outer lane; slip
  roads meeting a wide street's own end (his case, which the user pointed out and annotated) swing out to the
  street's outer lanes over their last 30 m, their sidewalks and arrows with them; the traffic keeps an invisible
  road on the mapped line. Seen in game and against Mapillary photos. Details, pictures and the five open points:
  `docs/handoff.md`. The first sweep found duplicate names and false short crossings (fixed, 135507f; the sideways move
  limited to city streets' slip roads, freeway ramps left as drawn); the second sweep is clean (135 cells pass, 4
  differ by one count each). Test build v0.3.7-dev.2 (c4c99b4) carries the first version.
- **Batch code removal: done on dev 2026-11-24** (21ab735 and a follow-up; 44 files, 7,403 lines out). The panel,
  the progress window, the saved-job path, the desktop app's batch downloads folder and 200 text keys in each of
  the 7 languages are gone; what an earlier version left in the browser (settings, an unfinished job, its download
  cache) is thrown away once at start. `batchShape.js` stays (tiles); `batchExports.js` is now `assetExports.js`.
  Checked: production build, 1,494 unit tests, a browser run with an old saved job seeded (no errors, the keys
  gone), two tiles through Generate and the per-tile asset export, the desktop app in development mode through
  Generate and an export. Follow-up the same night (user: "if we dont need these, lets remove them too"): the stale comments reworded;
  the functions nothing used any more removed with their tests (`snapTileOffsets`, `shapedLayout`, `pixelOwner`,
  `combinedLevelTier`, `terrainFileGB`, `LEVEL_TESTED_MAX_PX`, `cloneRateLimitInfo`, `getGPXZRateLimitInfo`); the
  options the old combined-level path passed into the export read one by one: all of them are the ordinary export
  options the export panel passes too, nothing batch-only to take out. 1,489 unit tests, production build.
  Still to do, when the 0.3.7 page is written: a line that old batch jobs can no longer be opened.
- **Sidewalks at the water: the sea-wall approach scrapped 2026-11-24** (user: "this one sounds like a dead end";
  the branch and every other parked branch deleted, SHAs in `docs/handoff.md`). The three problems stay open on
  dev. What follows is the record of the scrapped branch, for what it found.
- **(record) work branch `seawall-037`** (dev + the parked `seawall` branch, merged cleanly; 1,497
  tests pass). Sidewalk counts on Mapterhorn, dev -> the branch:
  (first numbers: `naldo` buried 47 -> 19, the 100 m line of paving down the bank gone; `kingst` floating 0 -> 58.)
  - **Kingston's promenade: fixed on the branch 2026-11-24 (late).** Two causes, both in how the level reaches
    the paving: the levelled band knew its level only as far in as the top of the bank (two grid points here),
    with the wall's median as the fallback elsewhere, and the mapped walk kept the survey's crest height for the
    half of its width outside the paving's 3 m band. Now every grid point 4.5 m in from a levelled wall has its
    own stretch's level (`LEVEL_BAND_M`, `levelAt` in `quayFill.js`) and a mapped walk's points inside that band
    take it (`onLevel` in `pavedSidewalks.js`). Found with ground probes after each step
    (`scratch/fizz035/proberun.mjs`, `quayrun.mjs`; the probe lines are still in the branch's export: take them
    out before it merges). Sections before / after: `kingst_seawall_sect.png`, `kingst_seawall_sect_after.png`.
    Counts on Mapterhorn, dev -> branch now: `kingst` floating 0 -> 7, buried 34 -> 23; `naldo` floating 18 -> 19,
    buried 47 -> 19; `ams_centraal` floating 30 -> 31, buried 27 -> 32.
  - **The sunken garden: fixed on the branch** (cc90cc4): land whose top lies more than 6 m in from the wall is
    left alone (`TOP_FAR_M`). Counts now: `kingst` 4 / 23 (dev 0 / 34), `naldo` 18 / 19 (dev 18 / 47),
    `ams_centraal` 31 / 32 (dev 30 / 27).
  - **Left on the branch:** Amsterdam Centraal's two new buried clusters at (108, -202) and (88, -206): an
    embankment's 1 in 2 slope levelled out to the wall at its foot (`scratch/fizz035/ams_sw_cmp.png`); tried and
    reverted: skipping banks under 0.6 m per metre (Naldo buried 19 -> 42, Kingston 4 / 23 -> 12 / 34). Single
    places in Kingston at (298, 68), (210, 686), (322, -146).
  - Also on the branch's list from before: the walled sunken garden (210, 686), sidewalks at bridge ends by the
    river wall. Naldo's slabs at the raised motorway approach are untouched by the branch.
  - `quayFill.js` and `gridIndexAt` use rows as H - 1 - r: check against the corrected map frame.
  - **2026-11-24, late night:** the fill keeps off walks and steps that go down the bank (3dc1eb0; little gain at
    Amsterdam); the probe lines are out. In game on a small level (`sw_bayfront`): the promenade flat out to the
    sea wall (`scratch/fizz035/bay_game.jpg`). **The sweep on the branch: 3 cells better, 6 flagged**
    (`scratch/fizz035/sweep_seawall.json`): better `naldo@mh` and Kingston's buried counts on both lidars; worse
    `kingst@t30` (0 / 12 -> 10 / 21), `naldo@gpxz` (17 / 16 -> 22 / 24), `ams_centraal@gpxz` (21 / 25 -> 24 / 39),
    and Kingston's floating count on both lidars (0 -> 4 and 5). Not for dev as it stands. Top views of every
    remaining spot (`kingst_left_top.png`, `ams_left_top.png`, tool `swtop.py`): all of them 1 to 3 m inland of a
    mapped wall. Tried and reverted: points past a wall's end not counted as its water side (no change).
    The full state and what not to repeat: `docs/handoff.md`.
  Done when: a sweep shows no sidewalk cell worse than dev, then in game at Kingston and Naldo.

## Now: test levels (2026-11-24; history.md "Test levels" has what was fixed)

- **State:** the coverage level and the themed roads, structures and terrain levels toured in game after the fixes
  (`scratch/coverage/runs/*2`, 605 shots); every issue the user and the tours raised is fixed on dev, except the
  backlog follow-ups listed in area 5 and 6 (curved water steps, salt pans, bare rock colour, track corners, container
  ribs and church windows, ruins' floor, optional shipped imposters on desktop).
- **Sweep done (2026-11-24, smoke set x matrix, 135 cells):** 27 regressions at first, all from the river channel
  carve and the river-outline fallback; both narrowed (d1d1556); two cells re-recorded with 3 more spikes each in
  carved stream beds under the water (w_amsterdam@t30/ready, val_disere@mh/ready). Logs: scratch/sweep_logs.
- **Shipped (2026-11-24):** main at efc625c, then b39ed0e. The four levels are in the bucket's `test-levels/` with a
  manifest (built from efc625c, checked offline: no missing material or texture), served by /api/test-levels
  (worker/testLevels.js). Desktop: "Download official test levels" in the levels list (into the mods folder, checked
  against the manifest's SHA-256, then listed); web: "Official test levels" in the footer. Tested end to end against
  mapng.com (scratch/verify-pw/e2e_desktop_testlevels*.mjs). Desktop test build v0.3.7-dev.7 (5026c75).
- **To refresh the levels after a change:** re-export with `--fix-stubs` (real reflection files), addLabels, check,
  write the manifest and upload (refs/output/history.md "Test levels" has the steps; scripts/r2.sh).

## Now: the sidewalk test level (user 2026-11-24: "make sure this synthetic test covers every scenario")

- **All its findings fixed 2026-11-24 (in game and in the sweep, 135 cells clean); the level is the fifth official test level.** Fixed: the curb band (texture width), area:highway=pedestrian (parsed, fetched, paved, no grass), water inside a square, cul-de-sac bulbs (decal priority), steps (stepFlights.js), service roads and cycleways with their own sidewalk (flush edge for cycleways, width:sidewalk:<side>, never on a bank), asphalt footways, footbridge ends on a shoreline (the boardwalk). Earlier text kept below as the record.
- **Built and toured once (record).** `scripts/coverage/sidewalkScene.mjs` (suite `sidewalks` of
  testLevels.mjs): 81 plots of 200 m, 319 scenes and walker views covering every rule of the sidewalk builders and the
  past faults (tags, widths, classes, in and out of town, corners, roundabouts, cul-de-sacs, crossings, driveways,
  medians, fronts and lawns, footways, plazas, rail, bridges, the sea, canal, river, lake, hills). Area
  `scratch/levelprobe/data/test_sidewalks_na_east`; export `scratch/sidewalks/out`; plan and overlay
  `scratch/sidewalks/{expected,after}.py` (PLOTS="c,r;..." for close-ups); tour sheets `scratch/sidewalks/sheets`;
  `scratch/sidewalks/aim.py` aims each tour shot down its street (the fixed side views showed only roofs).
  Not yet uploaded or offered for download; not yet a sweep area. Code uncommitted.
- **Found (confirmed in game or in the exported data):**
  1. A grass band along the curb on every town street: the base texture paints a street with the lane layout
     (osmTexture.js getStableTextureRoadWidth, about 6 m for a two-lane residential street) while the export builds it
     with the road width library (9 m curb to curb here); the asphalt decal fades over its outer 2 m, so the green
     shows. Cross-section and marks: 2026-11-24 session (road 8.00 m, curbs at +-4.5 m, texture grey only to +-3 m).
  2. `highway=turning_circle`: the curb ring is built, the road surface is not: grass inside the ring.
  3. `area:highway=pedestrian` is not paved (Plazas: 3 of 3; that outline is not among them).
  4. `highway=steps` comes out as a dirt path, in town too (plots 5,7 and 8,8).
  5. `highway=service` with `sidewalk=both` gets no sidewalks.
  6. A pedestrian square drawn round a dock basin is paved on the basin's floor under the water (paving at
     3.3-3.6 m, water at 5.05 m).
  7. A footway with `surface=asphalt` looks like a light concrete slab (plot 7,4; check the material).
  8. Known, backlog: `highway=cycleway` + `sidewalk=both` builds none.
  To check: the trunk's narrow median (plot 6,3) shows no jersey barrier.
- **Scene mistakes found and fixed on the way:** the dual carriageways were laid out for left-hand traffic and named
  differently (findMedians pairs by name); the roundabout ran clockwise. The check tool did not know game models
  under `assets/` (fixed in check_coverage.py; the front steps' three slate materials are undefined in the game
  itself and draw fine).

## Priority list (2026-11-23, asked for by the user; details in the sections below)

**Where 0.3.6 stands, 2026-11-24 (late):** scope closed by the user. In: Fizz_Mechanic's three targets (funicular
slope, gallery heights, wing walls), earth on track bridge decks, lane lines past merging slip roads, the sweep's
smoke areas on the corrected frame with new baselines. Out, named on the page: the three sidewalk cases, slip
roads ending at the outer lane, batch code removal (first in 0.3.7). Test build v0.3.6-dev.6 tagged at 68d8151 on
the user's word (workflow run 45300857415). That run succeeded; both manifests verify with the app's key.
**Release, 2026-11-24:** the final sweep (135 cells, identical to the baselines) ran on the release code; main =
dev at 759ea31, pushed on the user's word ("Go ahead on main"); both sites' build checks passed and
mapng.com/updates/latest answers 0.3.6; the page is out of draft; tag v0.3.6 pushed (workflow run 45302898420
builds the draft). The draft checked (AppImage checksum and an end-to-end run, both manifests' signatures) and **published as
Latest 2026-11-24 01:18 UTC on the user's word**. Left: the user runs the signed Windows installer; the first
item of 0.3.7 is the batch code's removal (backlog section 0). Seen: a Dependabot check failed on the commit (a minimatch update in
/desktop, its own run; not looked at).

Before the 0.3.6 desktop release:

1. **Desktop app end to end on today's work.** Done 2026-11-23 on b9f6667: the packed Linux app
   (`scratch/verify-pw/e2e_desktop_packed.mjs`, `e2e_desktop_reset.mjs`) and an unpacked Windows build run on Windows
   over its debugging port (`e2e_win_cdp.mjs`, `e2e_win_reset.mjs`; its own data and mods folders, removed after):
   Generate, a BeamNG export saved into the mods folder, no page errors; the progress card lists every finished line
   with nothing cut off; the level's thumbnail is the MapNG card in the app's font; Reset keeps the map by default
   and, unticked, lands on Flagstaff after about 6 s (no location service in Electron); no tabs. Left: the thumbnail
   as the game's level list shows it; the signed installer from the test build (user).
2. **The new release workflow.** Done 2026-11-23: test build v0.3.6-dev.3 (tag at 2c9c488, cut on the user's word)
   ran it for the first time: both builds, `sign-manifest` and `publish-test-build` succeeded; the pre-release
   carries `latest.yml.sig` and `latest-linux.yml.sig`, and both verify with the app's own key (a changed copy does
   not). Left: the user installs the test build (the signed Windows installer has not been run here); an update
   from dev.2 to dev.3 through the app: done by the user 2026-11-23, no issues.
3. **Seams in game on a small level** (only the target area). 2026-11-23 evening: `scratch/frame/seamsmall.mjs`
   builds a 768 x 512 m level of six 512 m chunks round one point of the Oslo corridor in 75 s (small chunks through
   `chunked.size`). It showed three faults where four chunks meet, fixed on dev be7f530 (the keeping chunk's road
   heights preferred, the ground target led by the keeping chunk, a held road never moved by the late blend): road
   ends at different heights 4 -> 0 on it, the big Oslo level unchanged at 2 gutter decals. In game 2026-11-23: the
   tunnel floor runs through the join with no step (4.56 m, 4.53 m either side, on the road line), a driver's view
   through it is clean, and the ground either side of the three joins differs no more often than across lines that
   are not joins. Test levels removed.
   **Found there and fixed (dev): a chunked level loaded every folder once per chunk that listed it.** The merge kept
   each chunk's group line for the same folder; the game loads a folder once per line, so six chunks loaded their
   roads 6 x 6 x 4 times: 135,468 DecalRoads and 228,678 objects for 965 and 1,696, eight minutes for a 768 x 512 m
   level (the same area as one level: 12 s). `dedupeGroups` in `services/chunkMerge.js`; after it 965 roads in 0.1 s.
   This is why chunked levels "took forever to load" (user, 2026-11-23). On main and in 0.3.6-dev.3 the fault is
   still there: wants a push to main and the next test build. Also fixed: a chunked level's name in the game's level
   list was the first chunk's ("name_c0_0").
   Still seen in the data: paths and service roads laid on the ground jump where one chunk has an open tunnel
   cutting and its neighbour has ground over the tunnel (item 7).
4. **Alignment leftovers of the frame change.** Done on dev 2026-11-23: the 3D preview's mesh, the 3D model export
   (GLB / DAE) and everything they stand on the ground read heights where the samples are (`heightAtFraction` in
   `services/mapFrame.js`; they read sample (c, r) at c / (W - 1), up to a sample off); the model export's scale is
   W samples, not W - 1; the preview, the flag and the upload paths (LAZ, ASC, GML, GeoTIFF metadata) use the
   ellipsoid's metres per degree, not a flat 111,320 (0.2 % at latitude 45). Checked: unit tests, a browser run
   through the 3D preview and an export. Left: the sweep's areas re-fetched on the new frame; the retired batch
   job's tile centres (`services/batchJob.js`) left as they are.
5. **Tiles step 2 leftovers.** Part C done on dev 2026-11-23: the 2D preview dims what is outside the picked shape
   and the 3D preview draws only the shape (tiles, a road's corridor, a chunked level's overview; one shared test,
   `footprintTest` in `services/batchShape.js`). Checked in the browser on an L of three tiles
   (`scratch/verify-pw/e2e_shape_previews.mjs`, pictures `shape_2D.png`, `shape_3D.png`). Also done: a wall along the shape's own
   edge in the 3D preview (best quality), and the 3D surroundings switched off for shaped maps with a note.
   Part F done on dev 2026-11-23: a wall 15 m down from the ground's cut edge on every ground-model level (shaped or
   plain; drawn only, no collision; none where a chunk hands over to its neighbour) (`services/groundMesh.js`); a
   building is kept only when every side of its outline is over ground (`services/footprintClip.js`: 34 of them on
   the test L); the base texture, which is the minimap's picture too, painted out outside the shape. Test level:
   `scratch/frame/shapesmall.mjs` (an L of 512 m in Oslo, 46 MB), texture `scratch/frame/shape_texture.png`.
   In game 2026-11-23 (the L test level, loaded in 10 s, removed after): the edge reads as a clean dark wall from
   outside and no building stands over it. The first look showed fine vertical streaks (each column of the wall took
   the ground's colour at the edge); the wall now takes the texture's dark tone just outside the shape. Not looked
   at: the big map's picture in the game's own map view; a plain square ground-model level's rim (it keeps the
   edge's colours, there being no texture past it).
6. **Release page.** Updated 2026-11-24: per-tile export, the tunnel line for the whole level, Reset as it now
   works, the two memory warnings and the 8192 fix, the funicular, gallery and wing-wall fixes with three
   before/after pictures, the "still being worked on" list. Still a draft (noindex). Earlier: 2026-11-23 evening: a road mode picture (US 129), the shape in the 2D and 3D previews, the
   edge wall, the buildings rule and the minimap, the load-time fix, the 3D alignment and upload fixes are on the
   draft. Left: in-game pictures (a tiled level and a road level with the edge wall, the thumbnail in the level
   list), the final fix list; then publish it.

Known and not blocking 0.3.6 (say so on the page):

7. **Long tunnels across pieces of a chunked level.** Done on dev 2026-11-23: every tunnel that lies whole inside
   the level is planned once from the level's overview (`services/levelTunnelPlan.js`: its ways chained, the ground
   at its two portals, the straight grade between them), and where a chunk's grid cuts a tunnel that end takes its
   height from the line (`freeZ` in `beamngTunnels.js`). Before, such an end was "under the ground there": a tunnel
   under a mountain climbed toward the surface (the unit test: 1015 m and rising where the line says 1004 m). The
   neighbours' road heights still make the pieces meet exactly. Oslo test level of 16 small chunks along the E18:
   8 tunnels planned, the cut ends on their lines, no tunnel road steps over 0.72 m (edge lines at one corner).
   Left: no real mountain tunnel has been built end to end yet (the user's road-mode levels through the Alps would
   be the test); long bridges are still planned per piece (a deck's profile is held at the join by the neighbours'
   road heights, its model is cut where the piece ends); a street on a lid over a tunnel trench that lies on a join
   can still dip.
8. **Per-tile asset export from tiles** (the old batch jobs' purpose). Done on dev 2026-11-23: with several tiles,
   step 3's assets have a switch "One file per tile": the heightmap, the pictures, the road mask, the GeoTIFF and the
   .ter are made once per tile, named `_tile1`, `_tile2` (`components/panels/ExportPanel.vue` assetExport, the
   crop helper's own corner option). Checked in the browser on two 512 tiles (`scratch/verify-pw/e2e_pertile.mjs`):
   two files of 512 x 512, each exactly its half of the whole map's. Not per tile: the 3D models (they have their
   own tiling), the GeoJSON (it is the whole map's data), a chunked level (its overview is too coarse). The batch code stays for 0.3.6 (first item of 0.3.7, backlog section 0).
9. **Desktop Generate ran out of memory at 8192 on 16 GB (MR-PM849Z).** Fixed on dev 2026-11-24. Measured with
   `scratch/memprobe/gen_peak.mjs` (the runner's Generate alone, memory read 5 times a second by stage) at the
   report's place and size (Essex, 8192 at 2 m): the peak was 8.65 GB, in painting the three map textures while
   their PNGs encoded together, not in the satellite step the message named. Now 6.97 GB at the same 71 s: on maps
   over 4096 the pictures encode one at a time and each one's canvas is let go once its PNG exists (the job keeps
   the PNG, never the canvas). The message says "close other programs" in the desktop app (it said "close other
   tabs ... or use the desktop app"). New in step 1 on desktop: a line when Generate's need (a table from the probe
   runs, `estimateGenerateMemory`) is close to the computer's memory, past it, or more than is free right now (the
   report had 5.5 of 15.2 GB free). The runner's memory reports carry typed-array bytes too.
   Also 2026-11-24: on the website the export panel says so when a map has 15,000 roads or more (the reports that
   ended with the page gone had 26,000 and 35,000); a job's place is kept with its note, so a report made after
   the page closed says where it was (they said "area: null").
   Not done: the website export's own peak has not been measured on a dense city, so the 15,000 is from the
   reports alone; Generate's floor before the textures is 4.8 GB at 8192 and the game texture's painting adds 1 GB.
10. **Sidewalk drift, jagged terrain from our own steps, sawtooth on steep roads, the sea-wall branch,** and
    Fizz_Mechanic's held list.
    "Sidewalk drift" is the sweep's count of sidewalk spots floating over or buried in the ground, over its stored
    baselines. Asked 2026-11-24 whether the map-frame fix cleared it: partly. `naldo` on Mapterhorn, the same area
    fetched again on the corrected frame: floating 30 -> 17, buried 47 -> 44 (baseline 8 and 2). The sweep's areas
    are still on the old frame; re-fetching them and re-recording baselines is owed.
    **2026-11-24, the smoke set on the corrected frame:** all "ready" cells together, floating 284 -> 252, buried
    351 -> 341. The frame is not the cure. Most of it sits in Kingston (buried, about 35 a cell), Naldo and
    Amsterdam Centraal.
    **Kingston's buried spots traced (2026-11-24):** they arrived in one commit, dc8cd53 (2026-11-19, "the old
    builders removed"): buried 15 -> 42 on Mapterhorn, measured commit by commit on the old-frame data. That commit
    also paved the walkway aprons out to a seawall again. Sections through the four clusters
    (`scratch/fizz035/kingst_sw_sect.png`): each is paving laid down the shore's bank toward the water, 0.1 to
    0.5 m under the ground. So at Kingston this is the aprons, the same ground the `seawall` branch works on, not a
    general drift. What is mapped there: the bayfront promenade's footways (surface=concrete) and retaining walls.
    **Naldo traced the same way** (`scratch/fizz035/naldo_sw_sect.png`): the 29 buried spots are one 100 m line of
    paving down a bank by the water, 0.3 to 0.5 m under the ground, with nothing mapped within 14 m of it (a
    street's own sidewalk or a pocket: not yet said which); the 13 floating spots, 3 to 4 m, are slabs running
    down the face of a raised motorway approach between two bridge decks (ways 559782742, 559782750).
    So "sidewalk drift" is three things, none of them a drift: the promenade (the `seawall` branch), paving down a
    bank, and slabs at a raised approach's face. Amsterdam Centraal: clusters listed, not sectioned.
    Also seen: the game logs "Invalid ZIP file" once when a level's zip is copied into the mods folder while the
    game watches it (the copy is caught half written; it mounts fine a moment later). A test artefact.

Waiting on the user: a second update key pair (optional), so the first can be retired one day.

## State of the branches

As of 2026-11-23:

- `main` = `dev` at b9f6667 (pushed 2026-11-23 evening on the user's word: "go ahead and get main up to date").
  On mapng.com with it, all from 2026-11-23: the exact map frame and the Mapterhorn half pixel, the footprint clipper, the seam
  work (roads rejoined by height, a chunk starting on its neighbours' ground, the neighbours' road heights as fixed
  conditions), road mode's roads-only reads and handles, share codes, the chunked export's hardening, the Reset
  button, the one workflow (tabs gone), the level's thumbnail card, the tiles' anchor, the progress card, the 0.3.6
  page draft. Checked on dev: 1,473 unit tests; the smoke matrix on 9c4df69 (135 cells identical to the
  security-pass sweep) and 18 cells of two tunnel areas again on the seam work (identical); the browser checks
  named under each item; a browser end-to-end run on the dev server (two tiles, Generate, export). Not run before
  the push: the production build end to end, the packed desktop app (the desktop release is separate: priority 1).
- Earlier the same day: `main` = `dev` at e6ee91e (pushed 2026-11-23 on the user's word, after a sweep). mapng.com now carries tiles in
  step 1, road mode, chunked levels and the security pass (worker, pages). The desktop app on users' machines is
  still 0.3.5: the desktop security fixes (updater, switches, permission handler, redirect guard, Electron 44.11.5,
  Node 26.13.1) reach users with the next desktop release. Checked before the push: 1,441 unit tests; the smoke
  matrix, 135 cells, every one identical to the 0.3.5 sweep (scratch/sweep_secpass.json against scratch/sweep_2a.json;
  the ten values over the stored baselines are the same ten as then); web end to end on the production build with
  the content policy on; the packed Linux app and an unpacked Windows build (run on Windows) through Generate and an
  export. Live after the deploy: the app page's policy, `/crash-reports` and `/api/crash/list` gone (404), the
  wording on /security. Not checked: the dashboard's page signed in (behind the user's sign-in), the new release
  workflow (first tag), a signed Windows installer.
  Branches: none parked any more (all deleted 2026-11-24, `docs/handoff.md`).
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
  - **Step 3, first part done on dev 2026-11-23:** the Single tile / Batch job tabs are gone (user's decision,
    repeated 2026-11-23). The app has one workflow. The old batch panel opens only for an unfinished job saved by an
    earlier version, under a bar that says batch jobs are now tiles and offers "Discard the job and leave"; a
    finished job closes it for good. Checked in the browser (`scratch/verify-pw/e2e_notabs.mjs`,
    `e2e_batchleft.mjs`). The summary chips above Generate show the road's or the tiles' own size (they showed one
    tile's), and "No road picked" before a pick.
    Left of step 3: export assets per tile from the tiles workflow (the batch job's old purpose: today step 3 exports
    the whole shape as one); the batch code, its texts and tests removed once that exists; the About and help texts
    (done 2026-11-23: the About window's batch section is now "Tiles and Road mode", and the help, tech and data
    page texts no longer name Batch mode); the stats page's batch counters.
  - Then step 4 (speed for big shapes).

## Now: review of last week's work (2026-11-23), before 0.3.6

- **Code review of tiles, road mode and chunked levels** (user, 2026-11-23; two independent reads of the code plus
  checks here). All of it is live on mapng.com since the main push of 2026-11-23. Findings to fix, by weight:
  - **Alignment (the strict rule).** (1) Chunked: with `pixelEdges` the resampler puts row r at north - r/H
    (`resamplerWorker.js:69-71`) while every reader takes row r as (r+1)/H (`terrainLookup.js`, `groundMesh.js`,
    `roadSnap.js`): terrain one pixel off the map data in y in every chunk. (2) Chunked: the level lattice is
    111320 m per degree (`chunkLayout.js:59`), not the metric projection the unchunked path uses: up to 0.67 % in
    scale, tens of metres over a 23 km road. (3) Road mode: the corridor is rasterised in metres but Generate's
    pixels are linear in lat/lng (`roadCorridor.js`): measured 20 m off at latitude 45 on a 16 km map, 122 m at 60
    on 30 km, so a road can leave its own corridor. (4) Tiles are drawn and centred with 111320 m per degree
    (`App.vue:1056`, `MapSelector.vue:576`) but built in metric bounds: a tile 28 km out is drawn about 190 m from
    where it is built.
  - **Things lost or wrong at edges.** The footprint clipper tests vertices only (`footprintClip.js:68-81`): a line
    crossing with no vertex inside is dropped, a segment spanning a gap is kept whole, a roundabout is split and not
    rejoined. Chunked: generated meshes, sites and signals within 64 px of a seam stay on the ground before the
    blend (`exportBeamNGLevel.js:7940`, the shift samples one row off at `:15096`); a road over two or more seams
    with near meetings stays split and the rejoin ignores height (a street joined to a viaduct above it:
    `chunkMerge.js:102-110`, both reproduced); a building whose middle falls in a core with no footprint is built
    by nobody.
  - **Downloads and other servers.** The chunked export runs a full Generate per chunk with no cache-only switch:
    30 minutes after Generate it downloads again and can mix map data between chunks. Road picking calls the full
    Generate pull per click (every feature in 2.4 km, up to 20 x 20 km per handle drop, a public Overpass query
    with "live servers first"): use the roads-only read (`fetchOsmRoads`), and no picking while generating.
  - **Behaviour.** `followRoad` matches against the last way and has no turn limit (U-turns onto the other
    carriageway, drifts from I 95 to US 1, never passes a roundabout). Routing and the corridor raster run on the
    main thread, three copies of the computed, on every slider tick. A shared road does not come back exactly and a
    pasted one has no size limit. A slow route result overwrites a Clear. No 64-tile cap in the window. Chunked: no
    cancel, no chunk named in an error, a missing minimum height read as 0.
  - **Rules.** Chunk progress texts in the export are English only; the merge's log lines reach no report; the
    seam blend skips silently on a size mismatch; 16384 is written in three places.
  - **Tests.** The new tests cover helpers; nothing runs a two-chunk export and merge, the corridor against the
    real bounds, the clipper on crossings, or a share round trip. The commit messages' checks were by hand.
  - **Unfinished from the plans:** step 2 parts C (previews masked to the footprint), E (drag, desktop, languages,
    game tests), F (edge skirt, buildings at the edge, masked minimap); step 3 (Batch mode retired: its tile grid
    and combined level now duplicate tiles); the chunked list above in "tiles in step 1".
  **Progress 2026-11-23:** the alignment items are fixed at the root for every map (user's decision): one frame,
  services/mapFrame.js; plan and what is left in refs/output/map-frame-plan.md (in-game centimetre check, the 3D
  preview's mesh, the upload paths' local bases, sweep areas re-fetched). Found on the way: every map's bounds were
  8 m wider than the game drew it (1.5 % small at 512 m), and a chunk's ground squares were assigned one row off.
  Also fixed 2026-11-23: the footprint clipper walks every segment (crossings kept, gaps cut, roundabouts whole).
  **Measured 2026-11-23** (scratch/frame: a 512 m Val d'Isère map made by the real Generate, its heights against the
  source tiles read by separate code, shift_check / offset_check / blocks_check, plot frame_before_after.png): 0.3.5
  had the terrain up to 5.5 m from where the game draws it (stretched outward: the 8 m of padding, the (W - 1)
  spans); now 0.000 m everywhere. The check also found the Mapterhorn source (the default) read half a source pixel
  north-west of its place (its tiles' origins were given as pixel middles and the resampler added the half pixel
  again: 0.4 m on 1 m lidar, about 10 m on the 30 m data at zoom 12): fixed in services/mapterhorn.js.
  In game the same day (untouched terrain, level removed after): 961 points of the game's own terrain height are
  0.0 cm rms from the source at their real positions (worst 0.1 cm), and 473 road points lie on OpenStreetMap's
  lines (median 0 cm, worst 6 cm; a square off would read 62 cm).
  **Seams, 2026-11-23:** the rejoin now needs the two ends at one height (0.5 m), joins only a unique pair (a
  junction on a seam stays) and runs until nothing is left (a road over several seams becomes one). A chunk now
  starts on its finished neighbours' ground before anything is built. Measured on a new test level (a 5 km corridor
  through Oslo at latitude 60, scratch/frame/road60.mjs, 5 chunks, no downloads at export): with the terrain
  untouched the later blend moves nothing; **with shaping on it still moves points by up to 10.9 m (22,659 over 5 cm
  in one chunk)**: each chunk's structure solver sees its own cut of the road network and grades bridge and tunnel
  approaches differently from its neighbour. Sidewalk and rail models built before that blend stay on the earlier
  ground. Open: the neighbour's finished ground and road heights as fixed conditions for the next chunk's solver
  and shaping (not a late blend). Until then a chunked level in a city with structures near a seam is not right.
  **Road mode, 2026-11-23:** picking reads the roads alone (`fetchRoadFeatures`), not Generate's whole pull: a
  2.4 km click box in 220 ms, a 4 km route read in about 90 ms, the route itself 3 ms (I-95, browser). Following
  matches the picked road (no drift through a shared number), never turns back (FOLLOW_MAX_TURN 100 degrees) and
  passes through roundabouts. A handle now routes from where it was (it started at the far end of the whole
  followed road: a line out and back) and slides back along the line at any zoom (user, 2026-11-23: "i cannot drag
  it backwards"; checked: 5.21 km dragged back to 3.02 km). An area already read is not read again. No picking
  while a job runs; a slow answer no longer overwrites a Clear; Generate is off until a road is picked; one shared
  corridor computation, the width slider settles first. Not done: routing in a worker (3 ms: not needed).
  **Also 2026-11-23:** share codes carry a road's stretch with its ends exact and refuse hostile roads; 64 tiles
  at most in the window, Together re-places free tiles, stored road and tiles checked. Chunked export: the cache's
  map data is never "too old" for an export (the desktop cache aged it out after 30 minutes and later chunks got
  today's roads), an error names its chunk and step, a cancel stops between chunks, a missing lowest height stops
  the merge, the level's report is the merge's own lines plus every chunk's report (it was the first chunk's),
  the three progress lines are in 7 languages. Checked: the Oslo level again, 109 s, no downloads.
  **Sweep, 2026-11-23 (read the same day):** the 135-cell matrix on dev 9c4df69 gives the same numbers in every cell
  as the security-pass sweep (`scratch/sweep_frame.json` against `scratch/sweep_secpass.json`: no cell differs; the 10
  flags against the older baseline are the same 10 in both). What it does and does not show: the sweep's stored areas
  keep their own bounds, so it shows the export itself did not change; the frame change is covered by the direct
  checks above, not by the sweep (the areas still need re-fetching on the new frame).
  **Seams with shaping on, 2026-11-23 (afternoon), not yet committed to main:** a finished chunk hands its solved road
  heights on (`services/chunkSeamRoads.js`); the next chunk's solver holds its stations at them where the neighbour
  keeps the ground, the tunnel planner takes them as the tunnel's line there (`knownZ` in `beamngTunnels.js`) and
  eases its own line to meet them; the late blend moves only what stands on the ground (a tunnel or deck road and a
  structure's model keep their heights) and never a road where the neighbour has the say. Oslo test level
  (`scratch/frame/seamdump.mjs`, plots `seam_before.png`, `seam_pins.png`, `seam_sections.png`): road ends at one
  place and not at one height 23 -> 2 (the worst 7.20 m -> two gutter decals at one spot), the E18 tunnel's 7.2 m
  step gone, joined pairs 54 -> 77, ground the late blend moves by over 0.5 m in a kept part 3,607 -> 839 points.
  The merge now reports stepped ends with their places. Open: (1) a street on a lid over a tunnel trench that lies
  on a seam (Frederiks gate): the two chunks' ground under it differs by 1.5 to 4.8 m and the blend ramps one into the
  other over 64 m; two gutter decals step there. (2) A chunk that sees only part of a tunnel decides on that part
  (bored or left on the ground) and the next chunk follows where it must: a plan for long structures made once for
  the whole level would end that. (3) In-game look at the two seams on a SMALL level (user, 2026-11-23: test levels
  cover only the target area; the 5 km level took minutes to load).
  **Next, in order:** the sweep on today's export changes; the seam conditions for shaped chunks (above)
  (roads-only read, no picking while generating, follow rules, routing off the main thread); chunked export
  (cache-only, cancel, translated progress, merged report); user reports since 2026-11-22 (user, 2026-11-23: "go
  through any reports sent by users and make sure to fix those too"); tiles step 2 C/E/F; the Single tile / Batch
  job tabs retired (user's decision of 2026-11-20, repeated 2026-11-23); the 0.3.6 release page.
  Done when: each alignment item has a test that fails before the fix; a chunked level and a road level at
  latitude 60 line up with the map data to the pixel; the sweep is unchanged.

## Now: the user's dev notes (docs/dev-notes.md, 2026-11-23)

- **Progress windows cut text off.** Done on dev 2026-11-23 for the progress card both Generate and the export use
  (`components/ui/StageLoader.vue`): the stage's name and every line wrap; all finished lines are kept in a list
  that scrolls and stays on its newest line (it showed the last 4, each cut to one line); the card is up to 40rem
  wide, never wider or taller than the window; the settings list is one column in a narrow window. Checked with
  long lines at 1440, 800 and 420 px wide (`scratch/verify-pw/stage.html`, `stage_shots.mjs`): no element cut off.
  Open: a look during a real export in the desktop app; the "export complete" window and the report dialog were
  not part of this.
- **The level's thumbnail is a MapNG logo and text,** no more satellite image. Done on dev 2026-11-23:
  `generatePreviewBlob` in `exportBeamNGLevel.js` draws a dark 1024 x 576 card (the logo, "MapNG", the level's own
  name, one line under it) in the app's display font; the desktop runner registers the same font file
  (`desktop/runner/browserShims.mjs`). A chunked level's card carries the level's name, not the first chunk's.
  Sample: `scratch/thumb/preview_card.png`. Open: a look at it in the game's level list.
- **An anchor for several tiles.** Done on dev 2026-11-23: with more than one tile an "Anchor" row shows every tile
  and "Centre" as one-click choices (`components/controls/TileLayout.vue`). The anchor is the point that stands on
  the location; picking another one, or adding, moving or removing a tile, never moves the tiles on the map: the
  location moves to the anchor (`composables/useTiles.js` commit, `services/tileLayout.js` anchorOffsetPx /
  tilesFrame's fifth argument / pointAt). It travels in share codes, saved settings and Modify
  (`anchorAt` beside the tiles). Checked in the browser (`scratch/verify-pw/e2e_anchor.mjs`): tile 3 and Centre on
  three tiles, a removal. Open: an anchor at a free point (a click on the map), if wanted; a Generate and an export
  with the anchor off tile 1, in game.

## Now: the 0.3.6 release page

- **Release page draft** (user, 2026-11-23: "we can start building a new release page as we go"):
  `public/updates/0.3.6/`, marked as a preview and not indexed. 2026-11-23 evening: the tiles' anchor, the one
  workflow, roads meeting where pieces join (with the before/after long sections), and a section on the Reset
  button, the progress window and the level thumbnail, with four pictures from the day's checks. Still to add: a
  picture of road mode; pictures of a tiled level and a road level in game (Game texture); the thumbnail as the
  game's list shows it; the final list of fixes. Before the release: remove the DRAFT comment, the preview note and
  `noindex`, and bump `LATEST_UPDATE` in `worker/updates.js`.
- **End to end in the browser, 2026-11-23 evening (dev server, dev 28c4af8):** two tiles added, Generate (33 s),
  2D and 3D previews, a BeamNG export saved: no page errors; the level's thumbnail is the new card in the app's
  font; the level lint gives warnings only. Not run: the production build, the desktop app.

## Now: a Reset button (desktop and web)

- **Reset replaces the desktop's Refresh, and the website has the same button** (user, 2026-11-23). On dev and main
  2026-11-23: `services/resetApp.js`, the button and its question in `components/layout/AppSidebar.vue`, 7
  languages. It clears every `mapng_` setting (tiles, road, masks, sizes, export options) and loads the page again
  in Tile mode with one 1024 tile. Decided by the user the same day: keys, language, theme and sharing choices are
  never cleared; the question shows once a week at most; a checkbox "Keep the map where it is", on by default and
  remembered, keeps the place and zoom (unticked: the location is asked for, else Flagstaff). Off while a job runs.
  Checked in the browser (`scratch/verify-pw/e2e_reset_week.mjs`, `e2e_reset_keep.mjs`) and in the packed desktop
  app. 2026-11-24, from the user's dev notes: Reset also keeps Basic / Advanced, the last output size, "Measure
  road widths" and "Add missing buildings from Overture"; after it Location, Area & detail and the elevation data
  source are open and every other section of steps 1 and 2 is closed (`RESET_SECTIONS`).

## Now: Fizz_Mechanic's feedback on 0.3.5 (forwarded by the user, 2026-11-24)

- **Inventory taken, nothing fixed yet.** The user: "I'm not sure how much of it we can get into 0.3.6 but we can
  take an inventory." His text, point by point, and the screenshots: `scratch/fizz035/feedback_0.3.5.md`,
  `scratch/fizz035/shots/dm01..dm19.png`; video of the Mesh Road joins: youtu.be/lB5vT2Gj1Ss. His map: Tignes, once
  with Mesh Roads, once Terrain Untouched. Test areas already in scratch/levelprobe/data: fz_d87a, fz_foret,
  fz_funival, fz_glattier, fz_hairpin, gt_chevril, gt_tignes, val_disere.
  - **Galleries (avalanche barriers): [10] to [14].** Five points, one family: a roof too high, one too low and
    deep in the ground, one that climbs too fast, one too short, one that ignores the ground in Untouched mode. He
    also shows ones he calls good. Probably one cause in how a gallery takes its height along its length.
  - **Funiculars: [08], [09].** One line follows the ground over it in waves and bulges the terrain over its tunnel;
    he wants one steady slope. Another he says was better before 0.3.5 (a regression to find).
  - **Bridges: [06] width** (keep the road's width, walls outside it), **[16] spikes** (new since 0.3.5, he says),
    **[15]** small bridges solid underneath (he calls it minor).
  - **Joins: [01]** road to bridge and road to gallery. Carried over from the 0.3.3 list (2.4, 9.3).
  - **[02] a tunnel far too big under the roads above it** (the box by the dam; the 0.3.3 list's item 7 said it
    was sound in game: look again from his angle).
  - **[05] a road that narrows for no reason; [07] a wall too wide for the road above it**, cutting the lower road.
  - **[18] the dam:** good in Untouched mode; in normal mode part of its face is dark, rough terrain.
  - **Mesh Roads only: [03] joins that puncture tyres, [04] hairpins.** Mesh Roads are experimental and off by
    default; the 0.3.3 list's item 8.
  - **Unnumbered:** sidewalk slabs tilted at a roundabout and lying across a junction.
  **His three export reports read 2026-11-24** (`refs/fizz_exports`, unpacked to `scratch/fizz035/reports`; notes
  at the end of `feedback_0.3.5.md`): the Perce-Neige funicular is pushed under six dips of the ground and the dips
  filled (his waves and bulge); the Pigettes gallery's end climbs 35 % beside a bridge; every gallery has the same
  5.20 m crown; the Mesh Roads export has 6 stepped joints where the Decal Roads one has none; 584 terrain spikes
  near structures. Nothing done since 0.3.5 touched any of it; `fz_funival` on today's code still ends at 97 %.
  **Agreed for 0.3.6 (user, 2026-11-24):** (1) the funicular's steady slope, (2) gallery heights and the
  gallery-to-bridge join, (3) bridge width and the bridge spikes. The rest after the release.
  - **(1) done on dev, not seen in game.** A steep railway's tunnel is the highest line under the
    ground that only steepens (`steadyUnder` in `services/beamngTunnels.js`). Perce-Neige: grades of 4 to 52 % and
    a 50 % step became 18 % then 28 %, one bend. Probe and plot: `scratch/fizz035/funi_fetch.mjs`,
    `funi_probe.mjs`, `funi_plot.py`, `funi_section.png`. `fz_funival`'s 97 % is the test area's edge cutting the
    tunnel (the end aims at the ground there), not his map.
  - **(2) gallery heights: the main cause fixed on dev, not seen in game.** The survey here kept the
    galleries' roofs; a roof is level across the lanes, so it was read as the road's own bench and the road pulled
    up onto it (Pigettes: a 4.3 m hump in 40 m, 30 % at the ends; his [12], [13], and the join by the bridge of
    [01]). Now a level stretch counts only within 2.5 m of the road carried between the benches already known
    (`GAL_ROOF_SEEN_M`, `solveGallery`); the report says per gallery where its road height came from. New area
    `fz_pigettes` (512): steep stretches on structures 14 to 0. Sections: `scratch/fizz035/pig_before_after.png`.
    The 12 m bridge beside it is now a road on the ground (it was a deck only because of the hump).
    - Open: [10] the D 902's gallery stretches round the lake "a little low and deep in the ground" (a bored
      tunnel's open stretches, another code path: not looked at); [11] "too short" and [14] not matched to a
      gallery by name yet; the other eight galleries of his map not exported one by one.
  - **(3) bridge spikes [16]: part done on dev; bridge width [06]: not reproduced.** Seen in game on a small level
    (new area `fz_trackbridge`, 512, a 10 m track bridge; shots `scratch/fizz035/tb_before_after.jpg`).
    - The "spikes" are the wing-wall blocks at bridge ends (new in 0.3.3, `services/structures/wingWalls.js`): a
      slab 3.3 m out from the road's edge wherever the road stood 0.8 m over the ground beside it. **Changed on dev
      2026-11-24 (the user left the choice to me):** a run of wall is built only where its side is really steep
      (the run's middle station drops 1.2 m within one terrain square), and never under 4 m long. Wall length on
      Mapterhorn, before -> after: `fz_trackbridge` 38 m -> 0, `kingst` 16 m -> 0, `ams_centraal` 75 m in 19 runs
      -> 34 m in 3, `naldo` 1030 m -> 927 m (the tall approaches keep theirs). In game on the small level: both
      track bridges clean, banks as plain ground (`scratch/fizz035/tb_wingwalls.jpg`).
      Not looked at in game: a city's tall approach (naldo) after the change; a second sweep (the checks do not
      measure walls).
    - Width: on this bridge the deck (3.6 m road + 0.45 m each side for the parapets) and the track drawn on it
      (3.96 m) agree, and every bridge way in five Tignes areas has the class of the roads at its ends. His
      picture shows a track about twice the deck's width: needs the place (which bridge) from him.
    - A track's deck was bare concrete (its dirt decal is soft and half transparent). Done on dev 2026-11-24
      (15435de): a deck whose roads are all tracks or unpaved gets a compacted-earth top (`mapng_bridge_dirt`, the
      game's own gridmap dirt texture, ground type DIRT). Seen in game: `scratch/fizz035/tb_dirt_deck.jpg`.
  - **The five easy wins (user, 2026-11-24: do them, sidewalk drift last).** (1) earth on track bridge decks: done.
    (2) sweep areas on the corrected frame: the 15 smoke areas re-framed from their saved rasters
    (`REFRAME=1 fetchArea.mjs --catalog`, `scratch/levelprobe/reframe.sh`; the old heightmaps kept in
    `scratch/levelprobe/oldframe/`), Mapterhorn fetched again; the matrix on them ran twice with the same numbers in all 135 cells, and the
    second run is recorded as the new baselines (2026-11-24). Against the old ones 51 values were worse, nearly all
    small shifts from the ground moving about one sample. Two to look at: `zion` with shaping off now builds its
    tunnel (it was left on the ground), and "spikes near structures" went 0 -> 927 (1 m lidar) and 0 -> 689
    (Mapterhorn), read as the cliffs round the tunnel, not checked in pictures; `w_amsterdam@mh/noshape` longest
    deck 95 -> 221 m, not looked at. The other 38 catalogue areas are not re-framed. (3) batch code removal: moved to the backlog as the first item of 0.3.7 (user's decision). (4) fixes seen in game: the gallery
    and the funicular (new area `fz_perce`, 2048 at 2 m, the whole 3.4 km tunnel: steepest 29.8 %, no filled dips,
    no gallery stretch; inside straight and steady at the lower end and the middle, the ground over it a plain
    hillside; `scratch/fizz035/perce_*.jpg`). (5) the page's in-game pictures: the gallery, the funicular and the track bridge added. The thumbnail: the
    game lists a fresh level with `/levels/<name>/preview.png`, and that file is the MapNG card with the level's
    name (`scratch/fizz035/thumb_preview.png`); the level list's own screen was not opened (the UI state would not
    change by script). A road level's picture in game: still missing (no small road-level builder yet).
  - **Gallery fix seen in game 2026-11-24** (`fz_pigettes` as a 512 level, removed after): from the valley side a
    level roof on its columns, the road straight through; from the driver's seat the road runs in with no rise
    (`scratch/fizz035/pig_game_outside.jpg`, `pig_game_driver.jpg`).
  - **Sweep, 2026-11-24, on b56d02d:** the 135-cell smoke matrix gives the same numbers in every cell as the last
    clean one (`scratch/fizz035/sweep_fizz1.json` against `scratch/sweep_frame.json`); the ten flags against the
    stored baselines are the same ten known ones. The smoke set has no avalanche gallery and no funicular, so it
    shows nothing else moved; the fixes themselves are shown by `fz_pigettes`, the probes and the unit tests. For later: Mesh Road joins and hairpins, the big tunnel box, water under small bridges.

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

## Now: reports since 2026-11-22 (user, 2026-11-23: go through them and fix them)

- **MR-QWXXKH (desktop 0.3.5, 2026-11-22): "Generate does not start"** with a custom elevation file and a custom
  road file (Zwickau, 4 km). Fixed 2026-11-23: with an uploaded elevation file the panel always offered Generate,
  whose key then matched the map on screen, so the click did nothing; and a map data file loaded after a Generate
  was not in the key at all. The panel now asks App.vue's own key builder (`generationKeyFor`), the loaded file is
  in the key, and the "settings changed" notice follows it (it did not know tiles or a road either). Checked in the
  browser: Generate, load a file, the notice appears, Generate runs again. Copies: scratch/reports/r1123.
- **MR-SGQTD6 (desktop 0.3.5, 2026-11-22): the window ran out of memory** (31 GB machine, crash dump only, no
  area or log). Same family as MR-WNMAMX below; nothing to reproduce from. Open with the items below.
- No reports on 2026-11-23 so far.

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
  - (done 2026-11-23: the four secrets are in the `release` environment only, the repository holds none; the Azure
    values were checked to sign in and the signing key to match `UPDATE_KEYS` before the old ones were deleted)
  - (decided 2026-11-23: the keys stay in mapng.env. The user: they are stored locally, never reach the repo, are
    backed up, and may be needed for later security work. Not asked for again.)
  - optional: a second update key pair so the first can be retired (its public half into `UPDATE_KEYS`);
  - (done 2026-11-23: the user signed in to mapng.com/admin after the content policy and cookie change; it loads.)
  - (done 2026-11-23: the `CRASH_ADMIN_TOKEN` worker secret is deleted on both workers; its line in mapng.env
    stays with the others and opens nothing now);
  - (done 2026-11-23: GitHub's immutable releases are on. A published release's files and tag can no longer be
    changed: a release that needs a rebuild gets a new version number. Drafts can still be changed, so the workflow's
    uploads, signatures and checksums go on before publishing, as they already do.)
- **Checked 2026-11-23 with the user's token:** Workers Builds has one trigger per worker (`main` for mapng, `dev`
  for dev-mapng), no other branch builds, no build variables; Access: the admin app covers `mapng.com/admin*` and
  `/api/admin/*` for one address (its cookie now HttpOnly, SameSite Lax), the dev app covers dev.mapng.com for 35
  addresses; the repo has no webhooks and no deploy keys.
  Azure (the user ran `az` in Cloud Shell): the signing identity holds one role, Artifact Signing Certificate
  Profile Signer, on the `mapng` signing account only; its secret `mapng-client-secret` expires 2028-11-16 (replace
  it and the `AZURE_CLIENT_SECRET` secret before then, or Windows tag builds fail).
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
