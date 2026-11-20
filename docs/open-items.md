# MapNG open items

Last reviewed: 2026-11-19.

The short "now" board: current work, what waits on someone, and checks owed on shipped work. The other tracking
files: `refs/output/backlog.md` holds everything wanted later, by area; `refs/output/releases.md` what shipped;
`refs/output/history.md` finished narratives; `refs/output/decisions.md` choices made and why. Items move between
these files; they are never copied.

## State of the branches

As of 2026-11-20 morning:

- `main` = `dev` at e67df2d. A Fizz-list push (the chevrons) carried everything then on dev to main: cul-de-sacs, the
  three sidewalk fixes and the 0.3.5 draft page (unlinked, preview tag, noindex), which were meant to wait for the
  release. Not rolled back (that is a force push: the user's call). Published: 0.3.4 as the latest release; no desktop
  test build since 0.3.3-dev.5; the user plans a dev build mid-day 2026-11-20 and 0.3.5 that evening.
- The sweep's known pre-existing flags: sidewalk drift at naldo, kingst, deckpark_g, stelvio; ams_centraal mh/ready;
  dev_szczyrk cross; ams t30/noshape swBuried; Michiel de Ruijtertunnel joint steps (check 4).

## Now: Fizz_Mechanic's 0.3.3 list (2026-11-19, in progress)

His 16 km Tignes / Val d'Isère map, 0.3.3 (screenshots with Mesh Roads on; the report is a Decal Roads export of the same map). Report and his 24 screenshots: scratch/fizz033 (report_0.3.3.txt,
shots/); re-checks on today's code: scratch/fizz033/run; diagrams scratch/fizz033/diag; Mapillary scratch/fizz033/mly.

**Order of work (2026-11-19, after compaction start here).** Numbers are his (table in the session; shots fzNN in
scratch/fizz033/shots). Test areas in scratch/levelprobe/data: fz_d87a, fz_foret, fz_funival, gt_chevril,
gt_chevril_full, gt_tignes, val_disere. Rules: diagrams first, in game both ways, sweep before each commit, then
push dev and main (standing go-ahead for this list).

2. **2.4, the rest:** the 15-20 m terrain cliff beside a covered bore on a steep valley side (t001 at 285-294 m,
   scratch/fizz033/diag/g283_sections_wall.png); Val d'Isère t001's south portal juts (its ground 7 m up); a bright
   side opening in t001 at 75 % (driver's view); his fz07 cuts.
3. **2.8 leftover.** Step walls are on branch `step-walls` (not on dev, 2026-11-20 morning). services/terrainSteps.js traces
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
