<script setup>
import { computed, shallowRef, reactive, watch, toRaw, markRaw, onUnmounted, ref } from 'vue';
import * as THREE from 'three';
import { useTresContext, useLoop } from '@tresjs/core';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const props = defineProps({
  terrainData: { required: true },
  quality: { required: true },
  textureType: { default: 'satellite' },
  showWater: { default: true, type: Boolean },
  waterLevelOffsetMeters: { default: 0, type: Number },
  wireframe: { default: false, type: Boolean },
  // the look (Visual quality "Cinematic"): earth-coloured sides under the
  // map's edges (a solid tile, not a sheet floating in the sky), and its
  // lakes as water surfaces
  skirt: { default: false, type: Boolean },
  lakes: { default: false, type: Boolean },
});

const SCENE_SIZE = 100;
const geometry = shallowRef(null);
const skirtGeometry = shallowRef(null);
const lakeGeometry = shallowRef(null);
const waterMeshRef = ref(null);
const waterCubeRenderTarget = shallowRef(null);
const waterCubeCamera = shallowRef(null);
const { scene, renderer, camera } = useTresContext();
const { onBeforeRender } = useLoop();

const WATER_REFLECTION_RESOLUTION_BY_QUALITY = {
  low: 64,
  medium: 96,
  high: 128,
  full: 128,
};
const WATER_REFLECTION_UPDATE_EVERY_N_FRAMES = 2;
const WATER_REFLECTION_FAR = 600;
const WATER_CAMERA_MOVE_EPSILON = 0.01;
const WATER_CAMERA_ROT_EPSILON = 0.0008;
const WATER_NORMAL_TEXTURE_SIZE = 128;
const WATER_NORMAL_SCROLL_X = 0.0003;
const WATER_NORMAL_SCROLL_Y = 0.0002;
const WATER_NORMAL_REPEAT = 12;
let reflectionFrameCounter = 0;
const lastReflectionCameraPosition = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);
const lastReflectionCameraQuaternion = new THREE.Quaternion(Number.NaN, Number.NaN, Number.NaN, Number.NaN);

const waterNormalTexture = shallowRef(null);
const waterNormalScale = markRaw(new THREE.Vector2(0.09, 0.07));
const lakeNormalScale = markRaw(new THREE.Vector2(0.18, 0.14));

// Build a small tileable normal map so the water catches directional light
// and reflections even when the terrain beneath is dark/flat.
const createWaterNormalTexture = (size = WATER_NORMAL_TEXTURE_SIZE) => {
  const heights = new Float32Array(size * size);
  const ampA = 0.32;
  const ampB = 0.2;
  const ampC = 0.12;
  const twoPi = Math.PI * 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const h =
        Math.sin((u * 1.45 + v * 0.55) * twoPi) * ampA +
        Math.sin((u * 0.65 - v * 1.7) * twoPi) * ampB +
        Math.sin((u * 2.2 + v * 1.95) * twoPi) * ampC;
      heights[y * size + x] = h;
    }
  }

  const data = new Uint8Array(size * size * 4);
  const strength = 0.65;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xPrev = (x - 1 + size) % size;
      const xNext = (x + 1) % size;
      const yPrev = (y - 1 + size) % size;
      const yNext = (y + 1) % size;

      const hL = heights[y * size + xPrev];
      const hR = heights[y * size + xNext];
      const hD = heights[yPrev * size + x];
      const hU = heights[yNext * size + x];

      const dx = (hR - hL) * strength;
      const dy = (hU - hD) * strength;

      const nx = -dx;
      const ny = -dy;
      const nz = 1.0;
      const invLen = 1 / Math.hypot(nx, ny, nz);

      const i = (y * size + x) * 4;
      data[i] = Math.round((nx * invLen * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * invLen * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((nz * invLen * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(WATER_NORMAL_REPEAT, WATER_NORMAL_REPEAT);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return markRaw(tex);
};

waterNormalTexture.value = createWaterNormalTexture();

const unitsPerMeter = computed(() => {
  const data = toRaw(props.terrainData);
  if (!data?.bounds) return 0;
  const latRad = ((data.bounds.north + data.bounds.south) / 2) * Math.PI / 180;
  const metersPerDegree = 111320 * Math.cos(latRad);
  const realWidthMeters = (data.bounds.east - data.bounds.west) * metersPerDegree;
  if (!Number.isFinite(realWidthMeters) || realWidthMeters <= 0) return 0;
  return SCENE_SIZE / realWidthMeters;
});

const seaLevelSceneZ = computed(() => {
  const data = toRaw(props.terrainData);
  const minHeight = Number(data?.minHeight);
  const upm = unitsPerMeter.value;
  if (!Number.isFinite(minHeight) || !Number.isFinite(upm) || upm <= 0) return 0;
  const offsetMeters = Number.isFinite(Number(props.waterLevelOffsetMeters))
    ? Number(props.waterLevelOffsetMeters)
    : 0;
  // Exported terrain uses minHeight as local Z origin, so sea level (0 m)
  // sits at -minHeight in terrain space.
  return (-minHeight + offsetMeters) * upm;
});

// Water only matters where sea level cuts the terrain. Inland/high-altitude
// areas (minHeight well above 0 m) would otherwise get an opaque sea floating
// far below the whole map, plus six-face reflection captures every other frame
// for a plane that never touches the terrain. The margin keeps the sea on low
// coasts (minHeight a few metres up a seawall) and flat maps (water at −1 m).
const WATER_HIDE_MARGIN_METERS = 10;
const waterVisible = computed(() => {
  if (!props.showWater) return false;
  const data = toRaw(props.terrainData);
  const minHeight = Number(data?.minHeight);
  if (!Number.isFinite(minHeight)) return true;
  const offsetMeters = Number(props.waterLevelOffsetMeters) || 0;
  return offsetMeters >= minHeight - WATER_HIDE_MARGIN_METERS;
});

const waterPlaneSize = computed(() => SCENE_SIZE * 3);
const waterEnvMap = computed(() => waterCubeRenderTarget.value?.texture ?? null);
const waterReflectionResolution = computed(() => {
  const quality = String(props.quality || 'medium');
  return WATER_REFLECTION_RESOLUTION_BY_QUALITY[quality] ?? WATER_REFLECTION_RESOLUTION_BY_QUALITY.medium;
});

const disposeWaterReflection = () => {
  const sceneObj = scene.value;
  if (sceneObj && waterCubeCamera.value) {
    sceneObj.remove(waterCubeCamera.value);
  }
  if (waterCubeRenderTarget.value) {
    waterCubeRenderTarget.value.dispose();
  }
  waterCubeRenderTarget.value = null;
  waterCubeCamera.value = null;
};

const initWaterReflection = () => {
  const sceneObj = scene.value;
  if (!sceneObj) return;
  disposeWaterReflection();

  const target = new THREE.WebGLCubeRenderTarget(waterReflectionResolution.value, {
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  target.texture.colorSpace = THREE.SRGBColorSpace;

  const cubeCamera = new THREE.CubeCamera(0.1, WATER_REFLECTION_FAR, target);
  sceneObj.add(cubeCamera);

  waterCubeRenderTarget.value = markRaw(target);
  waterCubeCamera.value = markRaw(cubeCamera);
};

watch(() => scene.value, (sceneObj) => {
  if (sceneObj) initWaterReflection();
}, { immediate: true });

watch(() => props.quality, () => {
  if (scene.value) initWaterReflection();
});

onBeforeRender(() => {
  const normalTex = waterNormalTexture.value;
  if (normalTex) {
    // Keep subtle motion independent from reflection probe updates so water
    // always animates even when the camera is stationary.
    normalTex.offset.x = (normalTex.offset.x + WATER_NORMAL_SCROLL_X) % 1;
    normalTex.offset.y = (normalTex.offset.y + WATER_NORMAL_SCROLL_Y) % 1;
  }

  if (!waterVisible.value) return;
  const sceneObj = scene.value;
  const rendererObj = renderer.value;
  const activeCamera = camera.value;
  const cubeCamera = waterCubeCamera.value;
  if (!sceneObj || !rendererObj || !cubeCamera || !activeCamera) return;

  reflectionFrameCounter += 1;
  if (reflectionFrameCounter % WATER_REFLECTION_UPDATE_EVERY_N_FRAMES !== 0) return;

  const cameraMoved = lastReflectionCameraPosition.distanceToSquared(activeCamera.position) > (WATER_CAMERA_MOVE_EPSILON * WATER_CAMERA_MOVE_EPSILON);
  const cameraRotated = 1 - Math.abs(lastReflectionCameraQuaternion.dot(activeCamera.quaternion)) > WATER_CAMERA_ROT_EPSILON;
  if (!cameraMoved && !cameraRotated) return;

  const waterMesh = waterMeshRef.value?.instance ?? waterMeshRef.value;
  // Keep the reflection probe near the viewer to avoid static, boxy artifacts
  // from sampling a single center-position cubemap over a large water plane.
  cubeCamera.position.set(activeCamera.position.x, seaLevelSceneZ.value + 0.15, activeCamera.position.z);

  // Hide water while capturing to avoid self-reflection artifacts.
  // Reuse this frame's shadow maps: CubeCamera.update() is six render() calls,
  // and each would otherwise re-render every CSM cascade (6 × 4 shadow passes
  // per capture) for a 128 px reflection that can't show the difference.
  if (waterMesh) waterMesh.visible = false;
  const shadowAutoUpdate = rendererObj.shadowMap.autoUpdate;
  rendererObj.shadowMap.autoUpdate = false;
  cubeCamera.update(rendererObj, sceneObj);
  rendererObj.shadowMap.autoUpdate = shadowAutoUpdate;
  if (waterMesh) waterMesh.visible = true;

  lastReflectionCameraPosition.copy(activeCamera.position);
  lastReflectionCameraQuaternion.copy(activeCamera.quaternion);
});

// ── The tile's sides and its lakes (Visual quality "Cinematic") ─────────────
// Sides: a quad strip from every edge vertex down to a base under the map's
// lowest point, coloured topsoil to deep earth, and the base closing it.
const SKIRT_TOP = new THREE.Color('#5a4838');
const SKIRT_BOTTOM = new THREE.Color('#1c1611');
function buildSkirt(vertices, widthSteps, heightSteps, upm, data) {
  const cols = widthSteps + 1; const rows = heightSteps + 1;
  const relief = (Number(data.maxHeight) - Number(data.minHeight)) * upm;
  const base = -Math.max(1.2, Math.min(6, (Number.isFinite(relief) ? relief : 10) * 0.06 + 1));
  const ring = [];
  for (let c = 0; c < cols; c++) ring.push(c);                                   // north edge, west → east
  for (let r = 1; r < rows; r++) ring.push(r * cols + cols - 1);                 // east edge, down
  for (let c = cols - 2; c >= 0; c--) ring.push((rows - 1) * cols + c);          // south edge, east → west
  for (let r = rows - 2; r > 0; r--) ring.push(r * cols);                        // west edge, up
  const pos = []; const col = []; const idx = [];
  const push = (x, y, z, k) => { pos.push(x, y, z); const c = SKIRT_BOTTOM.clone().lerp(SKIRT_TOP, k); col.push(c.r, c.g, c.b); return pos.length / 3 - 1; };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]; const b = ring[(i + 1) % ring.length];
    const ax = vertices[a * 3], ay = vertices[a * 3 + 1], az = vertices[a * 3 + 2];
    const bx = vertices[b * 3], by = vertices[b * 3 + 1], bz = vertices[b * 3 + 2];
    const at = push(ax, ay, az, 1); const bt = push(bx, by, bz, 1);
    const ab = push(ax, ay, base, 0); const bb = push(bx, by, base, 0);
    idx.push(at, ab, bt, bt, ab, bb);
  }
  // (the base under it all)
  const h = SCENE_SIZE / 2;
  const q = [push(-h, h, base, 0), push(h, h, base, 0), push(h, -h, base, 0), push(-h, -h, base, 0)];
  idx.push(q[0], q[2], q[1], q[0], q[3], q[2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Lakes: each standing-water outline (OSM natural=water, reservoirs, wide
// rivers) as a surface at its level (the median ground inside it: the data
// records a lake's surface as its ground), a hair above the terrain.
const isPreviewLake = (f) => {
  const t = f?.tags || {};
  if (f?.type !== 'water' || !(f.geometry?.length > 3)) return false;
  if (t.amenity === 'fountain' || t.leisure === 'swimming_pool' || t.intermittent === 'yes' || t.seasonal === 'yes') return false;
  return t.natural === 'water' || t.waterway === 'riverbank' || ['reservoir', 'basin'].includes(t.landuse) || !!t.water;
};
function buildLakes(data, upm) {
  const feats = (data.osmFeatures || []).filter(isPreviewLake);
  if (!feats.length || !data.bounds || !data.heightMap) return null;
  const { north, south, east, west } = data.bounds;
  const W = data.width; const H = data.height;
  const toXY = (p) => [((p.lng - west) / (east - west)) * SCENE_SIZE - SCENE_SIZE / 2, -(((north - p.lat) / (north - south)) * SCENE_SIZE - SCENE_SIZE / 2)];
  const groundAt = (u, v) => {
    if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return NaN;
    const x = Math.round(u * (W - 1)); const y = Math.round(v * (H - 1));
    const h = data.heightMap[y * W + x];
    return h < -10000 ? NaN : h;
  };
  const geos = [];
  for (const f of feats) {
    const ring = f.geometry.map(toXY);
    // (the level: the median ground at points inside the outline)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const inside = (x, y) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i]; const [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
    const samples = [];
    const step = Math.max((maxX - minX), (maxY - minY)) / 24;
    for (let x = minX + step / 2; x < maxX && step > 0; x += step) for (let y = minY + step / 2; y < maxY; y += step) {
      if (!inside(x, y)) continue;
      const g = groundAt((x + SCENE_SIZE / 2) / SCENE_SIZE, (SCENE_SIZE / 2 - y) / SCENE_SIZE);
      if (Number.isFinite(g)) samples.push(g);
    }
    if (samples.length < 3) continue;
    samples.sort((a, b) => a - b);
    const level = samples[samples.length >> 1];
    const shape = new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y)));
    for (const hole of f.holes || []) if (hole?.length > 3) shape.holes.push(new THREE.Path(hole.map(toXY).map(([x, y]) => new THREE.Vector2(x, y))));
    const g = new THREE.ShapeGeometry(shape);
    g.translate(0, 0, (level - Number(data.minHeight || 0)) * upm + 0.03);
    geos.push(g);
  }
  if (!geos.length) return null;
  const merged = mergeGeometries(geos);
  geos.forEach((g) => g.dispose());
  if (!merged) return null;
  // (uvs in scene units, for the ripple normal map's tiling)
  const p = merged.attributes.position; const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) / 6; uv[i * 2 + 1] = p.getY(i) / 6; }
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  merged.computeVertexNormals();
  return merged;
}

// ── Full-resolution normal map ───────────────────────────────────────────────
// Lighting detail decoupled from vertex density: a normal map computed from the
// SOURCE heightmap gives per-pixel shading of the real data even where the mesh
// is stride-decimated. A 4096² normal map is a ~67 MB one-shot texture; the
// equivalent geometric detail would be 16.7M vertices (~1 GB of buffers — the
// memory wall previous attempts hit, see dbd2fa2/5541222).
const NORMAL_MAP_SIZE_BY_QUALITY = {
  low: 1024,
  medium: 2048,
  high: 2048,
  full: 4096,
};

const terrainNormalTexture = shallowRef(null);
const terrainNormalScale = markRaw(new THREE.Vector2(1, 1));

const buildTerrainNormalTexture = (data, targetSize, meshStride) => {
  const w = Number(data.width || 0);
  const h = Number(data.height || 0);
  if (w < 3 || h < 3 || !data.heightMap || !data.bounds) return null;
  // At stride 1 the mesh already carries every sample — no residual detail.
  if (!(meshStride > 1)) return null;

  const latRad = ((data.bounds.north + data.bounds.south) / 2) * Math.PI / 180;
  const realWidthMeters = (data.bounds.east - data.bounds.west) * 111320 * Math.cos(latRad);
  if (!Number.isFinite(realWidthMeters) || realWidthMeters <= 0) return null;
  const metersPerPixel = realWidthMeters / Math.max(1, w - 1);

  const outW = Math.min(targetSize, w);
  const outH = Math.min(targetSize, h);
  const minHeight = Number(data.minHeight) || 0;
  const hm = data.heightMap;
  const sample = (x, y) => {
    const v = hm[y * w + x];
    return v < -10000 ? minHeight : v;
  };

  // Slope helper: central difference over ±span pixels, in meters.
  const slopeX = (sx, sy, span) => {
    const xL = Math.max(0, sx - span);
    const xR = Math.min(w - 1, sx + span);
    return (sample(xR, sy) - sample(xL, sy)) / Math.max(1e-6, (xR - xL) * metersPerPixel);
  };
  const slopeY = (sx, sy, span) => {
    const yU = Math.max(0, sy - span);
    const yD = Math.min(h - 1, sy + span);
    return (sample(sx, yD) - sample(sx, yU)) / Math.max(1e-6, (yD - yU) * metersPerPixel);
  };

  const pixels = new Uint8Array(outW * outH * 4);
  for (let oy = 0; oy < outH; oy++) {
    const sy = Math.min(h - 1, Math.round((oy * (h - 1)) / Math.max(1, outH - 1)));
    for (let ox = 0; ox < outW; ox++) {
      const sx = Math.min(w - 1, Math.round((ox * (w - 1)) / Math.max(1, outW - 1)));

      // Encode only the RESIDUAL slope the decimated mesh cannot represent:
      // full-resolution slope minus the slope at the mesh's vertex stride.
      // The mesh's interpolated vertex normals already light the low-frequency
      // component; adding the full slope again would double-count hillside
      // tilt and exaggerate shading on large slopes.
      const dhdx = slopeX(sx, sy, 1) - slopeX(sx, sy, meshStride);
      const dhdy = slopeY(sx, sy, 1) - slopeY(sx, sy, meshStride);

      // Tangent space follows the mesh UVs (+u = east, +v = south); same sign
      // convention as the water normal generator on this plane orientation.
      const nx = -dhdx;
      const ny = -dhdy;
      const invLen = 1 / Math.hypot(nx, ny, 1);

      const i = (oy * outW + ox) * 4;
      pixels[i] = Math.round((nx * invLen * 0.5 + 0.5) * 255);
      pixels[i + 1] = Math.round((ny * invLen * 0.5 + 0.5) * 255);
      pixels[i + 2] = Math.round((invLen * 0.5 + 0.5) * 255);
      pixels[i + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(pixels, outW, outH, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return markRaw(tex);
};

// Generate terrain geometry
watch([() => props.terrainData?.heightMap, () => props.quality], () => {
  const data = toRaw(props.terrainData);
  if (!data) return;

  // 'full' renders the native heightmap grid up to a hard 2048 cap: a 2049²
  // mesh is ~4.2M vertices (~230 MB transient CPU buffers, freed after GPU
  // upload below). Beyond that cap the full-res normal map carries the detail
  // — naive full geometry at 8192² would be 67M vertices / ~1 GB of buffers.
  const maxDim = Math.max(Number(data.width || 0), Number(data.height || 0));
  let MAX_MESH_RESOLUTION = 2048;
  if (maxDim >= 8192) {
    MAX_MESH_RESOLUTION = props.quality === 'full' ? 1024 : props.quality === 'high' ? 768 : props.quality === 'medium' ? 640 : 512;
  } else if (maxDim >= 4096) {
    MAX_MESH_RESOLUTION = props.quality === 'full' ? 2048 : props.quality === 'high' ? 1280 : props.quality === 'medium' ? 1024 : 768;
  }

  const baseStride = Math.ceil(Math.max(data.width, data.height) / MAX_MESH_RESOLUTION);
  const qualityMultiplier = (props.quality === 'high' || props.quality === 'full') ? 1 : props.quality === 'medium' ? 2 : 4;
  const stride = Math.max(1, baseStride * qualityMultiplier);

  const widthSteps = Math.ceil((data.width - 1) / stride);
  const heightSteps = Math.ceil((data.height - 1) / stride);

  const geo = new THREE.PlaneGeometry(SCENE_SIZE, SCENE_SIZE, widthSteps, heightSteps);
  const vertices = geo.attributes.position.array;
  const uvs = geo.attributes.uv.array;

  // Calculate scale factor (units per meter)
  const upm = unitsPerMeter.value;
  const EXAGGERATION = 1.0;

  // Box-filter each vertex over its stride footprint instead of point-sampling
  // one heightmap pixel. Point sampling aliases features narrower than the
  // stride — most visibly roads: a ~6 m smoothed terrace sampled every
  // stride·mpp metres lands at a random phase across the road each row, so the
  // embankment silhouette bulges and wobbles in the preview even though the
  // exported heightmap (and the game) is smooth. Tap count is capped so large
  // strides stay cheap; taps spread evenly across the footprint.
  const sampleFootprintHeight = (mapCol, mapRow) => {
    if (stride <= 1) {
      const v = data.heightMap[mapRow * data.width + mapCol];
      return v < -10000 ? data.minHeight : v;
    }
    const half = stride / 2;
    const taps = Math.min(stride + 1, 8);
    let sum = 0;
    let count = 0;
    for (let ty = 0; ty < taps; ty++) {
      const sy = Math.round(mapRow - half + (ty * stride) / (taps - 1));
      if (sy < 0 || sy >= data.height) continue;
      for (let tx = 0; tx < taps; tx++) {
        const sx = Math.round(mapCol - half + (tx * stride) / (taps - 1));
        if (sx < 0 || sx >= data.width) continue;
        const v = data.heightMap[sy * data.width + sx];
        if (v < -10000) continue; // NO_DATA
        sum += v;
        count++;
      }
    }
    if (count > 0) return sum / count;
    const v = data.heightMap[mapRow * data.width + mapCol];
    return v < -10000 ? data.minHeight : v;
  };

  for (let i = 0; i < vertices.length / 3; i++) {
    const colIndex = i % (widthSteps + 1);
    const rowIndex = Math.floor(i / (widthSteps + 1));

    const mapCol = Math.min(colIndex * stride, data.width - 1);
    const mapRow = Math.min(rowIndex * stride, data.height - 1);

    const u = mapCol / (data.width - 1);
    const v = mapRow / (data.height - 1);

    const globalX = (u * SCENE_SIZE) - (SCENE_SIZE / 2);
    const globalZ = (v * SCENE_SIZE) - (SCENE_SIZE / 2);

    const h = sampleFootprintHeight(mapCol, mapRow);

    vertices[i * 3] = globalX;
    vertices[i * 3 + 1] = -(globalZ);
    vertices[i * 3 + 2] = (h - data.minHeight) * upm * EXAGGERATION;

    uvs[i * 2] = u;
    uvs[i * 2 + 1] = v;
  }

  geo.computeVertexNormals();

  // Dispose old geometry if it exists
  if (geometry.value) {
    geometry.value.dispose();
  }

  geometry.value = markRaw(geo);
  if (skirtGeometry.value) skirtGeometry.value.dispose();
  skirtGeometry.value = markRaw(buildSkirt(vertices, widthSteps, heightSteps, upm, data));
  if (lakeGeometry.value) lakeGeometry.value.dispose();
  lakeGeometry.value = (() => { try { const g = buildLakes(data, upm); return g ? markRaw(g) : null; } catch (e) { console.warn('[TerrainMesh] lakes not built:', e?.message || e); return null; } })();

  // Full-resolution lighting detail for the decimated mesh (see above).
  // Built from the residual against this exact stride, so it must rebuild
  // together with the geometry.
  if (terrainNormalTexture.value) terrainNormalTexture.value.dispose();
  const normalMapSize = NORMAL_MAP_SIZE_BY_QUALITY[props.quality] ?? NORMAL_MAP_SIZE_BY_QUALITY.medium;
  terrainNormalTexture.value = buildTerrainNormalTexture(data, normalMapSize, stride);

  // After 2 frames the WebGL renderer has uploaded the buffer to GPU.
  // Null the CPU-side TypedArrays to free the ArrayBuffer (~50-130 MB at
  // max mesh resolution, plus up to ~100 MB of Uint32 index at 'full').
  // The GPU retains the data; dispose() on unmount still correctly deletes
  // the WebGL buffers.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const g = toRaw(geometry.value);
    if (g === geo) { // only if this geometry is still active
      if (g.attributes.position) g.attributes.position.array = null;
      if (g.attributes.normal)   g.attributes.normal.array   = null;
      if (g.attributes.uv)       g.attributes.uv.array       = null;
      if (g.index)               g.index.array               = null;
    }
  }));
}, { immediate: true });

const textureCache = reactive({
  satellite: null,
  osm: null,
  hybrid: null,
  game: null
});

// Track canvas refs for direct CanvasTexture usage
const canvasCache = reactive({
  osm: null,
  hybrid: null
});

// Helper to load and configure a texture from URL
const loadTexture = (url) => {
  if (!url) return null;
  const tex = new THREE.TextureLoader().load(
    url,
    (t) => console.log(`[TerrainMesh] texture loaded — ${t.image?.width}x${t.image?.height}`),
    undefined,
    (err) => console.error('[TerrainMesh] texture load error:', err),
  );
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 16;
  tex.flipY = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return markRaw(tex);
};

// Helper to create texture directly from canvas (skips PNG encode/decode).
// onUploaded: optional callback fired after the GPU upload completes (2 frames).
//   Use it to free external canvas references from terrainData.
const loadCanvasTexture = (canvas, onUploaded) => {
  if (!canvas) return null;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 16;
  tex.flipY = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  if (onUploaded) {
    // Two rAF frames is enough for the WebGL renderer to call texImage2D.
    // Do NOT null tex.image here — Three.js needs it for correct state management.
    // Instead we only free the external terrainData canvas reference via onUploaded.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      onUploaded();
    }));
  }
  return markRaw(tex);
};

// Watch individual URLs and update the cache
watch(() => props.terrainData?.satelliteTextureUrl, (url) => {
  if (textureCache.satellite) textureCache.satellite.dispose();
  console.log(`[TerrainMesh] satellite texture watch — url=${url ? 'ok' : 'empty/null'}`);
  textureCache.satellite = loadTexture(url);
}, { immediate: true });

watch(() => props.terrainData?.osmTextureUrl, (url) => {
  if (textureCache.osm) textureCache.osm.dispose();
  const canvas = props.terrainData?.osmTextureCanvas;
  console.log(`[TerrainMesh] osm texture watch — url=${url ? "ok" : "empty/null"}, canvas=${canvas ? `${canvas.width}x${canvas.height}` : "null"}`);
  if (canvas) {
    canvasCache.osm = canvas;
    textureCache.osm = loadCanvasTexture(canvas, () => {
      canvasCache.osm = null;
      if (props.terrainData) {
        // Save width so exportBeamNGLevel can determine satelliteTexSize after canvas is freed
        if (!props.terrainData.hybridTexWidth) props.terrainData.hybridTexWidth = canvas.width;
        props.terrainData.osmTextureCanvas = null;
      }
    });
  } else {
    canvasCache.osm = null;
    textureCache.osm = loadTexture(url);
    if (!url) console.warn("[TerrainMesh] osm texture: no canvas and no url — texture will be null");
  }
}, { immediate: true });

watch(() => props.terrainData?.hybridTextureUrl, (url) => {
  if (textureCache.hybrid) textureCache.hybrid.dispose();
  const canvas = props.terrainData?.hybridTextureCanvas;
  console.log(`[TerrainMesh] hybrid texture watch — url=${url ? "ok" : "empty/null"}, canvas=${canvas ? `${canvas.width}x${canvas.height}` : "null"}`);
  if (canvas) {
    canvasCache.hybrid = canvas;
    textureCache.hybrid = loadCanvasTexture(canvas, () => {
      canvasCache.hybrid = null;
      if (props.terrainData) {
        // Save dimensions before clearing so exportBeamNGLevel can still determine
        // the correct baseTexSize for PBR material generation.
        props.terrainData.hybridTexWidth = canvas.width;
        props.terrainData.hybridTextureCanvas = null;
      }
    });
  } else {
    canvasCache.hybrid = null;
    textureCache.hybrid = loadTexture(url);
    if (!url) console.warn("[TerrainMesh] hybrid texture: no canvas and no url — texture will be null");
  }
}, { immediate: true });

// Game Texture: from its URL, or its canvas without freeing it (the BeamNG
// export reads terrainData.gameTextureCanvas)
watch(() => [props.terrainData?.gameTextureUrl, props.terrainData?.gameTextureCanvas], ([url, canvas]) => {
  if (textureCache.game) textureCache.game.dispose();
  textureCache.game = url ? loadTexture(url) : (canvas ? loadCanvasTexture(canvas, () => {}) : null);
}, { immediate: true });

// The currently active texture is just a lookup in our cache
const texture = computed(() => {
  return textureCache[props.textureType] || null;
});

onUnmounted(() => {
  if (geometry.value) geometry.value.dispose();
  skirtGeometry.value?.dispose();
  lakeGeometry.value?.dispose();
  Object.values(textureCache).forEach(tex => {
    if (tex) tex.dispose();
  });
  if (waterNormalTexture.value) {
    waterNormalTexture.value.dispose();
    waterNormalTexture.value = null;
  }
  if (terrainNormalTexture.value) {
    terrainNormalTexture.value.dispose();
    terrainNormalTexture.value = null;
  }
  disposeWaterReflection();
});
</script>

<template>
  <TresGroup v-if="geometry">
    <TresMesh
      v-if="waterVisible"
      ref="waterMeshRef"
      :rotation="[-Math.PI / 2, 0, 0]"
      :position="[0, seaLevelSceneZ, 0]"
      :render-order="1"
    >
      <TresPlaneGeometry :args="[waterPlaneSize, waterPlaneSize, 1, 1]" />
      <TresMeshPhysicalMaterial
        :color="0x56a8cc"
        :transparent="true"
        :opacity="0.48"
        :roughness="0.22"
        :metalness="0.02"
        :reflectivity="0.72"
        :ior="1.333"
        :transmission="0"
        :clearcoat="0.55"
        :clearcoat-roughness="0.2"
        :env-map-intensity="0.62"
        :normal-map="waterNormalTexture"
        :normal-scale="waterNormalScale"
        :env-map="waterEnvMap"
        :side="2"
        :depth-write="false"
      />
    </TresMesh>

    <TresMesh v-if="skirt && skirtGeometry" :rotation="[-Math.PI / 2, 0, 0]" :geometry="skirtGeometry" receive-shadow>
      <TresMeshStandardMaterial :vertex-colors="true" :roughness="0.95" :metalness="0" :side="2" />
    </TresMesh>

    <TresMesh v-if="lakes && lakeGeometry" :rotation="[-Math.PI / 2, 0, 0]" :geometry="lakeGeometry" :render-order="3" receive-shadow>
      <TresMeshPhysicalMaterial
        :color="0x1b5a73"
        :roughness="0.08"
        :metalness="0"
        :clearcoat="0.6"
        :clearcoat-roughness="0.1"
        :env-map-intensity="1.4"
        :normal-map="waterNormalTexture"
        :normal-scale="lakeNormalScale"
        :transparent="true"
        :opacity="0.42"
        :depth-write="false"
        :polygon-offset="true"
        :polygon-offset-factor="-2"
      />
    </TresMesh>

    <TresMesh
      :rotation="[-Math.PI / 2, 0, 0]"
      :position="[0, 0, 0]"
      :render-order="2"
      receive-shadow
      :geometry="geometry"
    >
      <!-- key includes normal-map presence: toggling USE_NORMALMAP needs a
           shader recompile, which Three only does on a fresh material. -->
      <TresMeshStandardMaterial
        :key="`${texture ? 'tex' : 'clay'}-${terrainNormalTexture ? 'nm' : 'flat'}`"
        :map="texture"
        :normal-map="terrainNormalTexture"
        :normal-scale="terrainNormalScale"
        :color="texture ? 0xffffff : 0xb0a898"
        :roughness="texture ? 1 : 0.5"
        :metalness="texture ? 0 : 0.5"
        :side="2"
        :wireframe="wireframe"
      />
    </TresMesh>
  </TresGroup>
</template>
