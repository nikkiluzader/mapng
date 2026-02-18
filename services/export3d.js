import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import JSZip from "jszip";
import { textures } from "./textureGenerator.js";
import { createMetricProjector } from "./geoUtils.js";
import { fetchSurroundingTiles, POSITIONS } from "./surroundingTiles.js";

// --- Constants & Helpers ---
export const SCENE_SIZE = 100;

// Cached per-dataset projection and constants to avoid recomputation
let _cachedDataId = null;
let _cachedProjector = null;
let _cachedUnitsPerMeter = 0;
let _cachedMinHeight = 0;
let _cachedWidth = 0;
let _cachedHeight = 0;
let _cachedHeightMap = null;

const _ensureCache = (data) => {
  // Use bounds as identity — same bounds = same projection
  const dataId = `${data.bounds.north},${data.bounds.south},${data.bounds.east},${data.bounds.west},${data.width},${data.height}`;
  if (_cachedDataId !== dataId) {
    _cachedDataId = dataId;
    _cachedProjector = createMetricProjector(data.bounds, data.width, data.height);
    const latRad = (((data.bounds.north + data.bounds.south) / 2) * Math.PI) / 180;
    const metersPerDegree = 111320 * Math.cos(latRad);
    const realWidthMeters = (data.bounds.east - data.bounds.west) * metersPerDegree;
    _cachedUnitsPerMeter = SCENE_SIZE / realWidthMeters;
    _cachedMinHeight = data.minHeight;
    _cachedWidth = data.width;
    _cachedHeight = data.height;
    _cachedHeightMap = data.heightMap;
  }
};

const getTerrainHeight = (data, lat, lng) => {
  const scenePos = latLngToScene(data, lat, lng);
  return getHeightAtScenePos(data, scenePos.x, scenePos.z);
};

const latLngToScene = (data, lat, lng) => {
  _ensureCache(data);
  const p = _cachedProjector(lat, lng);

  const u = p.x / (_cachedWidth - 1);
  const v = p.y / (_cachedHeight - 1);

  const sceneX = u * SCENE_SIZE - SCENE_SIZE / 2;
  const sceneZ = v * SCENE_SIZE - SCENE_SIZE / 2;

  return new THREE.Vector3(sceneX, 0, sceneZ);
};

// Reusable Vector3 for latLngToScene when caller only needs x/z
const _tmpSceneVec = new THREE.Vector3();
const latLngToSceneFast = (data, lat, lng) => {
  _ensureCache(data);
  const p = _cachedProjector(lat, lng);
  const u = p.x / (_cachedWidth - 1);
  const v = p.y / (_cachedHeight - 1);
  _tmpSceneVec.x = u * SCENE_SIZE - SCENE_SIZE / 2;
  _tmpSceneVec.y = 0;
  _tmpSceneVec.z = v * SCENE_SIZE - SCENE_SIZE / 2;
  return _tmpSceneVec;
};

// Helper to get height from scene coordinates — uses cached constants
const getHeightAtScenePos = (data, x, z) => {
  _ensureCache(data);
  const u = (x + SCENE_SIZE / 2) / SCENE_SIZE;
  const v = (z + SCENE_SIZE / 2) / SCENE_SIZE;

  if (u < 0 || u > 1 || v < 0 || v > 1) return 0;

  const localX = u * (_cachedWidth - 1);
  const localZ = v * (_cachedHeight - 1);

  const x0 = Math.floor(localX);
  const x1 = Math.min(x0 + 1, _cachedWidth - 1);
  const y0 = Math.floor(localZ);
  const y1 = Math.min(y0 + 1, _cachedHeight - 1);

  const wx = localX - x0;
  const wy = localZ - y0;

  const hm = _cachedHeightMap;
  const w = _cachedWidth;
  const minH = _cachedMinHeight;

  const i00 = y0 * w + x0;
  const i10 = y0 * w + x1;
  const i01 = y1 * w + x0;
  const i11 = y1 * w + x1;

  const h00 = hm[i00] < -10000 ? minH : hm[i00];
  const h10 = hm[i10] < -10000 ? minH : hm[i10];
  const h01 = hm[i01] < -10000 ? minH : hm[i01];
  const h11 = hm[i11] < -10000 ? minH : hm[i11];

  const h = (1 - wy) * ((1 - wx) * h00 + wx * h10) + wy * ((1 - wx) * h01 + wx * h11);

  return (h - minH) * _cachedUnitsPerMeter;
};

const createRoadGeometry = (data, points, width, offset = 0, options = {}) => {
  const geometry = new THREE.BufferGeometry();
  const vertices = [];
  const uvs = [];
  const indices = [];

  _ensureCache(data);
  const unitsPerMeter = _cachedUnitsPerMeter;

  // Reuse Vector3 objects to avoid allocation per iteration
  const forward = new THREE.Vector3();

  let accumulatedDist = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i > 0) accumulatedDist += p.distanceTo(points[i - 1]);

    const isDashGap =
      options.dashed &&
      Math.floor(accumulatedDist / (4 * unitsPerMeter)) % 2 === 1;

    if (i < points.length - 1) {
      forward.subVectors(points[i + 1], points[i]).normalize();
    } else {
      forward.subVectors(points[i], points[i - 1]).normalize();
    }

    const perpX = -forward.z;
    const perpZ = forward.x;
    const halfWidth = (width / 2) * unitsPerMeter;
    const off = offset * unitsPerMeter;

    const lx = p.x + perpX * (off - halfWidth);
    const lz = p.z + perpZ * (off - halfWidth);
    const rx = p.x + perpX * (off + halfWidth);
    const rz = p.z + perpZ * (off + halfWidth);

    const ly = getHeightAtScenePos(data, lx, lz);
    const ry = getHeightAtScenePos(data, rx, rz);

    const elev = (options.type === "sidewalk" ? 0.15 : 0.02) * unitsPerMeter;
    vertices.push(lx, ly + elev, lz);
    vertices.push(rx, ry + elev, rz);

    const v = accumulatedDist / (5 * unitsPerMeter);
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

// === Street Furniture Procedural Model Generators ===

/**
 * Street lamp: tapered pole + lamp head.
 * OSM2World: pole 0.16→0.08m radius, 5m tall, inverted pyramid lamp.
 */
const createStreetLampMesh = (unitsPerMeter) => {
  const poleH = 5.0 * unitsPerMeter;
  const lampH = 0.8 * unitsPerMeter;
  const totalH = poleH;

  // Tapered pole
  let pole = new THREE.CylinderGeometry(
    0.06 * unitsPerMeter, 0.12 * unitsPerMeter, poleH - lampH, 6,
  );
  if (pole.index) pole = pole.toNonIndexed();
  pole.translate(0, (poleH - lampH) / 2, 0);
  addColor(pole, 0x888888);

  // Lamp housing (inverted cone)
  let lampBase = new THREE.CylinderGeometry(
    0.02 * unitsPerMeter, 0.3 * unitsPerMeter, lampH * 0.6, 6,
  );
  if (lampBase.index) lampBase = lampBase.toNonIndexed();
  lampBase.translate(0, poleH - lampH + lampH * 0.3, 0);
  addColor(lampBase, 0x444444);

  // Lamp globe (bright cap)
  let lampGlobe = new THREE.SphereGeometry(0.15 * unitsPerMeter, 6, 4);
  if (lampGlobe.index) lampGlobe = lampGlobe.toNonIndexed();
  lampGlobe.translate(0, poleH - lampH * 0.15, 0);
  addColor(lampGlobe, 0xfff8dc);

  const merged = mergeGeometries([pole, lampBase, lampGlobe]);
  pole.dispose(); lampBase.dispose(); lampGlobe.dispose();
  return merged;
};

/**
 * Bollard: simple cylinder.
 * OSM2World: r=0.15m, h=1.0m, STEEL.
 */
const createBollardMesh = (unitsPerMeter) => {
  const h = 1.0 * unitsPerMeter;
  const r = 0.12 * unitsPerMeter;
  let geo = new THREE.CylinderGeometry(r * 0.85, r, h, 6);
  if (geo.index) geo = geo.toNonIndexed();
  geo.translate(0, h / 2, 0);
  addColor(geo, 0x777777);
  return geo;
};

/**
 * Bench: seat + backrest + 4 legs.
 * OSM2World: seat 2m × 0.5m × 0.05m at 0.5m, backrest 0.5m tall, legs 0.08m.
 */
const createBenchMesh = (unitsPerMeter) => {
  const benchW = 1.5 * unitsPerMeter;
  const seatD = 0.45 * unitsPerMeter;
  const seatH = 0.5 * unitsPerMeter;
  const seatThk = 0.04 * unitsPerMeter;
  const legSz = 0.06 * unitsPerMeter;
  const backH = 0.4 * unitsPerMeter;
  const backThk = 0.03 * unitsPerMeter;
  const parts = [];

  // Seat
  let seat = new THREE.BoxGeometry(benchW, seatThk, seatD);
  if (seat.index) seat = seat.toNonIndexed();
  seat.translate(0, seatH, 0);
  addColor(seat, 0x8B6914);
  parts.push(seat);

  // Backrest
  let back = new THREE.BoxGeometry(benchW, backH, backThk);
  if (back.index) back = back.toNonIndexed();
  back.translate(0, seatH + backH / 2, -seatD / 2 + backThk / 2);
  addColor(back, 0x8B6914);
  parts.push(back);

  // 4 Legs
  const legPositions = [
    [-benchW / 2 + legSz, -seatD / 2 + legSz],
    [benchW / 2 - legSz, -seatD / 2 + legSz],
    [-benchW / 2 + legSz, seatD / 2 - legSz],
    [benchW / 2 - legSz, seatD / 2 - legSz],
  ];
  for (const [lx, lz] of legPositions) {
    let leg = new THREE.BoxGeometry(legSz, seatH, legSz);
    if (leg.index) leg = leg.toNonIndexed();
    leg.translate(lx, seatH / 2, lz);
    addColor(leg, 0x555555);
    parts.push(leg);
  }

  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
};

/**
 * Traffic sign: pole + sign face (octagon for stop, triangle for give_way, rectangle default).
 * OSM2World: pole r=0.05m h=2.0m, sign ~0.6m.
 */
const createTrafficSignMesh = (signType, unitsPerMeter) => {
  const poleH = 2.5 * unitsPerMeter;
  const poleR = 0.04 * unitsPerMeter;
  const signSize = 0.5 * unitsPerMeter;
  const signThk = 0.02 * unitsPerMeter;
  const parts = [];

  // Pole
  let pole = new THREE.CylinderGeometry(poleR, poleR, poleH, 6);
  if (pole.index) pole = pole.toNonIndexed();
  pole.translate(0, poleH / 2, 0);
  addColor(pole, 0x888888);
  parts.push(pole);

  // Sign face
  let signColor = 0xcc0000; // red for stop
  if (signType === "give_way" || signType === "yield") {
    signColor = 0xcc0000; // red border triangle
  } else if (signType === "traffic_signals") {
    signColor = 0x333333; // dark housing for signal
  } else if (signType === "generic") {
    signColor = 0x2255cc; // blue info sign
  }

  let signGeo;
  if (signType === "traffic_signals") {
    // Cantilever mast arm traffic signal:
    // Vertical pole on the side, horizontal arm extending over road,
    // with signal heads hanging from the arm.
    const mastH = 6.0 * unitsPerMeter;
    const mastR = 0.12 * unitsPerMeter;
    const armLen = 5.0 * unitsPerMeter;
    const armR = 0.08 * unitsPerMeter;
    const sigW = 0.28 * unitsPerMeter;
    const sigH = 0.8 * unitsPerMeter;
    const sigD = 0.2 * unitsPerMeter;
    const lightR = 0.055 * unitsPerMeter;

    // Vertical mast pole (tapered)
    let mast = new THREE.CylinderGeometry(mastR * 0.7, mastR, mastH, 6);
    if (mast.index) mast = mast.toNonIndexed();
    mast.translate(0, mastH / 2, 0);
    addColor(mast, 0x666666);
    parts.push(mast);

    // Horizontal arm extending over the road (along +Z axis)
    let arm = new THREE.CylinderGeometry(armR * 0.8, armR, armLen, 6);
    if (arm.index) arm = arm.toNonIndexed();
    arm.rotateX(Math.PI / 2); // lay horizontal along Z
    arm.translate(0, mastH - armR, armLen / 2);
    addColor(arm, 0x666666);
    parts.push(arm);

    // Elbow brace (diagonal strut from pole to arm)
    const braceLen = 2.0 * unitsPerMeter;
    const braceR = 0.04 * unitsPerMeter;
    let brace = new THREE.CylinderGeometry(braceR, braceR, braceLen * 1.4, 4);
    if (brace.index) brace = brace.toNonIndexed();
    brace.rotateX(Math.PI / 4); // 45 degree angle
    brace.translate(0, mastH - braceLen * 0.5, braceLen * 0.5);
    addColor(brace, 0x666666);
    parts.push(brace);

    // Create signal head at a given Z offset along the arm
    const createSignalHead = (zPos) => {
      const headParts = [];
      // Short vertical hanger pipe
      const hangerH = 0.4 * unitsPerMeter;
      let hanger = new THREE.CylinderGeometry(braceR, braceR, hangerH, 4);
      if (hanger.index) hanger = hanger.toNonIndexed();
      hanger.translate(0, mastH - armR - hangerH / 2, zPos);
      addColor(hanger, 0x555555);
      headParts.push(hanger);

      // Signal housing box
      const headY = mastH - armR - hangerH - sigH / 2;
      let housing = new THREE.BoxGeometry(sigW, sigH, sigD);
      if (housing.index) housing = housing.toNonIndexed();
      housing.translate(0, headY, zPos);
      addColor(housing, 0x2a2a2a);
      headParts.push(housing);

      // Visor hoods (small boxes above each light)
      const visorW = sigW + 0.04 * unitsPerMeter;
      const visorD = 0.12 * unitsPerMeter;
      const visorH = 0.04 * unitsPerMeter;

      // 3 lights (red, yellow, green)
      const lightColors = [0xcc0000, 0xccaa00, 0x00aa00];
      const spacing = sigH / 4;
      for (let li = 0; li < 3; li++) {
        const ly = headY + sigH / 2 - spacing * (li + 0.75);
        // Light sphere
        let light = new THREE.SphereGeometry(lightR, 5, 4);
        if (light.index) light = light.toNonIndexed();
        light.translate(0, ly, zPos + sigD / 2 + lightR * 0.3);
        addColor(light, lightColors[li]);
        headParts.push(light);
        // Visor hood
        let visor = new THREE.BoxGeometry(visorW, visorH, visorD);
        if (visor.index) visor = visor.toNonIndexed();
        visor.translate(0, ly + lightR + visorH / 2, zPos + sigD / 2 + visorD / 2);
        addColor(visor, 0x2a2a2a);
        headParts.push(visor);
      }
      return headParts;
    };

    // Hang 2 signal heads along the arm (simulating one per lane)
    parts.push(...createSignalHead(armLen * 0.4));
    parts.push(...createSignalHead(armLen * 0.8));

    // Skip the regular sign code below
    const merged = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    return merged;
  } else {
    // Regular sign: flat box
    signGeo = new THREE.BoxGeometry(signSize, signSize, signThk);
    if (signGeo.index) signGeo = signGeo.toNonIndexed();
    signGeo.translate(0, poleH + signSize * 0.1, signThk);
    addColor(signGeo, signColor);
    parts.push(signGeo);
  }

  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
};

const createTreeMesh = (type, unitsPerMeter) => {
  try {
    const trunkHeight = (type === "palm" ? 5 : 6) * unitsPerMeter;
    let trunkGeo = new THREE.CylinderGeometry(
      0.15 * unitsPerMeter,
      0.25 * unitsPerMeter,
      trunkHeight,
      8,
    );
    if (trunkGeo.index) trunkGeo = trunkGeo.toNonIndexed();
    trunkGeo.translate(0, trunkHeight / 2, 0);
    addColor(trunkGeo, 0x5d4037);

    if (type === "palm") {
      const fronds = [];
      for (let i = 0; i < 8; i++) {
        let frondGeo = new THREE.CylinderGeometry(
          0.01 * unitsPerMeter,
          0.2 * unitsPerMeter,
          3.5 * unitsPerMeter,
          4,
        );
        if (frondGeo.index) frondGeo = frondGeo.toNonIndexed();
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
      let crownGeo = new THREE.CylinderGeometry(
        0,
        2.5 * unitsPerMeter,
        7 * unitsPerMeter,
        8,
      );
      if (crownGeo.index) crownGeo = crownGeo.toNonIndexed();
      crownGeo.translate(0, 6.5 * unitsPerMeter, 0);
      addColor(crownGeo, 0x064e3b);
      const merged = mergeGeometries([trunkGeo, crownGeo]);
      crownGeo.dispose();
      trunkGeo.dispose();
      return merged;
    } else {
      let crownGeo = new THREE.IcosahedronGeometry(
        3 * unitsPerMeter,
        1,
      );
      if (crownGeo.index) crownGeo = crownGeo.toNonIndexed();
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
const createTerrainMesh = async (data, maxMeshResolution = 1024) => {
  return new Promise((resolve, reject) => {
    try {
      // 1. Create Geometry
      const baseStride = Math.ceil(
        Math.max(data.width, data.height) / maxMeshResolution,
      );
      const stride = Math.max(baseStride, 1);

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
      const textureUrl = data.osmTextureUrl || data.satelliteTextureUrl;
      if (textureUrl) {
        const loader = new THREE.TextureLoader();
        loader.load(
          textureUrl,
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

/**
 * Find the best corner ("armpit") at an intersection for placing a traffic
 * signal pole.  Detects road segments whose endpoints are near the given
 * position, collects their outgoing directions, then places the pole in the
 * largest angular gap between roads — the corner that is most clearly off
 * the carriageway.
 *
 * @returns {{ x, z, armAngle }} offset from center and arm orientation,
 *          or null if no usable intersection geometry is found.
 */
function findIntersectionCorner(px, pz, roadSegments, unitsPerMeter) {
  const threshold = 3.0 * unitsPerMeter;
  const thresholdSq = threshold * threshold;

  // Collect outgoing directions from segments that touch this intersection
  const dirs = [];
  for (let si = 0; si < roadSegments.length; si += 4) {
    const ax = roadSegments[si],     az = roadSegments[si + 1];
    const bx = roadSegments[si + 2], bz = roadSegments[si + 3];

    const daSq = (ax - px) ** 2 + (az - pz) ** 2;
    const dbSq = (bx - px) ** 2 + (bz - pz) ** 2;

    // Endpoint A at intersection → road goes toward B
    if (daSq < thresholdSq && dbSq > thresholdSq) {
      dirs.push(Math.atan2(bx - ax, bz - az));
    }
    // Endpoint B at intersection → road goes toward A
    if (dbSq < thresholdSq && daSq > thresholdSq) {
      dirs.push(Math.atan2(ax - bx, az - bz));
    }
  }

  if (dirs.length < 2) return null; // not a real intersection

  // Sort and de-duplicate directions within ~10°
  dirs.sort((a, b) => a - b);
  const ud = [dirs[0]];
  for (let i = 1; i < dirs.length; i++) {
    let d = Math.abs(dirs[i] - ud[ud.length - 1]);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > 0.17) ud.push(dirs[i]);
  }
  if (ud.length < 2) return null;

  // Find the largest angular gap between consecutive road directions
  let maxGap = 0, maxIdx = 0;
  for (let i = 0; i < ud.length; i++) {
    const ni = (i + 1) % ud.length;
    const gap = ni === 0
      ? ud[0] + 2 * Math.PI - ud[ud.length - 1]
      : ud[ni] - ud[i];
    if (gap > maxGap) { maxGap = gap; maxIdx = i; }
  }

  // Bisect the gap — this direction points from center into the corner
  const bisector = ud[maxIdx] + maxGap / 2;
  const dist = 6.0 * unitsPerMeter;

  return {
    x: Math.sin(bisector) * dist,
    z: Math.cos(bisector) * dist,
    armAngle: bisector + Math.PI, // arm points back toward intersection
  };
}

export const createOSMGroup = (data) => {
  const group = new THREE.Group();
  if (!data.osmFeatures || data.osmFeatures.length === 0) return group;

  const latRad =
    (((data.bounds.north + data.bounds.south) / 2) * Math.PI) / 180;
  const metersPerDegree = 111320 * Math.cos(latRad);
  const realWidthMeters =
    (data.bounds.east - data.bounds.west) * metersPerDegree;
  const unitsPerMeter = SCENE_SIZE / realWidthMeters;

  // Global vegetation caps to prevent memory explosion on large tiles
  const MAX_TOTAL_TREES = 5000;
  const MAX_TOTAL_BUSHES = 5000;

  const buildingsList = [];
  const treesList = [];
  const bushesList = [];
  const barriersList = [];
  const streetFurnitureList = [];
  // Collect road/path centerline segments in scene coords for orienting furniture
  const roadSegments = [];


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

    // Collect road/path segments for furniture orientation
    if (f.type === "road" && f.geometry.length >= 2) {
      let prev = latLngToSceneFast(data, f.geometry[0].lat, f.geometry[0].lng);
      let prevX = prev.x, prevZ = prev.z;
      for (let i = 1; i < f.geometry.length; i++) {
        const cur = latLngToSceneFast(data, f.geometry[i].lat, f.geometry[i].lng);
        roadSegments.push(prevX, prevZ, cur.x, cur.z);
        prevX = cur.x;
        prevZ = cur.z;
      }
    }

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
    } else if (f.type === "street_furniture" && f.geometry.length === 1) {
      const v = latLngToScene(data, f.geometry[0].lat, f.geometry[0].lng);
      v.y = getHeightAtScenePos(data, v.x, v.z);
      let subtype = "generic";
      if (f.tags.highway === "street_lamp") subtype = "street_lamp";
      else if (f.tags.barrier === "bollard") subtype = "bollard";
      else if (f.tags.amenity === "bench") subtype = "bench";
      else if (f.tags.highway === "traffic_signals") subtype = "traffic_signals";
      else if (f.tags.highway === "stop") subtype = "stop";
      else if (f.tags.highway === "give_way") subtype = "give_way";
      else if (f.tags.traffic_sign) subtype = "generic";
      streetFurnitureList.push({ pos: v, subtype, tags: f.tags });
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
          const remaining = MAX_TOTAL_TREES - treesList.length;
          if (remaining <= 0) return;
          const count = Math.min(
            remaining,
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
            if (treesList.length >= MAX_TOTAL_TREES) return;
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
          const bushRemaining = MAX_TOTAL_BUSHES - bushesList.length;
          if (bushRemaining <= 0) return;
          const count = Math.min(
            bushRemaining,
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
            if (bushesList.length >= MAX_TOTAL_BUSHES) return;
            const v = latLngToScene(data, p.lat, p.lng);
            v.y = getHeightAtScenePos(data, v.x, v.z);
            bushesList.push(v);
          });
        }
      }
    }
  });

  if (treesList.length >= MAX_TOTAL_TREES) {
    console.warn(`[OSM] Tree count capped at ${MAX_TOTAL_TREES} to prevent memory issues`);
  }
  if (bushesList.length >= MAX_TOTAL_BUSHES) {
    console.warn(`[OSM] Bush count capped at ${MAX_TOTAL_BUSHES} to prevent memory issues`);
  }

  if (buildingsList.length > 0) {
    const wallGeos = [];
    const roofGeos = [];
    const windowGeos = [];

    // Small offset scaled to real-world units to prevent z-fighting
    const roofZOffset = 0.005 * unitsPerMeter; // 5mm
    const winNormalOffset = 0.03 * unitsPerMeter; // 3cm from wall surface

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
      const wallGeoRaw = new THREE.ExtrudeGeometry(shape, wallExtrude);
      wallGeoRaw.rotateX(-Math.PI / 2);
      wallGeoRaw.translate(0, b.y, 0);

      // Strip cap faces from ExtrudeGeometry to prevent z-fighting with roof.
      // ExtrudeGeometry groups: group 0 = front+back caps, group 1 = side walls.
      // We need to remove the caps and keep only the sides.
      const rawGroups = wallGeoRaw.groups;
      let wallGeo;
      if (rawGroups.length > 1 && wallGeoRaw.index) {
        // Find the side group (materialIndex 1 in ExtrudeGeometry)
        const sideGroup = rawGroups.find((g) => g.materialIndex === 1);
        if (sideGroup) {
          const oldIndex = wallGeoRaw.index;
          const oldPos = wallGeoRaw.attributes.position;
          const oldUv = wallGeoRaw.attributes.uv;

          const sideIndexCount = sideGroup.count;
          const sideStart = sideGroup.start;

          // Collect unique vertex indices used by side faces
          const usedSet = new Set();
          for (let i = 0; i < sideIndexCount; i++) {
            usedSet.add(oldIndex.getX(sideStart + i));
          }
          const usedVerts = Array.from(usedSet).sort((a, b) => a - b);
          const vertMap = new Map();
          usedVerts.forEach((v, idx) => vertMap.set(v, idx));

          const newPos = new Float32Array(usedVerts.length * 3);
          const newUv = oldUv ? new Float32Array(usedVerts.length * 2) : null;
          usedVerts.forEach((oldIdx, newIdx) => {
            newPos[newIdx * 3] = oldPos.getX(oldIdx);
            newPos[newIdx * 3 + 1] = oldPos.getY(oldIdx);
            newPos[newIdx * 3 + 2] = oldPos.getZ(oldIdx);
            if (newUv) {
              newUv[newIdx * 2] = oldUv.getX(oldIdx);
              newUv[newIdx * 2 + 1] = oldUv.getY(oldIdx);
            }
          });

          const newIndices = new Uint32Array(sideIndexCount);
          for (let i = 0; i < sideIndexCount; i++) {
            newIndices[i] = vertMap.get(oldIndex.getX(sideStart + i));
          }

          wallGeo = new THREE.BufferGeometry();
          wallGeo.setAttribute("position", new THREE.BufferAttribute(newPos, 3));
          if (newUv) wallGeo.setAttribute("uv", new THREE.BufferAttribute(newUv, 2));
          wallGeo.setIndex(new THREE.BufferAttribute(newIndices, 1));
          wallGeo.computeVertexNormals();
          wallGeoRaw.dispose();
        } else {
          wallGeo = wallGeoRaw;
        }
      } else {
        wallGeo = wallGeoRaw;
      }

      // Convert to non-indexed for merging
      if (wallGeo.index) {
        const tmp = wallGeo.toNonIndexed();
        wallGeo.dispose();
        wallGeo = tmp;
      }

      // Wall vertex colors (Darker sides)
      const pos = wallGeo.attributes.position;
      const wallColors = new Float32Array(pos.count * 3);
      const wallC = new THREE.Color(b.wallColor);
      for (let i = 0; i < pos.count; i++) {
        wallColors[i * 3] = wallC.r * 0.88;
        wallColors[i * 3 + 1] = wallC.g * 0.88;
        wallColors[i * 3 + 2] = wallC.b * 0.88;
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
          wallUv.setXY(
            i,
            wallUv.getX(i) * (totalDist / uvScale),
            wallUv.getY(i) * (b.height / uvScale),
          );
        }
      }

      wallGeos.push(wallGeo);

      // 2. Create Roof Geometry
      let roofGeo;
      const roofY = b.y + b.height;
      if (b.roofShape === "pyramidal" || b.roofShape === "gabled") {
        const vertices = [];
        const indices = [];
        const roofColorArr = [];
        const rc = new THREE.Color(b.roofColor);

        let centroidX = 0,
          centroidZ = 0;
        b.points.forEach((p) => {
          centroidX += p.x;
          centroidZ += p.z;
        });
        centroidX /= b.points.length;
        centroidZ /= b.points.length;

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
        roofGeo.translate(0, roofY + roofZOffset, 0);

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

      // 3. Procedural Windows — stamp vertices directly into arrays to avoid
      // thousands of PlaneGeometry allocations (major GC pressure reduction)
      if (b.levels > 1 && b.height > 2 * unitsPerMeter) {
        const winWidth = 1.0 * unitsPerMeter;
        const winHeight = 1.2 * unitsPerMeter;
        const winPadding = 2.0 * unitsPerMeter;
        const halfW = winWidth / 2;
        const halfH = winHeight / 2;
        const wc = new THREE.Color(0x1e293b);

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
            // Plane tangent vectors: right = along wall, up = Y axis
            // Use wall tangent (dx, dz) for rotation so windows are flat against the wall
            const angle = Math.atan2(dx, dz);
            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);

            for (let j = 0; j < numWindows; j++) {
              const t = (j + 0.5) / numWindows;
              const cx = p1.x + dx * t + normalX * winNormalOffset;
              const cz = p1.z + dz * t + normalZ * winNormalOffset;

              for (let l = 0; l < b.levels; l++) {
                const cy = b.y + (l + 0.5) * (b.height / b.levels);
                // 4 corners of window plane rotated around Y
                // PlaneGeometry default: vertices at (-halfW,-halfH,0), (halfW,-halfH,0), (-halfW,halfH,0), (halfW,halfH,0)
                // After rotateY(angle): x' = x*cos + z*sin, z' = -x*sin + z*cos (z=0 for plane)
                const lx = -halfW * sinA; // rotated local -halfW
                const lz = -halfW * cosA;
                const rx = halfW * sinA;  // rotated local +halfW
                const rz = halfW * cosA;

                // 6 vertices (2 triangles) for one quad
                const verts = new Float32Array(18);
                const colors = new Float32Array(18);
                // tri 1: bottom-left, bottom-right, top-left
                verts[0] = cx + lx; verts[1] = cy - halfH; verts[2] = cz + lz;
                verts[3] = cx + rx; verts[4] = cy - halfH; verts[5] = cz + rz;
                verts[6] = cx + lx; verts[7] = cy + halfH; verts[8] = cz + lz;
                // tri 2: top-left, bottom-right, top-right
                verts[9] = cx + lx; verts[10] = cy + halfH; verts[11] = cz + lz;
                verts[12] = cx + rx; verts[13] = cy - halfH; verts[14] = cz + rz;
                verts[15] = cx + rx; verts[16] = cy + halfH; verts[17] = cz + rz;
                for (let ci = 0; ci < 6; ci++) {
                  colors[ci * 3] = wc.r;
                  colors[ci * 3 + 1] = wc.g;
                  colors[ci * 3 + 2] = wc.b;
                }
                const wGeo = new THREE.BufferGeometry();
                wGeo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
                wGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
                wGeo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(12), 2));
                wGeo.computeVertexNormals();
                windowGeos.push(wGeo);
              }
            }
          }
        }
      }
    });

    // Merge each category, then combine into a single mesh with material groups
    // This prevents float32 precision drift between separate meshes at large tile sizes
    const wallMerged = wallGeos.length > 0 ? mergeGeometries(wallGeos) : null;
    const roofMerged = roofGeos.length > 0 ? mergeGeometries(roofGeos) : null;
    const windowMerged = windowGeos.length > 0 ? mergeGeometries(windowGeos) : null;

    const partsToMerge = [];
    const groupDefs = [];
    let vertexOffset = 0;

    if (wallMerged) {
      const count = wallMerged.attributes.position.count;
      partsToMerge.push(wallMerged);
      groupDefs.push({ start: vertexOffset, count, materialIndex: 0 });
      vertexOffset += count;
    }
    if (roofMerged) {
      const count = roofMerged.attributes.position.count;
      partsToMerge.push(roofMerged);
      groupDefs.push({ start: vertexOffset, count, materialIndex: 1 });
      vertexOffset += count;
    }
    if (windowMerged) {
      const count = windowMerged.attributes.position.count;
      partsToMerge.push(windowMerged);
      groupDefs.push({ start: vertexOffset, count, materialIndex: 2 });
      vertexOffset += count;
    }

    if (partsToMerge.length > 0) {
      const combined = mergeGeometries(partsToMerge);
      if (combined) {
        combined.clearGroups();
        groupDefs.forEach((g) =>
          combined.addGroup(g.start, g.count, g.materialIndex),
        );

        const buildingMesh = new THREE.Mesh(combined, [
          new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.8,
            map: textures.wall,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
          }),
          new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.8,
            map: textures.roof,
          }),
          new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.1,
            metalness: 0.5,
          }),
        ]);
        buildingMesh.castShadow = true;
        buildingMesh.receiveShadow = true;
        buildingMesh.name = "buildings";
        group.add(buildingMesh);
      }
    }

    wallGeos.forEach((g) => g.dispose());
    roofGeos.forEach((g) => g.dispose());
    windowGeos.forEach((g) => g.dispose());
    if (wallMerged) wallMerged.dispose();
    if (roofMerged) roofMerged.dispose();
    if (windowMerged) windowMerged.dispose();
  }

  if (barriersList.length > 0) {
    const geos = [];
    barriersList.forEach((b) => {
      const geo = createBarrierGeometry(data, b.points, b.width, b.height);
      addColor(geo, b.color);
      geos.push(geo);
    });
    const compatibleGeos = geos.map((g) => g.index ? g.toNonIndexed() : g);
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
  const yAxis = new THREE.Vector3(0, 1, 0);

  // Optimized vegetation: pre-allocate combined buffer and stamp transforms
  // instead of cloning base geometry N times then merging
  const stampInstances = (baseGeo, instances, getMat) => {
    const basePos = baseGeo.attributes.position;
    const baseCol = baseGeo.attributes.color;
    const vertCount = basePos.count;
    const totalVerts = vertCount * instances.length;
    const combinedPos = new Float32Array(totalVerts * 3);
    const combinedCol = new Float32Array(totalVerts * 3);
    const tmpV = new THREE.Vector3();

    for (let i = 0; i < instances.length; i++) {
      const mat = getMat(instances[i]);
      const off = i * vertCount * 3;
      for (let v = 0; v < vertCount; v++) {
        tmpV.set(basePos.getX(v), basePos.getY(v), basePos.getZ(v));
        tmpV.applyMatrix4(mat);
        combinedPos[off + v * 3] = tmpV.x;
        combinedPos[off + v * 3 + 1] = tmpV.y;
        combinedPos[off + v * 3 + 2] = tmpV.z;
        combinedCol[off + v * 3] = baseCol.getX(v);
        combinedCol[off + v * 3 + 1] = baseCol.getY(v);
        combinedCol[off + v * 3 + 2] = baseCol.getZ(v);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(combinedPos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(combinedCol, 3));
    geo.computeVertexNormals();
    return geo;
  };

  if (treesList.length > 0) {
    const types = ["deciduous", "coniferous", "palm"];
    types.forEach((type) => {
      const list = treesList.filter((t) => t.type === type);
      if (list.length === 0) return;
      const baseGeo = createTreeMesh(type, unitsPerMeter);
      if (!baseGeo) return;

      const combined = stampInstances(baseGeo, list, (tree) => {
        const seed = Math.abs((tree.pos.x * 123.45 + tree.pos.z * 678.9) % 1);
        const s = 0.95 + seed * 0.1;
        position.set(tree.pos.x, tree.pos.y, tree.pos.z);
        scale.set(s, s, s);
        quaternion.setFromAxisAngle(yAxis, seed * Math.PI * 2);
        return matrix.compose(position, quaternion, scale).clone();
      });

      if (combined) {
        const treeMesh = new THREE.Mesh(
          combined,
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
      baseGeo.dispose();
    });
  }

  if (bushesList.length > 0) {
    let baseB = new THREE.IcosahedronGeometry(1.2 * unitsPerMeter, 0);
    if (baseB.index) baseB = baseB.toNonIndexed();
    addColor(baseB, 0x166534);

    const combined = stampInstances(baseB, bushesList, (pos) => {
      const seed = (pos.x * 543.21 + pos.z * 123.4) % 1;
      const s = 0.7 + seed * 0.6;
      scale.set(s, s * 0.8, s);
      quaternion.setFromAxisAngle(yAxis, seed * Math.PI * 2);
      position.set(pos.x, pos.y + 0.5 * s * unitsPerMeter, pos.z);
      return matrix.compose(position, quaternion, scale).clone();
    });

    if (combined) {
      const bushMesh = new THREE.Mesh(
        combined,
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
      );
      bushMesh.castShadow = true;
      bushMesh.receiveShadow = true;
      bushMesh.name = "vegetation";
      group.add(bushMesh);
    }
    baseB.dispose();
  }

  // === Street Furniture Rendering ===
  if (streetFurnitureList.length > 0) {
    const MAX_FURNITURE = 3000;
    if (streetFurnitureList.length > MAX_FURNITURE) {
      console.warn(`[OSM] Street furniture capped at ${MAX_FURNITURE} (had ${streetFurnitureList.length})`);
      streetFurnitureList.length = MAX_FURNITURE;
    }

    // Build base geometries for each subtype
    const baseGeos = {
      street_lamp: createStreetLampMesh(unitsPerMeter),
      bollard: createBollardMesh(unitsPerMeter),
      bench: createBenchMesh(unitsPerMeter),
      traffic_signals: createTrafficSignMesh("traffic_signals", unitsPerMeter),
      stop: createTrafficSignMesh("stop", unitsPerMeter),
      give_way: createTrafficSignMesh("give_way", unitsPerMeter),
      generic: createTrafficSignMesh("generic", unitsPerMeter),
    };

    // Group furniture by subtype and stamp instances
    const subtypes = Object.keys(baseGeos);
    for (const st of subtypes) {
      const items = streetFurnitureList.filter((f) => f.subtype === st);
      if (items.length === 0) continue;
      const baseGeo = baseGeos[st];
      if (!baseGeo) continue;

      const combined = stampInstances(baseGeo, items, (item) => {
        // For traffic signals, offset the pole base to the roadside.
        // The arm extends along +Z in local space, so we move the base
        // backward (-Z local) so the pole sits at the road edge and
        // the arm hangs over the intersection center.
        let angle = 0;
        if (item.tags && item.tags.direction) {
          const deg = parseFloat(item.tags.direction);
          if (!isNaN(deg)) angle = (deg * Math.PI) / 180;
          else angle = Math.random() * Math.PI * 2;
        } else if ((st === "bench" || st === "street_lamp") && roadSegments.length >= 4) {
          // Orient benches/lamps to face the nearest road segment
          const px = item.pos.x, pz = item.pos.z;
          let bestDistSq = Infinity, bestAngle = 0;
          for (let si = 0; si < roadSegments.length; si += 4) {
            const ax = roadSegments[si], az = roadSegments[si + 1];
            const bx = roadSegments[si + 2], bz = roadSegments[si + 3];
            const abx = bx - ax, abz = bz - az;
            const lenSq = abx * abx + abz * abz;
            if (lenSq < 1e-8) continue;
            let t = ((px - ax) * abx + (pz - az) * abz) / lenSq;
            t = Math.max(0, Math.min(1, t));
            const cx = ax + t * abx - px, cz = az + t * abz - pz;
            const dSq = cx * cx + cz * cz;
            if (dSq < bestDistSq) {
              bestDistSq = dSq;
              // Bench: back faces away from road → orient along the road
              // Street lamp: face the road
              bestAngle = Math.atan2(abx, abz);
            }
          }
          angle = bestAngle;
          if (st === "bench") {
            // Bench faces the road: rotate 90° so seat faces road
            angle += Math.PI / 2;
          }
        } else {
          angle = Math.random() * Math.PI * 2;
        }

        if (st === "traffic_signals") {
          // Place pole at the intersection corner ("armpit")
          const corner = findIntersectionCorner(
            item.pos.x, item.pos.z, roadSegments, unitsPerMeter,
          );
          if (corner) {
            position.set(
              item.pos.x + corner.x, item.pos.y, item.pos.z + corner.z,
            );
            angle = corner.armAngle;
          } else {
            // Fallback: offset perpendicular to the nearest road segment
            const px = item.pos.x, pz = item.pos.z;
            let bestDSq = Infinity, roadAngle = 0;
            for (let si = 0; si < roadSegments.length; si += 4) {
              const ax = roadSegments[si], az = roadSegments[si + 1];
              const bx = roadSegments[si + 2], bz = roadSegments[si + 3];
              const abx = bx - ax, abz = bz - az;
              const lenSq = abx * abx + abz * abz;
              if (lenSq < 1e-8) continue;
              let t = ((px - ax) * abx + (pz - az) * abz) / lenSq;
              t = Math.max(0, Math.min(1, t));
              const dx = ax + t * abx - px, dz = az + t * abz - pz;
              const dSq = dx * dx + dz * dz;
              if (dSq < bestDSq) {
                bestDSq = dSq;
                roadAngle = Math.atan2(abx, abz);
              }
            }
            // Offset perpendicular to road, 6 m from centerline
            const offsetDist = 6.0 * unitsPerMeter;
            const perpAngle = roadAngle + Math.PI / 2;
            position.set(
              px + Math.sin(perpAngle) * offsetDist,
              item.pos.y,
              pz + Math.cos(perpAngle) * offsetDist,
            );
            angle = roadAngle; // arm along the road
          }
        } else {
          position.set(item.pos.x, item.pos.y, item.pos.z);
        }
        quaternion.setFromAxisAngle(yAxis, angle);
        scale.set(1, 1, 1);
        return matrix.compose(position, quaternion, scale).clone();
      });

      if (combined) {
        const furnitureMesh = new THREE.Mesh(
          combined,
          new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.6,
            metalness: 0.3,
          }),
        );
        furnitureMesh.castShadow = true;
        furnitureMesh.receiveShadow = true;
        furnitureMesh.name = "street_furniture";
        group.add(furnitureMesh);
      }
    }

    // Dispose base geometries
    for (const geo of Object.values(baseGeos)) {
      if (geo) geo.dispose();
    }

    console.log(`[OSM] Rendered ${streetFurnitureList.length} street furniture items`);
  }

  return group;
};

const disposeScene = (scene) => {
  scene.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach(m => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    }
  });
};

export const exportToGLB = async (data, options = {}) => {
  const { includeSurroundings = false, onProgress, maxMeshResolution = 1024, returnBlob = false } = options;
  try {
    onProgress?.('Building terrain mesh...');
    const terrainMesh = await createTerrainMesh(data, maxMeshResolution);
    const osmGroup = createOSMGroup(data);
    const scene = new THREE.Scene();
    scene.add(terrainMesh);
    scene.add(osmGroup);

    if (includeSurroundings) {
      onProgress?.('Fetching surrounding tiles for GLB...');
      const surroundingGroup = await createSurroundingMeshes(data, onProgress, Math.floor(maxMeshResolution / 4));
      if (surroundingGroup) scene.add(surroundingGroup);
    }

    onProgress?.('Encoding GLB...');
    const { GLTFExporter } =
      await import("three/examples/jsm/exporters/GLTFExporter.js");
    return new Promise((resolve, reject) => {
      const exporter = new GLTFExporter();
      exporter.parse(
        scene,
        (gltf) => {
          const blob = new Blob([gltf], { type: "model/gltf-binary" });
          disposeScene(scene);

          if (returnBlob) {
            onProgress?.('Done!');
            resolve(blob);
            return;
          }

          const link = document.createElement("a");
          link.href = URL.createObjectURL(blob);
          const date = new Date().toISOString().slice(0, 10);
          const lat = ((data.bounds.north + data.bounds.south) / 2).toFixed(4);
          const lng = ((data.bounds.east + data.bounds.west) / 2).toFixed(4);
          link.download = `MapNG_Model_${date}_${lat}_${lng}.glb`;
          link.click();
          URL.revokeObjectURL(link.href);
          onProgress?.('Done!');
          resolve();
        },
        (err) => { disposeScene(scene); reject(err); },
        { binary: true },
      );
    });
  } catch (err) {
    console.error("Export failed:", err);
    if (returnBlob) throw err;
  }
};

export const exportToDAE = async (data, options = {}) => {
  const { includeSurroundings = false, onProgress, maxMeshResolution = 256, returnBlob = false } = options;
  try {
    onProgress?.('Building terrain mesh...');
    const terrainMesh = await createTerrainMesh(data, maxMeshResolution);
    const osmGroup = createOSMGroup(data);
    const scene = new THREE.Scene();
    scene.add(terrainMesh);
    scene.add(osmGroup);

    if (includeSurroundings) {
      onProgress?.('Fetching surrounding tiles for DAE...');
      const surroundingGroup = await createSurroundingMeshes(data, onProgress, Math.floor(maxMeshResolution / 4));
      if (surroundingGroup) scene.add(surroundingGroup);
    }

    onProgress?.('Encoding Collada...');
    const { ColladaExporter } = await import('./ColladaExporter.js');
    const exporter = new ColladaExporter();
    const result = exporter.parse(scene);

    disposeScene(scene);

    const daeBlob = result.data;
    let outputBlob;

    if (result.textures && result.textures.length > 0) {
      onProgress?.('Packaging textures...');
      const zip = new JSZip();
      zip.file('model.dae', daeBlob);
      for (const tex of result.textures) {
        zip.file(`${tex.directory}${tex.name}.${tex.ext}`, tex.data);
      }
      outputBlob = await zip.generateAsync({ type: 'blob' });
    } else {
      outputBlob = daeBlob;
    }

    if (returnBlob) {
      onProgress?.('Done!');
      return outputBlob;
    }

    const link = document.createElement('a');
    link.href = URL.createObjectURL(outputBlob);
    const date = new Date().toISOString().slice(0, 10);
    const lat = ((data.bounds.north + data.bounds.south) / 2).toFixed(4);
    const lng = ((data.bounds.east + data.bounds.west) / 2).toFixed(4);
    const ext = result.textures?.length > 0 ? '.dae.zip' : '.dae';
    link.download = `MapNG_Model_${date}_${lat}_${lng}${ext}`;
    link.click();
    URL.revokeObjectURL(link.href);

    onProgress?.('Done!');
  } catch (err) {
    console.error("DAE Export failed:", err);
    throw err;
  }
};

// --- Surrounding Tiles for GLB ---

const SURROUND_OFFSETS = {
  NW: { x: -1, z: -1 },
  N:  { x:  0, z: -1 },
  NE: { x:  1, z: -1 },
  W:  { x: -1, z:  0 },
  E:  { x:  1, z:  0 },
  SW: { x: -1, z:  1 },
  S:  { x:  0, z:  1 },
  SE: { x:  1, z:  1 },
};

const GLB_SURROUND_RES = 256;
const GLB_SURROUND_SAT_ZOOM = 14;

const createSurroundingMeshes = async (data, onProgress, maxMeshResolution = 128) => {
  try {
    const allPositions = POSITIONS.map(p => p.key);
    const results = await fetchSurroundingTiles(
      data.bounds,
      allPositions,
      GLB_SURROUND_RES,
      GLB_SURROUND_SAT_ZOOM,
      onProgress,
    );

    const latRad = ((data.bounds.north + data.bounds.south) / 2 * Math.PI) / 180;
    const metersPerDegree = 111320 * Math.cos(latRad);
    const realWidthMeters = (data.bounds.east - data.bounds.west) * metersPerDegree;
    const unitsPerMeter = SCENE_SIZE / realWidthMeters;

    const group = new THREE.Group();
    group.name = 'surrounding_terrain';

    for (const [pos, tileData] of Object.entries(results)) {
      const offset = SURROUND_OFFSETS[pos];
      if (!offset) continue;

      onProgress?.(`Building mesh for tile ${pos}...`);

      const w = tileData.width;
      const h = tileData.height;
      const stride = Math.max(Math.ceil(Math.max(w, h) / maxMeshResolution), 1);
      const segsX = Math.floor((w - 1) / stride);
      const segsY = Math.floor((h - 1) / stride);

      const geo = new THREE.PlaneGeometry(SCENE_SIZE, SCENE_SIZE, segsX, segsY);
      const verts = geo.attributes.position.array;

      for (let i = 0; i < verts.length / 3; i++) {
        const col = i % (segsX + 1);
        const row = Math.floor(i / (segsX + 1));

        const u = col / segsX;
        const v = row / segsY;

        const mapCol = Math.min(Math.round(u * (w - 1)), w - 1);
        const mapRow = Math.min(Math.round(v * (h - 1)), h - 1);
        const idx = mapRow * w + mapCol;

        let elev = tileData.heightMap[idx];
        if (elev < -10000) elev = tileData.minHeight;

        const localX = u * SCENE_SIZE - SCENE_SIZE / 2;
        const localZ = v * SCENE_SIZE - SCENE_SIZE / 2;

        verts[i * 3]     = localX + offset.x * SCENE_SIZE;
        verts[i * 3 + 1] = -(localZ + offset.z * SCENE_SIZE);
        verts[i * 3 + 2] = (elev - data.minHeight) * unitsPerMeter;
      }

      geo.computeVertexNormals();

      const mat = new THREE.MeshStandardMaterial({
        roughness: 1,
        metalness: 0,
        side: THREE.DoubleSide,
        color: 0xffffff,
      });

      // Load satellite texture
      if (tileData.satelliteDataUrl) {
        try {
          const tex = await new Promise((resolve, reject) => {
            new THREE.TextureLoader().load(
              tileData.satelliteDataUrl,
              (t) => {
                t.colorSpace = THREE.SRGBColorSpace;
                t.minFilter = THREE.LinearFilter;
                t.magFilter = THREE.LinearFilter;
                resolve(t);
              },
              undefined,
              reject,
            );
          });
          mat.map = tex;
        } catch {
          // texture load failed, use solid color
        }
      }

      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.updateMatrixWorld();
      mesh.name = `terrain_${pos}`;
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    return group;
  } catch (e) {
    console.error('[GLB Surroundings] Failed:', e);
    return null;
  }
};
