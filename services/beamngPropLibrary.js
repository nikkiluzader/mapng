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
  pole: { shapeFile: '/levels/automation_test_track/art/shapes/objects/s_powerpole_3wire.dae' },
  poleLamp: { shapeFile: '/levels/east_coast_usa/art/shapes/buildings/electrical_pole_lamp.dae' },
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
