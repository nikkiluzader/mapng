/**
 * OSM-driven terrain material painting for BeamNG levels.
 *
 * Reads OSM feature data and rasterizes it onto a BeamNG terrain layer map
 * (a Uint8Array where each byte is a material index, terrain-space origin at
 * the SW corner, Y increases northward, row-major: index = y*size + x).
 *
 * Material definitions reference textures from BeamNG's base game levels —
 * no textures are generated; only the material JSON is needed in the ZIP.
 */

// ── Material names ─────────────────────────────────────────────────────────
// Index 0 = DefaultMaterial (satellite base), 1–7 = BeamNG-referenced materials.
const MATERIAL_NAMES_LIST = ['DefaultMaterial', 'Grass', 'Dirt', 'BeachSand', 'ROCK', 'asphalt', 'GRAVEL', 'Concrete'];

// Ordered name list for the .ter material slot array and external consumers.
export const MATERIAL_NAMES = MATERIAL_NAMES_LIST;

// ── Game-referenced material definitions ───────────────────────────────────
// These are copied from real BeamNG terrain material definitions. During export
// we keep the detail/macro slots intact and only rewrite the base slots so they
// point at the generated terrain base in the exported level.
const REFERENCE_MATERIALS = [
  {
    internalName: 'Grass',
    template: {
      class: 'TerrainMaterial',
      annotation: 'GRASS',
      aoBaseTex: '/levels/east_coast_usa/art/terrains/t_terrain_base_ao.png',
      aoBaseTexSize: 2048,
      aoDetailTex: '/levels/east_coast_usa/art/terrains/t_grass1_ao.png',
      aoMacroTex: '/levels/east_coast_usa/art/terrains/t_macro_grass_ao.png',
      aoMacroTexSize: 100,
      baseColorBaseTex: '/levels/east_coast_usa/art/terrains/t_terrain_base_b.png',
      baseColorBaseTexSize: 2048,
      baseColorDetailStrength: [0.319999993, 0],
      baseColorDetailTex: '/levels/east_coast_usa/art/terrains/t_grass1_b.png',
      baseColorMacroStrength: [0.100000001, 0.400000006],
      baseColorMacroTex: '/levels/east_coast_usa/art/terrains/t_macro_grass_b.png',
      baseColorMacroTexSize: 100,
      detailDistAtten: [0, 0.899999976],
      detailDistances: [0, 0, 30, 60],
      groundmodelName: 'GRASS',
      heightBaseTex: '/levels/east_coast_usa/art/terrains/t_terrain_base_h.png',
      heightBaseTexSize: 2048,
      heightDetailTex: '/levels/east_coast_usa/art/terrains/t_grass1_h.png',
      heightMacroTex: '/levels/east_coast_usa/art/terrains/t_macro_grass_h.png',
      heightMacroTexSize: 100,
      macroDistAtten: [0.349999994, 0],
      macroDistances: [0, 0, 400, 8000],
      normalBaseTex: '/levels/east_coast_usa/art/terrains/t_terrain_base_nm.png',
      normalBaseTexSize: 2048,
      normalDetailStrength: [0.600000024, 0],
      normalDetailTex: '/levels/east_coast_usa/art/terrains/t_grass1_nm.png',
      normalMacroStrength: [0.400000006, 0.600000024],
      normalMacroTex: '/levels/east_coast_usa/art/terrains/t_macro_grass_nm.png',
      normalMacroTexSize: 100,
      roughnessBaseTex: '/levels/east_coast_usa/art/terrains/t_terrain_base_r.png',
      roughnessBaseTexSize: 2048,
      roughnessDetailStrength: [0.899999976, 0],
      roughnessDetailTex: '/levels/east_coast_usa/art/terrains/t_grass1_r.png',
      roughnessMacroStrength: [0.200000003, 0.5],
      roughnessMacroTex: '/levels/east_coast_usa/art/terrains/t_macro_grass_r.png',
      roughnessMacroTexSize: 100,
    },
  },
  {
    internalName: 'Dirt',
    template: {
      class: 'TerrainMaterial',
      aoBaseTex: '/levels/gridmap_v2/art/terrains/t_terrain_base_ao.png',
      aoBaseTexSize: 2048,
      aoDetailTex: '/levels/gridmap_v2/art/terrains/t_dirt_loose_ao.png',
      aoMacroTex: '/levels/gridmap_v2/art/terrains/t_macro_rocky_ao.png',
      baseColorBaseTex: '/levels/gridmap_v2/art/terrains/t_terrain_base_b.png',
      baseColorBaseTexSize: 2048,
      baseColorDetailStrength: [0.25, 0.25],
      baseColorDetailTex: '/levels/gridmap_v2/art/terrains/t_dirt_loose_b.png',
      baseColorMacroStrength: [0.100000001, 0.200000003],
      baseColorMacroTex: '/levels/gridmap_v2/art/terrains/t_macro_rocky_b.png',
      detailDistance: 25,
      detailSize: 2,
      detailStrength: 0.5,
      diffuseSize: 50,
      groundmodelName: 'DIRT',
      heightBaseTex: '/levels/gridmap_v2/art/terrains/t_terrain_base_h.png',
      heightBaseTexSize: 2048,
      heightDetailTex: '/levels/gridmap_v2/art/terrains/t_dirt_loose_h.png',
      heightMacroTex: '/levels/gridmap_v2/art/terrains/t_macro_rocky_h.png',
      macroDistance: 1000,
      macroDistances: [0, 10, 100, 3000],
      macroMap: '/levels/gridmap_v2/art/terrains/macro_grass_d.color.png',
      macroSize: 40,
      macroStrength: 0.5,
      normalBaseTex: '/levels/gridmap_v2/art/terrains/t_terrain_base_nm.png',
      normalBaseTexSize: 2048,
      normalDetailStrength: [0.699999988, 0.150000006],
      normalDetailTex: '/levels/gridmap_v2/art/terrains/t_dirt_loose_nm.png',
      normalMacroStrength: [0.300000012, 0.400000006],
      normalMacroTex: '/levels/gridmap_v2/art/terrains/t_macro_rocky_nm.png',
      normalMap: '/levels/gridmap_v2/art/terrains/grass_n.normal.png',
      roughnessBaseTex: '/levels/gridmap_v2/art/terrains/t_terrain_base_r.png',
      roughnessBaseTexSize: 2048,
      roughnessDetailStrength: [0.300000012, 0.300000012],
      roughnessDetailTex: '/levels/gridmap_v2/art/terrains/t_dirt_loose_r.png',
      roughnessMacroStrength: [0.200000003, 0.699999988],
      roughnessMacroTex: '/levels/gridmap_v2/art/terrains/t_macro_rocky_r.png',
    },
  },
  {
    internalName: 'BeachSand',
    template: {
      class: 'TerrainMaterial',
      annotation: 'SAND',
      aoBaseTex: '/levels/gridmap_v2/art/terrains/t_terrain_base_ao.png',
      aoBaseTexSize: 2048,
      aoDetailTex: '/levels/gridmap_v2/art/terrains/t_beachsand_ao.png',
      aoMacroTex: '/levels/gridmap_v2/art/terrains/t_macro_clumpy_ao.png',
      baseColorBaseTex: '/levels/gridmap_v2/art/terrains/t_terrain_base_b.png',
      baseColorBaseTexSize: 2048,
      baseColorDetailStrength: [0.25, 0.25],
      baseColorDetailTex: '/levels/gridmap_v2/art/terrains/t_beachsand_b.png',
      baseColorMacroStrength: [0.0500000007, 0.100000001],
      baseColorMacroTex: '/levels/gridmap_v2/art/terrains/t_macro_clumpy_b.png',
      detailDistance: 25,
      detailSize: 2,
      detailStrength: 0.5,
      diffuseSize: 50,
      groundmodelName: 'SAND',
      heightBaseTex: '/levels/gridmap_v2/art/terrains/t_terrain_base_h.png',
      heightBaseTexSize: 2048,
      heightDetailTex: '/levels/gridmap_v2/art/terrains/t_beachsand_h.png',
      heightMacroTex: '/levels/gridmap_v2/art/terrains/t_macro_clumpy_h.png',
      macroDistance: 1000,
      macroDistances: [0, 10, 100, 3000],
      macroSize: 40,
      macroStrength: 0.5,
      normalBaseTex: '/levels/gridmap_v2/art/terrains/t_terrain_base_nm.png',
      normalBaseTexSize: 2048,
      normalDetailStrength: [0.699999988, 0.150000006],
      normalDetailTex: '/levels/gridmap_v2/art/terrains/t_beachsand_nm.png',
      normalMacroStrength: [0.25, 0.25],
      normalMacroTex: '/levels/gridmap_v2/art/terrains/t_macro_clumpy_nm.png',
      roughnessBaseTex: '/levels/gridmap_v2/art/terrains/t_terrain_base_r.png',
      roughnessBaseTexSize: 2048,
      roughnessDetailStrength: [0.300000012, 0.300000012],
      roughnessDetailTex: '/levels/gridmap_v2/art/terrains/t_beachsand_r.png',
      roughnessMacroStrength: [0.150000006, 0.5],
      roughnessMacroTex: '/levels/gridmap_v2/art/terrains/t_macro_clumpy_r.png',
    },
  },
  {
    internalName: 'ROCK',
    template: {
      class: 'TerrainMaterial',
      annotation: 'ROCK',
      aoBaseTex: '/levels/east_coast_usa/art/terrains/t_terrain_base_ao.png',
      aoBaseTexSize: 2048,
      aoDetailTex: '/levels/east_coast_usa/art/terrains/t_rock_eca_ao.png',
      aoMacroTex: '/levels/east_coast_usa/art/terrains/t_rocks_pac_ao.png',
      aoMacroTexSize: 10,
      baseColorBaseTex: '/levels/east_coast_usa/art/terrains/t_terrain_base_b.png',
      baseColorBaseTexSize: 2048,
      baseColorDetailStrength: [0.25, 0.25],
      baseColorDetailTex: '/levels/east_coast_usa/art/terrains/t_rock_eca_b.png',
      baseColorMacroStrength: [0.200000003, 0.300000012],
      baseColorMacroTex: '/levels/east_coast_usa/art/terrains/t_rocks_pac_b.png',
      baseColorMacroTexSize: 10,
      detailDistances: [0, 0, 15, 50],
      groundmodelName: 'ROCK',
      heightBaseTex: '/levels/east_coast_usa/art/terrains/t_terrain_base_h.png',
      heightBaseTexSize: 2048,
      heightDetailTex: '/levels/east_coast_usa/art/terrains/t_rock_eca_h.png',
      heightMacroTex: '/levels/east_coast_usa/art/terrains/t_rocks_pac_h.png',
      heightMacroTexSize: 10,
      macroDistances: [0, 10, 100, 3000],
      normalBaseTex: '/levels/east_coast_usa/art/terrains/t_terrain_base_nm.png',
      normalBaseTexSize: 2048,
      normalDetailStrength: [0.400000006, 0.150000006],
      normalDetailTex: '/levels/east_coast_usa/art/terrains/t_rock_eca_nm.png',
      normalMacroStrength: [0.800000012, 0.800000012],
      normalMacroTex: '/levels/east_coast_usa/art/terrains/t_rocks_pac_nm.png',
      normalMacroTexSize: 10,
      roughnessBaseTex: '/levels/east_coast_usa/art/terrains/t_terrain_base_r.png',
      roughnessBaseTexSize: 2048,
      roughnessDetailStrength: [0.300000012, 0.300000012],
      roughnessDetailTex: '/levels/east_coast_usa/art/terrains/t_rock_eca_r.png',
      roughnessMacroStrength: [0.150000006, 0.5],
      roughnessMacroTex: '/levels/east_coast_usa/art/terrains/t_rocks_pac_r.png',
      roughnessMacroTexSize: 10,
    },
  },
  {
    internalName: 'asphalt',
    template: {
      class: 'TerrainMaterial',
      annotation: 'ASPHALT',
      aoBaseTex: '/levels/east_coast_usa/art/terrains/t_terrain_base02_ao.png',
      aoBaseTexSize: 2048,
      aoDetailTex: '/levels/east_coast_usa/art/terrains/t_asphalt_02_ao.png',
      aoMacroTex: '/levels/east_coast_usa/art/terrains/t_macro_asphalt_ao.png',
      aoMacroTexSize: 80,
      baseColorBaseTex: '/levels/east_coast_usa/art/terrains/t_terrain_base02_b.png',
      baseColorBaseTexSize: 2048,
      baseColorDetailStrength: [0.349999994, 0],
      baseColorDetailTex: '/levels/east_coast_usa/art/terrains/t_asphalt_02_b.png',
      baseColorMacroStrength: [0.300000012, 0.300000012],
      baseColorMacroTex: '/levels/east_coast_usa/art/terrains/t_macro_asphalt_b.png',
      baseColorMacroTexSize: 80,
      groundmodelName: 'ASPHALT',
      heightBaseTex: '/levels/east_coast_usa/art/terrains/t_terrain_base02_h.png',
      heightBaseTexSize: 2048,
      heightDetailTex: '/levels/east_coast_usa/art/terrains/t_asphalt_02_h.png',
      heightMacroTex: '/levels/east_coast_usa/art/terrains/t_macro_asphalt_h.png',
      heightMacroTexSize: 80,
      macroDistances: [0, 10, 100, 3000],
      normalBaseTex: '/levels/east_coast_usa/art/terrains/t_terrain_base02_nm.png',
      normalBaseTexSize: 2048,
      normalDetailStrength: [0.800000012, 0.200000003],
      normalDetailTex: '/levels/east_coast_usa/art/terrains/t_asphalt_02_nm.png',
      normalMacroStrength: [0.800000012, 0.800000012],
      normalMacroTex: '/levels/east_coast_usa/art/terrains/t_macro_asphalt_nm.png',
      normalMacroTexSize: 80,
      roughnessBaseTex: '/levels/east_coast_usa/art/terrains/t_terrain_base02_r.png',
      roughnessBaseTexSize: 2048,
      roughnessDetailStrength: [0.699999988, 0.5],
      roughnessDetailTex: '/levels/east_coast_usa/art/terrains/t_asphalt_02_r.png',
      roughnessMacroStrength: [0.699999988, 0.699999988],
      roughnessMacroTex: '/levels/east_coast_usa/art/terrains/t_macro_asphalt_r.png',
      roughnessMacroTexSize: 80,
    },
  },
  {
    internalName: 'GRAVEL',
    template: {
      class: 'TerrainMaterial',
      aoBaseTex: '/levels/Utah/art/terrains/t_terrain_base_ao.png',
      aoBaseTexSize: 2048,
      aoDetailTex: '/levels/Utah/art/terrains/t_gravels_ao.png',
      aoDetailTexSize: 2,
      aoMacroTex: '/levels/Utah/art/terrains/t_macro_clumpy_ao.png',
      aoMacroTexSize: 10,
      baseColorBaseTex: '/levels/Utah/art/terrains/t_terrain_base_b.png',
      baseColorBaseTexSize: 2048,
      baseColorDetailStrength: [0.3, 0.3],
      baseColorDetailTex: '/levels/Utah/art/terrains/t_gravels_b.png',
      baseColorDetailTexSize: 2,
      baseColorMacroStrength: [0.1, 0.25],
      baseColorMacroTex: '/levels/Utah/art/terrains/t_macro_clumpy_b.png',
      baseColorMacroTexSize: 10,
      detailDistAtten: [1, 1],
      detailDistances: [0, 0, 50, 100],
      groundmodelName: 'GRAVEL',
      heightBaseTex: '/levels/Utah/art/terrains/t_terrain_base_h.png',
      heightBaseTexSize: 2048,
      heightDetailTex: '/levels/Utah/art/terrains/t_gravels_h.png',
      heightDetailTexSize: 2,
      heightMacroTex: '/levels/Utah/art/terrains/t_macro_clumpy_h.png',
      heightMacroTexSize: 10,
      macroDistAtten: [0, 1],
      macroDistances: [0, 10, 100, 3000],
      normalBaseTex: '/levels/Utah/art/terrains/t_terrain_base_nm.png',
      normalBaseTexSize: 2048,
      normalDetailStrength: [0.4, 0.15],
      normalDetailTex: '/levels/Utah/art/terrains/t_gravels_nm.png',
      normalDetailTexSize: 2,
      normalMacroStrength: [0.1, 0.7],
      normalMacroTex: '/levels/Utah/art/terrains/t_macro_clumpy_nm.png',
      normalMacroTexSize: 10,
      roughnessBaseTex: '/levels/Utah/art/terrains/t_terrain_base_r.png',
      roughnessBaseTexSize: 2048,
      roughnessDetailStrength: [0.35, 0.35],
      roughnessDetailTex: '/levels/Utah/art/terrains/t_gravels_r.png',
      roughnessDetailTexSize: 2,
      roughnessMacroStrength: [0.15, 0.5],
      roughnessMacroTex: '/levels/Utah/art/terrains/t_macro_clumpy_r.png',
      roughnessMacroTexSize: 10,
    },
  },
  {
    internalName: 'Concrete',
    template: {
      class: 'TerrainMaterial',
      annotation: 'ASPHALT',
      aoBaseTex: '/levels/gridmap_v2/art/terrains/t_terrain_base_ao.png',
      aoBaseTexSize: 2048,
      aoDetailTex: '/levels/gridmap_v2/art/terrains/t_concrete_gm_ao.png',
      aoMacroTex: '/levels/gridmap_v2/art/terrains/t_macro_holes_ao.png',
      aoMacroTexSize: 40,
      baseColorBaseTex: '/levels/gridmap_v2/art/terrains/t_terrain_base_b.png',
      baseColorBaseTexSize: 2048,
      baseColorDetailStrength: [0.25, 0.25],
      baseColorDetailTex: '/levels/gridmap_v2/art/terrains/t_concrete_gm_b.png',
      baseColorMacroStrength: [0.100000001, 0.100000001],
      baseColorMacroTex: '/levels/gridmap_v2/art/terrains/t_macro_holes_b.png',
      baseColorMacroTexSize: 40,
      detailDistance: 25,
      detailSize: 2,
      detailStrength: 0.5,
      diffuseSize: 50,
      groundmodelName: 'ASPHALT',
      heightBaseTex: '/levels/gridmap_v2/art/terrains/t_terrain_base_h.png',
      heightBaseTexSize: 2048,
      heightDetailTex: '/levels/gridmap_v2/art/terrains/t_concrete_gm_h.png',
      heightMacroTex: '/levels/gridmap_v2/art/terrains/t_macro_holes_h.png',
      heightMacroTexSize: 40,
      macroDistance: 1000,
      macroDistances: [0, 10, 100, 3000],
      macroSize: 40,
      macroStrength: 0.5,
      normalBaseTex: '/levels/gridmap_v2/art/terrains/t_terrain_base_nm.png',
      normalBaseTexSize: 2048,
      normalDetailStrength: [0.699999988, 0.150000006],
      normalDetailTex: '/levels/gridmap_v2/art/terrains/t_concrete_gm_nm.png',
      normalMacroStrength: [0.100000001, 0.100000001],
      normalMacroTex: '/levels/gridmap_v2/art/terrains/t_macro_holes_nm.png',
      normalMacroTexSize: 40,
      roughnessBaseTex: '/levels/gridmap_v2/art/terrains/t_terrain_base_r.png',
      roughnessBaseTexSize: 2048,
      roughnessDetailStrength: [0.600000024, 0.600000024],
      roughnessDetailTex: '/levels/gridmap_v2/art/terrains/t_concrete_gm_r.png',
      roughnessMacroStrength: [0.150000006, 0.5],
      roughnessMacroTex: '/levels/gridmap_v2/art/terrains/t_macro_holes_r.png',
      roughnessMacroTexSize: 40,
    },
  },
];

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
const WATERWAY_STYLE = {
  river:  { halfWidthM: 12.0 },
  canal:  { halfWidthM:  6.0 },
  stream: { halfWidthM:  2.5 },
  drain:  { halfWidthM:  2.0 },
  ditch:  { halfWidthM:  1.5 },
};

const CONCRETE_LANDUSES = new Set(['commercial', 'industrial', 'retail']);

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
  if (CONCRETE_LANDUSES.has(lu)) return 7;
  if (lu === 'garages') return 5;
  if (lu === 'residential') return 1;
  if (lu === 'quarry') return 4;
  if (lu === 'railway') return 6;
  if (lu === 'reservoir' || lu === 'basin') return -1;

  if (lei === 'park' || lei === 'garden' || lei === 'playground') return 1;
  if (lei === 'recreation_ground' || lei === 'pitch' || lei === 'golf_course') return 1;
  if (lei === 'nature_reserve' || lei === 'common' || lei === 'dog_park') return 1;
  if (lei === 'sports_centre' || lei === 'stadium') return 7;
  if (lei === 'beach_resort') return 3;
  if (lei === 'track') return 5;

  if (am === 'parking') return 7;
  if (am === 'fuel') return 5;

  if (sur === 'asphalt' || sur === 'paved') return 5;
  if (sur === 'concrete') return 7;
  if (sur === 'gravel' || sur === 'dirt' || sur === 'unpaved' || sur === 'compacted') return 6;
  if (sur === 'grass') return 1;
  if (sur === 'sand') return 3;

  return -1;
}

// ── OSM layer map builder ──────────────────────────────────────────────────

function buildOSMLayerMap(terrainData, worldSize) {
  const { width: size, bounds, osmFeatures = [] } = terrainData;
  const metersPerPixel = worldSize / size;
  const layerMap = new Uint8Array(size * size);

  // 1. Paint area polygons (painted first; roads override on top).
  for (const feature of osmFeatures) {
    if (feature.type === 'road') continue;
    const matIdx = areaMatIndex(feature);
    if (matIdx < 0 || !feature.geometry?.length) continue;
    const ring = feature.geometry.map(pt => geoToTerrainPx(pt.lat, pt.lng, bounds, size));
    rasterizePolygon(layerMap, size, ring, matIdx);
  }

  // 2. Paint water area bodies (overrides land-use fills).
  for (const feature of osmFeatures) {
    if (feature.type === 'road' || !feature.geometry?.length) continue;
    const t = feature.tags || {};
    const isWaterArea =
      t.natural === 'water' || t.natural === 'wetland' ||
      t.water ||
      t.landuse === 'reservoir' || t.landuse === 'basin' ||
      t.leisure === 'swimming_pool' ||
      ['riverbank', 'dock', 'boatyard', 'dam'].includes(t.waterway);
    if (!isWaterArea) continue;
    const ring = feature.geometry.map(pt => geoToTerrainPx(pt.lat, pt.lng, bounds, size));
    rasterizePolygon(layerMap, size, ring, 0);
  }

  // 3. Paint linear waterways.
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

  // 4. Paint roads (overrides area fills).
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

  return layerMap;
}

// ── Image-based layer map builder ──────────────────────────────────────────

/**
 * Map an RGB pixel color from the segmented satellite image to a material index.
 * Uses HSV color space to classify terrain cover types.
 */
function colorToMaterialIndex(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const s = max === 0 ? 0 : delta / max; // HSV saturation

  let h = 0;
  if (delta > 0) {
    if (max === rn)      h = ((gn - bn) / delta % 6) * 60;
    else if (max === gn) h = ((bn - rn) / delta + 2) * 60;
    else                 h = ((rn - gn) / delta + 4) * 60;
    if (h < 0) h += 360;
  }

  // Very dark → asphalt / roads
  if (max < 0.25) return 5;

  // Blue / cyan → water (DefaultMaterial, index 0)
  if (h >= 170 && h <= 265 && s > 0.25) return 0;

  // Green → grass / vegetation
  if (h >= 60 && h <= 160 && s > 0.12) return 1;

  // Yellow-green with moderate saturation → grass
  if (h >= 40 && h < 60 && s > 0.1 && max > 0.35) return 1;

  // Sandy yellow / beige (high value, moderate saturation)
  if (h >= 30 && h < 60 && s > 0.15 && max > 0.55) return 3;

  // Brown / earthy → dirt
  if (h >= 15 && h < 45 && s > 0.15) return 2;

  // Reddish tones (rooftops, urban) → concrete
  if ((h < 20 || h > 340) && s > 0.2) return 7;

  // Desaturated grays
  if (s < 0.1) {
    if (max < 0.4) return 4; // dark gray → rock
    if (max < 0.72) return 7; // medium gray → concrete
    return 1; // light gray → grass / default
  }

  return 1; // fallback: grass
}

/**
 * Build a terrain-space layer map by inferring material indices from the
 * colors in a segmented satellite image canvas.
 *
 * The canvas origin is NW (top-left); the layer map origin is SW (bottom-left)
 * so Y must be flipped during sampling.
 *
 * @param {HTMLCanvasElement} canvas - segmented (hybrid) image at any resolution
 * @param {number} terrainSize - square side length of the target layer map
 * @returns {Uint8Array} layer map (row-major, SW origin)
 */
function buildLayerMapFromImage(canvas, terrainSize) {
  // Draw canvas into an offscreen canvas at terrain resolution, flipping Y so
  // (0,0) becomes SW instead of NW.
  const offscreen = document.createElement('canvas');
  offscreen.width  = terrainSize;
  offscreen.height = terrainSize;
  const ctx = offscreen.getContext('2d');
  ctx.translate(0, terrainSize);
  ctx.scale(1, -1);
  ctx.drawImage(canvas, 0, 0, terrainSize, terrainSize);

  const { data } = ctx.getImageData(0, 0, terrainSize, terrainSize);
  const layerMap = new Uint8Array(terrainSize * terrainSize);
  for (let i = 0; i < terrainSize * terrainSize; i++) {
    layerMap[i] = colorToMaterialIndex(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  }
  return layerMap;
}

// ── Shared base texture generation (neutral AO / normal / roughness) ───────
// These are generated at baseSize to match the TerrainMaterialTextureSet.
// Only 6 textures total regardless of how many materials are used.

async function makeAoBlob(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  canvas.getContext('2d').fillStyle = '#ffffff';
  canvas.getContext('2d').fillRect(0, 0, size, size);
  return new Promise(res => canvas.toBlob(res, 'image/png'));
}

async function makeNormalBlob(bumpiness = 0, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;

  if (bumpiness === 0) {
    // Flat normal map (R=128, G=128, B=255) — no bumpiness.
    for (let i = 0; i < size * size; i++) {
      d[i * 4] = 128; d[i * 4 + 1] = 128; d[i * 4 + 2] = 255; d[i * 4 + 3] = 255;
    }
  } else {
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
  }
  ctx.putImageData(img, 0, 0);
  return new Promise(res => canvas.toBlob(res, 'image/png'));
}

async function makeRoughnessBlob(roughness = 180, variance = 0, size = 256) {
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

function cloneMaterialTemplate(template) {
  return structuredClone(template);
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Build BeamNG terrain materials.
 *
 * @param {object} terrainData  — { width, bounds, osmFeatures }
 * @param {number} worldSize    — terrain width in metres
 * @param {string} levelName    — BeamNG level folder name
 * @param {number} [satelliteTexSize] — base texture pixel size (defaults to terrainData.width)
 * @param {object} [options]
 * @param {'osm'|'image'} [options.pbrSource='osm'] — layer map source
 * @param {HTMLCanvasElement|null} [options.imageCanvas=null] — segmented image for 'image' mode
 * @returns {Promise<{
 *   layerMap: Uint8Array,
 *   materialNames: string[],
 *   materialDefs: object,
 *   textureFiles: Array<{path:string, blob:Blob}>,
 *   textureSetName: string,
 * }>}
 */
export async function buildTerrainMaterials(terrainData, worldSize, levelName, satelliteTexSize, options = {}) {
  const { pbrSource = 'osm', imageCanvas = null } = options;
  const { width: size } = terrainData;
  const baseSize = satelliteTexSize ?? size;

  // ── Build layer map ────────────────────────────────────────────────────────
  let layerMap;
  if (pbrSource === 'image' && imageCanvas) {
    layerMap = buildLayerMapFromImage(imageCanvas, size);
  } else {
    layerMap = buildOSMLayerMap(terrainData, worldSize);
  }

  // ── Material definitions ───────────────────────────────────────────────────
  const DETAIL_SIZE = 1024;
  const textureFiles = [];
  const materialDefs = {};

  // TerrainMaterialTextureSet: switches BeamNG to PBR mode. baseTexSize must
  // match the pixel dimensions of the base-slot textures we generate below.
  const textureSetName = `${levelName}TerrainMaterialTextureSet`;
  materialDefs[textureSetName] = {
    name: textureSetName,
    class: 'TerrainMaterialTextureSet',
    persistentId: crypto.randomUUID(),
    baseTexSize:   [baseSize, baseSize],
    detailTexSize: [DETAIL_SIZE, DETAIL_SIZE],
    macroTexSize:  [DETAIL_SIZE, DETAIL_SIZE],
  };

  const satellitePath = `/levels/${levelName}/art/terrains/terrain.png`;
  const p = (f) => `/levels/${levelName}/art/terrains/${f}`;

  // Shared neutral base textures (AO = white, normal = flat, roughness = neutral).
  // Generated at baseSize to match TextureSet.baseTexSize. Only one set shared
  // by all materials, so memory cost is 3 canvases instead of 3×N.
  const sharedAo = await makeAoBlob(baseSize);
  const sharedNm = await makeNormalBlob(0, baseSize);
  const sharedR  = await makeRoughnessBlob(180, 0, baseSize);
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

  // Helper: neutral slot fields used by DefaultMaterial and as fallbacks.
  function neutralSlots() {
    return {
      baseColorDetailTex:      p('shared_r_sm.png'), baseColorDetailStrength: [0, 0],
      baseColorMacroTex:       p('shared_r_sm.png'), baseColorMacroStrength:  [0, 0],
      normalBaseTex:           p('shared_nm.png'),   normalBaseTexSize:        baseSize,
      normalDetailTex:         p('shared_nm_sm.png'), normalDetailStrength:    [0, 0],
      normalMacroTex:          p('shared_nm_sm.png'), normalMacroStrength:     [0, 0],
      roughnessBaseTex:        p('shared_r.png'),    roughnessBaseTexSize:     baseSize,
      roughnessDetailTex:      p('shared_r_sm.png'), roughnessDetailStrength: [0, 0],
      roughnessMacroTex:       p('shared_r_sm.png'), roughnessMacroStrength:  [0, 0],
      aoBaseTex:               p('shared_ao.png'),   aoBaseTexSize:            baseSize,
      aoDetailTex:             p('shared_ao_sm.png'),
      aoMacroTex:              p('shared_ao_sm.png'),
      heightBaseTex:           p('shared_r.png'),    heightBaseTexSize:        baseSize,
      heightDetailTex:         p('shared_r_sm.png'),
      heightMacroTex:          p('shared_r_sm.png'),
    };
  }

  // DefaultMaterial: satellite base, neutral for all other channels.
  const defaultUuid = crypto.randomUUID();
  const defaultKey  = `DefaultMaterial-${defaultUuid}`;
  materialDefs[defaultKey] = {
    name: defaultKey,
    class: 'TerrainMaterial',
    persistentId: defaultUuid,
    internalName: 'DefaultMaterial',
    groundmodelName: 'GROUNDMODEL_ASPHALT1',
    baseColorBaseTex: satellitePath,
    baseColorBaseTexSize: baseSize,
    ...neutralSlots(),
  };

  // Clone real BeamNG terrain materials and repoint only the base slots to this
  // exported level's terrain base, following the Terrain Material Editor flow.
  for (const refMaterial of REFERENCE_MATERIALS) {
    const uuid = crypto.randomUUID();
    const key = `${refMaterial.internalName}-${uuid}`;
    const materialDef = cloneMaterialTemplate(refMaterial.template);
    materialDef.name = key;
    materialDef.persistentId = uuid;
    materialDef.internalName = refMaterial.internalName;
    materialDef.baseColorBaseTex = satellitePath;
    materialDef.baseColorBaseTexSize = baseSize;
    materialDef.aoBaseTex = p('shared_ao.png');
    materialDef.aoBaseTexSize = baseSize;
    materialDef.normalBaseTex = p('shared_nm.png');
    materialDef.normalBaseTexSize = baseSize;
    materialDef.roughnessBaseTex = p('shared_r.png');
    materialDef.roughnessBaseTexSize = baseSize;
    materialDef.heightBaseTex = p('shared_r.png');
    materialDef.heightBaseTexSize = baseSize;
    materialDefs[key] = materialDef;
  }

  return { layerMap, materialNames: MATERIAL_NAMES, materialDefs, textureFiles, textureSetName };
}
