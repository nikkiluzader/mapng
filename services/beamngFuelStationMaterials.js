// AUTO-DERIVED from BeamNG east_coast_usa buildings/main.materials.json (0.39).
// Materials used by the eca_gastation_pumps + eca_charging_station meshes.
// The meshes are referenced by .link into the installed ECA level; these defs
// register the material NAMES in our level so the meshes render textured.
// Texture paths normalized to absolute so they resolve from any folder.

export function getFuelStationRuntimeMaterialDefs() {
  return {
    "eca_asphalt": {
      "name": "eca_asphalt",
      "mapTo": "eca_asphalt",
      "class": "Material",
      "Stages": [
        {
          "ambientOcclusionMap": "/levels/east_coast_usa/art/shapes/buildings/t_asphalt_ao.data.png",
          "baseColorFactor": [
            1,
            0.999989986,
            0.999989986,
            1
          ],
          "baseColorMap": "/levels/east_coast_usa/art/shapes/buildings/t_asphalt_b.color.png",
          "detailMap": "/levels/east_coast_usa/art/shapes/buildings/t_macro_asphalt_detail.data.png",
          "detailScale": [
            0.100000001,
            0.100000001
          ],
          "normalMap": "/levels/east_coast_usa/art/shapes/buildings/t_asphalt_nm.normal.png",
          "overlayMap": "/levels/east_coast_usa/art/shapes/buildings/eca_breakup_texture.dds",
          "roughnessMap": "/levels/east_coast_usa/art/shapes/buildings/t_asphalt_r.data.png",
          "vertColor": true
        },
        {},
        {},
        {}
      ],
      "alphaRef": 0,
      "annotation": "ASPHALT",
      "groundType": "ASPHALT_OLD",
      "materialTag0": "beamng",
      "materialTag1": "building",
      "materialTag2": "east_coast_usa",
      "translucentBlendOp": "None",
      "version": 1.5
    },
    "eca_bld_cleanmetal": {
      "name": "eca_bld_cleanmetal",
      "mapTo": "eca_bld_cleanmetal",
      "class": "Material",
      "Stages": [
        {
          "colorMap": "/levels/east_coast_usa/art/shapes/null.dds",
          "diffuseColor": [
            0.9960780144,
            0.9960780144,
            0.9960780144,
            1
          ],
          "normalMap": "/levels/east_coast_usa/art/shapes/buildings/eca_bld_cleanmetal_n.dds",
          "overlayMap": "/levels/east_coast_usa/art/shapes/buildings/eca_breakup_texture.dds",
          "reflectivityMap": "/levels/east_coast_usa/art/shapes/buildings/eca_bld_cleanmetal_r.dds",
          "specularMap": "/levels/east_coast_usa/art/shapes/buildings/eca_bld_cleanmetal_s.dds",
          "specularPower": 11,
          "useAnisotropic": true,
          "vertColor": true
        },
        {
          "vertColor": true
        },
        {},
        {}
      ],
      "annotation": "BUILDINGS",
      "cubemap": "eca_cubemap_metalblurred",
      "groundType": "METAL",
      "materialTag0": "beamng",
      "materialTag1": "building",
      "materialTag2": "east_coast_usa",
      "translucentBlendOp": "None"
    },
    "eca_bld_metal_painted": {
      "name": "eca_bld_metal_painted",
      "mapTo": "eca_bld_metal_painted",
      "class": "Material",
      "Stages": [
        {
          "colorMap": "/levels/east_coast_usa/art/shapes/buildings/eca_bld_metal_painted_d.dds",
          "normalMap": "/levels/east_coast_usa/art/shapes/buildings/eca_bld_metal_painted_n.dds",
          "reflectivityMap": "/levels/east_coast_usa/art/shapes/buildings/eca_bld_metal_painted_r.dds",
          "specularMap": "/levels/east_coast_usa/art/shapes/buildings/eca_bld_metal_painted_s.dds",
          "useAnisotropic": true,
          "vertColor": true
        },
        {},
        {},
        {}
      ],
      "annotation": "BUILDINGS",
      "cubemap": "global_cubemap_metalblurred",
      "groundType": "METAL",
      "materialTag0": "beamng",
      "materialTag1": "building",
      "materialTag2": "east_coast_usa",
      "translucentBlendOp": "None"
    },
    "eca_bld_metal_trim": {
      "name": "eca_bld_metal_trim",
      "mapTo": "eca_bld_metal_trim",
      "class": "Material",
      "Stages": [
        {
          "colorMap": "/levels/east_coast_usa/art/shapes/buildings/eca_bld_metal_trim_d.dds",
          "diffuseColor": [
            0.988235354,
            0.996078491,
            0.988235354,
            0.00800000038
          ],
          "normalMap": "/levels/east_coast_usa/art/shapes/buildings/eca_bld_metal_trim_n.dds",
          "pixelSpecular": true,
          "reflectivityMap": "/levels/east_coast_usa/art/shapes/buildings/eca_bld_metal_trim_r.dds",
          "roughnessFactor": 0.812008262,
          "specularMap": "/levels/east_coast_usa/art/shapes/buildings/eca_bld_metal_trim_s.dds",
          "useAnisotropic": true,
          "vertColor": true
        },
        {},
        {},
        {}
      ],
      "annotation": "BUILDINGS",
      "cubemap": "global_cubemap_metalblurred",
      "groundType": "METAL",
      "translucentBlendOp": "None"
    },
    "eca_bld_moderncorrugated_tin": {
      "name": "eca_bld_moderncorrugated_tin",
      "mapTo": "eca_bld_moderncorrugated_tin",
      "class": "Material",
      "Stages": [
        {
          "colorMap": "/levels/east_coast_usa/art/shapes/buildings/eca_bld_moderncorrugated_tin_d.dds",
          "normalMap": "/levels/east_coast_usa/art/shapes/buildings/eca_bld_moderncorrugated_tin_n.dds",
          "overlayMap": "/levels/east_coast_usa/art/shapes/buildings/eca_breakup_texture.dds",
          "specularMap": "/levels/east_coast_usa/art/shapes/buildings/eca_bld_moderncorrugated_tin_s.dds",
          "specularPower": 1,
          "useAnisotropic": true,
          "vertColor": true
        },
        {},
        {},
        {}
      ],
      "annotation": "BUILDINGS",
      "groundType": "METAL",
      "materialTag0": "beamng",
      "materialTag1": "building",
      "materialTag2": "east_coast_usa",
      "translucentBlendOp": "None"
    },
    "eca_bld_sidewalks": {
      "name": "eca_bld_sidewalks",
      "mapTo": "eca_bld_sidewalks",
      "class": "Material",
      "Stages": [
        {
          "colorMap": "/assets/materials/baked_props/eca_bld_sidewalks/eca_bld_sidewalks_d.dds",
          "normalMap": "/assets/materials/baked_props/eca_bld_sidewalks/eca_bld_sidewalks_n.dds",
          "overlayMap": "/levels/east_coast_usa/art/shapes/buildings/eca_breakup_texture.dds",
          "specularMap": "/assets/materials/baked_props/eca_bld_sidewalks/eca_bld_sidewalks_s.dds",
          "specularPower": 1,
          "useAnisotropic": true,
          "vertColor": true
        },
        {},
        {},
        {}
      ],
      "annotation": "SIDEWALK",
      "groundType": "ASPHALT_OLD",
      "materialTag0": "beamng",
      "materialTag1": "building",
      "materialTag2": "east_coast_usa",
      "translucentBlendOp": "None"
    },
    "eca_doors_windows": {
      "name": "eca_doors_windows",
      "mapTo": "eca_doors_windows",
      "class": "Material",
      "Stages": [
        {
          "baseColorMap": "/assets/materials/atlas/eca_doors_windows/eca_doors_windows_b.color.png",
          "metallicFactor": 1,
          "metallicMap": "/assets/materials/atlas/eca_doors_windows/eca_doors_windows_m.data.png",
          "normalMap": "/assets/materials/atlas/eca_doors_windows/eca_doors_windows_nm.normal.png",
          "overlayMap": "/levels/east_coast_usa/art/shapes/buildings/eca_breakup_texture.dds",
          "roughnessMap": "/assets/materials/atlas/eca_doors_windows/eca_doors_windows_r.data.png",
          "vertColor": true
        },
        {
          "metallicFactor": null,
          "vertColor": null
        },
        {
          "metallicFactor": null,
          "vertColor": null
        },
        {
          "metallicFactor": null,
          "vertColor": null
        }
      ],
      "annotation": "BUILDINGS",
      "dynamicCubemap": true,
      "groundType": "METAL",
      "materialTag0": "beamng",
      "materialTag1": "building",
      "materialTag2": "east_coast_usa",
      "translucentBlendOp": "None",
      "version": 1.5
    },
    "eca_genericsigns": {
      "name": "eca_genericsigns",
      "mapTo": "eca_genericsigns",
      "class": "Material",
      "Stages": [
        {
          "colorMap": "/assets/materials/baked_props/eca_genericsigns/eca_genericsigns_d.dds",
          "specular": [
            0.9882349968,
            0.9882349968,
            0.9882349968,
            1
          ],
          "specularPower": 1,
          "useAnisotropic": true,
          "vertColor": true
        },
        {
          "colorMap": "/assets/materials/baked_props/eca_genericsigns/eca_genericsigns_emissive.dds",
          "glow": true,
          "vertColor": true
        },
        {},
        {}
      ],
      "alphaRef": 159,
      "alphaTest": true,
      "doubleSided": true,
      "groundType": "METAL",
      "materialTag0": "beamng",
      "materialTag1": "east_coast_usa",
      "specularStrength0": "0.784314",
      "translucentZWrite": true
    },
    "eca_plastic_rough": {
      "name": "eca_plastic_rough",
      "mapTo": "eca_plastic_rough",
      "class": "Material",
      "Stages": [
        {
          "colorMap": "/levels/east_coast_usa/art/shapes/buildings/eca_plastic_rough_d.dds",
          "normalMap": "/levels/east_coast_usa/art/shapes/buildings/eca_plastic_rough_n.dds",
          "specularMap": "/levels/east_coast_usa/art/shapes/buildings/eca_plastic_rough_s.dds",
          "useAnisotropic": true,
          "vertColor": true
        },
        {},
        {},
        {}
      ],
      "annotation": "BUILDINGS",
      "groundType": "PLASTIC",
      "materialTag0": "beamng",
      "materialTag1": "building",
      "materialTag2": "east_coast_usa",
      "translucentBlendOp": "None"
    },
    "eca_bld_concrete": {
      "name": "eca_bld_concrete",
      "mapTo": "eca_bld_concrete",
      "class": "Material",
      "Stages": [
        {
          "colorMap": "/levels/east_coast_usa/art/shapes/buildings/eca_bld_concrete_d.dds",
          "detailMap": "/levels/east_coast_usa/art/shapes/buildings/detail_grunge_01b_low_desat.dds",
          "detailScale": [
            0.300000012,
            0.300000012
          ],
          "normalMap": "/levels/east_coast_usa/art/shapes/buildings/eca_bld_concrete_n.dds",
          "overlayMap": "/levels/east_coast_usa/art/shapes/buildings/eca_breakup_texture.dds",
          "specularMap": "/levels/east_coast_usa/art/shapes/buildings/eca_bld_concrete_s.dds",
          "useAnisotropic": true,
          "vertColor": true
        },
        {},
        {},
        {}
      ],
      "annotation": "BUILDINGS",
      "groundType": "CONCRETE",
      "materialTag0": "beamng",
      "materialTag1": "building",
      "materialTag2": "east_coast_usa",
      "translucentBlendOp": "None"
    }
  };
}
