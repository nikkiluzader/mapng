# MapNG open items

Last reviewed: 2026-11-19.

The short "now" board: current work, what waits on someone, and checks owed on shipped work. The other tracking
files: `refs/output/backlog.md` holds everything wanted later, by area; `refs/output/releases.md` what shipped;
`refs/output/history.md` finished narratives; `refs/output/decisions.md` choices made and why. Items move between
these files; they are never copied.

## State of the branches

As of 2026-11-19, late:

- `main` and `dev` are at the same commit (bac4f97). Published: 0.3.4 as the latest release. No test build since
  0.3.3-dev.5. The user gave a standing go-ahead to push main as each Fizz list fix lands (sweep reviewed first).
- On main since 0.3.4: Fizz's tunnel and gallery work (below), the D 87A crossing, wing walls, portals; custom
  elevation uploads (coordinate guess, export square, resolution buttons, point cloud layers, the 2D preview's point
  cloud views, smoother point cloud terrain); bug reports with a JSON report and the map data.
- The sweep has two areas BeamNG developers exported (dev_szczyrk, dev_pilchowice) besides tychonas; every area
  one of them exports is added. Its known pre-existing flags: sidewalk drift at naldo, kingst, deckpark_g, stelvio;
  ams_centraal mh/ready; dev_szczyrk cross; ams t30/noshape swBuried.

## Now: Fizz_Mechanic's 0.3.3 list (2026-11-19, in progress)

His 16 km Tignes / Val d'Isère map, 0.3.3, Mesh Roads on. Report and his 24 screenshots: scratch/fizz033 (report_0.3.3.txt,
shots/); re-checks on today's code: scratch/fizz033/run; diagrams scratch/fizz033/diag; Mapillary scratch/fizz033/mly.

**Order of work (2026-11-19, after compaction start here).** Numbers are his (table in the session; shots fzNN in
scratch/fizz033/shots). Test areas in scratch/levelprobe/data: fz_d87a, fz_foret, fz_funival, gt_chevril,
gt_chevril_full, gt_tignes, val_disere. Rules: diagrams first, in game both ways, sweep before each commit, then
push dev and main (standing go-ahead for this list).

1. **A long low box's road follows the lid** (2.3 leftover): the road is a straight line between portals (Val
   d'Isère's Tunnel des Téléphériques, 318 m), too high near portal A: Rue du Cocor crosses with a 16.9 % kink
   (bridgetour/ends.py on val_disere). Lay it at a constant depth under the lid, smoothed, within grade, ends
   pinned, as cut and cover does (solveTunnelAs 'low').
2. **2.4, the rest:** the 15-20 m terrain cliff beside a covered bore on a steep valley side (t001 at 285-294 m,
   scratch/fizz033/diag/g283_sections_wall.png); Val d'Isère t001's south portal juts (its ground 7 m up); a bright
   side opening in t001 at 75 % (driver's view); his fz07 cuts.
3. **2.8 leftover:** where a wing wall is left out beside another road (a service road crossing a raised street in
   Tignes) the fill's steep sides show as teeth: terrainCompose walls the fill before the walls are known; run the
   wall rule first and give those stations the ordinary slope.
4. **Roads on every map** (his "most important"): 1.3 road pieces not joined (offset ends, wedges at junctions and
   bends, 8 shots); 1.6 hairpins (inner wedge, folding over); 1.8 buildings and street lights in the road; 4.3
   sidewalks along mountain-bike trails; 4.4 spikes along road edges; 9.2 terrain edges beside a road wrong (his
   diagram); 9.3 junctions with walls, slabs and tilted pieces; 1.1 narrow roads, corners tighter than the terrain;
   check 1.2 (a curb strip through a roundabout) and 1.5 (up and down under a gallery) on today's code.
5. **Regional look (must-fix, user):** the Alps came out "Utah"; every automatic asset choice has to fit the place
   (see the bullet below).
6. **Buildings:** 4.1 a large building on a lakeside beach and marina (check the OSM footprint); 4.2 a building over
   a portal juts onto the road.
7. **Check on today's code:** 3.5 the D 902 road/gallery/tunnel junction (probably the D 87A crossing, fixed);
   2.7 bridges' heights and shapes; the D 87A box's ends beside the lower road (headroom now fitted, 3.81 m).
8. **Mesh Roads only** (experimental, off by default): 1.4 Mesh and Decal Roads at one height, layers showing;
   1.7 small steps; 7.1 triangles visible in the light; 7.2 a texture layer floating over the Decal Road with Mesh
   Roads hidden; 9.1 a thin band of terrain along Mesh and Hero Road edges (request).
9. **5.1 World Editor:** buildings, sidewalks and lake walls grouped in big blocks; he wants single objects.
10. **Answers owed to Fizz:** 2.2 one continuous road (the solver works that way; the breaks are where it falls
    short); 3.4 OSM tells galleries apart (tunnel=avalanche_protector); 4.5 double chevrons by design; ask him to
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
