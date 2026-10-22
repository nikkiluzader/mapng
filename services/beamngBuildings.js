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
};

const MATERIAL_STAGES = {
  facade: pbr(`${TRIM}/plaster/t_highrise_plaster`, 't_highrise_plaster', { emissive: true, metallic: true }),
  shop: pbr(`${TRIM}/metal/t_highrise_metal`, 't_highrise_metal', { metallic: true }),
  office: {
    ...pbr(`${TRIM}/metal/t_highrise_metal`, 't_highrise_metal', { metallic: true }),
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
};

/** BeamNG material definitions for every name in BUILDING_MATERIALS. */
export function getBuildingMaterialDefs() {
  const defs = {};
  for (const [key, name] of Object.entries(BUILDING_MATERIALS)) {
    defs[name] = {
      name,
      mapTo: name,
      class: 'Material',
      version: 1.5,
      annotation: 'BUILDINGS',
      Stages: [{ ...MATERIAL_STAGES[key], vertColor: true }, {}, {}, {}],
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
const WIN_W = 1.05;
const WIN_H = 1.75;
const WIN_SILL = 0.85;
const HOUSE_BAY_M = 3.4;
const WIN_OUT_M = 0.03;
const FOUNDATION_M = 0.6;
const ROOF_OVERHANG_M = 0.35;
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

const US_ROOFS = [['roofSlate', [0, 1, 2, 3]], ['roofShingle', [0, 1, 2, 3]]];
const CLAY = ['roofSlate', [4, 5, 6]];
const DARK = ['roofSlate', [7, 8, 9]];
const REGIONS = {
  us_east: { brick: 0.75, walls: [['siding', 0.75], ['brick', 0.25]], hipped: 0.4, roofs: US_ROOFS, pitch: 32 },
  us_south: { brick: 0.35, walls: [['siding', 0.75], ['brick', 0.25]], hipped: 0.4, roofs: US_ROOFS, pitch: 30 },
  us_plains: { brick: 0.15, walls: [['siding', 0.8], ['brick', 0.2]], hipped: 0.4, roofs: US_ROOFS, pitch: 30 },
  us_west: { brick: 0.15, walls: [['stucco', 0.65], ['siding', 0.25], ['brick', 0.1]], hipped: 0.5, roofs: US_ROOFS, pitch: 24 },
  alpine: { brick: 0.05, walls: [['siding', 0.45], ['stucco', 0.55]], hipped: 0.15, roofs: [DARK, ['roofSlate', [9, 5]]], pitch: 24 },
  europe_north: { brick: 0.5, walls: [['brick', 0.45], ['stucco', 0.55]], hipped: 0.3, roofs: [CLAY, DARK], pitch: 42 },
  nordic: { brick: 0.12, walls: [['siding', 0.65], ['stucco', 0.35]], hipped: 0.2, roofs: [DARK, CLAY], pitch: 35 },
  mediterranean: { brick: 0.08, walls: [['stucco', 0.85], ['stone', 0.15]], hipped: 0.5, roofs: [CLAY], pitch: 22 },
  latin_america: { brick: 0.15, walls: [['stucco', 0.8], ['brick', 0.2]], hipped: 0.3, roofs: [CLAY, ['roofMetal', [0, 1]]], pitch: 20 },
  east_asia: { brick: 0.1, walls: [['stucco', 0.6], ['panel', 0.4]], hipped: 0.5, roofs: [DARK, ['roofMetal', [0, 4]]], pitch: 25 },
  oceania: { brick: 0.35, walls: [['brick', 0.4], ['siding', 0.3], ['stucco', 0.3]], hipped: 0.7, roofs: [['roofMetal', [0, 1, 4]], CLAY], pitch: 24 },
  cool: { brick: 0.3, walls: [['siding', 0.5], ['brick', 0.3], ['stucco', 0.2]], hipped: 0.3, roofs: [DARK, ['roofMetal', [0, 1]]], pitch: 35 },
  warm: { brick: 0.15, walls: [['stucco', 0.8], ['brick', 0.2]], hipped: 0.4, roofs: [CLAY, ['roofMetal', [0, 1, 3]]], pitch: 22 },
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
const ROOF_TINTS = {
  roofFlat: [[0.85, 0.85, 0.85], [0.62, 0.62, 0.64], [0.95, 0.93, 0.88], [0.45, 0.45, 0.46], [0.75, 0.7, 0.64]],
  roofSlate: [[1, 1, 1], [0.8, 0.66, 0.56], [0.76, 0.8, 0.9], [0.62, 0.62, 0.62], [0.95, 0.52, 0.36], [0.78, 0.4, 0.3], [1, 0.66, 0.46], [0.42, 0.43, 0.46], [0.3, 0.31, 0.33], [0.48, 0.38, 0.32]],
  roofShingle: [[0.75, 0.72, 0.7], [0.55, 0.5, 0.48], [0.7, 0.56, 0.48], [0.62, 0.66, 0.72], [0.95, 0.52, 0.36], [0.78, 0.4, 0.3], [0.42, 0.43, 0.46], [0.36, 0.42, 0.52]],
  roofMetal: [[0.85, 0.86, 0.88], [0.55, 0.57, 0.6], [0.45, 0.58, 0.48], [0.62, 0.3, 0.26], [0.4, 0.42, 0.48]],
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

  const wallKey = office ? 'office' : (band ? 'facade' : wall);
  const tagged = parseColour(tags['building:colour'] || tags['building:color'] || tags.colour);
  const wallTint = tagged || pick(WALL_TINTS[wallKey] || [[1, 1, 1]], r('tint'));

  let roofMat = 'roofFlat';
  let roofTint;
  if (roof !== 'flat') {
    const [mat, idx] = kind === 'shed' && r('shedroof') < 0.5 ? ['roofMetal', [0, 1, 2, 3]] : pick(style.roofs, r('roofkind'));
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
    kind, cls, floors, floorH, eaveH, roof, pitch, wall, band, office, shopFloor,
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

function houseWindows(m, a, b, base, floors, floorH, zTop) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const nb = Math.floor(L / HOUSE_BAY_M);
  if (nb < 1 || L < 2) return;
  const dx = (b[0] - a[0]) / L; const dy = (b[1] - a[1]) / L;
  const ox = dy * WIN_OUT_M; const oy = -dx * WIN_OUT_M;      // outward (ring is counter-clockwise)
  const [u0, u1, v0, v1] = WIN_UV;
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
  } else {
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
    const box = orientedBox(ring);
    const rectFill = box && box.area > 0 ? area / box.area : 0;
    const plan = planBuilding(tags, { area, seed, lat: c.lat, lon: c.lng, rectFill });

    const base = zMax;
    const z0 = zMin - FOUNDATION_M;
    const eave = base + plan.eaveH;
    const plinthMat = plan.wall && plan.wall !== 'siding' ? plan.wall : 'panel';
    const plinthTint = plan.wall && plan.wall !== 'siding' ? plan.wallTint : [0.8, 0.8, 0.8];

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
        if (plan.windows) houseWindows(builder, a, b, base, plan.floors, plan.floorH, eave);
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
