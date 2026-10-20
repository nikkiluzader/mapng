// GENERATED FILE — do not edit by hand.
// Built by scripts/build-terrain-material-library.py from BeamNG 0.40.0.0.
// Per-level TerrainMaterial templates for MapNG's semantic slots. All
// detail/macro textures resolve to core /assets/... paths; base slots are
// placeholders the exporter overwrites with the generated satellite base.
export const TERRAIN_MATERIAL_LIBRARY_VERSION = '0.40.0.0';

export const TERRAIN_MATERIAL_LIBRARY = {
  "automation_test_track": {
    "BeachSand": {
      "annotation": "SAND",
      "aoBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 4096,
      "aoDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_ao.png",
      "aoMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_ao.png",
      "baseColorBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 4096,
      "baseColorDetailStrength": [
        0.300000012,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_b.png",
      "baseColorMacroStrength": [
        0.300000012,
        0.300000012
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_b.png",
      "class": "TerrainMaterial",
      "detailSize": 4,
      "detailStrength": 0.600000024,
      "diffuseSize": 1536,
      "groundmodelName": "BEACHSAND",
      "heightBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 4096,
      "heightDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_h.png",
      "heightMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_h.png",
      "internalName": "Sand",
      "macroDistance": 450,
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "macroSize": 60,
      "macroStrength": 0.300000012,
      "normalBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 4096,
      "normalDetailStrength": [
        0.5,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/sand/m_terrain_dirt/t_sand_nm.png",
      "normalMacroStrength": [
        0.300000012,
        0.200000003
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_nm.png",
      "roughnessBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 4096,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_r.png"
    },
    "Concrete": {
      "annotation": "ASPHALT",
      "aoBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_concrete_ao.png",
      "aoBaseTexSize": 512,
      "aoDetailStrength": [
        0.200000003,
        0
      ],
      "aoDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_ao.png",
      "aoDetailTexSize": 4,
      "aoMacroTex": "/assets/materials/terrain/concrete/macro_concrete/t_macro_concrete_ao.png",
      "aoMacroTexSize": 20,
      "baseColorBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_concrete_b.png",
      "baseColorBaseTexSize": 512,
      "baseColorDetailStrength": [
        0.400000006,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_b.png",
      "baseColorDetailTexSize": 4,
      "baseColorMacroStrength": [
        0.300000012,
        0
      ],
      "baseColorMacroTex": "/assets/materials/terrain/concrete/macro_concrete/t_macro_concrete_b.png",
      "baseColorMacroTexSize": 20,
      "class": "TerrainMaterial",
      "detailDistAtten": [
        0,
        1
      ],
      "detailDistance": 25,
      "detailSize": 4,
      "detailStrength": 0.5,
      "diffuseSize": 50,
      "groundmodelName": "ASPHALT",
      "heightBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_concrete_h.png",
      "heightBaseTexSize": 512,
      "heightDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_h.png",
      "heightDetailTexSize": 4,
      "heightMacroTex": "/assets/materials/terrain/concrete/macro_concrete/t_macro_concrete_h.png",
      "heightMacroTexSize": 20,
      "internalName": "concrete",
      "macroDistance": 1000,
      "macroDistances": [
        0,
        0,
        100,
        3000
      ],
      "macroSize": 40,
      "macroStrength": 0.5,
      "normalBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_concrete_nm.png",
      "normalBaseTexSize": 512,
      "normalDetailStrength": [
        0.400000006,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_nm.png",
      "normalDetailTexSize": 4,
      "normalMacroStrength": [
        0.400000006,
        1
      ],
      "normalMacroTex": "/assets/materials/terrain/concrete/macro_concrete/t_macro_concrete_nm.png",
      "normalMacroTexSize": 20,
      "roughnessBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_concrete_r.png",
      "roughnessBaseTexSize": 512,
      "roughnessDetailStrength": [
        0.800000012,
        0
      ],
      "roughnessDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_r.png",
      "roughnessDetailTexSize": 4,
      "roughnessMacroStrength": [
        0.400000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/concrete/macro_concrete/t_macro_concrete_r.png",
      "roughnessMacroTexSize": 20
    },
    "Dirt": {
      "aoBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 4096,
      "aoDetailTex": "/assets/materials/terrain/soil/dirt_crumbly/t_dirt_crumbly_ao.png",
      "aoDetailTexSize": 4,
      "aoMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_ao.png",
      "baseColorBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 4096,
      "baseColorDetailStrength": [
        0.25,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/soil/dirt_crumbly/t_dirt_crumbly_b.png",
      "baseColorDetailTexSize": 4,
      "baseColorMacroStrength": [
        0.0500000007,
        0.100000001
      ],
      "baseColorMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_b.png",
      "class": "TerrainMaterial",
      "detailDistance": 80,
      "detailDistances": [
        0,
        0,
        25,
        50
      ],
      "detailSize": 4,
      "detailStrength": 0.600000024,
      "diffuseSize": 4096,
      "groundmodelName": "DIRT_LOOSE",
      "heightBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 4096,
      "heightDetailTex": "/assets/materials/terrain/soil/dirt_crumbly/t_dirt_crumbly_h.png",
      "heightDetailTexSize": 4,
      "heightMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_h.png",
      "internalName": "dirt_loose",
      "macroDistance": 800,
      "macroDistances": [
        0,
        10,
        200,
        3000
      ],
      "macroSize": 80,
      "macroStrength": 0.150000006,
      "normalBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 4096,
      "normalDetailStrength": [
        0.699999988,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/soil/dirt_crumbly/t_dirt_crumbly_nm.png",
      "normalDetailTexSize": 4,
      "normalMacroStrength": [
        0.400000006,
        0.400000006
      ],
      "normalMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_nm.png",
      "roughnessBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 4096,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/soil/dirt_crumbly/t_dirt_crumbly_r.png",
      "roughnessDetailTexSize": 4,
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_r.png"
    },
    "DirtGrass": {
      "annotation": "GRASS",
      "aoBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 4096,
      "aoDetailStrength": [
        0.5,
        0.5
      ],
      "aoDetailTex": "/assets/materials/terrain/grass/t_dirt_dry_grass/t_dirt_dry_grass_ao.png",
      "aoDetailTexSize": 4,
      "aoMacroStrength": [
        0.5,
        0.5
      ],
      "aoMacroTex": "/assets/materials/terrain/grass/macro_grass/t_macro_grass_ao.png",
      "aoMacroTexSize": 40,
      "baseColorBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 4096,
      "baseColorDetailStrength": [
        0.200000003,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/grass/t_dirt_dry_grass/t_dirt_dry_grass_b.png",
      "baseColorDetailTexSize": 4,
      "baseColorMacroStrength": [
        0.0500000007,
        0.200000003
      ],
      "baseColorMacroTex": "/assets/materials/terrain/grass/macro_grass/t_macro_grass_b.png",
      "baseColorMacroTexSize": 40,
      "class": "TerrainMaterial",
      "detailDistAtten": [
        0,
        1
      ],
      "detailDistances": [
        0,
        0,
        40,
        80
      ],
      "groundmodelName": "DIRT_GRASS",
      "heightBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 4096,
      "heightDetailStrength": [
        0.5,
        0.5
      ],
      "heightDetailTex": "/assets/materials/terrain/grass/t_dirt_dry_grass/t_dirt_dry_grass_h.png",
      "heightDetailTexSize": 4,
      "heightMacroTex": "/assets/materials/terrain/grass/macro_grass/t_macro_grass_h.png",
      "heightMacroTexSize": 40,
      "internalName": "dirt_grass",
      "macroDistances": [
        0,
        10,
        50,
        3000
      ],
      "normalBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 4096,
      "normalDetailStrength": [
        0.699999988,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/grass/t_dirt_dry_grass/t_dirt_dry_grass_nm.png",
      "normalDetailTexSize": 4,
      "normalMacroStrength": [
        0.25,
        0.699999988
      ],
      "normalMacroTex": "/assets/materials/terrain/grass/macro_grass/t_macro_grass_nm.png",
      "normalMacroTexSize": 40,
      "roughnessBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 4096,
      "roughnessDetailStrength": [
        0.400000006,
        0
      ],
      "roughnessDetailTex": "/assets/materials/terrain/grass/t_dirt_dry_grass/t_dirt_dry_grass_r.png",
      "roughnessDetailTexSize": 4,
      "roughnessMacroStrength": [
        0,
        0.200000003
      ],
      "roughnessMacroTex": "/assets/materials/terrain/grass/macro_grass/t_macro_grass_r.png",
      "roughnessMacroTexSize": 40
    },
    "Grass": {
      "annotation": "GRASS",
      "aoBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 4096,
      "aoDetailStrength": [
        0.5,
        0
      ],
      "aoDetailTex": "/assets/materials/terrain/forest/t_moss/t_moss_ao.png",
      "aoDetailTexSize": 4,
      "aoMacroStrength": [
        0.5,
        0.5
      ],
      "aoMacroTex": "/assets/materials/terrain/grass/macro_grass/t_macro_grass_ao.png",
      "aoMacroTexSize": 80,
      "baseColorBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 4096,
      "baseColorDetailStrength": [
        0.5,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/forest/t_moss/t_moss_b.png",
      "baseColorDetailTexSize": 4,
      "baseColorMacroStrength": [
        0.100000001,
        0.100000001
      ],
      "baseColorMacroTex": "/assets/materials/terrain/grass/macro_grass/t_macro_grass_b.png",
      "baseColorMacroTexSize": 80,
      "class": "TerrainMaterial",
      "detailDistAtten": [
        0,
        1
      ],
      "detailDistance": 80,
      "detailDistances": [
        0,
        0,
        20,
        60
      ],
      "detailSize": 4,
      "detailStrength": 0.600000024,
      "diffuseSize": 4096,
      "groundmodelName": "GRASS",
      "heightBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 4096,
      "heightDetailStrength": [
        0.5,
        0.5
      ],
      "heightDetailTex": "/assets/materials/terrain/forest/t_moss/t_moss_h.png",
      "heightDetailTexSize": 4,
      "heightMacroStrength": [
        2,
        2
      ],
      "heightMacroTex": "/assets/materials/terrain/grass/macro_grass/t_macro_grass_h.png",
      "heightMacroTexSize": 80,
      "internalName": "grass",
      "macroDistance": 800,
      "macroDistances": [
        0,
        10,
        50,
        3000
      ],
      "macroSize": 80,
      "macroStrength": 0.150000006,
      "normalBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 4096,
      "normalDetailStrength": [
        0.699999988,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/forest/t_moss/t_moss_nm.png",
      "normalDetailTexSize": 4,
      "normalMacroStrength": [
        0.25,
        0.5
      ],
      "normalMacroTex": "/assets/materials/terrain/grass/macro_grass/t_macro_grass_nm.png",
      "normalMacroTexSize": 80,
      "roughnessBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 4096,
      "roughnessDetailStrength": [
        0.300000012,
        0
      ],
      "roughnessDetailTex": "/assets/materials/terrain/forest/t_moss/t_moss_r.png",
      "roughnessDetailTexSize": 4,
      "roughnessMacroStrength": [
        0.5,
        1
      ],
      "roughnessMacroTex": "/assets/materials/terrain/grass/macro_grass/t_macro_grass_r.png",
      "roughnessMacroTexSize": 80
    },
    "ROCK": {
      "annotation": "ROCK",
      "aoBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 4096,
      "aoDetailStrength": [
        0.5,
        0.5
      ],
      "aoDetailTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_ao.png",
      "aoDetailTexSize": 10,
      "aoMacroStrength": [
        0.5,
        0.5
      ],
      "aoMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_ao.png",
      "aoMacroTexSize": 40,
      "baseColorBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 4096,
      "baseColorDetailStrength": [
        0.25,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_b.png",
      "baseColorDetailTexSize": 10,
      "baseColorMacroStrength": [
        0.100000001,
        0.300000012
      ],
      "baseColorMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_b.png",
      "baseColorMacroTexSize": 40,
      "class": "TerrainMaterial",
      "detailDistances": [
        0,
        0,
        40,
        80
      ],
      "groundmodelName": "ROCK",
      "heightBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 4096,
      "heightDetailTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_h.png",
      "heightDetailTexSize": 10,
      "heightMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_h.png",
      "heightMacroTexSize": 40,
      "internalName": "Rock_cliff",
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "normalBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 4096,
      "normalDetailStrength": [
        0.5,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_nm.png",
      "normalDetailTexSize": 10,
      "normalMacroStrength": [
        0.100000001,
        0.400000006
      ],
      "normalMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_nm.png",
      "normalMacroTexSize": 40,
      "roughnessBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 4096,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_r.png",
      "roughnessDetailTexSize": 10,
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_r.png",
      "roughnessMacroTexSize": 40
    },
    "asphalt": {
      "annotation": "ASPHALT",
      "aoBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_asphalt_ao.png",
      "aoDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_ao.png",
      "aoDetailTexSize": 4,
      "aoMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_ao.png",
      "aoMacroTexSize": 120,
      "baseColorBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_asphalt_b.png",
      "baseColorDetailStrength": [
        0.699999988,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/asphalt/ut_asphalt_mesh/t_asphalt_b.color.png",
      "baseColorDetailTexSize": 4,
      "baseColorMacroStrength": [
        0.0500000007,
        0
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_b.png",
      "baseColorMacroTexSize": 120,
      "class": "TerrainMaterial",
      "detailDistance": 80,
      "detailSize": 4,
      "detailStrength": 0.600000024,
      "diffuseSize": 4096,
      "groundmodelName": "ASPHALT",
      "heightBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_asphalt_h.png",
      "heightDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_h.png",
      "heightDetailTexSize": 4,
      "heightMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_h.png",
      "heightMacroTexSize": 120,
      "internalName": "groundmodel_asphalt1",
      "macroDistance": 800,
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "macroSize": 80,
      "macroStrength": 0.150000006,
      "normalBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_asphalt_nm.png",
      "normalDetailStrength": [
        0.800000012,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_nm.png",
      "normalDetailTexSize": 4,
      "normalMacroStrength": [
        0.100000001,
        0
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_nm.png",
      "normalMacroTexSize": 120,
      "roughnessBaseTex": "/levels/automation_test_track/art/terrains/t_terrain_base_asphalt_r.png",
      "roughnessDetailStrength": [
        1,
        0
      ],
      "roughnessDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_r.png",
      "roughnessDetailTexSize": 4,
      "roughnessMacroStrength": [
        0.100000001,
        0.100000001
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_r.png",
      "roughnessMacroTexSize": 120
    }
  },
  "east_coast_usa": {
    "Dirt": {
      "aoBaseTex": "/levels/east_coast_usa/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailStrength": [
        0.5,
        1
      ],
      "aoDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_ao.png",
      "aoMacroStrength": [
        0.5,
        1
      ],
      "aoMacroTex": "/assets/materials/terrain/grass/t_macro_grass/t_macro_grass_ao.png",
      "aoMacroTexSize": 10,
      "baseColorBaseTex": "/levels/east_coast_usa/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.25,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_b.png",
      "baseColorMacroStrength": [
        0.200000003,
        0.170000002
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/dirt_crumbly/t_dirt_crumbly_b.png",
      "baseColorMacroTexSize": 10,
      "class": "TerrainMaterial",
      "detailDistances": [
        0,
        0,
        25,
        50
      ],
      "groundmodelName": "DIRT",
      "heightBaseTex": "/levels/east_coast_usa/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailStrength": [
        1,
        0
      ],
      "heightDetailTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_h.png",
      "heightMacroStrength": [
        0,
        1
      ],
      "heightMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_h.png",
      "heightMacroTexSize": 10,
      "internalName": "Dirt",
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "normalBaseTex": "/levels/east_coast_usa/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        0.800000012,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_nm.png",
      "normalMacroStrength": [
        0.600000024,
        0.600000024
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_nm.png",
      "normalMacroTexSize": 10,
      "roughnessBaseTex": "/levels/east_coast_usa/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.5,
        0.5
      ],
      "roughnessDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_r.png",
      "roughnessMacroStrength": [
        0.5,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/grass/t_macro_grass/t_macro_grass_r.png",
      "roughnessMacroTexSize": 10
    },
    "DirtGrass": {
      "annotation": "GRASS",
      "aoBaseTex": "/levels/east_coast_usa/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/soil/t_dirt_dry_grassy/t_dirt_dry_grassy_ao.png",
      "aoMacroTex": "/assets/materials/terrain/grass/t_macro_grass/t_macro_grass_ao.png",
      "aoMacroTexSize": 50,
      "baseColorBaseTex": "/levels/east_coast_usa/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.200000003,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/soil/t_dirt_dry_grassy/t_dirt_dry_grassy_b.png",
      "baseColorMacroStrength": [
        0.150000006,
        0.150000006
      ],
      "baseColorMacroTex": "/assets/materials/terrain/grass/t_macro_grass/t_macro_grass_b.png",
      "baseColorMacroTexSize": 50,
      "class": "TerrainMaterial",
      "detailDistAtten": [
        0,
        0.899999976
      ],
      "detailDistances": [
        0,
        0,
        30,
        60
      ],
      "groundmodelName": "GRASS",
      "heightBaseTex": "/levels/east_coast_usa/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailStrength": [
        1,
        0
      ],
      "heightDetailTex": "/assets/materials/terrain/soil/t_dirt_dry_grassy/t_dirt_dry_grassy_h.png",
      "heightMacroStrength": [
        0,
        1
      ],
      "heightMacroTex": "/assets/materials/terrain/grass/t_macro_grass/t_macro_grass_h.png",
      "heightMacroTexSize": 50,
      "internalName": "dirt_grass",
      "macroDistAtten": [
        0.349999994,
        1
      ],
      "macroDistances": [
        0,
        0,
        400,
        3000
      ],
      "normalBaseTex": "/levels/east_coast_usa/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        1,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/soil/t_dirt_dry_grassy/t_dirt_dry_grassy_nm.png",
      "normalMacroStrength": [
        0.300000012,
        0.600000024
      ],
      "normalMacroTex": "/assets/materials/terrain/grass/t_macro_grass/t_macro_grass_nm.png",
      "normalMacroTexSize": 50,
      "roughnessBaseTex": "/levels/east_coast_usa/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.899999976,
        0.699999988
      ],
      "roughnessDetailTex": "/assets/materials/terrain/soil/t_dirt_dry_grassy/t_dirt_dry_grassy_r.png",
      "roughnessMacroStrength": [
        0.899999976,
        0.899999976
      ],
      "roughnessMacroTex": "/assets/materials/terrain/grass/t_macro_grass/t_macro_grass_r.png",
      "roughnessMacroTexSize": 50
    },
    "Grass": {
      "annotation": "GRASS",
      "aoBaseTex": "/levels/east_coast_usa/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/grass/t_grass_01/t_grass_01_ao.png",
      "aoMacroTex": "/assets/materials/terrain/grass/t_macro_grass/t_macro_grass_ao.png",
      "aoMacroTexSize": 50,
      "baseColorBaseTex": "/levels/east_coast_usa/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.150000006,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/grass/t_grass_01/t_grass_01_b.png",
      "baseColorMacroStrength": [
        0.150000006,
        0.200000003
      ],
      "baseColorMacroTex": "/assets/materials/terrain/grass/t_macro_grass/t_macro_grass_b.png",
      "baseColorMacroTexSize": 50,
      "class": "TerrainMaterial",
      "detailDistances": [
        0,
        0,
        50,
        3000
      ],
      "groundmodelName": "GRASS",
      "heightBaseTex": "/levels/east_coast_usa/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/custom_height_blend/custom_height_blend_h.png",
      "heightMacroStrength": [
        0,
        0
      ],
      "heightMacroTex": "/assets/materials/terrain/grass/t_macro_grass/t_macro_grass_h.png",
      "heightMacroTexSize": 50,
      "internalName": "Grass",
      "macroDistAtten": [
        1,
        1
      ],
      "macroDistances": [
        0,
        0,
        100,
        3000
      ],
      "normalBaseTex": "/levels/east_coast_usa/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        1,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/grass/t_grass_01/t_grass_01_nm.png",
      "normalMacroStrength": [
        0.300000012,
        0.600000024
      ],
      "normalMacroTex": "/assets/materials/terrain/grass/t_macro_grass/t_macro_grass_nm.png",
      "normalMacroTexSize": 50,
      "roughnessBaseTex": "/levels/east_coast_usa/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        1,
        0
      ],
      "roughnessDetailTex": "/assets/materials/terrain/grass/t_grass_01/t_grass_01_r.png",
      "roughnessMacroStrength": [
        0.5,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/grass/t_macro_grass/t_macro_grass_r.png",
      "roughnessMacroTexSize": 50
    },
    "ROCK": {
      "annotation": "ROCK",
      "aoBaseTex": "/levels/east_coast_usa/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_ao.png",
      "aoMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_ao.png",
      "aoMacroTexSize": 10,
      "baseColorBaseTex": "/levels/east_coast_usa/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.25,
        0.25
      ],
      "baseColorDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_b.png",
      "baseColorMacroStrength": [
        0.200000003,
        0.300000012
      ],
      "baseColorMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_b.png",
      "baseColorMacroTexSize": 10,
      "class": "TerrainMaterial",
      "detailDistances": [
        0,
        0,
        15,
        50
      ],
      "groundmodelName": "ROCK",
      "heightBaseTex": "/levels/east_coast_usa/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailStrength": [
        1,
        0
      ],
      "heightDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_h.png",
      "heightMacroStrength": [
        0,
        1
      ],
      "heightMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_h.png",
      "heightMacroTexSize": 10,
      "internalName": "ROCK",
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "normalBaseTex": "/levels/east_coast_usa/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        0.400000006,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_nm.png",
      "normalMacroStrength": [
        0.800000012,
        0.800000012
      ],
      "normalMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_nm.png",
      "normalMacroTexSize": 10,
      "roughnessBaseTex": "/levels/east_coast_usa/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_r.png",
      "roughnessMacroTexSize": 10
    },
    "asphalt": {
      "annotation": "ASPHALT",
      "aoBaseTex": "/levels/east_coast_usa/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/asphalt/t_asphalt_02/t_asphalt_02_ao.png",
      "aoMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_ao.png",
      "aoMacroTexSize": 80,
      "baseColorBaseTex": "/levels/east_coast_usa/art/terrains/t_terrain_base_asphalt_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.300000012,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/asphalt/t_asphalt_02/t_asphalt_02_b.png",
      "baseColorMacroStrength": [
        0.200000003,
        0.300000012
      ],
      "baseColorMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_b.png",
      "baseColorMacroTexSize": 80,
      "class": "TerrainMaterial",
      "groundmodelName": "ASPHALT",
      "heightBaseTex": "/levels/east_coast_usa/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailStrength": [
        1,
        0
      ],
      "heightDetailTex": "/assets/materials/terrain/asphalt/t_asphalt_02/t_asphalt_02_h.png",
      "heightMacroStrength": [
        0,
        1
      ],
      "heightMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_h.png",
      "heightMacroTexSize": 80,
      "internalName": "asphalt",
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "normalBaseTex": "/levels/east_coast_usa/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        0.699999988,
        0.200000003
      ],
      "normalDetailTex": "/assets/materials/terrain/asphalt/t_asphalt_02/t_asphalt_02_nm.png",
      "normalMacroStrength": [
        0.300000012,
        0.300000012
      ],
      "normalMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_nm.png",
      "normalMacroTexSize": 80,
      "roughnessBaseTex": "/levels/east_coast_usa/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.5,
        0
      ],
      "roughnessDetailTex": "/assets/materials/terrain/asphalt/t_asphalt_02/t_asphalt_02_r.png",
      "roughnessMacroStrength": [
        0.5,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_r.png",
      "roughnessMacroTexSize": 80
    }
  },
  "gridmap_v2": {
    "BeachSand": {
      "annotation": "SAND",
      "aoBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_ao.png",
      "aoMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_ao.png",
      "baseColorBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.25,
        0.25
      ],
      "baseColorDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_b.png",
      "baseColorMacroStrength": [
        0.0500000007,
        0.100000001
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_b.png",
      "class": "TerrainMaterial",
      "detailDistance": 25,
      "detailSize": 2,
      "detailStrength": 0.5,
      "diffuseSize": 50,
      "groundmodelName": "SAND",
      "heightBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_h.png",
      "heightMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_h.png",
      "internalName": "BeachSand",
      "macroDistance": 1000,
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "macroSize": 40,
      "macroStrength": 0.5,
      "normalBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        0.699999988,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_nm.png",
      "normalMacroStrength": [
        0.25,
        0.25
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_nm.png",
      "roughnessBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_r.png"
    },
    "Concrete": {
      "annotation": "ASPHALT",
      "aoBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_ao.png",
      "aoMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_ao.png",
      "aoMacroTexSize": 40,
      "baseColorBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.25,
        0.25
      ],
      "baseColorDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_b.png",
      "baseColorMacroStrength": [
        0.100000001,
        0.100000001
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_b.png",
      "baseColorMacroTexSize": 40,
      "class": "TerrainMaterial",
      "detailDistance": 25,
      "detailSize": 2,
      "detailStrength": 0.5,
      "diffuseSize": 50,
      "groundmodelName": "ASPHALT",
      "heightBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_h.png",
      "heightMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_h.png",
      "heightMacroTexSize": 40,
      "internalName": "Concrete",
      "macroDistance": 1000,
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "macroSize": 40,
      "macroStrength": 0.5,
      "normalBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        0.699999988,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_nm.png",
      "normalMacroStrength": [
        0.100000001,
        0.100000001
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_nm.png",
      "normalMacroTexSize": 40,
      "roughnessBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.600000024,
        0.600000024
      ],
      "roughnessDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_r.png",
      "roughnessMacroTexSize": 40
    },
    "Dirt": {
      "aoBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/soil/dirt_loose_dusty/t_dirt_loose_dusty_ao.png",
      "aoMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_ao.png",
      "baseColorBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.25,
        0.25
      ],
      "baseColorDetailTex": "/assets/materials/terrain/soil/dirt_loose_dusty/t_dirt_loose_dusty_b.png",
      "baseColorMacroStrength": [
        0.100000001,
        0.200000003
      ],
      "baseColorMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_b.png",
      "class": "TerrainMaterial",
      "detailDistance": 25,
      "detailSize": 2,
      "detailStrength": 0.5,
      "diffuseSize": 50,
      "groundmodelName": "DIRT",
      "heightBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/soil/dirt_loose_dusty/t_dirt_loose_dusty_h.png",
      "heightMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_h.png",
      "internalName": "Dirt",
      "macroDistance": 1000,
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "macroSize": 40,
      "macroStrength": 0.5,
      "normalBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        0.699999988,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/soil/dirt_loose_dusty/t_dirt_loose_dusty_nm.png",
      "normalMacroStrength": [
        0.300000012,
        0.400000006
      ],
      "normalMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_nm.png",
      "roughnessBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/soil/dirt_loose_dusty/t_dirt_loose_dusty_r.png",
      "roughnessMacroStrength": [
        0.200000003,
        0.699999988
      ],
      "roughnessMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_r.png"
    },
    "DirtGrass": {
      "aoBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/soil/dirt_loose_dusty/t_dirt_loose_dusty_ao.png",
      "aoMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_ao.png",
      "baseColorBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.25,
        0.25
      ],
      "baseColorDetailTex": "/assets/materials/terrain/soil/dirt_loose_dusty/t_dirt_loose_dusty_b.png",
      "baseColorMacroStrength": [
        0.100000001,
        0.200000003
      ],
      "baseColorMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_b.png",
      "class": "TerrainMaterial",
      "detailDistance": 25,
      "detailSize": 2,
      "detailStrength": 0.5,
      "diffuseSize": 50,
      "groundmodelName": "DIRT",
      "heightBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/soil/dirt_loose_dusty/t_dirt_loose_dusty_h.png",
      "heightMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_h.png",
      "internalName": "Dirt",
      "macroDistance": 1000,
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "macroSize": 40,
      "macroStrength": 0.5,
      "normalBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        0.699999988,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/soil/dirt_loose_dusty/t_dirt_loose_dusty_nm.png",
      "normalMacroStrength": [
        0.300000012,
        0.400000006
      ],
      "normalMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_nm.png",
      "roughnessBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/soil/dirt_loose_dusty/t_dirt_loose_dusty_r.png",
      "roughnessMacroStrength": [
        0.200000003,
        0.699999988
      ],
      "roughnessMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_r.png"
    },
    "Grass": {
      "annotation": "GRASS",
      "aoBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/grass/t_grass_01/t_grass_01_ao.png",
      "aoMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_ao.png",
      "baseColorBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.25,
        0.25
      ],
      "baseColorDetailTex": "/assets/materials/terrain/grass/t_grass_01/t_grass_01_b.png",
      "baseColorMacroStrength": [
        0.100000001,
        0.200000003
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_b.png",
      "class": "TerrainMaterial",
      "detailDistance": 25,
      "detailSize": 2,
      "detailStrength": 0.5,
      "diffuseSize": 50,
      "groundmodelName": "GRASS",
      "heightBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/grass/t_grass_01/t_grass_01_h.png",
      "heightMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_h.png",
      "internalName": "Grass",
      "macroDistance": 1000,
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "macroSize": 40,
      "macroStrength": 0.5,
      "normalBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        0.699999988,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/grass/t_grass_01/t_grass_01_nm.png",
      "normalMacroStrength": [
        0.5,
        0.5
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_nm.png",
      "roughnessBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/grass/t_grass_01/t_grass_01_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_r.png"
    },
    "ROCK": {
      "annotation": "ROCK",
      "aoBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_ao.png",
      "aoMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_ao.png",
      "baseColorBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.25,
        0.25
      ],
      "baseColorDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_b.png",
      "baseColorMacroStrength": [
        0.100000001,
        0.200000003
      ],
      "baseColorMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_b.png",
      "class": "TerrainMaterial",
      "detailDistance": 25,
      "detailSize": 2,
      "detailStrength": 0.5,
      "diffuseSize": 50,
      "groundmodelName": "ROCK",
      "heightBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_h.png",
      "heightMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_h.png",
      "internalName": "Rock",
      "macroDistance": 1000,
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "macroSize": 40,
      "macroStrength": 0.5,
      "normalBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        0.699999988,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_nm.png",
      "normalMacroStrength": [
        0.5,
        0.5
      ],
      "normalMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_nm.png",
      "roughnessBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_r.png"
    },
    "asphalt": {
      "annotation": "ASPHALT",
      "aoBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_ao.png",
      "aoMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_ao.png",
      "baseColorBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.25,
        0.25
      ],
      "baseColorDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_b.png",
      "baseColorMacroStrength": [
        0.100000001,
        0.200000003
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_b.png",
      "class": "TerrainMaterial",
      "detailDistance": 25,
      "detailSize": 2,
      "detailStrength": 0.5,
      "diffuseSize": 50,
      "groundmodelName": "ASPHALT",
      "heightBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_h.png",
      "heightMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_h.png",
      "internalName": "Asphalt",
      "macroDistance": 1000,
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "macroSize": 40,
      "macroStrength": 0.5,
      "normalBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        0.699999988,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_nm.png",
      "normalMacroStrength": [
        0.5,
        0.5
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_nm.png",
      "roughnessBaseTex": "/levels/gridmap_v2/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_r.png"
    }
  },
  "hirochi_raceway": {
    "BeachSand": {
      "annotation": "SAND",
      "aoBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_ao.png",
      "aoMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_ao.png",
      "baseColorBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.300000012,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_b.png",
      "baseColorMacroStrength": [
        0.100000001,
        0.100000001
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_b.png",
      "class": "TerrainMaterial",
      "detailSize": 2,
      "detailStrength": 0.600000024,
      "diffuseSize": 1536,
      "groundmodelName": "BEACHSAND",
      "heightBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_h.png",
      "heightMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_h.png",
      "internalName": "BeachSand",
      "macroDistance": 450,
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "macroSize": 60,
      "macroStrength": 0.300000012,
      "normalBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        0.5,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/sand/m_terrain_dirt/t_sand_nm.png",
      "normalMacroStrength": [
        0.300000012,
        0.200000003
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_nm.png",
      "roughnessBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_r.png"
    },
    "Dirt": {
      "aoBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_ao.png",
      "aoMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_ao.png",
      "baseColorBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.5,
        0.5
      ],
      "baseColorDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_b.png",
      "baseColorMacroStrength": [
        0.100000001,
        0.100000001
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_b.png",
      "class": "TerrainMaterial",
      "detailSize": 2,
      "detailStrength": 0.600000024,
      "diffuseSize": 1536,
      "groundmodelName": "DIRT",
      "heightBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_h.png",
      "heightMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_h.png",
      "internalName": "dirt",
      "macroDistance": 450,
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "macroSize": 60,
      "macroStrength": 0.300000012,
      "normalBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        0.699999988,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_nm.png",
      "normalMacroStrength": [
        0.2,
        0.2
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_nm.png",
      "roughnessBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_r.png"
    },
    "DirtGrass": {
      "aoBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/soil/t_dirt_dry_grassy/t_dirt_dry_grassy_ao.png",
      "aoMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_ao.png",
      "baseColorBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.25,
        0.5
      ],
      "baseColorDetailTex": "/assets/materials/terrain/soil/t_dirt_dry_grassy/t_dirt_dry_grassy_b.png",
      "baseColorMacroStrength": [
        0.100000001,
        0.100000001
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_b.png",
      "class": "TerrainMaterial",
      "detailSize": 2,
      "detailStrength": 0.600000024,
      "diffuseSize": 1536,
      "groundmodelName": "DIRT_GRASS",
      "heightBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/soil/t_dirt_dry_grassy/t_dirt_dry_grassy_h.png",
      "heightMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_h.png",
      "internalName": "dirt_grass",
      "macroDistance": 450,
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "macroSize": 60,
      "macroStrength": 0.300000012,
      "normalBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        0.699999988,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/soil/t_dirt_dry_grassy/t_dirt_dry_grassy_nm.png",
      "normalMacroStrength": [
        0.5,
        0.5
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_nm.png",
      "roughnessBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/soil/t_dirt_dry_grassy/t_dirt_dry_grassy_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_r.png"
    },
    "Grass": {
      "annotation": "GRASS",
      "aoBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/grass/t_grass_01/t_grass_01_ao.png",
      "aoMacroTex": "/assets/materials/terrain/grass/macro_grass/t_macro_grass_ao.png",
      "aoMacroTexSize": 100,
      "baseColorBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.319999993,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/grass/t_grass_01/t_grass_01_b.png",
      "baseColorMacroStrength": [
        0.150000006,
        0.400000006
      ],
      "baseColorMacroTex": "/assets/materials/terrain/grass/macro_grass/t_macro_grass_b.png",
      "baseColorMacroTexSize": 100,
      "class": "TerrainMaterial",
      "detailDistAtten": [
        0,
        0.899999976
      ],
      "detailDistances": [
        0,
        0,
        30,
        60
      ],
      "groundmodelName": "GRASS",
      "heightBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/grass/t_grass_01/t_grass_01_h.png",
      "heightMacroTex": "/assets/materials/terrain/grass/macro_grass/t_macro_grass_h.png",
      "heightMacroTexSize": 100,
      "internalName": "Grass",
      "macroDistAtten": [
        1,
        1
      ],
      "macroDistances": [
        0,
        30,
        200,
        400
      ],
      "normalBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        0.699999988,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/grass/t_grass_01/t_grass_01_nm.png",
      "normalMacroStrength": [
        0.400000006,
        0.600000024
      ],
      "normalMacroTex": "/assets/materials/terrain/grass/macro_grass/t_macro_grass_nm.png",
      "normalMacroTexSize": 100,
      "roughnessBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.899999976,
        0
      ],
      "roughnessDetailTex": "/assets/materials/terrain/grass/t_grass_01/t_grass_01_r.png",
      "roughnessMacroStrength": [
        0.200000003,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/grass/macro_grass/t_macro_grass_r.png",
      "roughnessMacroTexSize": 100
    },
    "ROCK": {
      "annotation": "ROCK",
      "aoBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_ao.png",
      "aoMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_ao.png",
      "aoMacroTexSize": 10,
      "baseColorBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.25,
        0.25
      ],
      "baseColorDetailTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_b.png",
      "baseColorMacroStrength": [
        0.25,
        0.300000012
      ],
      "baseColorMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_b.png",
      "baseColorMacroTexSize": 10,
      "class": "TerrainMaterial",
      "detailDistances": [
        0,
        0,
        15,
        30
      ],
      "groundmodelName": "ROCK",
      "heightBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_h.png",
      "heightMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_h.png",
      "heightMacroTexSize": 10,
      "internalName": "ROCK",
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "normalBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        0.600000024,
        0.400000006
      ],
      "normalDetailTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_nm.png",
      "normalMacroStrength": [
        0.899999976,
        0.699999988
      ],
      "normalMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_nm.png",
      "normalMacroTexSize": 10,
      "roughnessBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_r.png",
      "roughnessMacroTexSize": 10
    },
    "asphalt": {
      "annotation": "ASPHALT",
      "aoBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_ao.png",
      "aoMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_ao.png",
      "baseColorBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.5,
        0.5
      ],
      "baseColorDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_b.png",
      "baseColorMacroStrength": [
        0.100000001,
        0.100000001
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_b.png",
      "class": "TerrainMaterial",
      "detailSize": 2,
      "detailStrength": 0.600000024,
      "diffuseSize": 1536,
      "groundmodelName": "ASPHALT",
      "heightBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_h.png",
      "heightMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_h.png",
      "internalName": "Asphalt",
      "macroDistance": 450,
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "macroSize": 60,
      "macroStrength": 0.300000012,
      "normalBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        0.699999988,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_nm.png",
      "normalMacroStrength": [
        0.200000003,
        0.200000003
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_nm.png",
      "roughnessBaseTex": "/levels/hirochi_raceway/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_r.png"
    }
  },
  "industrial": {
    "BeachSand": {
      "annotation": "SAND",
      "aoBaseTex": "/levels/industrial/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 1024,
      "aoDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_ao.png",
      "aoMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_ao.png",
      "baseColorBaseTex": "/levels/industrial/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 1024,
      "baseColorDetailStrength": [
        0.25,
        0.25
      ],
      "baseColorDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_b.png",
      "baseColorMacroStrength": [
        0.100000001,
        0.200000003
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_b.png",
      "class": "TerrainMaterial",
      "detailDistance": 80,
      "detailSize": 2,
      "detailStrength": 0.600000024,
      "diffuseSize": 1024,
      "groundmodelName": "BEACHSAND",
      "heightBaseTex": "/levels/industrial/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 1024,
      "heightDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_h.png",
      "heightMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_h.png",
      "internalName": "BeachSand",
      "macroDistance": 800,
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "macroSize": 80,
      "macroStrength": 0.150000006,
      "normalBaseTex": "/levels/industrial/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 1024,
      "normalDetailStrength": [
        0.699999988,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_nm.png",
      "normalMacroStrength": [
        0.100000001,
        0.100000001
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_nm.png",
      "roughnessBaseTex": "/levels/industrial/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 1024,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_r.png"
    },
    "Concrete": {
      "annotation": "ASPHALT",
      "aoBaseTex": "/levels/industrial/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 1024,
      "aoDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_ao.png",
      "aoMacroTex": "/assets/materials/terrain/concrete/macro_concrete/t_macro_concrete_ao.png",
      "aoMacroTexSize": 20,
      "baseColorBaseTex": "/levels/industrial/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 1024,
      "baseColorDetailStrength": [
        0.5,
        0.150000006
      ],
      "baseColorDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_b.png",
      "baseColorMacroStrength": [
        0.5,
        0.300000012
      ],
      "baseColorMacroTex": "/assets/materials/terrain/concrete/macro_concrete/t_macro_concrete_b.png",
      "baseColorMacroTexSize": 20,
      "class": "TerrainMaterial",
      "detailDistance": 80,
      "detailSize": 2,
      "detailStrength": 0.600000024,
      "diffuseSize": 1024,
      "groundmodelName": "CONCRETE",
      "heightBaseTex": "/levels/industrial/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 1024,
      "heightDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_h.png",
      "heightMacroTex": "/assets/materials/terrain/concrete/macro_concrete/t_macro_concrete_h.png",
      "heightMacroTexSize": 20,
      "internalName": "Concrete",
      "macroDistance": 800,
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "macroSize": 80,
      "macroStrength": 0.150000006,
      "normalBaseTex": "/levels/industrial/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 1024,
      "normalDetailStrength": [
        0.600000024,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_nm.png",
      "normalMacroStrength": [
        0.300000012,
        0.300000012
      ],
      "normalMacroTex": "/assets/materials/terrain/concrete/macro_concrete/t_macro_concrete_nm.png",
      "normalMacroTexSize": 20,
      "roughnessBaseTex": "/levels/industrial/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 1024,
      "roughnessDetailStrength": [
        0.699999988,
        0.100000001
      ],
      "roughnessDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_r.png",
      "roughnessMacroStrength": [
        0.200000003,
        0.400000006
      ],
      "roughnessMacroTex": "/assets/materials/terrain/concrete/macro_concrete/t_macro_concrete_r.png",
      "roughnessMacroTexSize": 20
    },
    "Dirt": {
      "aoBaseTex": "/levels/industrial/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 1024,
      "aoDetailTex": "/assets/materials/terrain/soil/dirt_crumbly/t_dirt_crumbly_ao.png",
      "aoMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_ao.png",
      "baseColorBaseTex": "/levels/industrial/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 1024,
      "baseColorDetailStrength": [
        0.5,
        0.25
      ],
      "baseColorDetailTex": "/assets/materials/terrain/soil/dirt_crumbly/t_dirt_crumbly_b.png",
      "baseColorMacroStrength": [
        0.100000001,
        0.200000003
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_b.png",
      "class": "TerrainMaterial",
      "detailDistance": 80,
      "detailSize": 2,
      "detailStrength": 0.600000024,
      "diffuseSize": 1024,
      "groundmodelName": "DIRT",
      "heightBaseTex": "/levels/industrial/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 1024,
      "heightDetailTex": "/assets/materials/terrain/soil/dirt_crumbly/t_dirt_crumbly_h.png",
      "heightMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_h.png",
      "internalName": "dirt",
      "macroDistance": 800,
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "macroSize": 80,
      "macroStrength": 0.150000006,
      "normalBaseTex": "/levels/industrial/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 1024,
      "normalDetailStrength": [
        0.600000024,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/soil/dirt_crumbly/t_dirt_crumbly_nm.png",
      "normalMacroStrength": [
        0.200000003,
        0.5
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_nm.png",
      "roughnessBaseTex": "/levels/industrial/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 1024,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/soil/dirt_crumbly/t_dirt_crumbly_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_r.png"
    },
    "DirtGrass": {
      "annotation": "GRASS",
      "aoBaseTex": "/levels/industrial/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 1024,
      "aoDetailTex": "/assets/materials/terrain/grass/dirt_dry_grassy/t_dirt_dry_grassy_ao.png",
      "aoMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_ao.png",
      "baseColorBaseTex": "/levels/industrial/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 1024,
      "baseColorDetailStrength": [
        0.25,
        0.25
      ],
      "baseColorDetailTex": "/assets/materials/terrain/grass/dirt_dry_grassy/t_dirt_dry_grassy_b.png",
      "baseColorMacroStrength": [
        0.100000001,
        0.200000003
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_b.png",
      "class": "TerrainMaterial",
      "detailDistance": 80,
      "detailSize": 2,
      "detailStrength": 0.600000024,
      "diffuseSize": 1024,
      "groundmodelName": "DIRT_GRASS",
      "heightBaseTex": "/levels/industrial/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 1024,
      "heightDetailTex": "/assets/materials/terrain/grass/dirt_dry_grassy/t_dirt_dry_grassy_h.png",
      "heightMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_h.png",
      "internalName": "dirt_grass",
      "macroDistance": 800,
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "macroSize": 80,
      "macroStrength": 0.150000006,
      "normalBaseTex": "/levels/industrial/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 1024,
      "normalDetailStrength": [
        0.699999988,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/grass/dirt_dry_grassy/t_dirt_dry_grassy_nm.png",
      "normalMacroStrength": [
        0.5,
        0.5
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_nm.png",
      "roughnessBaseTex": "/levels/industrial/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 1024,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/grass/dirt_dry_grassy/t_dirt_dry_grassy_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_r.png"
    },
    "GRAVEL": {
      "annotation": "ROCK",
      "aoBaseTex": "/levels/industrial/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 1024,
      "aoDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_ao.png",
      "aoMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_ao.png",
      "aoMacroTexSize": 10,
      "baseColorBaseTex": "/levels/industrial/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 1024,
      "baseColorDetailStrength": [
        0.400000006,
        0.5
      ],
      "baseColorDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_b.png",
      "baseColorMacroStrength": [
        0.150000006,
        0.150000006
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_b.png",
      "baseColorMacroTexSize": 10,
      "class": "TerrainMaterial",
      "detailDistance": 80,
      "detailSize": 2,
      "detailStrength": 0.600000024,
      "diffuseSize": 1024,
      "groundmodelName": "GRAVEL",
      "heightBaseTex": "/levels/industrial/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 1024,
      "heightDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_h.png",
      "heightMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_h.png",
      "heightMacroTexSize": 10,
      "internalName": "Gravel",
      "macroDistance": 800,
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "macroSize": 80,
      "macroStrength": 0.150000006,
      "normalBaseTex": "/levels/industrial/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 1024,
      "normalDetailStrength": [
        0.699999988,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_nm.png",
      "normalMacroStrength": [
        0.5,
        0.300000012
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_nm.png",
      "normalMacroTexSize": 10,
      "roughnessBaseTex": "/levels/industrial/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 1024,
      "roughnessDetailStrength": [
        0.5,
        0.5
      ],
      "roughnessDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_r.png",
      "roughnessMacroStrength": [
        0,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_r.png",
      "roughnessMacroTexSize": 10
    },
    "Grass": {
      "annotation": "GRASS",
      "aoBaseTex": "/levels/industrial/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 1024,
      "aoDetailTex": "/assets/materials/terrain/grass/ind_grass/t_ind_grass_ao.png",
      "aoMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_ao.png",
      "baseColorBaseTex": "/levels/industrial/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 1024,
      "baseColorDetailStrength": [
        0.400000006,
        0.300000012
      ],
      "baseColorDetailTex": "/assets/materials/terrain/grass/ind_grass/t_ind_grass_b.png",
      "baseColorMacroStrength": [
        0.100000001,
        0.200000003
      ],
      "baseColorMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_b.png",
      "class": "TerrainMaterial",
      "detailDistance": 80,
      "detailSize": 2,
      "detailStrength": 0.600000024,
      "diffuseSize": 1024,
      "groundmodelName": "GRASS",
      "heightBaseTex": "/levels/industrial/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 1024,
      "heightDetailTex": "/assets/materials/terrain/grass/ind_grass/t_ind_grass_h.png",
      "heightMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_h.png",
      "internalName": "Grass",
      "macroDistance": 800,
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "macroSize": 80,
      "macroStrength": 0.150000006,
      "normalBaseTex": "/levels/industrial/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 1024,
      "normalDetailStrength": [
        0.699999988,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/grass/ind_grass/t_ind_grass_nm.png",
      "normalMacroStrength": [
        0.5,
        0.5
      ],
      "normalMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_nm.png",
      "roughnessBaseTex": "/levels/industrial/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 1024,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/grass/ind_grass/t_ind_grass_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_r.png"
    },
    "ROCK": {
      "annotation": "ROCK",
      "aoBaseTex": "/levels/industrial/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 1024,
      "aoDetailTex": "/assets/materials/terrain/soil/dirt_crumbly/t_dirt_crumbly_ao.png",
      "aoMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_ao.png",
      "baseColorBaseTex": "/levels/industrial/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 1024,
      "baseColorDetailStrength": [
        0.25,
        0.25
      ],
      "baseColorDetailTex": "/assets/materials/terrain/soil/dirt_crumbly/t_dirt_crumbly_b.png",
      "baseColorMacroStrength": [
        0.100000001,
        0.200000003
      ],
      "baseColorMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_b.png",
      "class": "TerrainMaterial",
      "detailDistance": 80,
      "detailSize": 2,
      "detailStrength": 0.600000024,
      "diffuseSize": 1024,
      "groundmodelName": "ROCK",
      "heightBaseTex": "/levels/industrial/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 1024,
      "heightDetailTex": "/assets/materials/terrain/soil/dirt_crumbly/t_dirt_crumbly_h.png",
      "heightMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_h.png",
      "internalName": "Rock",
      "macroDistance": 800,
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "macroSize": 80,
      "macroStrength": 0.150000006,
      "normalBaseTex": "/levels/industrial/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 1024,
      "normalDetailStrength": [
        0.699999988,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/soil/dirt_crumbly/t_dirt_crumbly_nm.png",
      "normalMacroStrength": [
        0.5,
        0.5
      ],
      "normalMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_nm.png",
      "roughnessBaseTex": "/levels/Industrial/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 1024,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/soil/dirt_crumbly/t_dirt_crumbly_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_r.png"
    },
    "asphalt": {
      "annotation": "ASPHALT",
      "aoBaseTex": "/levels/industrial/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 1024,
      "aoDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_ao.png",
      "aoMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_ao.png",
      "aoMacroTexSize": 120,
      "baseColorBaseTex": "/levels/industrial/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 1024,
      "baseColorDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "baseColorDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_b.png",
      "baseColorMacroStrength": [
        0.0700000003,
        0.100000001
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_b.png",
      "baseColorMacroTexSize": 120,
      "class": "TerrainMaterial",
      "detailDistance": 80,
      "detailSize": 2,
      "detailStrength": 0.600000024,
      "diffuseSize": 1024,
      "groundmodelName": "GROUNDMODEL_ASPHALT1",
      "heightBaseTex": "/levels/industrial/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 1024,
      "heightDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_h.png",
      "heightMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_h.png",
      "heightMacroTexSize": 120,
      "internalName": "groundmodel_asphalt1",
      "macroDistance": 800,
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "macroSize": 80,
      "macroStrength": 0.150000006,
      "normalBaseTex": "/levels/industrial/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 1024,
      "normalDetailStrength": [
        0.699999988,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_nm.png",
      "normalMacroStrength": [
        0.200000003,
        0.100000001
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_nm.png",
      "normalMacroTexSize": 120,
      "roughnessBaseTex": "/levels/industrial/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 1024,
      "roughnessDetailStrength": [
        0.5,
        0.5
      ],
      "roughnessDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_r.png",
      "roughnessMacroStrength": [
        0,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_r.png",
      "roughnessMacroTexSize": 120
    }
  },
  "italy": {
    "BeachSand": {
      "annotation": "SAND",
      "aoBaseTex": "/levels/italy/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 4096,
      "aoDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_ao.png",
      "aoMacroTex": "/assets/materials/terrain/sand/t_macro_sand/t_macro_sand_ao.png",
      "aoMacroTexSize": 50,
      "baseColorBaseTex": "/levels/italy/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 4096,
      "baseColorDetailStrength": [
        0.349999994,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_b.png",
      "baseColorMacroStrength": [
        0.400000006,
        0.699999988
      ],
      "baseColorMacroTex": "/assets/materials/terrain/sand/m_terrain_dirt/t_macro_sand_b.png",
      "baseColorMacroTexSize": 50,
      "class": "TerrainMaterial",
      "detailDistAtten": [
        0,
        1
      ],
      "detailDistances": [
        0,
        0,
        25,
        50
      ],
      "groundmodelName": "BEACHSAND",
      "heightBaseTex": "/levels/italy/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 4096,
      "heightDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_h.png",
      "heightMacroTex": "/assets/materials/terrain/sand/t_macro_sand/t_macro_sand_h.png",
      "heightMacroTexSize": 50,
      "internalName": "BeachSand",
      "macroDistAtten": [
        0.200000003,
        1
      ],
      "macroDistances": [
        0,
        50,
        1000,
        3000
      ],
      "normalBaseTex": "/levels/italy/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 4096,
      "normalDetailStrength": [
        0.800000012,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_nm.png",
      "normalMacroStrength": [
        0.100000001,
        0.0500000007
      ],
      "normalMacroTex": "/assets/materials/terrain/sand/t_macro_sand/t_macro_sand_nm.png",
      "normalMacroTexSize": 50,
      "roughnessBaseTex": "/levels/italy/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 4096,
      "roughnessDetailStrength": [
        0.5,
        0.100000001
      ],
      "roughnessDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_r.png",
      "roughnessMacroStrength": [
        0.100000001,
        0.600000024
      ],
      "roughnessMacroTex": "/assets/materials/terrain/sand/t_macro_sand/t_macro_sand_r.png",
      "roughnessMacroTexSize": 50
    },
    "Dirt": {
      "aoBaseTex": "/levels/italy/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 4096,
      "aoDetailTex": "/assets/materials/terrain/soil/dirt_loose_dusty/t_dirt_loose_dusty_ao.png",
      "aoMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_ao.png",
      "baseColorBaseTex": "/levels/italy/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 4096,
      "baseColorDetailStrength": [
        0.400000006,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/soil/dirt_loose_dusty/t_dirt_loose_dusty_b.png",
      "baseColorMacroStrength": [
        0.100000001,
        0.100000001
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_b.png",
      "class": "TerrainMaterial",
      "detailDistance": 80,
      "detailDistances": [
        0,
        0,
        25,
        50
      ],
      "detailSize": 2,
      "detailStrength": 0.600000024,
      "diffuseSize": 4096,
      "groundmodelName": "DIRT_LOOSE",
      "heightBaseTex": "/levels/italy/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 4096,
      "heightDetailTex": "/assets/materials/terrain/soil/dirt_loose_dusty/t_dirt_loose_dusty_h.png",
      "heightMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_h.png",
      "internalName": "dirt_loose",
      "macroDistance": 800,
      "macroDistances": [
        0,
        10,
        50,
        3000
      ],
      "macroSize": 80,
      "macroStrength": 0.150000006,
      "normalBaseTex": "/levels/italy/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 4096,
      "normalDetailStrength": [
        0.800000012,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/soil/dirt_loose_dusty/t_dirt_loose_dusty_nm.png",
      "normalMacroStrength": [
        0.200000003,
        0.200000003
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_nm.png",
      "roughnessBaseTex": "/levels/italy/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 4096,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/soil/dirt_loose_dusty/t_dirt_loose_dusty_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_r.png"
    },
    "DirtGrass": {
      "aoBaseTex": "/levels/italy/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 4096,
      "aoDetailTex": "/assets/materials/terrain/soil/dirt_crumbly/t_dirt_crumbly_ao.png",
      "aoMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_ao.png",
      "aoMacroTexSize": 20,
      "baseColorBaseTex": "/levels/italy/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 4096,
      "baseColorDetailStrength": [
        0.25,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/soil/dirt_crumbly/t_dirt_crumbly_b.png",
      "baseColorMacroStrength": [
        0.200000003,
        0.100000001
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_b_02.png",
      "baseColorMacroTexSize": 20,
      "class": "TerrainMaterial",
      "detailDistance": 80,
      "detailDistances": [
        0,
        0,
        25,
        50
      ],
      "detailSize": 2,
      "detailStrength": 0.600000024,
      "diffuseSize": 4096,
      "groundmodelName": "DIRT",
      "heightBaseTex": "/levels/italy/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 4096,
      "heightDetailTex": "/assets/materials/terrain/custom_height_blend/custom_height_blend_h.png",
      "heightMacroStrength": [
        0,
        0
      ],
      "heightMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_h.png",
      "heightMacroTexSize": 20,
      "internalName": "dirt_loose_dusty",
      "macroDistAtten": [
        1,
        1
      ],
      "macroDistance": 800,
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "macroSize": 80,
      "macroStrength": 0.150000006,
      "normalBaseTex": "/levels/italy/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 4096,
      "normalDetailStrength": [
        1,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/soil/dirt_crumbly/t_dirt_crumbly_nm.png",
      "normalMacroStrength": [
        0.5,
        0.300000012
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_nm.png",
      "normalMacroTexSize": 20,
      "roughnessBaseTex": "/levels/italy/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 4096,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/soil/dirt_crumbly/t_dirt_crumbly_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_r.png",
      "roughnessMacroTexSize": 20
    },
    "Grass": {
      "annotation": "GRASS",
      "aoBaseTex": "/levels/italy/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 4096,
      "aoDetailTex": "/assets/materials/terrain/grass/ind_grass/t_ind_grass_ao.png",
      "aoMacroTex": "/assets/materials/terrain/grass/macro_grass/t_macro_grass_ao.png",
      "aoMacroTexSize": 150,
      "baseColorBaseTex": "/levels/italy/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 4096,
      "baseColorDetailStrength": [
        0.349999994,
        0.300000012
      ],
      "baseColorDetailTex": "/assets/materials/terrain/grass/ind_grass/t_ind_grass_b.png",
      "baseColorMacroStrength": [
        0.100000001,
        0.200000003
      ],
      "baseColorMacroTex": "/assets/materials/terrain/grass/macro_grass/t_macro_grass_b.png",
      "baseColorMacroTexSize": 150,
      "class": "TerrainMaterial",
      "detailDistance": 80,
      "detailDistances": [
        0,
        0,
        25,
        50
      ],
      "detailSize": 2,
      "detailStrength": 0.600000024,
      "diffuseSize": 4096,
      "groundmodelName": "GRASS",
      "heightBaseTex": "/levels/italy/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 4096,
      "heightDetailTex": "/assets/materials/terrain/grass/ind_grass/t_ind_grass_h.png",
      "heightMacroTex": "/assets/materials/terrain/grass/macro_grass/t_macro_grass_h.png",
      "heightMacroTexSize": 150,
      "internalName": "Grass",
      "macroDistance": 800,
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "macroSize": 80,
      "macroStrength": 0.150000006,
      "normalBaseTex": "/levels/italy/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 4096,
      "normalDetailStrength": [
        0.699999988,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/grass/ind_grass/t_ind_grass_nm.png",
      "normalMacroStrength": [
        0,
        0.5
      ],
      "normalMacroTex": "/assets/materials/terrain/grass/macro_grass/t_macro_grass_nm.png",
      "normalMacroTexSize": 150,
      "roughnessBaseTex": "/levels/italy/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 4096,
      "roughnessDetailStrength": [
        1,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/grass/ind_grass/t_ind_grass_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/grass/macro_grass/t_macro_grass_r.png",
      "roughnessMacroTexSize": 150
    },
    "ROCK": {
      "annotation": "ROCK",
      "aoBaseTex": "/levels/italy/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 4096,
      "aoDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_ao.png",
      "aoMacroTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_ao.png",
      "aoMacroTexSize": 20,
      "baseColorBaseTex": "/levels/italy/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 4096,
      "baseColorDetailStrength": [
        0.5,
        0.25
      ],
      "baseColorDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_b.png",
      "baseColorMacroStrength": [
        0.5,
        0.5
      ],
      "baseColorMacroTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_b.png",
      "baseColorMacroTexSize": 20,
      "class": "TerrainMaterial",
      "detailDistances": [
        0,
        0,
        20,
        40
      ],
      "groundmodelName": "ROCK",
      "heightBaseTex": "/levels/italy/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 4096,
      "heightDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_h.png",
      "heightMacroTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_h.png",
      "heightMacroTexSize": 20,
      "internalName": "Rock",
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "normalBaseTex": "/levels/italy/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 4096,
      "normalDetailStrength": [
        0.5,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_nm.png",
      "normalMacroStrength": [
        0.5,
        0.800000012
      ],
      "normalMacroTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_nm.png",
      "normalMacroTexSize": 20,
      "roughnessBaseTex": "/levels/italy/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 4096,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_r.png",
      "roughnessMacroTexSize": 20
    },
    "asphalt": {
      "annotation": "ASPHALT",
      "aoBaseTex": "/levels/italy/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 4096,
      "aoDetailTex": "/assets/materials/terrain/asphalt/t_asphalt_02/t_asphalt_02_ao.png",
      "aoMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_ao.png",
      "aoMacroTexSize": 100,
      "baseColorBaseTex": "/levels/italy/art/terrains/t_terrain_base_asphalt_b.png",
      "baseColorBaseTexSize": 4096,
      "baseColorDetailStrength": [
        0.500000003,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/asphalt/t_asphalt_02/t_asphalt_02_b.png",
      "baseColorMacroStrength": [
        0.400000003,
        0.400000001
      ],
      "baseColorMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_b.png",
      "baseColorMacroTexSize": 100,
      "class": "TerrainMaterial",
      "detailDistances": [
        0,
        0,
        100,
        3000
      ],
      "groundmodelName": "ASPHALT",
      "heightBaseTex": "/levels/italy/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 4096,
      "heightDetailTex": "/assets/materials/terrain/custom_height_blend/custom_height_blend_02_h.png",
      "heightMacroStrength": [
        0,
        0
      ],
      "heightMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_h.png",
      "heightMacroTexSize": 100,
      "internalName": "asphalt",
      "macroDistAtten": [
        1,
        1
      ],
      "macroDistances": [
        0,
        0,
        200,
        3000
      ],
      "normalBaseTex": "/levels/italy/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 4096,
      "normalDetailStrength": [
        0.5,
        0.200000003
      ],
      "normalDetailTex": "/assets/materials/terrain/asphalt/t_asphalt_02/t_asphalt_02_nm.png",
      "normalMacroStrength": [
        0.100000001,
        0.100000001
      ],
      "normalMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_nm.png",
      "normalMacroTexSize": 100,
      "roughnessBaseTex": "/levels/italy/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 4096,
      "roughnessDetailStrength": [
        0.600000012,
        0
      ],
      "roughnessDetailTex": "/assets/materials/terrain/asphalt/t_asphalt_02/t_asphalt_02_r.png",
      "roughnessMacroStrength": [
        0.200000003,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_r.png",
      "roughnessMacroTexSize": 100
    }
  },
  "johnson_valley": {
    "BeachSand": {
      "annotation": "SAND",
      "aoBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 4096,
      "aoDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_ao.png",
      "aoDetailTexSize": 3,
      "aoMacroTex": "/assets/materials/terrain/sand/t_macro_sand/t_macro_sand_ao.png",
      "aoMacroTexSize": 50,
      "baseColorBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 4096,
      "baseColorDetailStrength": [
        0.25,
        0.100000001
      ],
      "baseColorDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_b.png",
      "baseColorDetailTexSize": 3,
      "baseColorMacroStrength": [
        0.400000006,
        0.400000006
      ],
      "baseColorMacroTex": "/assets/materials/terrain/sand/m_terrain_dirt/t_macro_sand_b.png",
      "baseColorMacroTexSize": 50,
      "class": "TerrainMaterial",
      "detailDistances": [
        0,
        0,
        30,
        60
      ],
      "groundmodelName": "SAND",
      "heightBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 4096,
      "heightDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_h.png",
      "heightDetailTexSize": 3,
      "heightMacroTex": "/assets/materials/terrain/sand/t_macro_sand/t_macro_sand_h.png",
      "heightMacroTexSize": 50,
      "internalName": "sand",
      "macroDistances": [
        0,
        0,
        100,
        1000
      ],
      "normalBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 4096,
      "normalDetailStrength": [
        0.699999988,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/sand/m_terrain_dirt/t_sand_nm.png",
      "normalDetailTexSize": 3,
      "normalMacroStrength": [
        0.699999988,
        0.300000012
      ],
      "normalMacroTex": "/assets/materials/terrain/sand/t_macro_sand/t_macro_sand_nm.png",
      "normalMacroTexSize": 50,
      "roughnessBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 4096,
      "roughnessDetailStrength": [
        1,
        0.5
      ],
      "roughnessDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_r.png",
      "roughnessDetailTexSize": 3,
      "roughnessMacroStrength": [
        0,
        1
      ],
      "roughnessMacroTex": "/assets/materials/terrain/sand/t_macro_sand/t_macro_sand_r.png",
      "roughnessMacroTexSize": 50
    },
    "Dirt": {
      "aoBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 4096,
      "aoDetailTex": "/assets/materials/terrain/soil/dirt_loose_dusty/t_dirt_loose_dusty_ao.png",
      "aoDetailTexSize": 3,
      "aoMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_ao.png",
      "aoMacroTexSize": 80,
      "baseColorBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 4096,
      "baseColorDetailStrength": [
        0.25,
        0.100000001
      ],
      "baseColorDetailTex": "/assets/materials/terrain/soil/dirt_loose_dusty/t_dirt_loose_dusty_b.png",
      "baseColorDetailTexSize": 3,
      "baseColorMacroStrength": [
        0.400000006,
        0.5
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_b.png",
      "baseColorMacroTexSize": 80,
      "class": "TerrainMaterial",
      "groundmodelName": "DIRT_ROCKY",
      "heightBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 4096,
      "heightDetailTex": "/assets/materials/terrain/soil/dirt_loose_dusty/t_dirt_loose_dusty_h.png",
      "heightDetailTexSize": 3,
      "heightMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_h.png",
      "heightMacroTexSize": 80,
      "internalName": "Dirt",
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "normalBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 4096,
      "normalDetailStrength": [
        0.5,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/soil/dirt_loose_dusty/t_dirt_loose_dusty_nm.png",
      "normalDetailTexSize": 3,
      "normalMacroStrength": [
        0.699999988,
        0.5
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_nm.png",
      "normalMacroTexSize": 80,
      "roughnessBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 4096,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/soil/dirt_loose_dusty/t_dirt_loose_dusty_r.png",
      "roughnessDetailTexSize": 3,
      "roughnessMacroStrength": [
        0.150000006,
        0.800000012
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_r.png",
      "roughnessMacroTexSize": 80
    },
    "DirtGrass": {
      "annotation": "GRASS",
      "aoBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 4096,
      "aoDetailTex": "/assets/materials/terrain/grass/t_dirt_dry_grass/t_dirt_dry_grass_ao.png",
      "aoDetailTexSize": 3,
      "aoMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_ao.png",
      "aoMacroTexSize": 80,
      "baseColorBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 4096,
      "baseColorDetailStrength": [
        0.200000003,
        0.100000001
      ],
      "baseColorDetailTex": "/assets/materials/terrain/grass/t_dirt_dry_grass/t_dirt_dry_grass_b.png",
      "baseColorDetailTexSize": 3,
      "baseColorMacroStrength": [
        0,
        0
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_b.png",
      "baseColorMacroTexSize": 80,
      "class": "TerrainMaterial",
      "groundmodelName": "DIRT_GRASS",
      "heightBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 4096,
      "heightDetailTex": "/assets/materials/terrain/grass/t_dirt_dry_grass/t_dirt_dry_grass_h.png",
      "heightDetailTexSize": 3,
      "heightMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_h.png",
      "heightMacroTexSize": 80,
      "internalName": "dirt_grass",
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "normalBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 4096,
      "normalDetailStrength": [
        0.699999988,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/grass/t_dirt_dry_grass/t_dirt_dry_grass_nm.png",
      "normalDetailTexSize": 3,
      "normalMacroStrength": [
        0.5,
        0.5
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_nm.png",
      "normalMacroTexSize": 80,
      "roughnessBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 4096,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/grass/t_dirt_dry_grass/t_dirt_dry_grass_r.png",
      "roughnessDetailTexSize": 3,
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_r.png",
      "roughnessMacroTexSize": 80
    },
    "GRAVEL": {
      "annotation": "ROCK",
      "aoBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 4096,
      "aoDetailTex": "/assets/materials/terrain/rock/terrain_dirt_rocky_large/t_dirt_rocks_large_ao.png",
      "aoDetailTexSize": 3,
      "aoMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_ao.png",
      "aoMacroTexSize": 100,
      "baseColorBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 4096,
      "baseColorDetailStrength": [
        0.200000003,
        0.200000003
      ],
      "baseColorDetailTex": "/assets/materials/terrain/rock/terrain_dirt_rocky_large/t_dirt_rocks_large_b.png",
      "baseColorDetailTexSize": 3,
      "baseColorMacroStrength": [
        0.100000001,
        0.200000003
      ],
      "baseColorMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_b.png",
      "baseColorMacroTexSize": 100,
      "class": "TerrainMaterial",
      "detailDistances": [
        0,
        0,
        50,
        80
      ],
      "groundmodelName": "DIRT_ROCKY_LARGE",
      "heightBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 4096,
      "heightDetailTex": "/assets/materials/terrain/rock/terrain_dirt_rocky_large/t_dirt_rocks_large_h.png",
      "heightDetailTexSize": 3,
      "heightMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_h.png",
      "heightMacroTexSize": 100,
      "internalName": "dirt_rocky_large",
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "normalBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 4096,
      "normalDetailStrength": [
        0.800000012,
        0.300000012
      ],
      "normalDetailTex": "/assets/materials/terrain/rock/terrain_dirt_rocky_large/t_dirt_rocks_large_nm.png",
      "normalDetailTexSize": 3,
      "normalMacroStrength": [
        0.600000024,
        0.5
      ],
      "normalMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_nm.png",
      "normalMacroTexSize": 100,
      "roughnessBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 4096,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/rock/terrain_dirt_rocky_large/t_dirt_rocks_large_r.png",
      "roughnessDetailTexSize": 3,
      "roughnessMacroStrength": [
        0.150000006,
        0.800000012
      ],
      "roughnessMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_r.png",
      "roughnessMacroTexSize": 100
    },
    "Grass": {
      "annotation": "GRASS",
      "aoBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 4096,
      "aoDetailTex": "/assets/materials/terrain/grass/dirt_dry_grassy/t_dirt_dry_grassy_ao.png",
      "aoDetailTexSize": 3,
      "aoMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_ao.png",
      "aoMacroTexSize": 100,
      "baseColorBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 4096,
      "baseColorDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "baseColorDetailTex": "/assets/materials/terrain/grass/dirt_dry_grassy/t_dirt_dry_grassy_b.png",
      "baseColorDetailTexSize": 3,
      "baseColorMacroStrength": [
        0.5,
        0.5
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_b.png",
      "baseColorMacroTexSize": 100,
      "class": "TerrainMaterial",
      "groundmodelName": "GRASS",
      "heightBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 4096,
      "heightDetailTex": "/assets/materials/terrain/grass/dirt_dry_grassy/t_dirt_dry_grassy_h.png",
      "heightDetailTexSize": 3,
      "heightMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_h.png",
      "heightMacroTexSize": 100,
      "internalName": "Grass",
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "normalBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 4096,
      "normalDetailStrength": [
        0.600000024,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/grass/dirt_dry_grassy/t_dirt_dry_grassy_nm.png",
      "normalDetailTexSize": 3,
      "normalMacroStrength": [
        0.5,
        0.25
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_nm.png",
      "normalMacroTexSize": 100,
      "roughnessBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 4096,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/grass/dirt_dry_grassy/t_dirt_dry_grassy_r.png",
      "roughnessDetailTexSize": 3,
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_r.png",
      "roughnessMacroTexSize": 100
    },
    "ROCK": {
      "annotation": "COBBLESTONE",
      "aoBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 4096,
      "aoDetailTex": "/assets/materials/terrain/rock/m_terrain_dirt/t_dirt_rocky_ao.png",
      "aoDetailTexSize": 3,
      "aoMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_ao.png",
      "baseColorBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 4096,
      "baseColorDetailStrength": [
        0.25,
        0.200000003
      ],
      "baseColorDetailTex": "/assets/materials/terrain/rock/m_terrain_dirt/t_dirt_rocky_b.png",
      "baseColorDetailTexSize": 3,
      "baseColorMacroStrength": [
        0.100000001,
        0.200000003
      ],
      "baseColorMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_b.png",
      "class": "TerrainMaterial",
      "detailDistances": [
        0,
        0,
        50,
        80
      ],
      "groundmodelName": "DIRT_ROCKY",
      "heightBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 4096,
      "heightDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_h.png",
      "heightDetailTexSize": 3,
      "heightMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_h.png",
      "internalName": "dirt_rocky",
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "normalBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 4096,
      "normalDetailStrength": [
        0.800000012,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_nm.png",
      "normalDetailTexSize": 3,
      "normalMacroStrength": [
        0.600000024,
        0.5
      ],
      "normalMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_nm.png",
      "roughnessBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 4096,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_r.png",
      "roughnessDetailTexSize": 3,
      "roughnessMacroStrength": [
        0.150000006,
        0.800000012
      ],
      "roughnessMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_r.png"
    },
    "asphalt": {
      "annotation": "ASPHALT",
      "aoBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 4096,
      "aoDetailTex": "/assets/materials/terrain/asphalt/t_asphalt_02/t_asphalt_02_ao.png",
      "aoMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_ao.png",
      "aoMacroTexSize": 100,
      "baseColorBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_asphalt_b.png",
      "baseColorBaseTexSize": 4096,
      "baseColorDetailStrength": [
        0.200000003,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/asphalt/t_asphalt_02/t_asphalt_02_b.png",
      "baseColorMacroStrength": [
        0.200000003,
        0.100000001
      ],
      "baseColorMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_02_b.png",
      "baseColorMacroTexSize": 100,
      "class": "TerrainMaterial",
      "detailDistances": [
        0,
        0,
        50,
        3000
      ],
      "groundmodelName": "ASPHALT",
      "heightBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 4096,
      "heightDetailTex": "/assets/materials/terrain/custom_height_blend/custom_height_blend_02_h.png",
      "heightMacroStrength": [
        0,
        0
      ],
      "heightMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_h.png",
      "heightMacroTexSize": 100,
      "internalName": "asphalt",
      "macroDistAtten": [
        1,
        1
      ],
      "macroDistances": [
        0,
        0,
        100,
        3000
      ],
      "normalBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 4096,
      "normalDetailStrength": [
        0.5,
        0.200000003
      ],
      "normalDetailTex": "/assets/materials/terrain/asphalt/t_asphalt_02/t_asphalt_02_nm.png",
      "normalMacroStrength": [
        0.100000001,
        0.100000001
      ],
      "normalMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_nm.png",
      "normalMacroTexSize": 100,
      "roughnessBaseTex": "/levels/johnson_valley/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 4096,
      "roughnessDetailStrength": [
        0.600000012,
        0
      ],
      "roughnessDetailTex": "/assets/materials/terrain/asphalt/t_asphalt_02/t_asphalt_02_r.png",
      "roughnessMacroStrength": [
        0.200000003,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_r.png",
      "roughnessMacroTexSize": 100
    }
  },
  "jungle_rock_island": {
    "BeachSand": {
      "annotation": "SAND",
      "aoBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_ao.png",
      "aoMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_ao.png",
      "baseColorBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.550000012,
        0.25
      ],
      "baseColorDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_b.png",
      "baseColorMacroStrength": [
        0.100000001,
        0.200000003
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_b.png",
      "class": "TerrainMaterial",
      "groundmodelName": "SAND",
      "heightBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_h.png",
      "heightMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_h.png",
      "internalName": "BeachSand",
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "normalBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        0.699999988,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_nm.png",
      "normalMacroStrength": [
        0.200000003,
        0.300000012
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_nm.png",
      "roughnessBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_r.png"
    },
    "Concrete": {
      "annotation": "ASPHALT",
      "aoBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_ao.png",
      "aoMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_ao.png",
      "baseColorBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.349999994,
        0.349999994
      ],
      "baseColorDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_b.png",
      "baseColorMacroStrength": [
        0.200000003,
        0.300000012
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_b.png",
      "class": "TerrainMaterial",
      "groundmodelName": "ASPHALT_OLD",
      "heightBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_h.png",
      "heightMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_h.png",
      "internalName": "Concrete",
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "normalBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        0.699999988,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_nm.png",
      "normalMacroStrength": [
        0.5,
        0.300000012
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_nm.png",
      "roughnessBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_r.png"
    },
    "Dirt": {
      "aoBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailStrength": [
        1,
        1
      ],
      "aoDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_ao.png",
      "aoDetailTexSize": 2,
      "aoMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_ao.png",
      "aoMacroTexSize": 60,
      "baseColorBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.35,
        0.35
      ],
      "baseColorDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_b.png",
      "baseColorDetailTexSize": 2,
      "baseColorMacroStrength": [
        0.15,
        0.3
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_b.png",
      "baseColorMacroTexSize": 60,
      "class": "TerrainMaterial",
      "detailDistAtten": [
        1,
        1
      ],
      "detailDistances": [
        0,
        0,
        50,
        100
      ],
      "groundmodelName": "DIRT",
      "heightBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_h.png",
      "heightDetailTexSize": 2,
      "heightMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_h.png",
      "heightMacroTexSize": 60,
      "internalName": "Dirt",
      "macroDistAtten": [
        0,
        1
      ],
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "normalBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        0.7,
        0.15
      ],
      "normalDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_nm.png",
      "normalDetailTexSize": 2,
      "normalMacroStrength": [
        0.5,
        0.6
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_nm.png",
      "normalMacroTexSize": 60,
      "roughnessBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.3,
        0.3
      ],
      "roughnessDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_r.png",
      "roughnessDetailTexSize": 2,
      "roughnessMacroStrength": [
        0.15,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_r.png",
      "roughnessMacroTexSize": 60
    },
    "DirtGrass": {
      "aoBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailStrength": [
        1,
        1
      ],
      "aoDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_ao.png",
      "aoDetailTexSize": 2,
      "aoMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_ao.png",
      "aoMacroTexSize": 60,
      "baseColorBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.25,
        0.25
      ],
      "baseColorDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_b.png",
      "baseColorDetailTexSize": 2,
      "baseColorMacroStrength": [
        0.1,
        0.2
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_b.png",
      "baseColorMacroTexSize": 60,
      "class": "TerrainMaterial",
      "detailDistAtten": [
        1,
        1
      ],
      "detailDistances": [
        0,
        0,
        50,
        100
      ],
      "groundmodelName": "GRAVEL",
      "heightBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_h.png",
      "heightDetailTexSize": 2,
      "heightMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_h.png",
      "heightMacroTexSize": 60,
      "internalName": "dirt_loose",
      "macroDistAtten": [
        0,
        1
      ],
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "normalBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        0.7,
        0.15
      ],
      "normalDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_nm.png",
      "normalDetailTexSize": 2,
      "normalMacroStrength": [
        0.5,
        0.6
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_nm.png",
      "normalMacroTexSize": 60,
      "roughnessBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.3,
        0.3
      ],
      "roughnessDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_r.png",
      "roughnessDetailTexSize": 2,
      "roughnessMacroStrength": [
        0.15,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_r.png",
      "roughnessMacroTexSize": 60
    },
    "GRAVEL": {
      "aoBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/rock/t_pebbles/t_pebbles_ao.png",
      "aoMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_ao.png",
      "baseColorBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.349999994,
        0.349999994
      ],
      "baseColorDetailTex": "/assets/materials/terrain/rock/t_pebbles/t_pebbles_b.png",
      "baseColorMacroStrength": [
        0.200000003,
        0.400000006
      ],
      "baseColorMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_b.png",
      "class": "TerrainMaterial",
      "groundmodelName": "GRAVEL_WET",
      "heightBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/rock/t_pebbles/t_pebbles_h.png",
      "heightMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_h.png",
      "internalName": "gravel_wet",
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "normalBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        0.699999988,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/rock/t_pebbles/t_pebbles_nm.png",
      "normalMacroStrength": [
        0.5,
        0.600000024
      ],
      "normalMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_nm.png",
      "roughnessBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.5,
        0.5
      ],
      "roughnessDetailTex": "/assets/materials/terrain/rock/t_pebbles/t_pebbles_r.png",
      "roughnessMacroStrength": [
        0.200000003,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_r.png"
    },
    "Grass": {
      "annotation": "GRASS",
      "aoBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/grass/t_grass_02/t_grass_02_ao.png",
      "aoMacroTex": "/assets/materials/terrain/grass/t_macro_grass/t_macro_grass_ao.png",
      "aoMacroTexSize": 50,
      "baseColorBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.300000012,
        0.150000006
      ],
      "baseColorDetailTex": "/assets/materials/terrain/grass/t_grass_02/t_grass_02_b.png",
      "baseColorMacroStrength": [
        0.200000003,
        0.300000012
      ],
      "baseColorMacroTex": "/assets/materials/terrain/grass/t_macro_grass/t_macro_grass_b.png",
      "baseColorMacroTexSize": 50,
      "class": "TerrainMaterial",
      "detailDistances": [
        0,
        0,
        40,
        70
      ],
      "groundmodelName": "GRASS",
      "heightBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/grass/t_grass_02/t_grass_02_h.png",
      "heightMacroTex": "/assets/materials/terrain/grass/t_macro_grass/t_macro_grass_h.png",
      "heightMacroTexSize": 50,
      "internalName": "Grass",
      "macroDistances": [
        0,
        10,
        100,
        8000
      ],
      "normalBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        0.800000012,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/grass/t_grass_02/t_grass_02_nm.png",
      "normalMacroStrength": [
        0.400000006,
        0.699999988
      ],
      "normalMacroTex": "/assets/materials/terrain/grass/t_macro_grass/t_macro_grass_nm.png",
      "normalMacroTexSize": 50,
      "roughnessBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.800000012,
        0.800000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/grass/t_grass_02/t_grass_02_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.800000012
      ],
      "roughnessMacroTex": "/assets/materials/terrain/grass/t_macro_grass/t_macro_grass_r.png",
      "roughnessMacroTexSize": 50
    },
    "ROCK": {
      "annotation": "ROCK",
      "aoBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_ao.png",
      "aoMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_ao.png",
      "baseColorBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.25,
        0.25
      ],
      "baseColorDetailTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_b.png",
      "baseColorMacroStrength": [
        0.100000001,
        0.200000003
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_b.png",
      "class": "TerrainMaterial",
      "groundmodelName": "ROCK",
      "heightBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_h.png",
      "heightMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_h.png",
      "internalName": "Rock",
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "normalBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        0.699999988,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_nm.png",
      "normalMacroStrength": [
        0.5,
        0.600000024
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_nm.png",
      "roughnessBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_r.png"
    },
    "asphalt": {
      "annotation": "ASPHALT",
      "aoBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/asphalt/t_asphalt_02/t_asphalt_02_ao.png",
      "aoMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_ao.png",
      "aoMacroTexSize": 50,
      "baseColorBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.400000006,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/asphalt/t_asphalt_02/t_asphalt_02_b.png",
      "baseColorMacroStrength": [
        0.100000001,
        0.200000003
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_b.png",
      "baseColorMacroTexSize": 50,
      "class": "TerrainMaterial",
      "groundmodelName": "ASPHALT_OLD",
      "heightBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/asphalt/t_asphalt_02/t_asphalt_02_h.png",
      "heightMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_h.png",
      "heightMacroTexSize": 50,
      "internalName": "groundmodel_asphalt1",
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "normalBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        0.699999988,
        0.200000003
      ],
      "normalDetailTex": "/assets/materials/terrain/asphalt/t_asphalt_02/t_asphalt_02_nm.png",
      "normalMacroStrength": [
        0.100000001,
        0.200000003
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_nm.png",
      "normalMacroTexSize": 50,
      "roughnessBaseTex": "/levels/jungle_rock_island/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.800000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/asphalt/t_asphalt_02/t_asphalt_02_r.png",
      "roughnessMacroStrength": [
        0.200000003,
        0.400000006
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_r.png",
      "roughnessMacroTexSize": 50
    }
  },
  "small_island": {
    "BeachSand": {
      "annotation": "SAND",
      "aoBaseTex": "/levels/small_island/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 1024,
      "aoDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_ao.png",
      "aoMacroTex": "/assets/materials/terrain/sand/t_macro_sand/t_macro_sand_ao.png",
      "aoMacroTexSize": 50,
      "baseColorBaseTex": "/levels/small_island/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 1024,
      "baseColorDetailStrength": [
        0.349999994,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_b.png",
      "baseColorMacroStrength": [
        0.400000006,
        0.699999988
      ],
      "baseColorMacroTex": "/assets/materials/terrain/sand/m_terrain_dirt/t_macro_sand_b.png",
      "baseColorMacroTexSize": 50,
      "class": "TerrainMaterial",
      "detailDistAtten": [
        0,
        0.899999976
      ],
      "detailDistances": [
        0,
        0,
        30,
        50
      ],
      "groundmodelName": "BEACHSAND",
      "heightBaseTex": "/levels/small_island/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 1024,
      "heightDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_h.png",
      "heightMacroTex": "/assets/materials/terrain/sand/t_macro_sand/t_macro_sand_h.png",
      "heightMacroTexSize": 50,
      "internalName": "BeachSand",
      "macroDistAtten": [
        0.349999994,
        1
      ],
      "macroDistances": [
        5,
        10,
        1000,
        8600
      ],
      "normalBaseTex": "/levels/small_island/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 1024,
      "normalDetailStrength": [
        0.400000006,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_nm.png",
      "normalMacroStrength": [
        0.150000006,
        0.150000006
      ],
      "normalMacroTex": "/assets/materials/terrain/sand/t_macro_sand/t_macro_sand_nm.png",
      "normalMacroTexSize": 50,
      "roughnessBaseTex": "/levels/small_island/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 1024,
      "roughnessDetailStrength": [
        0.5,
        0.100000001
      ],
      "roughnessDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_r.png",
      "roughnessMacroStrength": [
        0.100000001,
        0.600000024
      ],
      "roughnessMacroTex": "/assets/materials/terrain/sand/t_macro_sand/t_macro_sand_r.png",
      "roughnessMacroTexSize": 50
    },
    "Concrete": {
      "annotation": "ASPHALT",
      "aoBaseTex": "/levels/small_island/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 1024,
      "aoDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_ao.png",
      "aoMacroTex": "/assets/materials/terrain/concrete/macro_concrete/t_macro_concrete_ao.png",
      "aoMacroTexSize": 20,
      "baseColorBaseTex": "/levels/small_island/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 1024,
      "baseColorDetailStrength": [
        0.400000006,
        0.150000006
      ],
      "baseColorDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_b.png",
      "baseColorMacroStrength": [
        0.5,
        0.300000012
      ],
      "baseColorMacroTex": "/assets/materials/terrain/concrete/macro_concrete/t_macro_concrete_b.png",
      "baseColorMacroTexSize": 20,
      "class": "TerrainMaterial",
      "detailDistance": 80,
      "detailSize": 2,
      "detailStrength": 0.600000024,
      "diffuseSize": 1024,
      "groundmodelName": "CONCRETE",
      "heightBaseTex": "/levels/small_island/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 1024,
      "heightDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_h.png",
      "heightMacroTex": "/assets/materials/terrain/concrete/macro_concrete/t_macro_concrete_h.png",
      "heightMacroTexSize": 20,
      "internalName": "Concrete",
      "macroDistance": 800,
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "macroSize": 80,
      "macroStrength": 0.150000006,
      "normalBaseTex": "/levels/small_island/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 1024,
      "normalDetailStrength": [
        0.600000024,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_nm.png",
      "normalMacroStrength": [
        0.600000024,
        0.600000024
      ],
      "normalMacroTex": "/assets/materials/terrain/concrete/macro_concrete/t_macro_concrete_nm.png",
      "normalMacroTexSize": 20,
      "roughnessBaseTex": "/levels/small_island/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 1024,
      "roughnessDetailStrength": [
        0.699999988,
        0.100000001
      ],
      "roughnessDetailTex": "/assets/materials/terrain/concrete/concrete/t_concrete_damaged_r.png",
      "roughnessMacroStrength": [
        0.200000003,
        0.400000006
      ],
      "roughnessMacroTex": "/assets/materials/terrain/concrete/macro_concrete/t_macro_concrete_r.png",
      "roughnessMacroTexSize": 20
    },
    "Dirt": {
      "aoBaseTex": "/levels/small_island/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 1024,
      "aoDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_ao.png",
      "aoMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_ao.png",
      "baseColorBaseTex": "/levels/small_island/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 1024,
      "baseColorDetailStrength": [
        0.349999994,
        0.349999994
      ],
      "baseColorDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_b.png",
      "baseColorMacroStrength": [
        0.100000001,
        0.200000003
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_b.png",
      "class": "TerrainMaterial",
      "detailDistAtten": [
        0,
        1
      ],
      "detailDistances": [
        0,
        0,
        100,
        200
      ],
      "groundmodelName": "DIRT_LOOSE",
      "heightBaseTex": "/levels/small_island/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 1024,
      "heightDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_h.png",
      "heightMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_h.png",
      "internalName": "dirt_loose",
      "macroDistances": [
        0,
        100,
        1000,
        9000
      ],
      "normalBaseTex": "/levels/small_island/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 1024,
      "normalDetailStrength": [
        0.600000024,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_nm.png",
      "normalMacroStrength": [
        0.400000006,
        0.600000024
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_nm.png",
      "roughnessBaseTex": "/levels/small_island/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 1024,
      "roughnessDetailStrength": [
        0.100000001,
        0
      ],
      "roughnessDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_r.png",
      "roughnessMacroStrength": [
        0,
        0.100000001
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_r.png"
    },
    "DirtGrass": {
      "aoBaseTex": "/levels/small_island/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 1024,
      "aoDetailTex": "/assets/materials/terrain/rock/m_terrain_dirt/t_dirt_rocky_ao.png",
      "aoMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_ao.png",
      "aoMacroTexSize": 50,
      "baseColorBaseTex": "/levels/small_island/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 1024,
      "baseColorDetailStrength": [
        0.300000012,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/rock/m_terrain_dirt/t_dirt_rocky_b.png",
      "baseColorMacroStrength": [
        0.0700000003,
        0.25
      ],
      "baseColorMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_b.png",
      "baseColorMacroTexSize": 50,
      "class": "TerrainMaterial",
      "detailDistances": [
        0,
        0,
        60,
        140
      ],
      "groundmodelName": "DIRT_GRASS",
      "heightBaseTex": "/levels/small_island/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 1024,
      "heightDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_h.png",
      "heightMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_h.png",
      "heightMacroTexSize": 50,
      "internalName": "dirt_grass",
      "macroDistAtten": [
        0.5,
        1
      ],
      "macroDistances": [
        0,
        0,
        100,
        10000
      ],
      "normalBaseTex": "/levels/small_island/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 1024,
      "normalDetailStrength": [
        0.600000024,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_nm.png",
      "normalMacroStrength": [
        0.600000024,
        0.5
      ],
      "normalMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_nm.png",
      "normalMacroTexSize": 50,
      "roughnessBaseTex": "/levels/small_island/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 1024,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.800000012
      ],
      "roughnessMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_r.png",
      "roughnessMacroTexSize": 50
    },
    "GRAVEL": {
      "annotation": "ROCK",
      "aoBaseTex": "/levels/small_island/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 1024,
      "aoDetailTex": "/assets/materials/terrain/rock/terrain_dirt_rocky_large/t_dirt_rocks_large_ao.png",
      "aoMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_ao.png",
      "aoMacroTexSize": 70,
      "baseColorBaseTex": "/levels/small_island/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 1024,
      "baseColorDetailStrength": [
        0.25,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/rock/terrain_dirt_rocky_large/t_dirt_rocks_large_b.png",
      "baseColorMacroStrength": [
        0.100000001,
        0.25
      ],
      "baseColorMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_b.png",
      "baseColorMacroTexSize": 70,
      "class": "TerrainMaterial",
      "detailDistAtten": [
        0,
        1
      ],
      "detailDistances": [
        0,
        0,
        100,
        200
      ],
      "groundmodelName": "DIRT_ROCKY_LARGE",
      "heightBaseTex": "/levels/small_island/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 1024,
      "heightDetailTex": "/assets/materials/terrain/rock/terrain_dirt_rocky_large/t_dirt_rocks_large_h.png",
      "heightMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_h.png",
      "heightMacroTexSize": 70,
      "internalName": "dirt_rocky_large",
      "macroDistances": [
        0,
        1000,
        1000,
        9000
      ],
      "normalBaseTex": "/levels/small_island/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 1024,
      "normalDetailStrength": [
        0.600000024,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/rock/terrain_dirt_rocky_large/t_dirt_rocks_large_nm.png",
      "normalMacroStrength": [
        0.600000024,
        0.5
      ],
      "normalMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_nm.png",
      "normalMacroTexSize": 70,
      "roughnessBaseTex": "/levels/small_island/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 1024,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/rock/terrain_dirt_rocky_large/t_dirt_rocks_large_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.800000012
      ],
      "roughnessMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_r.png",
      "roughnessMacroTexSize": 70
    },
    "Grass": {
      "annotation": "GRASS",
      "aoBaseTex": "/levels/small_island/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 1024,
      "aoDetailTex": "/assets/materials/terrain/grass/t_dirt_dry_grass/t_dirt_dry_grass_ao.png",
      "aoMacroTex": "/assets/materials/terrain/grass/t_macro_dry_grass/t_macro_dry_grass_ao.png",
      "aoMacroTexSize": 50,
      "baseColorBaseTex": "/levels/small_island/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 1024,
      "baseColorDetailStrength": [
        0.400000006,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/grass/t_dirt_dry_grass/t_dirt_dry_grass_b.png",
      "baseColorMacroStrength": [
        0.100000001,
        0.400000006
      ],
      "baseColorMacroTex": "/assets/materials/terrain/grass/t_macro_dry_grass/t_macro_dry_grass_b.png",
      "baseColorMacroTexSize": 50,
      "class": "TerrainMaterial",
      "detailDistAtten": [
        0,
        0.899999976
      ],
      "detailDistances": [
        0,
        0,
        50,
        70
      ],
      "groundmodelName": "GRASS",
      "heightBaseTex": "/levels/small_island/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 1024,
      "heightDetailTex": "/assets/materials/terrain/grass/t_dirt_dry_grass/t_dirt_dry_grass_h.png",
      "heightMacroTex": "/assets/materials/terrain/grass/t_macro_dry_grass/t_macro_dry_grass_h.png",
      "heightMacroTexSize": 50,
      "internalName": "Grass",
      "macroDistAtten": [
        0.349999994,
        1
      ],
      "macroDistances": [
        0,
        0,
        400,
        8000
      ],
      "normalBaseTex": "/levels/small_island/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 1024,
      "normalDetailStrength": [
        0.699999988,
        0.200000003
      ],
      "normalDetailTex": "/assets/materials/terrain/grass/t_dirt_dry_grass/t_dirt_dry_grass_nm.png",
      "normalMacroStrength": [
        0.400000006,
        1.10000002
      ],
      "normalMacroTex": "/assets/materials/terrain/grass/t_macro_dry_grass/t_macro_dry_grass_nm.png",
      "normalMacroTexSize": 50,
      "roughnessBaseTex": "/levels/small_island/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 1024,
      "roughnessDetailStrength": [
        0.899999976,
        0.699999988
      ],
      "roughnessDetailTex": "/assets/materials/terrain/grass/t_dirt_dry_grass/t_dirt_dry_grass_r.png",
      "roughnessMacroStrength": [
        0.899999976,
        0.899999976
      ],
      "roughnessMacroTex": "/assets/materials/terrain/grass/t_macro_dry_grass/t_macro_dry_grass_r.png",
      "roughnessMacroTexSize": 50
    },
    "ROCK": {
      "annotation": "ROCK",
      "aoBaseTex": "/levels/small_island/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 1024,
      "aoDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_ao.png",
      "aoDetailTexSize": 4,
      "aoMacroTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_ao.png",
      "aoMacroTexSize": 50,
      "baseColorBaseTex": "/levels/small_island/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 1024,
      "baseColorDetailStrength": [
        0.200000003,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_b.png",
      "baseColorDetailTexSize": 4,
      "baseColorMacroStrength": [
        0.100000001,
        0.200000003
      ],
      "baseColorMacroTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_b.png",
      "baseColorMacroTexSize": 50,
      "class": "TerrainMaterial",
      "detailDistAtten": [
        0,
        1
      ],
      "detailDistances": [
        0,
        0,
        100,
        200
      ],
      "groundmodelName": "ROCK",
      "heightBaseTex": "/levels/small_island/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 1024,
      "heightDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_h.png",
      "heightDetailTexSize": 4,
      "heightMacroTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_h.png",
      "heightMacroTexSize": 50,
      "internalName": "Rock",
      "macroDistances": [
        0,
        0,
        300,
        8000
      ],
      "normalBaseTex": "/levels/small_island/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 1024,
      "normalDetailStrength": [
        0.5,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_nm.png",
      "normalDetailTexSize": 4,
      "normalMacroStrength": [
        0.200000003,
        0.5
      ],
      "normalMacroTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_nm.png",
      "normalMacroTexSize": 50,
      "roughnessBaseTex": "/levels/small_island/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 1024,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_r.png",
      "roughnessDetailTexSize": 4,
      "roughnessMacroStrength": [
        0.150000006,
        0.699999988
      ],
      "roughnessMacroTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_r.png",
      "roughnessMacroTexSize": 50
    },
    "asphalt": {
      "annotation": "ASPHALT",
      "aoBaseTex": "/levels/small_island/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 1024,
      "aoDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_ao.png",
      "aoMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_ao.png",
      "aoMacroTexSize": 20,
      "baseColorBaseTex": "/levels/small_island/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 1024,
      "baseColorDetailStrength": [
        0.349999994,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_b.png",
      "baseColorMacroStrength": [
        0.200000003,
        0.200000003
      ],
      "baseColorMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_b.png",
      "baseColorMacroTexSize": 20,
      "class": "TerrainMaterial",
      "detailDistAtten": [
        0,
        0.899999976
      ],
      "detailDistances": [
        0,
        0,
        50,
        70
      ],
      "groundmodelName": "GROUNDMODEL_ASPHALT1",
      "heightBaseTex": "/levels/small_island/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 1024,
      "heightDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_h.png",
      "heightMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_h.png",
      "heightMacroTexSize": 20,
      "internalName": "groundmodel_asphalt1",
      "macroDistAtten": [
        0.349999994,
        1
      ],
      "macroDistances": [
        20,
        40,
        2500,
        8600
      ],
      "normalBaseTex": "/levels/small_island/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 1024,
      "normalDetailStrength": [
        0.649999976,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_nm.png",
      "normalMacroStrength": [
        0.5,
        0.5
      ],
      "normalMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_nm.png",
      "normalMacroTexSize": 20,
      "roughnessBaseTex": "/levels/small_island/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 1024,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_r.png",
      "roughnessMacroStrength": [
        0.300000012,
        0.800000012
      ],
      "roughnessMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_r.png",
      "roughnessMacroTexSize": 20
    }
  },
  "utah": {
    "BeachSand": {
      "annotation": "SAND",
      "aoBaseTex": "/levels/Utah/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_ao.png",
      "aoMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_ao.png",
      "aoMacroTexSize": 20,
      "baseColorBaseTex": "/levels/Utah/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.5,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_b.png",
      "baseColorMacroStrength": [
        0.200000003,
        0.200000003
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_b.png",
      "baseColorMacroTexSize": 20,
      "class": "TerrainMaterial",
      "detailDistances": [
        0,
        0,
        20,
        40
      ],
      "groundmodelName": "SAND",
      "heightBaseTex": "/levels/Utah/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailStrength": [
        1,
        0
      ],
      "heightDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_h.png",
      "heightMacroStrength": [
        0,
        1
      ],
      "heightMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_h.png",
      "heightMacroTexSize": 20,
      "internalName": "sand",
      "macroDistances": [
        0,
        0,
        100,
        3000
      ],
      "normalBaseTex": "/levels/Utah/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        1,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_nm.png",
      "normalMacroStrength": [
        0.5,
        0.5
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_nm.png",
      "normalMacroTexSize": 20,
      "roughnessBaseTex": "/levels/Utah/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_r.png",
      "roughnessMacroStrength": [
        0.100000001,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_r.png",
      "roughnessMacroTexSize": 20
    },
    "Dirt": {
      "aoBaseTex": "/levels/Utah/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/soil/dirt_loose_dusty/t_dirt_loose_dusty_ao.png",
      "aoMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_ao.png",
      "aoMacroTexSize": 40,
      "baseColorBaseTex": "/levels/Utah/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.5,
        0.25
      ],
      "baseColorDetailTex": "/assets/materials/terrain/soil/dirt_loose_dusty/t_dirt_loose_dusty_b.png",
      "baseColorMacroStrength": [
        0.5,
        0.25
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_b.png",
      "baseColorMacroTexSize": 40,
      "class": "TerrainMaterial",
      "groundmodelName": "DIRT_LOOSE",
      "heightBaseTex": "/levels/Utah/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailStrength": [
        1,
        0
      ],
      "heightDetailTex": "/assets/materials/terrain/soil/dirt_loose_dusty/t_dirt_loose_dusty_h.png",
      "heightMacroStrength": [
        0,
        1
      ],
      "heightMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_h.png",
      "heightMacroTexSize": 40,
      "internalName": "dirt_loose",
      "macroDistances": [
        0,
        0,
        100,
        3000
      ],
      "normalBaseTex": "/levels/Utah/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        1,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/soil/dirt_loose_dusty/t_dirt_loose_dusty_nm.png",
      "normalMacroStrength": [
        1,
        0.5
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_nm.png",
      "normalMacroTexSize": 40,
      "roughnessBaseTex": "/levels/Utah/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/soil/dirt_loose_dusty/t_dirt_loose_dusty_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_r.png",
      "roughnessMacroTexSize": 40
    },
    "DirtGrass": {
      "annotation": "GRASS",
      "aoBaseTex": "/levels/Utah/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/grass/dirt_dry_grassy/t_dirt_dry_grassy_ao.png",
      "aoMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_ao.png",
      "aoMacroTexSize": 5,
      "baseColorBaseTex": "/levels/Utah/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.25,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/grass/dirt_dry_grassy/t_dirt_dry_grassy_b.png",
      "baseColorMacroStrength": [
        0.100000001,
        0.150000006
      ],
      "baseColorMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_b.png",
      "baseColorMacroTexSize": 5,
      "class": "TerrainMaterial",
      "groundmodelName": "DIRT_GRASS",
      "heightBaseTex": "/levels/Utah/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailStrength": [
        1,
        0
      ],
      "heightDetailTex": "/assets/materials/terrain/grass/dirt_dry_grassy/t_dirt_dry_grassy_h.png",
      "heightMacroStrength": [
        0,
        1
      ],
      "heightMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_h.png",
      "heightMacroTexSize": 5,
      "internalName": "dirt_grass",
      "macroDistances": [
        0,
        0,
        100,
        3000
      ],
      "normalBaseTex": "/levels/Utah/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        0.699999988,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/grass/dirt_dry_grassy/t_dirt_dry_grassy_nm.png",
      "normalMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_nm.png",
      "normalMacroTexSize": 5,
      "roughnessBaseTex": "/levels/Utah/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/grass/dirt_dry_grassy/t_dirt_dry_grassy_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_r.png",
      "roughnessMacroTexSize": 5
    },
    "GRAVEL": {
      "aoBaseTex": "/levels/Utah/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/soil/t_gravel/t_gravel_ao.png",
      "aoDetailTexSize": 1,
      "aoMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_ao.png",
      "aoMacroTexSize": 10,
      "baseColorBaseTex": "/levels/Utah/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "baseColorDetailTex": "/assets/materials/terrain/soil/t_gravel/t_gravel_b.png",
      "baseColorDetailTexSize": 1,
      "baseColorMacroStrength": [
        0.400000006,
        0.25
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_b.png",
      "baseColorMacroTexSize": 10,
      "class": "TerrainMaterial",
      "detailDistances": [
        0,
        0,
        20,
        50
      ],
      "groundmodelName": "GRAVEL",
      "heightBaseTex": "/levels/Utah/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailStrength": [
        1,
        0
      ],
      "heightDetailTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_h.png",
      "heightDetailTexSize": 1,
      "heightMacroStrength": [
        0,
        1
      ],
      "heightMacroTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_h.png",
      "heightMacroTexSize": 10,
      "internalName": "GRAVEL",
      "macroDistances": [
        0,
        0,
        100,
        3000
      ],
      "normalBaseTex": "/levels/Utah/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        1,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/soil/t_gravel/t_gravel_nm.png",
      "normalDetailTexSize": 1,
      "normalMacroStrength": [
        0.699999988,
        0.699999988
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_nm.png",
      "normalMacroTexSize": 10,
      "roughnessBaseTex": "/levels/Utah/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.349999994,
        0.349999994
      ],
      "roughnessDetailTex": "/assets/materials/terrain/soil/t_gravel/t_gravel_r.png",
      "roughnessDetailTexSize": 1,
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_r.png",
      "roughnessMacroTexSize": 10
    },
    "Grass": {
      "annotation": "GRASS",
      "aoBaseTex": "/levels/Utah/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/grass/t_dirt_vegetation/t_dirt_vegetation_ao.png",
      "aoMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_ao.png",
      "aoMacroTexSize": 5,
      "baseColorBaseTex": "/levels/Utah/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.349999994,
        0.349999994
      ],
      "baseColorDetailTex": "/assets/materials/terrain/grass/t_dirt_vegetation/t_dirt_vegetation_b.png",
      "baseColorMacroStrength": [
        0.100000001,
        0.150000006
      ],
      "baseColorMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_b.png",
      "baseColorMacroTexSize": 5,
      "class": "TerrainMaterial",
      "groundmodelName": "GRASS",
      "heightBaseTex": "/levels/Utah/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailStrength": [
        1,
        0
      ],
      "heightDetailTex": "/assets/materials/terrain/grass/t_dirt_vegetation/t_dirt_vegetation_h.png",
      "heightMacroStrength": [
        0,
        1
      ],
      "heightMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_h.png",
      "heightMacroTexSize": 5,
      "internalName": "Grass",
      "macroDistances": [
        0,
        0,
        100,
        3000
      ],
      "normalBaseTex": "/levels/Utah/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        0.600000024,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/grass/t_dirt_vegetation/t_dirt_vegetation_nm.png",
      "normalMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_nm.png",
      "normalMacroTexSize": 5,
      "roughnessBaseTex": "/levels/Utah/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/grass/t_dirt_vegetation/t_dirt_vegetation_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_r.png",
      "roughnessMacroTexSize": 5
    },
    "ROCK": {
      "annotation": "ROCK",
      "aoBaseTex": "/levels/Utah/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/rock/terrain_dirt_rocky_large/t_dirt_rocks_large_ao.png",
      "aoMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_ao.png",
      "aoMacroTexSize": 80,
      "baseColorBaseTex": "/levels/Utah/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.200000003,
        0.200000003
      ],
      "baseColorDetailTex": "/assets/materials/terrain/rock/terrain_dirt_rocky_large/t_dirt_rocks_large_b.png",
      "baseColorMacroStrength": [
        0.0700000003,
        0.25
      ],
      "baseColorMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_b.png",
      "baseColorMacroTexSize": 80,
      "class": "TerrainMaterial",
      "groundmodelName": "ROCK",
      "heightBaseTex": "/levels/Utah/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/rock/terrain_dirt_rocky_large/t_dirt_rocks_large_h.png",
      "heightMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_h.png",
      "heightMacroTexSize": 80,
      "internalName": "Rock",
      "macroDistances": [
        0,
        10,
        100,
        3000
      ],
      "normalBaseTex": "/levels/Utah/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        0.699999988,
        0.300000012
      ],
      "normalDetailTex": "/assets/materials/terrain/rock/terrain_dirt_rocky_large/t_dirt_rocks_large_nm.png",
      "normalMacroStrength": [
        0.5,
        0.600000024
      ],
      "normalMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_nm.png",
      "normalMacroTexSize": 80,
      "roughnessBaseTex": "/levels/Utah/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.300000012,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/rock/terrain_dirt_rocky_large/t_dirt_rocks_large_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.800000012
      ],
      "roughnessMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_r.png",
      "roughnessMacroTexSize": 80
    },
    "asphalt": {
      "annotation": "ASPHALT",
      "aoBaseTex": "/levels/Utah/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_ao.png",
      "aoMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_ao.png",
      "aoMacroTexSize": 20,
      "baseColorBaseTex": "/levels/Utah/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.400000006,
        0.200000003
      ],
      "baseColorDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_b.png",
      "baseColorMacroStrength": [
        0.300000012,
        0.300000012
      ],
      "baseColorMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_b.png",
      "baseColorMacroTexSize": 20,
      "class": "TerrainMaterial",
      "detailDistAtten": [
        0,
        1
      ],
      "groundmodelName": "GROUNDMODEL_ASPHALT1",
      "heightBaseTex": "/levels/Utah/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailStrength": [
        1,
        0
      ],
      "heightDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_h.png",
      "heightMacroStrength": [
        0,
        1
      ],
      "heightMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_h.png",
      "heightMacroTexSize": 20,
      "internalName": "groundmodel_asphalt1",
      "macroDistances": [
        0,
        0,
        100,
        3000
      ],
      "normalBaseTex": "/levels/Utah/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        1,
        0.200000003
      ],
      "normalDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_nm.png",
      "normalMacroStrength": [
        1,
        0.100000001
      ],
      "normalMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_nm.png",
      "normalMacroTexSize": 20,
      "roughnessBaseTex": "/levels/Utah/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.5,
        0
      ],
      "roughnessDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_r.png",
      "roughnessMacroStrength": [
        0.5,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_r.png",
      "roughnessMacroTexSize": 20
    }
  },
  "west_coast_usa": {
    "BeachSand": {
      "annotation": "SAND",
      "aoBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_ao.png",
      "aoDetailTexSize": 3,
      "aoMacroTex": "/assets/materials/terrain/sand/t_macro_sand/t_macro_sand_ao.png",
      "aoMacroTexSize": 50,
      "baseColorBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.25,
        0.100000001
      ],
      "baseColorDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_b.png",
      "baseColorDetailTexSize": 3,
      "baseColorMacroStrength": [
        0.400000006,
        0.400000006
      ],
      "baseColorMacroTex": "/assets/materials/terrain/sand/t_macro_sand/t_macro_sand_b.png",
      "baseColorMacroTexSize": 50,
      "class": "TerrainMaterial",
      "detailDistances": [
        0,
        0,
        30,
        3000
      ],
      "groundmodelName": "SAND",
      "heightBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/custom_height_blend/custom_height_blend_02_h.png",
      "heightDetailTexSize": 3,
      "heightMacroStrength": [
        0,
        0
      ],
      "heightMacroTex": "/assets/materials/terrain/custom_height_blend/custom_height_blend_02_h.png",
      "heightMacroTexSize": 50,
      "internalName": "BeachSand",
      "macroDistAtten": [
        1,
        1
      ],
      "macroDistances": [
        0,
        0,
        100,
        3000
      ],
      "normalBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        1,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_nm.png",
      "normalDetailTexSize": 3,
      "normalMacroStrength": [
        0.5,
        0.5
      ],
      "normalMacroTex": "/assets/materials/terrain/sand/t_macro_sand/t_macro_sand_nm.png",
      "normalMacroTexSize": 50,
      "roughnessBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        1,
        0.5
      ],
      "roughnessDetailTex": "/assets/materials/terrain/sand/t_sand/t_sand_r.png",
      "roughnessDetailTexSize": 3,
      "roughnessMacroStrength": [
        0,
        1
      ],
      "roughnessMacroTex": "/assets/materials/terrain/sand/t_macro_sand/t_macro_sand_r.png",
      "roughnessMacroTexSize": 50
    },
    "Dirt": {
      "aoBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_ao.png",
      "aoMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_ao.png",
      "aoMacroTexSize": 40,
      "baseColorBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.5,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_b.png",
      "baseColorMacroStrength": [
        0.200000003,
        0.100000001
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_b_02.png",
      "baseColorMacroTexSize": 40,
      "class": "TerrainMaterial",
      "detailDistances": [
        0,
        0,
        25,
        3000
      ],
      "groundmodelName": "DIRT_ROCKY",
      "heightBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/custom_height_blend/custom_height_blend_04_h.png",
      "heightMacroStrength": [
        0,
        0
      ],
      "heightMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_h.png",
      "heightMacroTexSize": 40,
      "internalName": "dirt",
      "macroDistAtten": [
        0,
        0
      ],
      "macroDistances": [
        0,
        0,
        100,
        3000
      ],
      "normalBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        1,
        0.150000006
      ],
      "normalDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_nm.png",
      "normalMacroStrength": [
        0.800000012,
        0.5
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_nm.png",
      "normalMacroTexSize": 40,
      "roughnessBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.300000012,
        0
      ],
      "roughnessDetailTex": "/assets/materials/terrain/soil/t_dirt_sandy/t_dirt_sandy_r.png",
      "roughnessMacroStrength": [
        0.150000006,
        0.400000006
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_r.png",
      "roughnessMacroTexSize": 40
    },
    "DirtGrass": {
      "aoBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/grass/ind_grass_2/t_ind_grass_2_ao.png",
      "aoMacroTex": "/assets/materials/terrain/grass/t_macro_dry_grass/t_macro_dry_grass_ao.png",
      "aoMacroTexSize": 50,
      "baseColorBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.5,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/grass/ind_grass_2/t_ind_grass_2_b.png",
      "baseColorMacroStrength": [
        0,
        0.100000001
      ],
      "baseColorMacroTex": "/assets/materials/terrain/grass/t_macro_dry_grass/t_macro_dry_grass_b.png",
      "baseColorMacroTexSize": 50,
      "class": "TerrainMaterial",
      "detailDistances": [
        0,
        0,
        30,
        3000
      ],
      "groundmodelName": "GRASS",
      "heightBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/grass/ind_grass_2/t_ind_grass_2_h.png",
      "heightMacroStrength": [
        0,
        0
      ],
      "heightMacroTex": "/assets/materials/terrain/soil/macro_holes/t_macro_holes_h.png",
      "heightMacroTexSize": 50,
      "internalName": "dirt_grass",
      "macroDistAtten": [
        1,
        1
      ],
      "macroDistances": [
        0,
        0,
        500,
        3000
      ],
      "normalBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        1,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/grass/ind_grass_2/t_ind_grass_2_nm.png",
      "normalMacroStrength": [
        0.699999988,
        1
      ],
      "normalMacroTex": "/assets/materials/terrain/grass/t_macro_dry_grass/t_macro_dry_grass_nm.png",
      "normalMacroTexSize": 50,
      "roughnessBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        1,
        0
      ],
      "roughnessDetailTex": "/assets/materials/terrain/grass/ind_grass_2/t_ind_grass_2_r.png",
      "roughnessMacroStrength": [
        0,
        0.800000012
      ],
      "roughnessMacroTex": "/assets/materials/terrain/grass/t_macro_dry_grass/t_macro_dry_grass_r.png",
      "roughnessMacroTexSize": 50
    },
    "GRAVEL": {
      "aoBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailStrength": [
        1,
        0
      ],
      "aoDetailTex": "/assets/materials/terrain/soil/t_gravels/t_gravels_ao.png",
      "aoMacroStrength": [
        0,
        0
      ],
      "aoMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_ao.png",
      "aoMacroTexSize": 20,
      "baseColorBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.349999994,
        0.100000001
      ],
      "baseColorDetailTex": "/assets/materials/terrain/soil/t_gravels/t_gravels_b.png",
      "baseColorMacroStrength": [
        0.5,
        0.300000012
      ],
      "baseColorMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_b_02.png",
      "baseColorMacroTexSize": 20,
      "class": "TerrainMaterial",
      "detailDistances": [
        0,
        0,
        50,
        3000
      ],
      "groundmodelName": "GRAVEL",
      "heightBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/custom_height_blend/custom_height_blend_03_h.png",
      "heightMacroStrength": [
        0,
        0
      ],
      "heightMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_h.png",
      "heightMacroTexSize": 20,
      "internalName": "gravel",
      "macroDistances": [
        0,
        0,
        100,
        3000
      ],
      "normalBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        1,
        0.300000012
      ],
      "normalDetailTex": "/assets/materials/terrain/soil/t_gravels/t_gravels_nm.png",
      "normalMacroStrength": [
        0.800000012,
        0.400000006
      ],
      "normalMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_nm.png",
      "normalMacroTexSize": 20,
      "roughnessBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailTex": "/assets/materials/terrain/soil/t_gravels/t_gravels_r.png",
      "roughnessMacroStrength": [
        0,
        0.800000012
      ],
      "roughnessMacroTex": "/assets/materials/terrain/soil/t_macro_flows/t_macro_flows_r.png",
      "roughnessMacroTexSize": 20
    },
    "Grass": {
      "aoBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/grass/t_dirt_dry_grass/t_dirt_dry_grass_ao.png",
      "aoMacroTex": "/assets/materials/terrain/grass/t_macro_dry_grass/t_macro_dry_grass_ao.png",
      "aoMacroTexSize": 50,
      "baseColorBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.400000006,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/grass/t_dirt_dry_grass/t_dirt_dry_grass_b.png",
      "baseColorMacroStrength": [
        0.300000012,
        0
      ],
      "baseColorMacroTex": "/assets/materials/terrain/grass/t_macro_dry_grass/t_macro_dry_grass_b.png",
      "baseColorMacroTexSize": 50,
      "class": "TerrainMaterial",
      "detailDistances": [
        0,
        0,
        50,
        3000
      ],
      "groundmodelName": "GRASS",
      "heightBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/grass/t_dirt_dry_grass/t_dirt_dry_grass_h.png",
      "heightMacroStrength": [
        0,
        0
      ],
      "heightMacroTex": "/assets/materials/terrain/grass/t_macro_dry_grass/t_macro_dry_grass_h.png",
      "heightMacroTexSize": 50,
      "internalName": "grass",
      "macroDistAtten": [
        1,
        1
      ],
      "macroDistances": [
        0,
        0,
        500,
        3000
      ],
      "normalBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        1,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/grass/t_dirt_dry_grass/t_dirt_dry_grass_nm.png",
      "normalMacroStrength": [
        0.5,
        0.5
      ],
      "normalMacroTex": "/assets/materials/terrain/grass/t_macro_dry_grass/t_macro_dry_grass_nm.png",
      "normalMacroTexSize": 50,
      "roughnessBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        1,
        0
      ],
      "roughnessDetailTex": "/assets/materials/terrain/grass/t_dirt_dry_grass/t_dirt_dry_grass_r.png",
      "roughnessMacroStrength": [
        0,
        0.800000012
      ],
      "roughnessMacroTex": "/assets/materials/terrain/grass/t_macro_dry_grass/t_macro_dry_grass_r.png",
      "roughnessMacroTexSize": 50
    },
    "ROCK": {
      "annotation": "ROCK",
      "aoBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_ao.png",
      "aoDetailTexSize": 9,
      "aoMacroStrength": [
        0,
        1
      ],
      "aoMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_ao.png",
      "baseColorBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.200000003,
        0.100000001
      ],
      "baseColorDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_b.png",
      "baseColorDetailTexSize": 9,
      "baseColorMacroStrength": [
        0.200000003,
        0.349999994
      ],
      "baseColorMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_b.png",
      "class": "TerrainMaterial",
      "detailDistances": [
        0,
        0,
        100,
        100
      ],
      "groundmodelName": "DIRT_ROCKY",
      "heightBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_h.png",
      "heightDetailTexSize": 9,
      "heightMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_h.png",
      "internalName": "Rock_cliff",
      "macroDistances": [
        0,
        10,
        500,
        3000
      ],
      "normalBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        0.800000012,
        0.100000001
      ],
      "normalDetailTex": "/assets/materials/terrain/rock/t_dirt_rocky/t_dirt_rocky_nm.png",
      "normalDetailTexSize": 9,
      "normalMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_nm.png",
      "roughnessBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailTex": "/assets/materials/terrain/soil/macro_clumply/t_macro_clumpy_r.png",
      "roughnessDetailTexSize": 9,
      "roughnessMacroStrength": [
        0.400000006,
        0.400000006
      ],
      "roughnessMacroTex": "/assets/materials/terrain/rock/macro_rocky/t_macro_rocky_r.png"
    },
    "asphalt": {
      "annotation": "ASPHALT",
      "aoBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_ao.png",
      "aoBaseTexSize": 2048,
      "aoDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_ao.png",
      "aoMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_ao.png",
      "aoMacroTexSize": 30,
      "baseColorBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_b.png",
      "baseColorBaseTexSize": 2048,
      "baseColorDetailStrength": [
        0.300000012,
        0
      ],
      "baseColorDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_b.png",
      "baseColorMacroStrength": [
        0.300000012,
        0.5
      ],
      "baseColorMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_b.png",
      "baseColorMacroTexSize": 30,
      "class": "TerrainMaterial",
      "detailDistances": [
        0,
        0,
        50,
        3000
      ],
      "groundmodelName": "ASPHALT",
      "heightBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_h.png",
      "heightBaseTexSize": 2048,
      "heightDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_h.png",
      "heightMacroStrength": [
        0,
        0
      ],
      "heightMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_h.png",
      "heightMacroTexSize": 30,
      "internalName": "Asphalt",
      "macroDistAtten": [
        1,
        1
      ],
      "macroDistances": [
        0,
        0,
        100,
        3000
      ],
      "normalBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_nm.png",
      "normalBaseTexSize": 2048,
      "normalDetailStrength": [
        1,
        0
      ],
      "normalDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_nm.png",
      "normalMacroStrength": [
        0.400000006,
        0.400000006
      ],
      "normalMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_nm.png",
      "normalMacroTexSize": 30,
      "roughnessBaseTex": "/levels/west_coast_usa/art/terrains/t_terrain_base_r.png",
      "roughnessBaseTexSize": 2048,
      "roughnessDetailStrength": [
        0.5,
        0.300000012
      ],
      "roughnessDetailTex": "/assets/materials/terrain/asphalt/asphalt/t_asphalt_r.png",
      "roughnessMacroStrength": [
        0.5,
        0.5
      ],
      "roughnessMacroTex": "/assets/materials/terrain/asphalt/macro_asphalt/t_macro_asphalt_r.png",
      "roughnessMacroTexSize": 30
    }
  }
};
