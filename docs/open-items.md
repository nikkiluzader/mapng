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
