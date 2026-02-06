import * as THREE from 'three';
import proj4 from 'proj4';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// --- Constants & Helpers (Duplicated from OSMFeatures.vue for consistency) ---
export const SCENE_SIZE = 100;

const getMetricProjector = (data) => {
    const centerLat = (data.bounds.north + data.bounds.south) / 2;
    const centerLng = (data.bounds.east + data.bounds.west) / 2;
    const localProjDef = `+proj=tmerc +lat_0=${centerLat} +lon_0=${centerLng} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs`;
    const toMetric = proj4('EPSG:4326', localProjDef);
    const halfWidth = data.width / 2;
    const halfHeight = data.height / 2;

    return (lat, lng) => {
        const [localX, localY] = toMetric.forward([lng, lat]);
        const x = localX + halfWidth;
        const y = halfHeight - localY;
        return { x, y };
    };
};

const getTerrainHeight = (data, lat, lng) => {
    const scenePos = latLngToScene(data, lat, lng);
    return getHeightAtScenePos(data, scenePos.x, scenePos.z);
};

const latLngToScene = (data, lat, lng) => {
    const toPixel = getMetricProjector(data);
    const p = toPixel(lat, lng);

    const localX = p.x;
    const localY = p.y;

    const u = localX / (data.width - 1);
    const v = localY / (data.height - 1);

    const sceneX = (u * SCENE_SIZE) - (SCENE_SIZE / 2);
    const sceneZ = (v * SCENE_SIZE) - (SCENE_SIZE / 2);

    return new THREE.Vector3(sceneX, 0, sceneZ);
};

// Helper to get height from scene coordinates 
const getHeightAtScenePos = (data, x, z) => {
    const u = (x + SCENE_SIZE / 2) / SCENE_SIZE;
    const v = (z + SCENE_SIZE / 2) / SCENE_SIZE;

    if (u < 0 || u > 1 || v < 0 || v > 1) return 0;

    const localX = u * (data.width - 1);
    const localZ = v * (data.height - 1);

    const x0 = Math.floor(localX);
    const x1 = Math.min(x0 + 1, data.width - 1);
    const y0 = Math.floor(localZ);
    const y1 = Math.min(y0 + 1, data.height - 1);

    const wx = localX - x0;
    const wy = localZ - y0;

    const i00 = y0 * data.width + x0;
    const i10 = y0 * data.width + x1;
    const i01 = y1 * data.width + x0;
    const i11 = y1 * data.width + x1;

    const h00 = data.heightMap[i00] < -10000 ? data.minHeight : data.heightMap[i00];
    const h10 = data.heightMap[i10] < -10000 ? data.minHeight : data.heightMap[i10];
    const h01 = data.heightMap[i01] < -10000 ? data.minHeight : data.heightMap[i01];
    const h11 = data.heightMap[i11] < -10000 ? data.minHeight : data.heightMap[i11];

    const h = (1 - wy) * ((1 - wx) * h00 + wx * h10) + wy * ((1 - wx) * h01 + wx * h11);

    const latRad = (data.bounds.north + data.bounds.south) / 2 * Math.PI / 180;
    const metersPerDegree = 111320 * Math.cos(latRad);
    const realWidthMeters = (data.bounds.east - data.bounds.west) * metersPerDegree;
    const unitsPerMeter = SCENE_SIZE / realWidthMeters;
    const EXAGGERATION = 1.0;

    return (h - data.minHeight) * unitsPerMeter * EXAGGERATION;
};

const createRoadGeometry = (points, width) => {
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    const indices = [];
    const uvs = [];

    for (let i = 0; i < points.length; i++) {
        const point = points[i];

        let perpendicular;
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
const createBuildingGeometry = (points, holes = [], height = 0.5) => {
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
}; const createBarrierGeometry = (points, width, height) => {
    const roadGeo = createRoadGeometry(points, width);
    const pos = roadGeo.attributes.position;
    const count = pos.count;

    const newVertices = [];
    const newIndices = [];

    for (let i = 0; i < count; i++) {
        newVertices.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
    for (let i = 0; i < count; i++) {
        newVertices.push(pos.getX(i), pos.getY(i) + height, pos.getZ(i));
    }

    const indexAttr = roadGeo.index;
    for (let i = 0; i < indexAttr.count; i += 3) {
        const a = indexAttr.getX(i);
        const b = indexAttr.getX(i + 1);
        const c = indexAttr.getX(i + 2);
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


const isPointInPolygon = (point, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, zi = poly[i].z;
        const xj = poly[j].x, zj = poly[j].z;
        const intersect = ((zi > point.z) !== (zj > point.z)) &&
            (point.x < (xj - xi) * (point.z - zi) / (zj - zi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
};

/**
 * Helper to generate the Three.js Mesh from TerrainData.
 * Shared by exporters to ensure identical output.
 */
const createTerrainMesh = async (data) => {
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
            const EXAGGERATION = 1.0;

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
            const finalize = (tex) => {
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

export const createOSMGroup = (data) => {
    const group = new THREE.Group();
    if (!data.osmFeatures || data.osmFeatures.length === 0) return group;

    const latRad = (data.bounds.north + data.bounds.south) / 2 * Math.PI / 180;
    const metersPerDegree = 111320 * Math.cos(latRad);
    const realWidthMeters = (data.bounds.east - data.bounds.west) * metersPerDegree;
    const unitsPerMeter = SCENE_SIZE / realWidthMeters;

    const buildingsList = [];
    const treesList = [];
    const bushesList = [];
    const barriersList = [];

    // Helper to determine barrier properties

    const getBarrierConfig = (tags) => {
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


    const getBuildingConfig = (tags, areaMeters = 0) => {
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
    const resamplePath = (points, maxLenMeters = 5) => {
        const result = [];
        if (points.length < 2) return points;

        result.push(points[0]);

        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];

            // Approximate distance in meters
            const R = 6371e3;
            const φ1 = p1.lat * Math.PI / 180;
            const φ2 = p2.lat * Math.PI / 180;
            const Δφ = (p2.lat - p1.lat) * Math.PI / 180;
            const Δλ = (p2.lng - p1.lng) * Math.PI / 180;
            const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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


    data.osmFeatures.forEach((f) => {
        if (!f.geometry[0]) return;

        else if (f.type === 'building' && f.geometry.length > 2) {
            const points = f.geometry.map((p) => latLngToScene(data, p.lat, p.lng));

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

            const holes = f.holes ? f.holes.map((hole) => {
                return hole.map(p => latLngToScene(data, p.lat, p.lng));
            }) : [];

            let avgHeight = 0;
            f.geometry.forEach((p) => { avgHeight += getTerrainHeight(data, p.lat, p.lng); });
            avgHeight /= f.geometry.length;

            const y = avgHeight + config.minHeight;
            // Ensure minimum height is small enough to allow variation (e.g. 0.1 units instead of 1.0)
            const depth = Math.max(0.1, config.height - config.minHeight);

            buildingsList.push({ points, holes, y, height: depth, color: config.color });
        }
        else if (f.type === 'barrier' && f.geometry.length >= 2) {
            const config = getBarrierConfig(f.tags);
            const points = f.geometry.map((p) => {
                const vec = latLngToScene(data, p.lat, p.lng);
                vec.y = getTerrainHeight(data, p.lat, p.lng);
                return vec;
            });
            barriersList.push({ points, originalPoints: f.geometry, width: config.width, height: config.height, color: config.color });
        }
        else if (f.type === 'vegetation') {
            const isTree = f.tags.natural === 'tree' || f.tags.natural === 'wood' || f.tags.landuse === 'forest' || f.tags.natural === 'tree_row' || f.tags.landuse === 'orchard' || f.tags.natural === 'tree_group';
            const isBush = f.tags.natural === 'scrub' || f.tags.natural === 'heath' || f.tags.barrier === 'hedge' || f.tags.natural === 'scrubland';

            // Only trees and bushes are rendered as 3D objects
            if (!isTree && !isBush) return;

            // If it's a closed vegetation area (like forest), scatter objects
            if (f.geometry.length > 3 && f.geometry[0].lat === f.geometry[f.geometry.length - 1].lat) {
                const points = f.geometry.map((p) => latLngToScene(data, p.lat, p.lng));

                // Get bbox of polygon in scene space
                let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
                points.forEach(p => {
                    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
                });

                // Calculate approximate area to determine density
                const width = maxX - minX;
                const height = maxZ - minZ;
                const area = width * height;

                // Cap object count per polygon for performance
                const density = (isTree ? 0.04 : 0.02) / (unitsPerMeter * unitsPerMeter);
                const count = Math.min(250, Math.floor(area * density));

                for (let i = 0; i < count; i++) {
                    const rx = minX + Math.random() * width;
                    const rz = minZ + Math.random() * height;
                    const testPoint = { x: rx, z: rz };

                    if (isPointInPolygon(testPoint, points)) {
                        const vec = new THREE.Vector3(rx, getHeightAtScenePos(data, rx, rz), rz);
                        if (isTree) treesList.push(vec);
                        else bushesList.push(vec);
                    }
                }
            }
            else {
                f.geometry.forEach((p) => {
                    const vec = latLngToScene(data, p.lat, p.lng);
                    vec.y = getHeightAtScenePos(data, vec.x, vec.z);
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
    const addColor = (geo, colorHex) => {
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


    // Create Building Mesh
    if (buildingsList.length > 0) {
        const geometries = [];
        buildingsList.forEach(building => {
            const geo = createBuildingGeometry(building.points, building.holes, building.height);
            geo.rotateX(-Math.PI / 2);
            geo.translate(0, building.y, 0);

            // Add color attribute
            const count = geo.attributes.position.count;
            const colors = new Float32Array(count * 3);
            const color = new THREE.Color(building.color);
            for (let i = 0; i < count; i++) {
                colors[i * 3] = color.r;
                colors[i * 3 + 1] = color.g;
                colors[i * 3 + 2] = color.b;
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
        const geometries = [];
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




    // Create Trees (Merged Mesh with Vertex Colors)
    if (treesList.length > 0) {
        const geometries = [];

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
        const geometries = [];
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

export const exportToGLB = async (data) => {
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
            (gltf) => {
                const blob = new Blob([gltf], { type: 'model/gltf-binary' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                const date = new Date().toISOString().slice(0, 10);
                link.download = `MapNG_Model_${date}.glb`;
                link.click();
                URL.revokeObjectURL(link.href);
                resolve();
            },
            (err) => reject(err),
            { binary: true }
        );
    });
};