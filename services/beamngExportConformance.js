/**
 * BeamNG level export conformance utilities.
 *
 * This module is intentionally narrow: it validates files that every current
 * MapNG export should contain, while documenting additional official artifacts
 * as optional/roadmap items in refs/docs/beamng-export-conformance-matrix.md
 * (untracked local reference docs).
 */

/**
 * Build the required level-relative file list for a generated export.
 *
 * @param {object} options
 * @param {boolean} [options.requiresVegetation=false]
 * @param {boolean} [options.requiresRoadGroups=false]
 * @param {boolean} [options.requiresMeshRoads=false]
 * @param {boolean} [options.requiresBarriers=false]
 * @param {boolean} [options.requiresSigns=false]
 * @param {boolean} [options.requiresDecalRoads=false]
 * @returns {string[]}
 */
export function getRequiredLevelFiles(options = {}) {
  const {
    requiresVegetation = false,
    requiresRoadGroups = false,
    requiresMeshRoads = false,
    requiresBarriers = false,
    requiresSigns = false,
    requiresDecalRoads = false,
    // (experimental ground as models: the base texture under its colour name, and the ground's models)
    groundAsModels = false,
  } = options;

  const required = [
    'info.json',
    'city.sites.json',
    'map.json',
    'signals.json',
    'main.decals.json',
    'main.forestbrushes4.json',
    'mainLevel.lua',
    'preview.png',
    'terrain.terrain.json',
    'art/decals/managedDecalData.json',
    'art/terrains/terrain.ter',
    'art/terrains/terrain.terrainheightmap.png',
    groundAsModels ? 'art/terrains/terrain_b.color.png' : 'art/terrains/terrain.png',
    'art/terrains/main.materials.json',
    'main/items.level.json',
    'main/MissionGroup/items.level.json',
    'main/MissionGroup/PlayerDropPoints/items.level.json',
    'main/MissionGroup/CameraBookmarks/items.level.json',
    'main/MissionGroup/sky_and_sun/items.level.json',
    'main/MissionGroup/level_objects/items.level.json',
    'main/MissionGroup/Water/items.level.json',
    'main/MissionGroup/AIWaypointsGroup/items.level.json',
    'main/MissionGroup/AIDecalWaypointsGroup/items.level.json',
  ];

  if (requiresVegetation) {
    required.push('main/MissionGroup/vegetation/items.level.json');
  }
  if (requiresRoadGroups) {
    required.push('main/MissionGroup/roads/items.level.json');
  }
  if (requiresMeshRoads) {
    required.push('main/MissionGroup/Mesh_roads/items.level.json');
  }
  if (requiresBarriers) {
    required.push('main/MissionGroup/barriers/items.level.json');
  }
  if (requiresSigns) {
    required.push('main/MissionGroup/signs/items.level.json');
  }
  if (requiresDecalRoads) {
    required.push('main/MissionGroup/Decal_Roads/items.level.json');
  }
  if (groundAsModels) {
    required.push('map_assets/custom_assets/ground/main.materials.json');
  }

  return required;
}

/**
 * Validate generated ZIP structure for required files.
 *
 * @param {object} zip JSZip instance
 * @param {string} base e.g. levels/my_level
 * @param {object} options same options as getRequiredLevelFiles
 */
export function validateBeamNGZipStructure(zip, base, options = {}) {
  const requiredLevelFiles = getRequiredLevelFiles(options);
  const missing = [];

  for (const relativePath of requiredLevelFiles) {
    const fullPath = `${base}/${relativePath}`;
    if (!zip.file(fullPath)) {
      missing.push(fullPath);
    }
  }

  if (missing.length > 0) {
    throw new Error(`BeamNG export validation failed: missing required files\n${missing.map((p) => `- ${p}`).join('\n')}`);
  }
}
