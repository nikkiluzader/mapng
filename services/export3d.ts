import * as THREE from 'three';
import { TerrainData, LatLng } from '../types';
// @ts-ignore
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// --- Constants & Helpers (Duplicated from OSMFeatures.vue for consistency) ---
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

const getTerrainHeight = (data: TerrainData, lat: number, lng: number): number => {
    const p = project(lat, lng);
    const nw = project(data.bounds.north, data.bounds.west);
    
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
    const EXAGGERATION = 1.5;

    return (h - data.minHeight) * unitsPerMeter * EXAGGERATION;
};

const latLngToScene = (data: TerrainData, lat: number, lng: number) => {
    const p = project(lat, lng);
    const nw = project(data.bounds.north, data.bounds.west);
    
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

    // Helper to determine road properties
    const getRoadConfig = (tags: any) => {
        const type = tags.highway;
        let widthMeters = 6;
        let color = 0x555555;
        let ignore = false;

        switch (type) {
            case 'motorway': case 'trunk': case 'primary':
                widthMeters = 12; color = 0x333333; break;
            case 'secondary': case 'tertiary':
                widthMeters = 10; color = 0x444444; break;
            case 'residential': case 'unclassified': case 'living_street':
                widthMeters = 8; color = 0x555555; break;
            case 'service':
                widthMeters = 4; color = 0x666666; break;
            case 'footway': case 'path': case 'cycleway': case 'steps': case 'pedestrian': case 'track':
                widthMeters = 2; color = 0x888888; ignore = true; break;
        }
        return { width: widthMeters * unitsPerMeter, color, ignore };
    };

    data.osmFeatures.forEach((f: any) => {
        if (!f.geometry[0]) return;

        if (f.type === 'road' && f.geometry.length >= 2) {
            const config = getRoadConfig(f.tags);
            if (config.ignore) return;

            const points = f.geometry.map((p: LatLng) => {
                const vec = latLngToScene(data, p.lat, p.lng);
                vec.y = getTerrainHeight(data, p.lat, p.lng) + (0.2 * unitsPerMeter);
                return vec;
            });
            roadsList.push({ points, width: config.width });
        }
        else if (f.type === 'building' && f.geometry.length > 2) {
            const points = f.geometry.map((p: LatLng) => latLngToScene(data, p.lat, p.lng));
            let avgHeight = 0;
            f.geometry.forEach((p: LatLng) => { avgHeight += getTerrainHeight(data, p.lat, p.lng); });
            avgHeight /= f.geometry.length;
            const height = 10 * unitsPerMeter;
            buildingsList.push({ points, y: avgHeight, height });
        }
        else if (f.type === 'vegetation') {
            f.geometry.forEach((p: LatLng) => {
                const vec = latLngToScene(data, p.lat, p.lng);
                vec.y = getTerrainHeight(data, p.lat, p.lng);
                treesList.push(vec);
            });
        }
    });

    // Create Road Mesh
    if (roadsList.length > 0) {
        const geometries: THREE.BufferGeometry[] = [];
        roadsList.forEach(road => {
            geometries.push(createRoadGeometry(road.points, road.width));
        });
        if (geometries.length > 0) {
            const merged = mergeGeometries(geometries);
            const material = new THREE.MeshStandardMaterial({ color: 0x2c2c2c, roughness: 0.95, metalness: 0.05, side: THREE.DoubleSide });
            const mesh = new THREE.Mesh(merged, material);
            group.add(mesh);
        }
    }

    // Create Building Mesh
    if (buildingsList.length > 0) {
        const geometries: THREE.BufferGeometry[] = [];
        buildingsList.forEach(building => {
            const geo = createBuildingGeometry(building.points, building.height);
            geo.rotateX(-Math.PI / 2);
            geo.translate(0, building.y, 0);
            geometries.push(geo);
        });
        if (geometries.length > 0) {
            const merged = mergeGeometries(geometries);
            const material = new THREE.MeshStandardMaterial({ color: 0xe2e8f0 });
            const mesh = new THREE.Mesh(merged, material);
            group.add(mesh);
        }
    }

    // Create Trees (InstancedMesh)
    if (treesList.length > 0) {
        const trunkGeo = new THREE.CylinderGeometry(0.5 * unitsPerMeter, 0.5 * unitsPerMeter, 6.0 * unitsPerMeter, 8);
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.9 });
        const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, treesList.length);

        const foliageGeo = new THREE.SphereGeometry(3.5 * unitsPerMeter, 16, 16);
        const foliageMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.8 });
        const foliageMesh = new THREE.InstancedMesh(foliageGeo, foliageMat, treesList.length);

        const dummy = new THREE.Object3D();
        treesList.forEach((pos, i) => {
            // Trunk
            dummy.position.set(pos.x, pos.y + (3.0 * unitsPerMeter), pos.z);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            trunkMesh.setMatrixAt(i, dummy.matrix);

            // Foliage
            dummy.position.set(pos.x, pos.y + (7.0 * unitsPerMeter), pos.z);
            dummy.updateMatrix();
            foliageMesh.setMatrixAt(i, dummy.matrix);
        });

        group.add(trunkMesh);
        group.add(foliageMesh);
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