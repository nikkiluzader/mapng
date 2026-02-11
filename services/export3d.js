import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { textures } from "./textureGenerator.js";
import { createMetricProjector } from "./geoUtils.js";

// --- Constants & Helpers ---
export const SCENE_SIZE = 100;

const getMetricProjector = (data) =>
  createMetricProjector(data.bounds, data.width, data.height);

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

  const sceneX = u * SCENE_SIZE - SCENE_SIZE / 2;
  const sceneZ = v * SCENE_SIZE - SCENE_SIZE / 2;

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

  const h00 =
    data.heightMap[i00] < -10000 ? data.minHeight : data.heightMap[i00];
  const h10 =
    data.heightMap[i10] < -10000 ? data.minHeight : data.heightMap[i10];
  const h01 =
    data.heightMap[i01] < -10000 ? data.minHeight : data.heightMap[i01];
  const h11 =
    data.heightMap[i11] < -10000 ? data.minHeight : data.heightMap[i11];

  const h =
    (1 - wy) * ((1 - wx) * h00 + wx * h10) + wy * ((1 - wx) * h01 + wx * h11);

  const latRad =
    (((data.bounds.north + data.bounds.south) / 2) * Math.PI) / 180;
  const metersPerDegree = 111320 * Math.cos(latRad);
  const realWidthMeters =
    (data.bounds.east - data.bounds.west) * metersPerDegree;
  const unitsPerMeter = SCENE_SIZE / realWidthMeters;
  const EXAGGERATION = 1.0;

  return (h - data.minHeight) * unitsPerMeter * EXAGGERATION;
};

const createRoadGeometry = (data, points, width, offset = 0, options = {}) => {
  const geometry = new THREE.BufferGeometry();
  const vertices = [];
  const uvs = [];
  const indices = [];

  const latRad =
    (((data.bounds.north + data.bounds.south) / 2) * Math.PI) / 180;
  const metersPerDegree = 111320 * Math.cos(latRad);
  const realWidthMeters =
    (data.bounds.east - data.bounds.west) * metersPerDegree;
  const unitsPerMeter = SCENE_SIZE / realWidthMeters;

  let accumulatedDist = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i > 0) accumulatedDist += p.distanceTo(points[i - 1]);

    const isDashGap =
      options.dashed &&
      Math.floor(accumulatedDist / (4 * unitsPerMeter)) % 2 === 1;

    let forward;
    if (i < points.length - 1) {
      forward = new THREE.Vector3()
        .subVectors(points[i + 1], points[i])
        .normalize();
    } else {
      forward = new THREE.Vector3()
        .subVectors(points[i], points[i - 1])
        .normalize();
    }

    const perpendicular = new THREE.Vector3(-forward.z, 0, forward.x);
    const halfWidth = (width / 2) * unitsPerMeter;
    const off = offset * unitsPerMeter;

    const lx = p.x + perpendicular.x * (off - halfWidth);
    const lz = p.z + perpendicular.z * (off - halfWidth);
    const rx = p.x + perpendicular.x * (off + halfWidth);
    const rz = p.z + perpendicular.z * (off + halfWidth);

    const ly = getHeightAtScenePos(data, lx, lz);
    const ry = getHeightAtScenePos(data, rx, rz);

    const elev = (options.type === "sidewalk" ? 0.15 : 0.02) * unitsPerMeter;
    vertices.push(lx, ly + elev, lz);
    vertices.push(rx, ry + elev, rz);

    // UVs: X is side-to-side (0 to 1), Y is along the road length
    const v = accumulatedDist / (5 * unitsPerMeter); // Texture repeats every 5 meters
    uvs.push(0, v);
    uvs.push(1, v);

    if (i < points.length - 1 && !isDashGap) {
      const base = i * 2;
      indices.push(base, base + 2, base + 1);
      indices.push(base + 1, base + 2, base + 3);
    }
  }

  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
};

const getRoadConfig = (tags) => {
  const highway = tags.highway;
  const isOneWay =
    tags.oneway === "yes" || tags.oneway === "1" || highway === "motorway";
  const lanesT = parseInt(tags.lanes) || (isOneWay ? 1 : 2);

  // Sidewalks
  const hasLeftSidewalk = tags.sidewalk === "left" || tags.sidewalk === "both";
  const hasRightSidewalk =
    tags.sidewalk === "right" || tags.sidewalk === "both";

  const config = {
    totalWidth: parseFloat(tags.width) || 0,
    lanes: [],
  };

  if (config.totalWidth === 0) {
    if (highway === "motorway" || highway === "trunk")
      config.totalWidth = lanesT * 3.7;
    else if (highway === "primary" || highway === "secondary")
      config.totalWidth = lanesT * 3.5;
    else if (highway === "tertiary" || highway === "residential")
      config.totalWidth = lanesT * 3.2;
    else config.totalWidth = lanesT * 3.0;
  }

  let currentOffset = -config.totalWidth / 2;
  const laneWidth = config.totalWidth / lanesT;

  // Add Left Sidewalk
  if (hasLeftSidewalk) {
    config.lanes.push({
      offset: currentOffset - 1.25,
      width: 2.5,
      type: "sidewalk",
      color: 0x9ca3af,
    });
  }

  for (let i = 0; i < lanesT; i++) {
    const laneOffset = currentOffset + laneWidth / 2;
    config.lanes.push({
      offset: laneOffset,
      width: laneWidth,
      type: "vehicle",
    });

    if (i < lanesT - 1) {
      const isCenter = Math.abs(currentOffset + laneWidth) < 0.1 && !isOneWay;
      config.lanes.push({
        offset: currentOffset + laneWidth,
        width: 0.18,
        type: "marking",
        color: isCenter ? 0xffcc00 : 0xffffff,
        dashed: !isCenter || lanesT < 3,
      });
    }
    currentOffset += laneWidth;
  }

  // Add Right Sidewalk
  if (hasRightSidewalk) {
    config.lanes.push({
      offset: currentOffset + 1.25,
      width: 2.5,
      type: "sidewalk",
      color: 0x9ca3af,
    });
  }

  return config;
};

// Create building geometry
const createBuildingGeometry = (points, holes = [], height = 0.5) => {
  const shape = new THREE.Shape();
  points.forEach((p, i) => {
    if (i === 0) shape.moveTo(p.x, -p.z);
    else shape.lineTo(p.x, -p.z);
  });

  // Add holes
  holes.forEach((holePoints) => {
    const holePath = new THREE.Path();
    holePoints.forEach((p, i) => {
      if (i === 0) holePath.moveTo(p.x, -p.z);
      else holePath.lineTo(p.x, -p.z);
    });
    shape.holes.push(holePath);
  });

  const extrudeSettings = {
    depth: height,
    bevelEnabled: false,
  };

  return new THREE.ExtrudeGeometry(shape, extrudeSettings);
};
const createBarrierGeometry = (data, points, width, height) => {
  const roadGeo = createRoadGeometry(data, points, width);
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
  geo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(newVertices, 3),
  );
  geo.setIndex(newIndices);
  geo.computeVertexNormals();

  roadGeo.dispose();
  return geo;
};

const addColor = (geo, colorHex) => {
  const count = geo.attributes.position.count,
    colors = new Float32Array(count * 3),
    c = new THREE.Color(colorHex);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
};

const createTreeMesh = (type, unitsPerMeter) => {
  try {
    const trunkHeight = (type === "palm" ? 5 : 6) * unitsPerMeter;
    const trunkGeo = new THREE.CylinderGeometry(
      0.15 * unitsPerMeter,
      0.25 * unitsPerMeter,
      trunkHeight,
      8,
    ).toNonIndexed();
    trunkGeo.translate(0, trunkHeight / 2, 0);
    addColor(trunkGeo, 0x5d4037);

    if (type === "palm") {
      const fronds = [];
      for (let i = 0; i < 8; i++) {
        const frondGeo = new THREE.CylinderGeometry(
          0.01 * unitsPerMeter,
          0.2 * unitsPerMeter,
          3.5 * unitsPerMeter,
          4,
        ).toNonIndexed();
        frondGeo.translate(0, 1.75 * unitsPerMeter, 0);
        frondGeo.rotateZ(-Math.PI / 4); // Droop down
        frondGeo.rotateY((i / 8) * Math.PI * 2);
        frondGeo.translate(0, trunkHeight * 0.95, 0);
        addColor(frondGeo, 0x15803d);
        fronds.push(frondGeo);
      }
      const merged = mergeGeometries([trunkGeo, ...fronds]);
      fronds.forEach((f) => f.dispose());
      trunkGeo.dispose();
      return merged;
    } else if (type === "coniferous") {
      const crownGeo = new THREE.CylinderGeometry(
        0,
        2.5 * unitsPerMeter,
        7 * unitsPerMeter,
        8,
      ).toNonIndexed();
      crownGeo.translate(0, 6.5 * unitsPerMeter, 0);
      addColor(crownGeo, 0x064e3b);
      const merged = mergeGeometries([trunkGeo, crownGeo]);
      crownGeo.dispose();
      trunkGeo.dispose();
      return merged;
    } else {
      const crownGeo = new THREE.IcosahedronGeometry(
        3 * unitsPerMeter,
        1,
      ).toNonIndexed();
      crownGeo.scale(1, 1.2, 1);
      crownGeo.translate(0, 7 * unitsPerMeter, 0);
      addColor(crownGeo, 0x166534);
      const merged = mergeGeometries([trunkGeo, crownGeo]);
      crownGeo.dispose();
      trunkGeo.dispose();
      return merged;
    }
  } catch (e) {
    console.warn("Failed to create tree mesh:", e);
    return null;
  }
};

const isPointInPolygon = (point, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x,
      zi = poly[i].z;
    const xj = poly[j].x,
      zj = poly[j].z;
    const intersect =
      zi > point.z !== zj > point.z &&
      point.x < ((xj - xi) * (point.z - zi)) / (zj - zi) + xi;
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
      const baseStride = Math.ceil(
        Math.max(data.width, data.height) / MAX_MESH_RESOLUTION,
      );
      const stride = baseStride;

      const segmentsX = Math.floor((data.width - 1) / stride);
      const segmentsY = Math.floor((data.height - 1) / stride);

      const geometry = new THREE.PlaneGeometry(
        SCENE_SIZE,
        SCENE_SIZE,
        segmentsX,
        segmentsY,
      );
      const vertices = geometry.attributes.position.array;

      // Calculate scale factor (units per meter)
      const latRad =
        (((data.bounds.north + data.bounds.south) / 2) * Math.PI) / 180;
      const metersPerDegree = 111320 * Math.cos(latRad);
      const realWidthMeters =
        (data.bounds.east - data.bounds.west) * metersPerDegree;
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
        vertices[i * 3 + 2] =
          (data.heightMap[dataIndex] - data.minHeight) *
          unitsPerMeter *
          EXAGGERATION;
      }

      geometry.computeVertexNormals();

      // 2. Create Material
      const material = new THREE.MeshStandardMaterial({
        roughness: 1,
        metalness: 0,
        side: THREE.DoubleSide,
        color: 0xffffff,
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
          },
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

  const latRad =
    (((data.bounds.north + data.bounds.south) / 2) * Math.PI) / 180;
  const metersPerDegree = 111320 * Math.cos(latRad);
  const realWidthMeters =
    (data.bounds.east - data.bounds.west) * metersPerDegree;
  const unitsPerMeter = SCENE_SIZE / realWidthMeters;

  const buildingsList = [];
  const treesList = [];
  const bushesList = [];
  const barriersList = [];
  const waterList = [];

  const getBarrierConfig = (tags) => {
    const type = tags.barrier;
    let height = 1.5 * unitsPerMeter;
    let width = 0.2 * unitsPerMeter;
    let color = 0x888888;

    if (type === "wall" || type === "city_wall" || type === "retaining_wall") {
      color = 0xaaaaaa;
      height = (type === "city_wall" ? 4 : 2) * unitsPerMeter;
      width = 0.5 * unitsPerMeter;
    } else if (type === "fence" || type === "gate") {
      color = 0x8b4513;
      if (tags.material === "metal" || tags.material === "chain_link")
        color = 0x555555;
      height = 1.5 * unitsPerMeter;
      width = 0.1 * unitsPerMeter;
    } else if (type === "hedge") {
      color = 0x228b22;
      height = 1.2 * unitsPerMeter;
      width = 0.8 * unitsPerMeter;
    }
    return { height, width, color };
  };

  /**
   * Advanced Building Configuration Parser
   * Inspired by OSM2World's LevelAndHeightData and BuildingDefaults
   */
  const getBuildingConfig = (tags, areaMeters = 0) => {
    const DEFAULT_HEIGHT_LEVEL = 3.0;

    let buildingLevels =
      parseFloat(tags["building:levels"] || tags.levels) || 0;
    let minLevel =
      parseFloat(tags["building:min_level"] || tags.min_level) || 0;
    let roofLevels =
      parseFloat(tags["roof:levels"] || tags["building:roof:levels"]) || 0;
    let roofHeight =
      parseFloat(tags["roof:height"] || tags["building:roof:height"]) || 0;

    const type = tags.building || tags["building:part"] || "yes";
    let defaultLevels = 1;
    if (["house", "detached", "duplex", "terrace"].includes(type))
      defaultLevels = 2;
    else if (
      ["apartments", "office", "commercial", "retail", "hotel"].includes(type)
    )
      defaultLevels = 4;

    if (buildingLevels === 0) {
      if (tags.height)
        buildingLevels = Math.max(
          1,
          Math.round(parseFloat(tags.height) / DEFAULT_HEIGHT_LEVEL),
        );
      else if (areaMeters > 2000) buildingLevels = 5;
      else buildingLevels = defaultLevels;
    }

    let height = 0;
    if (tags.height) {
      height = parseFloat(tags.height);
    } else {
      height = (buildingLevels + roofLevels) * DEFAULT_HEIGHT_LEVEL;
      if (type === "church" || type === "cathedral")
        height = 20 + Math.random() * 10;
      else if (type === "garage" || type === "shed") height = 3.5;
      else if (type === "roof") height = 4;
    }

    let minHeight = 0;
    if (tags.min_height) minHeight = parseFloat(tags.min_height);
    else if (minLevel > 0) minHeight = minLevel * DEFAULT_HEIGHT_LEVEL;

    const roofShape =
      tags["roof:shape"] || tags["building:roof:shape"] || "flat";
    if (roofHeight === 0 && roofShape !== "flat") {
      roofHeight = roofLevels > 0 ? roofLevels * DEFAULT_HEIGHT_LEVEL : 3.0;
    }

    // --- Color & Material Logic (OSM2World inspired) ---
    const BUILDING_COLORS = {
      white: 0xfcfcfc,
      black: 0x4c4c4c,
      grey: 0x646464,
      gray: 0x646464,
      red: 0xffbebe, // Soft pink/red for buildings
      green: 0xbeffbe,
      blue: 0xbebeff,
      yellow: 0xffffaf,
      pink: 0xe1afe1,
      orange: 0xffe196,
      brown: 0xaa8250,
    };

    const ROOF_COLORS = {
      red: 0xcc0000,
      green: 0x96c882,
      blue: 0x6432c8,
      brown: 0x786e6e,
    };

    const MATERIAL_COLORS = {
      brick: 0xb91c1c,
      concrete: 0x9ca3af,
      stone: 0x6b7280,
      wood: 0x92400e,
      glass: 0x1e293b,
      metal: 0x4b5563,
    };

    const parseO2WColor = (colorTag, colorPalette, defaultColor) => {
      if (!colorTag) return defaultColor;
      if (colorPalette[colorTag.toLowerCase()])
        return colorPalette[colorTag.toLowerCase()];
      try {
        return new THREE.Color(colorTag).getHex();
      } catch (e) {
        return defaultColor;
      }
    };

    // Material overrides
    const wallMaterial = tags["building:material"] || tags["material"];
    const roofMaterial =
      tags["roof:material"] || tags["building:roof:material"];

    let wallColor = parseO2WColor(
      tags["building:colour"] ||
        tags["building:color"] ||
        tags.colour ||
        tags.color,
      BUILDING_COLORS,
      0xefd1a1,
    );
    if (
      wallMaterial &&
      MATERIAL_COLORS[wallMaterial.toLowerCase()] &&
      !tags["building:colour"]
    ) {
      wallColor = MATERIAL_COLORS[wallMaterial.toLowerCase()];
    }

    let roofColor = parseO2WColor(
      tags["roof:colour"] || tags["roof:color"] || tags["building:roof:colour"],
      ROOF_COLORS,
      0x9b3131,
    );
    if (
      roofMaterial &&
      MATERIAL_COLORS[roofMaterial.toLowerCase()] &&
      !tags["roof:colour"]
    ) {
      roofColor = MATERIAL_COLORS[roofMaterial.toLowerCase()];
    }

    return {
      height: height * unitsPerMeter,
      minHeight: minHeight * unitsPerMeter,
      wallColor,
      roofColor,
      roofShape,
      roofHeight: roofHeight * unitsPerMeter,
      levels: buildingLevels,
    };
  };

  const resamplePath = (points, maxLenMeters = 5) => {
    const result = [];
    if (points.length < 2) return points;
    result.push(points[0]);
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i],
        p2 = points[i + 1];
      const R = 6371e3;
      const φ1 = (p1.lat * Math.PI) / 180,
        φ2 = (p2.lat * Math.PI) / 180;
      const Δφ = ((p2.lat - p1.lat) * Math.PI) / 180,
        Δλ = ((p2.lng - p1.lng) * Math.PI) / 180;
      const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)),
        d = R * c;
      if (d > maxLenMeters) {
        const segments = Math.ceil(d / maxLenMeters);
        for (let j = 1; j < segments; j++) {
          const t = j / segments;
          result.push({
            lat: p1.lat + (p2.lat - p1.lat) * t,
            lng: p1.lng + (p2.lng - p1.lng) * t,
          });
        }
      }
      result.push(p2);
    }
    return result;
  };

  data.osmFeatures.forEach((f) => {
    if (!f.geometry[0]) return;
    if (f.type === "building" && f.geometry.length > 2) {
      const points = f.geometry.map((p) => latLngToScene(data, p.lat, p.lng));
      let area = 0;
      for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        area += points[i].x * points[j].z - points[j].x * points[i].z;
      }
      const areaMeters = Math.abs(area) / 2 / (unitsPerMeter * unitsPerMeter);

      // Safeguard: Skip extruding buildings that are impossibly large (likely landuse errors)
      // 50,000 sqm is a very large building (like a massive mall or factory)
      const isLargeIndustry = [
        "industrial",
        "warehouse",
        "retail",
        "commercial",
      ].includes(f.tags.building);
      if (areaMeters > 50000 && !isLargeIndustry) {
        return;
      }

      const config = getBuildingConfig(f.tags, areaMeters);
      const holes = (f.holes || []).map((h) =>
        h.map((p) => latLngToScene(data, p.lat, p.lng)),
      );
      let avgH = 0;
      f.geometry.forEach((p) => (avgH += getTerrainHeight(data, p.lat, p.lng)));
      buildingsList.push({
        points,
        holes,
        y: avgH / f.geometry.length + config.minHeight,
        height: Math.max(0.1, config.height - config.minHeight),
        ...config,
      });
    } else if (f.type === "barrier" && f.geometry.length >= 2) {
      const config = getBarrierConfig(f.tags);
      const points = f.geometry.map((p) => {
        const v = latLngToScene(data, p.lat, p.lng);
        v.y = getTerrainHeight(data, p.lat, p.lng);
        return v;
      });
      barriersList.push({
        points,
        originalPoints: f.geometry,
        width: config.width,
        height: config.height,
        color: config.color,
      });
    } else if (f.type === "vegetation") {
      const isTree =
        f.tags.natural === "tree" ||
        f.tags.natural === "wood" ||
        f.tags.landuse === "forest" ||
        f.tags.natural === "tree_row" ||
        f.tags.natural === "tree_group";
      const isBush =
        f.tags.natural === "scrub" ||
        f.tags.natural === "heath" ||
        f.tags.barrier === "hedge";
      if (isTree) {
        let treeType = "deciduous";
        if (f.tags.leaf_type === "needleleaved" || f.tags.wood === "coniferous")
          treeType = "coniferous";
        if (
          f.tags.leaf_type === "palm" ||
          (f.tags.species && f.tags.species.toLowerCase().includes("palm"))
        )
          treeType = "palm";

        if (
          f.geometry.length > 3 &&
          f.geometry[0].lat === f.geometry[f.geometry.length - 1].lat
        ) {
          const points = f.geometry.map((p) =>
            latLngToScene(data, p.lat, p.lng),
          );
          let minX = Infinity,
            maxX = -Infinity,
            minZ = Infinity,
            maxZ = -Infinity;
          points.forEach((p) => {
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minZ = Math.min(minZ, p.z);
            maxZ = Math.max(maxZ, p.z);
          });
          const density = 0.04 / (unitsPerMeter * unitsPerMeter);
          const count = Math.min(
            250,
            Math.floor((maxX - minX) * (maxZ - minZ) * density),
          );
          for (let i = 0; i < count; i++) {
            const rx = minX + Math.random() * (maxX - minX),
              rz = minZ + Math.random() * (maxZ - minZ);
            if (isPointInPolygon({ x: rx, z: rz }, points)) {
              treesList.push({
                pos: new THREE.Vector3(
                  rx,
                  getHeightAtScenePos(data, rx, rz),
                  rz,
                ),
                type: treeType,
              });
            }
          }
        } else {
          f.geometry.forEach((p) => {
            const v = latLngToScene(data, p.lat, p.lng);
            v.y = getHeightAtScenePos(data, v.x, v.z);
            treesList.push({ pos: v, type: treeType });
          });
        }
      } else if (isBush) {
        if (
          f.geometry.length > 3 &&
          f.geometry[0].lat === f.geometry[f.geometry.length - 1].lat
        ) {
          const points = f.geometry.map((p) =>
            latLngToScene(data, p.lat, p.lng),
          );
          let minX = Infinity,
            maxX = -Infinity,
            minZ = Infinity,
            maxZ = -Infinity;
          points.forEach((p) => {
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minZ = Math.min(minZ, p.z);
            maxZ = Math.max(maxZ, p.z);
          });
          const density = 0.02 / (unitsPerMeter * unitsPerMeter);
          const count = Math.min(
            250,
            Math.floor((maxX - minX) * (maxZ - minZ) * density),
          );
          for (let i = 0; i < count; i++) {
            const rx = minX + Math.random() * (maxX - minX),
              rz = minZ + Math.random() * (maxZ - minZ);
            if (isPointInPolygon({ x: rx, z: rz }, points)) {
              bushesList.push(
                new THREE.Vector3(rx, getHeightAtScenePos(data, rx, rz), rz),
              );
            }
          }
        } else {
          f.geometry.forEach((p) => {
            const v = latLngToScene(data, p.lat, p.lng);
            v.y = getHeightAtScenePos(data, v.x, v.z);
            bushesList.push(v);
          });
        }
      }
    } else if (f.type === "water" && f.geometry.length > 2) {
      const shape = new THREE.Shape();
      const points = f.geometry.map((p) => latLngToScene(data, p.lat, p.lng));
      points.forEach((p, i) => {
        if (i === 0) shape.moveTo(p.x, -p.z);
        else shape.lineTo(p.x, -p.z);
      });
      (f.holes || []).forEach((hole) => {
        const path = new THREE.Path();
        hole.forEach((p, i) => {
          const sp = latLngToScene(data, p.lat, p.lng);
          if (i === 0) path.moveTo(sp.x, -sp.z);
          else path.lineTo(sp.x, -sp.z);
        });
        shape.holes.push(path);
      });
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);
      let avgH = 0;
      f.geometry.forEach((p) => (avgH += getTerrainHeight(data, p.lat, p.lng)));
      geo.translate(0, avgH / f.geometry.length - 0.05 * unitsPerMeter, 0); // Slightly below ground
      waterList.push(geo);
    }
  });

  if (buildingsList.length > 0) {
    const wallGeos = [];
    const roofGeos = [];
    const windowGeos = [];

    buildingsList.forEach((b) => {
      // 1. Create Wall Geometry (Sides only)
      const shape = new THREE.Shape();
      b.points.forEach((p, i) => {
        if (i === 0) shape.moveTo(p.x, -p.z);
        else shape.lineTo(p.x, -p.z);
      });
      b.holes.forEach((holePoints) => {
        const holePath = new THREE.Path();
        holePoints.forEach((p, i) => {
          if (i === 0) holePath.moveTo(p.x, -p.z);
          else holePath.lineTo(p.x, -p.z);
        });
        shape.holes.push(holePath);
      });

      const wallExtrude = { depth: b.height, bevelEnabled: false };
      const wallGeo = new THREE.ExtrudeGeometry(shape, wallExtrude);
      wallGeo.rotateX(-Math.PI / 2);
      wallGeo.translate(0, b.y, 0);

      // Wall vertex colors (Darker sides)
      const pos = wallGeo.attributes.position;
      const wallColors = new Float32Array(pos.count * 3);
      const wallC = new THREE.Color(b.wallColor);
      for (let i = 0; i < pos.count; i++) {
        const py = pos.getY(i);
        const isTop = py > b.y + b.height * 0.99;
        const isBottom = py < b.y + b.height * 0.01;
        // Tint sides slightly darker for depth, and use O2W specific shading factor
        const dark = isTop || isBottom ? 1.0 : 0.88;
        wallColors[i * 3] = wallC.r * dark;
        wallColors[i * 3 + 1] = wallC.g * dark;
        wallColors[i * 3 + 2] = wallC.b * dark;
      }
      wallGeo.setAttribute("color", new THREE.BufferAttribute(wallColors, 3));

      // Wall UVs based on perimeter
      const wallUv = wallGeo.attributes.uv;
      if (wallUv) {
        const perimeterPoints = [];
        b.points.forEach((p) =>
          perimeterPoints.push(new THREE.Vector2(p.x, p.z)),
        );

        let totalDist = 0;
        for (let i = 0; i < perimeterPoints.length; i++) {
          const p1 = perimeterPoints[i];
          const p2 = perimeterPoints[(i + 1) % perimeterPoints.length];
          totalDist += p1.distanceTo(p2);
        }

        const uvScale = 4 * unitsPerMeter;
        for (let i = 0; i < wallUv.count; i++) {
          // ExtrudeGeometry side UVs: X is along perimeter (0-1), Y is along depth (0-1)
          wallUv.setXY(
            i,
            wallUv.getX(i) * (totalDist / uvScale),
            wallUv.getY(i) * (b.height / uvScale),
          );
        }
      }

      // Filter out top/bottom caps from wallGeo (we'll draw our own roof)
      // Actually ExtrudeGeometry groups them. Side is group 0, Caps are group 1.
      // For now, we'll just keep the sides and hide the caps by making them transparent or just drawing over them.
      // Better: just use the side geometry.
      wallGeos.push(wallGeo.toNonIndexed());

      // 2. Create Roof Geometry
      let roofGeo;
      const roofY = b.y + b.height;
      if (b.roofShape === "pyramidal" || b.roofShape === "gabled") {
        const vertices = [];
        const indices = [];
        const roofColorArr = [];
        const rc = new THREE.Color(b.roofColor);

        // Simple pyramidal: center point elevated
        let centroidX = 0,
          centroidZ = 0;
        b.points.forEach((p) => {
          centroidX += p.x;
          centroidZ += p.z;
        });
        centroidX /= b.points.length;
        centroidZ /= b.points.length;

        // Vertices: outer ring at roofY, apex at roofY + roofHeight
        b.points.forEach((p) => {
          vertices.push(p.x, roofY, p.z);
          roofColorArr.push(rc.r, rc.g, rc.b);
        });
        const apexIdx = b.points.length;
        vertices.push(centroidX, roofY + b.roofHeight, centroidZ);
        roofColorArr.push(rc.r * 1.1, rc.g * 1.1, rc.b * 1.1);

        for (let i = 0; i < b.points.length; i++) {
          indices.push(i, (i + 1) % b.points.length, apexIdx);
        }

        roofGeo = new THREE.BufferGeometry();
        roofGeo.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(vertices, 3),
        );
        roofGeo.setAttribute(
          "color",
          new THREE.Float32BufferAttribute(roofColorArr, 3),
        );

        // Roof UVs: Just use X, Z world space scaled by some factor
        const roofUvs = [];
        for (let i = 0; i < vertices.length / 3; i++) {
          roofUvs.push(
            vertices[i * 3] / (4 * unitsPerMeter),
            vertices[i * 3 + 2] / (4 * unitsPerMeter),
          );
        }
        roofGeo.setAttribute(
          "uv",
          new THREE.Float32BufferAttribute(roofUvs, 2),
        );

        roofGeo.setIndex(indices);
        roofGeo.computeVertexNormals();
      } else {
        // Flat roof (Default)
        const roofShape = new THREE.Shape();
        b.points.forEach((p, i) => {
          if (i === 0) roofShape.moveTo(p.x, -p.z);
          else roofShape.lineTo(p.x, -p.z);
        });
        b.holes.forEach((holePoints) => {
          const holePath = new THREE.Path();
          holePoints.forEach((p, i) => {
            if (i === 0) holePath.moveTo(p.x, -p.z);
            else holePath.lineTo(p.x, -p.z);
          });
          roofShape.holes.push(holePath);
        });
        roofGeo = new THREE.ShapeGeometry(roofShape);
        roofGeo.rotateX(-Math.PI / 2);
        roofGeo.translate(0, roofY + 0.01, 0);

        // Scale UVs for ShapeGeometry
        const roofUvAttr = roofGeo.attributes.uv;
        for (let i = 0; i < roofUvAttr.count; i++) {
          roofUvAttr.setXY(
            i,
            roofUvAttr.getX(i) / (4 * unitsPerMeter),
            roofUvAttr.getY(i) / (4 * unitsPerMeter),
          );
        }

        addColor(roofGeo, b.roofColor);
      }
      if (roofGeo.index) {
        roofGeos.push(roofGeo.toNonIndexed());
      } else {
        roofGeos.push(roofGeo);
      }

      // 3. Procedural Windows
      if (b.levels > 1 && b.height > 2 * unitsPerMeter) {
        const winColor = new THREE.Color(0x1e293b); // Slate 800
        const winWidth = 1.0 * unitsPerMeter;
        const winHeight = 1.2 * unitsPerMeter;
        const winPadding = 2.0 * unitsPerMeter;

        for (let i = 0; i < b.points.length; i++) {
          const p1 = b.points[i];
          const p2 = b.points[(i + 1) % b.points.length];
          const dx = p2.x - p1.x;
          const dz = p2.z - p1.z;
          const len = Math.sqrt(dx * dx + dz * dz);
          const numWindows = Math.floor(len / winPadding);

          if (numWindows > 0) {
            const normalX = -dz / len;
            const normalZ = dx / len;
            const winAngle = Math.atan2(normalX, normalZ);

            for (let j = 0; j < numWindows; j++) {
              const t = (j + 0.5) / numWindows;
              const wx = p1.x + dx * t + normalX * 0.05;
              const wz = p1.z + dz * t + normalZ * 0.05;

              for (let l = 0; l < b.levels; l++) {
                const wy = b.y + (l + 0.5) * (b.height / b.levels);
                const winGeo = new THREE.PlaneGeometry(winWidth, winHeight);
                winGeo.rotateY(winAngle);
                winGeo.translate(wx, wy, wz);
                addColor(winGeo, 0x1e293b);
                windowGeos.push(winGeo.toNonIndexed());
              }
            }
          }
        }
      }
    });

    if (wallGeos.length > 0) {
      const wallMerged = mergeGeometries(wallGeos);
      if (wallMerged) {
        const wallMesh = new THREE.Mesh(
          wallMerged,
          new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.8,
            map: textures.wall,
          }),
        );
        wallMesh.castShadow = true;
        wallMesh.receiveShadow = true;
        wallMesh.name = "buildings";
        group.add(wallMesh);
      }
    }

    if (roofGeos.length > 0) {
      const roofMerged = mergeGeometries(roofGeos);
      if (roofMerged) {
        const roofMesh = new THREE.Mesh(
          roofMerged,
          new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.8,
            map: textures.roof,
          }),
        );
        roofMesh.castShadow = true;
        roofMesh.receiveShadow = true;
        roofMesh.name = "buildings";
        group.add(roofMesh);
      }
    }

    if (windowGeos.length > 0) {
      const windowMerged = mergeGeometries(windowGeos);
      if (windowMerged) {
        const windowMesh = new THREE.Mesh(
          windowMerged,
          new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.1,
            metalness: 0.5,
          }),
        );
        windowMesh.castShadow = true;
        windowMesh.receiveShadow = true;
        windowMesh.name = "buildings";
        group.add(windowMesh);
      }
    }

    wallGeos.forEach((g) => g.dispose());
    roofGeos.forEach((g) => g.dispose());
    windowGeos.forEach((g) => g.dispose());
  }

  if (barriersList.length > 0) {
    const geos = [];
    barriersList.forEach((b) => {
      const geo = createBarrierGeometry(data, b.points, b.width, b.height);
      addColor(geo, b.color);
      geos.push(geo);
    });
    const compatibleGeos = geos.map((g) => g.toNonIndexed());
    const merged = mergeGeometries(compatibleGeos);
    if (merged) {
      const barrierMesh = new THREE.Mesh(
        merged,
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          side: THREE.DoubleSide,
        }),
      );
      barrierMesh.castShadow = true;
      barrierMesh.receiveShadow = true;
      barrierMesh.name = "barriers";
      group.add(barrierMesh);
    }
    compatibleGeos.forEach((g) => g.dispose());
    geos.forEach((g) => g.dispose());
  }

  const matrix = new THREE.Matrix4(),
    quaternion = new THREE.Quaternion(),
    scale = new THREE.Vector3(1, 1, 1),
    position = new THREE.Vector3();

  if (treesList.length > 0) {
    const types = ["deciduous", "coniferous", "palm"];
    types.forEach((type) => {
      const list = treesList.filter((t) => t.type === type);
      if (list.length > 0) {
        const geos = [];
        const baseGeo = createTreeMesh(type, unitsPerMeter);
        if (!baseGeo) return;
        list.forEach((tree) => {
          const g = baseGeo.clone();
          position.set(tree.pos.x, tree.pos.y, tree.pos.z);
          // Use tree.pos to generate a stable random scale/rotation
          // Reduced variation per user request (0.95 to 1.05 range for uniform appearance)
          const seed = Math.abs((tree.pos.x * 123.45 + tree.pos.z * 678.9) % 1);
          const s = 0.95 + seed * 0.1;
          scale.set(s, s, s);
          quaternion.setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            seed * Math.PI * 2,
          );
          matrix.compose(position, quaternion, scale);
          g.applyMatrix4(matrix);
          geos.push(g);
        });
        const merged = mergeGeometries(geos);
        if (merged) {
          const treeMesh = new THREE.Mesh(
            merged,
            new THREE.MeshStandardMaterial({
              vertexColors: true,
              roughness: 0.8,
            }),
          );
          treeMesh.castShadow = true;
          treeMesh.receiveShadow = true;
          treeMesh.name = "vegetation";
          group.add(treeMesh);
        }
        geos.forEach((g) => g.dispose());
        baseGeo.dispose();
      }
    });
  }

  if (bushesList.length > 0) {
    const geos = [];
    const baseB = new THREE.IcosahedronGeometry(
      1.2 * unitsPerMeter,
      0,
    ).toNonIndexed();
    addColor(baseB, 0x166534);
    bushesList.forEach((pos) => {
      const b = baseB.clone();
      const seed = (pos.x * 543.21 + pos.z * 123.4) % 1;
      const s = 0.7 + seed * 0.6;
      scale.set(s, s * 0.8, s);
      quaternion.setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        seed * Math.PI * 2,
      );
      position.set(pos.x, pos.y + 0.5 * s * unitsPerMeter, pos.z);
      matrix.compose(position, quaternion, scale);
      b.applyMatrix4(matrix);
      geos.push(b);
    });
    const merged = mergeGeometries(geos);
    if (merged) {
      const bushMesh = new THREE.Mesh(
        merged,
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
      );
      bushMesh.castShadow = true;
      bushMesh.receiveShadow = true;
      bushMesh.name = "vegetation";
      group.add(bushMesh);
    }
    geos.forEach((g) => g.dispose());
    baseB.dispose();
  }

  if (waterList.length > 0) {
    const merged = mergeGeometries(waterList);
    if (merged) {
      const waterMesh = new THREE.Mesh(
        merged,
        new THREE.MeshPhysicalMaterial({
          color: "#3facff", // Bright blue
          map: textures.water,
          transparent: true,
          opacity: 0.8,
          roughness: 0.1,
          metalness: 0.1,
          ior: 1.33,
          transmission: 0.2,
        }),
      );
      waterMesh.receiveShadow = true;
      waterMesh.name = "water";
      group.add(waterMesh);
    }
    waterList.forEach((g) => g.dispose());
  }

  return group;
};

export const exportToGLB = async (data) => {
  try {
    const terrainMesh = await createTerrainMesh(data);
    const osmGroup = createOSMGroup(data);
    const scene = new THREE.Scene();
    scene.add(terrainMesh);
    scene.add(osmGroup);

    const { GLTFExporter } =
      await import("three/examples/jsm/exporters/GLTFExporter.js");
    return new Promise((resolve, reject) => {
      const exporter = new GLTFExporter();
      exporter.parse(
        scene,
        (gltf) => {
          const blob = new Blob([gltf], { type: "model/gltf-binary" });
          const link = document.createElement("a");
          link.href = URL.createObjectURL(blob);
          const date = new Date().toISOString().slice(0, 10);
          link.download = `MapNG_Model_${date}.glb`;
          link.click();
          URL.revokeObjectURL(link.href);
          resolve();
        },
        (err) => reject(err),
        { binary: true },
      );
    });
  } catch (err) {
    console.error("Export failed:", err);
  }
};
