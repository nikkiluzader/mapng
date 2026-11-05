<div align="center">

# MapNG

Real-world maps for BeamNG.drive.

[![Vue 3](https://img.shields.io/badge/Vue-3.x-42b883?style=flat-square&logo=vue.js)](https://vuejs.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r162+-black?style=flat-square&logo=three.js)](https://threejs.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.x-38bdf8?style=flat-square&logo=tailwindcss)](https://tailwindcss.com/)
[![Cloudflare Workers](https://img.shields.io/badge/Deployed-Cloudflare%20Workers-f38020?style=flat-square&logo=cloudflare)](https://workers.cloudflare.com/)

[mapng.com](https://mapng.com/) · [Download MapNG Desktop for Windows and Linux](https://github.com/nikkiluzader/mapng/releases/latest)

</div>

## What MapNG Does

MapNG turns any real-world location into a playable BeamNG.drive level. Pick a place, choose an elevation source, generate the terrain, check it in the 3D preview, and export a level ZIP with real terrain, textured buildings, roads with lane markings and traffic signals, sidewalks, bridges, regional trees and AI traffic. You can also export GeoTIFF and GeoJSON data, and batch mode processes whole grids of tiles. It runs in your browser with no account, or as a free desktop app for Windows and Linux.

It is built for driving and modding, not survey-grade reconstruction. The result depends on the elevation source and on how well OpenStreetMap covers the area.

## MapNG Desktop (Windows and Linux)

The same MapNG, running on your own computer. Free, from [GitHub Releases](https://github.com/nikkiluzader/mapng/releases/latest): `MapNG-Setup-<version>.exe` for Windows, `MapNG-<version>-x86_64.AppImage` for Linux.

- **Big and dense maps.** No browser memory limit: generating and exporting run in their own processes and use every CPU core. A dense 8 km Manhattan level that took 34 minutes at the start of the desktop work exports in under 5 minutes.
- **Straight into the game.** Levels are saved directly into BeamNG.drive's `mods` folder (found automatically, or pick it), ready to drive.
- **My Levels.** A sidebar on the right lists the MapNG levels in your mods folder, with their size, date and MapNG version. **Update** remakes a level with the current version from the data it was made from, with the same settings, so it gets every fix since. **Modify** loads it back in with its settings to change and export again. You can also show it on the map, show it in the mods folder, open its saved data, or **Delete** it (to the Recycle Bin or Trash). Levels from before the desktop app are updated by fetching their area again.
- **Saved downloads.** Each level keeps what was downloaded for it (terrain, satellite, OpenStreetMap, bridge-height lidar) in the app's data folder (`%APPDATA%\MapNG\projects` on Windows), never in the level zip. Update and Modify read it instead of downloading again, so they work offline and use no GPXZ calls. **Show saved data** opens a level's folder; deleting a level removes it too.
- **Problem reports, only if you say so.** When the app crashes or an export fails, it can offer to send a report. You see everything in it first, nothing is sent unless you choose Send, and you get a report ID to mention on Discord or GitHub ([details](https://mapng.com/data.html#reports)).
- **Update checks.** The welcome screen has a box for automatic update checks (ticked; untick it to opt out), and MapNG asks before it downloads or installs an update.
- Cancel an export, see why one failed and open its log, taskbar progress, and a notification when a long export finishes.

The Windows build isn't code-signed yet: on first run Windows SmartScreen may say it "protected your PC". Choose **More info**, then **Run anyway**.

## Highlights

- **Playable BeamNG level ZIP** for BeamNG.drive 0.40, from `512` up to `16384` px, at any processing scale (m/px)
- **Elevation sources:** Standard 30 m global, USGS 1 m (USA), NMT EVRF2007 (Poland), GPXZ (with your own API key), flat, and your own LAZ/LAS, GeoTIFF, ASC and GML/XML uploads, also zipped (layered, reprojected, gaps filled from Standard or GPXZ)
- **Terrain:** materials painted from OSM land use, a 2× satellite base texture with a touch-up painter, and a surrounding backdrop
- **Regional look:** grass, ground cover, rocks, water and trees chosen from the location (no biome to pick)
- **Buildings** textured with BeamNG's own facades and roofs
- **Roads:** DecalRoads with real surfaces, lane markings by country, crosswalks, stop bars, parking lanes and shoulders; roads on the 30 m source are smoothed and levelled automatically
- **Street detail:** traffic signals per approach, road signs, street lamps that light up at night, raised sidewalks with curb returns and ramps, median islands on divided roads, hydrants, bins, benches, utility poles and power lines
- **Bridges and tunnels** solved as one network with the roads and terrain: styled bridges (trusses, arches, suspension), lidar deck heights in the US, tunnel portals and lights
- **Venues:** racetracks with kerbs, walls and catch fences, sports grounds with surfaces, markings and seating, swimming pools and fountains, floodlights
- **AI traffic** on the road network, road names on the minimap, fuel stations
- **OpenStreetMap data** from MapNG's own copy for the regions it hosts (fast and independent of Overpass outages), health-ranked Overpass mirrors elsewhere, or your own Overpass server; **Overture Maps** adds buildings and heights OpenStreetMap is missing, and is the backup source if every Overpass server is down
- **How heavy is this level?** Before you export, a card rates the level from its size, how far its corners are from the centre (BeamNG starts to jitter past about 30 km) and its building count. It only warns; you can always export
- **Share your setup:** a short code or link for your settings (works for 24 hours), a long code that never expires, or a file. Whoever opens it sees exactly what it changes first, and your own keys and servers never go with it
- **Basic and Advanced modes:** Basic builds the BeamNG level with everything the map has. Advanced adds per-category level options (buildings, water, trees, bridges, tunnels, terrain edits), heightmap, texture and 3D model downloads, surrounding tiles, and *Raw terrain*, which uses your elevation exactly as downloaded
- **Batch mode** for tile grids up to 20×20, or a combined level stitched from a 2×2, 4×4 or 8×8 grid
- Live progress with finished steps and timings, and a detailed `export_report.txt` in every level for troubleshooting
- 7 languages, light and dark mode

## What's New (November 2026)

- **Share your settings:** *Share my settings* gives a short code or link (like `K7F-29Q`, valid 24 hours); *Use someone's code*, Ctrl+V on the map or opening a link shows what it would change before anything is applied. There's also a long code that never expires and Save/Load to a file, and the code is included in every `export_report.txt`. Your GPXZ key and custom Overpass address never travel in a config, and someone else's config never changes them
- **How heavy is this level?** card in the export panel, with BeamNG's precision limit and size warnings
- **Desktop problem reports** (opt-in per report) and **settings stats** (a separate opt-in: which settings people export with, never where; public totals at [mapng.com/api/usage](https://mapng.com/api/usage))
- The old Session Data (`.mapng` files) is gone: the desktop app keeps every level's downloads, and settings are shared with codes
- **MapNG Desktop** for Windows and Linux (see above)
- **Much faster dense exports:** buildings, sidewalk tops and outlines and the level's shape files are built on worker threads; shared vertices are written once (41% fewer in a dense city), and hot spots that compared everything with everything now use grids. Output is unchanged.
- **Big cities load and draw properly:** dense 8 km levels ran out of BeamNG's GPU geometry pool, which showed as smeared "rainbow" slabs and black materials. Sidewalks are now split into tiles like the buildings, and every shape is lighter
- **No more crash on load** when an area's trees reached past the map's edge (they piled up in one corner and crashed BeamNG's forest loader)
- Every level now carries `mapng.json` (MapNG version, area, size and settings), so the desktop app can recognise and rebuild it
- The website and the desktop app read MapNG's own OpenStreetMap tiles in hosted regions; trees scattered in woods come out the same on every export
- **Desktop: Update and Modify in My Levels.** Update remakes a level with the current version; Modify loads it back in with its settings to change and export again. Both use the level's saved downloads (terrain, satellite, OSM, bridge-height lidar), so nothing is downloaded and no GPXZ calls are used. "Show saved data" opens a level's saved-data folder (it is not part of the level zip)
- **Desktop: much faster big maps.** The heightmap resample runs on every CPU core (a 16k GPXZ map generates in about a minute), measured bridge heights from US lidar now work in the desktop app, and the 3D preview's texture choice is the export's base texture
- **Clearer settings:** the sidebar follows the order you work in (location, area and detail, elevation, map data, generate, export), the level options are grouped into cards (Level, Content, Structures, Terrain edits, Surroundings; Structures and Terrain edits in Advanced mode), and greyed-out options say why. Map overlays live in the Map layers box
- The "Apply foundations" terrain option is gone: buildings carry their own foundations
- **Export hotspots:** an optional 2D map overlay of where people export levels, from users who opt in to share (see [Export hotspots and privacy](#export-hotspots-and-privacy)). A soft glow zoomed out, dots up close: click a busy spot to zoom in, click a single area for its details and a button that moves your selection there
- **2D map:** one world with no endless copies east and west; place and road names on satellite (and always in dark mode) instead of a labels checkbox; a scale bar, the coordinates under the mouse, a zoom-to-selection button, a right-click menu (center the selection here, copy coordinates), the area outside the selection dimmed with its size labelled on it, and a Map layers box grouped into Map, Show on map and Sharing that folds away

## What Was New (October 2026)

- **BeamNG 0.40:** exports point at 0.40's asset locations
- **Your own OSM data:** MapNG serves its own compact OpenStreetMap archive from Cloudflare R2 for hosted regions (Arizona, Utah and Florida so far), with a map toggle that outlines its coverage. Elsewhere, Overpass mirrors are health-ranked with an edge cache, you can plug in your own Overpass server, and a banner tells you when the public servers are down
- **Roads rebuilt:** DecalRoads are the only road system, with real surfaces, the whole carriageway paved (parking lanes, shoulders), road rules from the export's location, markings by country, paint cut at crossing roads, and crosswalks and stop bars per approach. Roads stay visible (DecalRoad detail 0.5) and join without faded gaps
- **Traffic signals, road signs and street lamps** from junction approaches and lit roads
- **Sidewalks and medians:** raised curbs along whole streets with curb returns at corners, ramps and driveway dips; median islands on divided roads
- **Street props:** hydrants, bins, benches, utility poles and power lines
- **Bridges:** solved decks with piers, roads drawn on them, abutments graded to the ground, decks meeting their roads on hillsides and over lidar gaps
- **Buildings** textured with BeamNG's facades and roofs
- **Regional trees and look:** trees from BeamNG's own models, picked by OSM tags and climate; the level's look follows its location
- **2× satellite base texture**, filtered resampling and repaired elevation tiles
- **16k exports** no longer run out of memory
- **Simpler single-tile mode:** the export panel focuses on the BeamNG level and Geo data; buildings, trees, rocks and water are always included
- **Map:** keyless Esri satellite, topo and label layers, and your layer, label and base-texture choices are remembered
- **Progress and reports:** generation and export dialogs show the overall progress, the steps finished with their durations and the elapsed time; `export_report.txt` covers roads, every bridge, buildings, street furniture, vegetation, terrain materials and the job's console log

## Important Notes

- Large and dense exports (`4096` and up, or any big city) are heavy on browser memory: use [MapNG Desktop](https://github.com/nikkiluzader/mapng/releases/latest), which has no browser limit and uses every core.
- OSM coverage varies by area: missing or mistagged OSM data shows up as missing or odd roads, buildings and features.
- At very small processing scales (for example `0.25 m/px`), small geospatial alignment differences can become visible near tile edges.
- MapNG outputs are a strong starting point. If you plan to publish to community mod sites, please do additional editing, world-building, optimization and QA first.

## Community Publishing Guidance

MapNG is designed to help you bootstrap a level and quickly explore real places, not to replace full map production.

- For modders: treat MapNG output like a first pass, then continue in your normal level-building workflow.
- For casual users: exporting a local area to drive around is a great use case.
- For public releases: please avoid posting raw, unedited MapNG exports as finished maps.

This helps keep community resource hubs focused on curated, polished releases while still making MapNG useful for prototyping and personal projects.

## Export Types

| Export | Where | Notes |
|---|---|---|
| BeamNG Level Package | Single tile, batch (combined) | Playable `.zip` for BeamNG.drive 0.40 |
| GeoTIFF | Single tile, batch | Elevation raster (WGS84 or source CRS) |
| GeoJSON | Single tile, batch | OSM vector features |
| Heightmap | Single tile (Advanced mode), batch | 16-bit PNG grayscale terrain |
| Textures | Single tile (Advanced mode), batch | Satellite, OSM and Game Texture (single); satellite, OSM and hybrid (batch) |
| Road Mask | Single tile (Advanced mode), batch | Drivable-road mask PNG |
| GLB / DAE | Single tile (Advanced mode), batch | Terrain mesh with OSM features |
| BeamNG `.ter` | Single tile (Advanced mode), batch | BeamNG terrain binary |

## Data Sources

| Source | Purpose |
|---|---|
| AWS Terrarium / SRTM | Standard global elevation |
| USGS TNM Access API | 1 m US elevation where available |
| GUGiK NMT EVRF2007 (Poland) | High-resolution Poland elevation tiles |
| GPXZ | Optional higher-resolution elevation, with your own API key |
| Custom upload | Your own DEM: LAZ/LAS, GeoTIFF, ASC, GML/XML (single or multi-tile) |
| Esri World Imagery | Satellite textures and map layers |
| MapNG OSM tiles (Cloudflare R2) | MapNG's own OpenStreetMap copy for hosted regions |
| OpenStreetMap / Overpass | Roads, land use, buildings, water, vegetation, street furniture elsewhere |
| Your own Overpass server | Optional map data source you set yourself |
| Overture Maps | Extra buildings and heights; backup map data |
| USGS 3DEP lidar | Measured bridge deck heights (USA) |
| iNaturalist | Which tree species grow in the area |
| Nominatim | Location search and reverse naming |

## Export Hotspots and Privacy

**Export hotspots**, in the Map layers box on the 2D map, draws the busy export areas. They come from users who choose to share: sharing is **off unless you turn it on** (**Share my exports** in the same box; MapNG asks once after your first export, and the desktop app's welcome screen has a checkbox).

- **What is sent:** for each level you export, the ~5 km grid square (0.05°) it falls in and whether it came from the website or the desktop app. The square is computed in your browser or app; the exact location never leaves your computer.
- **What is never sent:** no name, account, email or device ID; no level name, settings or map data; no exact coordinates.
- **Where it is stored:** in MapNG's own Cloudflare account, in a SQLite-backed Cloudflare Durable Object that only the MapNG developer can access (`hotspotsObject.js`).
- **How it is stored:** one row per grid square with the web and desktop export counts and the date of the latest. Nothing links a row to a person. To stop spam, a hashed form of the sender's IP address is kept in memory only, to allow at most 30 reports an hour; it is never written to storage. Workers request logging is off.
- **How it is used:** only for the hotspot overlay, which anyone can turn on, and for the developer to see where MapNG is used (for example, which regions get MapNG's own OSM tiles next).
- **Never sold or shared:** the data is never sold, never shared with anyone and never used for advertising or tracking. It only appears as totals per square on the hotspot map.
- Turning sharing off stops reports at once. Counts already added can't be traced back to anyone, so they can't be removed individually.
- The whole table is public at [mapng.com/api/hotspots](https://mapng.com/api/hotspots), and [mapng.com/data.html](https://mapng.com/data.html) explains every field, the pipeline, and every other service MapNG connects to.

**Settings stats** are a separate opt-in (**Share which settings I use** in the Map layers box). After an export, MapNG sends which settings you picked, from fixed lists only: never a location, level name or key. Only a running total per setting is stored, public at [mapng.com/api/usage](https://mapng.com/api/usage).

**Send codes** keep your settings for 24 hours so someone can open them; **desktop problem reports** are sent only when you choose Send. Both are explained on the [data page](https://mapng.com/data.html).

## Getting Started

### Requirements

- Node.js 22+ (20.19+ is enough for `npm run dev` and `npm run build`; deploying with wrangler needs 22)
- npm 9+

### Install

```bash
git clone https://github.com/nikkiluzader/mapng.git
cd mapng
npm install
npm run dev
```

Open `http://localhost:5173`.

### Build

```bash
npm run build
```

### Desktop app (development)

The desktop app lives in `desktop/` (Electron). It loads the built page, and runs Generate Data and the level export in a bundled Node runtime.

```bash
npm run build                 # the page (dist/)
cd desktop
npm install
npm start                     # run it from the repo
npm run pack:win              # or pack:linux: stage the runner and Node, then package
```

Releases are built by `.github/workflows/desktop-release.yml` when a `vX.Y.Z` tag matching `desktop/package.json` is pushed. They go to a draft GitHub Release, which is published by hand.

## Typical Workflow

1. Pick a location on the map or search by name.
2. Choose an output size, a processing scale (m/px) and an elevation source.
3. Keep Include OSM features on for roads, buildings, vegetation and everything built from them (turn on MapNG OSM coverage in the Map layers box to see where MapNG has its own copy).
4. Generate the terrain and check it in the 3D preview.
5. Export the BeamNG level and put the ZIP in your BeamNG.drive `mods` folder (the desktop app saves it there for you).
6. For larger areas, switch to Batch job mode and process a tile grid, or stitch one into a combined level.

## Community

Questions, bug reports and screenshots: [Discord](https://discord.gg/j6ZvcF8rgk) or [GitHub issues](https://github.com/nikkiluzader/mapng/issues). MapNG is free; if you'd like to help, there's [Ko-fi](https://ko-fi.com/nikluz).

## BeamNG Level Export

The level ZIP contains:

- terrain (`.ter`) with materials painted from OSM land use and a satellite base texture
- the regional look for the location: grass, ground cover, rocks, water and trees
- textured buildings, bridges, sidewalks with curbs, median islands and power lines as BeamNG shapes
- DecalRoads with markings, crosswalks and stop bars, traffic signals, road signs, street lamps, hydrants, bins and benches
- an AI road network, road names for the minimap, fuel stations and a surrounding backdrop
- `mapng.json`: the MapNG version, area, size and settings it was made with
- `export_report.txt`, a detailed diagnostics report (terrain, roads, every bridge, buildings, street furniture, vegetation, terrain materials and the export's console log), useful when asking for help

## License

[MIT](https://mit-license.org/)
