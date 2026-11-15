// Stock BeamNG street props placed by services/streetProps.js (after
// BeamNG.Earth's trees.lua catalog). Their materials ship with the export as
// the "tag_models" set (scripts/build-shape-material-library.py reads the parts).
//
// Hydrants and bins are Forest items (instanced, orientation free); the
// utility pole and its lamp are TSStatics, because the wires have to meet the
// pole's cross-arm exactly.

// Which models these are, and what the code knows of each (a lamp's height, a piece's length), is data:
// data/model-picks.json parts, read through services/tagModels.js.
import { part, partsOf } from './tagModels.js';

// Forest item data, from the official levels' own managedItemData.
export const PROP_ITEMS = partsOf('PROP_ITEMS');

export const PROP_HYDRANT = 'mapng_prop_hydrant';
export const PROP_BINS = ['mapng_prop_bin_round', 'mapng_prop_bin_wcusa'];

// TSStatics.
// utility poles (streetProps POLE_TYPES), each with a Colmesh the game takes
// a sign's post (West Coast USA's, 2.4 m, 0.43 of it below ground)
// a clipped hedge piece (Italy's): 2.3 m along local X, centred, 0.85 m
// deep, 1.64 m tall; laid end to end along barrier=hedge
// what a building is used for (beamngBuildings.js useDetails): a rooftop
// HOTEL sign (6.2 m wide, its face in local XZ), the US flag on its wall
// bracket, a café's small wall sign (yawOffset: from the street-facing
// direction: the signs' faces lie along local X, facing local -Y; the
// flag's pole reaches out along local -X)
// front steps (services/buildingDetails.js steps): a four-step flight
// from the game's common assets, down along local -x from its top edge
// a court's chain-link fence (services/sportsFields.js): Hirochi's
// pedestrian fence, a 2.16 m panel along local +y from its post (turned a
// quarter so +y runs back along the fence)
// racetracks (services/racetracks.js): a drag strip's light tree, kart
// tyre walls and concrete barriers (4.16 m / 4.0 m along local x)
// boats moored at piers and in marinas (services/boats.js): Italy's
// harbour boats (they bob on the water)
// a rooftop water tank on its stand (Johnson Valley's, 3.5 x 3.75 m, 5.15 m tall)
export const PROP_SHAPES = partsOf('PROP_SHAPES');

// Street lights, their arms along local +X; the night light sits at the
// luminaire (lightForward along the arm, lightHeight up). West Coast USA's
// 13 m cobra head lights its arterials (351 placed there); East Coast's
// davit lamppost (common art) the town streets; the lantern post stays for
// lamps mapped on footpaths and squares.
export const STREET_LIGHT_SHAPES = partsOf('STREET_LIGHT_SHAPES');

// West Coast USA's signal mast with a street light on top: the signal arm
// reaches along local +X, level at ARM_Z from 3.5 m out to its 7.5 m tip;
// the luminaire sits at the end of the upper arm. Heads (trafficlight_overhead1,
// ~1 m tall about their origin) hang under the arm.
export const SIGNAL_MAST = part('SIGNAL_MAST');

// West Coast USA's plain signal post (beamngSignals.js mounts heads on it).
// Listed here so its 'trafficlight' material, defined only in West Coast
// USA's own materials file, ships with the export.
export const SIGNAL_POLE = part('SIGNAL_POLE');

// Traffic calming (services/trafficCalming.js). Driver Training's bolt-down
// bump: speedbump1 is a module 1 m across the road (local y) and 0.55 m deep
// (local x), 7.5 cm tall; speedbump2 / speedbump3 are its end caps, their
// geometry at y -0.625..-0.5 / 0.5..0.625 of the module they sit on.
// Gridmap's suspension pieces: 4.2 m across (local x) and 4.2 m along (local
// y), their base 10 cm under the road; 4x4_b a smooth 8.3 cm hump, 4x4_c a
// 10.7 cm table (short ramps, flat top).
export const CALMING_SHAPES = partsOf('CALMING_SHAPES');

// Carports (services/beamngCarports.js): Italy's dealership carport, an open
// red steel roof on truss posts, 6.2 m deep (local X) by 14.5 m (local Y).
export const CARPORT_SHAPE = part('CARPORT_SHAPE');

// OSM barrier=bollard: the standard steel bollard (0.26 m, 1.68 m tall),
// East Coast USA's concrete city bollard for material=concrete.
export const BOLLARD_SHAPES = partsOf('BOLLARD_SHAPES');

// OSM walls and railings (barriers drawn piece by piece along their line).
// All run along local X with their origin on the ground, except the harbour
// railing: along local -Y, its origin at one end, in centimetres.
// stoneWall: 3.1 m long, 0.9 m tall
// concreteWall: 3.2 m, 1.0 m
// dryStoneWall: 6.3 m, 0.8 m
// brickWall: 3.6 m, 3.1 m
// railing: 3.0 m, 1.07 m
export const BARRIER_SHAPES = partsOf('BARRIER_SHAPES');

// North American road signs from Utah (ut_roadsigns) and West Coast USA,
// beside East Coast USA's in services/roadSigns.js. Their faces look along
// local -Y, like East Coast USA's and the Vienna-convention set. (Paths
// written out in full: the material generator reads quoted shapeFile lines.)
// (West Coast's 5 and 25 mph are bare plates, 1 m tall round their middle:
// on their post, as that level mounts them, the plate 1.4 m up it)
export const US_SIGN_SHAPES = partsOf('US_SIGN_SHAPES');

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
