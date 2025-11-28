<div align="center">

# MapNG

**High-Performance Terrain Generator for BeamNG.drive Modding**

[![Vue 3](https://img.shields.io/badge/Vue-3.x-42b883?style=flat-square&logo=vue.js)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r160+-black?style=flat-square&logo=three.js)](https://threejs.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.x-38bdf8?style=flat-square&logo=tailwindcss)](https://tailwindcss.com/)
</div>

---

## 📖 Overview

**MapNG** is a specialized web application designed to streamline the creation of real-world terrain maps for **BeamNG.drive**. It allows modders to select any location on Earth, visualize it in 3D with satellite imagery and OpenStreetMap (OSM) features, and export high-precision heightmaps and 3D models ready for game engine import.

Unlike generic terrain tools, MapNG focuses on the specific needs of vehicle simulation maps: high-resolution height data, accurate scale, and integrated road network data.

## ✨ Key Features

- **🌍 Global Coverage**: Access terrain data for anywhere on Earth using AWS Terrain Tiles.
- **🏔️ GPXZ Integration**: Optional support for premium high-resolution global elevation data via GPXZ API.
- **🇺🇸 High-Res USA Data**: Optional integration with USGS National Map for 1-meter resolution DEMs (CONUS, Alaska, Hawaii).
- **🗺️ Precision Selection**: Interactive 2D map (Leaflet) with Satellite, Topo, and OSM layers for precise area selection.
- **🏔️ 3D Preview**: Real-time 3D visualization of the generated terrain using Three.js (via TresJS).
- **🏙️ OSM Integration**: Automatically fetches and renders 3D roads, buildings, and vegetation based on OpenStreetMap data.
- **📏 Accurate Scaling**: Custom Web Mercator implementation ensures pixel-perfect terrain stitching and real-world scale (1:1).
- **💾 Export Options**:
  - **Heightmap**: 16-bit PNG (Grayscale) for maximum elevation precision.
  - **Texture**: High-res satellite imagery (JPG).
  - **3D Model**: Full GLB export including terrain, roads, buildings, and trees.
  - **Vector Data**: GeoJSON export of OSM features.

## 🛠️ Tech Stack

- **Frontend Framework**: Vue 3 (Composition API) + Vite
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **3D Engine**: Three.js / TresJS / Cientos
- **Mapping**: Leaflet / Vue-Leaflet
- **Data Processing**:
  - `fast-png` for 16-bit image encoding
  - `geotiff` & `proj4` for USGS DEM parsing
  - `three-stdlib` for geometry merging and GLTF export

## 🚀 Getting Started

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

To create a production-ready build:

```bash
npm run build
```

The output files will be in the `dist` directory.

## 📖 Usage Guide

1. **Select Location**: Use the 2D map to navigate to your desired location. The dashed orange box indicates the export area.
2. **Configure Settings**:
   - **Resolution**: Choose from 512px (Fast) up to 8192px (Ultra).
   - **OSM Features**: Toggle "Include 3D Features" to fetch roads and buildings.
3. **Generate**:
   - Click **"Preview 3D"** to render the terrain in the browser.
   - Click **"Direct DL"** to skip rendering and prepare files for download.
4. **Export**:
   - Use the export panel to download the **Heightmap (PNG)**, **Satellite Image**, or **GLB Model**.

## 📊 Data Sources

- **Elevation**: 
  - [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Global, ~30m)
  - [USGS National Map](https://tnmaccess.nationalmap.gov/api/v1/docs) (USA, 1m)
  - [GPXZ](https://gpxz.io/) (Global, High-Res)
- **Imagery**: [Esri World Imagery](https://www.esri.com/en-us/arcgis/products/world-imagery)
- **Vector Data**: [OpenStreetMap](https://www.openstreetmap.org/) via Overpass API

## 📄 License

This project is open-source and available under the [MIT License](https://mit-license.org/)

---

<div align="center">
  <p><i>Built with ❤️ for the BeamNG community</i></p>
</div>
