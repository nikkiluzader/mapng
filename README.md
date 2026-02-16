<div align="center">

# MapNG

**High-Performance Terrain Generator for BeamNG.drive Modding**

[![Vue 3](https://img.shields.io/badge/Vue-3.x-42b883?style=flat-square&logo=vue.js)](https://vuejs.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r162+-black?style=flat-square&logo=three.js)](https://threejs.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.x-38bdf8?style=flat-square&logo=tailwindcss)](https://tailwindcss.com/)
[![Cloudflare Pages](https://img.shields.io/badge/Deployed-Cloudflare%20Pages-f38020?style=flat-square&logo=cloudflare)](https://pages.cloudflare.com/)

</div>

---

## Overview

**MapNG** is a specialized web application that converts real-world geographic data into game-engine-ready terrain assets for **BeamNG.drive** modding. Select any location on Earth, configure your terrain settings, preview the result in an interactive 3D scene, and export high-precision heightmaps, detailed textures, and full 3D models — all at a consistent **1 meter per pixel** scale.

Unlike generic terrain tools, MapNG is purpose-built for vehicle simulation maps: high-resolution height data, accurate metric scaling, integrated road networks with lane-level detail, and procedurally generated 3D buildings and vegetation from OpenStreetMap data.

## Key Features

### Elevation Data Sources
- **Standard (30m Global)**: AWS Terrarium tiles (SRTM). Reliable worldwide coverage, bilinearly upsampled to 1m/px for smooth surfaces.
- **USGS 1m DEM (USA)**: High-precision 1-meter resolution Digital Elevation Models covering CONUS, Alaska, and Hawaii via the TNM Access API. Auto-falls back to Standard if data is missing.
- **GPXZ (Premium Global)**: High-resolution global elevation data with auto-chunking for large areas. Automatic plan detection via rate-limit headers enables concurrent requests for paid plans (up to 20× parallel). Exponential backoff with `retry-after` header support. Free tier: 100 req/day at 1 req/sec.

### Interactive 2D Map
- **Leaflet** map with 3 switchable base layers: OpenStreetMap, Satellite (Esri), and Topographic.
- Dark mode tile support (CARTO dark_all).
- Real-time terrain selection rectangle showing the exact export area.
- Surrounding tile bounding box visualization for multi-tile workflows.
- **Nominatim location search** with dual-endpoint failover, 100+ categorized location type icons, and keyboard navigation.
- 13 preset scenic locations (Grand Canyon, Mt. Fuji, Tail of the Dragon, etc.).

### 3D Preview
- **Real-time 3D visualization** powered by Three.js / TresJS with ACES Filmic tone mapping.
- **HDR environment lighting** using a 4K puresky HDRI for realistic ambient and reflection lighting.
- **Cascaded Shadow Maps (CSM)** — 4 cascades, 4096px shadow maps, PCF filtering for smooth shadow edges.
- **4 texture modes**: Satellite, OSM "Blueprint", Hybrid (satellite + road overlay), and bare (sand color).
- **Mesh quality selector**: Low / Medium / High vertex density.
- **Wireframe toggle** for mesh inspection.
- **3D OSM features**: Procedurally generated buildings (with walls, roofs, windows, vertex colors), 3 tree types (deciduous, coniferous, palm), bushes, and barriers (walls, fences, hedges) — all toggleable per category.
- **Surrounding terrain**: Lazy-loads 8 adjacent low-res tiles in 3D for geographic context.
- **OSM base color picker**: 6 presets that live-regenerate the OSM texture without refetching data.
- **OrbitControls** with damping, camera reset, and clamped rotation.

### Procedural OSM Texture Generation
- **16K resolution** procedural textures rendered via HTML5 Canvas.
- **40+ land-use color categories** (water, wetland, forest, farmland, residential, commercial, industrial, military, cemetery, sport, parking, aeroway, etc.).
- **Lane-accurate road rendering**: Full lane layout parser per road classification with center lines, lane separators, edge lines, and surface type detection (gravel, dirt, grass = no markings).
- **Junction rendering**: Detects 3+ road intersections, builds polygon fills with Bézier-curved corners, and erases lane markings through junctions.
- **Crosswalk detection**: Where footways cross vehicle roads, renders zebra stripe markings.
- **Chaikin's algorithm** for smooth polyline curves on all road and path segments.
- **Hybrid texture** compositing: Satellite imagery base with semi-transparent road overlay.

### Export Formats (9 Types)

| Format | Details |
|---|---|
| **Heightmap** | 16-bit PNG (grayscale) for maximum elevation precision |
| **Satellite Texture** | High-res JPG from Esri World Imagery (Z17, ~1.2m/px) |
| **OSM Texture** | 16K procedural "Blueprint" PNG with roads, buildings, land-use |
| **Hybrid Texture** | 16K PNG — satellite imagery + road/building overlay |
| **Road Mask** | 16-bit PNG — white drivable roads on black (excludes footways) |
| **GeoTIFF** | WGS84 or source CRS; multi-tile ZIP for USGS/GPXZ sources |
| **GeoJSON** | Full OSM vector data with proper geometry types |
| **GLB 3D Model** | Complete terrain mesh with optional 8-tile surroundings |
| **Collada DAE** | DAE model with optional texture ZIP packaging |

### Surrounding Tiles
- Interactive 3×3 grid for selecting up to 8 adjacent tiles (NW, N, NE, W, E, SW, S, SE).
- Configurable satellite quality: Low (Z13), Medium (Z14), Standard (Z15).
- **Download as ZIP** — each tile includes: 16-bit PNG heightmap, satellite JPG, metadata JSON, and a global layout info file.
- Maps selected tiles onto the 2D Leaflet map as bounding boxes.

### Additional Features
- **"Mod of the Day"**: Displays the most recently updated map mod from BeamNG.com.
- **Batch Job mode (Beta)**: Process grids of tiles (up to 20×20) with sequential processing, per-tile ZIP downloads, persistent state for pause/resume, and retry for failed tiles.
- **GPXZ plan auto-detection**: Probes rate-limit headers to enable concurrent requests for paid plans (Small: 8×, Large: 20×).
- **Dark & light mode** with persistent localStorage preference.
- **Automatic geolocation** on first visit (with graceful fallback).
- **Generation caching**: Detects when current parameters match the last generation to skip reprocessing. Supports incremental OSM addition without re-fetching terrain.
- **AbortController support** for cancelling long-running generation tasks.
- **Web Worker-based processing**: Off-thread terrain and image resampling with transferable ArrayBuffers (main-thread fallback if Workers are unavailable).
- **Desktop-only**: Mobile devices are shown a friendly restriction overlay.

## Tech Stack

| Category | Technologies |
|---|---|
| **Frontend Framework** | Vue 3 (Composition API) + Vite |
| **Language** | JavaScript (ES6+) |
| **Styling** | Tailwind CSS + Lucide Icons |
| **State** | VueUse composables + localStorage persistence |
| **3D Engine** | Three.js / TresJS / Cientos |
| **Shadows** | Cascaded Shadow Maps (4 cascades, 4096px, PCF) |
| **Environment** | 4K HDR puresky skybox |
| **Mapping** | Leaflet / Vue-Leaflet |
| **Geocoding** | Nominatim (dual-endpoint with failover) |
| **GIS Processing** | proj4, geotiff.js, Local Transverse Mercator projection |
| **Image Encoding** | fast-png (16-bit), HTML5 Canvas (16K textures) |
| **3D Export** | Three.js GLTFExporter |
| **Packaging** | JSZip (batch jobs, multi-tile & GeoTIFF ZIPs) |
| **Performance** | Web Workers (transferable buffers), bilinear resampling |
| **Deployment** | Cloudflare Pages (Wrangler CLI) |

## Getting Started

### Prerequisites

- **Node.js** (v16 or higher)
- **npm** (v8 or higher)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/nikkiluzader/mapng.git
   cd mapng
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the development server**
   ```bash
   npm run dev
   ```
   Open `http://localhost:5173` in your browser.

### Building for Production

```bash
npm run build
```

The output files will be in the `dist` directory.

### Deploy to Cloudflare Pages

```bash
npm run deploy
```

## Usage Guide

1. **Select Location**: Use the 2D map to navigate, search by name, enter coordinates manually, or pick a preset location.
2. **Configure Settings**:
   - **Resolution**: Choose output size (512 – 8192 px). Each pixel = 1 meter.
   - **OSM Features**: Toggle "Include OSM Features" to fetch road, building, and vegetation data.
   - **Elevation Source**: Standard (30m), USGS (1m USA), or GPXZ (Premium Global).
3. **Generate**:
   - **"Preview 3D"**: Generates terrain data and opens the interactive 3D view.
   - **"Generate Data"**: Generates data without switching to 3D — files are immediately ready for download.
4. **Explore in 3D** (optional):
   - Switch between Satellite / OSM / Hybrid / None textures.
   - Toggle 3D buildings, trees, barriers, wireframe, and surrounding terrain.
   - Adjust mesh quality and OSM base color.
5. **Export**: Use the export panel to download any combination of:
   - Heightmap (16-bit PNG), Satellite (JPG), OSM Texture (PNG), Hybrid Texture (PNG)
   - Road Mask (16-bit PNG), GeoTIFF, GeoJSON, GLB Model
6. **Surrounding Tiles** (optional): Select adjacent tiles, configure satellite quality, and download as a ZIP package for multi-tile worlds.

### Batch Job Mode (Beta)

1. **Switch to Batch Job mode** using the mode toggle at the top of the control panel.
2. **Configure the grid**: Set columns and rows (up to 20×20), tile resolution (512–8192px), and center coordinates.
3. **Select exports**: Choose which file types to include in each tile's ZIP package.
4. **Start the batch**: Each tile is processed sequentially — terrain is fetched, exports are generated, and a ZIP is downloaded automatically.
5. **Monitor progress**: A live modal shows a color-coded tile grid with satellite thumbnails, progress bar, ETA, and per-tile status.
6. **Pause & resume**: Close the browser and resume later — batch state is saved to localStorage. Failed tiles can be retried.
7. **GPXZ users**: Paid plan limits are auto-detected, enabling concurrent API requests (up to 20× faster).

## Data Sources

| Source | Coverage | Resolution | Usage |
|---|---|---|---|
| [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) | Global | ~30m (SRTM) | Default elevation data |
| [USGS National Map](https://tnmaccess.nationalmap.gov/api/v1/docs) | USA (CONUS, AK, HI) | 1m | High-precision US elevation |
| [GPXZ](https://gpxz.io/) | Global | Variable (high-res) | Premium elevation (API key) |
| [Esri World Imagery](https://www.esri.com/en-us/arcgis/products/world-imagery) | Global | ~1.2m/px (Z17) | Satellite textures |
| [OpenStreetMap](https://www.openstreetmap.org/) | Global | Vector | Roads, buildings, land-use, vegetation |

## Disclaimer

All terrain data, heightmaps, textures, and 3D models generated by MapNG are **estimations** based on available satellite and elevation datasets. While high precision is achieved with USGS and GPXZ data, output may not perfectly match real-world dimensions due to projection distortions, data resolution limits, and interpolation. This tool is intended for modding and creative use — not for engineering, navigation, or critical real-world planning.

## License

This project is open-source and available under the [MIT License](https://mit-license.org/).

---

<div align="center">
  <p><i>Built with ❤️ for the BeamNG community</i></p>
</div>
