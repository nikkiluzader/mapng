const DEFAULT_TERRAIN_CANDIDATES = {
  Grass: ['Grass', 'Grass2', 'Grass3', 'Grass4', 'dirt_grass'],
  Dirt: ['Dirt', 'dirt_loose', 'dirt_grass', 'RockyDirt', 'dirt_loose_dusty'],
  BeachSand: ['BeachSand', 'sand', 'dirt_sandy'],
  ROCK: ['ROCK', 'Rock', 'Rock_cliff', 'dirt_rocky', 'dirt_rocky_large', 'rockydirt', 'rocks_large'],
  asphalt: ['asphalt', 'asphalt2', 'groundmodel_asphalt1', 'GROUNDMODEL_ASPHALT1'],
  GRAVEL: ['GRAVEL', 'gravel_wet', 'dirt_rocky_large'],
  Concrete: ['Concrete'],
};

const ITALY_GROUNDCOVER_MATERIAL = {
  name: 'GrassMiddle',
  mapTo: 'unmapped_mat',
  class: 'Material',
  persistentId: 'c6552e8a-3784-44da-998b-3dca87552aca',
  Stages: [{
    colorMap: 'levels/italy/art/shapes/groundcover/Grass_Middle_d.dds',
    diffuseColor: [0.996078491, 0.996078491, 0.996078491, 1],
    normalMap: '/levels/italy/art/shapes/groundcover/Grass_green_n.normal.png',
    roughnessFactor: 0.481729716,
    specular: [0.992156923, 0.992156923, 0.992156923, 1],
    specularMap: '/levels/italy/art/shapes/groundcover/Grass_green_s.color.png',
    useAnisotropic: true,
  }, {}, {}, {}],
  alphaRef: 95,
  alphaTest: true,
  annotation: 'NATURE',
  doubleSided: true,
  groundType: 'GRASS',
  materialTag0: 'beamng',
  materialTag1: 'vegetation',
  translucentBlendOp: 'None',
};

const UTAH_GROUNDCOVER_MATERIAL = {
  name: 'dry_grass',
  mapTo: 'dry_grass',
  class: 'Material',
  persistentId: 'a269c30f-2863-4077-907b-5bfba1dc1f2f',
  Stages: [{
    ambientOcclusionMap: '/assets/materials/foliage/grass/t_utah_dry_grass/t_utah_dry_grass_ao.data.png',
    baseColorFactor: [0.905882418, 0.905882418, 0.905882418, 1],
    baseColorMap: '/assets/materials/foliage/grass/t_utah_dry_grass/t_utah_dry_grass_b.color.png',
    normalMap: '/assets/materials/foliage/grass/t_utah_dry_grass/t_utah_dry_grass_nm.normal.png',
    opacityMap: '/assets/materials/foliage/grass/t_utah_dry_grass/t_utah_dry_grass_o.data.png',
    roughnessMap: '/assets/materials/foliage/grass/t_utah_dry_grass/t_utah_dry_grass_r.data.png',
    specular: [0.988235354, 0.988235354, 0.988235354, 1],
    useAnisotropic: true,
  }, {}, {}, {}],
  alphaRef: 60,
  alphaTest: true,
  annotation: 'GRASS',
  doubleSided: true,
  groundType: 'GRASS',
  materialTag0: 'beamng',
  materialTag1: 'vegetation',
  materialTag2: 'vegetation',
  materialTag3: 'Natural',
  translucentBlendOp: 'None',
};

const EAST_COAST_GROUNDCOVER_MATERIAL = {
  name: 'BNGGrass',
  mapTo: 'unmapped_mat',
  class: 'Material',
  persistentId: 'b2d38e39-359b-4603-b334-a3263a4bcc57',
  Stages: [{
    colorMap: '/levels/east_coast_usa/art/shapes/groundcover/t_grass_01_d.color.png',
    diffuseColor: [0.996078491, 0.996078491, 0.996078491, 1],
    normalMap: '/levels/east_coast_usa/art/shapes/groundcover/t_grass_01_nm.normal.png',
    specular: [0.992156923, 0.992156923, 0.992156923, 1],
    specularMap: '/levels/east_coast_usa/art/shapes/groundcover/t_grass_01_s.color.png',
    useAnisotropic: true,
  }, {}, {}, {}],
  alphaRef: 60,
  alphaTest: true,
  annotation: 'NATURE',
  doubleSided: true,
  materialTag0: 'beamng',
  materialTag1: 'vegetation',
  materialTag2: 'vegetation',
  materialTag3: 'Natural',
  materialTag4: 'east_coast_usa',
  translucentBlendOp: 'None',
};

const JOHNSON_VALLEY_GROUNDCOVER_MATERIAL = {
  name: 'dry_grass',
  mapTo: 'dry_grass',
  class: 'Material',
  persistentId: 'a58a2f27-8d2f-4556-bbc0-f7e2b2672bd5',
  Stages: [{
    colorMap: 'levels/johnson_valley/art/shapes/groundcover/dry_grass_d.color.png',
    detailNormalMapStrength: 0.5,
    detailScale: [1, 1],
    diffuseColor: [0.905882418, 0.905882418, 0.905882418, 1],
    normalMap: '/levels/johnson_valley/art/shapes/groundcover/dry_grass_n.normal.png',
    specular: [0.992156923, 0.992156923, 0.992156923, 1],
    specularMap: '/levels/johnson_valley/art/shapes/groundcover/dry_grass_s2.color.png',
    useAnisotropic: true,
  }, {}, {}, {}],
  alphaRef: 59,
  alphaTest: true,
  annotation: 'GRASS',
  doubleSided: true,
  groundType: 'GRASS',
  materialTag0: 'beamng',
  materialTag1: 'vegetation',
  translucentBlendOp: 'None',
};

const JUNGLE_GROUNDCOVER_MATERIAL = {
  name: 'BNG_Grass_03',
  mapTo: 'unmapped_mat',
  class: 'Material',
  persistentId: 'b9a7716f-de7f-4df0-80bf-979ca74d043c',
  Stages: [{
    colorMap: 'levels/jungle_rock_island/art/shapes/groundcover/Grass03_tropical_d.dds',
    specularPower: 1,
  }, {}, {}, {}],
  alphaRef: 107,
  alphaTest: true,
  doubleSided: true,
  materialTag0: 'beamng',
  materialTag1: 'vegetation',
  materialTag2: 'vegetation',
};

const ASSET_SETS = {
  italy: {
    managedItemTemplates: {
      cypress_tree: {
        name: 'cypress_tree',
        internalName: 'cypress_tree',
        class: 'TSForestItemData',
        annotation: 'NATURE',
        branchAmp: 0.100000001,
        detailAmp: 0.0799999982,
        detailFreq: 1.5,
        mass: 10,
        radius: 0.800000012,
        rigidity: 10.1999998,
        shapeFile: 'levels/italy/art/shapes/trees/trees_italy/cypress_tree.dae',
        tightnessCoefficient: 1,
        trunkBendScale: 0.0500000007,
        windScale: 0.300000012,
      },
      holm_oak_city_small: {
        name: 'holm_oak_city_small',
        internalName: 'holm_oak_city_small',
        class: 'TSForestItemData',
        annotation: 'NATURE',
        branchAmp: 0.100000001,
        detailAmp: 0.200000003,
        detailFreq: 0.5,
        mass: 10,
        radius: 0.699999988,
        shapeFile: 'levels/italy/art/shapes/trees/trees_italy/holm_oak_city_small.dae',
        tightnessCoefficient: 1,
        trunkBendScale: 0.0500000007,
        windScale: 0.5,
      },
      maritime_pine_tree: {
        name: 'maritime_pine_tree',
        internalName: 'maritime_pine_tree',
        class: 'TSForestItemData',
        annotation: 'NATURE',
        branchAmp: 0.100000001,
        dampingCoefficient: 3,
        detailAmp: 0.119999997,
        detailFreq: 1.5,
        mass: 10,
        shapeFile: 'levels/italy/art/shapes/trees/trees_italy/maritime_pine.dae',
        tightnessCoefficient: 1,
        trunkBendScale: 0.0700000003,
        windScale: 0.5,
      },
      olive_tree: {
        name: 'olive_tree',
        internalName: 'olive_tree',
        class: 'TSForestItemData',
        annotation: 'NATURE',
        branchAmp: 0.100000001,
        dampingCoefficient: 3,
        detailAmp: 5,
        detailFreq: 0.100000001,
        shapeFile: 'levels/italy/art/shapes/trees/trees_italy/olive.dae',
        tightnessCoefficient: 1,
        trunkBendScale: 0.0500000007,
        windScale: 0.5,
      },
      italy_palm_1: {
        name: 'italy_palm_1',
        internalName: 'italy_palm_1',
        class: 'TSForestItemData',
        annotation: 'NATURE',
        branchAmp: 0.100000001,
        dampingCoefficient: 3,
        detailAmp: 0.300000012,
        detailFreq: 0.5,
        dynamicCubemap: '0',
        planarReflection: '0',
        rigidity: 20,
        shapeFile: 'levels/italy/art/shapes/trees/trees_italy/italy_palm_1.dae',
        tightnessCoefficient: 1,
        translucentBlendOp: 'LerpAlpha',
        trunkBendScale: 0.0299999993,
        windScale: 0.5,
      },
      generibush: {
        name: 'generibush',
        internalName: 'generibush',
        class: 'ForestItemData',
        annotation: 'NATURE',
        branchAmp: 0.100000001,
        dampingCoefficient: 3,
        detailAmp: 5,
        detailFreq: 0.0700000003,
        dynamicCubemap: '0',
        planarReflection: '0',
        shapeFile: 'levels/italy/art/shapes/trees/trees_italy/generibush.dae',
        snapRotationToTerrain: true,
        tightnessCoefficient: 1,
        translucentBlendOp: 'LerpAlpha',
        trunkBendScale: 0.0500000007,
        windScale: 0.5,
      },
      holm_oak_bush_huge: {
        name: 'holm_oak_bush_huge',
        internalName: 'holm_oak_bush_huge',
        class: 'ForestItemData',
        annotation: 'NATURE',
        branchAmp: 0.100000001,
        detailAmp: 0.200000003,
        detailFreq: 0.5,
        mass: 10,
        shapeFile: 'levels/italy/art/shapes/trees/trees_italy/holm_oak_bush_huge.dae',
        tightnessCoefficient: 1,
        trunkBendScale: 0.0500000007,
        windScale: 0.5,
      },
      italy_rockface_boulder_1: {
        name: 'italy_rockface_boulder_1',
        internalName: 'italy_rockface_boulder_1',
        class: 'ForestItemData',
        dampingCoefficient: 3,
        dynamicCubemap: '0',
        planarReflection: '0',
        radius: 0.699999988,
        shapeFile: 'levels/italy/art/shapes/rocks/italy_rockface_boulder_1.dae',
        snapRotationToTerrain: true,
        tightnessCoefficient: 1,
        translucentBlendOp: 'LerpAlpha',
      },
      italy_rockface_boulder_2: {
        name: 'italy_rockface_boulder_2',
        internalName: 'italy_rockface_boulder_2',
        class: 'ForestItemData',
        dampingCoefficient: 3,
        dynamicCubemap: '0',
        planarReflection: '0',
        radius: 0.699999988,
        shapeFile: 'levels/italy/art/shapes/rocks/italy_rockface_boulder_2.dae',
        snapRotationToTerrain: true,
        tightnessCoefficient: 1,
        translucentBlendOp: 'LerpAlpha',
      },
      italy_rockface_boulder_3: {
        name: 'italy_rockface_boulder_3',
        internalName: 'italy_rockface_boulder_3',
        class: 'ForestItemData',
        dampingCoefficient: 3,
        dynamicCubemap: '0',
        planarReflection: '0',
        radius: 0.699999988,
        shapeFile: 'levels/italy/art/shapes/rocks/italy_rockface_boulder_3.dae',
        snapRotationToTerrain: true,
        tightnessCoefficient: 1,
        translucentBlendOp: 'LerpAlpha',
      },
      italy_rockface_boulder_4: {
        name: 'italy_rockface_boulder_4',
        internalName: 'italy_rockface_boulder_4',
        class: 'ForestItemData',
        dampingCoefficient: 3,
        dynamicCubemap: '0',
        planarReflection: '0',
        radius: 0.699999988,
        shapeFile: 'levels/italy/art/shapes/rocks/italy_rockface_boulder_4.dae',
        snapRotationToTerrain: true,
        tightnessCoefficient: 1,
        translucentBlendOp: 'LerpAlpha',
      },
    },
    vegetationSelectors: {
      default: 'holm_oak_city_small',
      needle: 'maritime_pine_tree',
      palm: 'italy_palm_1',
      olive: 'olive_tree',
      cypress: 'cypress_tree',
      bush: 'generibush',
      hedgeBush: 'holm_oak_bush_huge',
    },
    rockCandidates: [
      'italy_rockface_boulder_1',
      'italy_rockface_boulder_2',
      'italy_rockface_boulder_3',
      'italy_rockface_boulder_4',
    ],
    groundCover: {
      materialName: 'GrassMiddle',
      materialDef: ITALY_GROUNDCOVER_MATERIAL,
      terrainLayer: 'Grass',
    },
  },
  utah: {
    managedItemTemplates: {
      Juniper_tree_01: {
        name: 'Juniper_tree_01',
        internalName: 'Juniper_tree_01',
        class: 'TSForestItemData',
        annotation: 'NATURE',
        branchAmp: 0.0500000007,
        detailAmp: 0.100000001,
        detailFreq: 1,
        mass: 20,
        shapeFile: '/levels/Utah/art/shapes/trees/Juniper/Juniper_tree_01.dae',
        trunkBendScale: 0.00400000019,
        windScale: 0.400000006,
      },
      Juniper_bush_large_01: {
        name: 'Juniper_bush_large_01',
        internalName: 'Juniper_bush_large_01',
        class: 'TSForestItemData',
        annotation: 'NATURE',
        dampingCoefficient: 0.00400000019,
        detailAmp: 0.100000001,
        detailFreq: 1,
        mass: 4,
        radius: 0.5,
        rigidity: 20,
        shapeFile: '/levels/Utah/art/shapes/trees/Juniper/Juniper_bush_large_01.dae',
        trunkBendScale: 0.00400000019,
        windScale: 0.400000006,
      },
      utah_rock_small_a: {
        name: 'utah_rock_small_a',
        internalName: 'utah_rock_small_a',
        class: 'TSForestItemData',
        radius: 0.5,
        shapeFile: 'levels/Utah/art/shapes/rocks/utah_rock_small_a.dae',
      },
    },
    vegetationSelectors: {
      default: 'Juniper_tree_01',
      needle: 'Juniper_tree_01',
      bush: 'Juniper_bush_large_01',
      hedgeBush: 'Juniper_bush_large_01',
    },
    rockCandidates: ['utah_rock_small_a'],
    groundCover: {
      materialName: 'dry_grass',
      materialDef: UTAH_GROUNDCOVER_MATERIAL,
      terrainLayer: 'Grass',
    },
  },
  small_island: {
    managedItemTemplates: {
      Juniper_tree_01: {
        name: 'Juniper_tree_01',
        internalName: 'Juniper_tree_01',
        class: 'TSForestItemData',
        annotation: 'NATURE',
        branchAmp: 0.0500000007,
        detailAmp: 0.100000001,
        detailFreq: 1,
        mass: 20,
        shapeFile: '/levels/small_island/art/shapes/trees/Juniper/Juniper_tree_01.dae',
        trunkBendScale: 0.00400000019,
        windScale: 0.400000006,
      },
      Juniper_bush_large_01: {
        name: 'Juniper_bush_large_01',
        internalName: 'Juniper_bush_large_01',
        class: 'TSForestItemData',
        annotation: 'NATURE',
        dampingCoefficient: 0.00400000019,
        detailAmp: 0.100000001,
        detailFreq: 1,
        mass: 4,
        radius: 0.5,
        rigidity: 20,
        shapeFile: '/levels/small_island/art/shapes/trees/Juniper/Juniper_bush_large_01.dae',
        trunkBendScale: 0.00400000019,
        windScale: 0.400000006,
      },
    },
    vegetationSelectors: {
      default: 'Juniper_tree_01',
      needle: 'Juniper_tree_01',
      bush: 'Juniper_bush_large_01',
      hedgeBush: 'Juniper_bush_large_01',
    },
    rockCandidates: [],
  },
  east_coast: {
    managedItemTemplates: {
      tree_aspen_small_a: {
        name: 'tree_aspen_small_a',
        internalName: 'tree_aspen_small_a',
        class: 'TSForestItemData',
        branchAmp: 0.0299999993,
        detailAmp: 0.200000003,
        detailFreq: 4,
        mass: 20,
        rigidity: 17,
        shapeFile: 'levels/east_coast_usa/art/shapes/trees/trees_aspen/tree_aspen_small_a.dae',
        trunkBendScale: 0.100000001,
        windScale: 0.400000006,
      },
      tree_beech_bush_a: {
        name: 'tree_beech_bush_a',
        internalName: 'tree_beech_bush_a',
        class: 'TSForestItemData',
        branchAmp: 0.0199999996,
        dampingCoefficient: 0.400000006,
        detailAmp: 0.300000012,
        detailFreq: 4,
        mass: 1,
        radius: 0.5,
        rigidity: 11,
        shapeFile: 'levels/east_coast_usa/art/shapes/trees/trees_beech/tree_beech_bush_a.dae',
        tightnessCoefficient: 4,
        trunkBendScale: 0.0500000007,
        windScale: 0.400000006,
      },
      eca_rock_small: {
        name: 'eca_rock_small',
        internalName: 'eca_rock_small',
        class: 'TSForestItemData',
        annotation: 'ROCK',
        radius: 0.100000001,
        shapeFile: '/levels/east_coast_usa/art/shapes/rocks/eca_rock_small.dae',
      },
    },
    vegetationSelectors: {
      default: 'tree_aspen_small_a',
      needle: 'tree_aspen_small_a',
      bush: 'tree_beech_bush_a',
      hedgeBush: 'tree_beech_bush_a',
    },
    rockCandidates: ['eca_rock_small'],
    groundCover: {
      materialName: 'BNGGrass',
      materialDef: EAST_COAST_GROUNDCOVER_MATERIAL,
      terrainLayer: 'Grass',
    },
  },
  west_coast: {
    managedItemTemplates: {
      deserttree_bush_medium: {
        name: 'deserttree_bush_medium',
        internalName: 'deserttree_bush_medium',
        class: 'TSForestItemData',
        branchAmp: 0.00499999989,
        detailAmp: 0.0199999996,
        detailFreq: 0.699999988,
        mass: 1,
        order_simset: '7564389',
        radius: 0.5,
        shapeFile: 'levels/west_coast_usa/art/shapes/trees/deserttrees/deserttree_bush_medium.dae',
        trunkBendScale: 0.00200000079,
        windScale: 0.5,
      },
      eca_rock_small: {
        name: 'eca_rock_small',
        internalName: 'eca_rock_small',
        class: 'TSForestItemData',
        shapeFile: '/levels/west_coast_usa/art/shapes/rocks/eca_rock_small.dae',
      },
    },
    vegetationSelectors: {
      bush: 'deserttree_bush_medium',
      hedgeBush: 'deserttree_bush_medium',
    },
    rockCandidates: ['eca_rock_small'],
  },
  johnson_valley: {
    managedItemTemplates: {
      deserttree_bush_medium: {
        name: 'deserttree_bush_medium',
        internalName: 'deserttree_bush_medium',
        class: 'TSForestItemData',
        branchAmp: 0.00499999989,
        detailAmp: 0.0199999996,
        detailFreq: 0.699999988,
        mass: 1,
        order_simset: '7564389',
        radius: 0.5,
        shapeFile: 'levels/johnson_valley/art/shapes/trees/deserttrees/deserttree_bush_medium.dae',
        trunkBendScale: 0.00200000079,
        windScale: 0.5,
      },
      desert_rocks_small_01: {
        name: 'desert_rocks_small_01',
        internalName: 'desert_rocks_small_01',
        class: 'TSForestItemData',
        dampingCoefficient: 3,
        dynamicCubemap: '0',
        order_simset: '1030236933',
        planarReflection: '0',
        radius: 0.600000024,
        shadowNullDetailSize: 40,
        shapeFile: 'levels/johnson_valley/art/shapes/rocks/s_rocks_desert_small_01.dae',
        tightnessCoefficient: 1,
        translucentBlendOp: 'LerpAlpha',
      },
    },
    vegetationSelectors: {
      default: 'deserttree_bush_medium',
      needle: 'deserttree_bush_medium',
      bush: 'deserttree_bush_medium',
      hedgeBush: 'deserttree_bush_medium',
    },
    rockCandidates: ['desert_rocks_small_01'],
    groundCover: {
      materialName: 'dry_grass',
      materialDef: JOHNSON_VALLEY_GROUNDCOVER_MATERIAL,
      terrainLayer: 'Grass',
    },
  },
  jungle: {
    managedItemTemplates: {
      palm_medium: {
        name: 'palm_medium',
        internalName: 'palm_medium',
        class: 'TSForestItemData',
        annotation: 'NATURE',
        order_simset: '524',
        radius: 0.200000003,
        shapeFile: '/levels/jungle_rock_island/art/shapes/trees/trees_palm/palm_medium.dae',
      },
      tro_tree_1_huge: {
        name: 'tro_tree_1_huge',
        internalName: 'tro_tree_1_huge',
        class: 'TSForestItemData',
        annotation: 'NATURE',
        radius: 0.5,
        shapeFile: '/levels/jungle_rock_island/art/shapes/trees/trees_tropical_1/tro_tree_1_huge.dae',
      },
      tro_tree_2_medium: {
        name: 'tro_tree_2_medium',
        internalName: 'tro_tree_2_medium',
        class: 'TSForestItemData',
        annotation: 'NATURE',
        radius: 0.5,
        shapeFile: '/levels/jungle_rock_island/art/shapes/trees/trees_tropical_2/tro_tree_2_medium.dae',
      },
      grass_field_sml: {
        name: 'grass_field_sml',
        internalName: 'grass_field_sml',
        class: 'TSForestItemData',
        collidable: false,
        detailAmp: 0.5,
        detailFreq: 0.5,
        radius: 0.200000003,
        shapeFile: 'levels/jungle_rock_island/art/shapes/groundcover/grass_field_sml.dae',
        tightnessCoefficient: 4,
        trunkBendScale: 0.100000001,
        windScale: 0.5,
      },
      pac_rock_small_1: {
        name: 'pac_rock_small_1',
        internalName: 'pac_rock_small_1',
        class: 'TSForestItemData',
        annotation: 'ROCK',
        order_simset: '3276856',
        radius: 0.200000003,
        shapeFile: '/levels/jungle_rock_island/art/shapes/rocks/pac_rock_small_1.dae',
      },
    },
    vegetationSelectors: {
      default: 'tro_tree_1_huge',
      needle: 'tro_tree_2_medium',
      palm: 'palm_medium',
      bush: 'tro_tree_2_medium',
      hedgeBush: 'tro_tree_2_medium',
    },
    rockCandidates: ['pac_rock_small_1'],
    groundCover: {
      materialName: 'BNG_Grass_03',
      materialDef: JUNGLE_GROUNDCOVER_MATERIAL,
      terrainLayer: 'Grass',
    },
  },
  industrial: {
    managedItemTemplates: {
      cork_oak_bush_large: {
        name: 'cork_oak_bush_large',
        internalName: 'cork_oak_bush_large',
        class: 'TSForestItemData',
        branchAmp: 0.100000001,
        dampingCoefficient: 3,
        detailAmp: 0.5,
        detailFreq: 0.5,
        mass: 4,
        radius: 0.5,
        rigidity: 20,
        shapeFile: '/levels/Industrial/art/shapes/trees/trees_italy/cork_oak_bush_large.dae',
        tightnessCoefficient: 1,
        trunkBendScale: 0.0500000007,
        windScale: 0.5,
      },
      eca_rock_small: {
        name: 'eca_rock_small',
        internalName: 'eca_rock_small',
        class: 'TSForestItemData',
        annotation: 'ROCK',
        radius: 0.100000001,
        shapeFile: '/levels/Industrial/art/shapes/rocks/eca_rock_small.dae',
      },
    },
    vegetationSelectors: {
      bush: 'cork_oak_bush_large',
      hedgeBush: 'cork_oak_bush_large',
    },
    rockCandidates: ['eca_rock_small'],
  },
  automation_test_track: {
    managedItemTemplates: {
      cork_oak_large_1: {
        name: 'cork_oak_large_1',
        internalName: 'cork_oak_large_1',
        class: 'TSForestItemData',
        annotation: 'NATURE',
        branchAmp: 0.00999999978,
        dampingCoefficient: 0.200000003,
        detailAmp: 0.0500000007,
        detailFreq: 0.5,
        mass: 20,
        shapeFile: '/levels/automation_test_track/art/shapes/trees/trees_cork_oak/cork_oak_large_1.dae',
        tightnessCoefficient: 1,
        trunkBendScale: 0.00100000005,
        windScale: 0.300000012,
      },
      cork_oak_bush_large: {
        name: 'cork_oak_bush_large',
        internalName: 'cork_oak_bush_large',
        class: 'TSForestItemData',
        annotation: 'NATURE',
        branchAmp: 0.00999999978,
        dampingCoefficient: 0.200000003,
        detailAmp: 0.100000001,
        detailFreq: 0.5,
        mass: 2,
        shapeFile: '/levels/automation_test_track/art/shapes/trees/trees_cork_oak/cork_oak_bush_large.dae',
        tightnessCoefficient: 1,
        trunkBendScale: 0.00499999989,
        windScale: 0.5,
      },
      rocks_nz_jagged_medium_1: {
        name: 'rocks_nz_jagged_medium_1',
        internalName: 'rocks_nz_jagged_medium_1',
        class: 'TSForestItemData',
        radius: 0.300000012,
        shapeFile: 'levels/automation_test_track/art/shapes/rocks/s_rocks_nz_jagged_medium_1.dae',
      },
    },
    vegetationSelectors: {
      default: 'cork_oak_large_1',
      needle: 'cork_oak_large_1',
      bush: 'cork_oak_bush_large',
      hedgeBush: 'cork_oak_bush_large',
    },
    rockCandidates: ['rocks_nz_jagged_medium_1'],
  },
  hirochi_raceway: {
    managedItemTemplates: {
      cork_oak_bush_large: {
        name: 'cork_oak_bush_large',
        internalName: 'cork_oak_bush_large',
        class: 'TSForestItemData',
        shapeFile: 'levels/hirochi_raceway/art/shapes/trees/ECA_coast_bush/cork_oak_bush_large.dae',
      },
      eca_rock_small: {
        name: 'eca_rock_small',
        internalName: 'eca_rock_small',
        class: 'TSForestItemData',
        annotation: 'ROCK',
        radius: 0.100000001,
        shapeFile: '/levels/hirochi_raceway/art/shapes/rocks/eca_rock_small.dae',
      },
    },
    vegetationSelectors: {
      bush: 'cork_oak_bush_large',
      hedgeBush: 'cork_oak_bush_large',
    },
    rockCandidates: ['eca_rock_small'],
  },
};

const WATER_PROFILES = {
  italy: {
    waterCubemap: 'cubemap_italy_reflection',
    waterDepthGradientTex: '/assets/materials/tileable/water/depthcolor_ramp/depthcolor_ramp_italy_muddy_b.png',
    waterFoamTex: '/assets/materials/tileable/water/water_effects/foam2_b.color.dds',
    waterRippleTex: '/assets/materials/tileable/water/water_effects/ripple_nm.normal.dds',
    riverCubemap: 'cubemap_ocean_reflection',
    riverDepthGradientTex: '/assets/materials/tileable/water/depthcolor_ramp/depthcolor_ramp_italy_rivers_b.png',
    riverRippleTex: '/assets/materials/tileable/water/water_effects/ripple3_nm.normal.dds',
  },
  utah: {
    waterCubemap: 'cubemap_utah_reflection',
    waterDepthGradientTex: '/levels/Utah/art/water/depthcolor_ramp.png',
    waterFoamTex: 'levels/Utah/art/water/foam.dds',
    waterRippleTex: '/levels/Utah/art/water/ripple.dds',
    riverCubemap: 'cubemap_road_sky_reflection',
    riverDepthGradientTex: 'levels/Utah/art/water/depthcolor_ramp.png',
    riverRippleTex: 'levels/Utah/art/water/ripple4.dds',
  },
  east_coast_usa: {
    waterCubemap: 'cubemap_eca_reflection',
    waterDepthGradientTex: '/levels/east_coast_usa/art/water/depthcolor_ramp_mud1.png',
    waterFoamTex: 'levels/east_coast_usa/art/water/foam.dds',
    waterRippleTex: '/levels/east_coast_usa/art/water/ripple.dds',
    riverCubemap: 'cubemap_river_reflection',
    riverDepthGradientTex: 'levels/east_coast_usa/art/water/depthcolor_ramp.png',
    riverRippleTex: 'levels/east_coast_usa/art/water/ripple3.dds',
  },
  west_coast_usa: {
    waterCubemap: 'cubemap_wca_reflection',
    waterDepthGradientTex: '/levels/east_coast_usa/art/water/depthcolor_ramp_mud1.png',
    waterFoamTex: 'levels/east_coast_usa/art/water/foam.dds',
    waterRippleTex: '/levels/west_coast_usa/art/water/ripple4.dds',
    riverCubemap: 'cubemap_wca_reflection',
    riverDepthGradientTex: 'levels/east_coast_usa/art/water/depthcolor_ramp.png',
    riverRippleTex: 'levels/east_coast_usa/art/water/ripple3.dds',
  },
  johnson_valley: {
    waterCubemap: 'cubemap_johnson_valley_reflection',
    waterDepthGradientTex: '/levels/johnson_valley/art/water/depthcolor_ramp_tropical_2.png',
    waterFoamTex: 'levels/johnson_valley/art/water/foam.dds',
    waterRippleTex: '/levels/johnson_valley/art/water/ripple.dds',
    riverCubemap: 'cubemap_road_sky_reflection',
    riverDepthGradientTex: 'levels/johnson_valley/art/water/depthcolor_ramp_tropical.png',
    riverRippleTex: 'levels/johnson_valley/art/water/ripple3.dds',
  },
  jungle_rock_island: {
    waterCubemap: 'cubemap_jungle_reflection',
    waterDepthGradientTex: '/levels/jungle_rock_island/art/water/depthcolor_ramp_tropical_2.png',
    waterFoamTex: 'levels/jungle_rock_island/art/water/foam.dds',
    waterRippleTex: '/levels/jungle_rock_island/art/water/ripple.dds',
    riverCubemap: 'cubemap_river_reflection',
    riverDepthGradientTex: 'levels/jungle_rock_island/art/water/depthcolor_ramp_jungle_river.png',
    riverRippleTex: 'levels/jungle_rock_island/art/water/ripple3.dds',
  },
  small_island: {
    waterCubemap: 'cubemap_small_island_reflection',
    waterDepthGradientTex: '/levels/italy/art/water/depthcolor_ramp_SI.png',
    waterFoamTex: 'levels/italy/art/water/foam.dds',
    waterRippleTex: '/levels/italy/art/water/ripple.dds',
    riverCubemap: 'cubemap_ocean_reflection',
    riverDepthGradientTex: 'levels/italy/art/water/depthcolor_ramp_SI.png',
    riverRippleTex: 'levels/italy/art/water/ripple3.dds',
  },
  Industrial: {
    waterCubemap: 'cubemap_industrial_reflection',
    waterDepthGradientTex: '/levels/Industrial/art/water/depthcolor_ramp_mud1.png',
    waterFoamTex: 'levels/Industrial/art/water/foam.dds',
    waterRippleTex: '/levels/Industrial/art/water/ripple.dds',
    riverCubemap: 'cubemap_industrialriver_reflection',
    riverDepthGradientTex: 'levels/Industrial/art/water/depthcolor_ramp_colorful.png',
    riverRippleTex: 'levels/Industrial/art/water/ripple3.dds',
  },
  automation_test_track: {
    waterCubemap: 'cubemap_automation_reflection',
    waterDepthGradientTex: '/levels/automation_test_track/art/water/depthcolor_ramp_mud1.png',
    waterFoamTex: 'levels/automation_test_track/art/water/foam.dds',
    waterRippleTex: '/levels/automation_test_track/art/water/ripple.dds',
    riverCubemap: 'cubemap_river_reflection',
    riverDepthGradientTex: 'levels/automation_test_track/art/water/depthcolor_ramp_jungle_river.png',
    riverRippleTex: 'levels/automation_test_track/art/water/ripple3.dds',
  },
  hirochi_raceway: {
    waterCubemap: 'cubemap_hirochi_raceway_reflection',
    waterDepthGradientTex: '/levels/east_coast_usa/art/water/depthcolor_ramp_mud1.png',
    waterFoamTex: 'levels/east_coast_usa/art/water/foam.dds',
    waterRippleTex: '/levels/east_coast_usa/art/water/ripple.dds',
    riverCubemap: 'cubemap_ocean_reflection',
    riverDepthGradientTex: 'levels/east_coast_usa/art/water/depthcolor_ramp.png',
    riverRippleTex: 'levels/east_coast_usa/art/water/ripple3.dds',
  },
};

export const BEAMNG_BIOMES = [
  {
    id: 'italy',
    label: 'Italy',
    levelName: 'italy',
    environmentProfile: { globalEnvironmentMap: 'cubemap_italy_reflection' },
    waterProfile: WATER_PROFILES.italy,
    assetSetIds: ['italy', 'automation_test_track', 'east_coast'],
    terrainLevelFallbacks: ['italy', 'east_coast_usa', 'jungle_rock_island', 'Utah'],
  },
  {
    id: 'utah',
    label: 'Utah',
    levelName: 'Utah',
    environmentProfile: { globalEnvironmentMap: 'cubemap_utah_reflection' },
    waterProfile: WATER_PROFILES.utah,
    assetSetIds: ['utah', 'small_island', 'johnson_valley', 'east_coast'],
    terrainLevelFallbacks: ['Utah', 'johnson_valley', 'small_island', 'east_coast_usa'],
  },
  {
    id: 'automation_test_track',
    label: 'Automation Test Track',
    levelName: 'automation_test_track',
    environmentProfile: { globalEnvironmentMap: 'cubemap_automation_reflection' },
    waterProfile: WATER_PROFILES.automation_test_track,
    assetSetIds: ['automation_test_track', 'italy', 'east_coast'],
    terrainLevelFallbacks: ['automation_test_track', 'italy', 'east_coast_usa'],
  },
  {
    id: 'east_coast_usa',
    label: 'East Coast USA',
    levelName: 'east_coast_usa',
    environmentProfile: { globalEnvironmentMap: 'cubemap_eca_reflection' },
    waterProfile: WATER_PROFILES.east_coast_usa,
    assetSetIds: ['east_coast', 'west_coast', 'italy'],
    terrainLevelFallbacks: ['east_coast_usa', 'west_coast_usa', 'italy', 'Utah'],
  },
  {
    id: 'hirochi_raceway',
    label: 'Hirochi Raceway',
    levelName: 'hirochi_raceway',
    environmentProfile: { globalEnvironmentMap: 'cubemap_hirochi_raceway_reflection' },
    waterProfile: WATER_PROFILES.hirochi_raceway,
    assetSetIds: ['hirochi_raceway', 'east_coast', 'italy'],
    terrainLevelFallbacks: ['hirochi_raceway', 'east_coast_usa', 'italy', 'Utah'],
  },
  {
    id: 'industrial',
    label: 'Industrial',
    levelName: 'Industrial',
    environmentProfile: { globalEnvironmentMap: 'cubemap_industrial_reflection' },
    waterProfile: WATER_PROFILES.Industrial,
    assetSetIds: ['industrial', 'automation_test_track', 'east_coast', 'italy'],
    terrainLevelFallbacks: ['Industrial', 'east_coast_usa', 'italy', 'automation_test_track'],
  },
  {
    id: 'johnson_valley',
    label: 'Johnson Valley',
    levelName: 'johnson_valley',
    environmentProfile: { globalEnvironmentMap: 'cubemap_johnson_valley_reflection' },
    waterProfile: WATER_PROFILES.johnson_valley,
    assetSetIds: ['johnson_valley', 'utah', 'west_coast'],
    terrainLevelFallbacks: ['johnson_valley', 'Utah', 'west_coast_usa', 'east_coast_usa'],
  },
  {
    id: 'jungle_rock_island',
    label: 'Jungle Rock Island',
    levelName: 'jungle_rock_island',
    environmentProfile: { globalEnvironmentMap: 'cubemap_jungle_reflection' },
    waterProfile: WATER_PROFILES.jungle_rock_island,
    assetSetIds: ['jungle', 'italy', 'johnson_valley'],
    terrainLevelFallbacks: ['jungle_rock_island', 'italy', 'johnson_valley', 'east_coast_usa'],
  },
  {
    id: 'small_island',
    label: 'Small Island',
    levelName: 'small_island',
    environmentProfile: { globalEnvironmentMap: 'cubemap_small_island_reflection' },
    waterProfile: WATER_PROFILES.small_island,
    assetSetIds: ['small_island', 'utah', 'jungle'],
    terrainLevelFallbacks: ['small_island', 'Utah', 'italy', 'jungle_rock_island'],
  },
  {
    id: 'west_coast_usa',
    label: 'West Coast USA',
    levelName: 'west_coast_usa',
    environmentProfile: { globalEnvironmentMap: 'cubemap_wca_reflection' },
    waterProfile: WATER_PROFILES.west_coast_usa,
    assetSetIds: ['west_coast', 'east_coast', 'johnson_valley'],
    terrainLevelFallbacks: ['west_coast_usa', 'east_coast_usa', 'johnson_valley', 'italy'],
  },
];

const BIOME_BY_ID = new Map(BEAMNG_BIOMES.map((biome) => [biome.id, biome]));
let shapeMaterialLibraryPromise = null;

const normalizeLevelName = (value) => String(value || '').toLowerCase();

export function getBeamNGBiomeById(biomeId) {
  return BIOME_BY_ID.get(biomeId) ?? null;
}

export function getBeamNGBiomeOptions() {
  return BEAMNG_BIOMES.map(({ id, label }) => ({ id, label }));
}

export function getTerrainSemanticCandidates(semanticName) {
  return DEFAULT_TERRAIN_CANDIDATES[semanticName] ?? [semanticName];
}

export function getTerrainLevelFallbacks(biome) {
  return Array.from(new Set([
    biome?.levelName,
    ...(biome?.terrainLevelFallbacks ?? []),
  ].filter(Boolean)));
}

export function getGroundCoverProfile(biome) {
  for (const assetSetId of biome?.assetSetIds ?? []) {
    const groundCover = ASSET_SETS[assetSetId]?.groundCover;
    if (groundCover) return groundCover;
  }
  return ASSET_SETS.italy.groundCover;
}

export function getManagedForestTemplate(biome, itemName) {
  for (const assetSetId of biome?.assetSetIds ?? []) {
    const template = ASSET_SETS[assetSetId]?.managedItemTemplates?.[itemName];
    if (template) return template;
  }
  return null;
}

function getVegetationSelector(biome, selectorName) {
  for (const assetSetId of biome?.assetSetIds ?? []) {
    const selectors = ASSET_SETS[assetSetId]?.vegetationSelectors;
    if (selectors?.[selectorName]) return selectors[selectorName];
  }
  return null;
}

export function resolveTreeTypeForTags(biome, tags = {}) {
  const species = `${tags.species || ''} ${tags['species:en'] || ''}`.toLowerCase();
  if (species.includes('olive')) return getVegetationSelector(biome, 'olive') ?? getVegetationSelector(biome, 'default');
  if (species.includes('cypress')) return getVegetationSelector(biome, 'cypress') ?? getVegetationSelector(biome, 'default');
  if (species.includes('palm') || tags.leaf_type === 'palm') return getVegetationSelector(biome, 'palm') ?? getVegetationSelector(biome, 'default');
  if (tags.leaf_type === 'needleleaved' || tags.wood === 'coniferous') return getVegetationSelector(biome, 'needle') ?? getVegetationSelector(biome, 'default');
  return getVegetationSelector(biome, 'default') ?? getVegetationSelector(biome, 'bush');
}

export function resolveBushType(biome, { hedge = false } = {}) {
  return getVegetationSelector(biome, hedge ? 'hedgeBush' : 'bush')
    ?? getVegetationSelector(biome, 'default')
    ?? 'generibush';
}

export function getRockCandidates(biome) {
  for (const assetSetId of biome?.assetSetIds ?? []) {
    const candidates = ASSET_SETS[assetSetId]?.rockCandidates;
    if (Array.isArray(candidates) && candidates.length > 0) return candidates;
  }
  return ASSET_SETS.italy.rockCandidates;
}

export function getWaterProfile(biome) {
  return biome?.waterProfile ?? WATER_PROFILES.italy;
}

export function getGlobalEnvironmentMap(biome) {
  return biome?.environmentProfile?.globalEnvironmentMap ?? 'cubemap_italy_reflection';
}

export function doesBiomeMatchLevel(biome, levelName) {
  return normalizeLevelName(biome?.levelName) === normalizeLevelName(levelName);
}

async function loadShapeMaterialLibrary() {
  if (!shapeMaterialLibraryPromise) {
    shapeMaterialLibraryPromise = fetch('/beamng_shape_materials.json')
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load BeamNG shape materials: ${response.status}`);
        return response.json();
      })
      .catch((error) => {
        console.warn('Failed to load BeamNG shape material library:', error);
        return {};
      });
  }
  return shapeMaterialLibraryPromise;
}

export async function getShapeMaterialDefsForBiome(biome) {
  const library = await loadShapeMaterialLibrary();
  const merged = {};
  for (const assetSetId of biome?.assetSetIds ?? []) {
    Object.assign(merged, library?.[assetSetId] ?? {});
  }
  return merged;
}
