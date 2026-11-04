// Raised sidewalks with curbs (plan R5), the way West Coast USA and
// BeamNG.Earth build them: no MeshRoads, but a curb-and-slab profile swept
// along each sidewalk run into one mesh per batch, textured from the shared
// `curbs` trim sheet (light band = curb top/nose, dark = face) and the
// `sidewalk1` slab sheet, colliding with its visible geometry.
//
// Runs follow the drawn carriageway's edge (generateDecalRoads exposes the
// carriageways) and are cut where they would cross another road or a
// crosswalk. A street's sidewalks are decided along the whole street, not per
// OSM way (an untagged piece takes them from the tagged pieces it continues).
// Where two sidewalks meet at a junction corner they are joined by a curb
// return (BeamNG.Earth's server/junctions.py: an arc tangent to both curb
// lines, a slab out to where the sidewalks' outer edges meet); every other
// end comes down to the road in a curb ramp. Profile numbers are
// BeamNG.Earth's (server/sidewalks.py), measured on official US curbs.

import * as THREE from 'three';
import polygonClipping from './polyClip.js';
import { parallelMap, parallelThreads } from './parallel.js';
import {
  SLAB_TILE_M, PANEL_SCRAP_M2, PANEL_TRI_FLOATS, LEVEL_REACH_CELLS, ringArea, pointInRing, ringTouches,
  stripUv, makeCropper, makeCutFinder, makeLevelFinder, stripPanels, panelsForItem,
  unionTile, unionTiles as unionTilesLocal,
} from './sidewalkPanels.js';
import { buildCarriagewayIndex, carriagewaysAt, cutNodes, isInZone, isOnOtherCarriageway } from './roadMarkingCuts.js';
import { isOneWayRoad } from './roadWidth.js';
import { PLAZA_MATERIAL, plazaTileM, pavedWalkSurface } from './plazas.js';
import { smoothLine } from './lineSmoothing.js';

const CURB_H = 0.15;          // m above the road
const SINK = 0.10;            // m the faces reach below the road
const BATTER = 0.02;          // m the face leans back over its height
const NOSE = 0.025;           // bevelled nose: down from the top ...
const NOSE_W = 0.045;         // ... and in from the face
const CURB_W = 0.15;          // m of curb top band
const CROSS_SLOPE = 0.015;    // slab rises away from the road
const BACK_SLOPE_RUN = 2.0;   // back falls to the ground at 1:2, no wheel-catching ledge
const CURB_REPEAT_M = 9.0;    // m of curb per texture width
// The slab's look: one of the game's own concrete sheets, each with its
// repeat in metres (along, across) so its panels come out about 1.5 m square
// (sidewalk1, a 4096 × 1024 sheet of 20 × 5 panels, mapped square drew them
// as 0.5 × 2 m strips, its stains stretched across the walk).
const ECA_SIDEWALKS = '/assets/materials/baked_props/eca_bld_sidewalks';
const GM_TILES = '/assets/materials/tileable/concrete/m_gm_concrete_tiles_ground';
const SLABS_LARGE = '/assets/materials/tileable/concrete/slabs_large';
const SIDEWALK1 = '/assets/materials/tileable/concrete/sidewalk1';
export const SIDEWALK_LOOKS = {
  // West Coast USA's sidewalk: pale, a few manhole and drain covers
  sidewalk1: {
    repeat: [30, 7.5],
    stage: {
      ambientOcclusionMap: `${SIDEWALK1}/t_sidewalk1_ao.data.png`, baseColorFactor: [0.745, 0.745, 0.745, 1], baseColorMap: `${SIDEWALK1}/t_sidewalk1_b.color.png`,
      metallicFactor: 0.7, metallicMap: `${SIDEWALK1}/t_sidewalk1_m.data.png`, normalMap: `${SIDEWALK1}/t_sidewalk1_nm.normal.png`, normalMapStrength: 1.2,
      roughnessMap: `${SIDEWALK1}/t_sidewalk1_r.data.png`, pixelSpecular: true,
    },
  },
  // East Coast USA's: weathered grey panels with cracks (4 × 2 panels)
  eastcoast: {
    repeat: [6, 3],
    stage: { baseColorMap: `${ECA_SIDEWALKS}/eca_bld_sidewalks_d.dds`, normalMap: `${ECA_SIDEWALKS}/eca_bld_sidewalks_n.dds`, roughnessFactor: 0.85 },
  },
  // clean even squares (4 × 4 panels)
  tiles: {
    repeat: [6, 6],
    stage: {
      ambientOcclusionMap: `${GM_TILES}/t_gm_concrete_tiles_ground_ao.data.png`, baseColorMap: `${GM_TILES}/t_gm_concrete_tiles_ground_d.color.png`,
      normalMap: `${GM_TILES}/t_gm_concrete_tiles_ground_nm.normal.png`, roughnessMap: `${GM_TILES}/t_gm_concrete_tiles_ground_r.data.png`,
    },
  },
  // warmer, large slabs (4 × 2 panels)
  slabs: {
    repeat: [8, 4],
    stage: {
      ambientOcclusionMap: `${SLABS_LARGE}/t_slabs_large_ao.data.png`, baseColorMap: `${SLABS_LARGE}/t_slabs_large_b.color.png`,
      normalMap: `${SLABS_LARGE}/t_slabs_large_nm.normal.png`, roughnessMap: `${SLABS_LARGE}/t_slabs_large_r.data.png`,
    },
  },
};
export const DEFAULT_SIDEWALK_LOOK = 'sidewalk1';
const lookOf = (name) => SIDEWALK_LOOKS[name] || SIDEWALK_LOOKS[DEFAULT_SIDEWALK_LOOK];
const DEFAULT_WIDTH_M = 2.0;
const MAX_WIDTH_M = 6.0;
const CUT_MARGIN_M = 0.5;     // runs stop this far outside other carriageways
const MIN_RUN_M = 8;
const WALK_H = 0.1;           // a walkway away from the curb, over the ground
const WALK_RAMP_UP_M = 0.35;  // a walkway's end climbs to a road no more than this
const WALK_MIN_M = 3;
const WALK_LANDING_M = 0.8;
const WALK_DIP_NODES = 3;     // a dip this many points across is not the ground's shape
const WALK_SHORE_M = 0.2;     // a walkway stops at the water's edge
const DECK_CLEAR_M = 1.2;     // a deck over the water
const DECK_SHORE_M = 0.8;     // ground this far over the deck level is land, not a shallow
const DECK_LAND_NODES = 4;    // ... along this many of a deck's 2 m points together
const DECK_ROAD_M = 3.5;      // a footway this near a bridge's road is on that bridge
const DECK_POST_M = 4;
const WALL_WATER_M = 0.5;      // ground this little over the water is the water's side
const WALL_INNER_LIFT_M = 0.5; // the deck's land edge over the highest ground along it
const WALL_SLOPE_DROP_M = 1;  // down to the water's edge
const WALL_LOOK_M = 2.5;      // how far past its edge a wall looks for the water
const WALL_GROUND_UNDER_M = 0.25;
const WALL_POINT_M = 3;       // the outline's points, a panel of wall apart
const WALL_TOP_REACH_M = 2.5; // a wall this near an edge carries it
const WALL_SHARE = 0.6;       // walls along this much of the outline: they are its sides
const GANGWAY_REACH_M = 8;    // a deck's end looks this far on for the shore
const GANGWAY_MIN_DROP_M = 0.4;
const GANGWAY_SLOPE = 0.27;   // a gangway's usual slope (15 degrees)
const GANGWAY_MAX_SLOPE = 0.4; // steeper is stairs
const GANGWAY_MAX_RUN_M = 14;
const GANGWAY_HALF_M = 0.6;
const GANGWAY_RAIL_M = 1.05;
const GANGWAY_POST_M = 1.6;
const STAIR_RISE_M = 0.18;
const STAIR_SLOPE = 0.7;
const APRON_MAX_M = 3;        // a walkway this near a wall is decked out to it
const APRON_MIN_M = 0.15;
const SEAWALL_APRON_MAX_M = 12; // further out where the wall holds back the water (a promenade)
const SEAWALL_LOOK_M = 2;       // water this far past the wall makes it a seawall
const SEAWALL_ACROSS = 0.35;    // and it runs alongside the walk (within about 20°)
const SEAWALL_RISE_M = 0.1;     // over ground about level with the walk
const SEAWALL_MIN_LEN_M = 15;   // along a stretch of wall this long at least
const POCKET_CLOSE_M = 0.6;     // gaps this narrow between walks, roads and walls still close a pocket
const POCKET_MAX_M2 = 1500;     // land shut in by walks and a seawall, up to this big, is paved
const POCKET_MIN_M2 = 2;
const POCKET_WALL_SHARE = 0.25; // with a seawall along this much of its edge at least
const POCKET_REACH_M = 40;      // (looked for this near a seawall)
const POCKET_CELL_M = 3;        // its top cut in cells this size, to follow the walks' heights
const APRON_STEP_M = 1;
const APRON_RISE_M = 0.5;       // a deck rises over ground up to this far above the walk, no more
const APRON_COVER_M = 0.05;
const WALK_EDGE_M = 1.5;      // an end this short of a road's edge is carried on to it
const WALK_TOUCH_M = 1;       // an end this near another walkway's line is on it (a short stub's far end is not)
const WALK_SNAP_M = 1;        // a footway this near a curb is closed up to it
const WALK_PUSH_SPREAD = 3;
const WALK_INSIDE_MAX_M = 3;
const WALK_STUB_M = 1.5;
const WALK_DUP_M = 0.05;      // a walk's points this close together are one       // a walk piece this short ramping to a road: left out  // a walk this far inside a road's drawn edge is pushed out past it   // a walk's push off a curb, spread this many points either way
const WALK_STREET_LEVEL_M = 5; // and this near a street takes its height from it (a sidewalk along the shop fronts too: on the ground raised to their foundations it stood a step over the walks it met)
const WALK_UNDER_M = 0.14;    // the ground under a walkway's top (it can't follow the slab closely on a 1 m grid)
const WALK_SINK_M = 0.3;      // and how far its edges reach down
const WALK_REACH_M = 3.5;     // an end this short of a road is carried on to it
const WALK_JOIN_M = 2.5;      // walkway ends this near another walkway meet it
const WALK_ROAD_M = -0.3;     // a walkway's sides may lie this far over a road's edge (its curb), never further
const WALK_CURB_M = 0.6;      // an end this near a road comes out to it
const WALK_RAMP_M = 3;        // ... over this much of its length
const WALK_STREET_M = 14;     // a footway this near a street, most of its length, is its sidewalk
const WALK_STREET_SHARE = 0.6;
// a mapped footway is a street's sidewalk along this much of the way
const FOOTWAY_SETBACK_M = 14;  // a footway this far off is still the street's sidewalk, set back
const FOOTWAY_SHARE = 0.4;
const FOOTWAY_ALONG_COS = 0.85;
const FOOTWAY_CELL_M = 24;
const RAMP_M = 1.8;           // a loose end's curb ramp: down to the road over this (1:12)
// Curb return radius by the larger road's class (BeamNG.Earth's survey of
// city corners), tried smaller until the corner clears every carriageway.
const CORNER_RADII = { residential: 3, living_street: 3, unclassified: 3, service: 3, tertiary: 4.5, secondary: 6, primary: 6, trunk: 8 };
const CORNER_RADIUS = 5;
const CORNER_TRIES = [1, 0.5, 0.25];
const CORNER_REACH_M = 15;    // how far past a run's end its corner may lie
const CORNER_ANGLES = [30, 150];  // degrees between the two curb lines for a corner
const RUNS_PER_MESH = 300;

// Divided roads' medians (BeamNG.Earth server/roads.py dual_carriageways,
// median_width, extras): two one-way carriageways of one street (name or
// ref) and class, side by side DUAL_GAP_M apart (centre lines) and parallel
// within DUAL_ANGLE_DEG. The ground between them is a median when it is
// MEDIAN_MIN_M..MEDIAN_MAX_M wide; up to MEDIAN_SLAB_M each carriageway builds
// a curbed slab out to the middle (one raised island between them), wider a
// MEDIAN_CURB_W curb along each with the ground between. Decided point by
// point, so a median starts and ends where the carriageways part and meet.
const DUAL_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
const DUAL_GAP_M = [4, 45];
const DUAL_ANGLE_COS = Math.cos((25 * Math.PI) / 180);
const MEDIAN_MIN_M = 0.8;
const MEDIAN_MAX_M = 16;
const MEDIAN_SLAB_M = 1.5;     // narrower: a concrete island; wider: two curbs, the ground between
const MEDIAN_BARRIER_M = 4;    // a fast road's median narrower than this: a jersey barrier
const FAST_CLASSES = new Set(['motorway', 'trunk']);
const BARRIER_PIECE_M = 3;
const MEDIAN_CURB_W = 0.6;
const MEDIAN_MIN_RUN_M = 20;
const MEDIAN_FILL_M = 4;
const MEDIAN_SIDE_SHARE = 0.3;   // a carriageway whose side faces a median this much of its length: no sidewalk there

// curbs sheet (1024 × 512, 8 bands of 64 px, v up): band 0, light rows 0–40.
const V_BAND_TOP = 1 - 1 / 512;
const V_LIGHT_LOW = 1 - 40 / 512;
const V_BAND_LOW = 1 - 63 / 512;
// sidewalk1 sheet: its top strip across the slab.

// (bricks, pavers, sett, cobble: walks mapped in stone or brick, with the
// squares' materials, plazas.js)
const PAVED_SETS = ['bricks', 'pavers', 'sett', 'cobble'];
export const SIDEWALK_MATERIALS = {
  curb: 'mapng_curbs', slab: 'mapng_sidewalk', paved: 'mapng_corner_asphalt', wood: 'mapng_pier_wood', metal: 'mapng_gangway_aluminium',
  ...Object.fromEntries(PAVED_SETS.map((set) => [set, PLAZA_MATERIAL(set)])),
};
/** The game's own crosswalk paint with square bars, Italy's (its definition lives with that level). */
export const ZEBRA_CROSSING_MATERIAL = 'italy_road_markings_zebra';

/** Material definitions (shared /assets textures; West Coast USA's settings). */
export function getSidewalkMaterialDefs({ look = DEFAULT_SIDEWALK_LOOK } = {}) {
  const CURBS = '/assets/materials/trim/concrete/curbs';
  const def = (name, stage) => ({
    name, mapTo: name, class: 'Material', version: 1.5, annotation: 'SIDEWALK',
    groundType: 'CONCRETE', Stages: [stage, {}, {}, {}], translucentBlendOp: 'None',
  });
  const ZEBRA = '/assets/materials/decalroad/lines';
  return {
    [ZEBRA_CROSSING_MATERIAL]: {
      name: ZEBRA_CROSSING_MATERIAL, mapTo: ZEBRA_CROSSING_MATERIAL, class: 'Material', version: 1.5, annotation: 'SOLID_LINE',
      Stages: [{
        baseColorMap: `${ZEBRA}/italy_road_markings_zebra/t_line_crossing_white_b.color.png`,
        normalMap: `${ZEBRA}/italy_road_markings_zebra/t_line_crossing_white_nm.normal.png`,
        opacityFactor: 0.75,
        opacityMap: `${ZEBRA}/italy_road_markings_zebra/t_line_crossing_white_o.data.png`,
        roughnessMap: `${ZEBRA}/m_marking_zebra/t_line_crossing_white_r.data.png`,
      }, {}, {}, {}],
      alphaRef: 32, alphaTest: true, castShadows: false, groundType: 'ASPHALT', materialTag0: 'RoadAndPath', materialTag1: 'beamng',
      specularStrength0: '0', translucent: true, translucentZWrite: true,
    },
    [SIDEWALK_MATERIALS.paved]: {
      ...def(SIDEWALK_MATERIALS.paved, {
        ambientOcclusionMap: '/assets/materials/tileable/road/road_asphalt_light/t_road_asphalt1_ao.data.png',
        baseColorMap: '/assets/materials/decalroad/asphalt/road_rubber_sticky/t_road_asphalt1_b.color.png',
        normalMap: '/assets/materials/tileable/road/road_asphalt_light/t_road_asphalt1_nm.normal.png',
        roughnessMap: '/assets/materials/decalroad/asphalt/road_rubber_sticky/t_asphalt1_r.data.png',
      }),
      annotation: 'ASPHALT',
      groundType: 'ASPHALT',
    },
    [SIDEWALK_MATERIALS.wood]: {
      ...def(SIDEWALK_MATERIALS.wood, {
        baseColorFactor: [0.5, 0.42, 0.34, 1],
        baseColorMap: '/assets/materials/tileable/wood/eca_bld_wood/eca_bld_wood_d.dds',
        normalMap: '/assets/materials/tileable/wood/eca_bld_wood/eca_bld_wood_n.dds',
      }),
      annotation: 'WOOD', groundType: 'WOOD',
    },
    [SIDEWALK_MATERIALS.metal]: {
      ...def(SIDEWALK_MATERIALS.metal, { baseColorFactor: [0.68, 0.7, 0.72, 1], metallicFactor: 0.85, roughnessFactor: 0.45 }),
      annotation: 'METAL', groundType: 'METAL',
    },
    [SIDEWALK_MATERIALS.curb]: def(SIDEWALK_MATERIALS.curb, {
      ambientOcclusionMap: `${CURBS}/t_curbs_ao.data.png`,
      baseColorMap: `${CURBS}/t_curbs_b.color.png`,
      normalMap: `${CURBS}/t_curbs_nm.normal.png`,
      roughnessMap: `${CURBS}/t_curbs_r.data.png`,
      pixelSpecular: true,
    }),
    [SIDEWALK_MATERIALS.slab]: def(SIDEWALK_MATERIALS.slab, { ...lookOf(look).stage }),
  };
}

const norm = (value) => String(value ?? '').trim().toLowerCase();
const SIDEWALK_CLASSES = new Set(['residential', 'tertiary', 'secondary', 'primary', 'unclassified', 'living_street']);
const PRESENT = new Set(['yes', 'both', 'left', 'right']);
const ABSENT = new Set(['no', 'none', 'separate']);

const parseWidth = (value) => {
  const w = Number.parseFloat(value);
  return Number.isFinite(w) && w > 0.5 ? Math.min(w, MAX_WIDTH_M) : null;
};

/** Road classes curbed in town. */
export const isCurbedClass = (highway) => SIDEWALK_CLASSES.has(String(highway ?? ''));

/** The width of a side with a curb and no sidewalk: the curb's own top. */
export const CURB_ONLY_M = CURB_W;

/**
 * What stands on each side of a carriageway (left/right of node order): a
 * sidewalk's width, CURB_ONLY_M for a bare curb, 0 for an open edge. A sidewalk
 * only where OSM has one (a missing tag says nothing, and streetSides adds the
 * ones mapped as footways); a town street has its curb either way.
 */
export function sidewalkSides({ tags = {}, highway, urban, curbed }) {
  const width = (side) => parseWidth(tags[`sidewalk:${side}:width`]) ?? parseWidth(tags['sidewalk:both:width'])
    ?? parseWidth(tags['sidewalk:width']) ?? DEFAULT_WIDTH_M;
  const general = norm(tags.sidewalk);
  const both = norm(tags['sidewalk:both']);
  const sideTag = (side) => norm(tags[`sidewalk:${side}`]);
  const has = (side) => {
    const own = sideTag(side);
    if (PRESENT.has(own)) return true;
    if (ABSENT.has(own)) return false;
    if (PRESENT.has(both)) return true;
    if (ABSENT.has(both)) return false;
    if (general === 'both' || general === 'yes') return true;
    if (general === side) return true;
    if (general === 'left' || general === 'right' || ABSENT.has(general)) return false;
    return false;
  };
  const edge = (urban || curbed) && SIDEWALK_CLASSES.has(String(highway ?? '')) ? CURB_ONLY_M : 0;
  return { left: has('left') ? width('left') : edge, right: has('right') ? width('right') : edge };
}

// Curb line `offset` m to the left of the centreline (mitred, z kept).
// (offset: one value, or each node's: (i) => value)
function offsetLine(nodes, offsetArg) {
  const out = [];
  const offsetOf = typeof offsetArg === 'function' ? offsetArg : () => offsetArg;
  for (let i = 0; i < nodes.length; i++) {
    const offset = offsetOf(i);
    const a = nodes[Math.max(0, i - 1)];
    const b = nodes[Math.min(nodes.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    out.push([nodes[i][0] - ((b[1] - a[1]) / len) * offset, nodes[i][1] + ((b[0] - a[0]) / len) * offset, nodes[i][2], 0]);
  }
  return out;
}

// A crossing mapped to a street's side where no way meets it: the walk it
// lands on is there, unmapped (OSM maps the crossing and not the sidewalk
// along a street with no sidewalk tags). Such an end this far from the
// street's centre line (past the lanes, short of the next block) is taken
// for a sidewalk on that side along the whole street way.
const CROSSING_END_M = [1.5, 10];

/**
 * The features with sidewalks inferred from crossings that end beside a street
 * with no sidewalk tags (copies, sidewalk=left/right/both, mapng:sidewalk=crossing;
 * the rest as they were). project(p) -> [x, y] in metres.
 */
export function inferCrossingSidewalks(features, project) {
  const key = (p) => `${p.lat.toFixed(7)},${p.lng.toFixed(7)}`;
  const nodeUse = new Map();
  for (const f of features || []) {
    if (f?.type !== 'road' || !f.tags?.highway || !(f.geometry?.length >= 2)) continue;
    for (const k of new Set(f.geometry.map(key))) nodeUse.set(k, (nodeUse.get(k) || 0) + 1);
  }
  const ends = [];
  for (const f of features || []) {
    const t = f?.tags || {};
    if (f?.type !== 'road' || !(f.geometry?.length >= 2)) continue;
    if (t.footway !== 'crossing' && t.cycleway !== 'crossing' && t.path !== 'crossing') continue;
    for (const e of [f.geometry[0], f.geometry[f.geometry.length - 1]]) if ((nodeUse.get(key(e)) || 0) <= 1) ends.push(project(e));
  }
  if (!ends.length) return features;
  const CELL = 32;
  const grid = new Map();
  ends.forEach((p, i) => { const k = `${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
  const sides = new Map();
  for (const f of features) {
    const t = f?.tags || {};
    if (f?.type !== 'road' || !SIDEWALK_CLASSES.has(t.highway) || !(f.geometry?.length >= 2) || t.area === 'yes') continue;
    if (Object.keys(t).some((k) => k.startsWith('sidewalk'))) continue;
    if ((t.bridge && t.bridge !== 'no') || (t.tunnel && t.tunnel !== 'no')) continue;
    const pts = f.geometry.map(project);
    const got = new Set();
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]; const b = pts[i + 1]; const dx = b[0] - a[0]; const dy = b[1] - a[1]; const L2 = dx * dx + dy * dy;
      if (L2 < 1e-6) continue;
      const seen = new Set();
      for (let gx = Math.floor((Math.min(a[0], b[0]) - CROSSING_END_M[1]) / CELL); gx <= Math.floor((Math.max(a[0], b[0]) + CROSSING_END_M[1]) / CELL); gx++) {
        for (let gy = Math.floor((Math.min(a[1], b[1]) - CROSSING_END_M[1]) / CELL); gy <= Math.floor((Math.max(a[1], b[1]) + CROSSING_END_M[1]) / CELL); gy++) {
          for (const j of grid.get(`${gx},${gy}`) || []) {
            if (seen.has(j)) continue;
            seen.add(j);
            const p = ends[j];
            const u = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
            if (u < 0 || u > 1) continue;     // (beside this stretch, not past its end round a corner)
            const across = (dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / Math.sqrt(L2);
            if (Math.abs(across) < CROSSING_END_M[0] || Math.abs(across) > CROSSING_END_M[1]) continue;
            got.add(across > 0 ? 'left' : 'right');
          }
        }
      }
    }
    if (got.size) sides.set(f, got.size === 2 ? 'both' : [...got][0]);
  }
  if (!sides.size) return features;
  return features.map((f) => (sides.has(f) ? { ...f, tags: { ...f.tags, sidewalk: sides.get(f), 'mapng:sidewalk': 'crossing' } } : f));
}

const PAVE_CELL_M = 16;
/**
 * Where walks are mapped in stone or brick: paveAt(x, y) -> 'bricks' |
 * 'pavers' | 'sett' | 'cobble' | null. From the streets' sidewalk surface tags
 * (sidewalk:left|right|both:surface, sidewalk:surface: the strip from the
 * carriageway's edge out past the sidewalk) and the walks mapped as their own
 * ways with a surface (walks: [{ nodes, half, surface }], their width and a
 * little), or null when there are none.
 */
export function pavedWalkZones(carriageways = [], walks = [], { americas = false } = {}) {
  const strips = [];   // { a, b, h0, h1, set }: from h0 to h1 off segment a-b, + left
  const add = (nodes, set, h0, h1) => {
    for (let i = 0; i + 1 < nodes.length; i++) if (Math.hypot(nodes[i + 1][0] - nodes[i][0], nodes[i + 1][1] - nodes[i][1]) > 0.01) strips.push({ a: nodes[i], b: nodes[i + 1], h0, h1, set });
  };
  for (const cw of carriageways) {
    const t = cw.tags || {};
    for (const [side, sign] of [['left', 1], ['right', -1]]) {
      const set = pavedWalkSurface(t[`sidewalk:${side}:surface`] ?? t['sidewalk:both:surface'] ?? t['sidewalk:surface'], { americas });
      if (!set) continue;
      const w = parseWidth(t[`sidewalk:${side}:width`]) ?? parseWidth(t['sidewalk:both:width']) ?? parseWidth(t['sidewalk:width']) ?? DEFAULT_WIDTH_M;
      add(cw.nodes, set, sign * (cw.half - 0.2), sign * (cw.half + w + 1));
    }
  }
  for (const w of walks || []) {
    const set = pavedWalkSurface(w.surface, { americas });
    if (set && w.nodes?.length > 1) add(w.nodes, set, -(w.half + 0.4), w.half + 0.4);
  }
  if (!strips.length) return null;
  const grid = new Map();
  strips.forEach((st, k) => {
    const r = Math.max(Math.abs(st.h0), Math.abs(st.h1));
    for (let gx = Math.floor((Math.min(st.a[0], st.b[0]) - r) / PAVE_CELL_M); gx <= Math.floor((Math.max(st.a[0], st.b[0]) + r) / PAVE_CELL_M); gx++) {
      for (let gy = Math.floor((Math.min(st.a[1], st.b[1]) - r) / PAVE_CELL_M); gy <= Math.floor((Math.max(st.a[1], st.b[1]) + r) / PAVE_CELL_M); gy++) {
        const key = `${gx},${gy}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(k);
      }
    }
  });
  return (x, y) => {
    for (const k of grid.get(`${Math.floor(x / PAVE_CELL_M)},${Math.floor(y / PAVE_CELL_M)}`) || []) {
      const { a, b, h0, h1, set } = strips[k];
      const dx = b[0] - a[0]; const dy = b[1] - a[1]; const L = Math.hypot(dx, dy);
      const u = ((x - a[0]) * dx + (y - a[1]) * dy) / (L * L);
      if (u < -0.02 || u > 1.02) continue;
      const across = (dx * (y - a[1]) - dy * (x - a[0])) / L;
      if (across >= Math.min(h0, h1) && across <= Math.max(h0, h1)) return set;
    }
    return null;
  };
}

/** Sidewalks mapped as their own ways: [{ nodes, width }]. */
export function sidewalkFootways(features, project) {
  return (features || []).filter((f) => f.tags?.footway === 'sidewalk' && f.geometry?.length > 1)
    .map((f) => ({ nodes: f.geometry.map((p) => project(p)), width: parseWidth(f.tags.width) ?? DEFAULT_WIDTH_M }));
}

// Which sides of a carriageway have a mapped footway running along them: { left, right }.
function footwaySides(index, cw) {
  const hits = { 1: 0, '-1': 0 };
  const n = cw.nodes;
  n.forEach((p, i) => {
    const a = n[Math.max(0, i - 1)]; const b = n[Math.min(n.length - 1, i + 1)];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const t = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const seen = new Set();
    for (const { q, r } of index.get(`${Math.floor(p[0] / FOOTWAY_CELL_M)},${Math.floor(p[1] / FOOTWAY_CELL_M)}`) || []) {
      const dx = r[0] - q[0]; const dy = r[1] - q[1]; const l = Math.hypot(dx, dy) || 1;
      if (Math.abs((dx * t[0] + dy * t[1]) / l) < FOOTWAY_ALONG_COS) continue;
      const u = Math.max(0, Math.min(1, ((p[0] - q[0]) * dx + (p[1] - q[1]) * dy) / (l * l)));
      const ox = q[0] + dx * u - p[0]; const oy = q[1] + dy * u - p[1];
      if (Math.hypot(ox, oy) > cw.half + FOOTWAY_SETBACK_M) continue;
      const across = t[0] * oy - t[1] * ox;
      if (Math.abs(across) < cw.half - 1) continue;
      const side = across > 0 ? 1 : -1;
      if (seen.has(side)) continue;
      seen.add(side);
      hits[side]++;
    }
  });
  return { left: hits[1] >= FOOTWAY_SHARE * n.length, right: hits[-1] >= FOOTWAY_SHARE * n.length };
}

function footwayIndex(footways) {
  const index = new Map();
  for (const { nodes, width } of footways) {
    for (let i = 0; i + 1 < nodes.length; i++) {
      const q = nodes[i]; const r = nodes[i + 1]; const R = FOOTWAY_CELL_M;
      const cell = (v) => Math.floor(v / R);
      for (let cx = cell(Math.min(q[0], r[0]) - R); cx <= cell(Math.max(q[0], r[0]) + R); cx++) {
        for (let cy = cell(Math.min(q[1], r[1]) - R); cy <= cell(Math.max(q[1], r[1]) + R); cy++) {
          const key = `${cx},${cy}`;
          if (!index.has(key)) index.set(key, []);
          index.get(key).push({ q, r, width });
        }
      }
    }
  }
  return index;
}

const hasSidewalkTags = (tags = {}) => Object.keys(tags).some((k) => k === 'sidewalk' || k.startsWith('sidewalk:'));

/**
 * Each carriageway's sidewalk sides, decided along the street: a carriageway
 * with no sidewalk tags of its own takes them from the tagged carriageways it
 * plainly continues (same name; left and right swapped where it runs the
 * other way), carried on along the street. OSM often tags only some ways of
 * a street, which left sidewalks stopping mid-block and short stubs. A side with
 * a footway mapped along it has only its curb here: buildWalkRuns builds that
 * slab along the footway, so it never jumps from curb to footway at a driveway.
 */
export function streetSides(carriageways, footways = []) {
  const sides = new Map(carriageways.map((cw) => [cw, sidewalkSides(cw)]));
  const known = new Set(carriageways.filter((cw) => hasSidewalkTags(cw.tags)));
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1;
  const ends = (cw) => [cw.nodes[0], cw.nodes[cw.nodes.length - 1]];
  const sameStreet = (a, b) => (a.owner === b.owner || (a.continuations || []).includes(b.owner) || (b.continuations || []).includes(a.owner))
    && String(a.tags?.name ?? '') === String(b.tags?.name ?? '');
  let queue = [...known];
  while (queue.length) {
    const next = [];
    for (const from of queue) {
      const [fs, fe] = ends(from);
      for (const cw of carriageways) {
        if (known.has(cw) || !cw.nodes?.length || !sameStreet(from, cw)) continue;
        const [cs, ce] = ends(cw);
        const along = near(fe, cs) || near(ce, fs);
        const against = near(fs, cs) || near(fe, ce);
        if (!along && !against) continue;
        const s = sides.get(from); const own = sides.get(cw);
        // (a sidewalk carries on along the street; a curb is the town's, not the street's)
        const pick = (theirs, mine) => (theirs > CURB_ONLY_M || !mine ? (theirs > CURB_ONLY_M ? theirs : 0) : mine);
        sides.set(cw, along ? { left: pick(s.left, own.left), right: pick(s.right, own.right) } : { left: pick(s.right, own.left), right: pick(s.left, own.right) });
        known.add(cw);
        next.push(cw);
      }
    }
    queue = next;
  }
  if (footways.length) {
    const index = footwayIndex(footways);
    for (const cw of carriageways) {
      if (!cw.nodes?.length) continue;
      // (the slab is built along the footway itself: only the curb stays here)
      const mapped = footwaySides(index, cw); const s = sides.get(cw);
      const edge = sidewalkSides({ ...cw, tags: {} }).left;
      sides.set(cw, { left: mapped.left ? edge : s.left, right: mapped.right ? edge : s.right });
    }
  }
  return sides;
}

// +1 when a one-way carriageway is driven along its node order, -1 against it
const travelSign = (cw) => (['-1', 'reverse'].includes(String(cw.tags?.oneway ?? '').trim().toLowerCase()) ? -1 : 1);

const streetKey = (cw) => {
  const name = String(cw.tags?.name || cw.tags?.ref || '').trim();
  const cls = String(cw.highway || '').replace(/_link$/, '');
  return name && DUAL_CLASSES.has(cls) && isOneWayRoad(cw.tags || {}) ? `${cls}|${name}` : null;
};

/**
 * Where each carriageway runs beside its divided road's other carriageway:
 * Map(cw -> { side: ±1 per node (0 = none; +1 left of the node order),
 * width: median ground width per node }).
 */
export function findMedians(carriageways) {
  const groups = new Map();
  for (const cw of carriageways) {
    const key = cw.nodes?.length > 1 ? streetKey(cw) : null;
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(cw);
  }
  const out = new Map();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // segments of the group in a coarse grid
    const CELL = DUAL_GAP_M[1];
    const grid = new Map();
    group.forEach((cw, ci) => {
      for (let i = 0; i + 1 < cw.nodes.length; i++) {
        const a = cw.nodes[i]; const b = cw.nodes[i + 1];
        const k = `${Math.floor((a[0] + b[0]) / 2 / CELL)},${Math.floor((a[1] + b[1]) / 2 / CELL)}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push([ci, i]);
      }
    });
    group.forEach((cw, ci) => {
      const n = cw.nodes.length;
      const side = new Int8Array(n);
      const width = new Float32Array(n);
      let any = false;
      for (let i = 0; i < n; i++) {
        const p = cw.nodes[i];
        const a = cw.nodes[Math.max(0, i - 1)]; const b = cw.nodes[Math.min(n - 1, i + 1)];
        const t = unit([b[0] - a[0], b[1] - a[1]]);
        let best = null;
        const gx = Math.floor(p[0] / CELL); const gy = Math.floor(p[1] / CELL);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (const [cj, j] of grid.get(`${gx + dx},${gy + dy}`) || []) {
              if (cj === ci) continue;
              const other = group[cj];
              const q0 = other.nodes[j]; const q1 = other.nodes[j + 1];
              const sx = q1[0] - q0[0]; const sy = q1[1] - q0[1];
              const L2 = sx * sx + sy * sy || 1e-9;
              const f = Math.max(0, Math.min(1, ((p[0] - q0[0]) * sx + (p[1] - q0[1]) * sy) / L2));
              const vx = q0[0] + sx * f - p[0]; const vy = q0[1] + sy * f - p[1];
              const d = Math.hypot(vx, vy);
              if (d < DUAL_GAP_M[0] || d > DUAL_GAP_M[1] || (best && d >= best.d)) continue;
              const u = unit([sx, sy]);
              // the other carriageway of a divided road is driven the other
              // way (a turn lane or slip road beside it, the same way, is not)
              if ((t[0] * u[0] + t[1] * u[1]) * travelSign(cw) * travelSign(other) > -DUAL_ANGLE_COS) continue;
              best = { d, s: Math.sign(t[0] * vy - t[1] * vx), half: other.half };
            }
          }
        }
        if (!best) continue;
        const mw = best.d - cw.half - best.half;
        if (mw <= 0 || mw > MEDIAN_MAX_M) continue;
        side[i] = best.s;
        width[i] = mw;
        any = true;
      }
      if (any) out.set(cw, { side, width });
    });
  }
  return out;
}

// The share of a carriageway's nodes whose `side` (±1) faces a median.
const medianShare = (median, side) => {
  if (!median) return 0;
  let k = 0;
  for (const v of median.side) if (v === side) k++;
  return k / median.side.length;
};

/**
 * Median islands along each divided carriageway: runs like the sidewalks'
 * (curb at the carriageway's edge, slab toward the median) whose points carry
 * their slab width as a 4th value. Cut where they would cross another road
 * or a crosswalk.
 */
// Points along a line every `step` m.
function everyMetres(line, step) {
  const out = [line[0]]; let left = step;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]; const b = line[i + 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let d = left;
    while (d <= L) { const f = d / L; out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]); d += step; }
    left = d - L;
  }
  return out;
}

export function buildMedianRuns(carriageways, medians, { zones = [] } = {}) {
  const index = buildCarriagewayIndex(carriageways);
  const pieces = [];
  const jersey = [];
  for (const cw of carriageways) {
    const median = medians.get(cw);
    if (!median) continue;
    for (const side of [1, -1]) {
      // contiguous stretches facing a median on this side
      let i = 0;
      const n = cw.nodes.length;
      while (i < n) {
        if (median.side[i] !== side) { i++; continue; }
        let j = i;
        while (j + 1 < n && median.side[j + 1] === side) j++;
        const widths = Array.from(median.width.slice(i, j + 1));
        const sorted = [...widths].sort((x, y) => x - y);
        // one island (slab to the middle) or two curbs, by the stretch's typical width
        const typical = sorted[sorted.length >> 1];
        const thin = typical < MEDIAN_MIN_M;
        // OSM doesn't say what a median is: a fast road's narrow one a barrier,
        // a town street's raised, a country road's open ground
        if (!thin && FAST_CLASSES.has(String(cw.highway)) && typical < MEDIAN_BARRIER_M) {
          if (side > 0) {
            const mid = offsetLine(cw.nodes.slice(i, j + 1), side * (cw.half + typical / 2));
            jersey.push(everyMetres(mid, BARRIER_PIECE_M));
          }
          i = j + 1;
          continue;
        }
        if (!thin && !cw.urban && !cw.curbed) { i = j + 1; continue; }
        const slab = typical <= MEDIAN_SLAB_M;
        const nodes = offsetLine(cw.nodes.slice(i, j + 1), side * cw.half)
          .map((pt, k) => [pt[0], pt[1], pt[2], slab ? Math.max(0.3, widths[k] / 2) : MEDIAN_CURB_W]);
        const ignore = new Set([cw.owner, ...(cw.continuations || [])]);
        // (a thin gap has its other carriageway right beside it)
        const margin = typical < MEDIAN_MIN_M ? -0.1 : CUT_MARGIN_M;
        const blocked = (x, y) => isOnOtherCarriageway(index, x, y, margin, (o) => ignore.has(o)) || isInZone(zones, x, y);
        for (const piece of cutNodes(nodes, blocked, { minPieceM: 0.5 })) {
          pieces.push({ points: piece, side, width: 0, owner: cw.owner, highway: cw.highway, median: true, thin: typical < MEDIAN_MIN_M });
        }
        i = j + 1;
      }
    }
  }
  // OSM splits a carriageway into many short ways: join their pieces end to
  // end first (each point keeps its own width), then drop the short ones
  const merged = mergeRuns(pieces.filter((p) => !p.thin), { matchWidth: false });
  const raised = merged.filter((run) => runLength(run.points) >= MEDIAN_MIN_RUN_M)
    .map((run) => ({ ...run, width: Math.max(...run.points.map((pt) => pt[3])) }));
  // what's too thin or short for an island: the road paved across it (grass showed in stripes)
  raised.gaps = [...pieces.filter((p) => p.thin), ...merged.filter((run) => runLength(run.points) < MEDIAN_MIN_RUN_M)];
  raised.jersey = jersey;
  return raised;
}

/**
 * Sidewalk runs: [{ points: [[x,y,z]...], side: ±1, width, owner }] where side +1
 * is left of the run's direction (the sidewalk lies on that side of the curb)
 * and owner is the carriageway's.
 */
// Building footprints (world rings) in a grid, for point-in-footprint tests.
const BUILDING_CELL_M = 32;
function buildingIndex(rings) {
  const cells = new Map();
  for (const ring of rings) {
    if (!ring || ring.length < 3) continue;
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const item = { ring, x0, y0, x1, y1 };
    for (let cx = Math.floor(x0 / BUILDING_CELL_M); cx <= Math.floor(x1 / BUILDING_CELL_M); cx++) {
      for (let cy = Math.floor(y0 / BUILDING_CELL_M); cy <= Math.floor(y1 / BUILDING_CELL_M); cy++) {
        const k = `${cx},${cy}`;
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(item);
      }
    }
  }
  return (x, y) => {
    for (const it of cells.get(`${Math.floor(x / BUILDING_CELL_M)},${Math.floor(y / BUILDING_CELL_M)}`) || []) {
      if (x < it.x0 || x > it.x1 || y < it.y0 || y > it.y1) continue;
      let inside = false;
      const r = it.ring;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        if ((r[i][1] > y) !== (r[j][1] > y) && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  };
}

// Runs fitted to the ground beside them: where the full slab would stand on
// blocked ground (a building at the road's edge, another carriageway) it
// narrows to what fits (a city sidewalk between the kerb and the house
// fronts), down to MIN_FIT_M; narrower than that it is cut. A run splits
// where its width changes. blocked(run, x, y, zRoad).
const MIN_FIT_M = 1.0;
const SAME_STREET_ON_COS = Math.cos((60 * Math.PI) / 180);   // a piece of one street runs on within this turn of the last
function splitRunsWhereBlocked(runs, blocked) {
  const STEP = 1;
  const out = [];
  for (const run of runs) {
    const widths = run.width <= CURB_ONLY_M ? [run.width] : [run.width, run.width * 0.75, run.width * 0.5, MIN_FIT_M].filter((w, i, a) => w >= MIN_FIT_M - 1e-6 && a.indexOf(w) === i && w <= run.width + 1e-6);
    const p = run.points;
    let piece = []; let pieceW = null; let last = null;
    const flush = () => { if (piece.length >= 2 && runLength(piece) >= MIN_RUN_M) out.push({ ...run, width: pieceW, points: piece }); piece = []; };
    for (let i = 0; i + 1 < p.length; i++) {
      const a = p[i]; const b = p[i + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-6) continue;
      const nx = (-(b[1] - a[1]) / L) * run.side; const ny = ((b[0] - a[0]) / L) * run.side;
      const n = Math.max(1, Math.ceil(L / STEP));
      for (let k = i === 0 ? 0 : 1; k <= n; k++) {
        const t = k / n;
        const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        // the widest slab whose middle and back edge stand on free ground
        const fits = widths.find((w) => {
          const mid = w / 2 + CURB_W; const back = w + CURB_W;
          return !blocked(run, q[0] + nx * mid, q[1] + ny * mid, q[2], q) && !blocked(run, q[0] + nx * back, q[1] + ny * back, q[2], q);
        }) ?? null;
        if (fits !== pieceW) {
          // (the last point at the old width ends its piece; a new width starts here)
          if (pieceW !== null && last && piece[piece.length - 1] !== last) piece.push(last);
          flush();
          pieceW = fits;
        }
        last = q;
        if (fits === null) continue;
        if (k === n || k === 0 || piece.length === 0) piece.push(q);
      }
    }
    flush();
  }
  return out;
}

export function buildSidewalkRuns(carriageways, { zones = [], driveways = [], medians = new Map(), buildings = [], footways = [], parking = [], walkEnds = [], openGround = [], houses = [] } = {}) {
  const index = buildCarriagewayIndex(carriageways);
  const sidesOf = streetSides(carriageways, footways);
  // Driveways and parking aisles (OSM service roads, not carriageways of
  // their own) cross a sidewalk with its curb lowered: a dip, not a cut.
  const nearDriveway = buildLineIndex(driveways);
  const pieces = [];
  // the pieces of one street meeting end to end (a T-junction splits it: its
  // far curb was cut by its own next piece)
  const sameStreet = new Map(carriageways.map((cw) => [cw.owner, new Set([cw.owner, ...(cw.continuations || [])])]));
  {
    const ends = new Map();
    const key = (p) => `${Math.round(p[0])},${Math.round(p[1])}`;
    for (const cw of carriageways) {
      if (!cw.nodes?.length || cw.nodes.length < 2) continue;
      const n = cw.nodes;
      for (const [p, q] of [[n[0], n[1]], [n[n.length - 1], n[n.length - 2]]]) {
        if (!ends.has(key(p))) ends.set(key(p), []);
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
        ends.get(key(p)).push({ cw, out: [(q[0] - p[0]) / L, (q[1] - p[1]) / L] });
      }
    }
    const street = (cw) => cw.tags?.name || cw.wayId;
    // (running on, not forking off: two branches of one street leaving a
    // fork side by side each laid its sidewalk over the other)
    for (const list of ends.values()) {
      for (const a of list) {
        for (const b of list) {
          if (a.cw === b.cw || !street(a.cw) || street(a.cw) !== street(b.cw)) continue;
          if (a.out[0] * b.out[0] + a.out[1] * b.out[1] < -SAME_STREET_ON_COS) sameStreet.get(a.cw.owner).add(b.cw.owner);
        }
      }
    }
  }
  for (const cw of carriageways) {
    const sides = sidesOf.get(cw);
    const ignore = sameStreet.get(cw.owner);
    const blocked = (x, y) => carriagewaysAt(index, x, y, CUT_MARGIN_M, { sides: true }).some((c) => !ignore.has(c.owner));
    for (const [side, width] of [[1, sides.left], [-1, sides.right]]) {
      // a divided road's median side has the median, not a sidewalk
      if (!width || medianShare(medians.get(cw), side) >= MEDIAN_SIDE_SHARE) continue;
      // (each node's own half width where the way narrows to the next one)
      for (const piece of cutNodes(offsetLine(cw.nodes, cw.halfAt ? (i) => side * cw.halfAt[i] : side * cw.half), blocked, { minPieceM: 0.5 })) {
        pieces.push({ points: piece.map((n) => [n[0], n[1], n[2]]), side, width, owner: cw.owner, highway: cw.highway, surface: cw.tags?.surface });
      }
    }
  }
  let runs = mergeRuns(pieces).filter((run) => runLength(run.points) >= MIN_RUN_M);
  // a slab never runs into a building (a footprint at the road's edge) or
  // out over another carriageway (a sunken centre road beside a side road)
  {
    const inBuilding = buildings?.length ? buildingIndex(buildings) : () => false;
    // (a merged run has many owners: what matters is its street, not its first)
    const streetOf = new Map(carriageways.map((cw) => [cw.owner, cw.tags?.name || cw.wayId || cw.owner]));
    // (the street's own continuation counts too where it is on another
    // level: a garage ramp leaving the street beside it)
    // (whose curb it is there: the nearest of the run's own carriageways, a
    // merged run running on from one piece into the next)
    const byOwner = new Map(carriageways.map((cw) => [cw.owner, cw]));
    const ownAt = (run, q) => {
      if (!run.owners || run.owners.length < 2) return run.owner;
      let best = run.owner; let d = Infinity;
      for (const o of run.owners) {
        const cw = byOwner.get(o); if (!cw) continue;
        const n = cw.nodes;
        for (let i = 0; i + 1 < n.length; i++) {
          const ex = n[i + 1][0] - n[i][0]; const ey = n[i + 1][1] - n[i][1];
          const t = Math.max(0, Math.min(1, ((q[0] - n[i][0]) * ex + (q[1] - n[i][1]) * ey) / (ex * ex + ey * ey || 1)));
          const e = Math.abs(Math.hypot(q[0] - n[i][0] - t * ex, q[1] - n[i][1] - t * ey) - cw.half);
          if (e < d) { d = e; best = o; }
        }
      }
      return best;
    };
    runs = splitRunsWhereBlocked(runs, (run, x, y, z, q) => {
      if (inBuilding(x, y)) return true;
      const own = ownAt(run, q);
      return carriagewaysAt(index, x, y, GROUND_ROAD_MARGIN_M, { sides: true }).some((c) => c.owner !== own
        && (!(sameStreet.get(own)?.has(c.owner)) || streetOf.get(c.owner) !== streetOf.get(own) || Math.abs(c.z - z) > 1));
    });
  }
  // a town street's bare curb with building fronts close behind it: the
  // sidewalk the buildings stand on, curb to wall (downtown streets with no
  // sidewalk mapped came out a curb and a strip of painted ground)
  // (and unmapped ground behind a town curb, no front lawn's house behind it:
  // a sidewalk of the usual width)
  // (only where OSM says nothing: a side tagged sidewalk=yes/no/separate, or
  // one with its sidewalk mapped as its own way, is as mapped)
  if (buildings?.length || openGround.length) {
    const tagsOf = new Map(carriageways.map((cw) => [cw.owner, cw.tags || {}]));
    const saysSide = (run) => {
      const t = tagsOf.get(run.owner) || {};
      const side = run.side > 0 ? 'left' : 'right';
      return [t.sidewalk, t['sidewalk:both'], t[`sidewalk:${side}`]].some((v) => v !== undefined && v !== '');
    };
    const nearWalk = buildLineIndex((footways || []).map((w) => w.nodes));
    runs = fillToBuildingFronts(runs, buildings || [], parking, {
      openGround, houses,
      roadAt: (x, y) => carriagewaysAt(index, x, y, 0).length > 0,
      skipRun: saysSide,
      mappedWalkAt: nearWalk ? (x, y) => nearWalk(x, y, FRONT_WALK_NEAR_M) : () => false,
    });
  }
  // a car park right at the street is open along it: a bare curb lowered
  // all the way (one behind a verge keeps its curb)
  const inParking = parking.length ? buildingIndex(parking) : null;
  const nearWalkEnd = walkEnds.length ? endIndex(walkEnds, WALK_CURB_M) : null;
  for (const run of runs) {
    const p = run.points; const edge = run.width <= CURB_ONLY_M;
    const on = (x, y, i) => (nearDriveway && nearDriveway(x, y, DRIVEWAY_HALF_M)) || (edge && inParking && (() => {
      const a = p[Math.max(0, i)]; const b = p[Math.min(p.length - 1, i + 1)]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return inParking(x + (-(b[1] - a[1]) / L) * run.side * PARKING_OPEN_M, y + ((b[0] - a[0]) / L) * run.side * PARKING_OPEN_M);
    })());
    // (at a crosswalk too: the curb carries on through it, lowered)
    if (nearDriveway || inParking || zones.length) run.dips = dipsAlong(p, (x, y, i) => on(x, y, i) || isInZone(zones, x, y));
    // a walkway coming out to the street: the curb lowered to meet it
    if (walkEnds.length) {
      const atWalk = dipsAlong(p, nearWalkEnd);
      if (atWalk.length) run.dips = [...(run.dips || []), ...atWalk];
    }
  }
  return runs;
}

const FRONT_GAP_M = [1, 6];      // walls this far behind a bare curb: paved up to them
const FRONT_MIN_RUN_M = 8;       // along at least this much of the curb
const FRONT_WALL_CLEAR_M = 0.05;
const FRONT_CELL_M = 16;
const FRONT_WALK_NEAR_M = 3;     // a mapped sidewalk this near behind a curb: no sidewalk laid over it
const FRONT_ABSORB_M = 6;        // a bare-curb end shorter than this beside a new sidewalk: taken into it
const UNMAPPED_WALK_M = 2;       // a sidewalk over unmapped town ground behind a curb
const UNMAPPED_ROAD_CLEAR_M = 4; // another road this near behind the curb: the strip between is no sidewalk
const LAWN_HOUSE_M = 12;         // a house this near behind the curb: its front lawn, kept

/**
 * Bare-curb runs (width CURB_ONLY_M) with building walls FRONT_GAP_M behind
 * them along FRONT_MIN_RUN_M or more: those stretches split off as sidewalks
 * reaching the walls (the narrowest gap along the stretch, less a hair). A
 * car park between the curb and the wall keeps its curb.
 */
function fillToBuildingFronts(runs, buildings, parking = [], { openGround = [], houses = [], roadAt = () => false, skipRun = () => false, mappedWalkAt = () => false } = {}) {
  const grid = new Map();
  const houseGrid = new Map();
  const addTo = (g, ring) => {
    for (let i = 0; i + 1 < ring.length; i++) {
      const a = ring[i]; const b = ring[i + 1];
      for (let gx = Math.floor(Math.min(a[0], b[0]) / FRONT_CELL_M); gx <= Math.floor(Math.max(a[0], b[0]) / FRONT_CELL_M); gx++) {
        for (let gy = Math.floor(Math.min(a[1], b[1]) / FRONT_CELL_M); gy <= Math.floor(Math.max(a[1], b[1]) / FRONT_CELL_M); gy++) {
          const k = `${gx},${gy}`;
          if (!g.has(k)) g.set(k, []);
          g.get(k).push([a, b]);
        }
      }
    }
  };
  for (const ring of houses) addTo(houseGrid, ring);
  const inOpen = openGround.length ? buildingIndex(openGround) : () => false;
  for (const ring of buildings) addTo(grid, ring);
  const inParking = parking.length ? buildingIndex(parking) : () => false;
  // the distance along (ux, uy) from p to the first wall, or Infinity
  const wallAhead = (p, ux, uy, reach, g = grid) => {
    let best = Infinity;
    const seen = new Set();
    for (let s = 0; s <= reach + FRONT_CELL_M; s += FRONT_CELL_M / 2) {
      const k = `${Math.floor((p[0] + ux * Math.min(s, reach)) / FRONT_CELL_M)},${Math.floor((p[1] + uy * Math.min(s, reach)) / FRONT_CELL_M)}`;
      for (const seg of g.get(k) || []) {
        if (seen.has(seg)) continue;
        seen.add(seg);
        const [a, b] = seg; const ex = b[0] - a[0]; const ey = b[1] - a[1];
        const den = ex * uy - ey * ux;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((p[0] - a[0]) * uy - (p[1] - a[1]) * ux) / den;           // along the wall
        const u = ((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / den;           // along the ray
        if (t >= 0 && t <= 1 && u > 0 && u < best) best = u;
      }
    }
    return best;
  };
  const out = [];
  for (const run of runs) {
    if (run.width > CURB_ONLY_M || run.points.length < 2 || skipRun(run)) { out.push(run); continue; }
    const pts = run.points;
    const gaps = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(pts.length - 1, i + 1)];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const ux = (-(b[1] - a[1]) / L) * run.side; const uy = ((b[0] - a[0]) / L) * run.side;
      // (a mapped sidewalk just behind the curb: it is the sidewalk)
      if (mappedWalkAt(p[0] + ux * 1.5, p[1] + uy * 1.5)) return null;
      const g = wallAhead(p, ux, uy, FRONT_GAP_M[1]);
      if (g >= FRONT_GAP_M[0] && g <= FRONT_GAP_M[1]) {
        // (a car park between the curb and the wall: no sidewalk across it)
        if (inParking(p[0] + ux * g / 2, p[1] + uy * g / 2)) return null;
        return { g, wall: true };
      }
      // unmapped ground behind the curb: the usual sidewalk, where nothing
      // says otherwise (a park, a car park, water, a road; a house's front
      // lawn)
      const free = [0.5, 1.2, UNMAPPED_WALK_M].every((d) => {
        const x = p[0] + ux * d; const y = p[1] + uy * d;
        return !inOpen(x, y) && !inParking(x, y) && !roadAt(x, y);
      });
      if (!free || g < UNMAPPED_WALK_M + FRONT_WALL_CLEAR_M) return null;
      // (nor a strip with another road just past it: a median the divided
      // road's finder missed where one side widens, paved as a sidewalk)
      if ([UNMAPPED_WALK_M + 1, UNMAPPED_ROAD_CLEAR_M].some((d) => roadAt(p[0] + ux * d, p[1] + uy * d))) return null;
      if (wallAhead(p, ux, uy, LAWN_HOUSE_M, houseGrid) <= LAWN_HOUSE_M) return null;
      return { g: UNMAPPED_WALK_M + FRONT_WALL_CLEAR_M, wall: false };
    });
    // stretches of fronting walls long enough
    let i = 0; let cut = 0; const pieces = [];
    while (i < pts.length) {
      if (gaps[i] === null) { i++; continue; }
      // (a stretch of building fronts and one of open ground apart: each its own width)
      let j = i;
      while (j + 1 < pts.length && gaps[j + 1] !== null && gaps[j + 1].wall === gaps[i].wall) j++;
      // (meeting the stretch before it end to end: no bare curb between)
      const from = pieces.length && pieces[pieces.length - 1][1] === i - 1 ? i - 1 : i;
      if (j > from && runLength(pts.slice(from, j + 1)) >= FRONT_MIN_RUN_M) pieces.push([from, j, i]);
      i = j + 1;
    }
    if (!pieces.length) { out.push(run); continue; }
    // (a bare-curb end too short to stand alone, between the sidewalk and the
    // run's end, taken into the sidewalk: no stub of curb left by a corner)
    if (pieces.length && pieces[0][0] > 0 && runLength(pts.slice(0, pieces[0][0] + 1)) < FRONT_ABSORB_M) pieces[0][0] = 0;
    const last = pieces[pieces.length - 1];
    if (last && last[1] < pts.length - 1 && runLength(pts.slice(last[1])) < FRONT_ABSORB_M) last[1] = pts.length - 1;
    for (const [a, b, own] of pieces) {
      if (a > cut) out.push({ ...run, points: pts.slice(cut, a + 1) });
      const width = Math.max(CURB_W + 0.5, Math.min(...gaps.slice(own, b + 1).filter(Boolean).map((q) => q.g)) - FRONT_WALL_CLEAR_M);
      out.push({ ...run, points: pts.slice(a, b + 1), width, front: true });
      cut = b;
    }
    if (cut < pts.length - 1) out.push({ ...run, points: pts.slice(cut) });
  }
  return out.filter((r) => r.points.length >= 2);
}

const DRIVEWAY_HALF_M = 2.5;
const LINE_CELL_M = 16;
// near(x, y, r): within r of any of the polylines [[x, y]...] (null for none).
function buildLineIndex(lines) {
  if (!lines.length) return null;
  const grid = new Map();
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const [ax, ay] = line[i];
      const [bx, by] = line[i + 1];
      for (let gx = Math.floor(Math.min(ax, bx) / LINE_CELL_M) - 1; gx <= Math.floor(Math.max(ax, bx) / LINE_CELL_M) + 1; gx++) {
        for (let gy = Math.floor(Math.min(ay, by) / LINE_CELL_M) - 1; gy <= Math.floor(Math.max(ay, by) / LINE_CELL_M) + 1; gy++) {
          const k = `${gx},${gy}`;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push([ax, ay, bx, by]);
        }
      }
    }
  }
  return (x, y, r) => (grid.get(`${Math.floor(x / LINE_CELL_M)},${Math.floor(y / LINE_CELL_M)}`) || []).some(([ax, ay, bx, by]) => {
    const dx = bx - ax; const dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
    return Math.hypot(ax + t * dx - x, ay + t * dy - y) < r;
  });
}

/**
 * Pieces joined end to end where one street's sidewalk goes on across a way
 * boundary (OSM splits streets into many ways): same side, near-straight,
 * same width. Without this every way boundary ended the sidewalk.
 */
// Join pieces end to end into runs (same side, similar width, turning less
// than 35°). Run ends are kept in a grid, so a city's thousands of pieces
// join in one pass (re-scanning every pair after each join took 222 s for a
// 4 km Phoenix export).
function mergeRuns(pieces, { matchWidth = true } = {}) {
  const NEAR = 0.75;
  const runs = pieces.map((r) => ({ ...r, points: [...r.points], alive: true }));
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < NEAR;
  const dir = (a, b) => unit([b[0] - a[0], b[1] - a[1]]);
  const cellOf = (p) => `${Math.floor(p[0] / NEAR)},${Math.floor(p[1] / NEAR)}`;
  const grid = new Map();   // cell -> runs with an end there (checked again on use)
  const addEnds = (run) => {
    for (const p of [run.points[0], run.points[run.points.length - 1]]) {
      const k = cellOf(p);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(run);
    }
  };
  const nearby = (p) => {
    const cx = Math.floor(p[0] / NEAR); const cy = Math.floor(p[1] / NEAR);
    const out = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const r of grid.get(`${cx + dx},${cy + dy}`) || []) out.push(r);
    return out;
  };
  runs.forEach(addEnds);
  for (const A of runs) {
    if (!A.alive || A.points.length < 2) continue;
    let extended = true;
    while (extended) {
      extended = false;
      const aEnd = A.points[A.points.length - 1];
      const da = dir(A.points[A.points.length - 2], aEnd);
      for (const cand of nearby(aEnd)) {
        if (cand === A || !cand.alive || cand.points.length < 2 || (matchWidth && Math.abs(A.width - cand.width) > 0.3)) continue;
        let B = null;
        if (near(aEnd, cand.points[0]) && A.side === cand.side) B = cand.points;
        else if (near(aEnd, cand.points[cand.points.length - 1]) && A.side === -cand.side) B = [...cand.points].reverse();
        if (!B) continue;
        const db = dir(B[0], B[1]);
        if (da[0] * db[0] + da[1] * db[1] < Math.cos((35 * Math.PI) / 180)) continue;
        A.points = [...A.points, ...B.slice(1)];
        A.owners = [...new Set([...(A.owners || [A.owner]), ...(cand.owners || [cand.owner])])];
        cand.alive = false;
        addEnds(A);
        extended = true;
        break;
      }
    }
  }
  return runs.filter((r) => r.alive).map(({ alive, ...r }) => r);
}

const DIP_STEP_M = 0.5;
// Arc-length spans [s0, s1] of a run where `on(x, y)` (a driveway crossing).
// Whether (x, y) lies within an end's half width + pad of it (ends:
// [x, y, half]): a grid of cells as wide as the farthest reach, so only the
// 3×3 cells around a point are looked at (every end against every curb point
// grew with the square of the map: minutes for a city).
function endIndex(ends, pad) {
  const cell = Math.max(1, ends.reduce((m, e) => Math.max(m, e[2]), 0) + pad);
  const cells = new Map();
  const keyOf = (cx, cy) => cx * 1048576 + cy;
  for (const e of ends) {
    const k = keyOf(Math.floor(e[0] / cell), Math.floor(e[1] / cell));
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(e);
  }
  return (x, y) => {
    const cx = Math.floor(x / cell); const cy = Math.floor(y / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const [ex, ey, half] of cells.get(keyOf(cx + dx, cy + dy)) || []) {
          if (Math.hypot(ex - x, ey - y) < half + pad) return true;
        }
      }
    }
    return false;
  };
}

function dipsAlong(points, on) {
  const spans = [];
  let s = 0;
  let open = null;
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    for (let d = 0; d < len; d += DIP_STEP_M) {
      const hit = on(ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len, i);
      if (hit && open === null) open = s + d;
      if (!hit && open !== null) { spans.push([open, s + d]); open = null; }
    }
    s += len;
  }
  if (open !== null) spans.push([open, s]);
  return spans;
}

// Profile across from the curb line: [outward offset, height] and material.
function profileFor(width, walk = false) {
  // a walkway on its own: a slab just proud of the ground, both edges down into it
  if (walk) {
    return {
      points: [[0, -WALK_SINK_M], [BATTER, WALK_H], [width - BATTER, WALK_H], [width, -WALK_SINK_M]],
      segments: [
        { mat: 'curb', v: [V_BAND_LOW, V_LIGHT_LOW] },
        { mat: 'slab', v: [0, width / SLAB_TILE_M] },
        { mat: 'curb', v: [V_BAND_LOW, V_LIGHT_LOW] },
      ],
    };
  }
  const slabOut = CURB_H + width * CROSS_SLOPE;
  const back = width + BACK_SLOPE_RUN * (slabOut + SINK);
  // a bare curb: no slab, a square back, the ground behind it up to its top
  if (width <= CURB_ONLY_M) {
    return {
      points: [[0, -SINK], [BATTER, CURB_H - NOSE], [NOSE_W, CURB_H], [CURB_W, CURB_H], [CURB_W + BATTER, -SINK]],
      segments: [
        { mat: 'curb', v: [V_BAND_LOW, V_LIGHT_LOW] },
        { mat: 'curb', v: [V_LIGHT_LOW, V_BAND_TOP] },
        { mat: 'curb', v: [V_LIGHT_LOW, V_BAND_TOP] },
        { mat: 'curb', v: [V_BAND_LOW, V_LIGHT_LOW] },
      ],
    };
  }
  return {
    points: [[0, -SINK], [BATTER, CURB_H - NOSE], [NOSE_W, CURB_H], [CURB_W, CURB_H], [width, slabOut], [back, -SINK]],
    // segment k joins points k and k+1
    segments: [
      { mat: 'curb', v: [V_BAND_LOW, V_LIGHT_LOW] },   // face
      { mat: 'curb', v: [V_LIGHT_LOW, V_BAND_TOP] },   // nose
      { mat: 'curb', v: [V_LIGHT_LOW, V_BAND_TOP] },   // top
      { mat: 'slab', v: [0, (width - CURB_W) / SLAB_TILE_M] },     // slab
      { mat: 'curb', v: [V_BAND_LOW, V_LIGHT_LOW] },   // back
    ],
  };
}

class PartBuilder {
  // paveAt(x, y): the stone or brick a walk's slab is laid in there, or null
  constructor(paveAt = null, look = DEFAULT_SIDEWALK_LOOK) {
    this.parts = Object.fromEntries(Object.keys(SIDEWALK_MATERIALS).map((k) => [k, { pos: [], uv: [] }]));
    this.triangles = 0;
    this.paveAt = paveAt;
    const [u, v] = lookOf(look).repeat;
    this.slabU = SLAB_TILE_M / u; this.slabV = SLAB_TILE_M / v;
  }

  // Triangle a-b-c turned so its normal points along `want`.
  tri(mat, a, b, c, ua, ub, uc, want) {
    // a slab's top in a stone or brick walk: those, tiled in world metres
    if (mat === 'slab' && this.paveAt) {
      const set = this.paveAt((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3);
      if (set) {
        const t = plazaTileM(set);
        mat = set; ua = [a[0] / t, a[1] / t]; ub = [b[0] / t, b[1] / t]; uc = [c[0] / t, c[1] / t];
      }
    }
    if (mat === 'slab') {
      ua = [ua[0] * this.slabU, ua[1] * this.slabV]; ub = [ub[0] * this.slabU, ub[1] * this.slabV]; uc = [uc[0] * this.slabU, uc[1] * this.slabV];
    }
    const n = [
      (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
      (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
    ];
    const flip = n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0;
    const p = this.parts[mat];
    for (const [v, u] of flip ? [[a, ua], [c, uc], [b, ub]] : [[a, ua], [b, ub], [c, uc]]) {
      p.pos.push(v[0], v[1], v[2]);
      p.uv.push(u[0], u[1]);
    }
    this.triangles++;
  }

  toMesh(name, { smooth = false } = {}) {
    let total = 0;
    for (const p of Object.values(this.parts)) total += p.pos.length / 3;
    if (total === 0) return null;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    const materials = [];
    let start = 0;
    for (const [key, p] of Object.entries(this.parts)) {
      const count = p.pos.length / 3;
      if (count === 0) continue;
      pos.set(p.pos, start * 3);
      uv.set(p.uv, start * 2);
      geo.addGroup(start, count, materials.length);
      materials.push(new THREE.MeshStandardMaterial({ name: SIDEWALK_MATERIALS[key] }));
      start += count;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    // (a sloped deck cut in triangles showed them, each shaded alone)
    if (smooth) {
      const nrm = geo.getAttribute('normal').array; const sums = new Map();
      const key = (i) => `${Math.round(pos[i * 3] * 100)},${Math.round(pos[i * 3 + 1] * 100)},${Math.round(pos[i * 3 + 2] * 100)}`;
      for (let i = 0; i < total; i++) {
        const k = key(i); const v = sums.get(k) ?? [0, 0, 0];
        v[0] += nrm[i * 3]; v[1] += nrm[i * 3 + 1]; v[2] += nrm[i * 3 + 2];
        sums.set(k, v);
      }
      for (let i = 0; i < total; i++) { const u = unit3(sums.get(key(i))); nrm.set(u, i * 3); }
    }
    const mesh = new THREE.Mesh(geo, materials);
    mesh.name = name;
    return mesh;
  }
}

const DIP_RAMP_M = 1.0;        // the curb's slope down into a driveway dip

// A run's stations (its points, with more where the curb height changes) and
// each one's curb-height share: 0 at a ramped end and across a driveway dip,
// back to 1 over RAMP_M / DIP_RAMP_M.
// The share of a run's height left d m along it (0 at a loose end or in a driveway dip).
function heightShare(total, ramps, dips, rampM = null) {
  const ramp0 = Math.min(rampM?.[0] ?? RAMP_M, total / 2.5); const ramp1 = Math.min(rampM?.[1] ?? RAMP_M, total / 2.5);
  return (d) => {
    let f = Math.min(1, ramps[0] ? d / ramp0 : 1, ramps[1] ? (total - d) / ramp1 : 1);
    for (const [a, b] of dips) f = Math.min(f, Math.max(0, Math.max(a - d, d - b) / DIP_RAMP_M));
    return Math.max(0, f);
  };
}

function rampStations(points, ramps, dips = [], rampM = null) {
  const s = [0];
  for (let i = 1; i < points.length; i++) s.push(s[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const total = s[s.length - 1];
  const shareAt = heightShare(total, ramps, dips, rampM);
  const cuts = [];
  if (ramps[0]) cuts.push(Math.min(rampM?.[0] ?? RAMP_M, total / 2.5));
  if (ramps[1]) cuts.push(total - Math.min(rampM?.[1] ?? RAMP_M, total / 2.5));
  for (const [a, b] of dips) cuts.push(a - DIP_RAMP_M, a, b, b + DIP_RAMP_M);
  const inner = cuts.filter((c) => c > 1e-6 && c < total - 1e-6).sort((x, y) => x - y);
  const out = [];
  const at = [];
  let c = 0;
  for (let i = 0; i < points.length; i++) {
    while (i > 0 && c < inner.length && inner[c] < s[i] - 1e-6) {
      if (inner[c] > s[i - 1] + 1e-6) {
        const f = (inner[c] - s[i - 1]) / (s[i] - s[i - 1]);
        out.push(points[i - 1].map((v, k) => v + (points[i][k] - v) * f));
        at.push(inner[c]);
      }
      c++;
    }
    out.push(points[i]);
    at.push(s[i]);
  }
  return { points: out, share: at.map(shareAt) };
}

// A strip of road paving out from a line, each point's own width (half a gap: its other side does the rest).
function paveGap(builder, run) {
  const p = run.points; let s = 0;
  const out = p.map((q, i) => {
    const a = p[Math.max(0, i - 1)]; const b = p[Math.min(p.length - 1, i + 1)];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const w = (q[3] || 0.3) + 0.15;
    return [q[0] + (-(b[1] - a[1]) / L) * run.side * w, q[1] + ((b[0] - a[0]) / L) * run.side * w, q[2]];
  });
  for (let i = 0; i + 1 < p.length; i++) {
    const L = Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
    const uv = (o, v) => [o / PAVED_TILE_M, v / PAVED_TILE_M];
    const q = [p[i], p[i + 1], out[i + 1], out[i]].map(([x, y, z]) => [x, y, z + FILLET_LIFT_M]);
    builder.tri('paved', q[0], q[1], q[2], uv(s, 0), uv(s + L, 0), uv(s + L, 1), [0, 0, 1]);
    builder.tri('paved', q[0], q[2], q[3], uv(s, 0), uv(s + L, 1), uv(s, 1), [0, 0, 1]);
    s += L;
  }
}

function sweepRun(builder, run) {
  const { side, width } = run;
  const caps = run.caps ?? [true, true];
  const { points, share } = rampStations(run.points, run.ramps ?? [false, false], run.dips);
  // a median island's points carry their own slab width (4th value)
  const profiles = run.median ? points.map((p) => profileFor(p[3] || width)) : null;
  const profile = profileFor(width, run.walk);
  // Outward unit normal at each station (mitred, the sidewalk's side).
  const outward = points.map((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-((b[1] - a[1]) / len) * side, ((b[0] - a[0]) / len) * side];
  });
  const stations = points.map((p, i) => (profiles ? profiles[i] : profile).points.map(([o, h]) => [p[0] + outward[i][0] * o, p[1] + outward[i][1] * o, p[2] + (h > 0 ? h * share[i] : h)]));
  let along = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const step = Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
    const s0 = along;
    const s1 = along + step;
    along = s1;
    const out = [(outward[i][0] + outward[i + 1][0]) / 2, (outward[i][1] + outward[i + 1][1]) / 2];
    profile.segments.forEach((seg, k) => {
      const [o0, h0] = (profiles ? profiles[i] : profile).points[k];
      const [o1, h1] = (profiles ? profiles[i] : profile).points[k + 1];
      // Front of this profile segment: (−dh)·outward + (do)·up.
      const want = [-(h1 - h0) * out[0], -(h1 - h0) * out[1], o1 - o0];
      const repeat = seg.mat === 'slab' ? SLAB_TILE_M : CURB_REPEAT_M;
      const u0 = s0 / repeat;
      const u1 = s1 / repeat;
      const a0 = stations[i][k]; const b0 = stations[i][k + 1];
      const a1 = stations[i + 1][k]; const b1 = stations[i + 1][k + 1];
      const [va, vb] = seg.v;
      builder.tri(seg.mat, a0, a1, b1, [u0, va], [u1, va], [u1, vb], want);
      builder.tri(seg.mat, a0, b1, b0, [u0, va], [u1, vb], [u0, vb], want);
    });
  }
  // End caps: fan over the profile, facing away from the run (not where a
  // corner piece goes on from it).
  for (const [i, j, cap] of [[0, 1, caps[0]], [points.length - 1, points.length - 2, caps[1]]]) {
    if (!cap) continue;
    const dir = [points[i][0] - points[j][0], points[i][1] - points[j][1], 0];
    const ring = stations[i];
    for (let k = 1; k + 1 < ring.length; k++) {
      builder.tri('curb', ring[0], ring[k], ring[k + 1], [0, V_BAND_LOW], [0.02, V_LIGHT_LOW], [0.04, V_LIGHT_LOW], dir);
    }
  }
}

const unit = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
const lineX = (p, d, q, e) => {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + t * d[0], p[1] + t * d[1]];
};
const runLength = (pts) => pts.reduce((n, p, i) => (i ? n + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

// A run's end: its point, the way on past it, the sidewalk's side (outward
// from the road), its height.
function runEnd(run, atStart) {
  const pts = run.points;
  const p = atStart ? pts[0] : pts[pts.length - 1];
  const q = atStart ? pts[1] : pts[pts.length - 2];
  const d = unit([p[0] - q[0], p[1] - q[1]]);
  // outward = left normal of the run's direction times its side
  const fwd = atStart ? [-d[0], -d[1]] : d;
  return { run, atStart, p, d, n: [-fwd[1] * run.side, fwd[0] * run.side], z: p[2] };
}

// The run cut (t < 0) or carried on (t > 0) to t m past this end.
function moveEnd(end, t) {
  const { run, atStart } = end;
  const pts = atStart ? [...run.points].reverse() : [...run.points];
  if (t >= 0) {
    if (t > 0.01) pts.push([end.p[0] + end.d[0] * t, end.p[1] + end.d[1] * t, end.z]);
  } else {
    let cut = -t;
    while (pts.length > 1) {
      const a = pts[pts.length - 1];
      const b = pts[pts.length - 2];
      const seg = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (seg > cut + 1e-6) {
        const f = cut / seg;
        pts[pts.length - 1] = a.map((v, k) => v + (b[k] - v) * f);
        break;
      }
      cut -= seg;
      pts.pop();
    }
  }
  run.points = atStart ? pts.reverse() : pts;
  // driveway dips are arc lengths from the start
  if (atStart && run.dips) run.dips = run.dips.map(([a, b]) => [a + t, b + t]).filter(([, b]) => b > 0);
}

/**
 * Curb returns where two sidewalks meet at a junction corner: each pair of
 * run ends whose curb lines meet just ahead of both, at a corner angle, with
 * each sidewalk on the outside of the other. Both runs are cut (or carried
 * on) to the arc's tangent points; returns the corner pieces
 * [{ arc: [[x, y, z]...], centre, outer: [x, y], a: end, b: end }]. Ends
 * left over get curb ramps.
 */
function joinCorners(runs, index, walkRuns = []) {
  const ends = runs.flatMap((run) => [runEnd(run, true), runEnd(run, false)]);
  // (ends by grid cell of the reach: each against its neighbours, not all
  // against all: 4 s of a dense 8 km map)
  const REACH = 2 * CORNER_REACH_M;
  const endGrid = new Map();
  ends.forEach((e, i) => {
    const k = `${Math.floor(e.p[0] / REACH)},${Math.floor(e.p[1] / REACH)}`;
    if (!endGrid.has(k)) endGrid.set(k, []);
    endGrid.get(k).push(i);
  });
  const pairs = [];
  for (let i = 0; i < ends.length; i++) {
    const gx = Math.floor(ends[i].p[0] / REACH); const gy = Math.floor(ends[i].p[1] / REACH);
    const near = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of endGrid.get(`${gx + dx},${gy + dy}`) || []) if (j > i) near.push(j);
    near.sort((a, b) => a - b);
    for (const j of near) {
      const A = ends[i];
      const B = ends[j];
      if (A.run === B.run || Math.hypot(A.p[0] - B.p[0], A.p[1] - B.p[1]) > 2 * CORNER_REACH_M) continue;
      const angle = Math.acos(Math.max(-1, Math.min(1, A.d[0] * B.d[0] + A.d[1] * B.d[1]))) * 180 / Math.PI;
      if (angle < CORNER_ANGLES[0] || angle > CORNER_ANGLES[1]) continue;
      // each sidewalk lies on the outside of the other's road
      if (A.n[0] * -B.d[0] + A.n[1] * -B.d[1] < 0.3 || B.n[0] * -A.d[0] + B.n[1] * -A.d[1] < 0.3) continue;
      const C = lineX(A.p, A.d, B.p, B.d);
      if (!C) continue;
      const tA = (C[0] - A.p[0]) * A.d[0] + (C[1] - A.p[1]) * A.d[1];
      const tB = (C[0] - B.p[0]) * B.d[0] + (C[1] - B.p[1]) * B.d[1];
      if (tA < -2 || tB < -2 || tA > CORNER_REACH_M || tB > CORNER_REACH_M) continue;
      pairs.push({ A, B, cost: tA + tB, i, j });
    }
  }
  // (ties in the order the all-pairs loop found them)
  pairs.sort((x, y) => x.cost - y.cost || x.i - y.i || x.j - y.j);
  const used = new Set();
  const corners = [];
  for (const { A, B } of pairs) {
    if (used.has(A) || used.has(B)) continue;
    const r0 = Math.max(CORNER_RADII[A.run.highway] ?? CORNER_RADIUS, CORNER_RADII[B.run.highway] ?? CORNER_RADIUS);
    for (const share of CORNER_TRIES) {
      const r = r0 * share;
      const Z = lineX([A.p[0] + A.n[0] * r, A.p[1] + A.n[1] * r], A.d, [B.p[0] + B.n[0] * r, B.p[1] + B.n[1] * r], B.d);
      if (!Z) break;
      const T1 = [Z[0] - A.n[0] * r, Z[1] - A.n[1] * r];
      const T2 = [Z[0] - B.n[0] * r, Z[1] - B.n[1] * r];
      const t1 = (T1[0] - A.p[0]) * A.d[0] + (T1[1] - A.p[1]) * A.d[1];
      const t2 = (T2[0] - B.p[0]) * B.d[0] + (T2[1] - B.p[1]) * B.d[1];
      // keep enough of each run, and reach no further than the corner search
      if (t1 > CORNER_REACH_M || t2 > CORNER_REACH_M) continue;
      if (runLength(A.run.points) + t1 < MIN_RUN_M / 2 || runLength(B.run.points) + t2 < MIN_RUN_M / 2) continue;
      const a0 = Math.atan2(T1[1] - Z[1], T1[0] - Z[0]);
      const a1 = Math.atan2(T2[1] - Z[1], T2[0] - Z[0]);
      const da = ((a1 - a0 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
      const k = Math.max(3, Math.ceil((Math.abs(da) * r) / 0.75) + 1);
      const arc = Array.from({ length: k }, (_, i) => {
        const a = a0 + (da * i) / (k - 1);
        return [Z[0] + r * Math.cos(a), Z[1] + r * Math.sin(a), A.z + ((B.z - A.z) * i) / (k - 1)];
      });
      // the corner (the curb and the slab behind it) clear of every carriageway
      const outer = lineX([T1[0] + A.n[0] * A.run.width, T1[1] + A.n[1] * A.run.width], A.d,
        [T2[0] + B.n[0] * B.run.width, T2[1] + B.n[1] * B.run.width], B.d);
      if (!outer) break;
      const probes = [...arc, outer, [(outer[0] + Z[0]) / 2, (outer[1] + Z[1]) / 2]];
      if (probes.some(([x, y]) => isOnOtherCarriageway(index, x, y, -0.2, () => false))) continue;
      moveEnd(A, t1);
      moveEnd(B, t2);
      corners.push({ arc, centre: Z, outer, a: A, b: B });
      used.add(A);
      used.add(B);
      break;
    }
  }
  // a mapped walk carrying on from a sidewalk's end (one leaving the street
  // round a fountain or into a park): the slab stays up and meets it, not a
  // ramp down to the road beside the walk
  const walkPts = [];
  for (const w of walkRuns) for (const q of w.centre || []) walkPts.push([q[0], q[1], w.half]);
  const WALK_CELL = 8;
  const walkGrid = new Map();
  for (const q of walkPts) {
    const key = `${Math.floor(q[0] / WALK_CELL)},${Math.floor(q[1] / WALK_CELL)}`;
    if (!walkGrid.has(key)) walkGrid.set(key, []);
    walkGrid.get(key).push(q);
  }
  const walkGoesOn = (end) => {
    const w = end.run.width;
    const c = [end.p[0] + end.n[0] * w / 2, end.p[1] + end.n[1] * w / 2];
    const gx = Math.floor(c[0] / WALK_CELL); const gy = Math.floor(c[1] / WALK_CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const q of walkGrid.get(`${gx + i},${gy + j}`) || []) if (Math.hypot(q[0] - c[0], q[1] - c[1]) < q[2] + w / 2 + SIDEWALK_WALK_JOIN_M) return true;
    }
    return false;
  };
  for (const end of ends) {
    const { run } = end;
    run.caps ??= [true, true];
    run.ramps ??= [false, false];
    const k = end.atStart ? 0 : 1;
    if (used.has(end)) run.caps[k] = false;
    else if (run.width > CURB_ONLY_M && walkGoesOn(end)) continue;
    else run.ramps[k] = true;
  }
  return corners;
}
const SIDEWALK_WALK_JOIN_M = 0.6;
const CUT_SLIVER_W_M = 0.15;      // nor one thinner than this on average (twice its area over its outline)
const CUT_SLIVER_M2 = 0.25;     // a piece of walk this small left by a corner's cut: dropped

// A walkway ending on a street's sidewalk (a walk leaving the street round a
// fountain: its end by the curb) meets the slab at its top, not ramped down
// to the road beside it.
function levelWalkEndsOnSidewalks(walkRuns, streetRuns, corners = []) {
  const slabs = [];
  // (and on a rounded curb: a ramp down from the walk's end rose over the
  // curb there, standing up as a wedge)
  for (const { arc } of corners) for (let i = 0; i + 1 < arc.length; i++) slabs.push({ a: arc[i], b: arc[i + 1], half: 0.4 });
  for (const run of streetRuns) {
    if (run.points.length < 2 || !(run.width > CURB_ONLY_M)) continue;
    const mid = offsetLine(run.points, (run.width / 2) * (run.side ?? 1));
    for (let i = 0; i + 1 < mid.length; i++) slabs.push({ a: mid[i], b: mid[i + 1], half: run.width / 2 });
  }
  if (!slabs.length) return;
  // (slabs in a grid: every walk end tried against every slab in the map)
  const maxH = slabs.reduce((m, s) => Math.max(m, s.half), 0);
  const slabGrid = boxGrid(slabs.map(({ a, b }) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]));
  const onSlab = (p, half) => {
    const r = maxH + half * 0.5 + 0.3;
    return slabGrid.some([p[0] - r, p[1] - r, p[0] + r, p[1] + r], (k) => {
      const { a, b, half: h } = slabs[k];
      const dx = b[0] - a[0]; const dy = b[1] - a[1]; const L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) < h + half * 0.5 + 0.3;
    });
  };
  for (const w of walkRuns) {
    if (!w.ramps || !w.centre?.length) continue;
    const ends = [w.centre[0], w.centre[w.centre.length - 1]];
    ends.forEach((p, k) => {
      if (!w.ramps[k] || !onSlab(p, w.half)) return;
      w.ramps[k] = false;
      // (the ramp's heights, set down toward the road when the walk was
      // built, back up to the walk's own level: the flag alone left them low)
      const n = w.centre.length;
      const idx = (i) => (k ? n - 1 - i : i);
      let d = 0; let level = null;
      for (let i = 1; i < n; i++) {
        d += Math.hypot(w.centre[idx(i)][0] - w.centre[idx(i - 1)][0], w.centre[idx(i)][1] - w.centre[idx(i - 1)][1]);
        if (d >= WALK_RAMP_M) { level = w.centre[idx(i)][2]; break; }
      }
      if (level === null) return;
      for (let i = 0; i < n; i++) {
        const j = idx(i);
        if (w.centre[j][2] >= level) break;
        w.centre[j][2] = level;
        if (w.points?.[j]) w.points[j][2] = level;
      }
    });
  }
}   // a walk this near a sidewalk's end carries it on

/**
 * The road inside each rounded curb, for decals of the street's own surface
 * (the two streets' decals leave the corner's triangle of ground bare): bands
 * of one width laid along the curve, one beyond the other out to the curbs'
 * square corner, each trimmed to the two curb lines (a tapered strip squeezed
 * its texture to a pale sliver lying out on the road).
 * [{ nodes: [[x, y, z, width]...], surface, streets, band: true }].
 */
export function cornerPatches(corners) {
  const out = [];
  for (const corner of corners) {
    const { arc, centre, a, b } = corner;
    const apex = cornerPoint(corner);
    if (!apex || arc.length < 3) continue;
    const radius = Math.hypot(arc[0][0] - centre[0], arc[0][1] - centre[1]);
    const depth = Math.hypot(apex[0] - centre[0], apex[1] - centre[1]) - radius;
    if (!(depth > 0) || depth > 15) continue;
    const z = (a.z + b.z) / 2;
    // (both streets: the corner takes the junction's surface, exportBeamNGLevel)
    const surface = a.run.surface ?? b.run.surface;
    const streets = [{ surface: a.run.surface, highway: a.run.highway }, { surface: b.run.surface, highway: b.run.highway }];
    // the curb lines: each arc end's tangent; the corner lies on the arc's side
    const tangent = (p) => { const q = unit([p[0] - centre[0], p[1] - centre[1]]); return [-q[1], q[0]]; };
    const lines = [arc[0], arc[arc.length - 1]].map((p, k) => {
      const t = tangent(p); const n = [-t[1], t[0]];
      const other = arc[k ? 0 : arc.length - 1];
      const sign = Math.sign((other[0] - p[0]) * n[0] + (other[1] - p[1]) * n[1]) || 1;
      return (q) => ((q[0] - p[0]) * n[0] + (q[1] - p[1]) * n[1]) * sign;
    });
    // (a little over each curb line: the street's own decal lies beyond it)
    const inside = (q) => Math.min(lines[0](q), lines[1](q)) + CORNER_BAND_OVER_M;
    // (densely along the curve: an outer band keeps only its middle)
    const fine = [];
    for (let i = 0; i + 1 < arc.length; i++) for (let k = 0; k < 4; k++) fine.push(lerp3(arc[i], arc[i + 1], k / 4));
    fine.push(arc[arc.length - 1]);
    for (let m = CORNER_BAND_M / 2 - 0.1; m - CORNER_BAND_M / 2 < depth; m += CORNER_BAND_M - CORNER_BAND_LAP_M) {
      const pts = fine.map((p) => { const o = unit([p[0] - centre[0], p[1] - centre[1]]); return [p[0] + o[0] * m, p[1] + o[1] * m, z, CORNER_BAND_M]; });
      // keep the stretch inside both curb lines, cut where it leaves them
      const kept = [];
      for (let i = 0; i < pts.length; i++) {
        const fi = inside(pts[i]);
        if (fi >= 0) {
          if (!kept.length && i > 0) { const fp = inside(pts[i - 1]); kept.push(lerp3(pts[i - 1], pts[i], fp / (fp - fi))); }
          kept.push(pts[i]);
        } else if (kept.length) {
          const fp = inside(pts[i - 1]); kept.push(lerp3(pts[i - 1], pts[i], fp / (fp - fi)));
          break;
        }
      }
      const length = kept.reduce((sum, q, i) => (i ? sum + Math.hypot(q[0] - kept[i - 1][0], q[1] - kept[i - 1][1]) : 0), 0);
      if (kept.length < 2 || length < CORNER_BAND_MIN_M) continue;
      // (evenly spaced: the game's spline through two nodes almost on top of
      // each other, as the cut left them, overshot into spikes across the road)
      out.push({ nodes: resampleEven(kept, Math.max(3, Math.round(length / CORNER_BAND_STEP_M) + 1)), surface, streets, band: true });
    }
  }
  return out;
}
const lerp3 = (p, q, t) => p.map((v, i) => v + ((q[i] ?? v) - v) * t);
// n points evenly along a polyline, its ends kept
function resampleEven(pts, n) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  const out = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const d = (k / (n - 1)) * total;
    while (j < pts.length - 1 && cum[j] < d) j++;
    const span = cum[j] - cum[j - 1] || 1;
    out.push(lerp3(pts[j - 1], pts[j], Math.max(0, Math.min(1, (d - cum[j - 1]) / span))));
  }
  return out;
}
const CORNER_BAND_STEP_M = 0.8;
const CORNER_BAND_MIN_M = 1.0;
const CORNER_BAND_OVER_M = 0.6;
const CORNER_BAND_LAP_M = 0.1;
const CORNER_BAND_M = 1.2;

// The road beside each curb, from its face in toward the street's centre
// line, and every street's carriageway: rings [[x, y]...]. A mapped walk is cut at the curb like at a rounded
// one; pushed behind the curb, some still ran on past a curve's end, over the
// next street's straight curb and out across its road.
export function curbKeepOuts(runs, carriageways) {
  const byOwner = new Map(carriageways.map((cw) => [cw.owner, cw]));
  const centreDist = (cw, p) => {
    let best = Infinity;
    for (let i = 1; i < cw.nodes.length; i++) {
      const a = cw.nodes[i - 1]; const b = cw.nodes[i];
      const dx = b[0] - a[0]; const dy = b[1] - a[1]; const L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
      best = Math.min(best, Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]));
    }
    return best;
  };
  const out = [];
  for (const run of runs) {
    // (all the street's pieces a merged run runs along: by its first alone,
    // a run's far end measured to a piece a hundred metres off, and its
    // keep-out turned round over the sidewalk, cutting a walk there away)
    const cws = (run.owners || [run.owner]).map((o) => byOwner.get(o)).filter(Boolean);
    if (!cws.length || run.median || run.points.length < 2) continue;
    const dist = (p) => Math.min(...cws.map((cw) => centreDist(cw, p)));
    const pts = run.points;
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i]; const q = pts[i + 1];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (L < 0.05) continue;
      let n = [-(q[1] - p[1]) / L, (q[0] - p[0]) / L];
      const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      // (toward the road: away from the run's side, the curb laid out from
      // the centre line by side × half; else the side nearer the centre line)
      if (run.side === 1 || run.side === -1) n = [-n[0] * run.side, -n[1] * run.side];
      else if (dist([m[0] + n[0] * 0.3, m[1] + n[1] * 0.3]) > dist([m[0] - n[0] * 0.3, m[1] - n[1] * 0.3])) n = [-n[0], -n[1]];
      const depth = Math.min(CURB_KEEP_OUT_M, dist(m));
      if (depth < 0.5) continue;
      const s0 = CURB_KEEP_OUT_SET_M;
      out.push([
        [p[0] + n[0] * s0, p[1] + n[1] * s0], [q[0] + n[0] * s0, q[1] + n[1] * s0],
        [q[0] + n[0] * depth, q[1] + n[1] * depth], [p[0] + n[0] * depth, p[1] + n[1] * depth],
      ]);
    }
  }
  // and each street's own carriageway: a side street's mouth has no curb, and
  // a walk carried on across it stood a hand's height proud of the road
  // (driveways and service roads aside: the sidewalk runs on across them)
  for (const cw of carriageways) {
    if (cw.highway === 'service' || !(cw.half > 1) || cw.nodes.length < 2) continue;
    const h = (i) => (cw.halfAt ? cw.halfAt[i] : cw.half) - CURB_KEEP_OUT_SET_M;
    for (let i = 0; i + 1 < cw.nodes.length; i++) {
      const p = cw.nodes[i]; const q = cw.nodes[i + 1];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (L < 0.05) continue;
      const ux = -(q[1] - p[1]) / L; const uy = (q[0] - p[0]) / L; const hp = h(i); const hq = h(i + 1);
      out.push([[p[0] + ux * hp, p[1] + uy * hp], [q[0] + ux * hq, q[1] + uy * hq], [q[0] - ux * hq, q[1] - uy * hq], [p[0] - ux * hp, p[1] - uy * hp]]);
    }
  }
  return out;
}
const CURB_KEEP_OUT_M = 6;
const CORNER_CUT_REACH_M = 3;      // how far in from a curb's face a walk is cut away
const CURB_KEEP_OUT_SET_M = 0.02;

// The road inside each rounded curb, to its curb's back: rings [[x, y]...]
// (from the square corner the curb cuts off, along the arc set in by the curb)
export function cornerCuts(corners) {
  const out = [];
  for (const corner of corners) {
    const { arc, centre } = corner;
    const inner = arc.map((p) => { const u = unit([centre[0] - p[0], centre[1] - p[1]]); return [p[0] + u[0] * CURB_W, p[1] + u[1] * CURB_W]; });
    // (the corner point a curb's width out past the curbs' faces: from their
    // own corner, or their backs', a sliver along each straight curb was left
    // uncut, and a walk's slab through it stood out past the rounded curb)
    const tangent = (p) => { const r = unit([p[0] - centre[0], p[1] - centre[1]]); return [-r[1], r[0]]; };
    const outer = (p) => { const r = unit([p[0] - centre[0], p[1] - centre[1]]); return [p[0] + r[0] * CURB_W, p[1] + r[1] * CURB_W]; };
    const o0 = outer(arc[0]); const o1 = outer(arc[arc.length - 1]);
    const apex = lineX(o0, tangent(arc[0]), o1, tangent(arc[arc.length - 1]));
    if (!apex) continue;
    // (out along the curbs' faces and across them at the curve's ends: the
    // curb's whole width cut where it bends, no sliver left beside it)
    // (and on past the corner point into the junction: between the curve's
    // end and the next street's own curb, outside both roads' drawn width, a
    // wedge of road was left where a walk's slab still stood)
    const out_ = unit([apex[0] - centre[0], apex[1] - centre[1]]);
    out.push([[apex[0] + out_[0] * CORNER_CUT_REACH_M, apex[1] + out_[1] * CORNER_CUT_REACH_M], o0, ...inner, o1]);
  }
  return out;
}

// A corner piece: the curb along the arc, the slab from the curb's top out to
// the corner of the two sidewalks' outer edges, and the back faces along them.
// The square corner a rounded curb cuts off: its road-side point, or null.
function cornerPoint(corner) {
  const { arc, centre } = corner;
  const tangent = (p) => { const r = unit([p[0] - centre[0], p[1] - centre[1]]); return [-r[1], r[0]]; };
  const p = arc[0]; const q = arc[arc.length - 1];
  return lineX(p, tangent(p), q, tangent(q));
}

// A rounded curb's slab, in plan: the band the sidewalks' width in from the
// curve (inner: one point per arc point, set in as far as the curve's
// centre allows), and the sidewalks' outer corner where it lies past that
// band (fan), else null. outline: the slab's outer edge from street a's
// side to street b's.
function cornerSlabOutline({ arc, centre, outer, a, b }) {
  const w = Math.max(a.run.width, b.run.width);
  const inward = arc.map(([x, y]) => unit([centre[0] - x, centre[1] - y]));
  const reach = arc.map(([x, y]) => Math.min(w, Math.hypot(centre[0] - x, centre[1] - y) - 0.1));
  const inner = arc.map((p, i) => [p[0] + inward[i][0] * reach[i], p[1] + inward[i][1] * reach[i]]);
  const k = Math.floor(arc.length / 2);
  // (the outer corner on the sidewalk side of the curve and past the band:
  // with a bare curb on one side its edges could meet out over the road)
  const past = (outer[0] - arc[k][0]) * inward[k][0] + (outer[1] - arc[k][1]) * inward[k][1];
  const fan = past > reach[k] + CORNER_FAN_PAST_M ? [outer[0], outer[1]] : null;
  const outline = fan ? [inner[0], fan, inner[inner.length - 1]] : inner;
  return { inner, outline, fan };
}
const CORNER_FAN_PAST_M = 0.05;

/**
 * The ground each rounded curb's slab paves, curb included: [[x, y]...]
 * rings. A walk mapped across the corner (a crossing's landing turning
 * behind the curb) lay over it on the slant, a triangle of grass between.
 */
export function cornerSlabRings(corners) {
  const out = [];
  for (const corner of corners) {
    const { arc, a, b } = corner;
    if (arc.length < 2 || Math.max(a.run.width, b.run.width) <= CURB_ONLY_M) continue;
    const { outline } = cornerSlabOutline(corner);
    out.push([...arc.map((q) => [q[0], q[1]]), ...[...outline].reverse()]);
  }
  return out;
}

function sweepCorner(builder, corner) {
  const { arc, centre, a, b } = corner;
  // (nothing on the road side of the curve: the road's own decals pave it; a
  // fill there floated over dips, stood grey in brick streets and, where the
  // streets met at a wide angle, reached out into the junction)
  const prof = profileFor(Math.min(a.run.width, b.run.width));
  const curbPts = prof.points.slice(0, 4);     // face, nose, top
  const inward = arc.map(([x, y]) => unit([centre[0] - x, centre[1] - y]));   // away from the road
  const stations = arc.map((p, i) => curbPts.map(([o, h]) => [p[0] + inward[i][0] * o, p[1] + inward[i][1] * o, p[2] + h]));
  let along = 0;
  for (let i = 0; i + 1 < arc.length; i++) {
    const step = Math.hypot(arc[i + 1][0] - arc[i][0], arc[i + 1][1] - arc[i][1]);
    const u0 = along / CURB_REPEAT_M;
    along += step;
    const u1 = along / CURB_REPEAT_M;
    const out = [(inward[i][0] + inward[i + 1][0]) / 2, (inward[i][1] + inward[i + 1][1]) / 2];
    for (let k = 0; k < 3; k++) {
      const [o0, h0] = curbPts[k];
      const [o1, h1] = curbPts[k + 1];
      const want = [-(h1 - h0) * out[0], -(h1 - h0) * out[1], o1 - o0];
      const [va, vb] = prof.segments[k].v;
      const a0 = stations[i][k]; const b0 = stations[i][k + 1];
      const a1 = stations[i + 1][k]; const b1 = stations[i + 1][k + 1];
      builder.tri('curb', a0, a1, b1, [u0, va], [u1, va], [u1, vb], want);
      builder.tri('curb', a0, b1, b0, [u0, va], [u1, vb], [u0, vb], want);
    }
  }
  // two bare curbs: no slab, the curb's back down into the filled ground
  if (Math.max(a.run.width, b.run.width) <= CURB_ONLY_M) {
    const [va, vb] = prof.segments[0].v;
    const foot = arc.map((p, i) => [p[0] + inward[i][0] * (CURB_W + BATTER), p[1] + inward[i][1] * (CURB_W + BATTER), p[2] - SINK]);
    for (let i = 0; i + 1 < arc.length; i++) {
      const want = [inward[i][0], inward[i][1], 0];
      builder.tri('curb', stations[i][3], stations[i + 1][3], foot[i + 1], [0, vb], [0.2, vb], [0.2, va], want);
      builder.tri('curb', stations[i][3], foot[i + 1], foot[i], [0, vb], [0.2, va], [0, va], want);
    }
    return;
  }
  // slab: a band the sidewalks' width along the curve, from the curb top's
  // back edge (and out to the sidewalks' outer corner where that lies
  // further out). A fan from that corner alone came to a point where the
  // streets met near square: a curb of 6 m left the slab 0.6 m wide at the
  // middle, the ground showing behind it.
  const slabZ = (z, w) => z + CURB_H + w * CROSS_SLOPE;
  const { inner, fan } = cornerSlabOutline(corner);
  const w = (a.run.width + b.run.width) / 2;
  const zAt = (i) => arc[i][2];
  const back = stations.map((st) => st[3]);
  const innerZ = inner.map((q, i) => [q[0], q[1], slabZ(zAt(i), w)]);
  const uvOf = (p) => [p[0] / SLAB_TILE_M, p[1] / SLAB_TILE_M];
  for (let i = 0; i + 1 < arc.length; i++) {
    builder.tri('slab', back[i], back[i + 1], innerZ[i + 1], uvOf(back[i]), uvOf(back[i + 1]), uvOf(innerZ[i + 1]), [0, 0, 1]);
    builder.tri('slab', back[i], innerZ[i + 1], innerZ[i], uvOf(back[i]), uvOf(innerZ[i + 1]), uvOf(innerZ[i]), [0, 0, 1]);
  }
  const zMid = (a.z + b.z) / 2;
  const O = fan ? [fan[0], fan[1], slabZ(zMid, w)] : null;
  if (O) for (let i = 0; i + 1 < innerZ.length; i++) builder.tri('slab', O, innerZ[i], innerZ[i + 1], uvOf(O), uvOf(innerZ[i]), uvOf(innerZ[i + 1]), [0, 0, 1]);
  // back faces: from the slab's outer edge down to the ground behind it
  const edge = O ? [innerZ[0], O, innerZ[innerZ.length - 1]] : innerZ;
  const arcMid = arc[Math.floor(arc.length / 2)];
  for (let i = 0; i + 1 < edge.length; i++) {
    const p = edge[i]; const q = edge[i + 1];
    const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const away = unit([mid[0] - arcMid[0], mid[1] - arcMid[1]]);
    const drop = (v) => [v[0] + away[0] * BACK_SLOPE_RUN * (v[2] - zMid + SINK), v[1] + away[1] * BACK_SLOPE_RUN * (v[2] - zMid + SINK), zMid - SINK];
    const want = [away[0], away[1], 0.5];
    builder.tri('curb', p, q, drop(q), [0, V_LIGHT_LOW], [0.2, V_LIGHT_LOW], [0.2, V_BAND_LOW], want);
    builder.tri('curb', p, drop(q), drop(p), [0, V_LIGHT_LOW], [0.2, V_BAND_LOW], [0, V_BAND_LOW], want);
  }
}

/**
 * Sidewalk meshes for the drawn carriageways: { meshes (THREE, world space),
 * runs, triangles }. Batches of RUNS_PER_MESH runs; names use letters (BeamNG
 * reads trailing digits of a Collada node name as a detail level).
 */
// (integer cell keys: a walk's every point looks up dozens of cells, and
// building strings for them took seconds of a dense 8 km map)
const wallCellKey = (cx, cy) => (cx + 32768) * 65536 + (cy + 32768);
function wallIndex(walls) {
  const cells = new Map();
  for (const wall of walls) {
    for (let i = 0; i + 1 < wall.length; i++) {
      const a = wall[i]; const b = wall[i + 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let s = 0; s <= L + 4; s += 4) {
        const f = Math.min(1, L ? s / L : 0);
        const key = wallCellKey(Math.floor((a[0] + (b[0] - a[0]) * f) / 8), Math.floor((a[1] + (b[1] - a[1]) * f) / 8));
        if (!cells.has(key)) cells.set(key, new Set());
        cells.get(key).add([a, b]);
      }
    }
  }
  return cells;
}

// The nearest point on a wall to (x, y) along (nx, ny), up to reach away, or null.
// across: the most a wall may turn from square to (nx, ny), as |cos| (1: any wall).
function wallAhead(cells, x, y, nx, ny, reach, across = 1) {
  let best = null; let d = reach;
  const cx = Math.floor(x / 8); const cy = Math.floor(y / 8); const r = Math.ceil(reach / 8);
  for (let i = -r; i <= r; i++) {
    for (let j = -r; j <= r; j++) {
      const list = cells.get(wallCellKey(cx + i, cy + j));
      if (!list) continue;
      for (const [a, b] of list) {
        const ex = b[0] - a[0]; const ey = b[1] - a[1];
        const det = nx * ey - ny * ex;
        if (Math.abs(det) < 1e-6) continue;
        if (Math.abs(ex * nx + ey * ny) > across * Math.hypot(ex, ey)) continue;
        const t = ((a[0] - x) * ey - (a[1] - y) * ex) / det; const u = ((a[0] - x) * ny - (a[1] - y) * nx) / det;
        if (t > 0 && t < d && u >= 0 && u <= 1) { d = t; best = t; }
      }
    }
  }
  return best;
}

// Decks from a walkway's edges out to any wall just past them: [{ edge, out }] stretches of points.
// A wall with water behind it (mapped, or ground at the sea) is decked out to from further, over ground no
// higher than the walk and clear of anything else (clear(x, y)).
function apronsOf(run, cells, { groundAt = null, seaZ = -Infinity, clear = () => true, wet = () => false } = {}) {
  const c = run.centre; const out = [];
  // the deck's height at the wall: the walk's, or over higher ground (null: too high, or in the way)
  const deckZ = (ex, ey, nx, ny, gap, z, sea) => {
    if (!groundAt) return sea ? null : z;
    if (sea) {
      const bx = ex + nx * (gap + SEAWALL_LOOK_M); const by = ey + ny * (gap + SEAWALL_LOOK_M);
      if (!wet(bx, by) && groundAt(bx, by) >= seaZ + WALK_SHORE_M) return null;
    }
    let top = z;
    for (let d = APRON_STEP_M; d < gap - 0.3; d += APRON_STEP_M) {
      const x = ex + nx * d; const y = ey + ny * d;
      if (sea && !clear(x, y)) return null;
      top = Math.max(top, groundAt(x, y) + APRON_COVER_M);
    }
    return top - z > (sea ? SEAWALL_RISE_M : APRON_RISE_M) ? null : top;
  };
  for (const sg of [1, -1]) {
    let cur = null;
    // (a seawall deck is a promenade: one along a short stretch of wall is a jog in it, left as ground)
    const flush = () => { if (cur && cur.edge.length >= 2 && (!cur.sea || cur.seaLen >= SEAWALL_MIN_LEN_M)) out.push(cur); cur = null; };
    c.forEach((p, i) => {
      const a = c[Math.max(0, i - 1)]; const b = c[Math.min(c.length - 1, i + 1)];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = (-(b[1] - a[1]) / L) * sg; const ny = ((b[0] - a[0]) / L) * sg;
      const ex = p[0] + nx * run.half; const ey = p[1] + ny * run.half;
      const walkTop = (p[2] ?? 0) + WALK_H;
      let gap = wallAhead(cells, ex, ey, nx, ny, APRON_MAX_M); let sea = false;
      if (gap === null) { gap = wallAhead(cells, ex, ey, nx, ny, SEAWALL_APRON_MAX_M, SEAWALL_ACROSS); sea = true; }
      const z = gap === null || gap < APRON_MIN_M ? null : deckZ(ex, ey, nx, ny, gap, walkTop, sea);
      if (z === null) { flush(); return; }
      const pt = { e: [ex - nx * 0.05, ey - ny * 0.05], o: [ex + nx * gap, ey + ny * gap], z };
      const push = (o, q) => { o.edge.push(q.e); o.out.push(q.o); o.z.push(q.z); };
      // a seawall stretch apart from a near wall's: it may be dropped (the step between belongs to it)
      if (cur && cur.sea !== sea) {
        const last = { e: cur.edge[cur.edge.length - 1], o: cur.out[cur.out.length - 1], z: cur.z[cur.z.length - 1] };
        if (cur.sea) push(cur, pt);
        flush();
        cur = { edge: [], out: [], z: [], seaLen: 0, sea };
        if (sea) push(cur, last);
      }
      cur ??= { edge: [], out: [], z: [], seaLen: 0, sea };
      const last = cur.edge[cur.edge.length - 1];
      if (sea && last) cur.seaLen += Math.hypot(pt.e[0] - last[0], pt.e[1] - last[1]);
      push(cur, pt);
    });
    flush();
  }
  return out;
}

/**
 * Sidewalks away from the curb, as raised slabs following the ground. paths:
 * drawn footways [{ nodes, half, sidewalk }]: those tagged footway=sidewalk, and
 * any other running along a street (a park's walks stay on the terrain).
 */
export function buildWalkRuns(paths, carriageways, { groundAt, driveways = [], buildings = [], walls = [], parking = [], water = [], seaZ = -Infinity } = {}) {
  if (!groundAt) return [];
  const inWater = water?.length ? buildingIndex(water) : () => false;
  const index = buildCarriagewayIndex(carriageways);
  const inBuilding = buildings?.length ? buildingIndex(buildings) : () => false;
  const inParking = parking?.length ? buildingIndex(parking) : () => false;
  const nearDriveway = buildLineIndex(driveways);
  const chosen = chainWalks((paths || []).filter((path) => {
    if (path.nodes.length < 2) return false;
    if (path.sidewalk) return true;
    const near = path.nodes.filter((q) => carriagewaysAt(index, q[0], q[1], WALK_STREET_M).length).length;
    return near >= WALK_STREET_SHARE * path.nodes.length;
  }));
  // the walkways' nodes on a grid: where two meet their slabs run on level
  const cells = new Map();
  const cell = (x, y) => `${Math.floor(x / WALK_JOIN_M)},${Math.floor(y / WALK_JOIN_M)}`;
  chosen.forEach((path, k) => {
    for (const q of path.nodes) {
      const key = cell(q[0], q[1]);
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push([k, q[0], q[1]]);
    }
  });
  const joinsAnother = (x, y, k, reach) => {
    const cx = Math.floor(x / WALK_JOIN_M); const cy = Math.floor(y / WALK_JOIN_M);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const [o, qx, qy] of cells.get(`${cx + dx},${cy + dy}`) || []) if (o !== k && Math.hypot(qx - x, qy - y) < reach) return true;
      }
    }
    return false;
  };
  // each walkway's final line first: only then are the ends of one where the next one is
  const lines = chosen.map((path, k) => {
    const { half } = path;
    // an end pointing at a road just ahead of it goes on to the road
    const reachRoad = (end, prev) => {
      if (joinsAnother(end[0], end[1], k, WALK_TOUCH_M)) return [];
      const L = Math.hypot(end[0] - prev[0], end[1] - prev[1]) || 1;
      const ux = (end[0] - prev[0]) / L; const uy = (end[1] - prev[1]) / L;
      if (carriagewaysAt(index, end[0], end[1], 0).length) return [];
      for (let d = 0.5; d <= WALK_REACH_M; d += 0.5) {
        const q = [end[0] + ux * d, end[1] + uy * d, 0];
        if (carriagewaysAt(index, q[0], q[1], 0).length) {
          const out = [];
          for (let e = 0.5; e <= d + 1e-6; e += 0.5) out.push([end[0] + ux * e, end[1] + uy * e, 0]);
          return out;
        }
      }
      return [];
    };
    // (its mapped corners rounded where it curves: a walk round a fountain;
    // repeated points dropped: a zero-length step threw its slab's edges out
    // into a wedge where two walks joined)
    // (a closed walk stays closed: its last point a hair from the one before
    // went as a repeat, and the ring, open now, kept a straight chord)
    const distinct = path.nodes.filter((q, i, a) => !i || Math.hypot(q[0] - a[i - 1][0], q[1] - a[i - 1][1]) > WALK_DUP_M);
    const n0 = path.nodes[0]; const nl = path.nodes[path.nodes.length - 1];
    if (path.nodes.length > 3 && Math.hypot(n0[0] - nl[0], n0[1] - nl[1]) < 1e-6) {
      const dl = distinct[distinct.length - 1];
      if (Math.hypot(dl[0] - n0[0], dl[1] - n0[1]) > 1e-6) distinct[distinct.length - 1] = n0;
    }
    const nodes = thinLine(smoothLine(dewobble(distinct.length >= 2 ? distinct : path.nodes)));
    const full = [...reachRoad(nodes[0], nodes[1]).reverse(), ...nodes, ...reachRoad(nodes[nodes.length - 1], nodes[nodes.length - 2])];
    const smooth = (xs, passes) => {
      let v = xs;
      for (let p = 0; p < passes; p++) v = v.map((x, i) => (v[Math.max(0, i - 1)] + 2 * x + v[Math.min(v.length - 1, i + 1)]) / 4);
      return v;
    };
    // a footway just off the curb is against it: the thin strip between closed
    const normals = full.map((q, i) => {
      const a = full[Math.max(0, i - 1)]; const b = full[Math.min(full.length - 1, i + 1)];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
    });
    // (from just off its line: a walk mapped partly over the drawn road's
    // edge is pushed clear of it, not cut where it touches and ramped down
    // to the road from both sides; its line itself on the road is a crossing)
    const rawShift = full.map((q, i) => {
      const [nx, ny] = normals[i];
      if (carriagewaysAt(index, q[0], q[1], 0).length) {
        // inside the road's edge (a mapped sidewalk where the street is drawn
        // wider than it: out past the curb on the side the edge is near;
        // crossings are built apart, footway=crossing)
        for (let d = 0.25; d <= WALK_INSIDE_MAX_M; d += 0.25) {
          for (const sg of [1, -1]) {
            if (!carriagewaysAt(index, q[0] + nx * sg * d, q[1] + ny * sg * d, 0).length) return { v: sg * (d + half + CURB_W), push: true };
          }
        }
        return { v: 0, push: false };
      }
      for (let d = 0.25; d <= half + WALK_SNAP_M; d += 0.25) {
        for (const sg of [1, -1]) {
          if (carriagewaysAt(index, q[0] + nx * sg * d, q[1] + ny * sg * d, 0).length) return { v: sg * (d - half - CURB_W), push: d < half + CURB_W };
        }
      }
      return { v: 0, push: false };
    });
    // (each push spread to its neighbours, then smoothed: smoothed alone it
    // pulled the walk back over the road where it came nearest; kept point
    // by point, the walk's edge zig-zagged in the search's steps)
    // (only a push off the road spread: the pull of a walk just off the curb
    // up against it stays its own)
    const spread = rawShift.map((r, i) => {
      let best = null;
      for (let k = Math.max(0, i - WALK_PUSH_SPREAD); k <= Math.min(rawShift.length - 1, i + WALK_PUSH_SPREAD); k++) {
        if (rawShift[k].push && (!best || Math.abs(rawShift[k].v) > Math.abs(best))) best = rawShift[k].v;
      }
      return best ?? r.v;
    });
    const shift = smooth(spread, 4);
    const pushed = full.map((q, i) => [q[0] + normals[i][0] * shift[i], q[1] + normals[i][1] * shift[i], 0]);
    // then up against the curb where pushed past it (the push overshot by its
    // search steps and its spread: a strip of ground showed between): a
    // finer look, a pull only, the smallest of its neighbours'
    const pull = pushed.map((q, i) => {
      if (!shift[i] || carriagewaysAt(index, q[0], q[1], 0).length) return 0;
      const [nx, ny] = normals[i];
      for (let d = half; d <= half + WALK_SNAP_M; d += 0.05) {
        for (const sg of [1, -1]) {
          if (carriagewaysAt(index, q[0] + nx * sg * d, q[1] + ny * sg * d, 0).length) return Math.sign(shift[i]) === -sg ? sg * Math.max(0, d - half - CURB_W) : 0;
        }
      }
      return 0;
    });
    const settle = pull.map((v, i) => {
      let best = v;
      for (let k = Math.max(0, i - 2); k <= Math.min(pull.length - 1, i + 2); k++) if (Math.abs(pull[k]) < Math.abs(best)) best = pull[k];
      return best;
    });
    // (the whole sideways move, push and pull, smoothed as one: point by
    // point it jittered a few centimetres, and where the push ended the walk
    // jogged a metre over in four, wobbling; each side's move is spread to
    // its neighbours within WALK_SHIFT_EASE_M, its largest, then averaged
    // over the same: smooth, eased out, never less than it was, so never
    // back over the curb)
    // (held where it meets another walk: eased there, its end was carried
    // off the junction it came out to)
    const held = full.map((q, i) => (joinsAnother(q[0], q[1], k, WALK_TOUCH_M) ? i : -1)).filter((i) => i >= 0);
    const lateral = easeShift(full, shift.map((v, i) => v + settle[i]), held);
    const snapped = full.map((q, i) => [q[0] + normals[i][0] * lateral[i], q[1] + normals[i][1] * lateral[i], 0]);
    // beside a street it is as high as the curb; away from one, on the ground
    // (a seawall's foot or a mapped end over the water isn't a dip in the walk)
    const heights = snapped.map((q) => {
      const road = carriagewaysAt(index, q[0], q[1], WALK_STREET_LEVEL_M)[0];
      return road ? road.z + CURB_H - WALK_H : groundAt(q[0], q[1]);
    });
    // (points out over the water take the shore's height, or it drags the end down)
    const wet = (v) => v < seaZ + WALK_SHORE_M;
    for (let i = 1; i < heights.length; i++) if (wet(heights[i]) && !wet(heights[i - 1])) heights[i] = heights[i - 1];
    for (let i = heights.length - 2; i >= 0; i--) if (wet(heights[i]) && !wet(heights[i + 1])) heights[i] = heights[i + 1];
    const roll = (xs, f) => xs.map((_, i) => f(...xs.slice(Math.max(0, i - WALK_DIP_NODES), i + WALK_DIP_NODES + 1)));
    const z = smooth(roll(roll(heights, Math.max), Math.min), 3);
    return snapped.map((q, i) => [q[0], q[1], z[i], 0]);
  });
  // an end at another walkway goes on to that walkway's middle
  const others = new Map();
  lines.forEach((line, k) => {
    for (let i = 0; i + 1 < line.length; i++) {
      const key = cell((line[i][0] + line[i + 1][0]) / 2, (line[i][1] + line[i + 1][1]) / 2);
      if (!others.has(key)) others.set(key, []);
      others.get(key).push([k, line[i], line[i + 1]]);
    }
  });
  const onAnother = (p, k) => {
    let best = null; let d = WALK_JOIN_M;
    const cx = Math.floor(p[0] / WALK_JOIN_M); const cy = Math.floor(p[1] / WALK_JOIN_M);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        for (const [o, a, b] of others.get(`${cx + dx},${cy + dy}`) || []) {
          if (o === k) continue;
          const ex = b[0] - a[0]; const ey = b[1] - a[1];
          const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / (ex * ex + ey * ey || 1)));
          const q = [a[0] + ex * u, a[1] + ey * u, a[2] + (b[2] - a[2]) * u, 0];
          const e = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (e < d) { d = e; best = q; }
        }
      }
    }
    return best;
  };
  let segments = null;
  const wallSegments = () => (segments ??= wallIndex(walls));
  const runs = [];
  lines.forEach((drawn, k) => {
    const { half } = chosen[k];
    const head = onAnother(drawn[0], k); const tail = onAnother(drawn[drawn.length - 1], k);
    // (its own points about the meeting dropped: an end mapped just past the
    // other walk's line, over the far half of its slab, doubled back to the
    // point on that line and folded up as a wedge)
    let body = drawn;
    while (head && body.length > 2 && Math.hypot(body[0][0] - head[0], body[0][1] - head[1]) < half + WALK_ATTACH_CLEAR_M) body = body.slice(1);
    while (tail && body.length > 2 && Math.hypot(body[body.length - 1][0] - tail[0], body[body.length - 1][1] - tail[1]) < half + WALK_ATTACH_CLEAR_M) body = body.slice(0, -1);
    const line = [...(head ? [head] : []), ...body, ...(tail ? [tail] : [])];
    // the sides of the slab off the road: it may run up to a road, not along one
    const sideOn = (x, y) => {
      // (the nearest point by squared distance in a plain loop: this runs for
      // every sample of every walk's cuts)
      let best = line[0]; let at = 0; let d = Infinity;
      for (let i = 0; i < line.length; i++) {
        const q = line[i]; const ex = q[0] - x; const ey = q[1] - y; const e = ex * ex + ey * ey;
        if (e < d) { d = e; best = q; at = i; }
      }
      const a = line[Math.max(0, at - 1)]; const b = line[Math.min(line.length - 1, at + 1)];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = -(b[1] - a[1]) / L * half; const ny = (b[0] - a[0]) / L * half;
      return isOnOtherCarriageway(index, x + nx, y + ny, WALK_ROAD_M, () => false) && isOnOtherCarriageway(index, x - nx, y - ny, WALK_ROAD_M, () => false) && !!best;
    };
    // (not a crosswalk's zone: it reaches a metre past the curb, and cut a
    // sidewalk running along the curb past the crossing; on the road is enough)
    const blocked = (x, y) => sideOn(x, y) || isOnOtherCarriageway(index, x, y, 0, () => false) || inBuilding(x, y) || inParking(x, y) || groundAt(x, y) < seaZ + WALK_SHORE_M;
    for (const piece of bridgeCorners(cutNodes(line, blocked, { minPieceM: 0.5 }), (x, y) => blocked(x, y) || isOnOtherCarriageway(index, x, y, WALK_ROAD_M, () => false), half)) {
      // (a crossing's landing between the sidewalk and the curb can be short)
      if (runLength(piece) < (chosen[k].crossing ? WALK_LANDING_M : WALK_MIN_M)) continue;
      const ends = [piece[0], piece[piece.length - 1]];
      const joined = [piece[0] === line[0] || Math.hypot(ends[0][0] - line[0][0], ends[0][1] - line[0][1]) < 0.01 ? !!head : false,
        Math.hypot(ends[1][0] - line[line.length - 1][0], ends[1][1] - line[line.length - 1][1]) < 0.01 ? !!tail : false];
      // (the cut above is only as fine as its sampling: an end at a road goes on to its edge)
      const toEdge = (q, prev) => {
        const L = Math.hypot(q[0] - prev[0], q[1] - prev[1]) || 1;
        for (let d = 0.1; d <= WALK_EDGE_M; d += 0.1) {
          const x = q[0] + ((q[0] - prev[0]) / L) * d; const y = q[1] + ((q[1] - prev[1]) / L) * d;
          if (carriagewaysAt(index, x, y, 0).length) return [x, y, q[2], q[3]];
        }
        return null;
      };
      if (!joined[0] && piece.length > 1) { const e = toEdge(piece[0], piece[1]); if (e) { piece.unshift(e); ends[0] = e; } }
      if (!joined[1] && piece.length > 1) { const e = toEdge(piece[piece.length - 1], piece[piece.length - 2]); if (e) { piece.push(e); ends[1] = e; } }
      // (not up to a road well above the walk, as one climbing on to a bridge: that stands up as a fin)
      const onRoad = ends.map((q, i) => {
        const road = joined[i] ? null : carriagewaysAt(index, q[0], q[1], WALK_CURB_M)[0] ?? null;
        return road && road.z - q[2] > WALK_RAMP_UP_M ? null : road;
      });
      // an end at a road comes down to the road; any other stays up (one at a seawall folded)
      const ramps = onRoad.map((road) => !!road);
      const stations = piece.filter((q, i, a) => !i || Math.hypot(q[0] - a[i - 1][0], q[1] - a[i - 1][1]) > WALK_DUP_M).map((q) => [...q]);
      if (stations.length < 2) continue;
      const total = runLength(stations);
      // (a stub that is all ramp, between where two walks join and the road:
      // a steep wedge over the walk beside it)
      if (total < WALK_STUB_M && ramps.some(Boolean)) continue;
      let s = 0;
      stations.forEach((q, i) => {
        if (i) s += Math.hypot(q[0] - stations[i - 1][0], q[1] - stations[i - 1][1]);
        for (const [road, d] of [[onRoad[0], s], [onRoad[1], total - s]]) {
          if (road && d < WALK_RAMP_M) q[2] += (road.z - q[2]) * (1 - d / WALK_RAMP_M);
        }
      });
      const points = offsetLine(stations, half).map((q) => [q[0], q[1], q[2]]);
      const run = { points, centre: stations.map((q) => [q[0], q[1], q[2]]), half, side: -1, width: half * 2, walk: true, ramps, caps: [true, true], highway: 'footway', roadEnds: ends.filter((_, i) => onRoad[i]).map((q) => [q[0], q[1], half]) };
      if (nearDriveway) run.dips = dipsAlong(points, (x, y) => nearDriveway(x, y, DRIVEWAY_HALF_M));
      if (walls.length) run.aprons = apronsOf(run, wallSegments(), { groundAt, seaZ, wet: inWater, clear: (x, y) => !inBuilding(x, y) && !inParking(x, y) && !isOnOtherCarriageway(index, x, y, 0, () => false) });
      runs.push(run);
    }
  });
  levelWalkJunctions(runs);
  return runs;
}

// A walk's mapped line with its small zig-zags taken out: a point within
// WOBBLE_M of the line through its neighbours eased onto it, a few passes
// (a hand-traced walk wandering a few centimetres from one point to the
// next came out with wobbly edges); a real corner stands off further and stays.
const WOBBLE_M = 0.25;
const WOBBLE_PASSES = 3;
function dewobble(nodes) {
  if (nodes.length < 3) return nodes;
  const closed = nodes.length > 3 && Math.hypot(nodes[0][0] - nodes[nodes.length - 1][0], nodes[0][1] - nodes[nodes.length - 1][1]) < 1e-6;
  let pts = nodes.map((q) => [...q]);
  for (let pass = 0; pass < WOBBLE_PASSES; pass++) {
    const next = pts.map((q) => [...q]);
    for (let i = 1; i + 1 < pts.length; i++) {
      const a = pts[i - 1]; const b = pts[i + 1]; const p = pts[i];
      const mx = (a[0] + b[0]) / 2; const my = (a[1] + b[1]) / 2;
      if (Math.hypot(p[0] - mx, p[1] - my) < WOBBLE_M) { next[i][0] = (p[0] + mx) / 2; next[i][1] = (p[1] + my) / 2; }
    }
    pts = next;
  }
  if (closed) pts[pts.length - 1] = [...pts[0]];
  return pts;
}

// A line's points within THIN_M of the straight line through the ones kept
// either side dropped, no stretch over THIN_MAX_M: rounding a bend spread
// over three points cut three corners, ten percent more slab for nothing.
const THIN_M = 0.01;
const THIN_MAX_M = 1;   // (no coarser: a walk is cut at a road at its points, and 2.5 m apart its ends fell short of the junctions they met)
function thinLine(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  let last = 0;
  for (let i = 1; i + 1 < pts.length; i++) {
    const a = pts[last]; const p = pts[i]; const b = pts[i + 1];
    const ex = b[0] - a[0]; const ey = b[1] - a[1]; const L = Math.hypot(ex, ey);
    const off = L > 1e-9 ? Math.abs(((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / L) : 0;
    // (the stretch from the last kept point to the next, every dropped point on it)
    let keep = off >= THIN_M || L > THIN_MAX_M;
    if (!keep) {
      for (let k = last + 1; k < i && !keep; k++) {
        const q = pts[k];
        if (Math.abs(((q[0] - a[0]) * ey - (q[1] - a[1]) * ex) / L) >= THIN_M) keep = true;
      }
    }
    if (keep) { out.push(p); last = i; }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// A sideways move along a line, smoothed (buildWalkRuns): each side's
// (positive and negative apart) the largest within WALK_SHIFT_EASE_M, then
// the mean over the same stretch, a smooth envelope never under the move.
const WALK_SHIFT_EASE_M = 3;
function easeShift(line, moves, held = []) {
  if (!moves.some((v) => Math.abs(v) > 1e-6)) return moves;
  const st = [0];
  for (let i = 1; i < line.length; i++) st.push(st[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const windowed = (vals, f) => vals.map((_, i) => {
    let a = i; let b = i;
    while (a > 0 && st[i] - st[a - 1] <= WALK_SHIFT_EASE_M) a--;
    while (b + 1 < vals.length && st[b + 1] - st[i] <= WALK_SHIFT_EASE_M) b++;
    return f(vals.slice(a, b + 1));
  });
  const envelope = (vals) => windowed(windowed(vals, (w) => Math.max(...w)), (w) => w.reduce((x, y) => x + y, 0) / w.length);
  const pos = envelope(moves.map((v) => Math.max(0, v)));
  const neg = envelope(moves.map((v) => Math.max(0, -v)));
  // (back to its own move toward each end and each held point: eased there,
  // an end coming out to a junction at the road was carried a metre and a
  // half off it)
  const total = st[st.length - 1];
  const anchors = [0, total, ...held.map((i) => st[i])];
  return pos.map((v, i) => {
    const w = Math.max(0, Math.min(1, ...anchors.map((a) => Math.abs(st[i] - a) / WALK_SHIFT_EASE_M)));
    return moves[i] + (v - neg[i] - moves[i]) * w;
  });
}

// Walk ways that carry on from one another at a shared node, one line: each
// was rounded on its own with its ends kept, so a ring mapped as two ways
// came out a rounded arc and a straight chord, folded where they met. At a
// node the two ends that run on straightest (within WALK_CHAIN_TURN) are
// joined; a third way there (a spur off the ring) stays its own.
const WALK_CHAIN_TURN = (60 * Math.PI) / 180;
const WALK_CHAIN_KEY = 0.01;
export function chainWalks(paths) {
  const key = (q) => `${Math.round(q[0] / WALK_CHAIN_KEY)},${Math.round(q[1] / WALK_CHAIN_KEY)}`;
  const same = (a, b) => Math.abs(a.half - b.half) < 0.05 && !!a.crossing === !!b.crossing && !!a.sidewalk === !!b.sidewalk && (a.surface || '') === (b.surface || '') && !!a.wood === !!b.wood;
  const closedPath = (p) => p.nodes.length > 2 && key(p.nodes[0]) === key(p.nodes[p.nodes.length - 1]);
  const ends = new Map();
  paths.forEach((p, k) => {
    if (closedPath(p)) return;
    const n = p.nodes;
    for (const atEnd of [false, true]) {
      const q = atEnd ? n[n.length - 1] : n[0]; const r = atEnd ? n[n.length - 2] : n[1];
      const L = Math.hypot(r[0] - q[0], r[1] - q[1]) || 1;
      const kq = key(q);
      if (!ends.has(kq)) ends.set(kq, []);
      ends.get(kq).push({ k, atEnd, out: [(r[0] - q[0]) / L, (r[1] - q[1]) / L] });
    }
  });
  const partner = new Map();   // `${k},${atEnd}` -> the end it joins
  for (const list of ends.values()) {
    if (list.length < 2) continue;
    const pairs = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]; const b = list[j];
        if (a.k === b.k || !same(paths[a.k], paths[b.k])) continue;
        // (straight on: the two leave the node in opposite directions)
        const turn = Math.PI - Math.acos(Math.max(-1, Math.min(1, a.out[0] * b.out[0] + a.out[1] * b.out[1])));
        if (turn < WALK_CHAIN_TURN) pairs.push([turn, a, b]);
      }
    }
    pairs.sort((x, y) => x[0] - y[0]);
    for (const [, a, b] of pairs) {
      const ka = `${a.k},${a.atEnd}`; const kb = `${b.k},${b.atEnd}`;
      if (partner.has(ka) || partner.has(kb)) continue;
      partner.set(ka, b); partner.set(kb, a);
    }
  }
  if (!partner.size) return paths;
  const used = new Set();
  const out = [];
  // from an end with no partner (or any end, for a loop), along the joins
  const follow = (k0, fromEnd) => {
    let nodes = []; let k = k0; let enter = fromEnd;
    for (;;) {
      used.add(k);
      const n = enter ? [...paths[k].nodes].reverse() : paths[k].nodes;
      nodes = nodes.length ? [...nodes, ...n.slice(1)] : [...n];
      const next = partner.get(`${k},${!enter}`);
      if (!next || used.has(next.k)) break;
      k = next.k; enter = next.atEnd;
    }
    return nodes;
  };
  paths.forEach((p, k) => {
    if (used.has(k)) return;
    if (partner.has(`${k},false`) && partner.has(`${k},true`)) return;   // in the middle of a chain
    out.push({ ...p, nodes: follow(k, partner.has(`${k},false`)) });
  });
  paths.forEach((p, k) => {
    if (used.has(k)) return;
    // what is left is loops: closed where they began
    const nodes = follow(k, false);
    if (key(nodes[0]) !== key(nodes[nodes.length - 1])) nodes.push(nodes[0]);
    out.push({ ...p, nodes });
  });
  return out;
}

// A walk cut where it clips a road's corner (mapped across the rounded curb
// it then carries on beside), joined again straight across, off the road:
// two pieces less than WALK_BRIDGE_M apart whose chord is clear, slab and all.
const WALK_BRIDGE_M = 10;
function bridgeCorners(pieces, blockedAt, half) {
  if (pieces.length < 2) return pieces;
  const clear = (a, b) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L > WALK_BRIDGE_M) return false;
    const nx = -(b[1] - a[1]) / (L || 1) * half; const ny = (b[0] - a[0]) / (L || 1) * half;
    for (let d = 0; d <= L + 1e-6; d += 0.25) {
      const t = L ? d / L : 0; const x = a[0] + (b[0] - a[0]) * t; const y = a[1] + (b[1] - a[1]) * t;
      if (blockedAt(x, y) || blockedAt(x + nx, y + ny) || blockedAt(x - nx, y - ny)) return false;
    }
    return true;
  };
  // (each end trimmed back up to WALK_BRIDGE_TRIM_M: they stop at the road's edge)
  const backs = (line, fromEnd) => {
    const out = []; let d = 0;
    for (let k = 0; k < line.length && d <= WALK_BRIDGE_TRIM_M; k++) {
      const i = fromEnd ? line.length - 1 - k : k;
      if (k) { const j = fromEnd ? i + 1 : i - 1; d += Math.hypot(line[i][0] - line[j][0], line[i][1] - line[j][1]); }
      if (line.length - k >= 2) out.push({ i, d });
    }
    return out;
  };
  const out = [pieces[0]];
  for (let i = 1; i < pieces.length; i++) {
    const prev = out[out.length - 1]; const next = pieces[i];
    let best = null;
    for (const a of backs(prev, true)) {
      for (const b of backs(next, false)) {
        if (best && a.d + b.d >= best.cost) continue;
        if (clear(prev[a.i], next[b.i])) best = { cost: a.d + b.d, a: a.i, b: b.i };
      }
    }
    if (best) out[out.length - 1] = [...prev.slice(0, best.a + 1), ...next.slice(best.b)];
    else out.push(next);
  }
  return out;
}
const WALK_BRIDGE_TRIM_M = 5;

// Where walks meet or cross, one height: each took its own from the ground
// or the curb, and where neither ends at the meeting (two crossing) nothing
// set them level: two slabs a few centimetres apart, one through the other.
// A crossing's landing ramping down to the road through a walk it passes
// ramped there too: a hole in the walk. Now each meeting is at the higher
// top of the walks there, out to its widest walk's edge, blended back over
// WALK_JUNCTION_BLEND_M; a ramp to the road starts past it.
const WALK_JUNCTION_BLEND_M = 3;
function levelWalkJunctions(runs) {
  const walks = runs.filter((r) => r.centre?.length >= 2);
  if (walks.length < 2) return;
  const stationsOf = (r) => { const s = [0]; for (let i = 1; i < r.centre.length; i++) s.push(s[i - 1] + Math.hypot(r.centre[i][0] - r.centre[i - 1][0], r.centre[i][1] - r.centre[i - 1][1])); return s; };
  for (const r of walks) r._s = stationsOf(r);
  const zAt = (r, st) => {
    const s = r._s; const c = r.centre;
    for (let i = 1; i < s.length; i++) if (st <= s[i] + 1e-9) { const t = (st - s[i - 1]) / ((s[i] - s[i - 1]) || 1); return c[i - 1][2] + (c[i][2] - c[i - 1][2]) * t; }
    return c[c.length - 1][2];
  };
  const topAt = (r, st) => zAt(r, st) + WALK_H * heightShare(r._s[r._s.length - 1], r.ramps, r.dips ?? [], r.rampM)(st);
  // segments on a grid
  const CELL = 8; const grid = new Map();
  walks.forEach((r, k) => {
    for (let i = 0; i + 1 < r.centre.length; i++) {
      const a = r.centre[i]; const b = r.centre[i + 1];
      for (let gx = Math.floor(Math.min(a[0], b[0]) / CELL); gx <= Math.floor(Math.max(a[0], b[0]) / CELL); gx++) {
        for (let gy = Math.floor(Math.min(a[1], b[1]) / CELL); gy <= Math.floor(Math.max(a[1], b[1]) / CELL); gy++) {
          const key = `${gx},${gy}`; if (!grid.has(key)) grid.set(key, []); grid.get(key).push([k, i]);
        }
      }
    }
  });
  const near = (x, y) => { const out = []; const cx = Math.floor(x / CELL); const cy = Math.floor(y / CELL); for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) out.push(...(grid.get(`${cx + dx},${cy + dy}`) || [])); return out; };
  // meetings: [{ x, y, at: Map(k -> station) }]
  const meetings = [];
  // (meetings in a grid of 1.5 m cells: the first one made within 1.5 m, as
  // a search of every meeting so far found it, which grew with the square)
  const MEET_M = 1.5;
  const meetCells = new Map();
  const add = (x, y, k1, s1, k2, s2) => {
    const cx = Math.floor(x / MEET_M); const cy = Math.floor(y / MEET_M);
    let m = null;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const o of meetCells.get((cx + dx) * 1048576 + (cy + dy)) || []) if (Math.hypot(o.x - x, o.y - y) < MEET_M && (!m || o.n < m.n)) m = o;
      }
    }
    if (!m) {
      m = { x, y, at: new Map(), n: meetings.length };
      meetings.push(m);
      const key = cx * 1048576 + cy;
      if (!meetCells.has(key)) meetCells.set(key, []);
      meetCells.get(key).push(m);
    }
    if (!m.at.has(k1)) m.at.set(k1, s1);
    if (!m.at.has(k2)) m.at.set(k2, s2);
  };
  walks.forEach((A, ka) => {
    for (let i = 0; i + 1 < A.centre.length; i++) {
      const a = A.centre[i]; const b = A.centre[i + 1];
      for (const [kb, j] of near((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) {
        if (kb <= ka) continue;
        const B = walks[kb]; const c = B.centre[j]; const d = B.centre[j + 1];
        const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
        if (Math.abs(den) < 1e-9) continue;
        const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den;
        const u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        add(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, ka, A._s[i] + (A._s[i + 1] - A._s[i]) * t, kb, B._s[j] + (B._s[j + 1] - B._s[j]) * u);
      }
    }
    // an end on another walk's slab
    for (const atEnd of [false, true]) {
      const e = atEnd ? A.centre[A.centre.length - 1] : A.centre[0];
      const se = atEnd ? A._s[A._s.length - 1] : 0;
      for (const [kb, j] of near(e[0], e[1])) {
        if (kb === ka) continue;
        const B = walks[kb]; const c = B.centre[j]; const d = B.centre[j + 1];
        const ex = d[0] - c[0]; const ey = d[1] - c[1];
        const u = Math.max(0, Math.min(1, ((e[0] - c[0]) * ex + (e[1] - c[1]) * ey) / (ex * ex + ey * ey || 1)));
        if (Math.hypot(c[0] + ex * u - e[0], c[1] + ey * u - e[1]) < B.half + 0.3) add(e[0], e[1], ka, se, kb, B._s[j] + (B._s[j + 1] - B._s[j]) * u);
      }
    }
  });
  if (!meetings.length) return;
  // per walk: its meetings' stations, zones and level
  const plans = new Map();
  for (const m of meetings) {
    const ks = [...m.at.keys()];
    const H = Math.max(...ks.map((k) => topAt(walks[k], m.at.get(k))));
    const R = Math.max(...ks.map((k) => walks[k].half)) + 0.3;
    for (const k of ks) { if (!plans.has(k)) plans.set(k, []); plans.get(k).push({ st: m.at.get(k), H, R }); }
  }
  for (const [k, list] of plans) {
    const r = walks[k]; const s = r._s; const total = s[s.length - 1];
    const own = r.centre.map((q) => q[2]);
    // a ramped end past a meeting: its ramp from the meeting's edge to the road
    const rampFrom = [null, null];
    if (r.ramps) {
      for (const [e, end] of [[0, 0], [1, total]]) {
        if (!r.ramps[e]) continue;
        const m = list.reduce((best, o) => (Math.abs(o.st - end) < Math.abs((best?.st ?? Infinity) - end) ? o : best), null);
        if (!m) continue;
        const D = Math.abs(end - m.st) - m.R;
        if (D < RAMP_M + WALK_JUNCTION_BLEND_M) {
          rampFrom[e] = { edge: e ? m.st + m.R : m.st - m.R, D: Math.max(0.3, D), H: m.H, roadZ: own[e ? own.length - 1 : 0] };
          r.rampM = r.rampM ?? [null, null];
          r.rampM[e] = Math.max(0.3, D);
        }
      }
    }
    r.centre.forEach((q, i) => {
      const st = s[i];
      let z = own[i];
      let best = Infinity;
      for (const { st: ms, H, R } of list) {
        const d = Math.abs(st - ms);
        if (d >= R + WALK_JUNCTION_BLEND_M || d >= best) continue;
        best = d;
        const level = H - WALK_H;
        z = d <= R ? level : level + (own[i] - level) * ((d - R) / WALK_JUNCTION_BLEND_M);
      }
      for (const [e, rf] of rampFrom.entries()) {
        if (!rf) continue;
        const d = e ? st - rf.edge : rf.edge - st;   // past the meeting's edge, toward the end
        if (d > 0) z = (rf.H - WALK_H) + (rf.roadZ - (rf.H - WALK_H)) * Math.min(1, d / rf.D);
      }
      q[2] = z;
      if (r.points?.[i]) r.points[i][2] = z;
    });
  }
  // an end at a meeting runs on past it by half its width: two square ends
  // meeting at a point at a slight angle left a wedge of ground between them
  // (the overlap is cut away with the other walks')
  for (const m of meetings) {
    const ks = [...m.at.keys()];
    const over = 0.5 * Math.min(...ks.map((k) => walks[k].half));
    for (const k of ks) {
      const r = walks[k]; const s = r._s; const total = s[s.length - 1]; const st = m.at.get(k);
      const e = st < WALK_JOIN_END_M ? 0 : st > total - WALK_JOIN_END_M ? 1 : -1;
      if (e < 0 || r.ramps?.[e] || r._over?.[e]) continue;
      const c = r.centre; const n = c.length;
      const [p, q] = e ? [c[n - 1], c[n - 2]] : [c[0], c[1]];
      const L = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1;
      const tip = [p[0] + ((p[0] - q[0]) / L) * over, p[1] + ((p[1] - q[1]) / L) * over, p[2]];
      if (e) c.push(tip); else { c.unshift(tip); if (r.dips) r.dips = r.dips.map(([a, b]) => [a + over, b + over]); }
      r.points = offsetLine(c, r.half).map((o) => [o[0], o[1], o[2]]);
      (r._over ??= [false, false])[e] = true;
    }
  }
  for (const r of walks) { delete r._s; delete r._over; }
}
const WALK_JOIN_END_M = 0.05;
const WALK_ATTACH_CLEAR_M = 0.3;

/**
 * Walkable structures clear of the ground: piers and footbridges from end to
 * end, over the water by DECK_CLEAR_M; a sidewalk mapped on a road bridge at
 * that deck's height. paths: [{ nodes, half, wood }], roads: the bridge
 * carriageways. Their posts stand wherever the deck is clear of the ground.
 */
export function buildDeckRuns(paths, bridges, { groundAt, seaZ = 0 } = {}) {
  if (!groundAt) return [];
  const index = bridges?.length ? buildCarriagewayIndex(bridges) : null;
  const least = seaZ + DECK_CLEAR_M;
  return (paths || []).filter((p) => p.nodes.length > 1).map((path) => {
    const { nodes, half } = path;
    // one level over the water, so piers that join meet; up only on to real ground
    // (a real stretch of it: a point on a seawall's face isn't land to stand on)
    const ground = nodes.map((q) => groundAt(q[0], q[1]));
    const onLand = (i) => {
      let run = 1;
      for (const step of [-1, 1]) for (let k = i + step; k >= 0 && k < ground.length && ground[k] > least + DECK_SHORE_M; k += step) run++;
      return ground[i] > least + DECK_SHORE_M && run >= DECK_LAND_NODES;
    };
    const raw = nodes.map((q, i) => {
      const road = index ? carriagewaysAt(index, q[0], q[1], DECK_ROAD_M)[0] : null;
      if (road) return road.z + CURB_H - WALK_H;
      return onLand(i) ? ground[i] : least;
    });
    let z = raw;
    for (let pass = 0; pass < 4; pass++) z = z.map((v, i) => (i === 0 || i === z.length - 1 ? v : (z[i - 1] + 2 * v + z[i + 1]) / 4));
    const onBridge = nodes.some((q) => index && carriagewaysAt(index, q[0], q[1], DECK_ROAD_M).length);
    const centre = nodes.map((q, i) => [q[0], q[1], z[i]]);
    const flat = centre.map((q) => [q[0], q[1], q[2], 0]);
    const points = offsetLine(flat, half).map((q) => [q[0], q[1], q[2]]);
    return { points, centre, half, side: -1, width: half * 2, walk: true, deck: true, onBridge, wood: !!path.wood, ramps: [false, false], caps: [true, true], highway: 'footway' };
  });
}

/**
 * Walls mapped as areas (a seawall, a rampart): their footprints, which edges
 * look over water, and how low the ground goes under the deck to come.
 * rings: closed outlines of points.
 */
function planWallDecks(rings, groundAt, seaZ = -Infinity) {
  const decks = [];
  for (const raw of rings || []) {
    let ring = raw.map((q) => [q[0], q[1]]);
    if (Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) < 0.01) ring = ring.slice(0, -1);
    if (ring.length < 3) continue;
    // points along the outline, so the deck follows the walls' tops
    const fine = ring.flatMap((a, i) => {
      const b = ring[(i + 1) % ring.length]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.round(L / WALL_POINT_M));
      return Array.from({ length: n }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    });
    const signed = fine.reduce((sum, p, i) => { const q = fine[(i + 1) % fine.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0);
    const sg = signed > 0 ? 1 : -1;
    const heights = fine.map(([x, y]) => groundAt(x, y)).sort((x, y) => x - y);
    const land = heights.filter((h) => h > seaZ + WALL_WATER_M);
    const high = (land.length ? land[Math.floor(land.length * 0.95)] : heights[heights.length - 1]) + WALL_INNER_LIFT_M;
    const wet = fine.map((p, i) => {
      const a = fine[(i + fine.length - 1) % fine.length]; const b = fine[(i + 1) % fine.length];
      const t = unit([b[0] - a[0], b[1] - a[1]]);
      return groundAt(p[0] + t[1] * sg * WALL_LOOK_M, p[1] - t[0] * sg * WALL_LOOK_M) < seaZ + WALL_WATER_M;
    });
    decks.push({ ring: fine, wet, high, seaZ, signed, under: high - WALL_SLOPE_DROP_M - WALL_GROUND_UNDER_M });
  }
  return decks;
}

/**
 * The decks across the walls' tops, built once the walls stand: each edge on
 * the highest wall beside it (wallTops: [{ x, y, z }]), so the walls are its
 * sides. With no wall there: a slope from the land to the water, faces round it.
 */
export function buildWallDeckMesh(decks, wallTops = [], { sidewalkLook } = {}) {
  if (!decks?.length) return null;
  const builder = new PartBuilder(null, sidewalkLook);
  const cells = new Map();
  for (const t of wallTops) {
    const key = `${Math.floor(t.x / 8)},${Math.floor(t.y / 8)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(t);
  }
  const topAt = (x, y) => {
    let best = null;
    const cx = Math.floor(x / 8); const cy = Math.floor(y / 8);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const t of cells.get(`${cx + i},${cy + j}`) || []) if (Math.hypot(t.x - x, t.y - y) < WALL_TOP_REACH_M && (best === null || t.z > best)) best = t.z;
      }
    }
    return best;
  };
  for (const { ring, wet, high, signed } of decks) {
    const tops = ring.map(([x, y]) => topAt(x, y));
    const walled = tops.filter((z) => z !== null).length >= WALL_SHARE * ring.length;
    const pts = ring.map(([x, y], i) => [x, y, (walled ? tops[i] : null) ?? (wet[i] ? high - WALL_SLOPE_DROP_M : high)]);
    if (walled) {
      for (let pass = 0; pass < 2; pass++) {
        const z = pts.map((q) => q[2]);
        pts.forEach((q, i) => {
          if (wet[i] === wet[(i + 1) % pts.length] && wet[i] === wet[(i + pts.length - 1) % pts.length]) q[2] = (z[(i + pts.length - 1) % pts.length] + 2 * z[i] + z[(i + 1) % pts.length]) / 4;
        });
      }
    }
    const uv = (p) => [p[0] / SLAB_TILE_M, p[1] / SLAB_TILE_M];
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(ring.map(([x, y]) => new THREE.Vector2(x, y)), [])) {
      builder.tri('slab', pts[a], pts[b], pts[c], uv(pts[a]), uv(pts[b]), uv(pts[c]), [0, 0, 1]);
    }
    if (walled) continue;
    const low = Math.min(...pts.map((q) => q[2])) - 3;
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length]; const dx = b[0] - a[0]; const dy = b[1] - a[1];
      const want = signed > 0 ? [dy, -dx, 0] : [-dy, dx, 0];
      const fa = [a[0], a[1], low]; const fb = [b[0], b[1], low];
      builder.tri('curb', a, b, fb, [0, V_LIGHT_LOW], [0.2, V_LIGHT_LOW], [0.2, V_BAND_LOW], want);
      builder.tri('curb', a, fb, fa, [0, V_LIGHT_LOW], [0.2, V_BAND_LOW], [0, V_BAND_LOW], want);
    });
  }
  return builder.toMesh('wall_decks', { smooth: true });
}


/**
 * Gutters at the foot of the curbs, a road's width in from them: lines of
 * [x, y, z], broken where a curb is lowered.
 */
export function gutterLines({ runs = [], corners = [] }) {
  const lines = [];
  const off = GUTTER_INSET_M;
  for (const run of runs) {
    const { points, share } = rampStations(run.points, run.ramps ?? [false, false], run.dips ?? []);
    let cur = [];
    const flush = () => { if (runLength(cur) >= GUTTER_MIN_M) lines.push(cur); cur = []; };
    points.forEach((p, i) => {
      if (share[i] < 0.99) { flush(); return; }
      const a = points[Math.max(0, i - 1)]; const b = points[Math.min(points.length - 1, i + 1)];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      cur.push([p[0] + ((b[1] - a[1]) / L) * run.side * off, p[1] - ((b[0] - a[0]) / L) * run.side * off, p[2]]);
    });
    flush();
  }
  for (const { arc, centre } of corners) {
    const line = arc.map((p) => { const u = unit([centre[0] - p[0], centre[1] - p[1]]); return [p[0] - u[0] * off, p[1] - u[1] * off, p[2]]; });
    if (line.length > 1) lines.push(line);
  }
  return lines;
}
// (the game's gutter1 decal: its opacity map leaves a narrow concrete pan
// at the curb, the rest clear)
const GUTTER_INSET_M = 0.125;   // (its middle: the decal's edge at the curb)
const GUTTER_MIN_M = 8;        // (shorter pieces only multiply objects)

/** The ground inside each wall deck's outline, down under it. */
export function lowerUnderWallDecks(decks, grid, set) {
  const { heightMap, width, height, worldSize, minHeight = 0 } = grid;
  let pixels = 0;
  for (const { ring, under } of decks || []) {
    const xs = ring.map((q) => q[0]); const ys = ring.map((q) => q[1]);
    const col = (x) => (x / worldSize + 0.5) * (width - 1); const row = (y) => (0.5 - y / worldSize) * (height - 1);
    for (let r = Math.max(0, Math.floor(row(Math.max(...ys)))); r <= Math.min(height - 1, Math.ceil(row(Math.min(...ys)))); r++) {
      for (let c = Math.max(0, Math.floor(col(Math.min(...xs)))); c <= Math.min(width - 1, Math.ceil(col(Math.max(...xs)))); c++) {
        const x = ((c / (width - 1)) - 0.5) * worldSize; const y = (0.5 - r / (height - 1)) * worldSize;
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const a = ring[i]; const b = ring[j];
          if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
        }
        const idx = r * width + c;
        if (inside && heightMap[idx] - minHeight > under) { set(idx, under + minHeight); pixels++; }
      }
    }
  }
  return pixels;
}

// A square bar between two points.
function metalBar(builder, a, b, r) {
  const d = unit3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  const side = unit3(Math.abs(d[2]) > 0.95 ? [1, 0, 0] : [d[1], -d[0], 0]);
  const up = [side[1] * d[2] - side[2] * d[1], side[2] * d[0] - side[0] * d[2], side[0] * d[1] - side[1] * d[0]];
  const at = (p, u, v) => [0, 1, 2].map((k) => p[k] + side[k] * u + up[k] * v);
  const c = [[-r, -r], [r, -r], [r, r], [-r, r]];
  c.forEach(([u, v], i) => {
    const [u2, v2] = c[(i + 1) % 4];
    const out = [0, 1, 2].map((k) => side[k] * (u + u2) + up[k] * (v + v2));
    const q0 = at(a, u, v); const q1 = at(a, u2, v2); const q2 = at(b, u2, v2); const q3 = at(b, u, v);
    builder.tri('metal', q0, q1, q2, [0, 0], [0.1, 0], [0.1, 1], out);
    builder.tri('metal', q0, q2, q3, [0, 0], [0.1, 1], [0, 1], out);
  });
}
const unit3 = (v) => { const L = Math.hypot(...v) || 1; return v.map((x) => x / L); };

// A flat plate as a thin quad, both faces.
function metalPlate(builder, a, b, c, d) {
  for (const want of [[0, 0, 1], [0, 0, -1]]) {
    builder.tri('metal', a, b, c, [0, 0], [1, 0], [1, 1], want);
    builder.tri('metal', a, c, d, [0, 0], [1, 1], [0, 1], want);
  }
}

// Handrails both sides from `a` to `b`, the walking line, posted every so often.
function handrails(builder, a, b, hw) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
  const nx = -(b[1] - a[1]) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1); const ny = (b[0] - a[0]) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1);
  const n = Math.max(2, Math.round(L / GANGWAY_POST_M));
  for (const sg of [1, -1]) {
    const off = (p, h) => [p[0] + nx * sg * hw, p[1] + ny * sg * hw, p[2] + h];
    for (const h of [GANGWAY_RAIL_M, GANGWAY_RAIL_M / 2]) metalBar(builder, off(a, h), off(b, h), h === GANGWAY_RAIL_M ? 0.025 : 0.015);
    for (let i = 0; i <= n; i++) {
      const p = a.map((v, k) => v + (b[k] - v) * (i / n));
      metalBar(builder, off(p, -0.05), off(p, GANGWAY_RAIL_M), 0.02);
    }
  }
}

/**
 * The way from the shore down to a deck: from its top [x, y, z] to its foot on
 * the deck, along the deck's line. A ramp if there is room for a gentle one,
 * else stairs. Returns the kind built.
 */
function buildGangway(builder, top, foot) {
  const run = Math.hypot(top[0] - foot[0], top[1] - foot[1]) || 1;
  const drop = top[2] - foot[2];
  const stairs = drop / run > GANGWAY_MAX_SLOPE;
  const nx = -(foot[1] - top[1]) / run; const ny = (foot[0] - top[0]) / run;
  const side = (p, sg) => [p[0] + nx * sg * GANGWAY_HALF_M, p[1] + ny * sg * GANGWAY_HALF_M, p[2]];
  for (const sg of [1, -1]) metalBar(builder, side([top[0], top[1], top[2] - 0.08], sg), side([foot[0], foot[1], foot[2] + 0.03], sg), 0.05);
  if (stairs) {
    const steps = Math.max(2, Math.round(drop / STAIR_RISE_M));
    for (let i = 0; i < steps; i++) {
      const f0 = i / steps; const f1 = (i + 1) / steps;
      const z = top[2] - drop * f1 + 0.01;
      const p = [top[0] + (foot[0] - top[0]) * f0, top[1] + (foot[1] - top[1]) * f0, z];
      const q = [top[0] + (foot[0] - top[0]) * f1, top[1] + (foot[1] - top[1]) * f1, z];
      metalPlate(builder, side(p, 1), side(p, -1), side(q, -1), side(q, 1));
    }
  } else {
    metalPlate(builder, side(top, 1), side(top, -1), side(foot, -1), side(foot, 1));
    const cleats = Math.round(Math.hypot(run, drop) / 0.4);
    for (let i = 1; i < cleats; i++) {
      const p = top.map((v, k) => v + (foot[k] - v) * (i / cleats));
      metalBar(builder, side([p[0], p[1], p[2] + 0.012], 1), side([p[0], p[1], p[2] + 0.012], -1), 0.012);
    }
  }
  handrails(builder, top, foot, GANGWAY_HALF_M);
  return stairs ? 'stairs' : 'ramp';
}

// Where a deck's end looks at higher ground just past it: the height and place to come down from.
function shoreAbove(end, prev, z, walkTop, groundAt) {
  const L = Math.hypot(end[0] - prev[0], end[1] - prev[1]) || 1;
  const ux = (end[0] - prev[0]) / L; const uy = (end[1] - prev[1]) / L;
  let best = null;
  for (let d = 0.5; d <= GANGWAY_REACH_M; d += 0.5) {
    const x = end[0] + ux * d; const y = end[1] + uy * d;
    const h = walkTop(x, y) ?? groundAt(x, y);
    if (h > z + GANGWAY_MIN_DROP_M && (!best || h > best[2] + 0.1)) best = [x, y, h];
    else if (best) break;
  }
  return best;
}

// Gangways at the ends of decks below the shore: the number of each kind.
function buildGangways(builder, deckRuns, walkRuns, groundAt) {
  const cells = new Map();
  for (const run of walkRuns) {
    for (const q of run.centre) {
      const key = `${Math.floor(q[0] / 4)},${Math.floor(q[1] / 4)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push([q[0], q[1], q[2] + WALK_H, run.half + 0.3]);
    }
  }
  const walkTop = (x, y) => {
    const cx = Math.floor(x / 4); const cy = Math.floor(y / 4);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const q of cells.get(`${cx + i},${cy + j}`) || []) if (Math.hypot(q[0] - x, q[1] - y) < q[3]) return q[2];
    return null;
  };
  const counts = { ramp: 0, stairs: 0 };
  for (const run of deckRuns) {
    if (run.onBridge) continue;
    const c = run.centre; const n = c.length;
    for (const [e, step] of [[0, 1], [n - 1, -1]]) {
      const end = c[e]; const deckTop = end[2] + WALK_H;
      const top = shoreAbove(end, c[e + step], deckTop, walkTop, groundAt);
      if (!top) continue;
      const drop = top[2] - deckTop;
      const walk = (want) => {
        let left = want;
        for (let i = e; i + step >= 0 && i + step < n; i += step) {
          const a = c[i]; const b = c[i + step]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (left <= L) { const f = left / (L || 1); return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f + WALK_H]; }
          left -= L;
        }
        return null;
      };
      const reach = Math.hypot(top[0] - end[0], top[1] - end[1]);
      // the gentle ramp if the deck has room for its foot, else stairs
      const foot = walk(Math.min(GANGWAY_MAX_RUN_M, drop / GANGWAY_SLOPE) - reach) ?? walk(Math.max(0.3, drop / STAIR_SLOPE - reach));
      if (!foot) continue;
      counts[buildGangway(builder, top, foot)]++;
    }
  }
  return counts;
}

// Square posts under a deck, in pairs along it, where it stands clear of the ground.
function deckPosts(builder, run, groundAt) {
  const c = run.centre; let next = 0; let s = 0;
  const mat = run.wood ? 'wood' : 'curb';
  c.forEach((p, i) => {
    if (i) s += Math.hypot(p[0] - c[i - 1][0], p[1] - c[i - 1][1]);
    if (s < next) return;
    next = s + DECK_POST_M;
    const a = c[Math.max(0, i - 1)]; const b = c[Math.min(c.length - 1, i + 1)];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / L; const ny = (b[0] - a[0]) / L;
    for (const sg of [1, -1]) {
      const x = p[0] + nx * sg * (run.half - 0.15); const y = p[1] + ny * sg * (run.half - 0.15);
      const low = groundAt(x, y) - 0.5; const high = p[2] + WALK_H - 0.1;
      if (high - low < 1) continue;
      const r = 0.13;
      const box = [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]];
      box.forEach((q, k) => {
        const w = box[(k + 1) % 4];
        const out = [(q[0] + w[0]) / 2 - x, (q[1] + w[1]) / 2 - y, 0];
        builder.tri(mat, [...q, low], [...w, low], [...w, high], [0, 0], [0.2, 0], [0.2, 1], out);
        builder.tri(mat, [...q, low], [...w, high], [...q, high], [0, 0], [0.2, 1], [0, 1], out);
      });
    }
  });
}

// A quad round segment a-b, `half` either side (and past its ends by `pad`).
function segmentQuad(a, b, half, pad = 0) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 1e-6) return null;
  const ux = (b[0] - a[0]) / L; const uy = (b[1] - a[1]) / L;
  const nx = -uy * half; const ny = ux * half;
  const a0 = [a[0] - ux * pad, a[1] - uy * pad]; const b0 = [b[0] + ux * pad, b[1] + uy * pad];
  const ring = [[a0[0] + nx, a0[1] + ny], [b0[0] + nx, b0[1] + ny], [b0[0] - nx, b0[1] - ny], [a0[0] - nx, a0[1] - ny]];
  return [[...ring, ring[0]]];
}


/**
 * Land shut in by walkways, roads and a seawall, paved level with the walks:
 * the plaza in a jog of a seawall beside a bridge, the strip between a
 * promenade and the wall. A hole in the union of everything that closes it,
 * small, along a wall with water past it for a good share of its edge, dry and
 * clear of buildings. Returns polygons (rings, closed) clear of the roads and
 * the curbside sidewalks.
 */
export function findWallPockets(walkRuns, streetRuns, carriageways, { walls = [], wallAreas = [], groundAt = null, seaZ = -Infinity, water = [], buildings = [] } = {}) {
  if (!walls?.length || !groundAt) return [];
  const inWater = water?.length ? buildingIndex(water) : () => false;
  const inBuilding = buildings?.length ? buildingIndex(buildings) : () => false;
  const wet = (x, y) => inWater(x, y) || groundAt(x, y) < seaZ + WALK_SHORE_M;
  // seawall segments: water just past one side
  const sea = [];
  for (const wall of walls) {
    for (let i = 0; i + 1 < wall.length; i++) {
      const a = wall[i]; const b = wall[i + 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.3) continue;
      const nx = -(b[1] - a[1]) / L; const ny = (b[0] - a[0]) / L;
      let hits = 0; let n = 0;
      for (let s = 0.5; s < L; s += 2) {
        const x = a[0] + ((b[0] - a[0]) * s) / L; const y = a[1] + ((b[1] - a[1]) * s) / L;
        n++; if (wet(x + nx * 2.5, y + ny * 2.5) || wet(x - nx * 2.5, y - ny * 2.5)) hits++;
      }
      if (n && hits >= n / 2) sea.push([a, b]);
    }
  }
  if (!sea.length) return [];
  const boxOf = (pts) => {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const q of pts) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
    return [x0, y0, x1, y1];
  };
  // (seawall segments, and below the closing shapes, in grids by their boxes:
  // every run, road and wall tested against every segment, and every closer
  // against every wall, grew with the square of the map)
  const seaGrid = boxGrid(sea.map(([a, b]) => [Math.min(a[0], b[0]) - POCKET_REACH_M, Math.min(a[1], b[1]) - POCKET_REACH_M, Math.max(a[0], b[0]) + POCKET_REACH_M, Math.max(a[1], b[1]) + POCKET_REACH_M]));
  const near = (box) => seaGrid.any(box);
  const closers = []; const cuts = [];
  const C = POCKET_CLOSE_M / 2;
  for (const run of walkRuns) {
    if (!near(boxOf(run.centre))) continue;
    for (let i = 0; i + 1 < run.centre.length; i++) { const q = segmentQuad(run.centre[i], run.centre[i + 1], run.half + C, C); if (q) closers.push(q); }
    for (const { edge, out } of run.aprons ?? []) { const ring = [...edge, ...[...out].reverse()]; closers.push([[...ring, ring[0]]]); }
  }
  for (const run of streetRuns) {
    if (run.points.length < 2 || !near(boxOf(run.points))) continue;
    const off = (run.width || 0) / 2;
    const mid = offsetLine(run.points, off * (run.side ?? 1));
    for (let i = 0; i + 1 < mid.length; i++) {
      const q = segmentQuad(mid[i], mid[i + 1], off + C, C); if (q) closers.push(q);
      const e = segmentQuad(mid[i], mid[i + 1], off, 0.05); if (e) cuts.push(e);
    }
  }
  for (const cw of carriageways) {
    if (cw.nodes.length < 2 || !near(boxOf(cw.nodes))) continue;
    for (let i = 0; i + 1 < cw.nodes.length; i++) {
      const q = segmentQuad(cw.nodes[i], cw.nodes[i + 1], cw.half + C, C); if (q) closers.push(q);
      const e = segmentQuad(cw.nodes[i], cw.nodes[i + 1], cw.half, 0.05); if (e) cuts.push(e);
    }
  }
  for (const wall of walls) {
    if (!near(boxOf(wall))) continue;
    for (let i = 0; i + 1 < wall.length; i++) { const q = segmentQuad(wall[i], wall[i + 1], C, C); if (q) closers.push(q); }
  }
  // (a wall mapped as an area has its own deck across the top)
  for (const ring of wallAreas || []) if (ring.length > 2 && near(boxOf(ring))) closers.push([[...ring.map((q) => [q[0], q[1]]), [ring[0][0], ring[0][1]]]]);
  if (!closers.length) return [];
  const levels = new Map();
  for (const run of walkRuns) {
    for (const q of run.centre) { const k = `${Math.floor(q[0] / 8)},${Math.floor(q[1] / 8)}`; if (!levels.has(k)) levels.set(k, []); levels.get(k).push(q); }
  }
  const walkLevel = (x, y) => {
    let best = null; let d = Infinity;
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        for (const q of levels.get(`${Math.floor(x / 8) + i},${Math.floor(y / 8) + j}`) || []) { const e = (q[0] - x) ** 2 + (q[1] - y) ** 2; if (e < d) { d = e; best = q; } }
      }
    }
    return best ? best[2] + WALK_H : null;
  };
  const onSea = (x, y) => sea.some(([a, b]) => {
    const dx = b[0] - a[0]; const dy = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy) < C + 0.4;
  });
  // (a union per seawall's own surroundings, rounded to the centimetre: one over
  // a whole town fails on near-touching edges more often than not)
  const round = (shape) => shape.map((ring) => ring.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]));
  const holes = []; const seen = new Set();
  const closerGrid = boxGrid(closers.map((sh) => boxOf(sh[0])));
  const seaStarts = boxGrid(sea.map(([a]) => [a[0], a[1], a[0], a[1]]));
  for (const wall of walls) {
    const [wx0, wy0, wx1, wy1] = boxOf(wall);
    if (!seaStarts.any([wx0, wy0, wx1, wy1])) continue;
    const local = closerGrid.overlapping([wx0 - POCKET_REACH_M, wy0 - POCKET_REACH_M, wx1 + POCKET_REACH_M, wy1 + POCKET_REACH_M]).map((k) => closers[k]);
    let union;
    try { union = polygonClipping.union(...local.map(round)); } catch { continue; }
    for (const polygon of union) {
      for (const hole of polygon.slice(1)) {
        const key = hole.slice(0, -1).map((q) => `${Math.round(q[0])},${Math.round(q[1])}`).sort()[0] + hole.length;
        if (!seen.has(key)) { seen.add(key); holes.push(hole); }
      }
    }
  }
  const out = [];
  let cutGrid = null;
  for (const polygon of [[null, ...holes]]) {
    for (const hole of polygon.slice(1)) {
      const ring = hole.slice(0, -1);
      const area = Math.abs(ringArea(ring));
      if (area < POCKET_MIN_M2 || area > POCKET_MAX_M2) continue;
      // along a seawall for a good share of its edge
      let edge = 0; let walled = 0;
      ring.forEach((p, i) => {
        const q = ring[(i + 1) % ring.length]; const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        for (let t = 0.25; t < L; t += 0.5) { edge++; if (onSea(p[0] + ((q[0] - p[0]) * t) / L, p[1] + ((q[1] - p[1]) * t) / L)) walled++; }
      });
      if (!edge || walled < POCKET_WALL_SHARE * edge) continue;
      // dry land, no building on it
      const [x0, y0, x1, y1] = boxOf(ring);
      let inside = 0; let bad = 0;
      for (let x = x0 + 0.5; x < x1; x += 1) {
        for (let y = y0 + 0.5; y < y1; y += 1) {
          if (!pointInRing(x, y, ring)) continue;
          inside++; if (wet(x, y) || inBuilding(x, y)) bad++;
        }
      }
      if (!inside || bad > inside * 0.1) continue;
      // out to the walks, roads and walls it was closed by
      const signed = ringArea(ring) > 0 ? 1 : -1;
      const grown = ring.map((p, i) => {
        const a = ring[(i - 1 + ring.length) % ring.length]; const b = ring[(i + 1) % ring.length];
        const n1 = [(p[1] - a[1]), -(p[0] - a[0])]; const n2 = [(b[1] - p[1]), -(b[0] - p[0])];
        const l1 = Math.hypot(...n1) || 1; const l2 = Math.hypot(...n2) || 1;
        const n = [n1[0] / l1 + n2[0] / l2, n1[1] / l1 + n2[1] / l2]; const ln = Math.hypot(...n) || 1;
        const cos = Math.max(0.5, (n[0] / ln) * (n1[0] / l1) + (n[1] / ln) * (n1[1] / l1));
        const d = (C + 0.1) / cos * signed;
        return [p[0] + (n[0] / ln) * d, p[1] + (n[1] / ln) * d];
      });
      const shape = [[...grown, grown[0]]];
      // ground well above the walks round it (a bridge's embankment) is left out, not climbed
      const high = [];
      for (let x = Math.floor(x0) - 1; x < x1 + 1; x += 1) {
        for (let y = Math.floor(y0) - 1; y < y1 + 1; y += 1) {
          const ref = walkLevel(x + 0.5, y + 0.5);
          if (ref !== null && groundAt(x + 0.5, y + 0.5) > ref + APRON_RISE_M) high.push([[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]]);
        }
      }
      let shapes = [shape];
      if (high.length) {
        try { shapes = polygonClipping.difference(round(shape), ...high); } catch { continue; }
      }
      cutGrid ??= boxGrid(cuts.map((cut) => boxOf(cut[0])));
      const nearCuts = cutGrid.overlapping([x0 - 2, y0 - 2, x1 + 2, y1 + 2]).map((k) => cuts[k]);
      for (const one of shapes) {
        let pieces;
        try { pieces = nearCuts.length ? polygonClipping.difference(round(one), ...nearCuts.map(round)) : [round(one)]; } catch { continue; }
        for (const piece of pieces) if (Math.abs(ringArea(piece[0].slice(0, -1))) >= POCKET_MIN_M2) out.push(piece);
      }
    }
  }
  return out;
}

// Boxes [x0, y0, x1, y1] in a grid of cells: which overlap a query box (their
// indices, in their order: callers keep the order a plain filter gave), or
// whether any does.
const BOX_GRID_CELL_M = 64;
function boxGrid(boxes) {
  const cells = new Map();
  const key = (gx, gy) => gx * 1048576 + gy;
  boxes.forEach((b, k) => {
    for (let gx = Math.floor(b[0] / BOX_GRID_CELL_M); gx <= Math.floor(b[2] / BOX_GRID_CELL_M); gx++) {
      for (let gy = Math.floor(b[1] / BOX_GRID_CELL_M); gy <= Math.floor(b[3] / BOX_GRID_CELL_M); gy++) {
        const c = key(gx, gy);
        if (!cells.has(c)) cells.set(c, []);
        cells.get(c).push(k);
      }
    }
  });
  const hits = (q, k) => boxes[k][0] <= q[2] && boxes[k][2] >= q[0] && boxes[k][1] <= q[3] && boxes[k][3] >= q[1];
  const visit = (q, fn) => {
    for (let gx = Math.floor(q[0] / BOX_GRID_CELL_M); gx <= Math.floor(q[2] / BOX_GRID_CELL_M); gx++) {
      for (let gy = Math.floor(q[1] / BOX_GRID_CELL_M); gy <= Math.floor(q[3] / BOX_GRID_CELL_M); gy++) {
        for (const k of cells.get(key(gx, gy)) || []) if (hits(q, k) && fn(k)) return true;
      }
    }
    return false;
  };
  return {
    any: (q) => visit(q, () => true),
    // whether test(k) holds for a box overlapping q
    some: (q, test) => visit(q, test),
    overlapping: (q) => { const found = new Set(); visit(q, (k) => { found.add(k); return false; }); return [...found].sort((a, b) => a - b); },
  };
}

// (a generator: at the strips' tops it yields a request, answered with
// their triangles worked out on other threads, or null to draw them here)
function* mergeWalks(builder, runs, { top = 'slab', edge = 'curb', pockets = [], streetRuns = [], groundAt = null, cuts = [] } = {}) {
  const stations = new Map();
  const CELL = 4;
  const strips = [];
  const station = (q) => { const key = `${Math.floor(q[0] / CELL)},${Math.floor(q[1] / CELL)}`; if (!stations.has(key)) stations.set(key, []); stations.get(key).push(q); };
  for (const run of runs) {
    const { points, share } = rampStations(run.centre, run.ramps, run.dips ?? [], run.rampM);
    const left = []; const right = []; const along = []; let s = 0;
    points.forEach((p, i) => {
      if (i) s += Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]);
      const a = points[Math.max(0, i - 1)]; const b = points[Math.min(points.length - 1, i + 1)];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      // mitred at a bend (the averaged normal at the half width fell short on
      // the outside of a sharp turn: a wedge cut out of the walk)
      let miter = 1;
      if (i > 0 && i < points.length - 1) {
        const ux = p[0] - a[0]; const uy = p[1] - a[1]; const ul = Math.hypot(ux, uy) || 1;
        const vx = b[0] - p[0]; const vy = b[1] - p[1]; const vl = Math.hypot(vx, vy) || 1;
        const cosHalf = Math.sqrt(Math.max(0, (1 + (ux * vx + uy * vy) / (ul * vl)) / 2));
        miter = 1 / Math.max(0.7, cosHalf);
      }
      const nx = -(b[1] - a[1]) / L * run.half * miter; const ny = (b[0] - a[0]) / L * run.half * miter;
      left.push([p[0] + nx, p[1] + ny]); right.push([p[0] - nx, p[1] - ny]);
      along.push({ x: p[0], y: p[1], s, tx: (b[0] - a[0]) / L, ty: (b[1] - a[1]) / L, z: p[2] + WALK_H * share[i] });
      const key = `${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`;
      if (!stations.has(key)) stations.set(key, []);
      stations.get(key).push([p[0], p[1], p[2] + WALK_H * share[i], p[2]]);
    });
    const ring = [...left, ...[...right].reverse()];
    strips.push({ shape: [[...ring, ring[0]]], left, right, along, half: run.half, length: s });
    for (const { edge, out, z } of run.aprons ?? []) {
      const deck = [...edge, ...[...out].reverse()];
      // the deck's far side at its own height, rising over ground higher than the walk
      if (z) out.forEach((q, k) => { const key = `${Math.floor(q[0] / CELL)},${Math.floor(q[1] / CELL)}`; if (!stations.has(key)) stations.set(key, []); stations.get(key).push([q[0], q[1], z[k], z[k] - WALK_H]); });
      strips.push({ shape: [[...deck, deck[0]]], left: edge, right: out, along, half: run.half, length: 0 });
    }
  }
  if (pockets.length) {
    // a paved pocket meets the curbside sidewalks at their tops
    for (const run of streetRuns) {
      if (run.points.length < 2 || !(run.width > CURB_ONLY_M)) continue;
      const outer = offsetLine(run.points, run.width * (run.side ?? 1));
      run.points.forEach((p, i) => { const z = p[2] + CURB_H + run.width * CROSS_SLOPE; station([outer[i][0], outer[i][1], z, z - WALK_H]); });
    }
    for (const shape of pockets) strips.push({ shape, pocket: true, length: 0 });
  }
  // the road inside a rounded curb kept clear (cuts: [[x, y]...] rings): a
  // walk mapped up to the corner reached over the curb onto it, its raised
  // edge standing there as a wedge
  const boxOfRing = (ring) => [Math.min(...ring.map((q) => q[0])), Math.min(...ring.map((q) => q[1])), Math.max(...ring.map((q) => q[0])), Math.max(...ring.map((q) => q[1]))];
  const cutRings = cuts.map((ring) => ({ shape: [[...ring, ring[0]].map(([x, y]) => [x, y])], box: boxOfRing(ring), cut: true }));
  // (a grid of them: one keep-out per curb segment runs to thousands)
  const cutsNear = makeCutFinder(cutRings);
  if (cuts.length) {
    const boxOf = boxOfRing;
    const kept = [];
    for (const strip of strips) {
      const b = boxOf(strip.shape[0]);
      const nearBox = cutsNear(b[0], b[1], b[2], b[3]);
      if (!nearBox.length) { kept.push(strip); continue; }
      // (only the cuts that reach the strip itself: of those near it by box,
      // about one in thirty does, and each other one made the clip dearer;
      // with none it still goes through the clip, which tidies its outline
      // into pieces as before)
      const near = nearBox.filter((c) => ringTouches(c.shape[0], strip.shape));
      // (polygon-clipping fails now and then on near-touching edges: rounded to
      // the centimetre, then cut by one ring at a time, skipping any that
      // fail; kept whole, a strip's outline stood as bare walls on the road
      // where its panels had been cut away)
      const r2 = (sh) => sh.map((ring) => ring.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]));
      let pieces = null;
      for (const attempt of [() => polygonClipping.difference(strip.shape, ...near.map((c) => c.shape)),
        () => polygonClipping.difference(r2(strip.shape), ...near.map((c) => r2(c.shape)))]) {
        try { pieces = attempt(); break; } catch { /* next */ }
      }
      if (!pieces) {
        pieces = [r2(strip.shape)];
        for (const c of near) {
          try { pieces = polygonClipping.difference(pieces, r2(c.shape)); } catch { /* this ring skipped */ }
        }
      }
      // (slivers left between a straight curb's face and its back: dropped)
      // (and long thin ones: by area alone a 5 cm sliver along a cut kept its
      // outline while each panel's piece of it was dropped, bare walls left)
      const perimeter = (ring) => ring.reduce((sum, q, i) => (i ? sum + Math.hypot(q[0] - ring[i - 1][0], q[1] - ring[i - 1][1]) : 0), 0);
      for (const shape of pieces) {
        const area = Math.abs(ringArea(shape[0])) - shape.slice(1).reduce((a, h) => a + Math.abs(ringArea(h)), 0);
        if (area >= CUT_SLIVER_M2 && (2 * area) / (perimeter(shape[0]) || 1) >= CUT_SLIVER_W_M) kept.push({ ...strip, shape, piece: true });
      }
    }
    strips.length = 0;
    strips.push(...kept);
  }
  if (!strips.length) return;
  const levelAt = makeLevelFinder(stations, CELL);
  const box = (strip) => {
    const ring = strip.shape[0]; const xs = ring.map((q) => q[0]); const ys = ring.map((q) => q[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };
  const order = [...strips].sort((a, b) => b.length - a.length);
  order.forEach((strip) => { strip.box = box(strip); });
  // (strips in a grid by their boxes: a strip's earlier neighbours found
  // there, not by testing every earlier strip, which grew with the square of
  // the map)
  const BOX_CELL = 64;
  const cellKey = (cx, cy) => cx * 1048576 + cy;
  const boxCells = new Map();
  order.forEach((o, rank) => {
    o.rank = rank;
    for (let gx = Math.floor(o.box[0] / BOX_CELL); gx <= Math.floor(o.box[2] / BOX_CELL); gx++) {
      for (let gy = Math.floor(o.box[1] / BOX_CELL); gy <= Math.floor(o.box[3] / BOX_CELL); gy++) {
        const k = cellKey(gx, gy);
        if (!boxCells.has(k)) boxCells.set(k, []);
        boxCells.get(k).push(o);
      }
    }
  });
  const earlierOverlapping = (strip) => {
    const found = new Set();
    const b = strip.box;
    for (let gx = Math.floor(b[0] / BOX_CELL); gx <= Math.floor(b[2] / BOX_CELL); gx++) {
      for (let gy = Math.floor(b[1] / BOX_CELL); gy <= Math.floor(b[3] / BOX_CELL); gy++) {
        for (const o of boxCells.get(cellKey(gx, gy)) || []) {
          if (o.rank < strip.rank && o.box[0] <= b[2] && o.box[2] >= b[0] && o.box[1] <= b[3] && o.box[3] >= b[1]) found.add(o);
        }
      }
    }
    return [...found].sort((p, q) => p.rank - q.rank);
  };
  // (each strip's part around a panel, cut once per cell: sidewalkPanels.js)
  const cropNear = makeCropper();
  // on a walk's edge: that walk's height; inside: the walks round about, blended
  const walks = strips.filter((o) => !o.pocket && o.length > 0);
  const edgeDist = (o, x, y) => {
    let d = Infinity;
    for (const line of [o.left, o.right]) {
      for (let k = 0; k + 1 < line.length; k++) {
        const a = line[k]; const b = line[k + 1]; const dx = b[0] - a[0]; const dy = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
        d = Math.min(d, Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy));
      }
    }
    return d;
  };
  const blended = (x, y) => {
    let w = 0; let sum = 0;
    const cx = Math.floor(x / CELL); const cy = Math.floor(y / CELL);
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        for (const q of stations.get(`${cx + dx},${cy + dy}`) || []) {
          const k = 1 / Math.max(0.25, (q[0] - x) ** 2 + (q[1] - y) ** 2) ** 2;
          w += k; sum += k * q[2];
        }
      }
    }
    if (w) return sum / w;
    const q = levelAt(x, y); return q ? q[2] : 0;
  };
  const pocketZ = (x, y) => {
    let z = null;
    for (const o of walks) {
      if (x < o.box[0] - 0.2 || x > o.box[2] + 0.2 || y < o.box[1] - 0.2 || y > o.box[3] + 0.2 || edgeDist(o, x, y) > 0.15) continue;
      let q = o.along[0]; let d = Infinity;
      for (const a of o.along) { const e = (a.x - x) ** 2 + (a.y - y) ** 2; if (e < d) { d = e; q = a; } }
      z = q.z; break;
    }
    z ??= blended(x, y);
    return [x, y, groundAt ? Math.max(z, groundAt(x, y) + APRON_COVER_M) : z];
  };
  // the strips' tops: worked out on other threads if the driver can
  // (buildSidewalkMeshesParallel), else drawn here, strip by strip
  const panelTris = yield { order, earlierOverlapping, cutRings, stations, cell: CELL };
  order.forEach((strip) => {
    const before = earlierOverlapping(strip);
    if (strip.pocket) {
      // in cells, each corner at the nearest walk's height (and over the ground)
      const uv = (q) => [q[0] / SLAB_TILE_M, q[1] / SLAB_TILE_M];
      let own;
      try { own = before.length ? polygonClipping.difference(strip.shape, ...before.map((o) => o.shape)) : [strip.shape]; } catch { own = [strip.shape]; }
      const [bx0, by0, bx1, by1] = strip.box;
      for (let x = Math.floor(bx0 / POCKET_CELL_M) * POCKET_CELL_M; x < bx1; x += POCKET_CELL_M) {
        for (let y = Math.floor(by0 / POCKET_CELL_M) * POCKET_CELL_M; y < by1; y += POCKET_CELL_M) {
          const cell = [[[x, y], [x + POCKET_CELL_M, y], [x + POCKET_CELL_M, y + POCKET_CELL_M], [x, y + POCKET_CELL_M], [x, y]]];
          for (const piece of polygonClipping.intersection(cell, own)) {
            const rings = piece.map((ring) => ring.slice(0, -1));
            const flat = rings.map((ring) => ring.map(([px, py]) => new THREE.Vector2(px, py)));
            const all = rings.flat().map(([px, py]) => pocketZ(px, py));
            for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(flat[0], flat.slice(1))) builder.tri(top, all[a], all[b], all[c], uv(all[a]), uv(all[b]), uv(all[c]), [0, 0, 1]);
          }
        }
      }
      return;
    }
    if (panelTris) {
      const f = panelTris.get(strip.rank);
      for (let i = 0; f && i < f.length; i += PANEL_TRI_FLOATS) {
        builder.tri(top, [f[i], f[i + 1], f[i + 2]], [f[i + 3], f[i + 4], f[i + 5]], [f[i + 6], f[i + 7], f[i + 8]],
          [f[i + 9], f[i + 10]], [f[i + 11], f[i + 12]], [f[i + 13], f[i + 14]], [0, 0, 1]);
      }
      return;
    }
    stripPanels(strip, { before, cutsNear, cropNear, levelAt }, (a, b, c, ua, ub, uc) => builder.tri(top, a, b, c, ua, ub, uc, [0, 0, 1]));
  });
  const pocketBoxes = strips.filter((o) => o.pocket).map((o) => o.box);
  // The walks' outline (where the curb face stands), merged a tile at a
  // time: one union of a whole city's strips took minutes and most of the
  // memory churn. Edges along a tile's own sides are the cut's, not the
  // walks', and get no face. (The grid is offset off round numbers: a real
  // edge exactly on a tile line would lose its face.)
  const OUTLINE_TILE_M = 256;
  const OUTLINE_TILE_OFF_M = 0.37;
  const tileIndex = (v) => Math.floor((v - OUTLINE_TILE_OFF_M) / OUTLINE_TILE_M);
  const byTile = new Map();
  for (const o of strips) {
    o.box ??= box(o);
    for (let tx = tileIndex(o.box[0]); tx <= tileIndex(o.box[2]); tx++) {
      for (let ty = tileIndex(o.box[1]); ty <= tileIndex(o.box[3]); ty++) {
        const k = cellKey(tx, ty);
        if (!byTile.has(k)) byTile.set(k, { tx, ty, list: [] });
        byTile.get(k).list.push(o);
      }
    }
  }
  // each tile's union (sidewalkPanels.js unionTile): on other threads if the
  // driver can (buildSidewalkMeshesParallel), else here
  const unionTiles = [...byTile.values()].map(({ tx, ty, list }) => {
    const tb = [tx * OUTLINE_TILE_M + OUTLINE_TILE_OFF_M, ty * OUTLINE_TILE_M + OUTLINE_TILE_OFF_M];
    tb.push(tb[0] + OUTLINE_TILE_M, tb[1] + OUTLINE_TILE_M);
    return { tb, shapes: list.map((o) => o.shape), boxes: list.map((o) => o.box), pockets: list.map((o) => !!o.pocket) };
  });
  const unioned = (yield { kind: 'unions', tiles: unionTiles }) || unionTiles.map(unionTile);
  const merged = [];
  unionTiles.forEach(({ tb }, i) => {
    // (null: the union failed even without the pockets: no edge there)
    for (const polygon of unioned[i] || []) merged.push({ polygon, tb });
  });
  const EDGE_ON_SIDE_M = 1e-3;
  const onTileSide = (a, b, tb) => (Math.abs(a[0] - tb[0]) < EDGE_ON_SIDE_M && Math.abs(b[0] - tb[0]) < EDGE_ON_SIDE_M)
    || (Math.abs(a[0] - tb[2]) < EDGE_ON_SIDE_M && Math.abs(b[0] - tb[2]) < EDGE_ON_SIDE_M)
    || (Math.abs(a[1] - tb[1]) < EDGE_ON_SIDE_M && Math.abs(b[1] - tb[1]) < EDGE_ON_SIDE_M)
    || (Math.abs(a[1] - tb[3]) < EDGE_ON_SIDE_M && Math.abs(b[1] - tb[3]) < EDGE_ON_SIDE_M);
  for (const { polygon, tb } of merged) {
    const rings = polygon.map((ring) => ring.slice(0, -1));
    const inPocket = (x, y) => groundAt && pocketBoxes.some((b) => x >= b[0] - 0.5 && x <= b[2] + 0.5 && y >= b[1] - 0.5 && y <= b[3] + 0.5);
    const all = rings.flat().map(([x, y]) => {
      const q = levelAt(x, y);
      return [x, y, inPocket(x, y) ? pocketZ(x, y)[2] : (q ? q[2] : 0), q ? q[3] : 0];
    });
    let at = 0;
    rings.forEach((ring, r) => {
      const area = ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0);
      const right = (area > 0) === (r === 0);   // the outside lies to the right of an outer ring run anticlockwise
      ring.forEach((_, i) => {
        const a = all[at + i]; const b = all[at + ((i + 1) % ring.length)];
        if (onTileSide(a, b, tb)) return;
        const dx = b[0] - a[0]; const dy = b[1] - a[1]; const L = Math.hypot(dx, dy) || 1;
        const want = right ? [dy / L, -dx / L, 0] : [-dy / L, dx / L, 0];
        const fa = [a[0], a[1], a[3] - WALK_SINK_M]; const fb = [b[0], b[1], b[3] - WALK_SINK_M];
        // (the curb texture's clean band: its lower one is dark road grime)
        builder.tri(edge, a, b, fb, [0, V_BAND_TOP], [0.2, V_BAND_TOP], [0.2, V_LIGHT_LOW], want);
        builder.tri(edge, a, fb, fa, [0, V_BAND_TOP], [0.2, V_LIGHT_LOW], [0, V_LIGHT_LOW], want);
      });
      at += ring.length;
    });
  }
}

/**
 * The sidewalks' meshes (see sidewalkMeshes). This one works on this thread
 * alone; buildSidewalkMeshesParallel hands the walkway tops to worker threads
 * where the platform has them, with the same result.
 */
export function buildSidewalkMeshes(carriageways, options = {}) {
  const gen = sidewalkMeshes(carriageways, options);
  let step = gen.next();
  while (!step.done) step = gen.next(null);
  return step.value;
}

export async function buildSidewalkMeshesParallel(carriageways, options = {}) {
  const gen = sidewalkMeshes(carriageways, options);
  let step = gen.next();
  while (!step.done) step = gen.next(step.value.kind === 'unions' ? await unionsOnWorkers(step.value) : await panelsOnWorkers(step.value));
  return step.value;
}

// The walks' outline tiles merged on worker threads (sidewalkPanels.js
// unionTiles), a few neighbouring tiles per work item; null (merged on this
// thread) where there are no worker threads or few tiles.
const PARALLEL_UNIONS_FROM = 64;
async function unionsOnWorkers({ tiles }) {
  if (tiles.length < PARALLEL_UNIONS_FROM || (await parallelThreads()) <= 1) return null;
  const GROUP = 4;
  const items = [];
  for (let i = 0; i < tiles.length; i += GROUP) items.push(tiles.slice(i, i + GROUP));
  const results = await parallelMap(items, {
    local: unionTilesLocal,
    module: new URL(['./sidewalk', 'Panels.js'].join(''), import.meta.url).href,
    fn: 'unionTiles',
  });
  return results.flat();
}

// Walkway tops on worker threads: the strips in 256 m tiles (by their boxes'
// middles), each tile one work item with everything its strips need (their
// earlier neighbours, the curb cuts and height stations in reach), the
// triangles back by strip (sidewalkPanels.js panelsForItem). Null (drawn on
// this thread) where there are no worker threads or too few strips to be
// worth handing out.
const PARALLEL_PANELS_FROM = 1500;
const PANEL_TILE_M = 256;
async function panelsOnWorkers({ order, earlierOverlapping, cutRings, stations, cell }) {
  const own = order.filter((s) => !s.pocket);
  if (own.length < PARALLEL_PANELS_FROM || (await parallelThreads()) <= 1) return null;
  const plain = (s) => ({ rank: s.rank, shape: s.shape, left: s.left, right: s.right, along: s.along, half: s.half, box: s.box, piece: !!s.piece });
  const tiles = new Map();
  for (const s of own) {
    const k = `${Math.floor((s.box[0] + s.box[2]) / 2 / PANEL_TILE_M)},${Math.floor((s.box[1] + s.box[3]) / 2 / PANEL_TILE_M)}`;
    if (!tiles.has(k)) tiles.set(k, []);
    tiles.get(k).push(s);
  }
  const reach = (LEVEL_REACH_CELLS + 1) * cell;
  // (the cut rings by grid cell: each tile looks up only those near its
  // strips; all of them against every tile took 18 s of a dense 8 km map)
  const CUT_GRID_M = 64;
  const cutGrid = new Map();
  cutRings.forEach((c, i) => {
    for (let gx = Math.floor(c.box[0] / CUT_GRID_M); gx <= Math.floor(c.box[2] / CUT_GRID_M); gx++) {
      for (let gy = Math.floor(c.box[1] / CUT_GRID_M); gy <= Math.floor(c.box[3] / CUT_GRID_M); gy++) {
        const k = `${gx},${gy}`;
        if (!cutGrid.has(k)) cutGrid.set(k, []);
        cutGrid.get(k).push(i);
      }
    }
  });
  const items = [...tiles.values()].map((list) => {
    const strips = new Map(); const before = {};
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const s of list) {
      strips.set(s.rank, s);
      before[s.rank] = earlierOverlapping(s).map((o) => { strips.set(o.rank, o); return o.rank; });
      x0 = Math.min(x0, s.box[0]); y0 = Math.min(y0, s.box[1]); x1 = Math.max(x1, s.box[2]); y1 = Math.max(y1, s.box[3]);
    }
    // (the cuts any of its strips' panels could find, in their order)
    const near = new Set();
    for (const s of list) {
      for (let gx = Math.floor(s.box[0] / CUT_GRID_M); gx <= Math.floor(s.box[2] / CUT_GRID_M); gx++) {
        for (let gy = Math.floor(s.box[1] / CUT_GRID_M); gy <= Math.floor(s.box[3] / CUT_GRID_M); gy++) {
          for (const i of cutGrid.get(`${gx},${gy}`) || []) near.add(i);
        }
      }
    }
    const cuts = [...near].sort((a, b) => a - b).map((i) => cutRings[i])
      .filter((c) => list.some((s) => c.box[0] <= s.box[2] && s.box[0] <= c.box[2] && c.box[1] <= s.box[3] && s.box[1] <= c.box[3]));
    const keys = new Set();
    for (const s of list) {
      for (let cx = Math.floor((s.box[0] - reach) / cell); cx <= Math.floor((s.box[2] + reach) / cell); cx++) {
        for (let cy = Math.floor((s.box[1] - reach) / cell); cy <= Math.floor((s.box[3] + reach) / cell); cy++) keys.add(`${cx},${cy}`);
      }
    }
    const nearStations = [...keys].filter((k) => stations.has(k)).map((k) => [k, stations.get(k)]);
    return { strips: [...strips.values()].map(plain), own: list.map((s) => s.rank), before, cuts, stations: nearStations, cell };
  });
  const results = await parallelMap(items, {
    local: panelsForItem,
    // (spelled in two: a bundler must not take it for an asset of the page)
    module: new URL(['./sidewalk', 'Panels.js'].join(''), import.meta.url).href,
    fn: 'panelsForItem',
  });
  const out = new Map();
  for (const list of results) for (const [rank, tris] of list) out.set(rank, tris);
  return out;
}

// (a generator: mergeWalks yields at the walkway tops, answered by the driver)
function* sidewalkMeshes(carriageways, options = {}) {
  const medians = findMedians(carriageways);
  const walkRuns = buildWalkRuns(options.walks, carriageways, options);
  const runs = buildSidewalkRuns(carriageways, { ...options, medians, walkEnds: walkRuns.flatMap((r) => r.roadEnds) });
  const medianRuns = buildMedianRuns(carriageways, medians, options);
  const corners = joinCorners(runs, buildCarriagewayIndex(carriageways), walkRuns);
  levelWalkEndsOnSidewalks(walkRuns, runs, corners);
  const paveAt = pavedWalkZones(carriageways, options.walks, { americas: options.americas });
  const meshes = [];
  let builder = new PartBuilder(paveAt, options.sidewalkLook);
  let inBatch = 0;
  let triangles = 0;
  const letters = (n) => { let s = ''; let k = n; do { s = String.fromCharCode(97 + (k % 26)) + s; k = Math.floor(k / 26) - 1; } while (k >= 0); return s; };
  const flush = () => {
    triangles += builder.triangles;
    const mesh = builder.toMesh(`sidewalks_${letters(meshes.length)}`);
    if (mesh) meshes.push(mesh);
    builder = new PartBuilder(paveAt, options.sidewalkLook);
    inBatch = 0;
  };
  for (const run of runs) {
    if (run.points.length < 2) continue;
    sweepRun(builder, run);
    if (++inBatch >= RUNS_PER_MESH) flush();
  }
  for (const corner of corners) {
    sweepCorner(builder, corner);
    if (++inBatch >= RUNS_PER_MESH) flush();
  }
  for (const run of medianRuns) {
    sweepRun(builder, run);
    if (++inBatch >= RUNS_PER_MESH) flush();
  }
  for (const run of medianRuns.gaps) paveGap(builder, run);
  flush();
  // (a union can fail on bad geometry: strips that overlap beat no sidewalks)
  let pockets = [];
  try {
    pockets = findWallPockets(walkRuns, runs, carriageways, options);
  } catch (err) {
    console.warn('Sidewalks: could not find the paved pockets by the seawalls:', err?.message);
  }
  try {
    yield* mergeWalks(builder, walkRuns, { pockets, streetRuns: runs, groundAt: options.groundAt, cuts: [...cornerCuts(corners), ...cornerSlabRings(corners), ...curbKeepOuts(runs, carriageways)] });
  } catch (err) {
    console.warn('Sidewalks: could not merge the walkways, drawing them apart:', err?.message);
    builder = new PartBuilder(paveAt, options.sidewalkLook);
    for (const run of walkRuns) sweepRun(builder, run);
  }
  flush();
  const deckRuns = buildDeckRuns(options.decks, options.bridgeRoads, options);
  for (const wood of [true, false]) {
    const set = deckRuns.filter((r) => r.wood === wood);
    try {
      yield* mergeWalks(builder, set, wood ? { top: 'wood', edge: 'wood' } : {});
    } catch (err) {
      console.warn('Sidewalks: could not merge the decks, drawing them apart:', err?.message);
      for (const run of set) sweepRun(builder, run);
    }
    // (a sidewalk on a road bridge hangs from its deck)
    for (const run of set) if (!run.onBridge) deckPosts(builder, run, options.groundAt);
  }
  const wallDecks = options.groundAt ? planWallDecks(options.wallAreas, options.groundAt, options.seaZ) : [];
  const gangways = options.groundAt ? buildGangways(builder, deckRuns, walkRuns, options.groundAt) : { ramp: 0, stairs: 0 };
  flush();
  // the deck's top under (x, y), for what stands on it, or null
  const deckCells = new Map();
  for (const run of deckRuns) {
    for (const q of run.centre) {
      const key = `${Math.floor(q[0] / 4)},${Math.floor(q[1] / 4)}`;
      if (!deckCells.has(key)) deckCells.set(key, []);
      deckCells.get(key).push([q[0], q[1], q[2] + WALK_H, run.half]);
    }
  }
  const deckAt = (x, y) => {
    let best = null; let d = Infinity;
    const cx = Math.floor(x / 4); const cy = Math.floor(y / 4);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const q of deckCells.get(`${cx + i},${cy + j}`) || []) {
          const e = Math.hypot(q[0] - x, q[1] - y);
          if (e < d && e < q[3] + 1.5) { d = e; best = q[2]; }
        }
      }
    }
    return best;
  };
  // (the ground behind a bare curb's corner is filled like that behind the curb)
  const cornerRuns = corners.filter((c) => Math.max(c.a.run.width, c.b.run.width) <= CURB_ONLY_M && c.arc.length > 1).map((c) => {
    const [p, q] = c.arc; const left = [-(q[1] - p[1]), q[0] - p[0]];
    const side = left[0] * (c.centre[0] - p[0]) + left[1] * (c.centre[1] - p[1]) >= 0 ? 1 : -1;
    return { points: c.arc.map((o) => [o[0], o[1], o[2]]), side, width: CURB_ONLY_M };
  });
  // (and level under the paving on the road side of every corner, and across a median's gap)
  const cornerGround = [...medianRuns.filter((r) => r.width <= MEDIAN_CURB_W + 0.01).map((r) => ({
    // (between a median's two curbs: its ground up to theirs)
    points: r.points.map((q) => [q[0], q[1], q[2] + 0.1]), side: r.side, width: MEDIAN_FILL_M, walk: true,
  })), ...medianRuns.gaps.map((r) => ({
    points: r.points.map((q) => [q[0], q[1], q[2] - WALK_H]), side: r.side, width: Math.max(...r.points.map((q) => q[3] || 0.3)) + 0.5, walk: true,
  })), ...corners.flatMap((c) => {
    const apex = cornerPoint(c);
    if (!apex) return [];
    const [p, q] = c.arc; const left = [-(q[1] - p[1]), q[0] - p[0]];
    const toApex = left[0] * (apex[0] - p[0]) + left[1] * (apex[1] - p[1]) >= 0 ? 1 : -1;
    return [{ points: c.arc.map((o) => [o[0], o[1], o[2] - WALK_H]), side: toApex, width: Math.hypot(apex[0] - p[0], apex[1] - p[1]) + 1, walk: true }];
  })];
  const result = { meshes, runs, corners, cornerRuns, cornerGround, medianRuns, walkRuns, deckRuns, deckAt, gangways, wallDecks, pockets, triangles };
  // (a test probe's look at what was built: scratch top-down plots)
  if (typeof globalThis.__MAPNG_SIDEWALK_PROBE === 'function') globalThis.__MAPNG_SIDEWALK_PROBE({ ...result, carriageways, options });
  return result;
}

// Ground under the sidewalks: a slab hangs at its road's height plus the
// curb, so where the terrain beside a road is lower (an embankment, a street
// climbing a hillside) it floated, and where higher it was buried. The ground
// under each slab is set just under its top, then blends back to the terrain
// past its back edge over a run sized to the height difference. No road's own
// surface is touched (runs already stop short of other carriageways).
const CURB_FILL_M = 1.5;
const FILLET_LIFT_M = 0.02;      // the paving across a median's gap, over the road
const PAVED_TILE_M = 11;        // (the road decals' texture length)
const PARKING_OPEN_M = 1.5;
const DIP_CLEAR_M = 0.05;        // the ground under a dipped slab, more than under a raised one
const GROUND_UNDER_M = 0.04;     // the terrain this far under the slab's top
const GROUND_BLEND_MIN_M = 1;
const GROUND_BLEND_MAX_M = 10;
const GROUND_BLEND_RUN = 2;      // 1 m of height difference blends over 2 m
const GROUND_ROAD_MARGIN_M = 0.3;

const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * Terrain edits that put the ground under every sidewalk run.
 *   grid: { heightMap, width, height, worldSize, minHeight } (raw heights;
 *         world z = raw - minHeight, world x, y centred, y north)
 * overhead(x, y, z, zTop): a deck or tunnel there (the ground is not raised).
 * Returns { pixels, apply(set) }: set(idx, raw) for every edited pixel.
 */
// pixel index -> [key, sum, n] in typed arrays (open addressing): a Map of
// small arrays for the millions of pixels by a dense city's sidewalks spent
// seconds allocating
class PixelClaims {
  constructor() { this.cap = 1 << 16; this.size = 0; this.alloc(this.cap); }
  alloc(cap) {
    this.idx = new Int32Array(cap).fill(-1); this.key = new Float64Array(cap); this.sum = new Float64Array(cap); this.n = new Uint32Array(cap);
  }
  slot(idx) {
    const mask = this.cap - 1; let h = Math.imul(idx, 0x9E3779B1) & mask;
    while (this.idx[h] !== -1 && this.idx[h] !== idx) h = (h + 1) & mask;
    return h;
  }
  grow() {
    const { idx, key, sum, n, cap } = this;
    this.cap = cap * 2; this.alloc(this.cap);
    for (let i = 0; i < cap; i++) if (idx[i] !== -1) { const h = this.slot(idx[i]); this.idx[h] = idx[i]; this.key[h] = key[i]; this.sum[h] = sum[i]; this.n[h] = n[i]; }
  }
  claim(idx, key, target) {
    let h = this.slot(idx);
    if (this.idx[h] === -1) {
      if ((this.size + 1) * 2 > this.cap) { this.grow(); h = this.slot(idx); }
      this.idx[h] = idx; this.key[h] = key; this.sum[h] = target; this.n[h] = 1; this.size++;
    } else if (key < this.key[h] - 1e-6) { this.key[h] = key; this.sum[h] = target; this.n[h] = 1; }
    else if (Math.abs(key - this.key[h]) <= 1e-6) { this.sum[h] += target; this.n[h]++; }
  }
}

export function gradeSidewalkGround(runs, carriageways, grid, { overhead = () => false } = {}) {
  const { heightMap, width, height, worldSize, minHeight = 0 } = grid;
  const toPixel = (x, y) => [(x / worldSize + 0.5) * (width - 1), (0.5 - y / worldSize) * (height - 1)];
  const toWorld = (c, r) => [((c / (width - 1)) - 0.5) * worldSize, (0.5 - r / (height - 1)) * worldSize];
  const index = buildCarriagewayIndex(carriageways);
  const onRoad = (x, y) => isOnOtherCarriageway(index, x, y, GROUND_ROAD_MARGIN_M, () => false);
  // per pixel: the best claim (smallest distance out past a slab; inside a
  // slab 0, averaged among slabs)
  const best = new PixelClaims();
  for (const run of runs || []) {
    const p = run.points;
    // (behind a bare curb the ground itself is filled up to its top)
    const w = run.walk ? run.width : run.width <= CURB_ONLY_M ? CURB_FILL_M : run.width + CURB_W;
    const rise = run.walk ? WALK_H : CURB_H;
    const inward = run.walk ? GROUND_BLEND_MIN_M * 3 : 0;   // (a walkway's ground blends away on both sides)
    const total = runLength(p);
    const shareAt = heightShare(total, run.ramps ?? [false, false], run.dips ?? []);
    let along = 0;
    for (let i = 0; i + 1 < p.length; i++) {
      const [ax, ay, az] = p[i]; const [bx, by, bz] = p[i + 1];
      const dx = bx - ax; const dy = by - ay; const L2 = dx * dx + dy * dy;
      if (L2 < 1e-6) continue;
      const L = Math.sqrt(L2);
      const s0 = along; along += L;
      // outward: left of travel for side 1, right for side -1
      const nx = (-dy / L) * run.side; const ny = (dx / L) * run.side;
      const zTop = (az + bz) / 2 + CURB_H + CROSS_SLOPE * w;
      const reach = w + GROUND_BLEND_MAX_M;
      const xs = [ax - nx * inward, bx - nx * inward, ax + nx * reach, bx + nx * reach]; const ys = [ay - ny * inward, by - ny * inward, ay + ny * reach, by + ny * reach];
      const [c0, r0] = toPixel(Math.min(...xs), Math.max(...ys));
      const [c1, r1] = toPixel(Math.max(...xs), Math.min(...ys));
      for (let r = Math.max(0, Math.floor(r0)); r <= Math.min(height - 1, Math.ceil(r1)); r++) {
        for (let c = Math.max(0, Math.floor(c0)); c <= Math.min(width - 1, Math.ceil(c1)); c++) {
          const x = ((c / (width - 1)) - 0.5) * worldSize; const y = (0.5 - r / (height - 1)) * worldSize;
          const t = ((x - ax) * dx + (y - ay) * dy) / L2;
          if (t < 0 || t > 1) continue;
          const o = (x - ax) * nx + (y - ay) * ny;   // out from the curb line
          if (o < -inward || o > reach) continue;
          const idx = r * width + c;
          const ground = heightMap[idx] - minHeight;
          const zRoad = az + (bz - az) * t;
          // (the ground goes down with the slab at a driveway or a loose end)
          const share = shareAt(s0 + t * L);
          const top = zRoad + (rise + (run.walk ? 0 : CROSS_SLOPE * Math.max(0, Math.min(o, w)))) * share - (run.walk ? WALK_UNDER_M : GROUND_UNDER_M) - DIP_CLEAR_M * (1 - share);
          const past = o > w ? o - w : o < 0 ? -o : 0;
          let key; let target;
          // (a walkway's own ground comes first: a curb's fill beside it came up through the slab)
          if (!past) { key = run.walk ? -1 : 0; target = top; } else {
            const blend = Math.min(GROUND_BLEND_MAX_M, Math.max(GROUND_BLEND_MIN_M, Math.abs(ground - top) * GROUND_BLEND_RUN));
            const f = past / blend;
            if (f >= 1) continue;
            key = past; target = top + (ground - top) * smooth01(f);
          }
          best.claim(idx, key, target);
        }
      }
    }
  }
  const edits = [];
  for (let h = 0; h < best.cap; h++) {
    const idx = best.idx[h];
    if (idx === -1) continue;
    const sum = best.sum[h]; const n = best.n[h];
    const r = Math.floor(idx / width); const c = idx - r * width;
    const [x, y] = toWorld(c, r);
    if (onRoad(x, y)) continue;
    const z = sum / n;
    // (never raised up into a deck or tunnel over it)
    if (z > heightMap[idx] - minHeight && overhead(x, y, z, z + 6)) continue;
    edits.push([idx, z + minHeight]);
  }
  return { pixels: edits.length, apply(set) { for (const [idx, v] of edits) set(idx, v); } };
}

/**
 * How well the sidewalks sit on the terrain: every 2 m along each run, at
 * the slab's middle and back edge, the terrain against the slab's top.
 * Floating: a gap under the slab deeper than its faces reach (CURB_H + SINK);
 * buried: the terrain over the slab's top. groundAt(x, y): world z.
 */
export function checkSidewalkGround(runs, groundAt, { step = 2 } = {}) {
  let samples = 0; let floating = 0; let buried = 0; let worst = null;
  const list = [];
  const FLOAT_M = CURB_H + SINK + 0.1;
  const BURIED_M = 0.08;
  for (const run of runs || []) {
    const p = run.points;
    const w = run.width + CURB_W;
    let carry = 0;
    for (let i = 0; i + 1 < p.length; i++) {
      const [ax, ay, az] = p[i]; const [bx, by, bz] = p[i + 1];
      const L = Math.hypot(bx - ax, by - ay);
      if (L < 1e-6) continue;
      const nx = (-(by - ay) / L) * run.side; const ny = ((bx - ax) / L) * run.side;
      for (let s = carry; s <= L; s += step) {
        const t = s / L;
        const x0 = ax + (bx - ax) * t; const y0 = ay + (by - ay) * t; const zr = az + (bz - az) * t;
        for (const o of [w / 2, w - 0.05]) {
          const top = zr + CURB_H + CROSS_SLOPE * o;
          const g = groundAt(x0 + nx * o, y0 + ny * o);
          if (!Number.isFinite(g)) continue;
          samples++;
          const gap = top - g;
          if (gap > FLOAT_M) floating++;
          else if (-gap > BURIED_M) buried++;
          if (gap > FLOAT_M || -gap > BURIED_M) {
            list.push([Math.round(x0 + nx * o), Math.round(y0 + ny * o), Math.round(gap * 100) / 100, run.highway, run.width]);
            if (!worst || Math.abs(gap) > Math.abs(worst.gap)) worst = { gap: Math.round(gap * 100) / 100, at: [Math.round(x0 + nx * o), Math.round(y0 + ny * o)], road: run.highway };
          }
        }
      }
      carry = (carry - L) % step; if (carry < 0) carry += step;
    }
  }
  return { samples, floating, buried, worst, list: globalThis.__MAPNG_SW_LIST ? list : undefined };
}
