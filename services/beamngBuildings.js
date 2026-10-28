/**
 * Textured OSM buildings for BeamNG exports.
 *
 * Replaces the flat vertex-coloured extrusions with walls and roofs dressed in
 * BeamNG's own global trim sheets and tileables (all under /assets/, so no
 * link mirroring), the way BeamNG.Earth builds its buildings
 * (refs/BeamNG.Earth-main/server/buildings.py, MIT):
 *
 *   - window sheets: t_highrise_plaster (4 bands, one floor each: tall
 *     windows, panel windows, sash windows on plaster, sash windows on brick)
 *     and t_highrise_metal (curtain wall, office glazing, shopfront with
 *     awnings). 1024 px covers TILE_PX_M of wall; every wall gets a whole
 *     number of window bays so no window is cut at a corner. The plaster
 *     sheet's emissive map lights the windows at night;
 *   - houses: plain siding / stucco / brick walls with sash windows laid
 *     over them, pitched roofs of slate, shingle or clay;
 *   - sheds, garages and warehouses: plain tileables (siding, corrugated
 *     metal, precast panel) with flat or metal roofs;
 *   - a region decides the habits (brick share, wall kinds, roof pitch and
 *     colours) and a hash of each footprint picks within them, so the same
 *     building always comes out the same.
 *
 * OSM tags win where present: height, building:levels, roof:shape,
 * building:material, building:colour, roof:colour, shop/amenity on the
 * ground floor.
 *
 * buildTexturedBuildings() returns THREE meshes already in BeamNG world space
 * (metres, Z up) with one geometry group per material; their material names
 * match getBuildingMaterialDefs().
 */
import * as THREE from 'three';

// ── Materials ───────────────────────────────────────────────────────────────

const TRIM = '/assets/materials/trim';
const TILE = '/assets/materials/tileable';

const pbr = (dir, base, { emissive = false, metallic = false } = {}) => ({
  baseColorMap: `${dir}/${base}_b.color.png`,
  normalMap: `${dir}/${base}_nm.normal.png`,
  roughnessMap: `${dir}/${base}_r.data.png`,
  ambientOcclusionMap: `${dir}/${base}_ao.data.png`,
  ...(metallic ? { metallicMap: `${dir}/${base}_m.data.png` } : {}),
  ...(emissive ? { emissiveMap: `${dir}/${base}_e.color.png` } : {}),
});

// a PBR set without an AO map, and an older diffuse + normal set (_d / _n)
const pbrNoAo = (dir, base) => ({
  baseColorMap: `${dir}/${base}_b.color.png`,
  normalMap: `${dir}/${base}_nm.normal.png`,
  roughnessMap: `${dir}/${base}_r.data.png`,
});
const legacy = (dir, base, roughness) => ({
  baseColorMap: `${dir}/${base}_d.dds`,
  normalMap: `${dir}/${base}_n.dds`,
  roughnessFactor: roughness,
});

export const BUILDING_MATERIALS = {
  facade: 'mapng_bld_facade',
  shop: 'mapng_bld_shop',
  office: 'mapng_bld_office',
  siding: 'mapng_bld_siding',
  stucco: 'mapng_bld_stucco',
  brick: 'mapng_bld_brick',
  stone: 'mapng_bld_stone',
  metalwall: 'mapng_bld_metalwall',
  panel: 'mapng_bld_panel',
  roofFlat: 'mapng_bld_roof_flat',
  roofSlate: 'mapng_bld_roof_slate',
  roofShingle: 'mapng_bld_roof_shingle',
  roofMetal: 'mapng_bld_roof_metal',
  // variants (each a family's alternative, picked per building)
  brickEca: 'mapng_bld_brick_eca',
  brickDark: 'mapng_bld_brick_dark',
  brickPainted: 'mapng_bld_brick_painted',
  brickWhite: 'mapng_bld_brick_white',
  cladding: 'mapng_bld_cladding',
  claddingOld: 'mapng_bld_cladding_old',
  plaster: 'mapng_bld_plaster',
  rendered: 'mapng_bld_rendered',
  stoneClean: 'mapng_bld_stone_clean',
  stoneFacade: 'mapng_bld_stone_facade',
  stoneMixed: 'mapng_bld_stone_mixed',
  blockwall: 'mapng_bld_blockwall',
  concrete: 'mapng_bld_concrete',
  metalWhite: 'mapng_bld_metal_white',
  roofRounded: 'mapng_bld_roof_rounded',
  roofItaly: 'mapng_bld_roof_italy',
  roofOchre: 'mapng_bld_roof_ochre',
  roofSlateTiles: 'mapng_bld_roof_slate_tiles',
  roofWood: 'mapng_bld_roof_wood',
  roofTin: 'mapng_bld_roof_tin',
};

// Lit windows at night: the window sheets' emissive maps scaled by the
// building object's instanceColor, which the environment's night lights set
// to the glow colour at dusk and to black at dawn (the buildings TSStatic is
// flagged nightEmissive; core/environment.lua). The official materials of
// these sheets never enable it.
const NIGHT_WINDOWS = { emissiveFactor: [1, 1, 1], instanceEmissive: true, emissiveIntensityNits: 60 };

const MATERIAL_STAGES = {
  facade: { ...pbr(`${TRIM}/plaster/t_highrise_plaster`, 't_highrise_plaster', { emissive: true, metallic: true }), ...NIGHT_WINDOWS },
  shop: { ...pbr(`${TRIM}/metal/t_highrise_metal`, 't_highrise_metal', { emissive: true, metallic: true }), ...NIGHT_WINDOWS },
  office: {
    ...pbr(`${TRIM}/metal/t_highrise_metal`, 't_highrise_metal', { emissive: true, metallic: true }),
    ...NIGHT_WINDOWS,
    baseColorMap: `${TRIM}/metal/t_highrise_metal/t_highrise_metal_02_b.color.png`,
  },
  siding: pbr(`${TILE}/wood/weatherboards`, 't_weatherboards'),
  stucco: pbr(`${TILE}/plaster/m_stucco_white`, 't_stucco_white'),
  brick: pbr(`${TILE}/brick/brick_plain`, 't_bricks_red_01'),
  stone: pbr(`${TILE}/brick/stone_brick_irregular`, 't_stone_brick_irregular'),
  metalwall: { baseColorMap: `${TILE}/metal/m_metal_wall_corrugate/t_metal_wall_corrugated_b.color.png`, roughnessFactor: 0.6 },
  panel: { baseColorMap: `${TILE}/concrete/concrete_precast1/t_concrete_precast1_b.color.png`, roughnessFactor: 0.9 },
  roofFlat: { baseColorMap: `${TILE}/roofing/asphalt_roof/t_asphalt_roof_b.color.png`, roughnessFactor: 0.9, metallicFactor: 0 },
  roofSlate: pbr(`${TILE}/roofing/m_roof_slates_square`, 't_roof_slates_square'),
  roofShingle: {
    baseColorMap: '/assets/materials/baked_props/utah_roof_shingles/utah_roof_shingles_d.dds',
    normalMap: '/assets/materials/baked_props/utah_roof_shingles/utah_roof_shingles_n.dds',
    roughnessFactor: 0.85,
  },
  roofMetal: pbr(`${TILE}/metal/cladding_zinc`, 't_metal_cladded_zinc', { metallic: true }),
  brickEca: legacy(`${TILE}/brick/eca_bld_bricks`, 'eca_bld_bricks', 0.85),
  brickDark: { baseColorMap: `${TILE}/brick/eca_bld_bricks_dark/eca_bld_bricks_dark_d.dds`, normalMap: `${TILE}/brick/eca_bld_bricks/eca_bld_bricks_n.dds`, roughnessFactor: 0.85 },
  brickPainted: {
    baseColorMap: `${TILE}/brick/brick_painted/t_brick_painted_b.color.png`,
    normalMap: `${TILE}/brick/brick_painted/t_brick_plain_nm.normal.png`,
    roughnessMap: `${TILE}/brick/brick_painted/t_brick_plain_r.data.png`,
    ambientOcclusionMap: `${TILE}/brick/brick_painted/t_brick_plain_ao.data.png`,
  },
  brickWhite: pbr(`${TILE}/brick/t_brick_white_paint_01`, 't_brick_white_paint_01'),
  cladding: legacy(`${TILE}/wood/eca_bld_woodcladding_new`, 'eca_bld_woodcladding_new', 0.8),
  claddingOld: legacy(`${TILE}/wood/eca_bld_woodcladding_old`, 'eca_bld_woodcladding_01', 0.85),
  plaster: pbrNoAo(`${TILE}/plaster/m_plaster_float`, 't_plaster_float'),
  rendered: legacy(`${TILE}/plaster/eca_bld_modernwall`, 'eca_bld_modernwall', 0.8),
  stoneClean: legacy(`${TILE}/stone/eca_bld_stone_clean`, 'eca_bld_stone_clean', 0.85),
  stoneFacade: { baseColorMap: `${TILE}/stone/m_stone_facade/t_stone_facade_d.color.png`, normalMap: `${TILE}/stone/m_stone_facade/t_stone_facade_nm.normal.png`, roughnessFactor: 0.85 },
  stoneMixed: pbr(`${TILE}/stone/m_stonebrick_mixed_01`, 't_stonebrick_mixed_01'),
  blockwall: pbr(`${TILE}/brick/ind_blockwall`, 't_concrete_cinderblock_01'),
  concrete: legacy(`${TILE}/concrete/eca_bld_concrete`, 'eca_bld_concrete', 0.9),
  metalWhite: pbr(`${TILE}/metal/corrugated_modern`, 't_metal_corrugated_01', { metallic: true }),
  roofRounded: pbr(`${TILE}/roofing/m_roof_slates_rounded`, 't_roof_slates_rounded'),
  roofItaly: pbrNoAo(`${TILE}/roofing/t_italy_bld_roof_tiles`, 't_italy_bld_roof_tiles'),
  roofOchre: pbr(`${TILE}/roofing/m_roof_slates_ochre`, 't_roof_slates_ochre'),
  roofSlateTiles: pbrNoAo(`${TILE}/roofing/t_slate_rooftiles_01`, 't_slate_rooftiles_01'),
  roofWood: pbr(`${TILE}/roofing/eca_bld_wood_rooftiles`, 't_eca_bld_wood_rooftiles'),
  roofTin: pbr(`${TILE}/metal/m_si_metal_roof`, 't_si_metal_roof', { metallic: true }),
};

/** BeamNG material definitions for every name in BUILDING_MATERIALS. */
// facadeEmissiveMap: the level's own night map for the plaster window sheet
// (public/beamng_facade_e.png, scripts/build-facade-emissive.py: the
// official one lights only the panel-window band, so houses stayed dark).
export const FACADE_EMISSIVE_FILE = 'beamng_facade_e.png';

export function getBuildingMaterialDefs({ facadeEmissiveMap = null } = {}) {
  const defs = {};
  for (const [key, name] of Object.entries(BUILDING_MATERIALS)) {
    const stage = { ...MATERIAL_STAGES[key], vertColor: true };
    if (key === 'facade' && facadeEmissiveMap) stage.emissiveMap = facadeEmissiveMap;
    defs[name] = {
      name,
      mapTo: name,
      class: 'Material',
      version: 1.5,
      annotation: 'BUILDINGS',
      Stages: [stage, {}, {}, {}],
      translucentBlendOp: 'None',
    };
  }
  return defs;
}

// ── Sheet layout (measured from the 0.40 textures) ───────────────────────────

const TILE_PX_M = 12.0;     // m of wall per 1024 px of a window sheet
const SIDING_UV_M = 3.0;    // m per repeat of plain wall tileables
const ROOF_UV_M = 6.0;      // m per repeat of roof tileables
const BANDS = 4;
// [band index (0 = image top), bays per sheet width, allowed bay indices or null for continuous]
const BAND_TALL = [0, 3, null];
const BAND_PANEL = [1, 4, null];
const BAND_SASH = [2, 5, [0, 2, 3]];   // bays 1 and 4 are black "open" windows
const BAND_BRICK = [3, 5, null];
const BAND_CURTAIN = [0, 5, null];     // t_highrise_metal
const BAND_OFFICE = [1, 4, null];
const BAND_SHOP = [2, 2, null];
// One sash window (with sill) cut from the plaster sheet: u0, u1, v0, v1.
const WIN_UV = [53 / 1024, 154 / 1024, 1 - (512 + 238) / 1024, 1 - (512 + 45) / 1024];
// The same sash window from band 2's bay 3, which the night map
// (public/beamng_facade_e.png) leaves unlit: a house nobody is home in.
const WIN_UV_DARK = [664 / 1024, 765 / 1024, WIN_UV[2], WIN_UV[3]];
const HOUSE_LIT_SHARE = 0.65;
const WIN_W = 1.05;
const WIN_H = 1.75;
const WIN_SILL = 0.85;
const HOUSE_BAY_M = 3.4;
const WIN_OUT_M = 0.03;
const FOUNDATION_M = 0.6;
const ROOF_OVERHANG_M = 0.35;
// A pitched roof is a slab: its underside (painted soffit boards under the
// overhang) this far under the tiles, fascia boards round its edges. The
// tiles alone face up only: seen from under the eaves the overhang was gone.
const ROOF_THICK_M = 0.12;
const SOFFIT_TINT = [0.93, 0.92, 0.9];
const RECT_FILL = 0.85;     // footprint / oriented-box area needed for a pitched roof

const bandV = (band) => {
  const eps = 1.5 / 1024;
  const k = band[0];
  return [1 - (k + 1) / BANDS + eps, 1 - k / BANDS - eps];
};

// ── Deterministic choices ───────────────────────────────────────────────────

function hash01(...parts) {
  let h = 2166136261;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const pick = (list, r) => list[Math.min(list.length - 1, Math.floor(r * list.length))];

const pickShare = (shares, r) => {
  let acc = 0;
  for (const [value, share] of shares) {
    acc += share;
    if (r < acc) return value;
  }
  return shares[shares.length - 1][0];
};

// ── Regional habits (coarse boxes, after BeamNG.Earth's region_style) ────────

const US_ROOFS = [['roofSlate', [0, 1, 2, 3]], ['roofShingle', [0, 1, 2, 3]], ['roofShingle', [4, 5, 6, 7]], ['roofSlateTiles', [1, 2]], ['roofWood', [0, 1]]];
const CLAY = ['roofSlate', [4, 5, 6]];
const CLAY_ROUND = ['roofRounded', [0, 1]];
const CLAY_TILE = ['roofItaly', [0, 1]];
const OCHRE = ['roofOchre', [0, 1]];
const DARK = ['roofSlate', [7, 8, 9]];
const DARK_TILE = ['roofSlateTiles', [0, 1, 2]];
const TIN = ['roofTin', [0, 1, 2, 3]];
const REGIONS = {
  us_east: { brick: 0.75, walls: [['siding', 0.75], ['brick', 0.25]], hipped: 0.4, roofs: US_ROOFS, pitch: 32 },
  us_south: { brick: 0.35, walls: [['siding', 0.75], ['brick', 0.25]], hipped: 0.4, roofs: US_ROOFS, pitch: 30 },
  us_plains: { brick: 0.15, walls: [['siding', 0.8], ['brick', 0.2]], hipped: 0.4, roofs: US_ROOFS, pitch: 30 },
  us_west: { brick: 0.15, walls: [['stucco', 0.65], ['siding', 0.25], ['brick', 0.1]], hipped: 0.5, roofs: [...US_ROOFS, CLAY_ROUND, CLAY_TILE], pitch: 24 },
  alpine: { brick: 0.05, walls: [['siding', 0.45], ['stucco', 0.55]], hipped: 0.15, roofs: [DARK, DARK_TILE, ['roofSlate', [9, 5]], ['roofWood', [0, 1]]], pitch: 24 },
  europe_north: { brick: 0.5, walls: [['brick', 0.45], ['stucco', 0.55]], hipped: 0.3, roofs: [CLAY, CLAY_TILE, DARK, DARK_TILE], pitch: 42 },
  nordic: { brick: 0.12, walls: [['siding', 0.65], ['stucco', 0.35]], hipped: 0.2, roofs: [DARK, DARK_TILE, CLAY, TIN], pitch: 35 },
  mediterranean: { brick: 0.08, walls: [['stucco', 0.85], ['stone', 0.15]], hipped: 0.5, roofs: [CLAY, CLAY_ROUND, CLAY_TILE, OCHRE], pitch: 22 },
  latin_america: { brick: 0.15, walls: [['stucco', 0.8], ['brick', 0.2]], hipped: 0.3, roofs: [CLAY, CLAY_ROUND, CLAY_TILE, ['roofMetal', [0, 1]], TIN], pitch: 20 },
  east_asia: { brick: 0.1, walls: [['stucco', 0.6], ['panel', 0.4]], hipped: 0.5, roofs: [DARK, DARK_TILE, ['roofMetal', [0, 4]]], pitch: 25 },
  oceania: { brick: 0.35, walls: [['brick', 0.4], ['siding', 0.3], ['stucco', 0.3]], hipped: 0.7, roofs: [['roofMetal', [0, 1, 4]], TIN, CLAY, CLAY_TILE], pitch: 24 },
  cool: { brick: 0.3, walls: [['siding', 0.5], ['brick', 0.3], ['stucco', 0.2]], hipped: 0.3, roofs: [DARK, DARK_TILE, ['roofMetal', [0, 1]], TIN], pitch: 35 },
  warm: { brick: 0.15, walls: [['stucco', 0.8], ['brick', 0.2]], hipped: 0.4, roofs: [CLAY, CLAY_ROUND, OCHRE, ['roofMetal', [0, 1, 3]], TIN], pitch: 22 },
};

export function regionStyle(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return REGIONS.us_east;
  if (lat >= 24 && lat <= 72 && lon >= -170 && lon <= -52) {
    if (lon < -100) return REGIONS.us_west;
    if (lon <= -95) return REGIONS.us_plains;
    return lat > 36 ? REGIONS.us_east : REGIONS.us_south;
  }
  if (lat >= -56 && lat < 24 && lon >= -120 && lon <= -30) return REGIONS.latin_america;
  if (lat >= 45.4 && lat <= 48 && lon >= 5.8 && lon <= 16.5) return REGIONS.alpine;
  if (lat >= 56 && lat <= 72 && lon >= 4.5 && lon <= 32) return REGIONS.nordic;
  if (lat >= 46 && lat <= 72 && lon >= -11 && lon <= 32) return REGIONS.europe_north;
  if (lat >= 30 && lat < 46 && lon >= -10 && lon <= 40) return REGIONS.mediterranean;
  if (lat >= 20 && lat <= 46 && lon >= 100 && lon <= 146) return REGIONS.east_asia;
  if (lat >= -50 && lat <= -10 && lon >= 110 && lon <= 180) return REGIONS.oceania;
  return Math.abs(lat) >= 50 ? REGIONS.cool : REGIONS.warm;
}

// ── Colours (vertex tints over the textures) ────────────────────────────────

const WALL_TINTS = {
  facade: [[1, 1, 1], [1, 0.93, 0.8], [0.92, 0.82, 0.68], [0.8, 0.82, 0.84]],
  siding: [[0.96, 0.95, 0.92], [0.9, 0.86, 0.76], [0.78, 0.84, 0.9], [0.95, 0.92, 0.74], [0.78, 0.84, 0.74], [0.82, 0.78, 0.72], [0.7, 0.72, 0.75]],
  stucco: [[1, 0.97, 0.9], [0.96, 0.88, 0.74], [0.93, 0.8, 0.68], [0.98, 0.95, 0.88], [0.88, 0.84, 0.78]],
  brick: [[1, 1, 1], [0.78, 0.72, 0.7], [1, 0.92, 0.8]],
  stone: [[1, 1, 1], [0.92, 0.88, 0.8]],
  metalwall: [[0.85, 0.86, 0.88], [0.7, 0.72, 0.75], [0.62, 0.68, 0.74], [0.9, 0.88, 0.82]],
  panel: [[1, 1, 1], [1, 0.95, 0.86], [0.85, 0.85, 0.85]],
  shop: [[1, 1, 1]],
  office: [[1, 1, 1]],
};
// Each family's alternatives (a building picks one: the same family, a
// different texture), with their shares
const WALL_VARIANTS = {
  siding: [['siding', 0.45], ['cladding', 0.35], ['claddingOld', 0.2]],
  brick: [['brick', 0.3], ['brickEca', 0.3], ['brickDark', 0.15], ['brickPainted', 0.15], ['brickWhite', 0.1]],
  stucco: [['stucco', 0.45], ['plaster', 0.3], ['rendered', 0.25]],
  stone: [['stone', 0.35], ['stoneClean', 0.25], ['stoneFacade', 0.2], ['stoneMixed', 0.2]],
  panel: [['panel', 0.45], ['blockwall', 0.3], ['concrete', 0.25]],
  metalwall: [['metalwall', 0.55], ['metalWhite', 0.45]],
};
Object.assign(WALL_TINTS, {
  cladding: WALL_TINTS.siding,
  claddingOld: [[1, 1, 1], [0.92, 0.88, 0.8], [0.85, 0.8, 0.74]],
  brickEca: [[1, 1, 1], [0.92, 0.88, 0.84], [1, 0.95, 0.88]],
  brickDark: [[1, 1, 1], [0.92, 0.9, 0.88]],
  brickPainted: [[1, 1, 1], [0.95, 0.9, 0.8], [0.8, 0.85, 0.9], [0.9, 0.8, 0.72], [0.75, 0.8, 0.72], [0.62, 0.64, 0.68]],
  brickWhite: [[1, 1, 1], [0.96, 0.94, 0.9]],
  plaster: WALL_TINTS.stucco,
  rendered: [...WALL_TINTS.stucco, [0.85, 0.86, 0.88], [0.78, 0.8, 0.82]],
  stoneClean: [[1, 1, 1], [0.95, 0.92, 0.86]],
  stoneFacade: [[1, 1, 1], [0.95, 0.92, 0.86]],
  stoneMixed: [[1, 1, 1], [0.92, 0.9, 0.86]],
  blockwall: [[1, 1, 1], [0.95, 0.93, 0.88], [0.85, 0.85, 0.85], [0.9, 0.86, 0.78]],
  concrete: [[1, 1, 1], [0.9, 0.9, 0.9]],
  metalWhite: WALL_TINTS.metalwall,
});
const ROOF_TINTS = {
  roofFlat: [[0.85, 0.85, 0.85], [0.62, 0.62, 0.64], [0.95, 0.93, 0.88], [0.45, 0.45, 0.46], [0.75, 0.7, 0.64]],
  roofSlate: [[1, 1, 1], [0.8, 0.66, 0.56], [0.76, 0.8, 0.9], [0.62, 0.62, 0.62], [0.95, 0.52, 0.36], [0.78, 0.4, 0.3], [1, 0.66, 0.46], [0.42, 0.43, 0.46], [0.3, 0.31, 0.33], [0.48, 0.38, 0.32]],
  roofShingle: [[0.75, 0.72, 0.7], [0.55, 0.5, 0.48], [0.7, 0.56, 0.48], [0.62, 0.66, 0.72], [0.95, 0.52, 0.36], [0.78, 0.4, 0.3], [0.42, 0.43, 0.46], [0.36, 0.42, 0.52]],
  roofMetal: [[0.85, 0.86, 0.88], [0.55, 0.57, 0.6], [0.45, 0.58, 0.48], [0.62, 0.3, 0.26], [0.4, 0.42, 0.48]],
  roofRounded: [[1, 1, 1], [0.9, 0.8, 0.72]],
  roofItaly: [[1, 1, 1], [0.92, 0.85, 0.78]],
  roofOchre: [[1, 1, 1], [0.9, 0.85, 0.8]],
  roofSlateTiles: [[1, 1, 1], [0.8, 0.82, 0.86], [0.65, 0.66, 0.7]],
  roofWood: [[1, 1, 1], [0.85, 0.8, 0.75]],
  roofTin: [[1, 1, 1], [0.75, 0.78, 0.8], [0.62, 0.3, 0.26], [0.45, 0.58, 0.48]],
};
const JITTER = 0.06;

const NAMED_COLOURS = {
  white: [0.98, 0.98, 0.98], black: [0.3, 0.3, 0.3], grey: [0.6, 0.6, 0.6], gray: [0.6, 0.6, 0.6],
  red: [0.75, 0.35, 0.3], brown: [0.55, 0.42, 0.32], beige: [0.92, 0.86, 0.72], yellow: [0.98, 0.92, 0.6],
  orange: [0.95, 0.7, 0.45], green: [0.7, 0.82, 0.68], blue: [0.7, 0.78, 0.9], pink: [0.95, 0.8, 0.82],
  cream: [1, 0.95, 0.82], tan: [0.86, 0.76, 0.6],
};

function parseColour(value) {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  if (NAMED_COLOURS[v]) return NAMED_COLOURS[v];
  const m = /^#?([0-9a-f]{6})$/.exec(v);
  if (!m) return null;
  const n = Number.parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// ── Footprint helpers ────────────────────────────────────────────────────────

const signedArea = (ring) => {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
};

function cleanRing(points) {
  const out = [];
  for (const p of points) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const prev = out[out.length - 1];
    if (prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) < 0.05) continue;
    out.push(p);
  }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 0.05) out.pop();
  return out;
}

function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Minimum-area oriented box: { cx, cy, ux, uy (long axis), length, width }. */
export function orientedBox(ring) {
  const hull = convexHull(ring);
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const [ax, ay] = hull[i];
    const [bx, by] = hull[(i + 1) % hull.length];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-6) continue;
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    let minU = Infinity; let maxU = -Infinity; let minV = Infinity; let maxV = -Infinity;
    for (const [x, y] of hull) {
      const u = x * ux + y * uy;
      const v = -x * uy + y * ux;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) {
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      best = { area, cx: cu * ux - cv * uy, cy: cu * uy + cv * ux, ux, uy, du: maxU - minU, dv: maxV - minV };
    }
  }
  if (!best) return null;
  // long axis first
  if (best.dv > best.du) {
    return { cx: best.cx, cy: best.cy, ux: -best.uy, uy: best.ux, length: best.dv, width: best.du, area: best.area };
  }
  return { cx: best.cx, cy: best.cy, ux: best.ux, uy: best.uy, length: best.du, width: best.dv, area: best.area };
}

// ── Building plan (height, floors, look) ─────────────────────────────────────

const HOUSE_CLASSES = new Set(['house', 'detached', 'semidetached_house', 'bungalow', 'residential', 'farm', 'cabin', 'static_caravan', 'terrace', 'duplex']);
const SHED_CLASSES = new Set(['shed', 'garage', 'garages', 'carport', 'roof', 'hut', 'barn', 'farm_auxiliary', 'greenhouse', 'service', 'storage_tank', 'kiosk', 'toilets']);
const INDUSTRIAL_CLASSES = new Set(['industrial', 'warehouse', 'manufacture', 'factory', 'hangar']);
const SHOP_CLASSES = new Set(['retail', 'commercial', 'supermarket', 'kiosk', 'office', 'hotel', 'civic', 'restaurant']);
const BIG_BOX_CLASSES = new Set(['retail', 'commercial', 'supermarket']);

function parseMeters(value) {
  if (value === undefined || value === null) return NaN;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return NaN;
  const n = Number.parseFloat(raw.replace(/[a-z' ]+$/, ''));
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return /ft|'/.test(raw) ? n * 0.3048 : n;
}

/**
 * How one footprint is built. Pure; deterministic per footprint (seed).
 * Returns { kind, floors, floorH, roof, pitch, wall, band, shopFloor, office,
 *           wallTint, roofMat, roofTint, windows }.
 */
export function planBuilding(tags = {}, { area, seed, lat, lon, rectFill }) {
  const cls = String(tags.building || tags['building:part'] || 'yes').toLowerCase();
  const style = regionStyle(lat, lon);
  const r = (k) => hash01(seed, k);
  const material = String(tags['building:material'] || tags.material || '').toLowerCase();

  let kind = 'block';
  if (SHED_CLASSES.has(cls) || (cls === 'yes' && area < 40)) kind = 'shed';
  else if (INDUSTRIAL_CLASSES.has(cls) || (BIG_BOX_CLASSES.has(cls) && area > 2500)) kind = 'industrial';
  else if (HOUSE_CLASSES.has(cls) || (cls === 'yes' && area < 220)) kind = 'house';
  const hasShop = !!(tags.shop || (tags.amenity && ['restaurant', 'cafe', 'bank', 'pharmacy', 'fast_food', 'bar', 'pub'].includes(tags.amenity)));
  const isOffice = cls === 'office' || !!tags.office;

  const floorH = kind === 'industrial' ? 4.5 : (SHOP_CLASSES.has(cls) || isOffice ? 3.6 : 3.0);
  const explicitH = parseMeters(tags.height);
  const roofH = parseMeters(tags['roof:height']);
  const levels = Number.parseFloat(tags['building:levels'] ?? tags.levels);
  let floors;
  if (Number.isFinite(levels) && levels > 0) floors = Math.round(levels);
  else if (Number.isFinite(explicitH)) floors = Math.max(1, Math.round((explicitH - (Number.isFinite(roofH) ? roofH : 0)) / floorH));
  else if (kind === 'shed' || kind === 'industrial') floors = 1;
  else if (kind === 'house') floors = r('floors') < (area < 90 ? 0.75 : 0.35) ? 1 : 2;
  else if (cls === 'apartments') floors = 3 + Math.floor(r('floors') * 3);
  else if (BIG_BOX_CLASSES.has(cls)) floors = 1;
  else if (area < 400) floors = 1 + Math.floor(r('floors') * 2);
  else if (area < 2000) floors = 2 + Math.floor(r('floors') * 2);
  else floors = 3 + Math.floor(r('floors') * 3);
  floors = Math.max(1, Math.min(floors, 120));
  // Industrial halls: one tall storey, a hashed height when unmapped.
  const hallH = kind === 'industrial' ? 6 + 4 * r('hall') : null;
  let eaveH = hallH && floors === 1 && !Number.isFinite(explicitH) ? hallH : floors * floorH;
  if (Number.isFinite(explicitH)) eaveH = Math.max(2.4, explicitH - (Number.isFinite(roofH) ? roofH : 0));

  // Roof: tagged, else pitched for houses/sheds that are box-shaped enough.
  let roof = String(tags['roof:shape'] || '').toLowerCase();
  if (!['flat', 'gabled', 'hipped', 'pyramidal', 'skillion'].includes(roof)) {
    roof = (kind === 'house' || (kind === 'shed' && area > 12)) && rectFill >= RECT_FILL
      ? (r('hip') < style.hipped ? 'hipped' : 'gabled')
      : 'flat';
  }
  if (roof !== 'flat' && rectFill < RECT_FILL) roof = 'flat';
  if (roof === 'skillion') roof = 'gabled';
  if (roof === 'pyramidal') roof = 'hipped';
  const pitch = Number.parseFloat(tags['roof:angle']) || style.pitch;

  // Walls.
  let wall = null;      // a plain tileable (with laid-over windows for houses)
  let band = null;      // a window-sheet band (blocks)
  let office = false;
  if (kind === 'shed') wall = r('shed') < 0.6 ? 'siding' : 'panel';
  else if (kind === 'industrial') wall = r('ind') < 0.6 ? 'metalwall' : 'panel';
  else if (kind === 'house') {
    wall = pickShare(style.walls, r('wall'));
    if (material === 'brick') wall = 'brick';
    else if (material === 'wood') wall = 'siding';
    else if (['plaster', 'stucco', 'concrete'].includes(material)) wall = 'stucco';
    else if (['stone', 'sandstone', 'limestone'].includes(material)) wall = 'stone';
  } else {
    const glassTower = floors >= 20 || (isOffice && floors >= 7 && r('glass') < 0.45) || material === 'glass';
    if (glassTower) { office = true; band = r('ob') < 0.5 ? BAND_CURTAIN : BAND_OFFICE; } else {
      const brick = material === 'brick' || (material === '' && r('brick') < style.brick);
      band = brick ? BAND_BRICK : pick([BAND_SASH, BAND_PANEL, BAND_TALL, BAND_SASH], r('band'));
    }
  }
  const shopFloor = kind === 'block' && !office && (hasShop || SHOP_CLASSES.has(cls)) && floors >= 1;
  // the family's texture for this building
  const wallFamily = wall;
  if (wall && WALL_VARIANTS[wall]) wall = pickShare(WALL_VARIANTS[wall], r('variant'));

  const wallKey = office ? 'office' : (band ? 'facade' : wall);
  const tagged = parseColour(tags['building:colour'] || tags['building:color'] || tags.colour);
  const wallTint = tagged || pick(WALL_TINTS[wallKey] || [[1, 1, 1]], r('tint'));

  let roofMat = 'roofFlat';
  let roofTint;
  if (roof !== 'flat') {
    const [mat, idx] = kind === 'shed' && r('shedroof') < 0.5 ? pick([['roofMetal', [0, 1, 2, 3]], TIN], r('shedroofkind')) : pick(style.roofs, r('roofkind'));
    roofMat = mat;
    roofTint = ROOF_TINTS[mat][pick(idx, r('rooftint'))];
  } else if (kind === 'industrial' && r('indroof') < 0.4) {
    roofMat = 'roofMetal';
    roofTint = pick(ROOF_TINTS.roofMetal, r('rooftint'));
  } else {
    roofTint = pick(ROOF_TINTS.roofFlat, r('rooftint'));
  }
  const taggedRoof = parseColour(tags['roof:colour'] || tags['roof:color']);
  if (taggedRoof) roofTint = taggedRoof;

  const jitter = 1 + JITTER * (2 * r('jit') - 1);
  const shade = (c) => c.map((v) => Math.max(0, Math.min(1, v * jitter)));
  return {
    kind, cls, floors, floorH, eaveH, roof, pitch, wall, wallFamily, band, office, shopFloor,
    wallTint: shade(wallTint), roofMat, roofTint: shade(roofTint),
    windows: kind === 'house',
  };
}

// ── Mesh accumulation ────────────────────────────────────────────────────────

class MeshBuilder {
  constructor() {
    this.parts = new Map();   // material key -> { pos: [], uv: [], col: [] }
  }

  part(mat) {
    let p = this.parts.get(mat);
    if (!p) { p = { pos: [], uv: [], col: [] }; this.parts.set(mat, p); }
    return p;
  }

  tri(mat, a, b, c, ua, ub, uc, col) {
    const p = this.part(mat);
    p.pos.push(...a, ...b, ...c);
    p.uv.push(...ua, ...ub, ...uc);
    for (let i = 0; i < 3; i++) p.col.push(col[0], col[1], col[2]);
  }

  /** Quad a-b-c-d counter-clockwise seen from its front. */
  quad(mat, a, b, c, d, ua, ub, uc, ud, col) {
    this.tri(mat, a, b, c, ua, ub, uc, col);
    this.tri(mat, a, c, d, ua, uc, ud, col);
  }

  toMesh(name) {
    // Copy into preallocated typed arrays: spreading a whole neighbourhood's
    // vertices into push() overflows the call stack.
    let total = 0;
    for (const p of this.parts.values()) total += p.pos.length / 3;
    if (total === 0) return null;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    const col = new Float32Array(total * 3);
    const materials = [];
    let start = 0;
    for (const [mat, p] of this.parts) {
      const count = p.pos.length / 3;
      if (count === 0) continue;
      pos.set(p.pos, start * 3);
      uv.set(p.uv, start * 2);
      col.set(p.col, start * 3);
      geo.addGroup(start, count, materials.length);
      materials.push(new THREE.MeshStandardMaterial({ name: BUILDING_MATERIALS[mat], vertexColors: true }));
      start += count;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, materials);
    mesh.name = name;
    return mesh;
  }
}

// ── Walls ────────────────────────────────────────────────────────────────────

function wallStrip(m, mat, a, b, z0, z1, col, uvScale = SIDING_UV_M) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  m.quad(mat, [a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1],
    [0, z0 / uvScale], [L / uvScale, z0 / uvScale], [L / uvScale, z1 / uvScale], [0, z1 / uvScale], col);
}

function bandFloor(m, mat, band, a, b, z0, z1, col, seed, edge, floor) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const [, perSheet, allowed] = band;
  const bay = TILE_PX_M / perSheet;
  const nb = Math.round(L / bay);
  const [v0, v1] = bandV(band);
  if (nb < 1) {
    // a short wall: the plain strip at the sheet's left edge
    m.quad(mat, [a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1],
      [0, v0], [0.012, v0], [0.012, v1], [0, v1], col);
    return;
  }
  if (!allowed) {
    const u1 = nb / perSheet;
    m.quad(mat, [a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1],
      [0, v0], [u1, v0], [u1, v1], [0, v1], col);
    return;
  }
  for (let k = 0; k < nb; k++) {
    const t0 = k / nb; const t1 = (k + 1) / nb;
    const p = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
    const q = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
    const bayIdx = pick(allowed, hash01(seed, edge, floor, k));
    const u0 = bayIdx / perSheet; const u1 = (bayIdx + 1) / perSheet;
    m.quad(mat, [p[0], p[1], z0], [q[0], q[1], z0], [q[0], q[1], z1], [p[0], p[1], z1],
      [u0, v0], [u1, v0], [u1, v1], [u0, v1], col);
  }
}

function houseWindows(m, a, b, base, floors, floorH, zTop, winUv = WIN_UV) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const nb = Math.floor(L / HOUSE_BAY_M);
  if (nb < 1 || L < 2) return;
  const dx = (b[0] - a[0]) / L; const dy = (b[1] - a[1]) / L;
  const ox = dy * WIN_OUT_M; const oy = -dx * WIN_OUT_M;      // outward (ring is counter-clockwise)
  const [u0, u1, v0, v1] = winUv;
  const white = [1, 1, 1];
  for (let f = 0; f < floors; f++) {
    const zf = base + f * floorH + WIN_SILL;
    if (zf + WIN_H > zTop - 0.2) continue;
    for (let k = 0; k < nb; k++) {
      if (f === 0 && nb % 2 === 1 && k === (nb - 1) / 2) continue;   // where a front door would be
      const t = (k + 0.5) / nb;
      const cx = a[0] + (b[0] - a[0]) * t + ox; const cy = a[1] + (b[1] - a[1]) * t + oy;
      const p = [cx - dx * WIN_W / 2, cy - dy * WIN_W / 2];
      const q = [cx + dx * WIN_W / 2, cy + dy * WIN_W / 2];
      m.quad('facade', [p[0], p[1], zf], [q[0], q[1], zf], [q[0], q[1], zf + WIN_H], [p[0], p[1], zf + WIN_H],
        [u0, v0], [u1, v0], [u1, v1], [u0, v1], white);
    }
  }
}

// ── Roofs ────────────────────────────────────────────────────────────────────

function flatRoof(m, ring, holes, z, mat, col) {
  const contour = ring.map(([x, y]) => new THREE.Vector2(x, y));
  const holeVecs = holes.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y)));
  const tris = THREE.ShapeUtils.triangulateShape(contour, holeVecs);
  const all = [...ring, ...holes.flat()];
  for (const [i, j, k] of tris) {
    let a = all[i]; let b = all[j]; let c = all[k];
    if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0) [b, c] = [c, b];   // face up
    m.tri(mat, [a[0], a[1], z], [b[0], b[1], z], [c[0], c[1], z],
      [a[0] / ROOF_UV_M, a[1] / ROOF_UV_M], [b[0] / ROOF_UV_M, b[1] / ROOF_UV_M], [c[0] / ROOF_UV_M, c[1] / ROOF_UV_M], col);
  }
}

function pitchedRoof(m, box, z, plan, wallMat, wallUv) {
  const { cx, cy, ux, uy } = box;
  const vx = -uy; const vy = ux;
  const hl = box.length / 2 + ROOF_OVERHANG_M;
  const hw = box.width / 2 + ROOF_OVERHANG_M;
  const rise = Math.tan((plan.pitch * Math.PI) / 180) * (box.width / 2);
  const P = (u, v, h) => [cx + ux * u + vx * v, cy + uy * u + vy * v, z + h];
  const mat = plan.roofMat;
  const col = plan.roofTint;
  const slope = Math.hypot(hw, rise);
  const hip = plan.roof === 'hipped' ? Math.min(box.width / 2, hl * 0.95) : 0;
  const rl = hl - hip;                         // ridge half-length
  const eaveDrop = -ROOF_OVERHANG_M * Math.tan((plan.pitch * Math.PI) / 180);
  const uvR = (u, s) => [u / ROOF_UV_M, s / ROOF_UV_M];
  // two long slopes (trapezoids for hipped, rectangles for gabled)
  for (const side of [1, -1]) {
    const e0 = P(-hl, side * hw, eaveDrop); const e1 = P(hl, side * hw, eaveDrop);
    const r1 = P(rl, 0, rise); const r0 = P(-rl, 0, rise);
    const [a, b, c, d] = side > 0 ? [e1, e0, r0, r1] : [e0, e1, r1, r0];
    const [ua, ub, uc, ud] = side > 0
      ? [uvR(hl, 0), uvR(-hl, 0), uvR(-rl, slope), uvR(rl, slope)]
      : [uvR(-hl, 0), uvR(hl, 0), uvR(rl, slope), uvR(-rl, slope)];
    m.quad(mat, a, b, c, d, ua, ub, uc, ud, col);
  }
  if (plan.roof === 'hipped') {
    for (const end of [1, -1]) {
      const e0 = P(end * hl, -end * hw, eaveDrop); const e1 = P(end * hl, end * hw, eaveDrop); const r = P(end * rl, 0, rise);
      m.tri(mat, e0, e1, r, uvR(-hw, 0), uvR(hw, 0), uvR(0, slope), col);
    }
  }
  roofUnderside(m, P, { hl, hw, rl, rise, eaveDrop, hipped: plan.roof === 'hipped' });
  if (plan.roof !== 'hipped') {
    // gable ends in the wall material, flush with the walls' oriented box
    const gw = box.width / 2;
    for (const end of [1, -1]) {
      const l = box.length / 2;
      const a = P(end * l, -end * gw, 0); const b = P(end * l, end * gw, 0); const c = P(end * l, 0, rise);
      const L = box.width;
      m.tri(wallMat, a, b, c, [0, z / wallUv], [L / wallUv, z / wallUv], [L / 2 / wallUv, (z + rise) / wallUv], plan.wallTint);
    }
  }
}

// A quad in the soffit material, turned to face `want` (the slab's faces
// are built in whatever order, then turned outwards).
function facingQuad(m, a, b, c, d, want, uvs) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const [ua, ub, uc, ud] = uvs;
  if (n[0] * want[0] + n[1] * want[1] + n[2] * want[2] >= 0) m.quad('stucco', a, b, c, d, ua, ub, uc, ud, SOFFIT_TINT);
  else m.quad('stucco', a, d, c, b, ua, ud, uc, ub, SOFFIT_TINT);
}

/**
 * The underside and edges of a pitched roof (P: roof frame to world; u along
 * the ridge, v across it): every slope again ROOF_THICK_M under the tiles,
 * facing down, and fascia boards along the eaves and up the gable edges.
 */
function roofUnderside(m, P, { hl, hw, rl, rise, eaveDrop, hipped }) {
  const t = -ROOF_THICK_M;
  const D = (u, v, h) => P(u, v, h + t);
  const uv = (a, b) => [[0, 0], [a / SIDING_UV_M, 0], [a / SIDING_UV_M, b / SIDING_UV_M], [0, b / SIDING_UV_M]];
  const down = [0, 0, -1];
  const centre = P(0, 0, 0);
  const out = (p) => [p[0] - centre[0], p[1] - centre[1], 0];
  const slope = Math.hypot(hw, rise - eaveDrop);
  for (const side of [1, -1]) {
    // under the long slope
    facingQuad(m, D(-hl, side * hw, eaveDrop), D(hl, side * hw, eaveDrop), D(rl, 0, rise), D(-rl, 0, rise), down, uv(2 * hl, slope));
    // the eave's fascia
    const a = P(-hl, side * hw, eaveDrop); const b = P(hl, side * hw, eaveDrop);
    facingQuad(m, a, b, D(hl, side * hw, eaveDrop), D(-hl, side * hw, eaveDrop), out(P(0, side * hw, 0)), uv(2 * hl, ROOF_THICK_M));
  }
  for (const end of [1, -1]) {
    if (hipped) {
      // under the hip's end, its eave's fascia
      const e0 = D(end * hl, -end * hw, eaveDrop); const e1 = D(end * hl, end * hw, eaveDrop); const r = D(end * rl, 0, rise);
      const n = [e1[0] - e0[0], e1[1] - e0[1], e1[2] - e0[2]];
      const v = [r[0] - e0[0], r[1] - e0[1], r[2] - e0[2]];
      const nrm = [n[1] * v[2] - n[2] * v[1], n[2] * v[0] - n[0] * v[2], n[0] * v[1] - n[1] * v[0]];
      if (nrm[2] > 0) m.tri('stucco', e0, r, e1, [0, 0], [0.5, 1], [1, 0], SOFFIT_TINT);
      else m.tri('stucco', e0, e1, r, [0, 0], [1, 0], [0.5, 1], SOFFIT_TINT);
      const a = P(end * hl, -end * hw, eaveDrop); const b = P(end * hl, end * hw, eaveDrop);
      facingQuad(m, a, b, e1, e0, out(P(end * hl, 0, 0)), uv(2 * hw, ROOF_THICK_M));
    } else {
      // the gable's two rake fascias, eave to ridge
      for (const side of [1, -1]) {
        const a = P(end * hl, side * hw, eaveDrop); const b = P(end * hl, 0, rise);
        facingQuad(m, a, b, D(end * hl, 0, rise), D(end * hl, side * hw, eaveDrop), out(P(end * hl, 0, 0)), uv(slope, ROOF_THICK_M));
      }
    }
  }
}

// ── Public entry ─────────────────────────────────────────────────────────────

/**
 * Textured meshes for every OSM building feature.
 *
 * project(lat, lng) -> [x, y, groundZ] in BeamNG world metres (Z up).
 * Returns { meshes: THREE.Mesh[], count } — one mesh per ~MESH_BATCH
 * buildings so no single geometry grows unbounded.
 */
const MESH_BATCH = 400;

// BeamNG reads trailing digits of a Collada node name as its detail level
// (official shapes: *_a700, *_a160, Colmesh-1), so "buildings_1" + "buildings_2"
// made the whole shape "invalid detail levels" and nothing rendered. Batch
// names use letters: buildings_a, buildings_b, ... buildings_aa.
export function letterName(index) {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}
const MAX_AREA_M2 = 50000;

// ── Multi-storey car parks ───────────────────────────────────────────────────
// OSM building=parking, or a building with amenity=parking +
// parking=multi-storey: no reusable garage ships with BeamNG (its levels'
// garages are one-off site meshes), so one is built here: open concrete
// decks GARAGE_FLOOR_M apart on perimeter columns, parapets round the upper
// decks, and two ramp lanes along one long side climbing in turn, +u then
// -u, so each deck's ramp starts where the last one landed (a drivable
// helix). All of it is in the buildings' collision mesh.
const GARAGE_FLOOR_M = 3.0;
const GARAGE_SLAB_M = 0.3;
const GARAGE_PARAPET_M = 1.0;
const GARAGE_LANE_M = 3.6;
const GARAGE_INSET_M = 1.0;      // (clear of the perimeter columns)
const GARAGE_COLUMN_M = 0.5;
const GARAGE_COLUMN_STEP_M = 8;
const GARAGE_RAMP_WALL_M = 0.9;
const GARAGE_RAMP_EASE_M = 3;
const GARAGE_BAY_W = 2.5;
const GARAGE_BAY_L = 5.5;
const GARAGE_AISLE_M = 6.5;
const GARAGE_LINE_W = 0.12;
const GARAGE_LIGHT_STEP_M = 9;
const DECK_TINT = [0.58, 0.58, 0.57];
const DECK_TOP_MAT = 'roofFlat';
const DECK_TOP_TINT = [0.95, 0.92, 0.86];
const LINE_TINT = [1, 1, 1];

/** Whether an OSM feature is a multi-storey car park. */
export function isGarageFeature(feature) {
  const t = feature?.tags || {};
  if (!t.building) return false;
  if (t.building === 'parking') return true;
  return t.amenity === 'parking' && t.parking === 'multi-storey';
}

function garageLevels(tags) {
  const lv = Number.parseInt(tags['parking:levels'] ?? tags['building:levels'], 10);
  if (Number.isFinite(lv) && lv > 0) return Math.max(2, Math.min(12, lv));
  const h = parseMeters(tags.height);
  if (Number.isFinite(h)) return Math.max(2, Math.min(12, Math.round(h / GARAGE_FLOOR_M)));
  return 4;
}

/**
 * The garage's layout in its oriented box, or null when the footprint is too
 * small or too irregular to hold the ramps (it is built as a plain building).
 */
export function planGarage(ring, tags = {}) {
  const box = orientedBox(ring);
  if (!box) return null;
  const area = Math.abs(signedArea(ring));
  if (box.length < 30 || box.width < 14 || area / box.area < 0.8) return null;
  const rampLen = Math.max(16, Math.min(26, box.length - 14));
  const levels = garageLevels(tags);
  // the lanes run along the box's -v side, inset from its edge
  const v0 = -box.width / 2 + GARAGE_INSET_M;
  return { box, levels, rampLen, a: -rampLen / 2, b: rampLen / 2, laneV: [v0, v0 + GARAGE_LANE_M, v0 + 2 * GARAGE_LANE_M] };
}

/**
 * The bays of every deck: rows along the long side between the ramp lanes
 * and the far parapet (bays, aisle, bays back to back, ...), clear of the
 * cross-aisles at both ends. [{ u, v, du (+1: the car's nose toward +v),
 * row }] in the garage's box frame; the same on every deck.
 */
export function garageBays(g, ring) {
  const { box, laneV } = g;
  const vS = laneV[2]; const vE = box.width / 2 - 0.8;
  const uS = -box.length / 2 + 0.8 + GARAGE_AISLE_M; const uE = box.length / 2 - 0.8 - GARAGE_AISLE_M;
  const rows = [];
  let v = vE; let pending = 'row'; let id = 0;
  // from the far parapet in: a row against it, an aisle, two rows back to
  // back, an aisle, ... (a row's cars nose toward its back: the parapet or
  // the other row)
  while (v - vS >= GARAGE_BAY_L) {
    if (pending === 'aisle') {
      if (v - vS < GARAGE_AISLE_M + GARAGE_BAY_L) break;
      v -= GARAGE_AISLE_M; pending = 'row2'; continue;
    }
    // (against the parapet: nose to +v; after an aisle: nose away from it, to -v)
    rows.push({ v0: v - GARAGE_BAY_L, v1: v, nose: pending === 'row2' ? -1 : +1, id: id++ });
    v -= GARAGE_BAY_L;
    if (pending === 'row2' && v - vS >= GARAGE_BAY_L) { rows.push({ v0: v - GARAGE_BAY_L, v1: v, nose: +1, id: id++ }); v -= GARAGE_BAY_L; }
    pending = 'aisle';
  }
  const { cx, cy, ux, uy } = box;
  const vx = -uy; const vy = ux;
  const P = (u, w) => [cx + ux * u + vx * w, cy + uy * u + vy * w];
  const inside = (u, w) => inRingXY(...P(u, w), ring);
  const n = Math.floor((uE - uS) / GARAGE_BAY_W);
  const start = (uS + uE) / 2 - (n * GARAGE_BAY_W) / 2;
  const bays = [];
  for (const r of rows) {
    for (let k = 0; k < n; k++) {
      const u0 = start + k * GARAGE_BAY_W; const u1 = u0 + GARAGE_BAY_W;
      if (![[u0, r.v0], [u1, r.v0], [u1, r.v1], [u0, r.v1]].every(([a, b]) => inside(a, b))) continue;
      bays.push({ u: (u0 + u1) / 2, v: (r.v0 + r.v1) / 2, u0, u1, v0: r.v0, v1: r.v1, nose: r.nose, row: r.id, k });
    }
  }
  return { bays, rows, start, n };
}

function inRingXY(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Parking spots and ceiling lights of the multi-storey car parks, for the
 * level (city.sites.json, PointLights): { spots: [{ x, y, z, yaw }], lights:
 * [{ x, y, z }] }. project(lat, lng) -> [x, y, ground z].
 */
export function garageExtras(features, project) {
  const spots = []; const lights = [];
  for (const f of features || []) {
    if (f?.type !== 'building' || !isGarageFeature(f) || !(f.geometry?.length >= 3)) continue;
    const projected = f.geometry.map((p) => project(p.lat, p.lng));
    let ring = cleanRing(projected.map(([x, y]) => [x, y]));
    if (ring.length < 3) continue;
    if (signedArea(ring) < 0) ring = ring.reverse();
    const g = planGarage(ring, f.tags || {});
    if (!g) continue;
    const base = Math.max(...projected.map((p) => p[2]).filter(Number.isFinite));
    if (!Number.isFinite(base)) continue;
    const { cx, cy, ux, uy } = g.box;
    const vx = -uy; const vy = ux;
    const P = (u, w) => [cx + ux * u + vx * w, cy + uy * u + vy * w];
    const { bays } = garageBays(g, ring);
    for (let k = 0; k < g.levels; k++) {
      const z = base + k * GARAGE_FLOOR_M;
      for (const b of bays) {
        const [x, y] = P(b.u, b.v);
        // local Y (the car's length) along the bay's depth, nose toward its back
        const dx = vx * b.nose; const dy = vy * b.nose;
        spots.push({ x, y, z, yaw: Math.atan2(-dx, dy), w: GARAGE_BAY_W, l: GARAGE_BAY_L });
      }
    }
    // ceiling lights under every covered deck, on a grid clear of the ramp lanes
    const nu = Math.max(1, Math.floor(g.box.length / GARAGE_LIGHT_STEP_M));
    const nv = Math.max(1, Math.floor((g.box.width / 2 - g.laneV[2]) / GARAGE_LIGHT_STEP_M));
    for (let k = 0; k < g.levels - 1; k++) {
      const z = base + (k + 1) * GARAGE_FLOOR_M - GARAGE_SLAB_M - 0.15;
      for (let i = 0; i < nu; i++) {
        for (let j = 0; j < nv; j++) {
          const u = -g.box.length / 2 + (i + 0.5) * (g.box.length / nu);
          const w = g.laneV[2] + (j + 0.5) * ((g.box.width / 2 - g.laneV[2]) / nv);
          const [x, y] = P(u, w);
          if (inRingXY(x, y, ring)) lights.push({ x, y, z });
        }
      }
    }
  }
  return { spots, lights };
}

const downTri = (m, mat, a, b, c, col) => m.tri(mat, a, c, b, [a[0] / ROOF_UV_M, a[1] / ROOF_UV_M], [c[0] / ROOF_UV_M, c[1] / ROOF_UV_M], [b[0] / ROOF_UV_M, b[1] / ROOF_UV_M], col);

// (the driving surface matte: the concrete sheet mirrored the sky blue)
function slabFaces(m, ring, holes, z, mat, col) {
  flatRoof(m, ring, holes, z, DECK_TOP_MAT, DECK_TOP_TINT);
  // underside
  const contour = ring.map(([x, y]) => new THREE.Vector2(x, y));
  const holeVecs = holes.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y)));
  const all = [...ring, ...holes.flat()];
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, holeVecs)) {
    let a = all[i]; let b = all[j]; let c = all[k];
    if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0) [b, c] = [c, b];
    downTri(m, mat, [a[0], a[1], z - GARAGE_SLAB_M], [b[0], b[1], z - GARAGE_SLAB_M], [c[0], c[1], z - GARAGE_SLAB_M], col);
  }
  // edges (ring counter-clockwise: outward faces; holes clockwise: into the hole)
  for (const r of [ring, ...holes]) {
    for (let i = 0; i < r.length; i++) wallStrip(m, mat, r[i], r[(i + 1) % r.length], z - GARAGE_SLAB_M, z, col);
  }
}

// a wall both faces (a parapet seen from the deck and from the street)
function wallBoth(m, mat, a, b, z0, z1, col) {
  wallStrip(m, mat, a, b, z0, z1, col);
  wallStrip(m, mat, b, a, z0, z1, col);
}

function columnBox(m, mat, x, y, ux, uy, z0, z1, col) {
  const h = GARAGE_COLUMN_M / 2;
  const vx = -uy; const vy = ux;
  const c = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([p, q]) => [x + ux * p + vx * q, y + uy * p + vy * q]);
  for (let i = 0; i < 4; i++) wallStrip(m, mat, c[i], c[(i + 1) % 4], z0, z1, col);
}

/** Builds one garage into the mesh builder. Returns the deck count. */
function buildGarage(m, ring, holes, base, z0, g) {
  const { box, levels, a, b, laneV } = g;
  const { cx, cy, ux, uy } = box;
  const vx = -uy; const vy = ux;
  const P = (u, v) => [cx + ux * u + vx * v, cy + uy * u + vy * v];
  const grey = [0.82, 0.82, 0.8];
  const deckTint = DECK_TINT;
  const { bays, rows } = garageBays(g, ring);
  const zOf = (k) => base + k * GARAGE_FLOOR_M;
  // lane j (ramp from deck j to j + 1): A (laneV 0-1) going +u when j is even,
  // B (laneV 1-2) going -u when odd
  const lane = (j) => (j % 2 === 0 ? [laneV[0], laneV[1]] : [laneV[1], laneV[2]]);
  const rectHole = (v1, v2) => {
    const r = [P(a, v1), P(b, v1), P(b, v2), P(a, v2)];
    return signedArea(r) > 0 ? r.slice().reverse() : r;
  };

  // ground deck: the footprint at the highest ground, its sides down past the lowest
  slabFaces(m, ring, holes, base, 'concrete', deckTint);
  for (let i = 0; i < ring.length; i++) wallStrip(m, 'concrete', ring[i], ring[(i + 1) % ring.length], z0, base - GARAGE_SLAB_M, grey);

  for (let k = 1; k < levels; k++) {
    const z = zOf(k);
    // the deck, open over the ramp lanes arriving (k - 1) and leaving (k)
    const lanes = [lane(k - 1), ...(k < levels - 1 ? [lane(k)] : [])];
    const v1 = Math.min(...lanes.map((l) => l[0])); const v2 = Math.max(...lanes.map((l) => l[1]));
    slabFaces(m, ring, [...holes, rectHole(v1, v2)], z, 'concrete', deckTint);
    // parapet round the deck
    for (let i = 0; i < ring.length; i++) wallBoth(m, 'concrete', ring[i], ring[(i + 1) % ring.length], z, z + GARAGE_PARAPET_M, grey);
  }

  // perimeter columns between the decks, just inside the outline
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]; const q = ring[(i + 1) % ring.length];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (L < 1) continue;
    const ex = (q[0] - p[0]) / L; const ey = (q[1] - p[1]) / L;
    const nx = -ey; const ny = ex;       // inward (counter-clockwise ring)
    const n = Math.max(1, Math.round(L / GARAGE_COLUMN_STEP_M));
    for (let s = 0; s < n; s++) {
      const t = (s + 0.5) / n * L;
      const x = p[0] + ex * t + nx * (GARAGE_COLUMN_M / 2 + 0.1); const y = p[1] + ey * t + ny * (GARAGE_COLUMN_M / 2 + 0.1);
      for (let k = 0; k < levels - 1; k++) columnBox(m, 'concrete', x, y, ex, ey, zOf(k), zOf(k + 1) - GARAGE_SLAB_M, grey);
    }
  }

  // stall lines on every deck (paint as thin quads just over the slab: one
  // decal would project onto every deck under it) and a column line where
  // two rows meet back to back, every third bay
  const lineQuad = (u, w0, w1, z) => {
    const h = GARAGE_LINE_W / 2;
    const q = [P(u - h, w0), P(u + h, w0), P(u + h, w1), P(u - h, w1)];
    const pts = q.map(([x, y]) => [x, y, z]);
    const nz = (pts[1][0] - pts[0][0]) * (pts[3][1] - pts[0][1]) - (pts[1][1] - pts[0][1]) * (pts[3][0] - pts[0][0]);
    if (nz > 0) m.quad('stucco', pts[0], pts[1], pts[2], pts[3], [0, 0], [0.05, 0], [0.05, 1], [0, 1], LINE_TINT);
    else m.quad('stucco', pts[0], pts[3], pts[2], pts[1], [0, 0], [0, 1], [0.05, 1], [0.05, 0], LINE_TINT);
  };
  const seenLine = new Set();
  for (const bay of bays) {
    for (const u of [bay.u0, bay.u1]) {
      const key = `${bay.row}:${u.toFixed(2)}`;
      if (seenLine.has(key)) continue;
      seenLine.add(key);
      for (let k = 0; k < levels; k++) lineQuad(u, bay.v0, bay.v1, zOf(k) + 0.012);
    }
  }
  for (let r = 0; r + 1 < rows.length; r++) {
    if (Math.abs(rows[r].v0 - rows[r + 1].v1) > 0.01) continue;   // back to back
    const w = rows[r].v0;
    const us = [...new Set(bays.filter((b) => b.row === rows[r].id && b.k % 3 === 0).map((b) => b.u0))];
    for (const u of us) {
      const [x, y] = P(u, w);
      for (let k = 0; k < levels - 1; k++) columnBox(m, 'concrete', x, y, ux, uy, zOf(k), zOf(k + 1) - GARAGE_SLAB_M, grey);
    }
  }

  // the ramps: a sloped slab per lane with a low wall each side, easing in
  // and out (the slope rises from 0 over GARAGE_RAMP_EASE_M at each end, so
  // a car meets both decks flat instead of a kink)
  const len = Math.abs(b - a);
  const e = Math.min(0.3, GARAGE_RAMP_EASE_M / len);
  const sMax = 1 / (1 - e);
  const rise = (t) => (t < e ? sMax * t * t / (2 * e)
    : t > 1 - e ? 1 - sMax * (1 - t) * (1 - t) / (2 * e)
      : sMax * e / 2 + sMax * (t - e));
  const ts = [0, e / 3, (2 * e) / 3, e, 1 - e, 1 - (2 * e) / 3, 1 - e / 3, 1];
  const d = GARAGE_SLAB_M;
  for (let j = 0; j < levels - 1; j++) {
    const [w1, w2] = lane(j);
    const up = j % 2 === 0;
    const uLo = up ? a : b; const uHi = up ? b : a;
    const zLo = zOf(j); const zHi = zOf(j + 1);
    for (let i = 0; i + 1 < ts.length; i++) {
      const tA = ts[i]; const tB = ts[i + 1];
      const uA = uLo + (uHi - uLo) * tA; const uB = uLo + (uHi - uLo) * tB;
      const zA = zLo + (zHi - zLo) * rise(tA); const zB = zLo + (zHi - zLo) * rise(tB);
      const p1 = P(uA, w1); const p2 = P(uA, w2); const p3 = P(uB, w2); const p4 = P(uB, w1);
      const t1 = [p1[0], p1[1], zA]; const t2 = [p2[0], p2[1], zA]; const t3 = [p3[0], p3[1], zB]; const t4 = [p4[0], p4[1], zB];
      const L = Math.abs(uB - uA) / ROOF_UV_M; const L0 = Math.abs(uA - uLo) / ROOF_UV_M;
      const uv = [[L0, w1 / ROOF_UV_M], [L0, w2 / ROOF_UV_M], [L0 + L, w2 / ROOF_UV_M], [L0 + L, w1 / ROOF_UV_M]];
      // top face up, whichever way the lane runs
      const nz = (t2[0] - t1[0]) * (t4[1] - t1[1]) - (t2[1] - t1[1]) * (t4[0] - t1[0]);
      if (nz > 0) m.quad(DECK_TOP_MAT, t1, t2, t3, t4, uv[0], uv[1], uv[2], uv[3], DECK_TOP_TINT);
      else m.quad(DECK_TOP_MAT, t1, t4, t3, t2, uv[0], uv[3], uv[2], uv[1], DECK_TOP_TINT);
      const b1 = [t1[0], t1[1], zA - d]; const b2 = [t2[0], t2[1], zA - d]; const b3 = [t3[0], t3[1], zB - d]; const b4 = [t4[0], t4[1], zB - d];
      if (nz > 0) m.quad('concrete', b1, b4, b3, b2, uv[0], uv[3], uv[2], uv[1], deckTint);
      else m.quad('concrete', b1, b2, b3, b4, uv[0], uv[1], uv[2], uv[3], deckTint);
      // side walls (both faces), following the ramp
      for (const [s0, s1] of [[t1, t4], [t2, t3]]) {
        const w = GARAGE_RAMP_WALL_M;
        const q0 = [s0[0], s0[1], s0[2] - d]; const q1 = [s1[0], s1[1], s1[2] - d];
        const r0 = [s0[0], s0[1], s0[2] + w]; const r1 = [s1[0], s1[1], s1[2] + w];
        const L2 = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) / SIDING_UV_M;
        m.quad('concrete', q0, q1, r1, r0, [0, 0], [L2, 0], [L2, 0.4], [0, 0.4], grey);
        m.quad('concrete', q1, q0, r0, r1, [0, 0], [L2, 0], [L2, 0.4], [0, 0.4], grey);
      }
    }
  }
  return levels;
}

export function buildTexturedBuildings(features, project, { maxBuildings = 20000 } = {}) {
  const meshes = [];
  let builder = new MeshBuilder();
  let inBatch = 0;
  let count = 0;
  // For the export report: why footprints were left out, and what was built.
  const stats = {
    footprints: 0,
    skipped: { badGeometry: 0, tiny: 0, oversize: 0, noGround: 0, overCap: 0 },
    kinds: {}, classes: {}, roofs: {}, walls: {},
    floors: { min: Infinity, max: 0, sum: 0 }, height: { min: Infinity, max: 0, sum: 0 },
    groundSpread: { max: 0, over3m: 0 },
    shopFronts: 0, offices: 0, withHoles: 0,
  };
  const bump = (map, key) => { map[key] = (map[key] || 0) + 1; };

  const flush = () => {
    const mesh = builder.toMesh(`buildings_${letterName(meshes.length)}`);
    if (mesh) meshes.push(mesh);
    builder = new MeshBuilder();
    inBatch = 0;
  };

  for (const f of features) {
    if (f?.type !== 'building') continue;
    stats.footprints++;
    if (count >= maxBuildings) { stats.skipped.overCap++; continue; }
    if (!Array.isArray(f.geometry) || f.geometry.length < 3) { stats.skipped.badGeometry++; continue; }
    const projected = f.geometry.map((p) => project(p.lat, p.lng));
    let ring = cleanRing(projected.map(([x, y]) => [x, y]));
    if (ring.length < 3) { stats.skipped.badGeometry++; continue; }
    let area = signedArea(ring);
    if (area < 0) { ring = ring.reverse(); area = -area; }
    if (area < 4) { stats.skipped.tiny++; continue; }
    const tags = f.tags || {};
    if (area > MAX_AREA_M2 && !INDUSTRIAL_CLASSES.has(tags.building) && !BIG_BOX_CLASSES.has(tags.building)) { stats.skipped.oversize++; continue; }
    const holes = (f.holes || []).map((h) => {
      let hr = cleanRing(h.map((p) => project(p.lat, p.lng)).map(([x, y]) => [x, y]));
      if (hr.length >= 3 && signedArea(hr) > 0) hr = hr.reverse();
      return hr;
    }).filter((h) => h.length >= 3);

    const grounds = projected.map((p) => p[2]).filter(Number.isFinite);
    if (grounds.length === 0) { stats.skipped.noGround++; continue; }
    const zMin = Math.min(...grounds);
    const zMax = Math.max(...grounds);
    const c = f.geometry[0];
    const seed = `${f.id}:${c.lat.toFixed(6)}:${c.lng.toFixed(6)}`;
    // a multi-storey car park: decks and ramps (else, too small or odd for
    // ramps, a plain building)
    const garage = isGarageFeature(f) ? planGarage(ring, tags) : null;
    if (garage) {
      buildGarage(builder, ring, holes, zMax, zMin - FOUNDATION_M, garage);
      stats.garages = (stats.garages || 0) + 1;
      bump(stats.kinds, 'garage');
      count++;
      if (++inBatch >= MESH_BATCH) flush();
      continue;
    }
    const box = orientedBox(ring);
    const rectFill = box && box.area > 0 ? area / box.area : 0;
    const plan = planBuilding(tags, { area, seed, lat: c.lat, lon: c.lng, rectFill });

    const base = zMax;
    const z0 = zMin - FOUNDATION_M;
    const eave = base + plan.eaveH;
    // (no wooden plinth: concrete under wood)
    const plinthMat = plan.wall && plan.wallFamily !== 'siding' ? plan.wall : 'panel';
    const plinthTint = plan.wall && plan.wallFamily !== 'siding' ? plan.wallTint : [0.8, 0.8, 0.8];

    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]; const b = ring[(i + 1) % ring.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.05) continue;
      // below the floors: a plain plinth down past the lowest ground
      wallStrip(builder, plinthMat, a, b, z0, base, plinthTint);
      if (plan.band || plan.office) {
        const sheetMat = plan.office ? 'office' : 'facade';
        for (let fl = 0; fl < plan.floors; fl++) {
          const zb = base + fl * plan.floorH;
          const zt = fl === plan.floors - 1 ? eave : base + (fl + 1) * plan.floorH;
          if (fl === 0 && plan.shopFloor) bandFloor(builder, 'shop', BAND_SHOP, a, b, zb, zt, [1, 1, 1], seed, i, fl);
          else bandFloor(builder, sheetMat, plan.band, a, b, zb, zt, plan.wallTint, seed, i, fl);
        }
      } else {
        wallStrip(builder, plan.wall, a, b, base, eave, plan.wallTint);
        if (plan.windows) houseWindows(builder, a, b, base, plan.floors, plan.floorH, eave, hash01(seed, 'lit') < HOUSE_LIT_SHARE ? WIN_UV : WIN_UV_DARK);
      }
    }
    for (const hole of holes) {
      for (let i = 0; i < hole.length; i++) {
        wallStrip(builder, plinthMat, hole[i], hole[(i + 1) % hole.length], z0, eave, plinthTint);
      }
    }

    if (plan.roof === 'flat' || !box) {
      flatRoof(builder, ring, holes, eave, plan.roofMat, plan.roofTint);
    } else {
      const wallMat = plan.wall || 'stucco';
      pitchedRoof(builder, box, eave, plan, wallMat, SIDING_UV_M);
    }

    count++;
    bump(stats.kinds, plan.kind);
    bump(stats.classes, plan.cls);
    bump(stats.roofs, plan.roof === 'flat' || !box ? 'flat' : plan.roof);
    bump(stats.walls, plan.band || plan.office ? (plan.office ? 'office' : 'facade') : plan.wall);
    for (const [acc, v] of [[stats.floors, plan.floors], [stats.height, plan.eaveH]]) {
      acc.min = Math.min(acc.min, v); acc.max = Math.max(acc.max, v); acc.sum += v;
    }
    stats.groundSpread.max = Math.max(stats.groundSpread.max, zMax - zMin);
    if (zMax - zMin > 3) stats.groundSpread.over3m++;
    if (plan.shopFloor) stats.shopFronts++;
    if (plan.office) stats.offices++;
    if (holes.length) stats.withHoles++;
    if (++inBatch >= MESH_BATCH) flush();
  }
  flush();
  return { meshes, count, stats };
}
