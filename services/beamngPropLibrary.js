// Stock BeamNG street props placed by services/streetProps.js (after
// BeamNG.Earth's trees.lua catalog). The shapeFile lines are also what
// scripts/build-shape-material-library.py reads for the "prop_library" set,
// so every material these shapes bind ships with the export.
//
// Hydrants and bins are Forest items (instanced, orientation free); the
// utility pole and its lamp are TSStatics, because the wires have to meet the
// pole's cross-arm exactly.

// Forest item data, from the official levels' own managedItemData.
export const PROP_ITEMS = {
  mapng_prop_hydrant: {
    name: 'mapng_prop_hydrant',
    internalName: 'mapng_prop_hydrant',
    class: 'TSForestItemData',
    annotation: 'OBSTACLES',
    radius: 0.2,
    shapeFile: '/levels/west_coast_usa/art/shapes/objects/hydrant1.dae',
  },
  mapng_prop_bin_round: {
    name: 'mapng_prop_bin_round',
    internalName: 'mapng_prop_bin_round',
    class: 'TSForestItemData',
    annotation: 'OBSTACLES',
    radius: 0.3,
    shapeFile: '/art/shapes/garage_and_dealership/Clutter/clutter_city_bin_round.dae',
  },
  mapng_prop_bin_wcusa: {
    name: 'mapng_prop_bin_wcusa',
    internalName: 'mapng_prop_bin_wcusa',
    class: 'TSForestItemData',
    annotation: 'OBSTACLES',
    radius: 0.3,
    shapeFile: '/levels/west_coast_usa/art/shapes/objects/garbage_bin_a.dae',
  },
};

export const PROP_HYDRANT = 'mapng_prop_hydrant';
export const PROP_BINS = ['mapng_prop_bin_round', 'mapng_prop_bin_wcusa'];

// TSStatics.
export const PROP_SHAPES = {
  // utility poles (streetProps POLE_TYPES), each with a Colmesh the game takes
  poleWoodWide: { shapeFile: '/levels/automation_test_track/art/shapes/objects/powerpole.dae' },
  poleWoodTown: { shapeFile: '/levels/east_coast_usa/art/shapes/buildings/electrical_pole.dae' },
  poleWoodShort: { shapeFile: '/levels/johnson_valley/art/shapes/power_lines/electric_pole_02.dae' },
  poleWoodArm: { shapeFile: '/levels/johnson_valley/art/shapes/power_lines/electric_pole_01.dae' },
  poleWoodTall: { shapeFile: '/levels/west_coast_usa/art/shapes/objects/powerpole4.dae' },
  poleSteel: { shapeFile: '/levels/johnson_valley/art/shapes/power_lines/metal_pole.dae' },
  poleLamp: { shapeFile: '/levels/east_coast_usa/art/shapes/buildings/electrical_pole_lamp.dae' },
  // a sign's post (West Coast USA's, 2.4 m, 0.43 of it below ground)
  signPost: { shapeFile: '/levels/west_coast_usa/art/shapes/objects/pole_fence2.dae' },
  // a clipped hedge piece (Italy's): 2.3 m along local X, centred, 0.85 m
  // deep, 1.64 m tall; laid end to end along barrier=hedge
  hedge: { shapeFile: '/levels/italy/art/shapes/trees/trees_italy/cypress_hedge_3m.dae' },
  // what a building is used for (beamngBuildings.js useDetails): a rooftop
  // HOTEL sign (6.2 m wide, its face in local XZ), the US flag on its wall
  // bracket, a café's small wall sign (yawOffset: from the street-facing
  // direction: the signs' faces lie along local X, facing local -Y; the
  // flag's pole reaches out along local -X)
  hotelSign: { shapeFile: '/levels/italy/art/shapes/buildings/italy_billboard_hotel_big.dae', yawOffset: -Math.PI / 2 },
  flagWall: { shapeFile: '/levels/east_coast_usa/art/shapes/buildings/eca_flag_usa.dae', yawOffset: Math.PI },
  cafeSign: { shapeFile: '/levels/east_coast_usa/art/shapes/buildings/eca_comsign_cafe.dae', yawOffset: -Math.PI / 2, scale: 1.6 },
  // a court's chain-link fence (services/sportsFields.js): Hirochi's
  // pedestrian fence, a 2.16 m panel along local +y from its post (turned a
  // quarter so +y runs back along the fence)
  courtFence: { shapeFile: '/levels/hirochi_raceway/art/shapes/objects/fence_pedestrian.dae', yawOffset: Math.PI / 2 },
  // racetracks (services/racetracks.js): a drag strip's light tree, kart
  // tyre walls and concrete barriers (4.16 m / 4.0 m along local x)
  dragTree: { shapeFile: '/levels/gridmap_v2/art/shapes/grid/s_gm_dragstrip_tree.dae' },
  raceTyreWall: { shapeFile: '/levels/automation_test_track/art/shapes/objects/tirewall.dae' },
  raceConcreteWall: { shapeFile: '/levels/automation_test_track/art/shapes/objects/barrierfence_concrete.dae' },
  // boats moored at piers and in marinas (services/boats.js): Italy's
  // harbour boats (they bob on the water)
  boatMotorSmall: { shapeFile: '/levels/italy/art/shapes/buildings/italy_boat_small_a.DAE' },
  boatSailB: { shapeFile: '/levels/italy/art/shapes/buildings/italy_boat_small_b.DAE' },
  boatSailC: { shapeFile: '/levels/italy/art/shapes/buildings/italy_boat_small_c.DAE' },
  boatSailD: { shapeFile: '/levels/italy/art/shapes/buildings/italy_boat_small_d.DAE' },
  boatSailE: { shapeFile: '/levels/italy/art/shapes/buildings/italy_boat_small_e.DAE' },
  boatMotorBig: { shapeFile: '/levels/italy/art/shapes/buildings/italy_boat_big_b.DAE' },
  boatBigA: { shapeFile: '/levels/italy/art/shapes/buildings/italy_boat_big_a.DAE' },
  boatBigC: { shapeFile: '/levels/italy/art/shapes/buildings/italy_boat_big_c.DAE' },
  boatBigD: { shapeFile: '/levels/italy/art/shapes/buildings/italy_boat_big_d.DAE' },
  // a rooftop water tank on its stand (Johnson Valley's, 3.5 x 3.75 m, 5.15 m tall)
  waterTank: { shapeFile: '/levels/johnson_valley/art/shapes/building/s_watertank.dae' },
};

// Street lights, their arms along local +X; the night light sits at the
// luminaire (lightForward along the arm, lightHeight up). West Coast USA's
// 13 m cobra head lights its arterials (351 placed there); East Coast's
// davit lamppost (common art) the town streets; the lantern post stays for
// lamps mapped on footpaths and squares.
export const STREET_LIGHT_SHAPES = {
  arterial: {
    shapeFile: '/levels/west_coast_usa/art/shapes/objects/pole_light_single.dae',
    lightHeight: 12.5, lightForward: 5.3, radius: 24,
  },
  street: {
    shapeFile: '/art/shapes/garage_and_dealership/Clutter/eca_lamppost.dae',
    lightHeight: 7.8, lightForward: 2.7, radius: 15,
  },
  path: {
    shapeFile: '/art/shapes/objects/lamp1.dae',
    lightHeight: 6.4, lightForward: 0.8, radius: 12,
  },
};

// West Coast USA's signal mast with a street light on top: the signal arm
// reaches along local +X, level at ARM_Z from 3.5 m out to its 7.5 m tip;
// the luminaire sits at the end of the upper arm. Heads (trafficlight_overhead1,
// ~1 m tall about their origin) hang under the arm.
export const SIGNAL_MAST = {
  shapeFile: '/levels/west_coast_usa/art/shapes/objects/pole_light_signal1.dae',
  armZ: 7.75, armFrom: 3.5, armTo: 7.2, headZ: 7.2,
  lightHeight: 12.5, lightForward: 5.4, radius: 24,
};

// West Coast USA's plain signal post (beamngSignals.js mounts heads on it).
// Listed here so its 'trafficlight' material, defined only in West Coast
// USA's own materials file, ships with the export.
export const SIGNAL_POLE = {
  shapeFile: '/levels/west_coast_usa/art/shapes/objects/pole_traffic1.dae',
};

// Traffic calming (services/trafficCalming.js). Driver Training's bolt-down
// bump: speedbump1 is a module 1 m across the road (local y) and 0.55 m deep
// (local x), 7.5 cm tall; speedbump2 / speedbump3 are its end caps, their
// geometry at y -0.625..-0.5 / 0.5..0.625 of the module they sit on.
// Gridmap's suspension pieces: 4.2 m across (local x) and 4.2 m along (local
// y), their base 10 cm under the road; 4x4_b a smooth 8.3 cm hump, 4x4_c a
// 10.7 cm table (short ramps, flat top).
export const CALMING_SHAPES = {
  bumpModule: { shapeFile: '/levels/driver_training/art/shapes/objects/speedbump1.dae' },
  bumpCapStart: { shapeFile: '/levels/driver_training/art/shapes/objects/speedbump2.dae' },
  bumpCapEnd: { shapeFile: '/levels/driver_training/art/shapes/objects/speedbump3.dae' },
  hump: { shapeFile: '/levels/gridmap_v2/art/shapes/grid/s_gm_suspension_sbump_4x4_b.dae' },
  table: { shapeFile: '/levels/gridmap_v2/art/shapes/grid/s_gm_suspension_sbump_4x4_c.dae' },
};

// Carports (services/beamngCarports.js): Italy's dealership carport, an open
// red steel roof on truss posts, 6.2 m deep (local X) by 14.5 m (local Y).
export const CARPORT_SHAPE = {
  shapeFile: '/levels/italy/art/shapes/buildings/dealerships/Italy_dealership_carport.dae',
};

// OSM barrier=bollard: the standard steel bollard (0.26 m, 1.68 m tall),
// East Coast USA's concrete city bollard for material=concrete.
export const BOLLARD_SHAPES = {
  steel: { shapeFile: '/art/shapes/objects/bollard_yellow.dae' },
  concrete: { shapeFile: '/levels/east_coast_usa/art/shapes/clutter/clutter_city_bollard_concrete.dae' },
};

// OSM walls and railings (barriers drawn piece by piece along their line).
// All run along local X with their origin on the ground, except the harbour
// railing: along local -Y, its origin at one end, in centimetres.
export const BARRIER_SHAPES = {
  stoneWall: { shapeFile: '/levels/italy/art/shapes/buildings/italy_wall_stone.dae' },          // 3.1 m long, 0.9 m tall
  concreteWall: { shapeFile: '/levels/italy/art/shapes/buildings/italy_wall_concrete.dae' },    // 3.2 m, 1.0 m
  dryStoneWall: { shapeFile: '/levels/italy/art/shapes/buildings/italy_rock_wall_a_low.dae' },  // 6.3 m, 0.8 m
  brickWall: { shapeFile: '/levels/west_coast_usa/art/shapes/objects/wall_brick1.dae' },        // 3.6 m, 3.1 m
  railing: { shapeFile: '/levels/small_island/art/shapes/buildings/si_harbour_railing.DAE' },   // 3.0 m, 1.07 m
};

// North American road signs from Utah (ut_roadsigns) and West Coast USA,
// beside East Coast USA's in services/roadSigns.js. Their faces look along
// local -Y, like East Coast USA's and the Vienna-convention set. (Paths
// written out in full: the material generator reads quoted shapeFile lines.)
export const US_SIGN_SHAPES = {
  // (West Coast's 5 and 25 mph are bare plates, 1 m tall round their middle:
  // on their post, as that level mounts them, the plate 1.4 m up it)
  speed5: { shapeFile: '/levels/west_coast_usa/art/shapes/objects/sign_speed5.dae', post: 'signPost', plateZ: 1.4 },
  speed25: { shapeFile: '/levels/west_coast_usa/art/shapes/objects/sign_speed25.dae', post: 'signPost', plateZ: 1.4 },
  speed30: { shapeFile: '/levels/Utah/art/shapes/ut_roadsigns/ut_30_speed_limit.DAE' },
  speed60: { shapeFile: '/levels/Utah/art/shapes/ut_roadsigns/ut_60_speed_limit.DAE' },
  speed70: { shapeFile: '/levels/Utah/art/shapes/ut_roadsigns/ut_70_speed_limit.DAE' },
  speed80: { shapeFile: '/levels/Utah/art/shapes/ut_roadsigns/ut_80_speed_limit.DAE' },
  curveLeft: { shapeFile: '/levels/Utah/art/shapes/ut_roadsigns/ut_curve_left.DAE' },
  curveRight: { shapeFile: '/levels/Utah/art/shapes/ut_roadsigns/ut_curve_right.DAE' },
  reverseCurveLeft: { shapeFile: '/levels/Utah/art/shapes/ut_roadsigns/ut_reverse_curve_left.DAE' },
  reverseCurveRight: { shapeFile: '/levels/Utah/art/shapes/ut_roadsigns/ut_reverse_curve_right.DAE' },
  windingLeft: { shapeFile: '/levels/Utah/art/shapes/ut_roadsigns/ut_winding_road_left.DAE' },
  windingRight: { shapeFile: '/levels/Utah/art/shapes/ut_roadsigns/ut_winding_road_right.DAE' },
  chevronLeft: { shapeFile: '/levels/Utah/art/shapes/ut_roadsigns/ut_chevron_left.DAE' },
  chevronRight: { shapeFile: '/levels/Utah/art/shapes/ut_roadsigns/ut_chevron_right.DAE' },
};

// The overhead wires (a generated mesh): plain dark cable, both faces drawn.
export const POWER_WIRE_MATERIAL = 'mapng_power_wire';
export function getPowerWireMaterialDefs() {
  return {
    [POWER_WIRE_MATERIAL]: {
      name: POWER_WIRE_MATERIAL,
      mapTo: POWER_WIRE_MATERIAL,
      class: 'Material',
      Stages: [{ diffuseColor: [0.06, 0.06, 0.06, 1], specularPower: 8 }, {}, {}, {}],
      doubleSided: true,
      translucentBlendOp: 'None',
    },
  };
}
