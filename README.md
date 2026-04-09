<div align="center">

# MapNG

Real-world terrain generation for BeamNG.drive workflows.

[![Vue 3](https://img.shields.io/badge/Vue-3.x-42b883?style=flat-square&logo=vue.js)](https://vuejs.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r162+-black?style=flat-square&logo=three.js)](https://threejs.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.x-38bdf8?style=flat-square&logo=tailwindcss)](https://tailwindcss.com/)
[![Cloudflare Pages](https://img.shields.io/badge/Deployed-Cloudflare%20Pages-f38020?style=flat-square&logo=cloudflare)](https://pages.cloudflare.com/)

</div>

## What MapNG Does

MapNG turns a real-world location into terrain data and BeamNG-friendly assets. Pick a location, generate elevation and optional OSM data, preview it in 3D, and export heightmaps, textures, GIS data, 3D models, BeamNG `.ter` files, or an experimental BeamNG level package.

It is built for modding workflows, not survey-grade terrain reconstruction. The output quality depends heavily on the elevation source, the local OSM coverage, and the export path you choose.

## Current Highlights

- 1 meter per pixel terrain grids from `512` to `8192`
- Multiple elevation sources: global standard DEM, USGS 1 m in the US, and GPXZ
- Satellite, OSM, hybrid, segmented, and road mask texture exports
- 3D preview with buildings, vegetation, barriers, and surrounding terrain
- GLB, DAE, GeoTIFF, GeoJSON, BeamNG `.ter`, and `.mapng` session exports
- Batch jobs for tile grids with offsets, shared elevation baseline, resume support, and stitched verification heightmaps
- Experimental BeamNG level ZIP export with flavor-based official asset selection, terrain materials, water, vegetation, and custom level naming

## Important Notes

- The BeamNG level package export is still experimental.
- OSM-based textures and road overlays are useful for layout reference, but they are not final-quality road art.
- The generated BeamNG level package uses heuristics and official game asset references. Some combinations still need more validation in-game.
- Large exports, especially `4096` and `8192`, can be heavy on browser memory.
- MapNG outputs are intended as a starting point for modding workflows. If you plan to publish to community mod forums, please do additional editing, world-building, optimization, and QA first.

## Community Publishing Guidance

MapNG is designed to help you bootstrap a terrain and quickly explore real places, not to replace full map production.

- For modders: treat MapNG output like a first pass, then continue in your normal level-building workflow.
- For casual users: exporting a local area to drive around is a great use case.
- For public releases: please avoid posting raw, unedited MapNG exports as finished maps.

This helps keep community resource hubs focused on curated, polished releases while still making MapNG useful for prototyping and personal projects.

## Export Types

| Export | Notes |
|---|---|
| Heightmap | 16-bit PNG grayscale terrain |
| Satellite Texture | PNG from Esri World Imagery |
| OSM Texture | Procedural texture from OSM features and land-use |
| Hybrid Texture | Satellite base with OSM overlays |
| Segmented / Segmented Hybrid | Flattened-color texture variants |
| Road Mask | Drivable-road mask PNG |
| GeoTIFF | Terrain raster export |
| GeoJSON | OSM vector feature export |
| GLB / DAE | Terrain mesh with optional surroundings |
| BeamNG `.ter` | BeamNG terrain binary |
| BeamNG Level Package | Experimental playable ZIP export |
| `.mapng` Job Data | Save and restore full sessions |

## Data Sources

| Source | Purpose |
|---|---|
| AWS Terrarium / SRTM | Default global elevation |
| USGS TNM Access API | 1 m US elevation where available |
| GPXZ | Optional premium higher-resolution elevation |
| Esri World Imagery | Satellite textures |
| OpenStreetMap / Overpass | Roads, land-use, buildings, water, vegetation |
| Nominatim | Location search and reverse naming |

## Getting Started

### Requirements

- Node.js 16+
- npm 8+

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
2. Choose a resolution and elevation source.
3. Enable OSM features if you want roads, land-use, buildings, or vegetation-driven outputs.
4. Generate terrain and inspect it in 3D.
5. Export the assets you need.
6. For larger areas, switch to Batch Job mode and process a tile grid.

## BeamNG Export Status

MapNG currently supports two BeamNG-focused outputs:

- `BeamNG Terrain (.ter)` for importing terrain into your own level workflow
- `BeamNG Level Package (.zip)` for a more complete, experimental playable export

The BeamNG level package can now:

- choose a flavor based on an official game level
- infer terrain materials from OSM or segmented imagery
- place water, vegetation, rocks, and ground cover using official assets
- generate a suggested level name from the selected location

That export path is still under active iteration and should be treated as a starting point, not a finished one-click world builder.

## License

[MIT](https://mit-license.org/)
