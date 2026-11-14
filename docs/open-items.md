# MapNG open items

Written 2026-11-14. The working order of open work, most important first, and the test list for Mesh Roads.
The long backlog with every request and its history is kept outside the repo; this is the short list to work from.

Rule for all road, junction, terrain and structure work: **draw it first.** A top view and long sections of the
place from the solved data, before changing anything, and a before/after of the same place for every fix. Counts
alone have misled this work more than once. Tools are listed at the end.

## State of the branches

- `main` and desktop test build 0.3.1-dev.7: the water and backdrop fixes, Mapterhorn and Poland's 1 m model as
  backdrop sources, street parking off by default, Mesh Roads as an experimental choice.
- `dev` since then, not on main and not in a test build: map data saved in pieces (very large maps), "Extremely
  heavy" rating, Mapterhorn's 30 m base in the source comparison, comparison sizes up to the whole selection with
  GPXZ calls counted and kept for Generate, quality report up to 4 km, flaw check (knots and stripes), survey sheet
  joins (Poland's dashed lines), reservoirs mapped as sometimes dry, Mesh Roads end fixes, junction mouths (behind
  a switch, off).

## 1. Mesh Roads and junction heights (in progress)

Done 2026-11-13/14, from in-game profiles (every paved road walked at an even 0.5 m) and drawings of the worst
places. Places with a step over 8 cm: roundabout town 29 to 4, hilly city 16 to 11.
- A road ends just inside the deck it crosses or joins instead of running through it (a deck through a crossing
  could lean one way only and stood 15 to 20 cm over a crossed road with a crest).
- A deck's lean eases out along the road, and leaning decks have a middle line of vertices (a twisted quad folded
  into a 10 to 13 cm ridge just outside junctions).
- Road names that differ only in letter case no longer share an object name (the game merged two roads: 240 m of
  road moved across a town; this was every road mode, not only Mesh Roads).
The steps were not, as first thought, crests in the solved road heights: the solved lines have next to none.

Open, most visible first:
1. **A slot in the ground under a road** where a tunnel left on the ground (an underground car park's exit ramp,
   2 m under an avenue) crosses under it: 2 m deep, 3 m wide, across the avenue. Terrain, so every road mode. The
   road above also loses its whole deck to it. Drawn; not yet traced to the pass that digs it.
2. **Sidewalk slabs across a carriageway** (three in the roundabout town, 18 to 36 cm): the sidewalk builder.
3. **Deck meets structure.** Steps where a deck meets a bridge deck or a tunnel floor (24 to 33 cm in the hilly
   city, more at an interchange), and terrain spikes on roads near tunnel mouths.
4. **Junction mouths on by default.** `junctionMouths` (services/structures/junctionMouths.js) holds a side road's
   first metres at the through road's height. Less needed for Mesh Roads now; still worth it for decal roads.
   Needs a full sweep (it changes every export's road heights) and a look in game before the switch is flipped.
5. **Frame rate.** Decal roads against Mesh Roads against Hero Roads on the same level. Not measured yet.
6. **Decide whether Mesh Roads stays experimental** once 1 to 3 are done.

## 2. Checks owed on work already on dev

1. Poland's sheet joins and the reservoir rule: measured in the data only. Export that level and look in game.
2. The source comparison in the desktop app: GPXZ answers reaching the generate job's download cache (written, not
   run in the app), and the 8 km report size.
3. The quality report on a dense city at 4 km, and with GPXZ or USGS included (only a foothill suburb was run).
4. "Extremely heavy" card, the Mapterhorn base tile and the new size selector looked at in the running app.
5. The new 3D model rows (Area, Tiles, Point spacing) in all seven languages.
6. A sweep against the re-recorded baselines; Barcelona with shaping off (buried sidewalks 34 to 157) in game.

## 3. Release steps waiting on a go-ahead

1. Push `dev` to `main`.
2. Cut desktop test build 0.3.1-dev.8 (the very-large-map fix is not in dev.7).

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
- `scratch/junctions/gsteps.py prof.json [threshold]`: the steps in such a profile, grouped into places and kinds.
- `scratch/junctions/gplot.py prof.json road index out.png [title] [reach]`: one place from the game: top view with
  the decks and their node heights, the long section, and the change of slope. Use this one first.
