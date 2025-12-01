import * as THREE from 'three';
import { TerrainData, LatLng } from '../types';
// @ts-ignore
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// --- Constants & Helpers (Duplicated from OSMFeatures.vue for consistency) ---
const SCENE_SIZE = 100;
const TILE_SIZE = 256;
const TERRAIN_ZOOM = 15;
const MAX_LATITUDE = 85.05112878;

/**
 * Converts latitude/longitude into a flat 2D pixel coordinate space using Web Mercator
 * at a fixed zoom level. The output coordinates represent positions on a virtual
 * square map grid where one full side spans `TILE_SIZE * 2^zoom` pixels.
 *
 * This projection ensures consistent alignment between terrain height sampling and
 * OSM feature placement by matching the coordinate system used by standard
 * web-mapping tile engines.
 *
 * @param lat — Geographic latitude in degrees
 * @param lng — Geographic longitude in degrees
 * @returns `{ x, y }` — 2D pixel space coordinates on the Mercator world map grid
 */
const latLngToMercator = (lat: number, lng: number) => {
  // --- Mercator math semantics ---
  const LNG_RANGE_OFFSET = 180;       // shifts [-180,180] → [0,360]
  const LNG_FULL_SPAN = 360;          // planet wraps every 360°
  const EQUATOR_Y = 0.5;              // normalized vertical midpoint anchor
  const LAT_SCALE = 0.25;             // 1/4 standard Mercator stretch coefficient
  const DEG_TO_RAD = Math.PI / 180;   // degree → radian conversion factor

  // 1. Clamp latitude to avoid infinite poles
  const latClamped = Math.max(
    Math.min(MAX_LATITUDE, lat),
    -MAX_LATITUDE
  );

  // 2. Precompute sin latitude for Mercator Y distortion curve
  const sinLatitude = Math.sin(latClamped * DEG_TO_RAD);

  // 3. Compute virtual full "world pixel canvas size" at fixed zoom (256 * 2^15)
  const worldPixelSpan = TILE_SIZE * Math.pow(2, TERRAIN_ZOOM);

  // 4. Convert longitude → linear X across the world
  const x = worldPixelSpan * (lng + LNG_RANGE_OFFSET) / LNG_FULL_SPAN;

  // 5. Convert latitude → stretched Y (inverted to match tile coordinates)
  const y = worldPixelSpan * (
    EQUATOR_Y -
    LAT_SCALE * Math.log((1 + sinLatitude) / (1 - sinLatitude)) / Math.PI
  );

  return { x, y };
};

const getTerrainHeight = (data: TerrainData, lat: number, lng: number): number => {
    const p = latLngToMercator(lat, lng);
    const nw = latLngToMercator(data.bounds.north, data.bounds.west);
    
    const localX = p.x - Math.round(nw.x);
    const localY = p.y - Math.round(nw.y);

    if (localX < 0 || localX >= data.width - 1 || localY < 0 || localY >= data.height - 1) {
        return 0;
    }

    const x0 = Math.floor(localX);
    const x1 = x0 + 1;
    const y0 = Math.floor(localY);
    const y1 = y0 + 1;

    const wx = localX - x0;
    const wy = localY - y0;

    const i00 = y0 * data.width + x0;
    const i10 = y0 * data.width + x1;
    const i01 = y1 * data.width + x0;
    const i11 = y1 * data.width + x1;

    const h00 = data.heightMap[i00];
    const h10 = data.heightMap[i10];
    const h01 = data.heightMap[i01];
    const h11 = data.heightMap[i11];

    const h = (1 - wy) * ((1 - wx) * h00 + wx * h10) + wy * ((1 - wx) * h01 + wx * h11);
    
    const latRad = (data.bounds.north + data.bounds.south) / 2 * Math.PI / 180;
    const metersPerDegree = 111320 * Math.cos(latRad);
    const realWidthMeters = (data.bounds.east - data.bounds.west) * metersPerDegree;
    const unitsPerMeter = SCENE_SIZE / realWidthMeters;
    const EXAGGERATION = 1.0;

    return (h - data.minHeight) * unitsPerMeter * EXAGGERATION;
};

const latLngToScene = (data: TerrainData, lat: number, lng: number) => {
    const p = latLngToMercator(lat, lng);
    const nw = latLngToMercator(data.bounds.north, data.bounds.west);
    
    const localX = p.x - Math.round(nw.x);
    const localY = p.y - Math.round(nw.y);
    
    const u = localX / (data.width - 1);
    const v = localY / (data.height - 1);
    
    const sceneX = (u * SCENE_SIZE) - (SCENE_SIZE / 2);
    const sceneZ = (v * SCENE_SIZE) - (SCENE_SIZE / 2);

    return new THREE.Vector3(sceneX, 0, sceneZ);
};

const createRoadGeometry = (points: THREE.Vector3[], width: number) => {
  const geometry = new THREE.BufferGeometry();
  const vertices: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    
    let perpendicular: THREE.Vector3;
    if (i === 0 && points.length > 1) {
      const forward = new THREE.Vector3().subVectors(points[1], points[0]).normalize();
      perpendicular = new THREE.Vector3(-forward.z, 0, forward.x);
    } else if (i === points.length - 1) {
      const forward = new THREE.Vector3().subVectors(points[i], points[i - 1]).normalize();
      perpendicular = new THREE.Vector3(-forward.z, 0, forward.x);
    } else {
      const forward = new THREE.Vector3().subVectors(points[i + 1], points[i - 1]).normalize();
      perpendicular = new THREE.Vector3(-forward.z, 0, forward.x);
    }
    
    const halfWidth = width / 2;
    
    vertices.push(point.x + perpendicular.x * halfWidth, point.y, point.z + perpendicular.z * halfWidth);
    vertices.push(point.x - perpendicular.x * halfWidth, point.y, point.z - perpendicular.z * halfWidth);
    
    const u = i / (points.length - 1);
    uvs.push(0, u);
    uvs.push(1, u);
    
    if (i < points.length - 1) {
      const base = i * 2;
      indices.push(base, base + 2, base + 1);
      indices.push(base + 1, base + 2, base + 3);
    }
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
};

// Create building geometry
const createBuildingGeometry = (points: THREE.Vector3[], holes: THREE.Vector3[][] = [], height: number = 0.5) => {
    const shape = new THREE.Shape();
    points.forEach((p, i) => {
        if (i === 0) shape.moveTo(p.x, -p.z);
        else shape.lineTo(p.x, -p.z);
    });
    
    // Add holes
    holes.forEach(holePoints => {
        const holePath = new THREE.Path();
        holePoints.forEach((p, i) => {
            if (i === 0) holePath.moveTo(p.x, -p.z);
            else holePath.lineTo(p.x, -p.z);
        });
        shape.holes.push(holePath);
    });

    const extrudeSettings = {
        depth: height,
        bevelEnabled: false
    };
    
    return new THREE.ExtrudeGeometry(shape, extrudeSettings);
};const createBarrierGeometry = (points: THREE.Vector3[], width: number, height: number) => {
  const roadGeo = createRoadGeometry(points, width);
  const pos = roadGeo.attributes.position;
  const count = pos.count;
  
  const newVertices: number[] = [];
  const newIndices: number[] = [];
  
  for (let i = 0; i < count; i++) {
      newVertices.push(pos.getX(i), pos.getY(i), pos.getZ(i));
  }
  for (let i = 0; i < count; i++) {
      newVertices.push(pos.getX(i), pos.getY(i) + height, pos.getZ(i));
  }
  
  const indexAttr = roadGeo.index!;
  for (let i = 0; i < indexAttr.count; i+=3) {
      const a = indexAttr.getX(i);
      const b = indexAttr.getX(i+1);
      const c = indexAttr.getX(i+2);
      newIndices.push(a + count, b + count, c + count);
      newIndices.push(a, c, b);
  }
  
  const numPoints = points.length;
  for (let i = 0; i < numPoints - 1; i++) {
      const base = i * 2;
      const next = base + 2;
      newIndices.push(base, next, next + count);
      newIndices.push(base, next + count, base + count);
      newIndices.push(base + 1, base + 1 + count, next + 1 + count);
      newIndices.push(base + 1, next + 1 + count, next + 1);
  }
  
  newIndices.push(0, 1 + count, 1);
  newIndices.push(0, 0 + count, 1 + count);
  const last = (numPoints - 1) * 2;
  newIndices.push(last, last + 1, last + 1 + count);
  newIndices.push(last, last + 1 + count, last + count);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(newVertices, 3));
  geo.setIndex(newIndices);
  geo.computeVertexNormals();
  
  roadGeo.dispose();
  return geo;
};

const createAreaGeometry = (points: THREE.Vector3[], data: TerrainData) => {
    const shape = new THREE.Shape();
    points.forEach((p, i) => {
        if (i === 0) shape.moveTo(p.x, -p.z);
        else shape.lineTo(p.x, -p.z);
    });
    
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    
    const pos = geometry.attributes.position;
    
    // Helper to get height from scene coordinates (duplicated from OSMFeatures.vue logic)
    const getHeightAtScenePos = (x: number, z: number) => {
        const u = (x + SCENE_SIZE/2) / SCENE_SIZE;
        const v = (z + SCENE_SIZE/2) / SCENE_SIZE;
        
        if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
        
        const localX = u * (data.width - 1);
        const localY = v * (data.height - 1);
        
        const x0 = Math.floor(localX);
        const x1 = Math.min(x0 + 1, data.width - 1);
        const y0 = Math.floor(localY);
        const y1 = Math.min(y0 + 1, data.height - 1);

        const wx = localX - x0;
        const wy = localY - y0;

        const i00 = y0 * data.width + x0;
        const i10 = y0 * data.width + x1;
        const i01 = y1 * data.width + x0;
        const i11 = y1 * data.width + x1;

        const h00 = data.heightMap[i00];
        const h10 = data.heightMap[i10];
        const h01 = data.heightMap[i01];
        const h11 = data.heightMap[i11];

        const h = (1 - wy) * ((1 - wx) * h00 + wx * h10) + wy * ((1 - wx) * h01 + wx * h11);
        
        const latRad = (data.bounds.north + data.bounds.south) / 2 * Math.PI / 180;
        const metersPerDegree = 111320 * Math.cos(latRad);
        const realWidthMeters = (data.bounds.east - data.bounds.west) * metersPerDegree;
        const unitsPerMeter = SCENE_SIZE / realWidthMeters;
        const EXAGGERATION = 1.5;

        return (h - data.minHeight) * unitsPerMeter * EXAGGERATION;
    };

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const y = getHeightAtScenePos(x, z);
        pos.setY(i, y + 0.05);
    }
    
    geometry.computeVertexNormals();
    return geometry;
};

/**
 * Helper to generate the Three.js Mesh from TerrainData.
 * Shared by exporters to ensure identical output.
 */
const createTerrainMesh = async (data: TerrainData): Promise<THREE.Mesh> => {
  return new Promise((resolve, reject) => {
    try {
      // 1. Create Geometry
      // Max resolution logic same as Preview3D
      const MAX_MESH_RESOLUTION = 1024;
      const baseStride = Math.ceil(Math.max(data.width, data.height) / MAX_MESH_RESOLUTION);
      const stride = baseStride;

      const segmentsX = Math.floor((data.width - 1) / stride);
      const segmentsY = Math.floor((data.height - 1) / stride);

      const geometry = new THREE.PlaneGeometry(SCENE_SIZE, SCENE_SIZE, segmentsX, segmentsY);
      const vertices = geometry.attributes.position.array;

      // Calculate scale factor (units per meter)
      const latRad = (data.bounds.north + data.bounds.south) / 2 * Math.PI / 180;
      const metersPerDegree = 111320 * Math.cos(latRad);
      const realWidthMeters = (data.bounds.east - data.bounds.west) * metersPerDegree;
      const unitsPerMeter = SCENE_SIZE / realWidthMeters;
      const EXAGGERATION = 1.5;

      // Apply heightmap data to vertices
      for (let i = 0; i < vertices.length / 3; i++) {
        const col = i % (segmentsX + 1);
        const row = Math.floor(i / (segmentsX + 1));

        const mapCol = Math.min(col * stride, data.width - 1);
        const mapRow = Math.min(row * stride, data.height - 1);

        const dataIndex = mapRow * data.width + mapCol;

        // Apply height (Z)
        // @ts-ignore
        vertices[i * 3 + 2] = (data.heightMap[dataIndex] - data.minHeight) * unitsPerMeter * EXAGGERATION;
      }

      geometry.computeVertexNormals();

      // 2. Create Material
      const material = new THREE.MeshStandardMaterial({
        roughness: 1,
        metalness: 0,
        side: THREE.DoubleSide,
        color: 0xffffff
      });

      // 3. Helper to finalize mesh with texture
      const finalize = (tex?: THREE.Texture) => {
        if (tex) {
            material.map = tex;
        }
        const mesh = new THREE.Mesh(geometry, material);
        // Rotate to make it lie flat (Y-up) in standard 3D viewers
        mesh.rotation.x = -Math.PI / 2;
        mesh.updateMatrixWorld();
        resolve(mesh);
      };

      // 4. Load Texture (Async)
      if (data.satelliteTextureUrl) {
        const loader = new THREE.TextureLoader();
        loader.load(
          data.satelliteTextureUrl,
          (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;
            finalize(tex);
          },
          undefined,
          (err) => {
            console.warn("Failed to load texture, exporting mesh only.", err);
            finalize();
          }
        );
      } else {
        finalize();
      }
    } catch (e) {
      reject(e);
    }
  });
};

const createOSMGroup = (data: TerrainData): THREE.Group => {
    const group = new THREE.Group();
    if (!data.osmFeatures || data.osmFeatures.length === 0) return group;

    const latRad = (data.bounds.north + data.bounds.south) / 2 * Math.PI / 180;
    const metersPerDegree = 111320 * Math.cos(latRad);
    const realWidthMeters = (data.bounds.east - data.bounds.west) * metersPerDegree;
    const unitsPerMeter = SCENE_SIZE / realWidthMeters;

    const roadsList: any[] = [];
    const buildingsList: any[] = [];
    const treesList: THREE.Vector3[] = [];
    const bushesList: THREE.Vector3[] = [];
    const barriersList: any[] = [];
    const areasList: any[] = [];

    // Helper to determine road properties
    const getRoadConfig = (tags: any) => {
        const type = tags.highway;
        const isBridge = tags.bridge || tags.man_made === 'bridge';
        let widthMeters = 6;
        let color = 0x454545; // Unified Road Color
        let ignore = false;
        let offset = 0.1; // Unified Road Offset

        switch (type) {
            case 'motorway': case 'trunk': case 'primary':
                widthMeters = 12; break;
            case 'secondary': case 'tertiary':
                widthMeters = 10; break;
            case 'residential': case 'unclassified': case 'living_street':
                widthMeters = 8; break;
            case 'service':
                widthMeters = 4; break;
            case 'footway': case 'path': case 'cycleway': case 'steps': case 'pedestrian': case 'track':
                widthMeters = 2; color = 0xE0E0E0; offset = 0.15; break;
        }
        return { width: widthMeters * unitsPerMeter, color, ignore, isBridge, offset: offset * unitsPerMeter };
    };

    const getBarrierConfig = (tags: any) => {
        const type = tags.barrier;
        let height = 1.5 * unitsPerMeter;
        let width = 0.2 * unitsPerMeter;
        let color = 0x888888;

        if (type === 'wall' || type === 'city_wall' || type === 'retaining_wall') {
            color = 0xaaaaaa;
            height = (type === 'city_wall' ? 4 : 2) * unitsPerMeter;
            width = 0.5 * unitsPerMeter;
        } else if (type === 'fence' || type === 'gate') {
            color = 0x8b4513;
            if (tags.material === 'metal' || tags.material === 'chain_link') color = 0x555555;
            height = 1.5 * unitsPerMeter;
            width = 0.1 * unitsPerMeter;
        } else if (type === 'hedge') {
            color = 0x228b22;
            height = 1.2 * unitsPerMeter;
            width = 0.8 * unitsPerMeter;
        }
        
        return { height, width, color };
    };

    const getAreaConfig = (tags: any) => {
        let color = 0x000000;
        let valid = false;
        
        if (tags.natural === 'wetland') {
            color = 0x3e4e40;
            valid = true;
        } else if (tags.landuse === 'grass' || tags.landuse === 'meadow' || tags.natural === 'grassland' || tags.natural === 'heath' || tags.landuse === 'park') {
            color = 0x90ee90;
            if (tags.natural === 'heath') color = 0xd2b48c;
            valid = true;
        } else if (tags.natural === 'sand' || tags.natural === 'beach') {
            color = 0xf4a460; // Sandy brown
            valid = true;
        } else if (tags.natural === 'bare_rock' || tags.natural === 'scree' || tags.landuse === 'quarry') {
            color = 0x808080; // Grey
            valid = true;
        } else if (tags.natural === 'dirt') {
            color = 0x8b4513; // Saddle brown
            valid = true;
        }
        
        return { color, valid };
    };

    const getBuildingConfig = (tags: any, areaMeters: number = 0) => {
        let height = 0;
        let minHeight = 0;
        let color = 0xe2e8f0; // default white/grey
        
        if (tags.height) {
            height = parseFloat(tags.height);
        } else if (tags['building:levels']) {
            height = parseFloat(tags['building:levels']) * 3;
        } else {
            // Infer height from building type if explicit height is missing
            const type = tags.building;
            if (type === 'house' || type === 'detached' || type === 'bungalow' || type === 'residential') {
                height = 6 + (Math.random() * 2 - 1); // ~2 stories
            } else if (type === 'garage' || type === 'garages' || type === 'shed' || type === 'roof') {
                height = 3 + (Math.random() * 1 - 0.5); // 1 story
            } else if (type === 'apartments' || type === 'office' || type === 'commercial' || type === 'hotel') {
                height = 14 + (Math.random() * 4 - 2); // ~4-5 stories
            } else if (type === 'industrial' || type === 'warehouse' || type === 'retail') {
                height = 8 + (Math.random() * 2 - 1);
            } else if (type === 'church' || type === 'cathedral') {
                height = 20 + (Math.random() * 5); // Taller churches
            } else if (type === 'civic' || type === 'public' || type === 'hospital' || type === 'university') {
                height = 12 + (Math.random() * 3);
            } else {
                // Generic building=yes or similar
                // Use area heuristic
                if (areaMeters > 2000) {
                    height = 16 + (Math.random() * 4); // Large commercial/public
                } else if (areaMeters > 500) {
                    height = 10 + (Math.random() * 3); // Medium commercial
                } else if (areaMeters < 50) {
                    height = 3 + (Math.random() * 1); // Small shed/garage
                } else {
                    height = 6 + (Math.random() * 2); // Standard house/shop
                }
                
                // Boost for specific amenities if generic building tag
                if (tags.amenity === 'bank' || tags.tourism === 'hotel') {
                    height += 6;
                }
                if (tags.amenity === 'place_of_worship') {
                    height += 8;
                }
            }
        }
        
        if (isNaN(height)) height = 6;
        
        if (tags.min_height) {
            minHeight = parseFloat(tags.min_height);
        } else if (tags['building:min_level']) {
            minHeight = parseFloat(tags['building:min_level']) * 3;
        }
        if (isNaN(minHeight)) minHeight = 0;
  
        if (tags['building:colour']) {
            color = new THREE.Color(tags['building:colour']).getHex();
        }
        
        return { height: height * unitsPerMeter, minHeight: minHeight * unitsPerMeter, color };
    };

    // Helper to resample path for better terrain draping
    const resamplePath = (points: LatLng[], maxLenMeters: number = 5): LatLng[] => {
        const result: LatLng[] = [];
        if (points.length < 2) return points;
        
        result.push(points[0]);
        
        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i+1];
            
            // Approximate distance in meters
            const R = 6371e3;
            const φ1 = p1.lat * Math.PI/180;
            const φ2 = p2.lat * Math.PI/180;
            const Δφ = (p2.lat-p1.lat) * Math.PI/180;
            const Δλ = (p2.lng-p1.lng) * Math.PI/180;
            const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                      Math.cos(φ1) * Math.cos(φ2) *
                      Math.sin(Δλ/2) * Math.sin(Δλ/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            const d = R * c;
            
            if (d > maxLenMeters) {
                const segments = Math.ceil(d / maxLenMeters);
                for (let j = 1; j < segments; j++) {
                    const t = j / segments;
                    result.push({
                        lat: p1.lat + (p2.lat - p1.lat) * t,
                        lng: p1.lng + (p2.lng - p1.lng) * t
                    });
                }
            }
            result.push(p2);
        }
        return result;
    };

    data.osmFeatures.forEach((f: any) => {
        if (!f.geometry[0]) return;

        if (f.type === 'road' && f.geometry.length >= 2) {
            const config = getRoadConfig(f.tags);
            if (config.ignore) return;

            let points: THREE.Vector3[];
            
            if (config.isBridge) {
                const startP = f.geometry[0];
                const endP = f.geometry[f.geometry.length - 1];
                const startH = getTerrainHeight(data, startP.lat, startP.lng);
                const endH = getTerrainHeight(data, endP.lat, endP.lng);
                
                points = f.geometry.map((p: LatLng, i: number) => {
                    const vec = latLngToScene(data, p.lat, p.lng);
                    const t = i / (f.geometry.length - 1);
                    vec.y = (startH * (1 - t) + endH * t) + (0.5 * unitsPerMeter);
                    return vec;
                });
            } else {
                // Resample road points to drape better over terrain
                const resampled = resamplePath(f.geometry, 1); // Resample every 1 meter
                points = resampled.map((p: LatLng) => {
                    const vec = latLngToScene(data, p.lat, p.lng);
                    vec.y = getTerrainHeight(data, p.lat, p.lng) + config.offset;
                    return vec;
                });
            }
            roadsList.push({ points, width: config.width, color: config.color });
        }
        else if (f.type === 'building' && f.geometry.length > 2) {
            const points = f.geometry.map((p: LatLng) => latLngToScene(data, p.lat, p.lng));
            
            // Calculate area in meters
            let area = 0;
            for (let i = 0; i < points.length; i++) {
                const j = (i + 1) % points.length;
                area += points[i].x * points[j].z;
                area -= points[j].x * points[i].z;
            }
            area = Math.abs(area) / 2;
            const areaMeters = area / (unitsPerMeter * unitsPerMeter);

            const config = getBuildingConfig(f.tags, areaMeters);
            
            const holes = f.holes ? f.holes.map((hole: LatLng[]) => {
                return hole.map(p => latLngToScene(data, p.lat, p.lng));
            }) : [];

            let avgHeight = 0;
            f.geometry.forEach((p: LatLng) => { avgHeight += getTerrainHeight(data, p.lat, p.lng); });
            avgHeight /= f.geometry.length;
            
            const y = avgHeight + config.minHeight;
            // Ensure minimum height is small enough to allow variation (e.g. 0.1 units instead of 1.0)
            const depth = Math.max(0.1, config.height - config.minHeight);

            buildingsList.push({ points, holes, y, height: depth, color: config.color });
        }
        else if (f.type === 'barrier' && f.geometry.length >= 2) {
            const config = getBarrierConfig(f.tags);
            const points = f.geometry.map((p: LatLng) => {
                const vec = latLngToScene(data, p.lat, p.lng);
                vec.y = getTerrainHeight(data, p.lat, p.lng);
                return vec;
            });
            barriersList.push({ points, originalPoints: f.geometry, width: config.width, height: config.height, color: config.color });
        }
        else if (f.type === 'vegetation') {
            const isTree = f.tags.natural === 'tree' || f.tags.natural === 'wood' || f.tags.landuse === 'forest' || f.tags.natural === 'tree_row';
            const areaConfig = getAreaConfig(f.tags);

            if (areaConfig.valid && f.geometry.length > 2) {
                const points = f.geometry.map((p: LatLng) => {
                    const vec = latLngToScene(data, p.lat, p.lng);
                    vec.y = getTerrainHeight(data, p.lat, p.lng);
                    return vec;
                });
                areasList.push({ points, color: areaConfig.color });
            } else {
                f.geometry.forEach((p: LatLng) => {
                    const vec = latLngToScene(data, p.lat, p.lng);
                    vec.y = getTerrainHeight(data, p.lat, p.lng);
                    if (isTree) {
                        treesList.push(vec);
                    } else {
                        bushesList.push(vec);
                    }
                });
            }
        }
    });

    // Helper for vertex colors
    const addColor = (geo: THREE.BufferGeometry, colorHex: number) => {
        const count = geo.attributes.position.count;
        const colors = new Float32Array(count * 3);
        const color = new THREE.Color(colorHex);
        for (let i = 0; i < count; i++) {
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    };

    // Create Road Mesh
    if (roadsList.length > 0) {
        const geometries: THREE.BufferGeometry[] = [];
        roadsList.forEach(road => {
            const geo = createRoadGeometry(road.points, road.width);
            addColor(geo, road.color);
            geometries.push(geo);
        });
        if (geometries.length > 0) {
            const merged = mergeGeometries(geometries);
            const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.05, side: THREE.DoubleSide });
            const mesh = new THREE.Mesh(merged, material);
            group.add(mesh);
        }
    }

    // Create Building Mesh
    if (buildingsList.length > 0) {
        const geometries: THREE.BufferGeometry[] = [];
        buildingsList.forEach(building => {
            const geo = createBuildingGeometry(building.points, building.holes, building.height);
            geo.rotateX(-Math.PI / 2);
            geo.translate(0, building.y, 0);
            
            // Add color attribute
            const count = geo.attributes.position.count;
            const colors = new Float32Array(count * 3);
            const color = new THREE.Color(building.color);
            for(let i=0; i<count; i++) {
                colors[i*3] = color.r;
                colors[i*3+1] = color.g;
                colors[i*3+2] = color.b;
            }
            geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            
            geometries.push(geo);
        });
        if (geometries.length > 0) {
            const merged = mergeGeometries(geometries);
            const material = new THREE.MeshStandardMaterial({ vertexColors: true });
            const mesh = new THREE.Mesh(merged, material);
            group.add(mesh);
        }
    }

    // Create Barrier Mesh
    if (barriersList.length > 0) {
        const geometries: THREE.BufferGeometry[] = [];
        barriersList.forEach(barrier => {
            const geo = createBarrierGeometry(barrier.points, barrier.width, barrier.height);
            addColor(geo, barrier.color);
            geometries.push(geo);
        });
        if (geometries.length > 0) {
            const merged = mergeGeometries(geometries);
            const material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide });
            const mesh = new THREE.Mesh(merged, material);
            group.add(mesh);
        }
    }

    // Create Area Mesh
    if (areasList.length > 0) {
        const geometries: THREE.BufferGeometry[] = [];
        areasList.forEach(area => {
            const geo = createAreaGeometry(area.points, data);
            addColor(geo, area.color);
            geometries.push(geo);
        });
        if (geometries.length > 0) {
            const merged = mergeGeometries(geometries);
            const material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide });
            const mesh = new THREE.Mesh(merged, material);
            group.add(mesh);
        }
    }



    // Create Trees (Merged Mesh with Vertex Colors)
    if (treesList.length > 0) {
        const geometries: THREE.BufferGeometry[] = [];
        
        const baseTrunk = new THREE.CylinderGeometry(0.5 * unitsPerMeter, 0.5 * unitsPerMeter, 6.0 * unitsPerMeter, 8);
        const baseFoliage = new THREE.SphereGeometry(3.5 * unitsPerMeter, 16, 16);

        addColor(baseTrunk, 0x5d4037);
        addColor(baseFoliage, 0x22c55e);

        const matrix = new THREE.Matrix4();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3(1, 1, 1);
        const position = new THREE.Vector3();

        treesList.forEach((pos) => {
            // Trunk
            const trunk = baseTrunk.clone();
            position.set(pos.x, pos.y + (3.0 * unitsPerMeter), pos.z);
            matrix.compose(position, quaternion, scale);
            trunk.applyMatrix4(matrix);
            geometries.push(trunk);

            // Foliage
            const foliage = baseFoliage.clone();
            position.set(pos.x, pos.y + (7.0 * unitsPerMeter), pos.z);
            matrix.compose(position, quaternion, scale);
            foliage.applyMatrix4(matrix);
            geometries.push(foliage);
        });

        if (geometries.length > 0) {
            const merged = mergeGeometries(geometries);
            const material = new THREE.MeshStandardMaterial({ 
                vertexColors: true, 
                roughness: 0.9 
            });
            const mesh = new THREE.Mesh(merged, material);
            mesh.name = "Trees";
            group.add(mesh);
        }
    }

    // Create Bushes (Merged Mesh with Vertex Colors)
    if (bushesList.length > 0) {
        const geometries: THREE.BufferGeometry[] = [];
        const baseBush = new THREE.SphereGeometry(1.5 * unitsPerMeter, 8, 8);
        
        addColor(baseBush, 0x86efac);

        const matrix = new THREE.Matrix4();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3(1, 1, 1);
        const position = new THREE.Vector3();

        bushesList.forEach((pos) => {
            const bush = baseBush.clone();
            position.set(pos.x, pos.y + (1.0 * unitsPerMeter), pos.z);
            matrix.compose(position, quaternion, scale);
            bush.applyMatrix4(matrix);
            geometries.push(bush);
        });

        if (geometries.length > 0) {
            const merged = mergeGeometries(geometries);
            const material = new THREE.MeshStandardMaterial({ 
                vertexColors: true, 
                roughness: 0.9 
            });
            const mesh = new THREE.Mesh(merged, material);
            mesh.name = "Bushes";
            group.add(mesh);
        }
    }

    return group;
};

export const exportToGLB = async (data: TerrainData): Promise<void> => {
  const terrainMesh = await createTerrainMesh(data);
  const osmGroup = createOSMGroup(data);
  
  const scene = new THREE.Scene();
  scene.add(terrainMesh);
  scene.add(osmGroup);
  
  // Dynamic import for GLTFExporter
  // Using 'three/examples/jsm/...' ensures compatibility with the installed 'three' package
  // @ts-ignore
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter();
    exporter.parse(
      scene,
      (gltf: any) => {
        const blob = new Blob([gltf as ArrayBuffer], { type: 'model/gltf-binary' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        const date = new Date().toISOString().slice(0, 10);
        link.download = `MapNG_Model_${date}.glb`;
        link.click();
        URL.revokeObjectURL(link.href);
        resolve();
      },
      (err: any) => reject(err),
      { binary: true }
    );
  });
};