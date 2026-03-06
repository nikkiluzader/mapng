<div align="center">

# MapNG

**High-Precision Terrain Generator for BeamNG.drive Modding**

[![Vue 3](https://img.shields.io/badge/Vue-3.x-42b883?style=flat-square&logo=vue.js)](https://vuejs.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r162+-black?style=flat-square&logo=three.js)](https://threejs.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.x-38bdf8?style=flat-square&logo=tailwindcss)](https://tailwindcss.com/)
[![Cloudflare Pages](https://img.shields.io/badge/Deployed-Cloudflare%20Pages-f38020?style=flat-square&logo=cloudflare)](https://pages.cloudflare.com/)

</div>

---

## Overview

**MapNG** is a specialized web application that converts real-world geographic data into game-engine-ready terrain assets for **BeamNG.drive** modding. Select any location on Earth, configure your terrain settings, preview the result in an interactive 3D scene, and export high-precision heightmaps, detailed textures, and full 3D models — all at a consistent **1 meter per pixel** scale.

Unlike generic terrain tools, MapNG is purpose-built for vehicle simulation maps: high-resolution height data, accurate metric scaling, integrated road networks with lane-level detail, and procedurally generated 3D buildings and vegetation from OpenStreetMap data.

---

## Features

### Elevation Data Sources

- **Standard (30m Global)** — AWS Terrarium tiles (SRTM). Reliable worldwide coverage, bilinearly upsampled to 1m/px for smooth surfaces.
- **USGS 1m DEM (USA)** — High-precision 1-meter Digital Elevation Models covering CONUS, Alaska, and Hawaii via the TNM Access API. Auto-falls back to Standard if data is missing or corrupt.
- **GPXZ (Premium Global)** — High-resolution global elevation data with auto-chunking for large areas. Automatic plan detection via rate-limit headers enables higher parallel request concurrency for paid accounts. Exponential backoff with `retry-after` header support. Free tier: 100 req/day at 1 req/sec.

---

### Interactive 2D Map

- **Leaflet** map with 3 switchable base layers: OpenStreetMap, Satellite (Esri), and Topographic.
- Dark mode tile support (CARTO dark_all).
- Real-time terrain selection rectangle showing the exact export area.
- Surrounding tile bounding box visualization for multi-tile workflows.
- **Nominatim location search** with dual-endpoint failover, type-categorized location icons, and keyboard navigation.
- Preset scenic locations (Grand Canyon, Mt. Fuji, Tail of the Dragon, and more).

---

### 3D Preview

- **Real-time 3D visualization** powered by Three.js / TresJS with ACES Filmic tone mapping.
- **HDR environment lighting** using a 4K puresky HDRI for realistic ambient and reflection lighting.
- **Cascaded Shadow Maps (CSM)** — 4 cascades, 4096px shadow maps, PCF filtering for smooth shadow edges.
- **6 texture modes**: Satellite, OSM, Hybrid (satellite + road overlay), Segmented Satellite, Segmented Hybrid, and No Texture (clay).
- **Mesh quality selector**: Low / Medium / High vertex density.
- **Wireframe toggle** for mesh inspection.
- **3D OSM features**: Procedurally generated buildings (walls, roofs, windows, vertex colors), 3 tree types (deciduous, coniferous, palm), bushes, and barriers (walls, fences, hedges) — all toggleable per category.
- **Surrounding terrain**: Lazy-loads 8 adjacent low-res tiles in 3D for geographic context.
- **OrbitControls** with damping, camera reset, and clamped rotation.

---

### Procedural OSM Texture Generation

- **Up to 8192×8192 (8K)** procedural textures rendered via HTML5 Canvas.
- **40+ land-use color categories** (water, wetland, forest, farmland, residential, commercial, industrial, military, cemetery, sport, parking, aeroway, and more).
- **Lane-accurate road rendering**: Full lane layout parser per road classification with center lines, lane separators, edge lines, and surface type detection (gravel, dirt, grass = no markings).
- **Junction rendering**: Detects 3+ road intersections, builds polygon fills with Bézier-curved corners, and erases lane markings through junctions.
- **Crosswalk detection**: Where footways cross vehicle roads, renders zebra stripe markings.
- **Chaikin's algorithm** for smooth polyline curves on all road and path segments.
- **Hybrid texture** compositing: Satellite imagery base with semi-transparent road/feature overlay.

---

### Export Formats

| Format | Details |
|---|---|
| **Heightmap** | 16-bit grayscale PNG for maximum elevation precision |
| **Satellite Texture** | High-res PNG from Esri World Imagery (Z17, ~1.2m/px) |
| **OSM Texture** | Up to 8192×8192 procedural PNG with roads, buildings, and land-use |
| **Hybrid Texture** | Up to 8192×8192 PNG — satellite imagery + road/building overlay |
| **Segmented Satellite** | Segmented satellite PNG (reduced visual noise, flatter color regions) |
| **Segmented Hybrid** | Segmented satellite + OSM roads overlay PNG |
| **Road Mask** | 16-bit PNG — white drivable roads on black (excludes footways, paths, cycleways) |
| **GeoTIFF** | Single `.tif` preserving source CRS; merged WGS84 raster for multi-source areas |
| **GeoJSON** | Full OSM vector feature data with proper geometry types |
| **GLB 3D Model** | Terrain mesh export with tile scope options: Center, Center + Surroundings, or Surroundings Only |
| **Collada DAE** | DAE + textures ZIP with the same tile scope options as GLB |
| **BeamNG Terrain** | `.ter` binary heightmap for direct import into BeamNG.drive |
| **Job Data (.mapng)** | Complete compressed session package — heightmap, all textures, OSM vectors, and metadata |

---

### Surrounding Tiles

- Interactive 3×3 grid for selecting up to 8 adjacent tiles (NW, N, NE, W, E, SW, S, SE).
- Configurable satellite quality: Low (Z13), Medium (Z14), Standard (Z15).
- **Download as ZIP** — each tile includes a 16-bit PNG heightmap, satellite PNG, and metadata JSON.
- Selected tiles are visualized as bounding boxes on the 2D map.

---

### Batch Job Mode (Beta)

- Process grids of tiles (up to 20×20) with sequential per-tile processing.
- Each tile automatically downloads a ZIP of all selected export types.
- Persistent state saved to localStorage — supports pause, resume, and retry of failed tiles.
- **Performance profiles**: Max Throughput, Balanced, and Low Memory (8192 Safe) tune internal scheduler and fetch fan-out behavior.
- Live progress modal with color-coded tile grid, satellite thumbnails, progress bar, ETA, and per-tile status.

---

### Additional Features

- **Job Import/Export (.mapng)**: Save the entire state of a terrain job into a compressed package including raw heightmaps, all textures, OSM vectors, and generation metadata. Importing instantly restores the 3D scene and map state without additional API calls.
- **Configuration & Session tools**: Copy, Paste, Save, and Load JSON run configurations in both Single and Batch modes for reproducible reruns.
- **Generation caching**: Skips reprocessing when parameters match the last run. Supports incremental OSM addition (adds roads/features to existing terrain without re-fetching elevation).
- **AbortController support**: Cancel in-progress terrain generation at any time.
- **Web Worker-based processing**: Off-thread terrain and image resampling with transferable ArrayBuffers (falls back to main thread if Workers are unavailable).
- **Dark & light mode** with persistent localStorage preference.
- **Automatic geolocation** on first visit with graceful fallback to a default location.
- **GPXZ plan auto-detection**: Probes rate-limit headers to tune concurrent request limits for paid plans (e.g. Small: 8 concurrent, Large: 20 concurrent).
- **Desktop-only**: Mobile devices are shown a friendly restriction overlay.

---

## Tech Stack

| Category | Technologies |
|---|---|
| **Frontend Framework** | Vue 3 (Composition API) + Vite |
| **Language** | JavaScript (ES6+) |
| **Styling** | Tailwind CSS + Lucide Icons |
| **State** | Pinia + localStorage persistence |
| **3D Engine** | Three.js / TresJS / Cientos |
| **Shadows** | Cascaded Shadow Maps (4 cascades, 4096px, PCF) |
| **Environment** | 4K HDR puresky skybox |
| **Mapping** | Leaflet / Vue-Leaflet |
| **Geocoding** | Nominatim (dual-endpoint with failover) |
| **GIS Processing** | proj4, geotiff.js, Local Transverse Mercator projection |
| **Image Encoding** | fast-png (16-bit), HTML5 Canvas (up to 8192×8192 textures) |
| **3D Export** | Three.js GLTFExporter, Collada DAE serializer |
| **Packaging** | JSZip (batch jobs and surrounding-tile ZIPs) |
| **Performance** | Web Workers (transferable buffers), bilinear resampling |
| **Deployment** | Cloudflare Pages (Wrangler CLI) |

---

## Data Sources

| Source | Coverage | Resolution | Usage |
|---|---|---|---|
| [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) | Global | ~30m (SRTM) | Default elevation |
| [USGS National Map](https://tnmaccess.nationalmap.gov/api/v1/docs) | USA (CONUS, AK, HI) | 1m | High-precision US elevation |
| [GPXZ](https://gpxz.io/) | Global | Variable (high-res) | Premium elevation (API key required) |
| [Esri World Imagery](https://www.esri.com/en-us/arcgis/products/world-imagery) | Global | ~1.2m/px (Z17) | Satellite textures |
| [OpenStreetMap](https://www.openstreetmap.org/) | Global | Vector | Roads, buildings, land-use, vegetation |

---

## Getting Started

### Prerequisites

- **Node.js** (v16 or higher)
- **npm** (v8 or higher)

### Installation

```bash
# Clone the repository
git clone https://github.com/nikkiluzader/mapng.git
cd mapng

# Install dependencies
npm install

# Start the development server
npm run dev
```

Open `http://localhost:5173` in your browser.

### Building for Production

```bash
npm run build
```

Output files are written to the `dist` directory.

### Deploy to Cloudflare Pages

```bash
npm run deploy
```

---

## Usage Guide

### Single Tile Mode

1. **Select a location** — navigate the 2D map, search by name, enter coordinates, or pick a preset location.

2. **Configure output settings**:
   - **Resolution**: 512–8192px. Each pixel = 1 meter on the ground.
   - **Include OSM Features**: fetches road, building, and vegetation data for procedural textures and 3D features.
   - **Elevation Source**: Standard (30m global), USGS (1m USA only), or GPXZ (premium global, API key required).

3. **Generate terrain**:
   - **Preview 3D** — generates data and opens the interactive 3D viewer.
   - **Generate Data** — generates data without switching to 3D; exports are immediately available.

4. **Explore in 3D** (optional):
   - Switch between Satellite, OSM, Hybrid, Segmented, and No Texture modes via the Scene Settings panel.
   - Toggle 3D buildings, trees, barriers, wireframe mode, and surrounding terrain.
   - Adjust mesh quality (Low / Medium / High) and sun positioning.

5. **View terrain stats** — Min/Max elevation, relief range, scale, and total area are displayed as soon as terrain data is available.

6. **Export** — the export panel appears below terrain stats once generation is complete. Expand any category to download:
   - **2D Assets**: Heightmap, Satellite, OSM Texture, Hybrid Texture, Segmented Satellite, Segmented Hybrid, Road Mask
   - **3D Models**: GLB, Collada DAE, BeamNG Terrain (.ter) — with tile scope options for 3D formats
   - **Geo Data**: GeoTIFF, GeoJSON

7. **Surrounding Tiles** (optional) — select adjacent tiles from the 3×3 grid, configure satellite quality, and download as a ZIP.

8. **Configuration & Session** — expand this section (collapsed by default) to:
   - Copy, paste, save, or load a JSON run configuration for reproducibility.
   - Export or import the full session as a `.mapng` job file.

---

### Batch Job Mode (Beta)

1. **Switch to Batch Job** using the mode toggle at the top of the sidebar.
2. **Configure the grid**: set columns, rows (up to 20×20), resolution (512–8192px), and center coordinates.
3. **Select exports**: choose which file types to include in each tile's ZIP package.
4. **Choose a performance profile**: Balanced (default), Max Throughput, or Low Memory 8192 Safe.
5. **Start the batch** — tiles are processed sequentially; each tile's ZIP downloads automatically.
6. **Monitor progress** in the live modal: color-coded tile grid, satellite thumbnails, progress bar, ETA, and per-tile status.
7. **Pause & resume** — close the modal at any time; batch state is saved to localStorage. Failed tiles can be retried individually.

#### Batch Performance Profiles

| Profile | Behaviour |
|---|---|
| **Max Throughput** | Highest concurrency; fastest wall-clock, higher memory usage |
| **Balanced** | Default. Good for most resolutions and network conditions |
| **Low Memory 8192 Safe** | Reduced concurrency and fan-out; recommended for 8192px stability |

#### A/B Benchmark Matrix

To compare profiles on the same machine and network:

1. Set a representative 2×2 grid at **8192** resolution with fixed exports.
2. Run the same job three times, once per profile.
3. After each run, open the progress modal **Details** view and click **Copy Benchmark Report**.
4. Compare the JSON reports across runs:
   - `job.totalDurationSec`
   - `memory.peakUsedBytes`
   - `comparison.compositeScore` (lower is better)

**Scoring formula** (built into each benchmark report):

```
compositeScore = durationSec × 1 + peakMemoryGiB × 120 + failureCount × 900 + queueWaitSec × 0.25
```

Profile selection: exclude any run with failed tiles, then prefer the lowest composite score. If scores are within 10%, prefer the lower peak memory profile. Use Balanced as a tie-breaker.

---

## Run Configuration Schema

MapNG run configurations are plain JSON objects and are forward/backward compatible at schema version 1.

**Used by**: Copy/Paste/Save/Load Configuration (Single + Batch), export `*.metadata.json` sidecars, and batch ZIP `metadata.json` files.

**Compatibility**:
- Accepts either a plain config object or a metadata wrapper containing a `runConfiguration` key.
- Unknown fields are ignored; missing known fields fall back to current UI defaults.
- `schemaVersion > 1` should add a migration step before applying to UI state.

### Single Tile (v1)

```json
{
  "schemaVersion": 1,
  "mode": "single",
  "center": { "lat": 35.1983, "lng": -111.6513 },
  "zoom": 13,
  "resolution": 2048,
  "includeOSM": true,
  "elevationSource": "gpxz",
  "useUSGS": false,
  "useGPXZ": true,
  "gpxzApiKey": "YOUR_API_KEY",
  "gpxzStatus": {
    "plan": "small",
    "used": 120,
    "limit": 2500,
    "remaining": 2380,
    "concurrency": 8,
    "valid": true
  },
  "modelOptions": {
    "tileSelection": "center-only",
    "includeSurroundings": false
  }
}
```

### Batch (v1)

```json
{
  "schemaVersion": 1,
  "mode": "batch",
  "center": { "lat": 35.1983, "lng": -111.6513 },
  "resolution": 1024,
  "gridCols": 3,
  "gridRows": 3,
  "performanceProfile": "balanced",
  "includeOSM": true,
  "elevationSource": "default",
  "gpxzApiKey": "",
  "gpxzStatus": null,
  "exports": {
    "heightmap": true,
    "satellite": true,
    "osmTexture": true,
    "hybridTexture": true,
    "segmentedSatellite": false,
    "segmentedHybrid": false,
    "roadMask": false,
    "glb": false,
    "dae": false,
    "ter": false,
    "geotiff": false,
    "geojson": false
  }
}
```

### Metadata-Wrapped Input

```json
{
  "schemaVersion": 1,
  "build": { "hash": "abc1234", "time": "2026-02-22T12:00:00.000Z" },
  "runConfiguration": {
    "schemaVersion": 1,
    "mode": "single",
    "center": { "lat": 35.1983, "lng": -111.6513 },
    "resolution": 1024,
    "includeOSM": true,
    "elevationSource": "default"
  }
}
```

---

## Disclaimer

All terrain data, heightmaps, textures, and 3D models generated by MapNG are **estimations** based on available satellite and elevation datasets. While high precision is achievable with USGS and GPXZ data, output may not perfectly match real-world dimensions due to projection distortions, data resolution limits, and interpolation. This tool is intended for modding and creative use — not for engineering, navigation, or critical real-world planning.

## License

This project is open-source and available under the [MIT License](https://mit-license.org/).

---

<div align="center">
  <p><i>Built with ❤️ for the BeamNG community</i></p>
</div>
