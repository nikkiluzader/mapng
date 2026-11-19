# MapNG open items

Written 2026-11-14, brought up to date 2026-11-16. The working order of open work, most important first, and the test list for Mesh Roads.
The long backlog with every request and its history is kept outside the repo; this is the short list to work from.

Rule for all road, junction, terrain and structure work: **draw it first.** A top view and long sections of the
place from the solved data, before changing anything, and a before/after of the same place for every fix. Counts
alone have misled this work more than once. Tools are listed at the end.

## State of the branches

As of 2026-11-16, evening:

- `main` and `dev` are at the same commit (099f24f). Published: 0.3.2 as the latest release; 0.3.3-dev.5 as the
  latest test build.
- In 0.3.3-dev.5 since dev.4: mapped traffic signs, billboards, water towers, storage tanks, picnic sites,
  concrete blocks, utility poles and plain monuments; wing walls along raised bridge approaches; bridge towers left
  to the bridge; piers over the water on fine surveys; a waterway no longer measured across the river it joins
  (city blocks beside a big river were dug to the water); tidal water surveyed at two levels drawn as one
  surface; buildings a raised deck runs over held under it; benches looking over the water they stand by.
- On `main` and `dev` but in no test build yet: benches on a pedestrian street look at their street.
- The sweep has two areas BeamNG developers exported (dev_szczyrk, dev_pilchowice) besides tychonas; every area
  one of them exports is added.

## Fizz_Mechanic's 0.3.3 list (2026-11-19, in progress)

His 16 km Tignes / Val d'Isère map, 0.3.3, Mesh Roads on. Report and his 24 screenshots: scratch/fizz033 (report_0.3.3.txt,
shots/); re-checks on today's code: scratch/fizz033/run; diagrams scratch/fizz033/diag; Mapillary scratch/fizz033/mly.

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
- **Fixed before this list:** the bridgeTowerHouses error (078ff33, after 0.3.3); short bridges too high
  (the bridge rise cap, 957fa96); sidewalks (the paved model).
- **Owed answers:** 2.2 continuous roads, 3.4 OSM tells galleries apart (tunnel=avalanche_protector), 4.5 double
  chevrons by design.
- **Next:** the funicular left on the ground (ends 768 m apart: a steep-ends rule for funiculars), wing walls'
  gap (2.8), buildings on roads (ids 1759xxxxx, 1.8), sidewalks on MTB trails (4.3), road joins and hairpins
  (1.3, 1.6), terrain over tunnels (2.4), then the Mesh Roads points and World Editor grouping.

## This week's list (2026-11-15)

All looked at, in game where it needed the game:

1. Hoover Dam towers beside the access road bridge: 10.6 and 11.3 m from its centre line, beside the deck, wires
   several metres over it, as mapped. The deck check now covers a tower's whole base.
2. Benches: seats face away from walls, towards the paths (Bologna, in game).
3. Phantom rails in Poland: no export report yet. Rail trails and closed tram lines fixed from a survey of three
   Polish areas (`scripts/planet/railSurvey.mjs`).
4. Asset catalogue: tag library complete; front direction in the organiser; the 67 "too small" photos: 20 taken
   again framed on what can be seen, 47 are spread-out sets that fill their box (flag cleared, noted).
5. Power towers mapped on their own: stood, no wires.
6. Every road follows the survey on a steep main road: Trollstigen, in game and in the solved data. Sweep: one
   Alpine track (gt_chevril on Mapterhorn) now has short 18.5 to 19.5% stretches (steepGround 28 -> 41); new
   baselines wait on the owner's word.
7. New mapped objects in the 2D preview: confirmed.

Found on the way:

- A waterway relation was built as one open stream with the relation's tags: Bologna's Torrente Aposa, in a
  culvert under the old town, ran across it. Fixed (only multipolygon relations are areas).
- On 30 m elevation, Bologna's Piazza Maggiore is a 20 m hill (the coarse data's buildings) and its paved plaza a
  flat slab: the slab hangs over the low side and the grass hill stands over it on the other. Not fixed.

## Left for later: done 2026-11-16

- Concrete blocks: a block point stands as the game's one-metre cube (off roads drawn for traffic, as bollards);
  lines were concrete barriers already.
- Utility poles: fetched and stood as poles.
- Monuments: obelisks, steles and memorial stones built as plain concrete meshes (services/monuments.js).
- Street trams: the decal now blends over the road (West Coast USA's road_tramline settings, 4 m repeat).
- Also: the groove a footway crossing cut across a road at both its edges (15-20 cm, now about 5 cm); a footway
  climbing beside a bridge deck no longer builds a 6 m earth wall under itself (Jacksonville); billboards, water
  towers, picnic sites and storage tanks from the model picks; mapped traffic signs (batch 2's last part).

Still open from the Jacksonville check (default settings): a ramp's embankment running on under another deck
with half a metre between them (b010, the ground 41 cm into its girders); underwater pits under two river
bridges (not seen, below the water).

## Sawtooth at bridge approaches (2026-11-16, partly done)

Seen in the 20-place check at quays and deck ends (worst in Copenhagen; also Utrecht, Hamburg, Seattle, Norfolk).
What it is, from sections of the built terrain:

- Near a deck's end the terrain gives a road's fill steep sides on purpose ("stands behind wingwalls"), and no
  wall was built: a bare 2 to 5 m drop in two squares, toothed wherever it runs off the grid's axes. **Done:** wing
  walls (services/structures/wingWalls.js), within 15 m of a deck's end. Checked in game in Copenhagen and Utrecht.
- **Open:** the same teeth along a raised approach further than 15 m from its deck, and the trenches left between
  the raised carriageways of one approach (road, cycle tracks: each raised alone, the ground between left low).
  Ideas: carry the walls on while the road stands over the ground and has no room for a slope; fill a gap
  narrower than about 6 m between two raised strips to the lower of the two.
- Not the cause, but fixed on the way: on a fine survey the sea floor stopped at the land cover's 10 m cells and
  left the water beside the quay at the surface. And some lidar is stepped at quays in the source itself
  (Copenhagen: six squares sideways every two rows).

## 1. Mesh Roads and junction heights (in progress)

Done 2026-11-13/14, from in-game profiles (every paved road walked at an even 0.5 m) and drawings of the worst
places. Places with a step over 8 cm: roundabout town 29 to 4, hilly city 16 to 5.
- A road ends just inside the deck it crosses or joins instead of running through it (a deck through a crossing
  could lean one way only and stood 15 to 20 cm over a crossed road with a crest).
- A deck's lean eases out along the road, and leaning decks have a middle line of vertices (a twisted quad folded
  into a 10 to 13 cm ridge just outside junctions).
- Road names that differ only in letter case no longer share an object name (the game merged two roads: 240 m of
  road moved across a town; this was every road mode, not only Mesh Roads).
The steps were not, as first thought, crests in the solved road heights: the solved lines have next to none.

- A tunnel road left on the ground and the road over it no longer cut half through each other (a 2 m slot across
  an avenue over a car park ramp; a 2 m fin across a primary road's underpass): the higher class keeps its surface.
  This one is terrain, so every road mode.

Eight maps, the older measure: steps over 8 cm 85 to 34 before the terrain fix.

Open, most visible first:
0. **An underpass with no room.** Where a tunnel road passes less than 3.5 m under another road, the higher class
   keeps its surface and the other is blocked (dam-road area on the free lidar: a secondary road's 23 m underpass
   1.6 m under a primary road is buried; before, it trenched the primary). The better answer is one crossing at
   grade at the major road's height (pins in the road solve); not built. With 3.5 m or more the road above now
   gets a bridge.
1. **Sidewalk slabs across a carriageway** (three in the roundabout town, 18 to 36 cm): the sidewalk builder.
2. **Deck meets structure.** Steps where a deck meets a bridge deck or a tunnel floor (24 to 33 cm in the hilly
   city, more at an interchange), and one 60 cm terrain step on a boulevard there.
3. **The interchange and the mountain gallery maps**: still 11 and 8 steps over 8 cm; not yet drawn with the new
   profile tool.
4. **Junction mouths on by default.** `junctionMouths` (services/structures/junctionMouths.js) holds a side road's
   first metres at the through road's height. Less needed for Mesh Roads now; still worth it for decal roads.
   Needs a full sweep (it changes every export's road heights) and a look in game before the switch is flipped.
5. **Frame rate.** Decal roads against Mesh Roads against Hero Roads on the same level. Not measured yet.
6. **Decide whether Mesh Roads stays experimental** once 1 to 3 are done.

### Mesh Roads, night of 2026-11-14 (in desktop test build 0.3.1-dev.9)

Measured with `scratch/night/run.mjs` (export, load in game, walk every paved road at 0.5 m). Places with a step
over 8 cm on the 20 areas of the baseline: 339 to 253, with ground road left without a deck down from as much as
4,300 samples an area to under 400. Five new areas (a roundabout new town, an alpine valley, mountain hairpins,
a cul-de-sac suburb, a hill town): 80 to 61. A hill grid alone: 42 to 19.

Done: decks on the on-ground stretches of roads that touch a bridge or tunnel, up to and a step under the
structure; crossings and joins met at the other road's edge whatever the height difference; side-road ends left
out of the through road; the ground's own camber; the bank at a bridge's end no longer over the deck (terrain,
every road mode). Frame rate on a city grid (221 decks): no measurable difference from decal roads; both sat at
the frame limiter with about 1.8 ms of render time.

After the last two fixes of the night (what lies inside another deck does not stand out of it; a hump of ground
on the road's own line is covered) the recorded baselines stand at 296 stepped places on 26 areas: 168 at
bridges and tunnels, 62 ground through the deck, 46 deck to deck, 20 within one deck; 2,474 of 711,526 road
samples have no deck. (The commit that recorded them, 8359bbb, says 1.07 million samples: wrong, it is 711,526.)
Tried and taken out: a higher cap on a deck's lean (no net gain), bridge decks as surfaces (worse).

Then measured for the first time, on the same code: six areas on the 30 m data and two on the free lidar (the
same picture as 1 m lidar, but a hill town on 30 m: 42 against 26), and fourteen more places. Most are quiet (a
suburb grid 0, a flat old city 2, two other cities 4 each); a steep hill city has 118, a fjord capital 85, a ring
road interchange 67. On the hill city half are carriageways mapped side by side (bus lanes beside the main
road), solved 0.5 to 1.3 m apart on a cross slope, whose decks overlap in plan: walking one road's line you are
on the other's deck. Decks side by side need one surface or a wall between them; not started.

Open, by how often it was measured:
1. **Bridge parapets across side streets** that join a bridge at its end (a canal city: a 1.1 m rail across the
   mouth of each quay street). The bridge builder leaves parapets open for ground roads it finds on the deck
   (`onGroundRoad` in beamngBridges.js); these are not found. Every road mode.
   The same junctions leave a side street 0.3 to 0.8 m under the bridge deck's edge (its line reaches the
   bridge's height only at the bridge's middle). Tried: treating bridge decks as surfaces a Mesh Road meets, as
   it meets another deck. The in-game test said no (6 of 10 bridge areas worse, none better; more bare road at
   bridge ends), with the surfaces taken from the solved graph, which is not where the built bridge meshes are.
   It needs the bridge builder's own deck outlines, or the side street lifted in the road solve.
2. **Sidewalk slabs across a carriageway** (19 to 72 cm) at some junctions and where a footbridge is mapped.
3. **Tunnel mouths**: terrain steps of 0.75 to 1.5 m at aprons and portals in a freeway-cap area.
4. **Bridge decks' own steps** (8 to 36 cm inside one bridge mesh, about 15 places in that area).
5. **Deck to deck, 10 to 25 cm**, on hill towns: the height looked up for another deck's surface is off by about
   10 cm where that deck leans; and roads stacked in plan on a hillside.
6. **Raw (unlevelled) terrain on a hill town**: 50 places, most of them the ground through the deck or the deck
   following a rough line; decks are for levelled terrain first.
7. Junction mouths in the road solve (still behind its switch): the right fix for side roads that arrive under
   the through road's edge, which decks now cover with a ramp of up to 0.75 m over their own line.

## Trust: the desktop app asks only listed addresses (done 2026-11-16, both steps)

`desktop/networkHosts.js` is every address in the code; `desktop/networkGuard.js` refuses anything else in the
window and in the export runner, except the user's own Overpass server. Help > Network Activity shows what was
contacted and what was refused; a refused host is named in a message. The user's own way round it:
`"allowUnlistedAddresses": true` in settings.json. Checked in the running app: unlisted addresses refused, own
server let through and refused again once cleared, Generate and export unchanged.

Watch after it ships: a data source whose downloads come from an address no test here reaches (GUGiK, GPXZ with a
key, USGS download buckets, Overture, iNaturalist) would show as "A connection was refused" naming the host; add
that host to the list and the data page.

## Night of 2026-11-17: what was done and what is left

Done (each drawn before and after, then looked at in game):

- Amsterdam Centraal: the road tunnel's approach no longer dives away from its portal under the bus deck, and the
  cutting's floor takes its road's solved height (two carriageways stood on shelves over the trench beside them).
- Quay walls (services/quayWalls.js): a block over the bank at a mapped water's edge in built-up ground. London's
  river walls, Hamburg's and Utrecht's canal quays, Copenhagen's harbour.
- Viaducts on a measured survey (structureRules.js): a motorway / trunk / primary standing 3 m over the surveyed
  ground, a secondary / tertiary 5 m, a monorail off the ground always. Dallas, Miami, Chicago's upper LaSalle Drive.
- A tunnel or a bridge stays its own piece when ways are joined (Zurich: a tunnel joined to its open approach was
  lost and the station square was lifted 6 m onto decks); a street over a built tunnel's roof stays on its ground.
- tychonas on 30 m data: a small street on a steady hillside follows it (to 25%).
- Buildings on or against a dam take its stone or concrete; pool deck sides, platform sides and a dam's ring walls
  end on one buried foot; the update dialog reads character references; planet and release pages got the header.
- Minneapolis "floating boards": shop awnings seen from a camera that stood inside a building. Nothing to fix.

Left:

- Zurich: the square still stands 1 to 3.6 m high on low decks over the Bahnhofquai road tunnel. The tunnel's box
  comes out too shallow (its roof over the square): its approaches are held to the tunnels' 6 % and the ramps there
  are short. Needs the cut-and-cover solve to take a steeper approach when the room is short.
- Copenhagen: teeth along a sidewalk slab between two ramps at different heights (the higher ramp's ground steps
  onto the slab, 0.3 to 0.8 m: under the wing walls' 0.8 m). Needs a low edge wall rule that does not bury the slab.
- Quay walls: a toothed strip of ground behind some quays where a sidewalk slab lies under the ground (Hamburg);
  the wall's material is one stone everywhere (brick quays in the Netherlands and Hamburg).
- Mesh Roads list (underpass clearance, sidewalk slabs across carriageways, 24 to 33 cm steps, junction mouths and
  frame rate): not started.

## Footbridges in Greenville's Falls Park (looked at 2026-11-17)

Every footbridge in a 1 km level of Falls Park on the Reedy (25 mapped, current dev code, area gvl_falls_s with
Liberty Bridge tagged suspension) was looked at in game, far and close, with each one's match to the road bridges
and every gangway measured (scratch/devareas/deckrun.mjs, global __MAPNG_DECK_DEBUG). Sheets in scratch/twenty/out
(fbr_1..5.jpg, fbx.jpg). Already fixed that day: a footbridge spans end to end (it lay on the riverbed), railings
both sides, no posts under a suspension or cable-stayed footbridge.

Found, worst first:

1. Sidewalks of a road bridge built as their own low bridge beside it. South Main Street's bridge carries angled
   parking both sides and its sidewalks behind a stone railing, all one deck (Mapillary 2023). The sidewalks are
   mapped apart (footway=sidewalk, bridge=yes, layer=1) 4.7 and 6.3 m out from the carriageway's edge, past the
   3.5 m a path may be from a road deck to count as on it, so each became its own deck 2.5 to 2.9 m under the road's,
   on posts. Fix: a sidewalk-tagged path running along a road deck of its layer, within about 10 m of its edge, is
   on that bridge: the road's height plus the curb, the gap to the carriageway decked over.
2. Metal stairs and ramps at footbridge ends (13 here: Spring Falls Bridge 3.9 m of stairs, the Swamp Rabbit Trail
   bridge, Liberty Bridge's east end, Park Crossing, the boardwalk path). They are the pier gangways: built wherever a
   deck's end sits under the ground or path beside it. A footbridge's ends take the ground at the end node, not the
   path it joins, and one path over the falls (37058787) ended in the river (deck 0.7 m against ground 4.7 m: the
   river counts as sea floor there). Fix: a footbridge's ends take the height of the path they join (else the ground
   at the end, never the water's), and only piers get gangways.
3. Quay walls along the whole Reedy in the park (27 runs, 958 m in 1 km): white blocks with jagged tops on natural
   granite banks, and a box standing in the river below the falls. The park's many mapped paths make it count as
   built-up ground. Fix: no quay wall where the land behind is a park, wood, grass or rock; a top that does not step.
4. Sidewalk slabs crossing South Church Street's lanes at both ends of its bridge (the slab runs on past the deck's
   end, where the street is no longer in the bridge index that keeps slabs off the lanes).
5. Posts under footbridge decks wear the painted-curb texture (red, yellow and white stripes): plain concrete wanted.
6. Seen on the way, not a footbridge: a jagged dark seam across South Church Street at both bridge ends (ground
   through the road at the deck joint).
7. Not seen: Leap of Faith Overlook (a wooden platform under trees, the camera could not get a clear line).

Fixed the same day (49922f4, drawn before and after with scratch/devareas/fbplot.py, fbtop.py, wallplot.py, then
looked at in game): 1 (the road deck widens out to a mapped sidewalk up to 10 m from its edge, parapets outside it;
the drawings also caught South Church Street's long sidewalk and River Street's, which fell 5 to 6 m off their decks
past the 3.5 m reach), 2 (ends take the walk they join or the surveyed bank, no gangways on footbridges), 3 (a quay
wall needs a steep face in the survey, run median 0.6 m in 1 m, and no green land behind; Falls Park 958 m to none;
Utrecht keeps 62 %, its outer canal's grass banks dropped, some Nieuwegracht walls too, which are probably real), 5.
Wing walls also keep off deck carriageways now.

Left:
- 4 was not a sidewalk slab: at South Church Street's north end the two carriageways are solved 1.2 m apart, and the
  wing wall rule stands a retaining wall with a parapet in the gap between them. The heights are the fault (twin
  carriageways of one street should come out level with each other at a bridge end).
- A sidewalk on a road bridge meets the walk that carries on past the bridge with a step where that walk stays on
  the ground beside the raised approach: River Street 2.7 m, 409177921 1.6 m, South Church Street 1.0 m.
- 6, the jagged seam across South Church Street at the deck joints.

## 2. Checks owed on work already on dev

1. "Extremely heavy" card, the Mapterhorn base tile and the new size selector looked at in the running app.
2. The new 3D model rows (Area, Tiles, Point spacing) in all seven languages.
3. The two sweep areas BeamNG developers exported (dev_szczyrk, dev_pilchowice, added 2026-11-16) have baselines
   recorded as they are, not looked at in game: the dam area shows ground through a deck at 3 places and 5 spikes
   on the coarse survey with Ready to drive, and 4 spikes on the fine one.
4. Amsterdam Centraal after the river-width fix (2026-11-16): the station's island is back on its surveyed ground
   (it had been dug to the water, as London's banks were), and the ground now comes through the raised decks there in
   far more places (Mapterhorn Ready 42 -> 323, 30 m Ready 11 -> 63; baselines re-recorded). The embankment the
   survey holds under the station's decks has to be dealt with: not looked at in game.
   Looked at in 2D on 2026-11-16 (scratch/devareas/amc_comb.png): the worst spots are not the rail decks but the
   road ramps diving under the station. The export cuts the two carriageways to -3 m where the survey has one
   gentle ramp down to about +1 m, and leaves a ridge at +5 m under the deck between them (b019). Needs the
   structure solver looked at for a tunnel approach beside a deck; not fixed.
5. tychonas on GPXZ (30 m there, not lidar): the centre street is still held to its class grade and sits in a
   trench up to 6 m deep with toothed sides. By design on coarse data; on the 1 m lidar it follows the hill
   (checked in game 2026-11-16). A small deck fragment at the map's east edge (500, -338) is a mess of slabs.

(Wing walls looked at in game in six places (Copenhagen, Utrecht, Dallas, Hamburg, Seattle, London), Tower Bridge
with its towers left to the bridge, and the desktop app's Generate and export on this code: 2026-11-16.)

(Poland's sheet joins and reservoirs in game, the quality report on a dense city, Barcelona with shaping off and
the source comparison in the desktop app: looked at by the project owner, 2026-11-15.)

## 3. Release steps waiting on a go-ahead

1. The next desktop test build (0.3.3-dev.6) with the next batch of fixes.

## 4. Speed pass: every step (started 2026-11-18)

Every step of Generate and the export gets the whole toolkit, not only the big hot spots:
- algorithms: indexes and pruning, no full scans;
- memory layout: flat typed arrays, no per-point objects;
- caching and lookup tables;
- async I/O: independent downloads overlapped, different servers at once;
- zero-copy: shared buffers and transfers;
- reused buffers;
- parallel work: workers, strips over a SharedArrayBuffer;
- JIT-friendly code.

Out: approximate geometry, raising any third-party request rate, a bigger young generation.

Each change: the same level (byte for byte, or within 1 mm where agreed), then measured on Chicago 8192 (Mapterhorn, 30 m backdrop, scratch/memprobe).

Chicago 8192 export: about 1050 s on the morning of 2026-11-18, 447 s that evening, 423 s later that night with its lake beds carved for the first time (peak 28-30 GB -> 18-21 GB). Each change is checked on the six bt_* areas and on nyc_s4096 / pgh4k headless; Chicago only at milestones (no backdrop in test runs).

**Export steps** (seconds at Chicago 8192, latest; status):

| Step | Time | Status |
|---|---|---|
| Data step (downloads) | 45 | done: one run (exit fix), 3 downloads at once, lidar 8 ahead |
| Preparing / bridge lidar read | 12 | open: a third lidar decode in the export itself |
| Laying roads | 159 | in progress |
| - structure solver | 57 | done: settles to 0.1 mm (end vs start of a sweep) with an active set of moving roads: matches a fully settled reference (Pittsburgh 2.6 cm, was 0.92 m) and faster (Pittsburgh 7.0 -> 3.2 s). Graphs: scratch/speed/solverplot.py. Open: re-measure at Chicago 8192; sweeps on workers only if still worth it |
| - tunnels (nearestOnTunnel, ground) | ~20 | partly: the ground lookup reuses its result objects (less garbage, no time) |
| - terrain under roads (composeTerrain) | ~8 | done: bands of rows on workers (NYC 4 km roads 73 -> 35 s) |
| - lake and river beds | ~20 | fixed: Map size limit (Chicago's beds were skipped); open: the lake pass's own speed |
| - bridge models | 8 | done: box pre-checks |
| - railways, beds under decks, styles | ~15 | partly (styles done) |
| Sidewalks, curbs, ramps | 67 | partly: deck sidewalks; strip cuts and seawall unions on workers (NYC 24.8 -> 18.7 s); open: grading (gradeSidewalkGround), walk runs |
| Street props | 3 | open |
| Base texture | 12 | open |
| Terrain materials | ~3 | (the 29 s was mostly the lake beds, logged inside this step) |
| terrain.ter | 8 | open |
| Heightmap PNG | 2 | open |
| Backdrop | 8 | open |
| 3D buildings | 18 | done: 8 workers, streamed tiles; open: per-worker copies of roads |
| Water | 3 | open |
| Barriers, signs, furniture | 41 | partly (gates done) |
| Trees and ground cover | 3 | open |
| Zip | ~40 | partly (building tiles streamed) |

**Generate steps** (121 s at Chicago 8192):

| Step | Status |
|---|---|
| Elevation | open |
| Resample | parallel already |
| Map data | open: start beside elevation |
| Road widths (Esri) | rate-bound, kept; cache on repeats |
| Land cover | open: beside road widths |
| Tree species | done: beside road widths |
| Road alignment and smoothing (~10 s) | open |
| Textures (~25 s) | open |
| Saving | open |

**Other:**
- Garbage collection is 68 s of the export (94 before fastHypot and the clamp loop).
- The window's 11.8 GB in the crash report is unexplained (16 km window listing).
- Speed work on the website keeps its memory limits in mind.

## 5. Small fixes

1. Desktop: the "Edit in OpenStreetMap" and "Fit the area" buttons sit over the PC info bar's second line.
2. A tester's few roads still too wide with parking and satellite widths both off (no street names given yet).
3. Batch dialog: make the "ready-made level" choice plainer, so tiles do not come out as asset zips by mistake.
4. Easing along survey sheet joins applies to every join, also where sheets agree: restrict it to where they differ.
5. Large batch levels are untested.

## 6. Very large maps (parked: the warning is the answer)

A 66 km map of a dense city generates now but does not export (first step still running after 30 minutes when
stopped). A 16 km city at 1 m failed after 46 minutes on a Set past 16.7 million entries; fixed, not run again.
Not pursued further: "Extremely heavy" warns, nothing blocks.

A reported 33 km city (16384 px at 2 m, 990,000 features) was run here on the code of the report: about five and
to reach the buildings step, where it stopped with "Invalid string length" as reported. The cause
was the buildings step's extras tasks (every feature as one JSON string), now sent in pieces. The same export on
the fixed code was started 2026-11-14 and had not finished when this was written.

## 7. Waiting on other people

- A BeamNG developer: whether dev.7 ends the console errors and the low frame rate on a lake-country level.
- A BeamNG developer: whether `utcOffset` reads right (it tested correct in game here).
- The tester who asked about smooth roads: what he makes of Mesh Roads.

## 8. Questions still open for the project owner

- A Performance / Balanced / Quality preset (needs measuring on more than one PC first).
- System specs optional in reports, plus the CPU model.
- Geo data back in Basic mode.
- Removing the old `osm/` archives from storage.
- The Base Texture size behind a 2:36 Generate; what was seen with the desktop comparison report; the map size
  where the blend slider lagged.

## Mesh Roads test list

Each test: export with `roadSurface: "mesh"`, load in game, walk every paved road line with rays at 0.5 m, and
draw the worst places before judging. "Steps" are changes of slope over 8 cm in half a metre along the road.

**Note:** `wide.mjs` samples at uneven spacing (0.5 to 1 m), which reads as steps on steep roads; `profile.mjs` is even.

**Already run (eight to ten maps, results in the commit messages):** hairpins, a roundabout town, a stacked
interchange, mountain galleries, a cliff road with tunnels, flat country, two city bridges, a city grid, a canyon
road, a dense hilly city.

**Geometry**
1. T junction on a slope, side road falling away and side road climbing away (ledge at the mouth).
2. Four-way crossing on a hill (two through roads: which one is level).
3. Slip road merging at a shallow angle, and a fork where two roads run side by side at different heights.
4. Roundabout on the ground, and mini roundabout; a ring on a deck with ramps.
5. Hairpins stacked above each other (two levels within a few metres in plan).
6. A long road cut into pieces (over the 400 m join limit) on a steady grade: no step at each cut.
7. Dual carriageway with a median; a road whose width changes along it.
8. Dead end, and a deck ending where the road goes on unpaved or onto a bridge approach.

**Structures**
9. Both ends of a bridge: deck to bridge deck, on the level and on a grade.
10. Tunnel and gallery mouths: deck to tunnel floor.
11. An overpass with a ground road under it (two levels: decals lifted onto the right one).
12. A level crossing with a railway; a dam with a road on it.

**Ground**
13. 1 m lidar, the free lidar and the 30 m data for the same place (the deck over rough and over smooth ground).
14. Each terrain choice: ready to drive, untouched, shaping switched off (how far decks stand out of unlevelled ground).
15. A road along a steep hillside (side faces) and one beside water (lake bank, quay).
16. A 16-bit height step map (large relief): does the deck hide the terrain's steps as intended.

**What sits on and beside the deck**
17. Lane lines, edge lines, stop lines, crossings and arrows drawn on the deck, by day and at night.
18. Stone and brick paving strips, and unpaved roads (no deck): the join between the two.
19. Kerbs and raised sidewalks beside a deck; driveways and car parks joining it.
20. Street parking on and off; widths measured from the satellite picture on and off.
21. Traffic: AI cars following the decal roads over decks, at junctions and onto bridges.
22. Signs, lamps, barriers and guard rails at the deck's edge (do any stand in or under it).

**Whole level**
23. Frame rate and load time against decal roads and Hero Roads, small map and 8 km map.
24. World Editor: decks listed, selectable and editable; nothing extra drawn.
25. The website's export and the desktop app's export of the same map give the same decks.
26. A drive test: a car at speed over the ten worst junctions of each map, with and without junction mouths.

## Borrowed rules to try (research notes in scratch/research/road-techniques.md, unverified numbers)

- A landing on the minor road at a junction: approach grade 3 % or less (6 % limit), grade break up to 3 %; the
  major road's grade and cross-slope carried through; both flattened to one plane where neither dominates.
- Profiles as straight grades joined by parabolas, length = K x grade change, K by speed.
- Cross-slope change spread over slope change x half-width / relative gradient (0.5 to 0.9 %): far longer than
  the 0.75 % a metre Mesh Roads uses now.
- Junction as its own surface with each arm blended in over a transition length (OpenDRIVE).
- Named reference junction cases with invariant checks (osm2streets' test pattern).

## The in-game Mesh Roads test (in the repo)

`node scripts/ingame/meshRoadProfile.mjs --all` (BeamNG running with the MCP mod, `NAPI_CANVAS` set): exports each
area of `tests/fixtures/meshRoadProfileBaselines.json` with Mesh Roads, loads it, walks every paved road at 0.5 m
and compares the stepped places and the road left without a deck with the baselines; `--save` records them.
Run it after any change to services/meshRoads.js or to the terrain under roads: the export's own checks look at
MapNG's data, this looks at what the game built.

## Diagram tools (in scratch/, not in the repo)

- `scratch/junctions/dump_pre.mjs`: preload for a test export (`NODE_OPTIONS=--import`, `STRUCT_OUT=file.json`),
  writes the solved road graph: each piece's line, solved height, ground under it.
- `scratch/junctions/plot.py graph.json x y radius out.png`: top view round a point and long sections of the
  nearest pieces.
- `scratch/junctions/section.py before.json after.json "k1,k2" out.png title`: one road's height and slope along
  its line, before and after.
- `scratch/meshroads/wide.mjs <tag> <areas...>` with `measure_wide.lua`: the in-game measurement on several maps
  (`EXTRA_OPTS='{"junctionMouths":true}'` adds export options).
- `scratch/junctions/profile.mjs <zip> <out.json>` with `profile.lua`: loads a level in the running game and saves
  the driving surface every 0.5 m along every paved road (height, what the ray met, terrain) and every deck's nodes.
- `scratch/night/run.mjs <tag> area[:terrain[:raw]] ...`: all of it for a list of areas, one line each and `rows.json`.
- `scratch/junctions/around.py prof.json [n]`: the heights round the worst structure steps, as text.
- `scratch/junctions/xsec.py before.zip after.zip out.png`: deck cross-sections against the ground.
- `scratch/junctions/gsteps.py prof.json [threshold]`: the steps in such a profile, grouped into places and kinds.
- `scratch/junctions/gplot.py prof.json road index out.png [title] [reach]`: one place from the game: top view with
  the decks and their node heights, the long section, and the change of slope. Use this one first.

## 5. Sidewalk rework: one paved-area model (started 2026-11-18)

Agreed with the user 2026-11-18 after an audit. Today two builders never join: street-side strips (A) and mapped
footways cut and merged as polygons (B). Downtown that leaves bare strips of 1-3 m between curb and walkway, and
stubs at crossings; B is 15.7 s of Chicago 8192's ~45 s of sidewalk work and holds all the retry code.

- Audit: scratch/swaudit (probe.mjs dumps the builder's output through `__MAPNG_SIDEWALK_PROBE`; plot.py,
  pipeline.py, swstages.py for times per stage).
- Photo check (Mapillary): Chicago W Kinzie and Hong Kong Kwai Chung paved from the curb; planting exists beside the
  pavement, not between curb and walkway. Rule: close the strip unless mapped greenery covers it.
- Prototype: scratch/swaudit/proto.py, a 0.25 m paved grid. Done: paved from the curb out to a footway tagged
  footway=sidewalk (256 of 263 Chicago footways, all 143 in Hong Kong carry it), only between road and walk (no
  filling past a walk), notches under ~5 m closed at corners; plain footways keep the 1 m snap. Next:
  - done: rounded corner curbs (the road takes each corner arc's fillet up to where the edges meet; 27 Chicago,
    16 Hong Kong corners);
  - done: greenery as evidence for a verge (OSM grass, flowerbed, meadow, park, garden at ground level; rooftop and
    upper-level greenery skipped; street trees don't block paving): Chicago keeps 2,832 m2 of verge, mostly the
    riverside planters along Wacker;
  - step 3a done: services/pavedArea.js (grid, tests; not wired in). Chicago test area 2147x2147 cells in 1.3 s on
    one thread; scratch/swaudit/jsgrid.mjs + plotgrid.py draw it. Small notches left at walk ends by crossings.
  - step 3b done: traceOutlines (marching squares + Douglas-Peucker), pockets under 20 m2 between road and
    pavement paved, specks under 0.5 m2 dropped; Chicago 103 rings in 92 ms.
  - step 3c done: buildPavedMesh (4 m squares, curb faces, skirts); Chicago 27,642 triangles vs 76,087 today, 173 ms.
    To finish at wiring: 0.25 m jogs where a fillet meets a straight curb; a curb top strip in the curb look.
  - step 3d done: gradePaved (under the slab, blend back by one distance transform, roads left).
  - step 3e done: services/pavedSidewalks.js, switch MAPNG_PAVED_SIDEWALKS=1 (off: levels unchanged). Chicago test
    area: 4 tiles, 14.9k slab / 2.5k curb / 9.2k edge triangles; section checked (slab 15 cm over the road at the
    curb, ground 14 cm under the slab). Still to do: driveway dips and car-park openings, the curb top strip, the
    0.25 m corner jogs, the seawall pockets (off in paved mode), tiles on workers; then the side-by-side.
    Driveway dips done (53b0a75, only where a driveway crosses to the road). Grid 1.39 -> 0.80 s for the Chicago
    test area. TIMING RISK: a 256 m tile still takes ~0.5 s with meshing and the road-height lookups, about 1,000
    tiles at 8 km = ~500 s on one thread against 67 s for today's whole sidewalk step: tiles on workers (8x) and
    cheaper heightAt (cache the road surface per slab vertex / grading pixel) are needed before a full-size test.
    Workers done (47e1b3e: Chicago test area 3.4 -> 0.8 s, same level) and row-strip clipping (8e92cd3: the whole ring
    clipped per 4 m square was quadratic). NYC 4 km with the switch on: sidewalk step 21.2 s (today 17.8 s), 2.70M
    triangles (today 2.12M; slab 1.21M, curb 0.53M, edge 0.82M). Next: fewer edge/curb faces (jagged walk outlines
    traced at 0.25 m; skirts on every terrain edge), then profile again; then curb top strip, corner jogs, car parks,
    seawall pockets; then the side-by-side and the user's go-ahead.
    Update (e7d17f3 and after): outlines simplified within one cell, tiles meshed in order as workers return them,
    row pass as linear scans: NYC sidewalk step 15.7 s with the switch on (today 17.8 s), 1.48M triangles (2.12M).
    The 0.25 m corner jogs are gone with the looser outlines (curb within one cell of the road edge).
    Details done: curb top band, bare curbs (0.5 m strip, open across dips), today's dips (crosswalks, walkway ends,
    car parks), seawall pockets. NYC with the switch on: 16.3 s (today 17.8 s). Next: the side-by-side on all test
    areas (plots, paved area and triangle numbers, timing), then the game check at the test intersections.
    Side-by-side done (scratch/swaudit/sbs.sh + sbs_report.py): faster and fewer triangles on every area with a
    sidewalk step (NYC 22.8 -> 21.8 s, 2.12M -> 1.95M; Pittsburgh 21.7 -> 19.9 s, 2.53M -> 1.76M; lakefront 9.1 -> 7.6 s),
    paved area up (NYC 0.40 -> 1.85 km2): today's build lays no slabs on many mapped NYC sidewalks (18 tagged footways
    in one window, zero slab triangles), the paved model paves them. Game check done (2026-11-18, fresh builds,
    shots in scratch/swaudit/game/shots): Chicago W Kinzie continuous curb to buildings, driver's view clean;
    NYC block now has walkways where today has none. Hong Kong built but not looked at in game. Waiting for the
    user's decision on switching the paved model on by default.
    2026-11-18 night: the user said make it the default, run the full sweep, check Hong Kong + a suburb in game, push to
    main if all is well, then drop the old sidewalk code. Done so far: default on dev (87ceecc); sweep fixes: paved
    ground check (checkPavedGround), grading never into a deck, slabs follow the ground when terrain is not shaped,
    no paving over mapped water or the sea (c457dd1); tiles only where something is paved / inside the map (test
    suite 12.7 -> 1.9 min, 9327971). STILL FAILING in Ready cells (kingst, naldo): terrain spikes up (17->32,
    25->39), floating 7-13 -> ~30 (kingst t30 168), buried naldo 2->35. Next: diagrams at the worst spikes, fix the
    grading's edges, re-sweep; then Hong Kong + suburb_naperville (fetched) in game; then drop the old code; main.
    Unrelated: 3 lint warnings in every cell (beech foliage textures missing in the game itself: a Steam update;
    re-run the asset generators + audit).
    Was: 3e wiring behind a switch (heights from the road edges, tiles on workers), (slabs, curb faces) at today's heights; 3d grading
    from the grid; tiles on workers; decks and waterfront unchanged at first; behind a switch until approved.
- Then: plots and paved-area numbers on the test areas against today, in-game check, and the user's go-ahead
  before it replaces A and B.

## 6. Overnight 2026-11-18 -> 19 (user asleep; report in the morning)

The user: keep working through the night, report in the morning. In order:
1. Sidewalks (paved model) until they look good across all test areas: sweep matrix clean (or every remaining
   difference shown to be the check's wider sampling, with plots), Hong Kong + suburb_naperville in game.
   Main only after that (user's earlier go-ahead was "if all is well"); then remove the old sidewalk code.
2. Double-check the optimization pass (docs/optimization-rules.md, the speed table in section 4).
3. Review the Generate and Export progress cards: percentages, bars and info text accurate and smooth (jumpy on
   dev.mapng.com now, likely since the speed work changed step lengths).


**Where it stands (morning of 2026-11-19):**
- **Sidewalks:**
  - In game, Hong Kong (Kwai hillside bend) and the suburb (lawn verges, cul-de-sac) look right. Shots are in
    scratch/swaudit/game/shots.
  - The 5th sweep (lawn rule) still flags 29 regressions, nearly all swFloat/swBuried. As a share of samples they
    are small: naldo 0.18 %, kingst t30 0.3 %, pilchowice 2 %. Zion t30 is 14 %, and its baseline (200) was
    already bad.
  - scratch/swaudit/spotclass.py sorts them: most stand where the terrain spans more than 2 m within 3 m. Those are
    road embankments with the paved strip running down their side (pilchowice 255,935: road flat, then a 3.5 m
    drop), quay walls (naldo 942,-316: a 9 m step) and footway ends at a hairpin. The paved check now lists its
    first 64 spots of each kind.
  - **Not fixed yet.** Candidate rule: no paving where the ground under a strip falls more than about 1 m from the
    curb (leave the embankment slope as terrain).
  - Main not pushed and the old code not removed: both wait on these.
- **Optimization pass:**
  - The paved code meets the checklist: spatial-index Maps only, fastHypot, typed grids. One small leftover: the
    small arrays traceOutlines makes per outline segment.
  - Added the missing test that the worker path and the single-thread path give the same tiles.
- **Progress cards:**
  - Export weights refitted (d77076f).
  - The card is paced by time (66970a4, services/progressPace.js).
  - Recorded in the built site (scratch/verify-pw/e2e_progress_watch.mjs, scratch/speed/progress_1024*.json):
    the export bar is now within 4 points of the time on average; Generate's end jump went from 43 to 16 points.
  - Left: Generate's stage weights are old guesses (refit them like the export's); the OSM wait can't be
    predicted.

**Later on 2026-11-19 (dev 109fdf0, 5879a47, dc8cd53):**
- **Bank rule:** no paving down a road's bank. Found before tracing and cleared on the workers; the NYC 4 km paved
  step is back to 10.45 s.
- **Ground check:** measures the built slab, sampled 1 m inside the paving.
- **Unshaped terrain:** 1 m squares where the slab bends (and under decks).
- **Under decks:** the slab follows the ground wherever the grading leaves it (6 m reach, as the grading's guard).
- **Old builders removed.** Aprons to seawalls and walks away from roads are paved again. The water step leaves the
  ground under paving.
- **Sweep: 17 flagged cells** (was 29 the night before), all small:
  - naldo (quay terraces, walks away from roads);
  - deckpark and kingst lidar buried counts;
  - stelvio (a steep cutting with no walk, 16 of 168 samples);
  - Amsterdam creases;
  - val d'Isère and szczyrk cross counts;
  - 4 buried samples in pilchowice.
- **Progress bars recorded with the planet tiles** (scratch/speed/progress_1024d.json): Generate and export are both
  within 5 points of real time on average.

**Bridges in St. Augustine (2026-11-19, dev 957fa96, 9f4c690):**
- **Fixed:** bridge rise over water capped by its reach from its ends; a thin slab's clearance dug under low decks;
  deck sidewalks set out past the lanes, taking the nearest deck segment's height. Details in the commit messages.
- **Open:**
  - **Bridge-end joints where a mapped sidewalk meets the deck walkway** (Bridge of Lions east end). The ground
    walk's own heights come from the bank's terrain, so the paving dips down the bank between the deck walkway and the
    street (plot scratch/cordova/diag/lions_east_corner.png). A keep-out of ground paving under low decks plus deck
    roads in the paving heights was tried and taken out: the walk heights still win. Needs walk heights at bridge ends
    from the deck.
  - **A 0.3 m sag on a short approach road between a street and a deck** (Lions west, 11 m). The solver pulls it
    to the ground within its grade limit. Wants a smoothness rule at bridge ends.
  - **Website speed:** the paved sidewalks run single-threaded on the website (12.5 s on a 2048 St. Augustine export
    in the browser, about 4 s in Node with workers). Web workers for that step would close most of the gap.
  - **Railings:** short low bridges like the visitor centre bus lane have open metal railings in reality, but the
    export builds solid concrete parapets. OSM has no tag for it.
