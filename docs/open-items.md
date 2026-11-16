# MapNG open items

Written 2026-11-14, brought up to date 2026-11-15. The working order of open work, most important first, and the test list for Mesh Roads.
The long backlog with every request and its history is kept outside the repo; this is the short list to work from.

Rule for all road, junction, terrain and structure work: **draw it first.** A top view and long sections of the
place from the solved data, before changing anything, and a before/after of the same place for every fix. Counts
alone have misled this work more than once. Tools are listed at the end.

## State of the branches

As of 2026-11-15, evening:

- `main` (7823057) and published 0.3.2 / test build 0.3.3-dev.3: lattice towers on high-voltage lines with roof
  anchors, problem reports that never carry a key, plain reasons for two export failures.
- `dev` since then, not on main and not in a test build: power towers mapped on their own, a tower's whole base
  kept clear of bridge decks, no track on rail trails, `disused=tram` built as tram, survey-following roads
  finding their ground again after a structure, every catalogue tag in the tag library, and the asset organiser
  showing which way each model faces (the organiser lives outside the repo).

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

## 2. Checks owed on work already on dev

1. "Extremely heavy" card, the Mapterhorn base tile and the new size selector looked at in the running app.
2. The new 3D model rows (Area, Tiles, Point spacing) in all seven languages.

(Poland's sheet joins and reservoirs in game, the quality report on a dense city, Barcelona with shaping off and
the source comparison in the desktop app: looked at by the project owner, 2026-11-15.)

## 3. Release steps waiting on a go-ahead

1. Push `dev` to `main` after a clean sweep.
2. The next desktop test build (0.3.3-dev.4) once this week's list is through.

## 4. Optimization pass (asked for, one item done)

1. Texture painting still on one core (about 13 s at 8 km): canvas read-backs, the remaining passes.
2. About 15 s of garbage collection in an 8 km export.
3. The website, with its memory limits in mind (heavy parallel work stays on desktop).
4. GPU work: recommended against for now (a few seconds at 8 km for a fallback path on every card).
5. Backdrop from Poland's 1 m model: 6 minutes for a 512 m map's backdrop.

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
