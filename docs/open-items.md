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

- **Regional look must always make sense (user, 2026-11-19).** The French Alps came out "Utah (high rock and ice)":
  red-rock textures, sagebrush, Utah lamps. Every automatic asset choice (look, textures, trees, rocks, lamps,
  ground cover) has to fit the place from its position and its OSM / land cover. Italy (cypress, olive, palm) and
  East Coast (broadleaf) don't fit the Alps either: needs a mountain look built from what the game has (alpine
  conifers, grey rock, meadow), or per-asset choices instead of one level's whole kit. To do: list what each
  official level offers, pick per climate band and height, test on Tignes, Zermatt, the Rockies, the Andes.
- **2.5 / 3.2 / 3.3 gallery stretches of bored tunnels: DONE on dev 13c9e7b, seen in game.** "Tunnel 43 D902" is way 56684729
  (Les Brévières): Mapillary shows a gallery for its first ~100 m, then a rough-walled bore. We built the arcade as an
  arched tube with openings through to a face plate up to 9 m out ("too thick", "too deep in the mountain").
  Now built as a gallery: a flat roof (5.2-5.9 m, matching the lidar's roof shelf), uphill wall, columns; no
  lights or dark zones in it; a headwall face where it meets the bore; arcades 12 m apart joined; the arcade
  runs on to the end of a stretch standing in the open; ground under it below the floor, squares opened; a valley
  wall down into the ground; the hillside cut 4:1 behind the roof; trees kept off. Shots scratch/fizz033/shots_drv.
  Left: a portal wall panel on the open side where a gallery starts at a portal; old dark triangles by wingwalls.
- **Terrain holes round tunnels: experiments (user, 2026-11-19).** (1) Thicker structures where the holes have
  no clean answer: fill out the concrete (headwalls, lining, walls into the ground) to hide them, above all where the
  holes keep the terrain out of the tube (done for gallery stretches: the valley wall). (2) Boulders or rock assets
  over jagged hole edges, maybe. (3) A finer processing resolution (0.5, 0.25, 0.1 m = the terrain's squareSize):
  smaller squares cut closer holes; try on gt_chevril_full and measure the jagged edge, the export time, memory
  and level size, then maybe recommend it for steep maps with many tunnels. Also seen: the cover made up over a
  bore on a steep valley side runs 1:1 and stops dead at the shaping's reach, a 15-20 m terrain cliff
  (t001 at 285-294 m, scratch/fizz033/diag/g283_sections_wall.png): Fizz 2.4.
- **Processing resolution vs terrain holes: first test done 2026-11-19 (Zion, 2 km, Mapterhorn ~0.95 m).**
  Areas zion2 (1 m), zr05 (0.5 m), zr025 (0.25 m), same bounds and OSM. Export 4.0 / 8.6 / 26.1 s, peak memory
  0.6 / 1.1 / 3.2 GB, level zip 26 / 91 / 337 MB. Hole area outside the structure's outline 101 / 59 / 43 m2
  (scratch/fizz033/diag/holemetric.py); terrain inside the tube 0 at all three. Hole maps:
  scratch/fizz033/diag/zion_west_portal_res.png; in game (scratch/fizz033/shots_res) the grey terrain teeth along
  the west portal's wingwalls are gone at 0.25 m. Finer than the source adds no height detail; grid grows 4x per
  halving, so only small maps (<= 2-4 km) can use it. To try: Axenstrasse (swissALTI3D 0.5 m, a fairer test of
  real detail), and a "steep map with many tunnels: 0.5 m" hint in the app. Covering holes with structure stays
  the default fix. **Axenstrasse done the same day** (Mapterhorn z17 ~0.41 m there: real detail at 0.5 m): export
  5.7 / 11.8 / 28.5 s, peak 1.3 / 1.3 / 2.9 GB, zip 22 / 61 / 211 MB; the four bored tunnels' holes outside the
  outline 14 / 5 / 3 m2, terrain in the tubes 7 / 5 / 3 m2 (clean at 1 m already); in game the terrain teeth
  along the wingwalls at 1 m are gone at 0.5 m (scratch/fizz033/shots_res/sheet_ax_compare.jpg). **Decision (user):**
  structure first; recommend 0.5 m where the grid stays at 4096 px or under: hint in ProcessingResolutionInput
  (data-testid mpp-steep-hint). Found there: the OSM-mapped gallery (4316561, galleryGroundAt) leaves the lidar's
  smeared roof inside its uphill half from 85 m on (~5 m over the road) and fills its valley side up to 15 m over
  the lidar out to 30 m (scratch/fizz033/diag/axen_gallery_sections.png): give OSM galleries the arcade rules
  (ground under the floor, no fill, the retaining wall); its ends read "map edge, no portal" (wrong label, Fizz 3.x). Also seen: Zion's arcade 796-828 m is a flat gallery standing in a cliff notch, bore arches
  showing at its ends (the real tunnel has windows there, no gallery): check the arcade rule on sheer cliffs.
- **3.1-3.3 OSM-mapped avalanche galleries: DONE on dev (2026-11-19), seen in game on the Axenstrasse.** The same build
  as a bore's gallery stretches: floor slab, the squares under it opened, ground under the slab (flush for the last 2 m
  at each end), a valley wall down into the ground instead of the 15 m fill on the lake side; the footprint is the
  tunnel's own (the roads' composition rebuilt the lidar's roof inside it, and a track beside it was laid inside at
  that height: no road surface is composed inside a gallery's height span now); paved-sidewalk grading skips tunnel
  ground (it graded the Axenstrasse gallery's lanes 4 m down); report says "End A (open end)" not "map edge".
  Left: the D 902 crossing over the D 87A's shallow box lower than its roof (clearance 3 m short, Fizz's report).
- **2.4 terrain at tunnel ends (Val d'Isère town portals): partly done on dev (2026-11-19).** Mapillary: its two
  tunnels are rectangular boxes with flush portals; we build them as low boxes (the report called them "Bore": now
  "Low box"). Headwall backfill falls away 1:1 instead of square blocks (64efb9d); low-box headwalls follow the lid's
  ground behind the face, at most their old need + 3.3 m (t002 5.2 / 6.1 m instead of 8.1). Left: t001's south portal
  still juts (its ground is 7 m up); a bright side opening in t001 at 75 % (driver's view); the 15-20 m cover cliff
  beside steep-side bores; Fizz's fz07 cuts.
- **6.1 funicular left on the surface: DONE on dev (2026-11-19).** Rail tunnels use their kind's grade (funicular 100 %,
  tram 9 %, light rail 8 %; roads and main-line rail keep 6 %); a steep rail tube stays under the ground after the
  smoothing and is held to its grade by lowering. The Funival now runs in its tunnel at its real grade (test area
  fz_funival; at 6 % it had been laid 800 m under the mountain where the way met the map edge). Seen in game from
  inside both ways. Left for the portal pass: tall terrain teeth beside its bottom portal at the bridge.
- **2.1 + D902/D87A clearance + 3.5 (one place, 2026-11-19, on dev after this sweep):** the D 87A's 24 m under the
  D 902 by the Tignes dam crosses it at 20 degrees; the lidar took the D 902's deck away and shows the D 87A's open
  trench, the D 902 5 m up on both sides. The low box read its lid from that trench and failed, cut and cover was
  dropped (it would dig 9.5 m), the road was left on the ground and the D 902 crossed 1.84 m over it; with a box
  built, the D 902 was lifted onto a 124 m walled deck (the overlap stretches still asked 6.5 m). Now: a low box
  under a street takes its lid from the street's own ground beside the trench (the highest past the corridor, out of
  the road smoothing's reach), covered 8 m at least; the street over a low box stands on its lid or cover, crossings
  and overlaps alike ask the roof, not a deck's clearance; the crossing check asks a street over a tunnel the roof;
  tunnels' tube and cutting keep the paving out (a curbed slab lay across the lane in the box's mouth). Test area
  fz_d87a (512 m), diagrams scratch/fizz033/diag/d87a_*.png; in game: driver's view both ways clean. Left: the
  portal headwalls stand as tall white blocks over the D 902 (2.1 "portal far too big"): next; a jagged-topped wall
  along the D 87A's cutting north of portal B; castRay goes through terrain holes (probe scans must read the hole
  map: scratch/fizz033/diag/d87a_squares.py).
- **2.6 his problem tunnel with walls alongside: not reproduced on dev (2026-11-19).** The Paravalanche de la Forêt
  (way 30195772, D 87A) is built as a 304 m flat-roofed gallery on columns (the OSM gallery rules), no walled ramps
  in the area (test area fz_foret, 512 m); seen in game from outside and the driver's seat. Ask Fizz to recheck.
- **2.8 wing walls with a gap to the road: on dev after the sweep (2026-11-19).** The block began at the shoulder's
  edge (half + 0.7 m) where the terrain fell away at the road's own edge: a 0.7 m slot, 2 m deep, between road and
  wall, and the parapet on the block's outer edge 3 m out. Now the block starts at the road's drawn edge and the
  parapet stands there; the block's top runs on beyond it over the steep strip. Tignes (gt_tignes, the service
  bridge at (-110, 747)): sections scratch/fizz033/diag/wing_before/after.png, in game scratch/fizz033/shots_wing.
  Then (user, the same spot): the walls at that bridge's end stood across the other roads (Rue de la Poste, its
  little service bridge and a service road crossing it; a garage ramp joined at the bridge's end). The walls' road
  check knew only carriageways (no service roads: their pieces split at a bridge carry no owner) and treated the
  road's own pieces and the next piece through a node alike; it looked only along the line straight out. Now: every
  drawn road's base pieces (keyed by segment, or by OSM way where split), its own road and the one piece carrying
  straight on through each node ignored; a station on another road's pavement gets no wall, and the block's corners
  and middle are checked as well; roads the export does not draw get no walls (the garage ramp).
  Top views scratch/fizz033/diag/wing_top_after*.png. Left: where a wall is left out beside another road (the
  service road's crossing) the fill's steep sides show as teeth: terrainCompose walls the fill before the walls are
  known; give those stations the ordinary slope (needs the wall rule run before the composition).
- **2.3 at the D 902's portal A by Lac du Chevril (2026-11-19, on dev):** the headwall's opening was the bore's arch over a
  gallery stretch's flat roof (the sky through it): a portal whose first metres in are a gallery takes the gallery's
  rectangle. The dark triangles up wingwalls set at a slant to the terrain grid (also the funicular's portal teeth):
  wingwalls are 2 square diagonals + 0.2 m thick (3 m at 1 m), the floor reaching half of it behind the face, so no
  square crosses the face above the floor; beside another road a wall takes what room is left (1.5 m at least,
  wingTAt). The D 87A crossing on the full Chevril map: the street's ground 4.70 m over the box against a 4.70 m roof
  failed by a hair (a 108 m deck); eased within 0.15 m. Sections scratch/fizz033/diag/wingcut_before/after.png, in game
  scratch/fizz033/shots_wing/portal_before_after.jpg. Then: a bridge portal's teeth (the funicular's bottom
  portal over its bridge, dark triangles down the headwall): the ground just behind the face held at the portal's
  floor, headwalls two square diagonals deep. Low boxes fit under the street (user's choice): headroom what the lid
  leaves along the middle, 3.8 m at least (or maxheight + 0.2), the standard 4.2 at most (the D 87A: 3.81 m); a
  street over a low box keeps its surveyed ground and is asked the roof's separation. Deck ends in Val d'Isère
  (bridgetour/ends.py): clean. Left: a long low box's road is a straight line between its portals (Tunnel des
  Téléphériques, 318 m), too high under the street near portal A: Rue du Cocor crosses with a 16.9 % kink (before
  today it went onto a deck there). Next: a long low box's road following the lid at a constant depth, smoothed and
  within grade, ends pinned, as cut and cover's is.
- **Fixed before this list:** the bridgeTowerHouses error (078ff33, after 0.3.3); short bridges too high
  (the bridge rise cap, 957fa96); sidewalks (the paved model).
- **Next:** see the order of work at the top of this section.


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
