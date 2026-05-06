# BeamNG Level Folder Structure Rules (Phase 1)

This document defines practical rules for generating BeamNG levels based on sampled base-game maps in:
- refs/base_game_content/template
- refs/base_game_content/Utah
- refs/base_game_content/east_coast_usa
- refs/base_game_content/italy
- refs/base_game_content/johnson_valley
- refs/base_game_content/west_coast_usa

The intent is to provide a stable contract for MapNG exports in Phase 2.

## 1) Scope and Design Targets

- Target: a playable level package under levels/<levelId>/.
- Priority: compatibility with current base-game loading conventions.
- Strategy: prefer template-style modular scene files and explicit references over legacy monolithic scene blobs.

## 2) Serialization and File Format Conventions

Base-game files use multiple formats:

1. Strict JSON files (single JSON object):
- info.json
- map.json
- *.terrain.json
- *.forest.json
- *.materials.json
- *.link

2. Line-delimited JSON object streams (NDJSON-style):
- main/items.level.json
- main/MissionGroup/items.level.json
- main/MissionGroup/*/items.level.json
- main.forestbrushes.json
- main.forestbrushes4.json

3. Legacy monolithic scene JSON (optional/legacy):
- main.level.json

Rule:
- Exporter MUST output strict JSON for object files.
- Exporter MUST output one JSON object per line for items.level.json and forestbrushes files.
- Exporter SHOULD avoid writing main.level.json for new exports.

## 3) Canonical Level Root Layout

Minimum expected root:

levels/<levelId>/
- info.json
- map.json
- <terrainName>.ter
- <terrainName>.terrain.json
- main.decals.json
- main.forestbrushes4.json
- main/
  - items.level.json
  - MissionGroup/
    - items.level.json
    - <group>/items.level.json (for each declared group)

Template-derived optional but recommended:
- art/
- forest/
- <levelId>.forest.json (or equivalent named forest data file)
- <levelId>_preview.* image(s)

Rule:
- Exporter MUST generate the minimum expected root set.
- Exporter SHOULD keep terrain and scene filenames stable and internally consistent.

## 4) Required Metadata Files

### 4.1 info.json

Observed common fields:
- title
- description
- previews
- size
- biome
- roads
- suitablefor
- features
- authors

Common gameplay fields:
- defaultSpawnPointName
- spawnPoints[]
- region
- country
- roadRules
- minimap[]
- supportsTraffic
- supportsTimeOfDay

Rule:
- Exporter MUST include: title, description, previews, size, biome, roads, suitablefor, features, authors.
- Exporter MUST include a valid defaultSpawnPointName when spawn points are emitted.
- Exporter SHOULD include region/country and roadRules where known.

### 4.2 map.json

Observed usage:
- Stores AI route segments under segments.

Rule:
- Exporter MUST emit map.json.
- Exporter MAY emit an empty object form: { "segments": {} } when no route graph is generated.

### 4.3 Terrain manifest (*.terrain.json)

Observed required fields:
- datafile
- heightMapItemSize
- heightMapSize
- heightmapImage
- layerMapItemSize
- layerMapSize
- materials
- size
- version

Rule:
- Exporter MUST emit version = 9 unless BeamNG format changes.
- Exporter MUST keep datafile and heightmapImage paths aligned with actual levelId and terrain filenames.
- Exporter MUST keep size/material list consistent with generated .ter data.

## 5) Scene Graph Structure (main/)

### 5.1 Root scene entry

main/items.level.json defines MissionGroup root object, typically:
- class: SimGroup
- name: MissionGroup

Rule:
- Exporter MUST create MissionGroup root in main/items.level.json.

### 5.2 MissionGroup registry

main/MissionGroup/items.level.json declares direct children groups/objects with __parent: MissionGroup.

Rule:
- Exporter MUST declare every child group that has a corresponding subfolder file.
- Exporter MUST keep names and folder paths aligned (case-sensitive).

### 5.3 Child group files

Each declared group is stored in:
- main/MissionGroup/<GroupName>/items.level.json

Template baseline groups:
- sky_and_sun
- level_objects (or LevelObjects)
- PlayerDropPoints
- AIWaypointsGroup
- AIDecalWaypointsGroup
- Water (sometimes nested under level_objects in some maps)
- vegetation

Rule:
- Exporter MUST provide a coherent minimum set for environment, terrain, and spawnability.
- Exporter SHOULD use template-style grouping, even if some groups are empty.

## 6) Required Runtime Objects for Playable Export

Minimum object set expected in scene files:

1. TerrainBlock
- Must reference generated .ter file via terrainFile.
- Name commonly theTerrain.

2. SpawnSphere
- At least one SpawnSphere in PlayerDropPoints.
- info.json defaultSpawnPointName should match an emitted spawn object name.

3. Environment setup
- LevelInfo and ScatterSky (or equivalent environment objects) under sky_and_sun.
- TimeOfDay strongly recommended.

4. Water/vegetation objects
- Optional for bare minimum; recommended for parity with MapNG goals.

Rule:
- Exporter MUST emit TerrainBlock + at least one SpawnSphere.
- Exporter SHOULD emit LevelInfo + ScatterSky + TimeOfDay for stable visuals.

## 7) Forest and Ground Cover Assets

Observed components:
- *.forest.json instance data file (header + instances)
- Forest object pointing to that data file
- Optional per-item definitions in forest/*.forest4.json
- Optional brush definitions in main.forestbrushes4.json

Rule:
- If Forest object is emitted, exporter MUST emit the referenced *.forest.json.
- Exporter SHOULD emit main.forestbrushes4.json even if minimal, for editor/tool compatibility.

## 8) Decals

Observed file:
- main.decals.json with header and instances map.

Rule:
- Exporter MUST emit main.decals.json (empty instances allowed).
- Exporter SHOULD use versioned header compatible with base maps.

## 9) Materials and Art Folder Rules

Observed patterns:
- art/main.materials.json at level root art scope.
- Additional materials files in subpaths (art/terrains, art/road, art/shapes/*).
- Shape and terrain objects reference these materials by mapTo/internalName.

Rule:
- Exporter MUST ensure that every referenced material is resolvable either:
  - locally in generated materials files, or
  - through linked assets/materials paths.
- Exporter SHOULD avoid unresolved mapTo names by generating runtime material defs for chosen biome.

## 10) .link Files (Asset Indirection)

Observed schema:
- JSON object with path
- Optional type field, usually "normal"

Examples:
- { "path": "/assets/materials/...", "type": "normal" }
- { "path": "/assets/materials/..." }
- { "path": "/art/shapes/..." }

Rule:
- Exporter MAY use .link files to avoid duplicating base-game assets.
- Exporter MUST use absolute in-game style paths beginning with /assets, /levels, or /art as appropriate.
- Exporter SHOULD write type: "normal" unless a different type is required and documented.
- Exporter MUST preserve case sensitivity in linked filenames.

Best practice:
- Prefer links for large static textures/meshes that are guaranteed in target game version.
- Prefer local files for generated artifacts (terrain textures, generated meshes, generated materials).

## 11) Naming and Path Consistency Rules

### 11.1 Canonical naming standard for MapNG exports

To keep generated packages predictable and validator-friendly, new MapNG exports use a stricter naming convention than some legacy base maps.

Rule:
- Exporter MUST produce deterministic names from the same input configuration.
- Exporter MUST keep machine IDs stable and URL/path-safe.

### 11.2 levelId and level display name

Rule:
- levelId (folder key) MUST match: ^[a-z0-9_]+$.
- levelId MUST be lowercase.
- levelId MUST be <= 64 characters.
- levelId MUST NOT start with a digit.
- level display name MAY contain spaces and mixed case, but MUST be sanitized to levelId for paths.

Recommended sanitization:
- Transliterate to ASCII where possible.
- Replace non [a-z0-9] with underscore.
- Collapse repeated underscores.
- Trim leading/trailing underscores.
- Prefix with "mapng_" if first char is numeric after sanitization.

### 11.3 File naming conventions

Canonical filenames for generated levels:
- terrain binary: theTerrain.ter
- terrain manifest: theTerrain.terrain.json
- terrain preview image (if emitted): theTerrain.terrainheightmap.png
- forest data: <levelId>.forest.json
- decals: main.decals.json
- forest brushes: main.forestbrushes4.json
- scene root: main/items.level.json
- mission registry: main/MissionGroup/items.level.json

Rule:
- Exporter SHOULD use the canonical names above unless a documented compatibility reason requires alternatives.
- If a non-canonical terrain base name is used, TerrainBlock + *.terrain.json datafile + physical file MUST all match exactly.

### 11.4 Scene group and object names

Rule:
- Group names used as folder names under main/MissionGroup MUST be treated as case-sensitive identifiers.
- Exporter SHOULD use a stable baseline group set and avoid case-only churn between exports.

Canonical group names for MapNG-generated scenes:
- sky_and_sun
- level_objects
- PlayerDropPoints
- AIWaypointsGroup
- AIDecalWaypointsGroup
- Water
- vegetation

Canonical object names:
- MissionGroup root SimGroup: MissionGroup
- TerrainBlock: theTerrain
- LevelInfo: theLevelInfo
- TimeOfDay: tod
- primary water plane: ocean
- Forest object (if emitted): theForest
- default spawn object prefix: spawn_

### 11.5 Spawn naming convention

Rule:
- SpawnSphere name MUST match: ^spawn_[a-z0-9_]+$.
- info.json defaultSpawnPointName MUST equal one emitted SpawnSphere name.
- info.json spawnPoints[].objectname values MUST reference existing SpawnSphere names.

### 11.6 Internal IDs and keys

Rule:
- persistentId values MUST be UUID-like unique identifiers per object record.
- Internal material names and mapTo names SHOULD be stable across exports for the same biome profile.
- map.json segment keys SHOULD be lowercase snake_case and deterministic when generated.

### 11.7 Path formatting

Rule:
- level-local file paths in generated files SHOULD use /levels/<levelId>/... absolute game paths where supported.
- .link target paths MUST be absolute game paths (/assets, /levels, or /art roots).
- All paths MUST use forward slashes.
- Exporter MUST preserve case sensitivity in path strings.

### 11.8 Naming consistency contract

Rule:
- levelId folder name, info metadata references, and all in-file paths MUST be internally consistent.
- Terrain filename in TerrainBlock terrainFile and *.terrain.json datafile MUST point to the same .ter.
- Forest data file path in Forest object MUST point to an existing *.forest.json.

## 12) Optional Gameplay Content (Not Required for MVP Export)

Large shipped maps include extra folders not required for a basic playable level:
- quickrace/
- scenarios/
- facilities/
- buslines/
- crawls/
- driftSpots/
- perfRecordingCampaths/
- minimap/
- dynamicAudioEmitters/

Rule:
- Exporter MAY omit gameplay-pack content in MVP exports.
- Exporter SHOULD not emit placeholder files for systems it does not support.

## 13) Recommended Export Profiles

### 13.1 Minimum Viable Playable Profile

Required outputs:
- info.json
- map.json (segments can be empty)
- .ter + .terrain.json
- main.decals.json
- main.forestbrushes4.json (can be minimal)
- main/items.level.json
- main/MissionGroup/items.level.json
- child group files for at least:
  - sky_and_sun
  - level_objects
  - PlayerDropPoints
- TerrainBlock + one SpawnSphere

### 13.2 Production-Ready Profile

Adds:
- vegetation + Forest data + GroundCover
- Water objects
- AI waypoint groups and map segments
- richer material catalogs and targeted .link usage
- optional minimap and spawn preview assets

## 14) Validation Checklist (For Phase 2 Automation)

1. Path integrity
- Every scene/material/link path resolves to existing local or linked target.

2. Terrain integrity
- TerrainBlock terrainFile exists.
- *.terrain.json datafile matches actual .ter.
- materials list non-empty.

3. Scene integrity
- MissionGroup exists.
- all declared subgroups have corresponding files.
- at least one SpawnSphere exists and defaultSpawnPointName resolves.

4. Metadata integrity
- info.json required fields exist.
- previews listed in info.json exist when declared.

5. Forest/decal integrity
- Forest data file exists when Forest object exists.
- main.decals.json readable and versioned.

6. Link integrity
- each .link is valid JSON and has path.
- linked target path format is valid and case-correct.

7. Naming integrity
- levelId matches naming regex and length limits.
- canonical required filenames exist (or explicitly documented overrides).
- SpawnSphere names match spawn_ convention and metadata references resolve.
- MissionGroup child group names exactly match folder names (case-sensitive).
- persistentId fields are present for required object classes and are unique within each file.

## 15) Implementation Guidance for MapNG (Phase 2)

- Use template scene organization as primary blueprint.
- Keep exported package compact:
  - generated data local
  - stable base assets via .link
- Avoid relying on legacy main.level.json.
- Prefer deterministic naming:
  - level root: levels/<levelId>/
  - terrain: theTerrain.ter + theTerrain.terrain.json unless a deliberate variant is required
- Keep one source of truth for biome-specific assets/materials and derive all references from it.

## 16) Known Variations and Non-Blocking Differences

- Terrain filenames vary by map (theTerrain, theTerrain2, west_coast_usa, italy).
- Group names differ in case and wording (level_objects vs LevelObjects).
- Some maps include both old/new auxiliary files; not all are required for loading.
- Some files in base content include permissive JSON style details; exporter should emit clean strict JSON where possible.

---

This ruleset is the Phase 1 contract. Phase 2 should implement exporter behavior to satisfy these MUST/SHOULD requirements and add automated validation checks.
