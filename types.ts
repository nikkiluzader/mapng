export interface LatLng {
  lat: number;
  lng: number;
  tags?: Record<string, string>;
}

export interface Bounds {
    north: number;
    south: number;
    east: number;
    west: number;
}

export interface OSMFeature {
    id: string;
    type: 'road' | 'building' | 'vegetation' | 'water' | 'barrier';
    geometry: LatLng[]; // List of points defining the feature
    holes?: LatLng[][]; // List of inner rings (holes)
    tags?: Record<string, string>;
}

export interface TerrainData {
  heightMap: Float32Array; // The raw height data
  width: number;
  height: number;
  minHeight: number;
  maxHeight: number;
  satelliteTextureUrl?: string; // Optional satellite imagery URL (blob)
  osmTextureUrl?: string; // Optional OSM feature texture URL (blob)
  hybridTextureUrl?: string; // Optional Hybrid (Satellite + OSM Roads/Buildings) texture URL
  bounds: Bounds; // Geographic bounds of the generated area
  osmFeatures: OSMFeature[]; // Vector data
  usgsFallback?: boolean; // Flag indicating if USGS data was missing/corrupt and fallback occurred
  // Raw source GeoTIFF data for passthrough export (preserves original projection)
  sourceGeoTiffs?: {
    arrayBuffers: ArrayBuffer[];
    source: 'gpxz' | 'usgs' | 'global';
  };
}

export interface MapState {
  center: LatLng;
  zoom: number;
}

export interface NominatimResult {
  lat: number;
  lng: number;
  displayName: string;
  type: string;
  boundingBox?: Bounds;
}