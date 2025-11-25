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
const createBuildingGeometry = (points: THREE.Vector3[], height: number = 0.5) => {
  const shape = new THREE.Shape();
  points.forEach((p, i) => {
    if (i === 0) shape.moveTo(p.x, -p.z);
    else shape.lineTo(p.x, -p.z);
  });
  
  const extrudeSettings = {
    depth: height,
    bevelEnabled: false
  };
  
  return new THREE.ExtrudeGeometry(shape, extrudeSettings);
};

// Process OSM features
const features = shallowRef({ roads: [], buildings: [], trees: [] } as { roads: any[], buildings: any[], trees: THREE.Vector3[] });
const unitsPerMeter = ref(0.1);

watch(() => props.terrainData, () => {
  const data = toRaw(props.terrainData);
  const roadsList: any[] = [];
  const buildingsList: any[] = [];
  const treesList: THREE.Vector3[] = [];

  if (!data.osmFeatures) {
      features.value = { roads: roadsList, buildings: buildingsList, trees: treesList };
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
    let widthMeters = 6; // Default 6m
    let color = 0x555555;
    let ignore = false;

    switch (type) {
        case 'motorway':
        case 'trunk':
        case 'primary':
            widthMeters = 12;
            color = 0x333333;
            break;
        case 'secondary':
        case 'tertiary':
            widthMeters = 10;
            color = 0x444444;
            break;
        case 'residential':
        case 'unclassified':
        case 'living_street':
            widthMeters = 8;
            color = 0x555555;
            break;
        case 'service':
            widthMeters = 4;
            color = 0x666666;
            break;
        case 'footway':
        case 'path':
        case 'cycleway':
        case 'steps':
        case 'pedestrian':
        case 'track':
            widthMeters = 2;
            color = 0x888888;
            ignore = true;
            break;
    }
    return { width: widthMeters * unitsPerMeter.value, color, ignore };
  };

  data.osmFeatures.forEach((f: any) => {
    if (!f.geometry[0]) return;

    if (f.type === 'road' && f.geometry.length >= 2) {
      const config = getRoadConfig(f.tags);
      
      if (config.ignore) return;

      const points = f.geometry.map((p: LatLng) => {
        const vec = latLngToScene(p.lat, p.lng);
        vec.y = getTerrainHeight(p.lat, p.lng) + (0.2 * unitsPerMeter.value);
        return vec;
      });
      
      roadsList.push({ id: f.id, points, width: config.width, color: config.color });
    }
    else if (f.type === 'building' && f.geometry.length > 2) {
      const points = f.geometry.map((p: LatLng) => {
        const vec = latLngToScene(p.lat, p.lng);
        return vec;
      });
      
      let avgHeight = 0;
      f.geometry.forEach((p: LatLng) => {
        avgHeight += getTerrainHeight(p.lat, p.lng);
      });
      avgHeight /= f.geometry.length;
      
      // Default height 10m if not specified (could parse tags later)
      const height = 10 * unitsPerMeter.value;
      
      buildingsList.push({ points, y: avgHeight, height });
    }
    else if (f.type === 'vegetation') {
      f.geometry.forEach((p: LatLng) => {
        const vec = latLngToScene(p.lat, p.lng);
        vec.y = getTerrainHeight(p.lat, p.lng);
        treesList.push(vec);
      });
    }
  });

  features.value = { roads: roadsList, buildings: buildingsList, trees: treesList };
}, { immediate: true });

// Merged Geometries
const mergedRoadsGeometry = shallowRef<THREE.BufferGeometry | null>(null);
const mergedBuildingsGeometry = shallowRef<THREE.BufferGeometry | null>(null);

watch(features, () => {
    // Dispose old
    mergedRoadsGeometry.value?.dispose();
    mergedBuildingsGeometry.value?.dispose();
    
    // Roads
    if (features.value.roads.length) {
        const geometries: THREE.BufferGeometry[] = [];
        features.value.roads.forEach(road => {
            const geo = createRoadGeometry(road.points, road.width);
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
            const geo = createBuildingGeometry(building.points, building.height);
            geo.rotateX(-Math.PI / 2);
            geo.translate(0, building.y, 0);
            geometries.push(geo);
        });
        if (geometries.length > 0) {
            mergedBuildingsGeometry.value = markRaw(mergeGeometries(geometries));
            geometries.forEach(g => g.dispose());
        }
    } else {
        mergedBuildingsGeometry.value = null;
    }
}, { immediate: true });

// Instanced Mesh for Trees
const trunkRef = ref<THREE.InstancedMesh | null>(null);
const foliageRef = ref<THREE.InstancedMesh | null>(null);

const treeTrunkArgs = computed<[number, number, number, number]>(() => [0.5 * unitsPerMeter.value, 0.8 * unitsPerMeter.value, 6.0 * unitsPerMeter.value, 8]);
const treeFoliageArgs = computed<[number, number]>(() => [3.5 * unitsPerMeter.value, 0]);

watch(features, () => {
    if (features.value.trees.length === 0) return;
    
    // Update matrices in next tick to ensure refs are bound
    setTimeout(() => {
        const dummy = new THREE.Object3D();
        
        // Trunks
        if (trunkRef.value) {
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
        if (foliageRef.value) {
            features.value.trees.forEach((pos, i) => {
                dummy.position.set(pos.x, pos.y + (7.0 * unitsPerMeter.value), pos.z);
                dummy.rotation.set(0, 0, 0);
                dummy.scale.set(1, 1, 1);
                dummy.updateMatrix();
                foliageRef.value!.setMatrixAt(i, dummy.matrix);
            });
            foliageRef.value.instanceMatrix.needsUpdate = true;
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
        :color="0x2c2c2c" 
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
      <TresMeshStandardMaterial :color="0xe2e8f0" />
    </TresMesh>

    <!-- Trees - Instanced Trunks -->
    <TresInstancedMesh 
      v-if="features.trees.length > 0"
      ref="trunkRef"
      :args="[undefined, undefined, features.trees.length]"
    >
      <TresCylinderGeometry :args="treeTrunkArgs" />
      <TresMeshStandardMaterial :color="0x5d4037" :roughness="0.9" />
    </TresInstancedMesh>

    <!-- Trees - Instanced Foliage -->
    <TresInstancedMesh 
      v-if="features.trees.length > 0"
      ref="foliageRef"
      :args="[undefined, undefined, features.trees.length]"
    >
      <TresIcosahedronGeometry :args="treeFoliageArgs" />
      <TresMeshStandardMaterial :color="0x22c55e" :roughness="0.8" />
    </TresInstancedMesh>
  </TresGroup>
</template>
