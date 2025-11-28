<script setup lang="ts">
import { shallowRef, watch, ref, toRaw, markRaw, computed } from 'vue';
import * as THREE from 'three';
import { TerrainData, LatLng } from '../types';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

interface Props {
  terrainData: TerrainData;
}

const props = defineProps<Props>();

const SCENE_SIZE = 100;
const TILE_SIZE = 256;
const TERRAIN_ZOOM = 15;
const MAX_LATITUDE = 85.05112878;

const project = (lat: number, lng: number) => {
  const d = Math.PI / 180;
  const max = MAX_LATITUDE;
  const latClamped = Math.max(Math.min(max, lat), -max);
  const sin = Math.sin(latClamped * d);

  const z = TILE_SIZE * Math.pow(2, TERRAIN_ZOOM);
  
  const x = z * (lng + 180) / 360;
  const y = z * (0.5 - 0.25 * Math.log((1 + sin) / (1 - sin)) / Math.PI);

  return { x, y };
};

const getTerrainHeight = (lat: number, lng: number): number => {
    const data = toRaw(props.terrainData);
    const p = project(lat, lng);
    const nw = project(data.bounds.north, data.bounds.west);
    
    // Use round instead of floor to snap correctly to the integer pixel grid
    // This fixes misalignment at high resolutions where float precision causes floor to be off by 1
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
    
    // Calculate scale factor (units per meter)
    const latRad = (data.bounds.north + data.bounds.south) / 2 * Math.PI / 180;
    const metersPerDegree = 111320 * Math.cos(latRad);
    const realWidthMeters = (data.bounds.east - data.bounds.west) * metersPerDegree;
    const unitsPerMeter = SCENE_SIZE / realWidthMeters;
    const EXAGGERATION = 1.5;

    return (h - data.minHeight) * unitsPerMeter * EXAGGERATION;
};

const latLngToScene = (lat: number, lng: number) => {
    const data = toRaw(props.terrainData);
    const p = project(lat, lng);
    const nw = project(data.bounds.north, data.bounds.west);
    
    // Use round instead of floor to snap correctly to the integer pixel grid
    const localX = p.x - Math.round(nw.x);
    const localY = p.y - Math.round(nw.y);
    
    const u = localX / (data.width - 1);
    const v = localY / (data.height - 1);
    
    const sceneX = (u * SCENE_SIZE) - (SCENE_SIZE / 2);
    const sceneZ = (v * SCENE_SIZE) - (SCENE_SIZE / 2);

    return new THREE.Vector3(sceneX, 0, sceneZ);
};

// Create flat ribbon geometry for roads
const createRoadGeometry = (points: THREE.Vector3[], width: number) => {
  const geometry = new THREE.BufferGeometry();
  const vertices: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    
    // Calculate perpendicular direction for road width
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
    
    // Left vertex
    vertices.push(
      point.x + perpendicular.x * halfWidth,
      point.y,
      point.z + perpendicular.z * halfWidth
    );
    
    // Right vertex
    vertices.push(
      point.x - perpendicular.x * halfWidth,
      point.y,
      point.z - perpendicular.z * halfWidth
    );
    
    // UVs
    const u = i / (points.length - 1);
    uvs.push(0, u);
    uvs.push(1, u);
    
    // Create triangles (except for last point)
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
};

// Create barrier geometry (extruded wall)
const createBarrierGeometry = (points: THREE.Vector3[], width: number, height: number) => {
  const roadGeo = createRoadGeometry(points, width);
  const pos = roadGeo.attributes.position;
  const count = pos.count;
  
  // We need to duplicate vertices for top
  const newVertices: number[] = [];
  const newIndices: number[] = [];
  
  // Bottom vertices (original)
  for (let i = 0; i < count; i++) {
      newVertices.push(pos.getX(i), pos.getY(i), pos.getZ(i));
  }
  // Top vertices
  for (let i = 0; i < count; i++) {
      newVertices.push(pos.getX(i), pos.getY(i) + height, pos.getZ(i));
  }
  
  // Indices from roadGeo (bottom face - flip winding?)
  // roadGeo is Y-up.
  // We want bottom face pointing down?
  // Actually, we can just ignore bottom/top faces if we only care about sides for fences?
  // But for walls we want top.
  
  // Top face
  const indexAttr = roadGeo.index!;
  for (let i = 0; i < indexAttr.count; i+=3) {
      const a = indexAttr.getX(i);
      const b = indexAttr.getX(i+1);
      const c = indexAttr.getX(i+2);
      // Offset by count for top vertices
      newIndices.push(a + count, b + count, c + count);
      
      // Bottom face (reverse winding)
      newIndices.push(a, c, b);
  }
  
  // Side faces
  // The road geometry is a strip.
  // Vertices are organized as pairs (left, right) along the path?
  // createRoadGeometry:
  // vertices.push(left); vertices.push(right);
  // So 0,1 is start, 2,3 is next...
  const numPoints = points.length;
  for (let i = 0; i < numPoints - 1; i++) {
      const base = i * 2;
      const next = base + 2;
      
      // Left side: base -> next
      // Bottom: base, next
      // Top: base+count, next+count
      // Face: base, next, next+count, base+count
      newIndices.push(base, next, next + count);
      newIndices.push(base, next + count, base + count);
      
      // Right side: base+1 -> next+1
      // Bottom: base+1, next+1
      // Top: base+1+count, next+1+count
      // Face: base+1, base+1+count, next+1+count, next+1 (winding?)
      newIndices.push(base + 1, base + 1 + count, next + 1 + count);
      newIndices.push(base + 1, next + 1 + count, next + 1);
  }
  
  // End caps?
  // Start: 0, 1, 1+count, 0+count
  newIndices.push(0, 1 + count, 1);
  newIndices.push(0, 0 + count, 1 + count);
  
  // End: last, last+1...
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

// Create area geometry (flat polygon)
const createAreaGeometry = (points: THREE.Vector3[]) => {
    const shape = new THREE.Shape();
    points.forEach((p, i) => {
        if (i === 0) shape.moveTo(p.x, -p.z);
        else shape.lineTo(p.x, -p.z);
    });
    
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    
    // Adjust height to match terrain
    const pos = geometry.attributes.position;
    const data = toRaw(props.terrainData);
    
    // Helper to get height from scene coordinates
    const getHeightAtScenePos = (x: number, z: number) => {
        // Inverse of latLngToScene logic
        // sceneX = (u * SCENE_SIZE) - (SCENE_SIZE / 2)
        // u = (sceneX + SCENE_SIZE/2) / SCENE_SIZE
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
        
        // Calculate scale factor (units per meter)
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
        pos.setY(i, y + 0.05); // Very slight offset to avoid z-fighting but sit flat
    }
    
    geometry.computeVertexNormals();
    return geometry;
};

// Process OSM features
const features = shallowRef({ roads: [], buildings: [], trees: [], bushes: [], barriers: [], areas: [] } as { roads: any[], buildings: any[], trees: THREE.Vector3[], bushes: THREE.Vector3[], barriers: any[], areas: any[] });
const unitsPerMeter = ref(0.1);

watch(() => props.terrainData, () => {
  const data = toRaw(props.terrainData);
  const roadsList: any[] = [];
  const buildingsList: any[] = [];
  const treesList: THREE.Vector3[] = [];
  const bushesList: THREE.Vector3[] = [];
  const barriersList: any[] = [];
  const areasList: any[] = [];

  if (!data.osmFeatures) {
      features.value = { roads: roadsList, buildings: buildingsList, trees: treesList, bushes: bushesList, barriers: barriersList, areas: areasList };
      return;
  }

  // Calculate scale factor
  const latRad = (data.bounds.north + data.bounds.south) / 2 * Math.PI / 180;
  const metersPerDegree = 111320 * Math.cos(latRad);
  const realWidthMeters = (data.bounds.east - data.bounds.west) * metersPerDegree;
  unitsPerMeter.value = SCENE_SIZE / realWidthMeters;

  // Helper to determine road properties
  const getRoadConfig = (tags: any) => {
    const type = tags.highway;
    const isBridge = tags.bridge || tags.man_made === 'bridge';
    let widthMeters = 6; // Default 6m
    let color = 0x454545; // Unified Road Color
    let ignore = false;
    let offset = 0.1; // Unified Road Offset

    switch (type) {
        case 'motorway':
        case 'trunk':
        case 'primary':
            widthMeters = 12;
            break;
        case 'secondary':
        case 'tertiary':
            widthMeters = 10;
            break;
        case 'residential':
        case 'unclassified':
        case 'living_street':
            widthMeters = 8;
            break;
        case 'service':
            widthMeters = 4;
            break;
        case 'footway':
        case 'path':
        case 'cycleway':
        case 'steps':
        case 'pedestrian':
        case 'track':
            widthMeters = 2;
            color = 0xE0E0E0; // Unified Path Color
            offset = 0.15; // Unified Path Offset (above roads)
            break;
    }
    return { width: widthMeters * unitsPerMeter.value, color, ignore, isBridge, offset: offset * unitsPerMeter.value };
  };

  const getBarrierConfig = (tags: any) => {
      const type = tags.barrier;
      let height = 1.5 * unitsPerMeter.value;
      let width = 0.2 * unitsPerMeter.value;
      let color = 0x888888; // Default gray

      if (type === 'wall' || type === 'city_wall' || type === 'retaining_wall') {
          color = 0xaaaaaa; // Light gray/stone
          height = (type === 'city_wall' ? 4 : 2) * unitsPerMeter.value;
          width = 0.5 * unitsPerMeter.value;
      } else if (type === 'fence' || type === 'gate') {
          color = 0x8b4513; // Wood brown default
          if (tags.material === 'metal' || tags.material === 'chain_link') color = 0x555555;
          height = 1.5 * unitsPerMeter.value;
          width = 0.1 * unitsPerMeter.value;
      } else if (type === 'hedge') {
          color = 0x228b22; // Forest green
          height = 1.2 * unitsPerMeter.value;
          width = 0.8 * unitsPerMeter.value;
      }
      
      return { height, width, color };
  };

  const getAreaConfig = (tags: any) => {
      let color = 0x000000;
      let valid = false;
      
      if (tags.natural === 'wetland') {
          color = 0x3e4e40; // Swampy brownish green
          valid = true;
      } else if (tags.landuse === 'grass' || tags.landuse === 'meadow' || tags.natural === 'grassland' || tags.natural === 'heath' || tags.landuse === 'park') {
          color = 0x90ee90; // Light green
          if (tags.natural === 'heath') color = 0xd2b48c; // Tan
          valid = true;
      } else if (tags.natural === 'sand' || tags.natural === 'beach') {
          color = 0xf4a460; // Sandy brown
          valid = true;
      } else if (tags.natural === 'bare_rock' || tags.natural === 'scree' || tags.landuse === 'quarry') {
          color = 0x808080; // Gray
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
      
      return { height: height * unitsPerMeter.value, minHeight: minHeight * unitsPerMeter.value, color };
  };

  data.osmFeatures.forEach((f: any) => {
    if (!f.geometry[0]) return;

    if (f.type === 'road' && f.geometry.length >= 2) {
      const config = getRoadConfig(f.tags);
      
      if (config.ignore) return;

      let points: THREE.Vector3[];

      if (config.isBridge) {
          // Bridge logic: Linear interpolation between start and end height
          const startP = f.geometry[0];
          const endP = f.geometry[f.geometry.length - 1];
          const startH = getTerrainHeight(startP.lat, startP.lng);
          const endH = getTerrainHeight(endP.lat, endP.lng);
          
          points = f.geometry.map((p: LatLng, i: number) => {
            const vec = latLngToScene(p.lat, p.lng);
            const t = i / (f.geometry.length - 1);
            // Interpolate height, add offset
            vec.y = (startH * (1 - t) + endH * t) + (0.5 * unitsPerMeter.value); 
            return vec;
          });
      } else {
          points = f.geometry.map((p: LatLng) => {
            const vec = latLngToScene(p.lat, p.lng);
            vec.y = getTerrainHeight(p.lat, p.lng) + config.offset;
            return vec;
          });
      }
      
      roadsList.push({ id: f.id, points, width: config.width, color: config.color });
    }
    else if (f.type === 'building' && f.geometry.length > 2) {
      const points = f.geometry.map((p: LatLng) => {
        const vec = latLngToScene(p.lat, p.lng);
        return vec;
      });

      // Calculate area in meters
      let area = 0;
      for (let i = 0; i < points.length; i++) {
          const j = (i + 1) % points.length;
          area += points[i].x * points[j].z;
          area -= points[j].x * points[i].z;
      }
      area = Math.abs(area) / 2;
      const areaMeters = area / (unitsPerMeter.value * unitsPerMeter.value);

      const config = getBuildingConfig(f.tags, areaMeters);
      
      const holes = f.holes ? f.holes.map((hole: LatLng[]) => {
          return hole.map(p => latLngToScene(p.lat, p.lng));
      }) : [];
      
      let avgHeight = 0;
      f.geometry.forEach((p: LatLng) => {
        avgHeight += getTerrainHeight(p.lat, p.lng);
      });
      avgHeight /= f.geometry.length;
      
      // Apply min_height offset to base y
      const y = avgHeight + config.minHeight;
      // Extrusion depth is total height minus start height (if min_height is relative to ground)
      // Usually height is total height from ground. So depth = height - minHeight.
      // Ensure minimum height is small enough to allow variation (e.g. 0.1 units instead of 1.0)
      const depth = Math.max(0.1, config.height - config.minHeight);
      
      buildingsList.push({ points, holes, y, height: depth, color: config.color });
    }
    else if (f.type === 'barrier' && f.geometry.length >= 2) {
        const config = getBarrierConfig(f.tags);
        const points = f.geometry.map((p: LatLng) => {
            const vec = latLngToScene(p.lat, p.lng);
            vec.y = getTerrainHeight(p.lat, p.lng);
            return vec;
        });
        barriersList.push({ points, originalPoints: f.geometry, width: config.width, height: config.height, color: config.color });
    }
    else if (f.type === 'vegetation') {
      const isTree = f.tags.natural === 'tree' || f.tags.natural === 'wood' || f.tags.landuse === 'forest' || f.tags.natural === 'tree_row';
      const areaConfig = getAreaConfig(f.tags);

      if (areaConfig.valid && f.geometry.length > 2) {
          // It's an area (grass/wetland)
          const points = f.geometry.map((p: LatLng) => {
            const vec = latLngToScene(p.lat, p.lng);
            vec.y = getTerrainHeight(p.lat, p.lng);
            return vec;
          });
          areasList.push({ points, color: areaConfig.color });
      } else {
          // It's trees or bushes (points)
          f.geometry.forEach((p: LatLng) => {
            const vec = latLngToScene(p.lat, p.lng);
            vec.y = getTerrainHeight(p.lat, p.lng);
            if (isTree) {
                treesList.push(vec);
            } else {
                bushesList.push(vec);
            }
          });
      }
    }
  });

  features.value = { roads: roadsList, buildings: buildingsList, trees: treesList, bushes: bushesList, barriers: barriersList, areas: areasList };
}, { immediate: true });

// Merged Geometries
const mergedRoadsGeometry = shallowRef<THREE.BufferGeometry | null>(null);
const mergedBuildingsGeometry = shallowRef<THREE.BufferGeometry | null>(null);
const mergedBarriersGeometry = shallowRef<THREE.BufferGeometry | null>(null);
const mergedAreasGeometry = shallowRef<THREE.BufferGeometry | null>(null);

watch(features, () => {
    // Dispose old
    mergedRoadsGeometry.value?.dispose();
    mergedBuildingsGeometry.value?.dispose();
    mergedBarriersGeometry.value?.dispose();
    mergedAreasGeometry.value?.dispose();
    
    // Roads
    if (features.value.roads.length) {
        const geometries: THREE.BufferGeometry[] = [];
        features.value.roads.forEach(road => {
            const geo = createRoadGeometry(road.points, road.width);
            // Add color attribute
            const count = geo.attributes.position.count;
            const colors = new Float32Array(count * 3);
            const color = new THREE.Color(road.color);
            for(let i=0; i<count; i++) {
                colors[i*3] = color.r;
                colors[i*3+1] = color.g;
                colors[i*3+2] = color.b;
            }
            geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            geometries.push(geo);
        });
        if (geometries.length > 0) {
            mergedRoadsGeometry.value = markRaw(mergeGeometries(geometries));
            geometries.forEach(g => g.dispose());
        }
    } else {
        mergedRoadsGeometry.value = null;
    }
    
    // Buildings
    if (features.value.buildings.length) {
        const geometries: THREE.BufferGeometry[] = [];
        features.value.buildings.forEach(building => {
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
            mergedBuildingsGeometry.value = markRaw(mergeGeometries(geometries));
            geometries.forEach(g => g.dispose());
        }
    } else {
        mergedBuildingsGeometry.value = null;
    }

    // Barriers
    if (features.value.barriers.length) {
        const geometries: THREE.BufferGeometry[] = [];
        features.value.barriers.forEach(barrier => {
            const geo = createBarrierGeometry(barrier.points, barrier.width, barrier.height);
            // Add color attribute
            const count = geo.attributes.position.count;
            const colors = new Float32Array(count * 3);
            const color = new THREE.Color(barrier.color);
            for(let i=0; i<count; i++) {
                colors[i*3] = color.r;
                colors[i*3+1] = color.g;
                colors[i*3+2] = color.b;
            }
            geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            geometries.push(geo);
        });
        if (geometries.length > 0) {
            mergedBarriersGeometry.value = markRaw(mergeGeometries(geometries));
            geometries.forEach(g => g.dispose());
        }
    } else {
        mergedBarriersGeometry.value = null;
    }

    // Areas
    if (features.value.areas.length) {
        const geometries: THREE.BufferGeometry[] = [];
        features.value.areas.forEach(area => {
            const geo = createAreaGeometry(area.points);
            // Add color attribute
            const count = geo.attributes.position.count;
            const colors = new Float32Array(count * 3);
            const color = new THREE.Color(area.color);
            for(let i=0; i<count; i++) {
                colors[i*3] = color.r;
                colors[i*3+1] = color.g;
                colors[i*3+2] = color.b;
            }
            geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            geometries.push(geo);
        });
        if (geometries.length > 0) {
            mergedAreasGeometry.value = markRaw(mergeGeometries(geometries));
            geometries.forEach(g => g.dispose());
        }
    } else {
        mergedAreasGeometry.value = null;
    }

}, { immediate: true });

// Instanced Mesh for Trees
const trunkRef = ref<THREE.InstancedMesh | null>(null);
const foliageRef = ref<THREE.InstancedMesh | null>(null);
const bushRef = ref<THREE.InstancedMesh | null>(null);

const treeTrunkArgs = computed<[number, number, number, number]>(() => [0.5 * unitsPerMeter.value, 0.5 * unitsPerMeter.value, 6.0 * unitsPerMeter.value, 8]);
const treeFoliageArgs = computed<[number, number, number]>(() => [3.5 * unitsPerMeter.value, 16, 16]);
const bushArgs = computed<[number, number, number]>(() => [1.5 * unitsPerMeter.value, 8, 8]);

watch(features, () => {
    // Update matrices in next tick to ensure refs are bound
    setTimeout(() => {
        const dummy = new THREE.Object3D();
        
        // Trunks
        if (trunkRef.value && features.value.trees.length > 0) {
            features.value.trees.forEach((pos, i) => {
                dummy.position.set(pos.x, pos.y + (3.0 * unitsPerMeter.value), pos.z);
                dummy.rotation.set(0, 0, 0);
                dummy.scale.set(1, 1, 1);
                dummy.updateMatrix();
                trunkRef.value!.setMatrixAt(i, dummy.matrix);
            });
            trunkRef.value.instanceMatrix.needsUpdate = true;
        }
        
        // Foliage
        if (foliageRef.value && features.value.trees.length > 0) {
            features.value.trees.forEach((pos, i) => {
                dummy.position.set(pos.x, pos.y + (7.0 * unitsPerMeter.value), pos.z);
                dummy.rotation.set(0, 0, 0);
                dummy.scale.set(1, 1, 1);
                dummy.updateMatrix();
                foliageRef.value!.setMatrixAt(i, dummy.matrix);
            });
            foliageRef.value.instanceMatrix.needsUpdate = true;
        }

        // Bushes
        if (bushRef.value && features.value.bushes.length > 0) {
            features.value.bushes.forEach((pos, i) => {
                dummy.position.set(pos.x, pos.y + (1.0 * unitsPerMeter.value), pos.z);
                dummy.rotation.set(0, 0, 0);
                dummy.scale.set(1, 1, 1);
                dummy.updateMatrix();
                bushRef.value!.setMatrixAt(i, dummy.matrix);
            });
            bushRef.value.instanceMatrix.needsUpdate = true;
        }
    }, 100);
}, { immediate: true });
</script>

<template>
  <TresGroup>
    <!-- Roads - Merged -->
    <TresMesh 
      v-if="mergedRoadsGeometry"
      :geometry="mergedRoadsGeometry"
    >
      <TresMeshStandardMaterial 
        :vertex-colors="true"
        :roughness="0.95" 
        :metalness="0.05"
        :side="2"
        :polygon-offset="true"
        :polygon-offset-factor="-1"
        :polygon-offset-units="-1"
      />
    </TresMesh>

    <!-- Buildings - Merged -->
    <TresMesh 
      v-if="mergedBuildingsGeometry"
      :geometry="mergedBuildingsGeometry"
    >
      <TresMeshStandardMaterial :vertex-colors="true" />
    </TresMesh>

    <!-- Barriers - Merged -->
    <TresMesh 
      v-if="mergedBarriersGeometry"
      :geometry="mergedBarriersGeometry"
    >
      <TresMeshStandardMaterial :vertex-colors="true" :side="2" />
    </TresMesh>

    <!-- Areas - Merged -->
    <TresMesh 
      v-if="mergedAreasGeometry"
      :geometry="mergedAreasGeometry"
    >
      <TresMeshStandardMaterial 
        :vertex-colors="true" 
        :side="2"
        :polygon-offset="true"
        :polygon-offset-factor="-1"
        :polygon-offset-units="-1"
      />
    </TresMesh>

    <!-- Trees - Instanced Trunks -->
    <TresInstancedMesh 
      v-if="features.trees.length > 0"
      ref="trunkRef"
      :args="[undefined, undefined, features.trees.length]"
      :frustum-culled="false"
    >
      <TresCylinderGeometry :args="treeTrunkArgs" />
      <TresMeshStandardMaterial :color="0x5d4037" :roughness="0.9" />
    </TresInstancedMesh>

    <!-- Trees - Instanced Foliage -->
    <TresInstancedMesh 
      v-if="features.trees.length > 0"
      ref="foliageRef"
      :args="[undefined, undefined, features.trees.length]"
      :frustum-culled="false"
    >
      <TresSphereGeometry :args="treeFoliageArgs" />
      <TresMeshStandardMaterial :color="0x22c55e" :roughness="0.8" />
    </TresInstancedMesh>

    <!-- Bushes - Instanced -->
    <TresInstancedMesh 
      v-if="features.bushes.length > 0"
      ref="bushRef"
      :args="[undefined, undefined, features.bushes.length]"
      :frustum-culled="false"
    >
      <TresSphereGeometry :args="bushArgs" />
      <TresMeshStandardMaterial :color="0x86efac" :roughness="0.9" />
    </TresInstancedMesh>
  </TresGroup>
</template>
