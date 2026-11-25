# MapNG open items

Last reviewed: 2026-11-25 (main and dev at the tracking commit after e7fb142; v0.3.7-dev.12; 0.3.6 Latest; test levels 2026-11-25c)

The short "now" board: current work, what waits on someone, and checks owed on shipped work. The other tracking
files: `refs/output/backlog.md` holds everything wanted later, by area; `refs/output/releases.md` what shipped;
`refs/output/history.md` finished narratives; `refs/output/decisions.md` choices made and why. Items move between
these files; they are never copied.

**"H > X"** below means `refs/output/history.md`, section "Moved from open items, 2026-11-25", sub-section X. That
is where each item's full text, numbers and file names now live.

## Branch state

- **main = dev at 0c9381f** (2026-11-25). Desktop test build **v0.3.7-dev.12** tagged. **0.3.6** is Latest (tag
  v0.3.6 at 759ea31).
- No work branches: all parked branches were deleted 2026-11-24 (SHAs in `docs/handoff.md`). Notes below that name
  `step-walls`, `step-walls-2`, `seawall` or `shaped-levels` refer to deleted branches.
- Official test levels re-uploaded 2026-11-25 (manifest 2026-11-25d, built from 04430fa; all five checked through mapng.com; toured in game: placement scenes, splits, forks, sidewalk plots).
- Known sweep flags from before: sidewalk drift at naldo, kingst, deckpark_g, stelvio; ams_centraal mh/ready;
  dev_szczyrk cross; ams t30/noshape swBuried; Michiel de Ruijtertunnel joint steps (check if still the list after
  the 2026-11-24 baselines). H > State of the branches.

## Now

A new session starts with `docs/handoff.md`. Its "Work list" holds the agreed order of the 0.3.7 work and each
item's state. The open items there, one line each:

- **Placement tags (thecoachtoma, Discord 2026-11-25): done on dev, sweep pending.** `services/lanePlacement.js`
  reads placement, placement:forward/backward, :start/:end (transition left to the split rule); the drawn road, its
  graph edges and the painted texture move by it; a lane gain tapers on its own side. Roads level scenes A-E (x 620-950,
  y -60..200). Plots `scratch/toma_placement/{expected,after}.png`; in game 2026-11-25. Left: his Kaunas junctions once
  his placement edits are on OSM (none in the three tj_ areas yet, refetched 2026-11-25); the painted asphalt is not
  tapered at a lane gain (a small dark patch beside the decal's taper); the painter assumes right-hand traffic for
  two-way placement:forward/backward.
- **Carriageway splits: branches start as their share of the trunk (2026-11-25, the user in game on the roads level:
  "the two changes dont blend together at all").** Splits 3 to 2+1 and 6 to 3+3 stepped out, their lane lines jumped,
  pinched and their inner edges crossed. Now each branch starts as its share (its lanes at the trunk's lane width plus
  the trunk's edge strip on its side), widens outward with the seam held, and its lines start on the trunk's
  (carriagewaySplits.js `splitHalfAt`, `splitLaneShiftAt`, `splitEdgeLineAt`). Plots
  `scratch/toma_placement/split_before_after.png`, `forks_after.png`. A first sweep caught gt_chevril (fork skip restored).
- **thecoachtoma's placement round 2 and Splatplays' gauge (Discord 2026-11-25): on dev a1ba6bb + the gauge commit.**
  Tagged widths capped by counted lanes (his 24/28 m Savanoriu pr. bus stop), signal poles off placed roads (18 -> 0 in
  his export), rails at the true gauge (inner faces 72 mm too close). Area `tj_savanoriu_pl` (from his export's map
  data), roads level scenes F and G, `scratch/splat/plot/gauge_before_after.png`. Waiting: test-level upload, dev build,
  main (user's go-ahead).
- **Sidewalks at banks and the water.** Start again from the diagrams; the sea-wall approach was scrapped
  2026-11-24. `docs/handoff.md`, "Sidewalks at banks and the water"; record in H > 0.3.7 and H > Priority list
  (item 10). Done when: no sidewalk sweep cell worse than dev, then in game at Kingston and Naldo.
- **Fizz_Mechanic's remaining points.** Road-to-bridge and road-to-tunnel joins, the galleries round the lake, the
  tunnel box by the dam, bridge width (needs the place from him). `docs/handoff.md`; full lists in
  H > Fizz_Mechanic's feedback on 0.3.5 and H > Fizz_Mechanic's 0.3.3 list.
- **Long bridges in levels built in pieces.** Bridges are still planned per piece. `docs/handoff.md`.
- **Mesh Road joins and hairpins.** Experimental feature, last. `docs/handoff.md`.
- **Ride-alongs:** re-frame the other 38 sweep areas, Zion's tunnel with shaping off, Amsterdam's 221 m deck,
  thecoachtoma's width-change report, the optimization and UI passes. `docs/handoff.md`.
- **Slip roads at the outer lane: five open points** (freeway interchanges, terrain under a moved slip road,
  traffic on the invisible roads, sidewalks on streets with none mapped, plain one-way slip roads).
  `docs/handoff.md`.
- **Toma's three notes** (backlog section 1), not started. `docs/handoff.md`. (Check if still open: the carriageway
  splits work of 2026-11-25 may have covered some.)

**Waiting on the user (0.3.7):**

- Move the export's data step (`ensureExportData`, the backdrop download) out of the window into the desktop
  runner, for lominsa's window out-of-memory crash (MR-VYQGBY). `docs/handoff.md`; H > 0.3.7.
- Tile rotation: feasible but big; suggested as the first 0.3.8 item. `docs/handoff.md`.

**Before the 0.3.7 release:**

- The 0.3.7 page lines: old batch jobs can no longer be opened; the Perth fixes; whatever else lands
  (`public/updates/0.3.7/`).
- The unproven very-large-level points: no level over 65,535 files built end to end; whether BeamNG loads a ZIP64
  zip; the merged report holds every piece's report (70 MB at 442 pieces); the road end handle drags 20 km at most;
  the game's own map screen for a level in pieces. `docs/handoff.md`; H > 0.3.7.

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
- **LAZ uploads:** Toma to check the gap fill on a dev build; a two-sided outlier filter and Kriging left for later.
  H > Before 0.3.5. (Check if still open.)
- **Desktop Cancel report:** the export waited on a surroundings download, where downloads belong at Generate.
  H > Fizz_Mechanic's 0.3.3 list. (Check if still open.)
- **Dependabot:** a minimatch update check failed in /desktop on the 0.3.6 commit, not looked at. H > Priority
  list. (Check if still open.)

## Waiting on someone

- **The user:** run the signed Windows installer (not run here for 0.3.6 or later). H > Priority list.
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
