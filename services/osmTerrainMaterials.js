/**
 * OSM-driven terrain material painting for BeamNG levels.
 *
 * Reads OSM feature data and rasterizes it onto a BeamNG terrain layer map
 * (a Uint8Array where each byte is a material index, terrain-space origin at
 * the SW corner, Y increases northward, row-major: index = y*size + x).
 *
 * Also generates procedural PBR textures (diffuse, normal, roughness) for
 * each material type so they look good up close, unlike the blurry satellite
 * base texture.
 */

// ── Material definitions ───────────────────────────────────────────────────
// index 0 = DefaultMaterial (satellite base) — handled separately.
// These are indices 1–7 in the layer map and in the .ter material name list.
const MATERIALS = [
  {
    index: 1, name: 'Grass',
    groundmodelName: 'GRASS',
    rgb: [88, 128, 62], noise: 30, bumpiness: 0.6, roughness: 185, detailTexSize: 2,
  },
  {
    index: 2, name: 'Dirt',
    groundmodelName: 'DIRT',
    rgb: [140, 107, 74], noise: 36, bumpiness: 0.7, roughness: 212, detailTexSize: 2,
  },
  {
    index: 3, name: 'Sand',
    groundmodelName: 'SAND',
    rgb: [210, 188, 140], noise: 20, bumpiness: 0.35, roughness: 196, detailTexSize: 2,
  },
  {
    index: 4, name: 'Rock',
    groundmodelName: 'ROCK',
    rgb: [136, 131, 126], noise: 42, bumpiness: 0.85, roughness: 162, detailTexSize: 1,
  },
  {
    index: 5, name: 'Asphalt',
    groundmodelName: 'GROUNDMODEL_ASPHALT1',
    rgb: [65, 65, 65], noise: 10, bumpiness: 0.12, roughness: 172, detailTexSize: 4,
  },
  {
    index: 6, name: 'GravelRoad',
    groundmodelName: 'GRAVEL',
    rgb: [157, 142, 110], noise: 38, bumpiness: 0.62, roughness: 222, detailTexSize: 2,
  },
  {
    index: 7, name: 'Concrete',
    groundmodelName: 'CONCRETE',
    rgb: [187, 182, 172], noise: 18, bumpiness: 0.22, roughness: 148, detailTexSize: 3,
  },
];

// Ordered material name list — index position matches layer map byte value.
// Index 0 = DefaultMaterial (satellite base), 1–7 = PBR materials above.
export const MATERIAL_NAMES = ['DefaultMaterial', ...MATERIALS.map(m => m.name)];

// ── OSM → road material + width ────────────────────────────────────────────
const ROAD_STYLE = {
  motorway:       { mat: 5, halfWidthM: 9.0 },
  motorway_link:  { mat: 5, halfWidthM: 5.0 },
  trunk:          { mat: 5, halfWidthM: 8.0 },
  trunk_link:     { mat: 5, halfWidthM: 5.0 },
  primary:        { mat: 5, halfWidthM: 7.0 },
  primary_link:   { mat: 5, halfWidthM: 4.0 },
  secondary:      { mat: 5, halfWidthM: 6.0 },
  secondary_link: { mat: 5, halfWidthM: 3.5 },
  tertiary:       { mat: 5, halfWidthM: 5.0 },
  tertiary_link:  { mat: 5, halfWidthM: 3.0 },
  residential:    { mat: 5, halfWidthM: 4.0 },
  living_street:  { mat: 5, halfWidthM: 3.0 },
  unclassified:   { mat: 5, halfWidthM: 4.0 },
  road:           { mat: 5, halfWidthM: 4.0 },
  service:        { mat: 5, halfWidthM: 2.5 },
  raceway:        { mat: 5, halfWidthM: 6.0 },
  busway:         { mat: 5, halfWidthM: 4.0 },
  pedestrian:     { mat: 7, halfWidthM: 4.0 },
  track:          { mat: 6, halfWidthM: 2.5 },
  footway:        { mat: 7, halfWidthM: 1.2 },
  cycleway:       { mat: 7, halfWidthM: 1.2 },
  path:           { mat: 6, halfWidthM: 1.0 },
};

// Linear waterway types → half-width in metres for terrain-layer rasterisation.
// Painted as index 0 (DefaultMaterial / satellite) so BeamNG WaterBlock objects
// sit on top of the correct base texture.
const WATERWAY_STYLE = {
  river:  { halfWidthM: 12.0 },
  canal:  { halfWidthM:  6.0 },
  stream: { halfWidthM:  2.5 },
  drain:  { halfWidthM:  2.0 },
  ditch:  { halfWidthM:  1.5 },
};

// ── Coordinate conversion ──────────────────────────────────────────────────

/**
 * Convert WGS84 lat/lng to terrain pixel coordinates.
 * Terrain space: (0,0) = SW corner, px increases eastward, py increases northward.
 * Layer map index = py * size + px  (row-major, bottom-left origin).
 */
function geoToTerrainPx(lat, lng, bounds, size) {
  const px = (lng - bounds.west)  / (bounds.east  - bounds.west)  * (size - 1);
  const py = (lat - bounds.south) / (bounds.north - bounds.south) * (size - 1);
  return {
    px: Math.max(0, Math.min(size - 1, Math.round(px))),
    py: Math.max(0, Math.min(size - 1, Math.round(py))),
  };
}

// ── Rasterization ──────────────────────────────────────────────────────────

/**
 * Rasterize a thick line segment into the layer map using distance-to-segment.
 * Pixels within halfPx of the segment get materialIndex.
 */
function rasterizeSegment(layerMap, size, x0, y0, x1, y1, halfPx, matIdx) {
  const dx = x1 - x0, dy = y1 - y0;
  const segLen2 = dx * dx + dy * dy;
  const r2 = halfPx * halfPx;
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - halfPx));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(x0, x1) + halfPx));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - halfPx));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(y0, y1) + halfPx));
  for (let y = minY; y <= maxY; y++) {
    const row = y * size;
    for (let x = minX; x <= maxX; x++) {
      let dist2;
      if (segLen2 < 1e-9) {
        const ex = x - x0, ey = y - y0;
        dist2 = ex * ex + ey * ey;
      } else {
        const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / segLen2));
        const ex = x - (x0 + t * dx), ey = y - (y0 + t * dy);
        dist2 = ex * ex + ey * ey;
      }
      if (dist2 <= r2) layerMap[row + x] = matIdx;
    }
  }
}

/**
 * Scanline-fill a polygon ring (array of {px,py} in terrain space) with materialIndex.
 */
function rasterizePolygon(layerMap, size, ring, matIdx) {
  if (ring.length < 3) return;
  const n = ring.length;
  let minY = size, maxY = 0;
  for (const p of ring) {
    if (p.py < minY) minY = p.py;
    if (p.py > maxY) maxY = p.py;
  }
  minY = Math.max(0, Math.floor(minY));
  maxY = Math.min(size - 1, Math.ceil(maxY));

  for (let y = minY; y <= maxY; y++) {
    const sy = y + 0.5;
    const xs = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const y0 = ring[i].py, y1 = ring[j].py;
      if ((y0 <= sy && y1 > sy) || (y1 <= sy && y0 > sy)) {
        xs.push(ring[i].px + (sy - y0) / (y1 - y0) * (ring[j].px - ring[i].px));
      }
    }
    xs.sort((a, b) => a - b);
    const row = y * size;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k]));
      const x1 = Math.min(size - 1, Math.floor(xs[k + 1]));
      for (let x = x0; x <= x1; x++) layerMap[row + x] = matIdx;
    }
  }
}

/**
 * Return material index for an OSM area/polygon feature, or -1 if unrecognized.
 */
function areaMatIndex(feature) {
  const t = feature.tags || {};
  const nat = t.natural, lu = t.landuse, lei = t.leisure, am = t.amenity, sur = t.surface;

  if (nat === 'grass' || nat === 'meadow' || nat === 'heath') return 1;
  if (nat === 'grassland' || nat === 'shrub') return 1;
  if (nat === 'wood' || nat === 'scrub' || nat === 'shrubbery') return 1;
  if (nat === 'sand' || nat === 'beach' || nat === 'dune') return 3;
  if (nat === 'bare_rock' || nat === 'rock' || nat === 'scree' || nat === 'cliff') return 4;
  if (nat === 'shingle') return 4;
  if (nat === 'mud') return 2;
  if (nat === 'water' || nat === 'wetland') return -1;

  if (lu === 'grass' || lu === 'meadow' || lu === 'village_green') return 1;
  if (lu === 'recreation_ground' || lu === 'allotments' || lu === 'cemetery') return 1;
  if (lu === 'orchard' || lu === 'vineyard') return 1;
  if (lu === 'forest' || lu === 'wood') return 1;
  if (lu === 'religious' || lu === 'greenfield') return 1;
  if (lu === 'farmland' || lu === 'farmyard' || lu === 'greenhouse_horticulture') return 2;
  if (lu === 'brownfield' || lu === 'construction' || lu === 'landfill') return 2;
  if (lu === 'military') return 2;
  if (lu === 'industrial') return 7;
  if (lu === 'commercial' || lu === 'retail') return 7;
  if (lu === 'garages') return 5;
  if (lu === 'residential') return 1;
  if (lu === 'quarry') return 4;
  if (lu === 'railway') return 6;
  if (lu === 'reservoir' || lu === 'basin') return -1; // handled by water pass

  if (lei === 'park' || lei === 'garden' || lei === 'playground') return 1;
  if (lei === 'recreation_ground' || lei === 'pitch' || lei === 'golf_course') return 1;
  if (lei === 'nature_reserve' || lei === 'common' || lei === 'dog_park') return 1;
  if (lei === 'sports_centre' || lei === 'stadium') return 7;
  if (lei === 'beach_resort') return 3;
  if (lei === 'track') return 5;

  if (am === 'parking' || am === 'fuel') return 5;

  if (sur === 'asphalt' || sur === 'paved') return 5;
  if (sur === 'concrete') return 7;
  if (sur === 'gravel' || sur === 'dirt' || sur === 'unpaved' || sur === 'compacted') return 6;
  if (sur === 'grass') return 1;
  if (sur === 'sand') return 3;

  return -1;
}

// ── Procedural texture generation ──────────────────────────────────────────

/** Generate a noisy solid-color PNG for the diffuse/baseColor channel. */
async function makeDiffuseBlob(r, g, b, noise = 25, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0; i < size * size; i++) {
    const n = (Math.random() - 0.5) * noise * 2;
    d[i * 4]     = Math.max(0, Math.min(255, r + n));
    d[i * 4 + 1] = Math.max(0, Math.min(255, g + n));
    d[i * 4 + 2] = Math.max(0, Math.min(255, b + n));
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return new Promise(res => canvas.toBlob(res, 'image/png'));
}

/**
 * Generate a tileable normal map PNG derived from blurred random noise.
 * bumpiness: 0 = flat (RGB 128,128,255), 1 = very bumpy.
 */
async function makeNormalBlob(bumpiness = 0.5, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;

  // Raw random heights, then box-blur for coherency.
  const raw = new Float32Array(size * size);
  for (let i = 0; i < raw.length; i++) raw[i] = Math.random();
  const blurred = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size, xp = (x + 1) % size;
      const ym = ((y - 1 + size) % size) * size, yp = ((y + 1) % size) * size;
      const row = y * size;
      blurred[row + x] = (
        raw[ym + xm] + raw[ym + x] + raw[ym + xp] +
        raw[row + xm] + raw[row + x] + raw[row + xp] +
        raw[yp + xm] + raw[yp + x] + raw[yp + xp]
      ) / 9;
    }
  }

  const scale = bumpiness * 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size, xp = (x + 1) % size;
      const ym = ((y - 1 + size) % size) * size, yp = ((y + 1) % size) * size;
      const row = y * size;
      const gx = (blurred[row + xp] - blurred[row + xm]) * scale;
      const gy = (blurred[yp + x] - blurred[ym + x]) * scale;
      const gz = 1;
      const len = Math.sqrt(gx * gx + gy * gy + gz * gz);
      const i = row + x;
      d[i * 4]     = Math.round((gx / len * 0.5 + 0.5) * 255);
      d[i * 4 + 1] = Math.round((gy / len * 0.5 + 0.5) * 255);
      d[i * 4 + 2] = Math.round((gz / len * 0.5 + 0.5) * 255);
      d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return new Promise(res => canvas.toBlob(res, 'image/png'));
}

/** Generate a grayscale roughness PNG. roughness in [0,255], higher = rougher. */
async function makeRoughnessBlob(roughness = 180, variance = 12, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0; i < size * size; i++) {
    const v = Math.max(0, Math.min(255, roughness + (Math.random() - 0.5) * variance * 2));
    d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return new Promise(res => canvas.toBlob(res, 'image/png'));
}

/** Generate a solid white AO PNG (no occlusion = neutral placeholder). */
async function makeAoBlob(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  return new Promise(res => canvas.toBlob(res, 'image/png'));
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Build BeamNG terrain materials from OSM feature data.
 *
 * @param {object} terrainData  — { width, bounds, osmFeatures }
 * @param {number} worldSize    — terrain width in metres
 * @param {string} levelName    — BeamNG level folder name (for texture paths)
 * @returns {Promise<{
 *   layerMap: Uint8Array,       — size×size material indices (terrain space, SW origin)
 *   materialNames: string[],   — ordered list matching layer map indices
 *   materialDefs: object,      — for art/terrains/main.materials.json
 *   textureFiles: Array<{path:string, blob:Blob}>,  — PBR textures to add to ZIP
 * }>}
 */
export async function buildTerrainMaterials(terrainData, worldSize, levelName, satelliteTexSize) {
  const { width: size, bounds, osmFeatures = [] } = terrainData;
  // baseSize is the satellite pixel resolution — must match baseTexSize in the TextureSet.
  // It may differ from the heightmap grid size (terrainData.width) when the user selects
  // a different output resolution for the texture vs. the terrain grid.
  const baseSize = satelliteTexSize ?? size;
  const metersPerPixel = worldSize / size;
  const layerMap = new Uint8Array(size * size); // all 0 = DefaultMaterial

  // 1. Paint area polygons (painted first; roads override on top)
  for (const feature of osmFeatures) {
    if (feature.type === 'road') continue;
    const matIdx = areaMatIndex(feature);
    if (matIdx < 0 || !feature.geometry?.length) continue;
    const ring = feature.geometry.map(pt => geoToTerrainPx(pt.lat, pt.lng, bounds, size));
    rasterizePolygon(layerMap, size, ring, matIdx);
  }

  // 1b. Paint water AREA bodies on top of area fills.
  // Water is painted in a separate pass so it overrides land-use fills (e.g. a pond
  // inside a residential area painted as Grass). Index 0 = DefaultMaterial which shows
  // the satellite base — BeamNG WaterBlock objects sit on top of this.
  // NOTE: linear waterways (river, stream, etc.) are handled in pass 1c below.
  for (const feature of osmFeatures) {
    if (feature.type === 'road' || !feature.geometry?.length) continue;
    const t = feature.tags || {};
    const isWaterArea =
      t.natural === 'water' || t.natural === 'wetland' ||
      t.water ||                              // water=pond, water=lake, etc.
      t.landuse === 'reservoir' || t.landuse === 'basin' ||
      t.leisure === 'swimming_pool' ||
      // Area-type waterway tags (closed rings like riverbank, dock)
      ['riverbank', 'dock', 'boatyard', 'dam'].includes(t.waterway);
    if (!isWaterArea) continue;
    const ring = feature.geometry.map(pt => geoToTerrainPx(pt.lat, pt.lng, bounds, size));
    rasterizePolygon(layerMap, size, ring, 0); // 0 = DefaultMaterial
  }

  // 1c. Paint linear waterways (river, stream, canal, drain, ditch) as strips.
  // These are stored as type='water' with a non-closed geometry in osmFeatures.
  for (const feature of osmFeatures) {
    if (!feature.geometry?.length || feature.type !== 'water') continue;
    const t = feature.tags || {};
    const wStyle = WATERWAY_STYLE[t.waterway];
    if (!wStyle) continue;
    const halfPx = Math.max(1, wStyle.halfWidthM / metersPerPixel);
    const pts = feature.geometry.map(pt => geoToTerrainPx(pt.lat, pt.lng, bounds, size));
    for (let i = 0; i < pts.length - 1; i++) {
      rasterizeSegment(layerMap, size, pts[i].px, pts[i].py, pts[i + 1].px, pts[i + 1].py, halfPx, 0);
    }
  }

  // 2. Paint roads (overrides area fills)
  for (const feature of osmFeatures) {
    if (feature.type !== 'road' || !feature.geometry?.length) continue;
    const highway = feature.tags?.highway;
    const style = ROAD_STYLE[highway];
    if (!style) continue;
    const halfPx = Math.max(1, style.halfWidthM / metersPerPixel);
    const pts = feature.geometry.map(pt => geoToTerrainPx(pt.lat, pt.lng, bounds, size));
    for (let i = 0; i < pts.length - 1; i++) {
      rasterizeSegment(layerMap, size, pts[i].px, pts[i].py, pts[i + 1].px, pts[i + 1].py, halfPx, style.mat);
    }
  }

  // 3. Generate PBR textures.
  // The engine checks all 15 texture slots (5 channels × 3 levels: base/macro/detail)
  // for every material. Every empty slot path resolves to "/" and logs
  // "Missing Terrain texture: /". Base-slot textures must be size×size pixels
  // (enforced by TextureSet baseTexSize). Detail/macro slots use DETAIL_SIZE pixels.
  const DETAIL_SIZE = 256;
  const textureFiles = [];
  const materialDefs = {};

  // The TerrainMaterialTextureSet object, stored in the same main.materials.json file,
  // switches BeamNG from legacy mode (diffuseMap/detailMap) to PBR mode
  // (baseColorBaseTex/baseColorDetailTex). Without it the editor shows "Upgrade Terrain
  // Materials" and the runtime uses legacy field names. The TerrainBlock's materialTextureSet
  // field must point to this object's name.
  const textureSetName = `${levelName}TerrainMaterialTextureSet`;
  materialDefs[textureSetName] = {
    name: textureSetName,
    class: 'TerrainMaterialTextureSet',
    persistentId: crypto.randomUUID(),
    baseTexSize: [baseSize, baseSize],
    detailTexSize: [DETAIL_SIZE, DETAIL_SIZE],
    macroTexSize: [DETAIL_SIZE, DETAIL_SIZE],
  };

  const satellitePath = `/levels/${levelName}/art/terrains/terrain.png`;
  const p = (f) => `/levels/${levelName}/art/terrains/${f}`;

  // ── Shared neutral base textures (size×size, must match baseTexSize) ─────
  // Generated sequentially to avoid holding multiple large canvases (up to 256 MB each)
  // in memory at the same time. Each canvas is freed by the browser after toBlob() resolves.
  const sharedAo  = await makeAoBlob(baseSize);
  const sharedNm  = await makeNormalBlob(0, baseSize);
  const sharedR   = await makeRoughnessBlob(180, 0, baseSize);
  // Detail/macro textures are tiny (DETAIL_SIZE=256) so parallel is fine.
  const [sharedAoSm, sharedNmSm, sharedRSm] = await Promise.all([
    makeAoBlob(DETAIL_SIZE),
    makeNormalBlob(0, DETAIL_SIZE),
    makeRoughnessBlob(180, 0, DETAIL_SIZE),
  ]);
  textureFiles.push(
    { path: 'shared_ao.png',    blob: sharedAo },
    { path: 'shared_nm.png',    blob: sharedNm },
    { path: 'shared_r.png',     blob: sharedR },
    { path: 'shared_ao_sm.png', blob: sharedAoSm },
    { path: 'shared_nm_sm.png', blob: sharedNmSm },
    { path: 'shared_r_sm.png',  blob: sharedRSm },
  );

  // World size in metres — used as the base texture mapping scale so each base
  // texture covers the terrain exactly once (no tiling at world scale).
  const ws = Math.round(worldSize);

  // Helper: build the 15 neutral slot fields, then override with material-specific ones.
  // xxxBaseTexSize = world-space metres covered by that texture (same as ws = no tiling).
  function neutralSlots() {
    return {
      // base color (detail/macro are neutral placeholders with strength 0)
      baseColorDetailTex:       p('shared_r_sm.png'),
      baseColorDetailStrength:  [0, 0],
      baseColorMacroTex:        p('shared_r_sm.png'),
      baseColorMacroStrength:   [0, 0],
      // normal
      normalBaseTex:            p('shared_nm.png'),
      normalBaseTexSize:        ws,
      normalDetailTex:          p('shared_nm_sm.png'),
      normalDetailStrength:     [0, 0],
      normalMacroTex:           p('shared_nm_sm.png'),
      normalMacroStrength:      [0, 0],
      // roughness
      roughnessBaseTex:         p('shared_r.png'),
      roughnessBaseTexSize:     ws,
      roughnessDetailTex:       p('shared_r_sm.png'),
      roughnessDetailStrength:  [0, 0],
      roughnessMacroTex:        p('shared_r_sm.png'),
      roughnessMacroStrength:   [0, 0],
      // ambient occlusion
      aoBaseTex:                p('shared_ao.png'),
      aoBaseTexSize:            ws,
      aoDetailTex:              p('shared_ao_sm.png'),
      aoMacroTex:               p('shared_ao_sm.png'),
      // height
      heightBaseTex:            p('shared_r.png'),
      heightBaseTexSize:        ws,
      heightDetailTex:          p('shared_r_sm.png'),
      heightMacroTex:           p('shared_r_sm.png'),
    };
  }

  // Use "InternalName-uuid" key format (matching BeamNG's own convention) so the
  // editor can generate material thumbnails correctly.
  const defaultUuid = crypto.randomUUID();
  const defaultKey  = `DefaultMaterial-${defaultUuid}`;
  materialDefs[defaultKey] = {
    name: defaultKey,
    class: 'TerrainMaterial',
    persistentId: defaultUuid,
    internalName: 'DefaultMaterial',
    groundmodelName: 'GROUNDMODEL_ASPHALT1',
    baseColorBaseTex:     satellitePath,
    baseColorBaseTexSize: ws,
    ...neutralSlots(),
  };

  // Generate material textures sequentially — each diffuse blob is baseSize×baseSize
  // (potentially 256 MB canvas). Parallel generation would OOM at high resolutions.
  for (const mat of MATERIALS) {
    const [r, g, b] = mat.rgb;
    const slug = mat.name.toLowerCase();
    const base = await makeDiffuseBlob(r, g, b, mat.noise, baseSize);
    const [normal, roughness] = await Promise.all([
      makeNormalBlob(mat.bumpiness, DETAIL_SIZE),
      makeRoughnessBlob(mat.roughness, 15, DETAIL_SIZE),
    ]);
    textureFiles.push(
      { path: `${slug}_b.png`, blob: base },
      { path: `${slug}_n.png`, blob: normal },
      { path: `${slug}_r.png`, blob: roughness },
    );
    const uuid = crypto.randomUUID();
    const key  = `${mat.name}-${uuid}`;
    materialDefs[key] = {
      name: key,
      class: 'TerrainMaterial',
      persistentId: uuid,
      internalName: mat.name,
      groundmodelName: mat.groundmodelName,
      baseColorBaseTex:     p(`${slug}_b.png`),
      baseColorBaseTexSize: ws,
      ...neutralSlots(),
      // Override neutral normal + roughness detail with material-specific ones.
      detailSize: mat.detailTexSize,
      normalDetailTex:          p(`${slug}_n.png`),
      normalDetailStrength:     [0.7, 0],
      roughnessDetailTex:       p(`${slug}_r.png`),
      roughnessDetailStrength:  [0.5, 0.1],
    };
  }

  return { layerMap, materialNames: MATERIAL_NAMES, materialDefs, textureFiles, textureSetName };
}
