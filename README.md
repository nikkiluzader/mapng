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

MapNG turns any real-world location into a playable BeamNG.drive level. Pick a place, choose an elevation source, generate the terrain, check it in the 2D and 3D previews, and export a level ZIP with real terrain, textured buildings, roads with lane markings and traffic signals, sidewalks, bridges, regional trees and AI traffic. You can also export GeoTIFF and GeoJSON data, and batch mode processes whole grids of tiles. It runs in your browser with no account, or as a free desktop app for Windows and Linux.

It is built for driving and modding, not survey-grade reconstruction. The result depends on the elevation source and on how well OpenStreetMap covers the area.

## MapNG Desktop (Windows and Linux)

The same MapNG, running on your own computer. Free, from [GitHub Releases](https://github.com/nikkiluzader/mapng/releases/latest): `MapNG-Setup-<version>.exe` for Windows, `MapNG-<version>-x86_64.AppImage` for Linux.

- **Big and dense maps.** No browser memory limit: generating and exporting run in their own processes and use every CPU core. A dense 8 km Manhattan level that took 34 minutes at the start of the desktop work exports in under 5 minutes.
- **Full-detail free lidar.** The desktop app reads Mapterhorn's free lidar at full detail for much bigger areas than the browser can hold (about 2.5 GB of tiles against the browser's 290 MB): a 16 km area at 1 m gets about 0.8 m lidar instead of 3.3 m. The hint under the elevation source says the detail your area will actually get.
- **Downloads kept while you work.** Generate saves everything it downloads (elevation, satellite, OpenStreetMap, land cover) to disk, so changing a setting and generating again only fetches what's new. The cache is cleared when the app starts, and OpenStreetMap data is fetched fresh after 30 minutes.
- **Straight into the game.** Levels are saved directly into BeamNG.drive's `mods` folder (found automatically, or pick it), ready to drive.
- **My Levels.** A sidebar on the right lists the MapNG levels in your mods folder, with their size, date and MapNG version. **Update** remakes a level with the current version from the data it was made from, with the same settings, so it gets every fix since. **Modify** loads it back in with its settings to change and export again. You can also show it on the map, show it in the mods folder, open its saved data, or **Delete** it (to the Recycle Bin or Trash). Levels from before the desktop app are updated by fetching their area again.
- **Saved downloads.** Each level keeps what was downloaded for it (terrain, satellite, OpenStreetMap, bridge-height lidar) in the app's data folder (`%APPDATA%\MapNG\projects` on Windows), never in the level zip. Update and Modify read it instead of downloading again, so they work offline and use no GPXZ calls. **Show saved data** opens a level's folder; deleting a level removes it too.
- **Problem reports, only if you say so.** When the app crashes or an export fails, it can offer to send a report. You see everything in it first, nothing is sent unless you choose Send, and you get a report ID to mention on Discord or GitHub ([details](https://mapng.com/data.html#reports)).
- **Update checks.** The welcome screen has a box for automatic update checks (ticked; untick it to opt out), and MapNG asks before it downloads or installs an update.
- Cancel an export, see why one failed and open its log, taskbar progress, and a notification when a long export finishes.

The Windows build isn't code-signed yet: on first run Windows SmartScreen may say it "protected your PC". Choose **More info**, then **Run anyway**.

## Highlights

- **Playable BeamNG level ZIP** for BeamNG.drive 0.40, from `512` up to `16384` px, at any processing scale (m/px)
- **Elevation sources:** Best free (the default: Mapterhorn's free lidar where a national survey exists, the global 30 m elsewhere), Global 30 m only (AWS Terrain Tiles), USGS 1 m (USA), NMT EVRF2007 (Poland), GPXZ (with your own API key), flat, and your own LAZ/LAS, GeoTIFF, ASC and GML/XML uploads, also zipped (layered, reprojected, gaps filled from the global 30 m or GPXZ)
- **Terrain:** materials painted from OSM land use, and from ESA WorldCover's land cover where OSM maps none (grass, fields, forest floor, bare ground, rock on steep slopes); a 2× satellite base texture with a touch-up painter, and a surrounding backdrop
- **Regional look:** grass, ground cover, rocks, water and trees chosen from the location and from what covers the land (desert, high rock and ice, open grassland), with no biome to pick
- **Trees where trees grow:** ESA WorldCover keeps planted woods to real tree cover (no forests above the tree line), mountain trees become conifers; trees OSM maps one by one always stand
- **Buildings** textured with BeamNG's own facades and roofs
- **Roads:** DecalRoads with real surfaces, lane markings by country, crosswalks, stop bars, parking lanes and shoulders; roads on the 30 m source are smoothed and levelled automatically
- **Street detail:** traffic signals per approach, road signs, street lamps that light up at night, raised sidewalks with curb returns and ramps, median islands on divided roads, hydrants, bins, benches, utility poles and power lines
- **Bridges, tunnels and dams** solved as one network with the roads and terrain, from general rules that work with any terrain and OpenStreetMap data: smooth bridge ends, clearance over rivers and roads, styled bridges (trusses, arches, suspension, cable-stayed), drawbridges with their tower houses and lift spans, divided roads sharing one deck, lamps on lit bridges, lidar deck heights in the US, tunnel portals and lights (with the terrain Untouched, tunnels on lidar open only their entrances), concrete arch dams with the road and guardrails along the crest
- **Venues:** racetracks with kerbs, walls and catch fences, sports grounds with surfaces, markings and seating, swimming pools and fountains, floodlights
- **AI traffic** on the road network, road names on the minimap, fuel stations
- **OpenStreetMap data** from MapNG's own copy, growing region by region toward the whole planet (fast and independent of Overpass outages), health-ranked Overpass mirrors elsewhere, or your own Overpass server; **Overture Maps** adds buildings and heights OpenStreetMap is missing, and is the backup source if every Overpass server is down
- **How heavy is this level?** Before you export, a card rates the level from its size, how far its corners are from the centre (BeamNG starts to jitter past about 30 km) and its building count. It only warns; you can always export
- **Share your setup:** a short code or link for your settings (works for 24 hours), a long code that never expires, or a file. Whoever opens it sees exactly what it changes first, and your own keys and servers never go with it
- **A step-by-step control panel:** Location, Sources, Generate, Export (batch: Location, Sources, What you get, Run), with your setup always shown above the buttons
- **Background areas** (Advanced): shade the parts of the map you won't drive; they keep their shape but get no buildings, trees, grass or props and download at lower detail. A No smoothing brush keeps chosen roads exactly as the elevation data has them
- **Exports that only redo what changed:** everything is downloaded at Generate and in a background data step (one download cache), Check level when nothing changed, and the slow steps reused when one setting did; export history in the desktop app
- **2D preview:** the generated area flat, with everything that will be built drawn over it by group, terrain views (Relief, Slope, Height, contour lines), the backdrop's surrounding tiles, and a button straight into OpenStreetMap's editor
- **3D preview** with Standard and Cinematic looks, sun shadows, and the same terrain views
- **What to build:** switch any feature of the level on or off before you export. Basic has four presets (Everything, Clean driving, Roads only, Scenery only); Advanced has a switch for each of 32 features, single OpenStreetMap tags, and the 2D map coloured by group
- **Spawn and quicktravel points:** pick where the car starts and add places to jump to from BeamNG's big map
- **Railways** with their bridges, tunnels and level crossings (tracks only for now)
- **Basic and Advanced modes:** Basic builds the BeamNG level from a preset. Advanced adds the Terrain choice (Ready to drive, Custom or Untouched), every feature switch and fine-tuning (forest density, measured bridge heights), heightmap, texture and 3D model downloads, and surrounding tiles
- **Your own OpenStreetMap data:** pull the area straight from openstreetmap.org (one request per click; its [API usage policy](https://operations.osmfoundation.org/policies/api/) is yours to follow), or drop in an `.osm` file, when the public servers are down or behind
- **Batch mode** for tile grids up to 20×20, or a combined level stitched from a 2×2, 4×4 or 8×8 grid
- Stage-by-stage progress like BeamNG's loading screen, with finished steps and timings, and a detailed `export_report.txt` in every level for troubleshooting
- 7 languages, light and dark mode

## What's New

**MapNG 0.2.16** ([update page](https://mapng.com/updates/0.2.16/)): fixes

- **Junctions on hills:** no ridge or flat pad across the main road, no steep ramp beside the junction, a rounded curve where the main road changes grade there; a side road leaves the main road's edge at its slope
- **Backup map data:** a notice after Generate when OpenStreetMap's servers did not answer and the map was built from Overture (no lane counts, rougher bridges); MapNG's own map tiles survive a failed request

**Earlier updates**, each with pictures: [0.2.15](https://mapng.com/updates/0.2.15/), [0.2.14](https://mapng.com/updates/0.2.14/), [0.2.13](https://mapng.com/updates/0.2.13/), [0.2.12](https://mapng.com/updates/0.2.12/), [0.2.11](https://mapng.com/updates/0.2.11/), [0.2.9](https://mapng.com/updates/0.2.9/), [0.2.8](https://mapng.com/updates/0.2.8/), [0.2.7](https://mapng.com/updates/0.2.7/), [0.2.6](https://mapng.com/updates/0.2.6/), [0.2.5](https://mapng.com/updates/0.2.5/). Every release with its notes is on the [releases page](https://github.com/nikkiluzader/mapng/releases).

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
| AWS Terrain Tiles (mostly SRTM) | Global 30 m elevation: the fallback where there's no lidar |
| GEDTM30 (OpenGeoHub, CC-BY 4.0) | Global bare-earth 30 m: the ground filter's reference for taking buildings and trees out of the global 30 m |
| Copernicus GLO-30 (EU/ESA, via Mapterhorn) | Second global 30 m, averaged in by the ground filter where the data is radar |
| Mapterhorn | Free lidar where a national survey exists (open-data sources, mapterhorn.com/attribution); the default, with the global 30 m elsewhere |
| USGS TNM Access API | 1 m US elevation where available |
| GUGiK NMT EVRF2007 (Poland) | High-resolution Poland elevation tiles |
| GPXZ | Optional higher-resolution elevation, with your own API key |
| Custom upload | Your own DEM: LAZ/LAS, GeoTIFF, ASC, GML/XML (single or multi-tile) |
| Esri World Imagery | Satellite textures and map layers |
| MapNG OSM tiles (Cloudflare R2) | MapNG's own OpenStreetMap copy, region by region toward the whole planet |
| OpenStreetMap / Overpass | Roads, land use, buildings, water, vegetation, street furniture elsewhere |
| Your own Overpass server | Optional map data source you set yourself |
| Overture Maps | Extra buildings and heights; backup map data |
| ESA WorldCover (2021, 10 m, CC BY 4.0) | Land cover: where trees grow, ground on unmapped land, snow, the regional look (© ESA WorldCover project / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium) |
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

The desktop app lives in `desktop/` (Electron). It loads the built page, and runs Generate and the level export in a bundled Node runtime.

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
4. Generate. The 2D preview opens: check what will be built, the slope and the relief; open the 3D preview for a look round.
5. Export the BeamNG level and put the ZIP in your BeamNG.drive `mods` folder (the desktop app saves it there for you).
6. For larger areas, switch to Batch job mode and process a tile grid, or stitch one into a combined level.

## Community

Questions, bug reports and screenshots: [Discord](https://discord.gg/j6ZvcF8rgk) or [GitHub issues](https://github.com/nikkiluzader/mapng/issues). MapNG is free; if you'd like to help, there's [Ko-fi](https://ko-fi.com/nikluz).

## BeamNG Level Export

The level ZIP contains:

- terrain (`.ter`) with materials painted from OSM land use and ESA WorldCover land cover, and a satellite base texture
- the regional look for the location: grass, ground cover, rocks, water and trees
- textured buildings, bridges, dams, sidewalks with curbs, median islands and power lines as BeamNG shapes
- DecalRoads with markings, crosswalks and stop bars, traffic signals, road signs, street lamps, hydrants, bins and benches
- an AI road network, road names for the minimap, fuel stations and a surrounding backdrop
- `mapng.json`: the MapNG version, area, size and settings it was made with
- `export_report.txt`, a detailed diagnostics report (terrain, roads, every bridge, buildings, street furniture, vegetation, terrain materials and the export's console log), useful when asking for help

## License

[MIT](https://mit-license.org/). The interface fonts, Noto Sans, Overpass and Overpass Mono (the ones BeamNG.drive's own UI uses), are under the [SIL Open Font License](https://openfontlicense.org/).
