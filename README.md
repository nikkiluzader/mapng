<div align="center">

# MapNG

Real-world maps for BeamNG.drive.

[![Vue 3](https://img.shields.io/badge/Vue-3.x-42b883?style=flat-square&logo=vue.js)](https://vuejs.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r162+-black?style=flat-square&logo=three.js)](https://threejs.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.x-38bdf8?style=flat-square&logo=tailwindcss)](https://tailwindcss.com/)
[![Cloudflare Workers](https://img.shields.io/badge/Deployed-Cloudflare%20Workers-f38020?style=flat-square&logo=cloudflare)](https://workers.cloudflare.com/)

[mapng.com](https://mapng.com/)

</div>

## What MapNG Does

MapNG turns any real-world location into a playable BeamNG.drive level. Pick a place, choose an elevation source, generate the terrain, check it in the 3D preview, and export a level ZIP with real terrain, textured buildings, roads with lane markings and traffic signals, sidewalks, bridges, regional trees and AI traffic. You can also export GeoTIFF and GeoJSON data, and batch mode processes whole grids of tiles.

It is built for driving and modding, not survey-grade reconstruction. The result depends on the elevation source and on how well OpenStreetMap covers the area.

## Highlights

- **Playable BeamNG level ZIP** for BeamNG.drive 0.40, from `512` up to `16384` px, at any processing scale (m/px)
- **Elevation sources:** Standard 30 m global, USGS 1 m (USA), NMT EVRF2007 (Poland), GPXZ premium, flat, and your own LAZ/LAS, GeoTIFF, ASC and GML/XML uploads (layered, reprojected, gaps filled from Standard or GPXZ)
- **Terrain:** materials painted from OSM land use, a 2× satellite base texture with a touch-up painter, and a surrounding backdrop
- **Regional look:** grass, ground cover, rocks, water and trees chosen from the location (no biome to pick)
- **Buildings** textured with BeamNG's own facades and roofs
- **Roads:** DecalRoads with real surfaces, lane markings by country, crosswalks, stop bars, parking lanes and shoulders; roads on the 30 m source are smoothed and levelled automatically
- **Street detail:** traffic signals per approach, road signs, street lamps that light up at night, raised sidewalks with curb returns and ramps, median islands on divided roads, hydrants, bins, benches, utility poles and power lines
- **Bridges** with solved decks, piers and graded abutments
- **AI traffic** on the road network, road names on the minimap, fuel stations
- **OpenStreetMap data** from MapNG's own copy for the regions it hosts (fast and independent of Overpass outages), health-ranked Overpass mirrors elsewhere, or your own Overpass server
- **Batch mode** for tile grids up to 20×20, or a combined level stitched from a 2×2, 4×4 or 8×8 grid
- Live progress with finished steps and timings, and a detailed `export_report.txt` in every level for troubleshooting
- 7 languages, light and dark mode

## What's New (October 2026)

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

- Large exports (`8192` and `16384`) are heavy on browser memory; a desktop browser with plenty of RAM is recommended.
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
| `.mapng` Job Data | Single tile | Save and restore full sessions |
| Heightmap | Batch | 16-bit PNG grayscale terrain |
| Satellite / OSM / Hybrid Texture | Batch | PNG textures |
| Road Mask | Batch | Drivable-road mask PNG |
| GLB / DAE | Batch | Terrain mesh with OSM features |
| BeamNG `.ter` | Batch | BeamNG terrain binary |

## Data Sources

| Source | Purpose |
|---|---|
| AWS Terrarium / SRTM | Standard global elevation |
| USGS TNM Access API | 1 m US elevation where available |
| GUGiK NMT EVRF2007 (Poland) | High-resolution Poland elevation tiles |
| GPXZ | Optional premium higher-resolution elevation |
| Custom upload | Your own DEM: LAZ/LAS, GeoTIFF, ASC, GML/XML (single or multi-tile) |
| Esri World Imagery | Satellite textures and map layers |
| MapNG OSM tiles (Cloudflare R2) | MapNG's own OpenStreetMap copy for hosted regions |
| OpenStreetMap / Overpass | Roads, land use, buildings, water, vegetation, street furniture elsewhere |
| Nominatim | Location search and reverse naming |

## Getting Started

### Requirements

- Node.js 18+
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

## Typical Workflow

1. Pick a location on the map or search by name.
2. Choose an output size, a processing scale (m/px) and an elevation source.
3. Keep Include OSM Features on for roads, buildings, vegetation and everything built from them (turn on Show MapNG OSM coverage to see where MapNG has its own copy).
4. Generate the terrain and check it in the 3D preview.
5. Export the BeamNG level and unzip it into your BeamNG.drive `levels` folder.
6. For larger areas, switch to Batch Job mode and process a tile grid, or stitch one into a combined level.

## BeamNG Level Export

The level ZIP contains:

- terrain (`.ter`) with materials painted from OSM land use and a satellite base texture
- the regional look for the location: grass, ground cover, rocks, water and trees
- textured buildings, bridges, sidewalks with curbs, median islands and power lines as BeamNG shapes
- DecalRoads with markings, crosswalks and stop bars, traffic signals, road signs, street lamps, hydrants, bins and benches
- an AI road network, road names for the minimap, fuel stations and a surrounding backdrop
- `export_report.txt`, a detailed diagnostics report (terrain, roads, every bridge, buildings, street furniture, vegetation, terrain materials and the export's console log), useful when asking for help

## License

[MIT](https://mit-license.org/)
