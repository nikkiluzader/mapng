# MapNG open items

Last reviewed: 2026-11-26 (main = dev; **0.3.7 published as Latest**, tag v0.3.7 at e9de811; test levels 2026-11-26)

The short "now" board: current work, what waits on someone, and checks owed on shipped work. The other tracking
files: `refs/output/backlog.md` holds everything wanted later, by area; `refs/output/releases.md` what shipped;
`refs/output/history.md` finished narratives; `refs/output/decisions.md` choices made and why. Items move between
these files; they are never copied.

**"H > X"** below means `refs/output/history.md`, section "Moved from open items, 2026-11-25", sub-section X. That
is where each item's full text, numbers and file names now live.

## Branch state

- **main = dev at e9de811** (2026-11-26): release 0.3.7 (version, page public, sitemap, LATEST_UPDATE). Workers
  Builds for both passed; mapng.com/updates/latest serves 0.3.7. **0.3.7 published** 2026-11-26 01:58 UTC as Latest
  (refs/output/releases.md). Next: 0.3.8 (sidewalk fixes, tile rotation).
- No work branches.
- Official test levels: manifest **2026-11-26b** (from 7565a3d, sidewalk plot 7,1 in), all five checked through mapng.com
  (checksums match). The sidewalks level's check flags a stairs model with undefined materials (older, backlog 10).
- Sweep: 135/135, identical to the previous run, on 0077197 (the release code).

## Now (0.3.8)

A new session starts with `docs/handoff.md` ("Work list").

- **Sidewalk fixes (0.3.8 target; the user chose all three, 2026-11-26).** Their St. Augustine level
  (`scratch/stagsw/`: user_level.zip, area `st_aug_sw` from its own map data, tools/ for extract, curb check, back
  heights, sections, corner plots, Mapillary fetch; photos in mapillary/). Three faults:
  - (3) **back edges flush: on dev 796e139.** Edges over 10 cm proud 72 % -> 19 %; sections `sect_king.png`, game
    `backedge_game_before_after.jpg`; sweep no failing cell. On the 0.3.8 draft page.
  - (2) **verge between road and a mapped sidewalk: on dev ce9a180.** With (3) the sidewalk sits flush with its verge;
    town roads' edge blends are asphalt into grass only (no random dirt), concrete roads have no blend. Ponce de Leon
    Blvd before/after `verge_game_before_after.jpg`. Left: a grey strip there from the terrain paint under the verge
    (the base texture's road width, not a decal); the sidewalk 8 cm under the uncurbed trunk road.
  - (1) **corners: on dev 6430ad6.** Rounded corners keep clear of every road (the 1.5 m lean of 00608b7 put a curb
    in King St.'s lane, the user's screenshot); where none fits and only the corner's own two streets are in the way, the
    corner is paved square to the curb (clearing the raster's overreach in it, 2 m back over the sidewalks' ends), never
    round a roundabout or with a road's centre line inside it (val_disere). The export log counts them (St. Augustine
    508: 498 rounded, 8 square, 2 open). Checked against the user's photo of the Lightner Museum corner: the real one is a
    wider apron to the planting beds; ours is a sidewalk-wide L (a wider apron would be a further step, not started).
  - **Scenes: sidewalk test level plot 7,1** (side street jogging into a crossroads, two-width T with a square corner,
    concrete trunk with a mapped sidewalk), checked in game. Official test levels re-uploaded 2026-11-26 (manifest
    2026-11-26b, from 7565a3d), all five checked through mapng.com.
  - Found on the way, not sidewalk work: a hole in the road surface where a street's width steps at a junction (the
    two-width T, 7 to 13 m); St. Augustine's grey strip under Ponce de Leon's verge is the terrain paint.
  Joins "sidewalks at banks and the water", the sidewalk order of 2026-11-24 and the stairs model (backlog 10).
- **Discord feedback after 0.3.7 (2026-11-26), in the order agreed** (the user: "proceed with your recommendations"):
  1. **Stop lines and zebra crossings ignore placement** (thecoachtoma): drawn across the mapped line, not the drawn
     road. Probably the same missing placement shift as the signal poles (a1ba6bb). In progress.
  2. **A sideways shift at a joint does not blend** (thecoachtoma, screenshot + satellite in
     `scratch/discord/2026-11-26/`): the left lane ends as a right lane begins, same width, the road steps sideways with
     grass at the step; the taper only starts on a width change. Ease each edge on its own over a taper run.
  3. **`width:lanes:start` / `:end`** (and `:forward/:backward:start/:end`; thecoachtoma's stats: 6,198 / 3,121 / ~500-1,100
     uses): lane widths blended along the way, as placement:start/end already are. With 2: the joint and lane-width code.
  4. **A guide to manual improvements** (Splatplays): how to tag OSM or fix a level after export. Scope and place the user's.
  5. **Road mode: more points along the road** (glitter_shitter): keep via points instead of dragging one end handle
     again and again; touching the end handle by accident cleared the road. The user said they would add it.
  6. **"Surrounding tiles" and "include backdrop" together crashed a computer** (recklessandfeckless): to reproduce
     (which build, web or desktop, map size).
- **Tile rotation on the 2D map (0.3.8 target).** Rotating the tiles in step 1 (backlog 0 and area 1, thecoachtoma's
  rotated box). Big.
- **Carried from 0.3.7** (`docs/handoff.md`): Fizz_Mechanic's remaining points (road-to-bridge/tunnel joins, lake
  galleries, the dam's tunnel box, bridge width: needs the place); long bridges in levels built in pieces; slip roads
  at the outer lane (five points); Mesh Road joins and hairpins; the ride-alongs. Toma's notes of 2026-11-24 (a)
  road smoothing beside another ground road, (b) smoothing under paths (backlog area 1).
- **Left from the 0.3.7 street work** (backlog): Toma's Kaunas junctions once his placement edits are on OSM; painted
  asphalt not tapered at a lane gain; the painter assumes right-hand traffic for two-way placement:forward/backward;
  the 16 m Savanoriu piece widens over a short run.

## Housekeeping after 0.3.7

- Dependabot: open alerts on vite (1 high, 7 medium, 1 low) and esbuild (dev tools, not in the app) and minimatch in
  /desktop (medium). Left for after 0.3.7.
- The user: run the signed Windows installer (not run here since 0.3.6).

## Smaller open points from the moved sections

Each was open when its section moved. Detail in the H section named.

- **Test levels:** the other four regions; a test that fails when a tag lacks a plot (`docs/handoff.md`). The
  sidewalk level as a sweep area; the trunk's narrow median (plot 6,3) shows no jersey barrier (check if still
  open). H > Now: the sidewalk test level.
- **Levels in pieces (chunked):** paths and service roads jump where one piece has an open tunnel cutting and its
  neighbour has ground over it; a street on a lid over a tunnel trench on a join can dip (Frederiks gate); no real
  mountain tunnel built end to end yet; a long bridge or tunnel reaching more than 128 m past its piece's core is
  cut. H > Priority list (items 3 and 7), H > Now: review of last week's work, H > Now: tiles in step 1.
- **Chunked on desktop:** downloads saved with the project (Modify), memory measured, the 23 km road end to end in
  game; the per-chunk prefetch at Generate runs the whole Generate (a downloads-only pass would halve it).
  H > Now: tiles in step 1. (Check if still open.)
- **Tiles plan:** step 4 (speed for big shapes); the stats page's batch counters. `refs/output/tiles-plan.md`;
  H > Now: tiles in step 1. (Check if still open.)
- **Code review leftovers:** no test runs a two-chunk export and merge, the corridor against the real bounds, or a
  share round trip; the seam blend skips silently on a size mismatch; 16384 is written in three places. H > Now:
  review of last week's work. Map-frame leftovers: `refs/output/map-frame-plan.md`. (Check if still open.)
- **Shaped levels:** not looked at: the big map's picture in the game's own map view; a plain square ground-model
  level's rim. H > Priority list (item 5).
- **App look checks:** the progress card during a real desktop export, and the "export complete" window and report
  dialog; the thumbnail on the game's level list screen (preview.png itself checked); an anchor at a free point (if
  wanted) and an export with the anchor off tile 1, in game. H > Now: the user's dev notes.
- **Memory:** the website export's peak never measured on a dense city (the 15,000-road warning comes from the
  reports alone); window out-of-memory reports MR-SGQTD6 and MR-VYQGBY have no log. H > Priority list (item 9),
  H > Now: reports since 2026-11-22, H > Now: crash reports.
- **Sidewalk drift traced to three causes;** Amsterdam Centraal's clusters listed, not sectioned. H > Priority list
  (item 10).
- **Fizz 0.3.5, beyond the handoff's list:** [11] and [14] not matched to a gallery; the other eight galleries not
  exported one by one; [05] a road that narrows, [07] a wall too wide; [18] the dam's dark face in normal mode; [15]
  small bridges solid underneath; sidewalk slabs tilted at a roundabout; wing walls at a city's tall approach (naldo)
  not seen in game; Zion's "spikes near structures" 0 -> 927 not checked in pictures; a road level's picture in game.
  H > Fizz_Mechanic's feedback on 0.3.5.
- **Fizz 0.3.3, still listed:** 2.4 (cliff beside a covered bore, t001's south portal, side opening); 2.8 Rue de la
  Poste lifted by a driveway apex pin; item 4's road points (1.1, 1.3, 1.6, 1.8, 4.3, 4.4, 9.2, 9.3; check 1.2,
  1.5); 4.2 a building over a portal; 3.5 and 2.7 to look at; item 8's Mesh Road points; 5.1 single objects in the
  World Editor; regional looks for the Andes and Colorado (backlog). H > Fizz_Mechanic's 0.3.3 list. (Check which
  are still open; much of it overlaps the handoff's Fizz item.)
- **Before 0.3.5 leftovers:** hairpin arms whose surfaces touch (a sheer step); steep cut/fill faces on hillsides;
  the road levelling at Generate reaches the export as "survey"; road edges on steep ground (relax the seam);
  sidewalk tilt with shaping off; more jagged-edge examples wanted from the user. H > Before 0.3.5. (Check if still
  open.)
- **The user:** run the signed Windows installer (not run here for 0.3.6 or later). H > Priority list.
- **Toma (LAZ uploads):** check the gap fill on a dev build; a two-sided outlier filter and Kriging left for later.
  H > Before 0.3.5.
- **The user (optional):** a second update key pair, so the first can be retired (its public half into
  `UPDATE_KEYS`). H > Now: security pass 2026-11-23.
- **The user:** post the draft answers to Fizz (`scratch/fizz033/replies_draft.md`), and tell Toma and
  thecoachtoma what is on dev (never post to Discord ourselves). (Check if still open.)
- **The user:** brokenbraincells_ asked (2026-11-20) whether the Game texture paints real tileable materials.
  (Check if still open.)
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
- **Reminder, 2028-11-16:** the Azure secret `mapng-client-secret` expires; replace it and `AZURE_CLIENT_SECRET`
  before then, or Windows tag builds fail. H > Now: security pass 2026-11-23.

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
6. Security pass: the Windows build with fuses not started on Windows; on mapng.com, `/admin` carries the content
   policy and Cloudflare's injected script takes its nonce. H > Now: security pass 2026-11-23. (Check if still
   open.)
