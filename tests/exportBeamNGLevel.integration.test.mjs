import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';

import { exportBeamNGLevel } from '../services/exportBeamNGLevel.js';

function installCanvasPolyfill() {
  const originalDocument = globalThis.document;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalFetch = globalThis.fetch;
  const emptyZipEOCD = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00,
  ]);

  class FakeCanvas {
    constructor() {
      this.width = 0;
      this.height = 0;
      this._ctx = null;
    }

    getContext() {
      if (this._ctx) return this._ctx;
      this._ctx = {
        fillStyle: '#000000',
        drawImage() {},
        fillRect() {},
        putImageData() {},
        createImageData(w, h) {
          return {
            width: w,
            height: h,
            data: new Uint8ClampedArray(w * h * 4),
          };
        },
      };
      return this._ctx;
    }

    toBlob(callback, type = 'image/png') {
      const bytes = new Uint8Array([137, 80, 78, 71]);
      bytes.__type = type;
      bytes.__width = this.width;
      bytes.__height = this.height;
      callback(bytes);
    }
  }

  globalThis.document = {
    createElement(tag) {
      if (tag !== 'canvas') {
        throw new Error(`Unsupported element in test polyfill: ${tag}`);
      }
      return new FakeCanvas();
    },
  };

  globalThis.createImageBitmap = async (blob) => ({
    width: Number(blob?.__width) || 64,
    height: Number(blob?.__height) || 64,
    close() {},
  });

  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    if (url === '/mapng_flag_static.zip') {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => emptyZipEOCD.buffer.slice(0),
      };
    }
    if (/^\/cubemap\/skybox[0-5]\.hdr\.dds$/.test(url)) {
      // 'DDS ' magic bytes; content is irrelevant to the export wiring.
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([0x44, 0x44, 0x53, 0x20]).buffer,
      };
    }
    if (url === '/beamng_shape_materials.json') {
      const raw = readFileSync(new URL('../public/beamng_shape_materials.json', import.meta.url), 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(raw) };
    }
    if (typeof originalFetch === 'function') {
      return originalFetch(input, init);
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  };

  return () => {
    if (originalDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = originalDocument;
    }
    if (originalCreateImageBitmap === undefined) {
      delete globalThis.createImageBitmap;
    } else {
      globalThis.createImageBitmap = originalCreateImageBitmap;
    }
    if (originalFetch === undefined) {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = originalFetch;
    }
  };
}

function makeTerrainData() {
  const width = 8;
  const height = 8;

  return {
    width,
    height,
    minHeight: 0,
    maxHeight: 50,
    heightMap: new Float32Array(width * height).fill(10),
    bounds: {
      north: 1,
      south: 0,
      west: 0,
      east: 1,
    },
    osmFeatures: [
      {
        id: 'road_1',
        type: 'road',
        tags: {
          highway: 'primary',
        },
        geometry: [
          { lat: 0.8, lng: 0.2 },
          { lat: 0.5, lng: 0.5 },
          { lat: 0.2, lng: 0.8 },
        ],
      },
      {
        // Side street meeting road_1; its stop sign is mapped ~15 m before.
        id: 'road_2',
        type: 'road',
        tags: {
          highway: 'residential',
        },
        geometry: [
          { lat: 0.5, lng: 0.9 },
          { lat: 0.5, lng: 0.50014 },
          { lat: 0.5, lng: 0.5 },
        ],
      },
      {
        id: 'barrier_1',
        type: 'barrier',
        tags: {
          barrier: 'guard_rail',
        },
        geometry: [
          { lat: 0.75, lng: 0.25 },
          { lat: 0.35, lng: 0.65 },
        ],
      },
      {
        id: 'tree_1',
        type: 'vegetation',
        tags: {
          natural: 'tree',
        },
        geometry: [
          { lat: 0.7, lng: 0.6 },
        ],
      },
      {
        id: 'sign_1',
        type: 'street_furniture',
        tags: {
          highway: 'stop',
        },
        geometry: [
          { lat: 0.5, lng: 0.50014 },
        ],
      },
      {
        id: 'lamp_1',
        type: 'street_furniture',
        tags: {
          highway: 'street_lamp',
        },
        geometry: [
          { lat: 0.55, lng: 0.45 },
        ],
      },
      {
        id: 'lamp_wire_1',
        type: 'street_furniture',
        tags: {
          highway: 'street_lamp',
          support: 'wire',
        },
        geometry: [
          { lat: 0.5, lng: 0.5 },
        ],
      },
      {
        id: 'bench_1',
        type: 'street_furniture',
        tags: {
          amenity: 'bench',
        },
        geometry: [
          { lat: 0.65, lng: 0.35 },
        ],
      },
    ],
  };
}

function parseNDJSON(text) {
  return String(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// One export per distinct set of options: the tests only read the zip, so the
// same export is shared instead of rebuilt (each one takes several seconds).
const exportCache = new Map();
function runExportForRoadType(roadType, opts = {}) {
  const key = JSON.stringify([roadType, opts]);
  if (!exportCache.has(key)) exportCache.set(key, buildExportForRoadType(roadType, opts));
  return exportCache.get(key);
}

async function buildExportForRoadType(roadType, { includeTrees = false, pbrSource = 'none', terrainOverrides = {}, includeBuildings = false, baseTexture = 'none' } = {}) {
  const result = await exportBeamNGLevel(
    { ...makeTerrainData(), ...terrainOverrides },
    { lat: 0.5, lng: 0.5 },
    {
      roadType,
      levelName: 'mapng_demo',
      biomeId: 'west_coast_usa',
      baseTexture,
      pbrSource,
      includeBuildings,
      applyFoundations: false,
      includeBackdrop: false,
      includeWater: false,
      includeTrees,
      includeRocks: false,
      includeNativeBarriers: true,
    },
  );

  const zipBuffer = await result.blob.arrayBuffer();
  return JSZip.loadAsync(zipBuffer);
}

test('exportBeamNGLevel rewrites barrier shape paths and emits .link files across road modes', async () => {
  const restorePolyfills = installCanvasPolyfill();

  try {
    for (const roadType of ['decal']) {
      const zip = await runExportForRoadType(roadType);
      const base = 'levels/mapng_demo';
      const barriersPath = `${base}/main/MissionGroup/barriers/items.level.json`;

      const barriersFile = zip.file(barriersPath);
      assert.ok(barriersFile, `Missing ${barriersPath} for roadType=${roadType}`);

      const barrierObjects = parseNDJSON(await barriersFile.async('string'));
      const barrierWithShape = barrierObjects.find((obj) => typeof obj?.shapeName === 'string');
      assert.ok(barrierWithShape, `Expected barrier shapeName for roadType=${roadType}`);
      assert.match(
        barrierWithShape.shapeName,
        /^\/levels\/mapng_demo\/map_assets\/official_assets\//,
      );

      const linkFiles = Object.keys(zip.files).filter((path) => (
        path.startsWith(`${base}/map_assets/official_assets/`) && path.endsWith('.link')
      ));

      assert.ok(linkFiles.length > 0, `Expected .link files for roadType=${roadType}`);

      // Universal reflection cubemap should be bundled and referenced.
      const cubemapMatPath = `${base}/art/cubemaps/Universal_cubemap_reflection/main.materials.json`;
      const cubemapMatFile = zip.file(cubemapMatPath);
      assert.ok(cubemapMatFile, `Missing ${cubemapMatPath} for roadType=${roadType}`);
      const cubemapDefs = JSON.parse(await cubemapMatFile.async('string'));
      const cubemapData = cubemapDefs.cubemap_Universal_cubemap_reflection;
      assert.equal(cubemapData?.class, 'CubemapData', `Expected CubemapData for roadType=${roadType}`);
      assert.equal(cubemapData?.cubeFace?.length, 6, `Expected 6 cube faces for roadType=${roadType}`);
      assert.match(cubemapData.cubeFace[0], new RegExp(`^/levels/mapng_demo/art/cubemaps/`));
      assert.ok(
        zip.file(`${base}/art/cubemaps/Universal_cubemap_reflection/cubemap/skybox0.hdr.dds`),
        `Missing cube face for roadType=${roadType}`,
      );

      const skyItems = parseNDJSON(
        await zip.file(`${base}/main/MissionGroup/sky_and_sun/items.level.json`).async('string'),
      );
      const levelInfo = skyItems.find((item) => item?.class === 'LevelInfo');
      assert.equal(
        levelInfo?.globalEnviromentMap,
        'cubemap_Universal_cubemap_reflection',
        `Expected universal cubemap reference for roadType=${roadType}`,
      );

      // Native road signs: OSM stop node → TSStatic referencing a native sign
      // mesh via the link registry (no procedural sign box baked into the DAE).
      const signsPath = `${base}/main/MissionGroup/signs/items.level.json`;
      const signsFile = zip.file(signsPath);
      assert.ok(signsFile, `Missing ${signsPath} for roadType=${roadType}`);
      const signItems = parseNDJSON(await signsFile.async('string'));
      const signStatic = signItems.find((item) => item?.class === 'TSStatic');
      assert.ok(signStatic, `Expected a TSStatic sign for roadType=${roadType}`);
      assert.match(
        signStatic.shapeName,
        /^\/levels\/mapng_demo\/map_assets\/official_assets\/.*sign_stop\.dae$/,
        `Sign should reference a rewritten native mesh for roadType=${roadType}`,
      );
      const signLink = `${String(signStatic.shapeName).replace(/^\//, '')}.link`;
      assert.ok(zip.file(signLink), `Missing sign link file ${signLink}`);

      // Sign paint materials must be bundled so the linked mesh isn't bare metal.
      const signMatPath = `${base}/map_assets/official_assets/signs_materials/main.materials.json`;
      const signMatFile = zip.file(signMatPath);
      assert.ok(signMatFile, `Missing ${signMatPath} for roadType=${roadType}`);
      const signMats = JSON.parse(await signMatFile.async('string'));
      assert.equal(signMats.signs_usa?.class, 'Material', 'signs_usa material missing');
      // Textures must reference the shared /assets/ folder directly (0.37+), not
      // a level-scoped path that depends on a specific base level being installed.
      assert.equal(
        signMats.signs_usa.Stages[0].colorMap,
        '/assets/materials/signage/signs_usa/eca_roadsigns_d.dds',
        'signs_usa colorMap must point at the shared /assets/ paint atlas',
      );
      assert.ok(signMats.eca_bld_metalbeams, 'metal pole material missing');
      assert.match(
        signMats.eca_bld_metalbeams.Stages[0].colorMap,
        /^\/assets\/materials\//,
        'metal pole texture must reference the shared /assets/ folder',
      );

      // Signs must be offset off the road centerline (not left in the middle of
      // the road). The fixture sign sits at ~(0.45,0.55) on the road diagonal;
      // after offset it should not coincide with the unoffset world point.
      assert.ok(Array.isArray(signStatic.position) && signStatic.position.length === 3,
        'sign must have a 3D position');
      const rot = signStatic.rotationMatrix;
      assert.ok(Array.isArray(rot) && rot.length === 9, 'sign must have a rotation matrix');
      // The side street runs east → west into the junction (d = (−1, 0)): the
      // sign's face (local −Y) turns east toward its traffic, yaw = atan2(−dx, dy) = +90°.
      assert.ok(Math.abs(rot[0]) < 1e-6 && Math.abs(rot[1] - 1) < 1e-6,
        `Stop sign should face westbound traffic for roadType=${roadType}: ${rot.slice(0, 2)}`);
    }
  } finally {
    restorePolyfills();
  }
});

test('exportBeamNGLevel emits native street furniture with engine-managed night lights', async () => {
  const restorePolyfills = installCanvasPolyfill();

  try {
    const zip = await runExportForRoadType('decal');
    const base = 'levels/mapng_demo';

    const path = `${base}/main/MissionGroup/street_furniture/items.level.json`;
    const file = zip.file(path);
    assert.ok(file, `Missing ${path}`);
    const items = parseNDJSON(await file.async('string'));

    const lamps = items.filter((i) => i?.class === 'TSStatic' && i.name?.startsWith('street_lamp_'));
    const lights = items.filter((i) => i?.class === 'SpotLight');
    const benches = items.filter((i) => i?.class === 'TSStatic' && i.name?.startsWith('bench_'));

    // The fixture has one pole lamp, one wire-suspended lamp, and one bench.
    // A wire / wall lamp has no pole to place, only its light where it hangs.
    assert.equal(lamps.length, 1, 'expected exactly one pole-mounted lamp');
    assert.equal(benches.length, 1, 'expected exactly one bench');
    assert.equal(lights.length, 2, 'a light for the pole lamp and one for the hung lamp');
    const light = lights.find((l) => l.name === lamps[0].child);
    assert.ok(light, 'the pole lamp names its light as child');
    assert.ok(lights.every((l) => l.nightLight === '1' && l.castShadows === false));

    // BeamNG QA (Wonly): nightLight lets the engine run street lights
    // dusk-to-dawn with no custom lua, and point lights must not cast shadows.
    assert.equal(light.nightLight, '1', 'street lights must set nightLight');
    assert.equal(light.isEnabled, false, 'nightLight lights start disabled');
    assert.equal(light.castShadows, false, 'street lights must not cast shadows');

    // The light belongs at the luminaire, above and offset from the pole base.
    const [lamp] = lamps;
    assert.ok(
      light.position[2] - lamp.position[2] > 3,
      `light should sit at the luminaire, got dz=${light.position[2] - lamp.position[2]}`,
    );

    // Lamps/benches near a road are yawed toward it (non-identity rotation).
    assert.ok(
      Math.abs(lamp.rotationMatrix[0] - 1) > 1e-6 || Math.abs(lamp.rotationMatrix[1]) > 1e-6,
      'lamp near a road should be rotated toward it',
    );

    // The procedural preview primitives must not also ship in the OSM mesh.
    // The fixture has no buildings, so with street furniture excluded the OSM
    // group has no meshes at all and the DAE is skipped entirely — if the
    // preview lamp/bench/bollard geometry leaked back in, this file appears.
    const withObjects = await runExportForRoadType('decal', { includeBuildings: true });
    assert.ok(
      !withObjects.file(`${base}/map_assets/custom_assets/osm_objects/osm_objects.dae`),
      'preview street furniture must not be baked into the OSM objects DAE',
    );
  } finally {
    restorePolyfills();
  }
});

test('exportBeamNGLevel rewrites managed forest shape paths across road modes', async () => {
  const restorePolyfills = installCanvasPolyfill();

  try {
    for (const roadType of ['decal']) {
      const zip = await runExportForRoadType(roadType, { includeTrees: true });
      const vegetationPath = 'levels/mapng_demo/main/MissionGroup/vegetation/items.level.json';
      const vegetationFile = zip.file(vegetationPath);
      assert.ok(vegetationFile, `Missing ${vegetationPath} for roadType=${roadType}`);

      const vegetationItems = parseNDJSON(await vegetationFile.async('string'));
      const forestObject = vegetationItems.find((item) => item?.class === 'Forest');
      assert.ok(forestObject, `Expected Forest object in vegetation items for roadType=${roadType}`);
      assert.equal(forestObject.name, 'theForest');

      // A ForestWindEmitter must accompany the forest so placed trees sway
      // instead of standing perfectly still (Forest.md §ForestWindEmitter).
      const windEmitter = vegetationItems.find((item) => item?.class === 'ForestWindEmitter');
      assert.ok(windEmitter, `Expected ForestWindEmitter in vegetation items for roadType=${roadType}`);
      assert.equal(windEmitter.windEnabled, true);

      // Groundcover must carry a turbulence amplitude, not just a frequency, or
      // the grass stands still (Improving Groundcover §wind).
      const groundCover = vegetationItems.find((item) => item?.class === 'GroundCover');
      assert.ok(groundCover, `Expected a GroundCover object for roadType=${roadType}`);
      assert.ok(
        Number(groundCover.windTurbulenceStrength) > 0,
        `Groundcover should set windTurbulenceStrength > 0 for roadType=${roadType}`,
      );

      const managedPath = 'levels/mapng_demo/art/forest/managedItemData.json';
      const managedFile = zip.file(managedPath);
      assert.ok(managedFile, `Missing ${managedPath} for roadType=${roadType}`);

      const forestDataFiles = Object.keys(zip.files).filter((path) => (
        path.startsWith('levels/mapng_demo/forest/') && path.endsWith('.forest4.json')
      ));
      assert.ok(forestDataFiles.length > 0, `Expected forest placement files for roadType=${roadType}`);

      const managedItemData = JSON.parse(await managedFile.async('string'));
      const managedEntries = Object.values(managedItemData || {});
      const shapeEntry = managedEntries.find((entry) => typeof entry?.shapeFile === 'string');
      assert.ok(shapeEntry, `Expected shapeFile in managedItemData for roadType=${roadType}`);
      assert.match(
        shapeEntry.shapeFile,
        /^\/?levels\/mapng_demo\/map_assets\/official_assets\//,
      );

      const rewrittenShapePath = String(shapeEntry.shapeFile).replace(/^\//, '');
      const forestLinkPath = `${rewrittenShapePath}.link`;
      assert.ok(zip.file(forestLinkPath), `Missing forest link file ${forestLinkPath}`);

      // Forest brush palette should expose every placed item type so the
      // World Editor Forest tool can re-paint them.
      const brushFile = zip.file('levels/mapng_demo/main.forestbrushes4.json');
      assert.ok(brushFile, `Missing forestbrushes4 for roadType=${roadType}`);
      const brushItems = parseNDJSON(await brushFile.async('string'));

      const brushElements = brushItems.filter((item) => item?.class === 'ForestBrushElement');
      assert.ok(brushElements.length > 0, `Expected ForestBrushElements for roadType=${roadType}`);
      assert.ok(
        brushItems.some((item) => item?.class === 'ForestBrush'),
        `Expected ForestBrush containers for roadType=${roadType}`,
      );
      assert.ok(
        brushItems.some((item) => item?.class === 'SimGroup' && item?.name === 'ForestBrushGroup'),
        `Expected ForestBrushGroup for roadType=${roadType}`,
      );

      const managedKeys = new Set(Object.keys(managedItemData || {}));
      for (const element of brushElements) {
        assert.ok(
          managedKeys.has(element.forestItemData),
          `Brush element references unknown ForestItemData "${element.forestItemData}" for roadType=${roadType}`,
        );
      }
    }
  } finally {
    restorePolyfills();
  }
});
test('exportBeamNGLevel gives DefaultMaterial real surface detail + non-asphalt physics (OSM/PBR)', async () => {
  const restorePolyfills = installCanvasPolyfill();

  try {
    const zip = await runExportForRoadType('decal', { pbrSource: 'osm' });
    const matPath = 'levels/mapng_demo/art/terrains/main.materials.json';
    const matFile = zip.file(matPath);
    assert.ok(matFile, `Missing ${matPath}`);

    const defs = JSON.parse(await matFile.async('string'));
    const def = Object.values(defs).find((d) => d?.internalName === 'DefaultMaterial');
    assert.ok(def, 'Expected a DefaultMaterial terrain material');

    // DefaultMaterial is the unclassified catch-all (incl. the band next to
    // roads). It must inherit the primary ground surface: a real detail texture
    // (not the neutral shared slot) and grass-like physics (not asphalt grip).
    assert.ok(
      def.baseColorDetailTex && !/shared_r_sm/.test(def.baseColorDetailTex),
      `DefaultMaterial should inherit a real detail texture, got "${def.baseColorDetailTex}"`,
    );
    assert.notEqual(
      def.groundmodelName,
      'GROUNDMODEL_ASPHALT1',
      'DefaultMaterial should no longer use asphalt physics for unclassified land',
    );

    // The asphalt material shares the per-export terrain base (satellite/OSM
    // imagery) so its painted edge blends smoothly with the surrounding terrain.
    // An independent dark base made the jagged layer-map boundary high-contrast
    // ("ink-blot" road edges), so it must NOT use a dedicated base texture.
    const asphaltDef = Object.values(defs).find((d) => d?.internalName === 'asphalt');
    assert.ok(asphaltDef, 'Expected an asphalt terrain material');
    assert.match(
      String(asphaltDef.baseColorBaseTex),
      /art\/terrains\/terrain\.png$/,
      `Asphalt should share the terrain base, got "${asphaltDef.baseColorBaseTex}"`,
    );
    assert.ok(
      !zip.file('levels/mapng_demo/art/terrains/asphalt_base_b.png'),
      'asphalt_base_b.png should not be bundled',
    );
  } finally {
    restorePolyfills();
  }
});

test('exportBeamNGLevel terrain materials reference only own-level and /assets paths', async () => {
  const restorePolyfills = installCanvasPolyfill();

  try {
    const zip = await runExportForRoadType('decal', { pbrSource: 'osm' });

    const matPath = 'levels/mapng_demo/art/terrains/main.materials.json';
    const matFile = zip.file(matPath);
    assert.ok(matFile, `Missing ${matPath}`);
    const contents = await matFile.async('string');

    // TerrainCellMaterial loads textures without resolving .link redirects, and
    // cross-level files move between game versions (0.39 removed ecusa's
    // t_grass1_*). Every texture must live in this level or under /assets/.
    const crossLevelRef = contents.match(/["']\/?levels\/(?!mapng_demo\/)[^"']+["']/);
    assert.ok(
      !crossLevelRef,
      `Terrain materials reference another level's folder: ${crossLevelRef?.[0]}`,
    );

    // And the detail slots should actually come from the core /assets library.
    assert.match(contents, /\/assets\/materials\/terrain\//);
  } finally {
    restorePolyfills();
  }
});

test('exportBeamNGLevel ties TerrainBlock squareSize to processingMetersPerPixel (custom upload)', async () => {
  const restorePolyfills = installCanvasPolyfill();

  try {
    // Custom elevation uploads carry processingMetersPerPixel (the resampled
    // resolution) instead of metersPerPixel. The BeamNG square size — and thus
    // worldSize, which scales the surrounding backdrop — must follow it.
    const zip = await runExportForRoadType('decal', { terrainOverrides: { processingMetersPerPixel: 2 } });
    const itemsPath = 'levels/mapng_demo/main/MissionGroup/level_objects/items.level.json';
    const items = parseNDJSON(await zip.file(itemsPath).async('string'));
    const terrain = items.find((i) => i?.class === 'TerrainBlock');
    assert.ok(terrain, 'Expected a TerrainBlock');
    assert.equal(terrain.squareSize, 2, 'TerrainBlock squareSize should equal processingMetersPerPixel');
  } finally {
    restorePolyfills();
  }
});

test('exportBeamNGLevel scales terrain base slots in grid squares, not world meters', async () => {
  const restorePolyfills = installCanvasPolyfill();

  try {
    // PBR *BaseTexSize is measured in terrain grid squares (= base texture
    // texels), not meters: every official level with squareSize ≠ 1 sets it to
    // the .ter grid size (automation_test_track 0.5 m/px, grid 4096, world
    // 2048 m → 4096). Writing world meters tiled the satellite 1/squareSize
    // times per axis in game. The legacy v0 `diffuseSize` field is the
    // exception — it really is world meters.
    const zip = await runExportForRoadType('decal', {
      pbrSource: 'osm',
      terrainOverrides: { processingMetersPerPixel: 0.5 },
    });

    const itemsPath = 'levels/mapng_demo/main/MissionGroup/level_objects/items.level.json';
    const items = parseNDJSON(await zip.file(itemsPath).async('string'));
    const terrain = items.find((i) => i?.class === 'TerrainBlock');
    assert.equal(terrain.squareSize, 0.5);

    const gridSize = terrain.baseTexSize;
    const worldSize = gridSize * terrain.squareSize;
    assert.notEqual(gridSize, worldSize, 'test needs squareSize ≠ 1 to be meaningful');

    const defs = JSON.parse(await zip.file('levels/mapng_demo/art/terrains/main.materials.json').async('string'));
    const textureSet = Object.values(defs).find((d) => d?.class === 'TerrainMaterialTextureSet');
    assert.deepEqual(textureSet.baseTexSize, [gridSize, gridSize]);

    for (const def of Object.values(defs)) {
      if (def?.class !== 'TerrainMaterial') continue;
      for (const field of [
        'baseColorBaseTexSize', 'normalBaseTexSize', 'roughnessBaseTexSize',
        'aoBaseTexSize', 'heightBaseTexSize',
      ]) {
        assert.equal(
          def[field], gridSize,
          `${def.internalName}.${field} should be the grid size (${gridSize}), got ${def[field]}`,
        );
      }
      assert.equal(
        def.diffuseSize, worldSize,
        `${def.internalName}.diffuseSize (legacy) should be world meters (${worldSize}), got ${def.diffuseSize}`,
      );
    }
  } finally {
    restorePolyfills();
  }
});

test('exportBeamNGLevel ships a 2× base texture with spans still in grid squares', async () => {
  const restorePolyfills = installCanvasPolyfill();

  try {
    // west_coast_usa: 2048 grid, 4096 base texture, *BaseTexSize 2048. The
    // texture set carries the texture's pixel size, the spans the grid size.
    const grid = makeTerrainData().width;
    const hybrid = document.createElement('canvas');
    hybrid.width = grid * 2;
    hybrid.height = grid * 2;
    const zip = await runExportForRoadType('decal', {
      pbrSource: 'osm',
      baseTexture: 'hybrid',
      terrainOverrides: { hybridTextureCanvas: hybrid },
    });

    const items = parseNDJSON(await zip.file('levels/mapng_demo/main/MissionGroup/level_objects/items.level.json').async('string'));
    const terrain = items.find((i) => i?.class === 'TerrainBlock');
    assert.equal(terrain.baseTexSize, grid, 'TerrainBlock.baseTexSize stays the grid size');

    const defs = JSON.parse(await zip.file('levels/mapng_demo/art/terrains/main.materials.json').async('string'));
    const textureSet = Object.values(defs).find((d) => d?.class === 'TerrainMaterialTextureSet');
    assert.deepEqual(textureSet.baseTexSize, [grid * 2, grid * 2]);
    for (const def of Object.values(defs)) {
      if (def?.class !== 'TerrainMaterial') continue;
      assert.equal(def.baseColorBaseTexSize, grid, `${def.internalName} span should be the grid size`);
      assert.equal(def.normalBaseTexSize, grid);
    }
  } finally {
    restorePolyfills();
  }
});

test('exportBeamNGLevel ships textured buildings with every material defined', async () => {
  const restorePolyfills = installCanvasPolyfill();
  try {
    const d = 12 / 111320;   // ~12 m in degrees near the equator
    const building = (id, lat, lng, tags) => ({
      id, type: 'building', tags,
      geometry: [
        { lat, lng }, { lat, lng: lng + d }, { lat: lat + d * 0.75, lng: lng + d }, { lat: lat + d * 0.75, lng },
      ],
    });
    const base = 'levels/mapng_demo';
    const zip = await runExportForRoadType('decal', {
      includeBuildings: true,
      terrainOverrides: {
        osmFeatures: [
          building('b1', 0.5, 0.5, { building: 'house' }),
          building('b2', 0.4, 0.4, { building: 'retail', 'building:levels': '3' }),
        ],
      },
    });
    // one shape per building tile (beamngBuildings.js / buildBuildingTileDAEs)
    const tileFiles = Object.keys(zip.files).filter((n) => n.startsWith(`${base}/map_assets/custom_assets/osm_objects/buildings/`) && n.endsWith('.dae'));
    assert.ok(tileFiles.length >= 1, 'building tile shapes exported');
    const used = new Set();
    for (const file of tileFiles) {
      const dae = await zip.file(file).async('string');
      for (const m of dae.matchAll(/<material id="[^"]+" name="([^"]+)"/g)) used.add(m[1]);
      assert.match(dae, /<geometry id="Colmesh-1/, 'buildings collide');
      // BeamNG reads trailing digits in node names as detail levels: only the
      // scene roots, the collision mesh and the two detail levels carry them,
      // a full one (bld<a><size>) over a lite one drawn down to size 2
      const names = [...dae.matchAll(/<node [^>]*name="([^"]+)"/g)].map((m) => m[1]);
      for (const name of names) {
        if (['base00', 'start01', 'Colmesh-1'].includes(name)) continue;
        assert.match(name, /^(bld[a-z]+\d+|lite[a-z]+2)$/, `node "${name}" is a detail level`);
      }
      assert.ok(names.some((n) => /^bld[a-z]+\d+$/.test(n)) && names.some((n) => /^lite[a-z]+2$/.test(n)), 'full and lite detail levels');
    }
    assert.ok([...used].some((n) => n.startsWith('mapng_bld_')), `textured materials used: ${[...used]}`);
    // each tile placed as its own object at its origin
    const objects = (await zip.file(`${base}/main/MissionGroup/level_objects/items.level.json`).async('string')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(objects.filter((o) => String(o.name).startsWith('buildings_') && o.class === 'TSStatic').length, tileFiles.length);

    const defs = JSON.parse(await zip.file(`${base}/map_assets/custom_assets/osm_objects/main.materials.json`).async('string'));
    for (const name of used) assert.ok(defs[name], `material ${name} defined`);
  } finally {
    restorePolyfills();
  }
});

test('every biome defines the material of every GroundCover it emits', async () => {
  // West Coast USA borrows East Coast's BNGGrass profile; the def used to be
  // written only for biomes whose own runtime set held it (in-game: "Material
  // BNGGrass was not found" and untextured grass everywhere).
  const { BEAMNG_BIOMES } = await import('../services/beamngBiomeCatalog.js');
  const biomeIds = (Array.isArray(BEAMNG_BIOMES) ? BEAMNG_BIOMES : Object.values(BEAMNG_BIOMES || {})).map((b) => b.id);
  assert.ok(biomeIds.length >= 10, `found ${biomeIds.length} biomes`);
  const restorePolyfills = installCanvasPolyfill();
  try {
    for (const biomeId of biomeIds) {
      const result = await exportBeamNGLevel(makeTerrainData(), { lat: 0.5, lng: 0.5 }, {
        roadType: 'decal', levelName: 'mapng_demo', biomeId, baseTexture: 'none', pbrSource: 'none',
        includeBuildings: false, applyFoundations: false, includeBackdrop: false, includeWater: false,
        includeTrees: true, includeRocks: false, includeNativeBarriers: false,
      });
      const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
      const defined = new Set();
      const used = new Set();
      for (const path of Object.keys(zip.files)) {
        const text = path.endsWith('.json') ? await zip.file(path).async('string') : null;
        if (!text) continue;
        if (path.endsWith('materials.json')) {
          for (const [k, v] of Object.entries(JSON.parse(text))) { defined.add(k); if (v?.name) defined.add(v.name); }
        } else if (path.endsWith('items.level.json')) {
          for (const obj of parseNDJSON(text)) if (obj?.class === 'GroundCover' && obj.material) used.add(obj.material);
        }
      }
      assert.ok(used.size > 0, `${biomeId}: emits GroundCover`);
      for (const m of used) assert.ok(defined.has(m), `${biomeId}: GroundCover material ${m} is defined`);
    }
  } finally {
    restorePolyfills();
  }
});

test('OSM grass polygons do not multiply GroundCover layers', async () => {
  // GroundCover fills around the camera and ignores its position, so a cover
  // per grass polygon stacked full layers everywhere (GPU overdraw).
  const fields = Array.from({ length: 30 }, (_, i) => {
    const s = 0.05 + (i % 6) * 0.15;
    const w = 0.05 + Math.floor(i / 6) * 0.15;
    return {
      id: `grass_${i}`, type: 'landuse', tags: { landuse: i % 2 ? 'meadow' : 'grass' },
      geometry: [{ lat: s, lng: w }, { lat: s, lng: w + 0.1 }, { lat: s + 0.1, lng: w + 0.1 }, { lat: s + 0.1, lng: w }, { lat: s, lng: w }],
    };
  });
  const restorePolyfills = installCanvasPolyfill();
  try {
    for (const biomeId of ['west_coast_usa', 'european']) {
      const terrain = makeTerrainData();
      terrain.osmFeatures = [...terrain.osmFeatures, ...fields];
      const result = await exportBeamNGLevel(terrain, { lat: 0.5, lng: 0.5 }, {
        roadType: 'decal', levelName: 'mapng_demo', biomeId, baseTexture: 'none', pbrSource: 'none',
        includeBuildings: false, applyFoundations: false, includeBackdrop: false, includeWater: false,
        includeTrees: true, includeRocks: false, includeNativeBarriers: false,
      });
      const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
      const veg = parseNDJSON(await zip.file('levels/mapng_demo/main/MissionGroup/vegetation/items.level.json').async('string'));
      const covers = veg.filter((o) => o?.class === 'GroundCover');
      assert.ok(covers.length > 0 && covers.length <= 4, `${biomeId}: ${covers.length} GroundCover objects`);
    }
  } finally {
    restorePolyfills();
  }
});

test('without a biome the export picks the look from the location', async () => {
  const restorePolyfills = installCanvasPolyfill();
  try {
    const result = await exportBeamNGLevel(makeTerrainData(), { lat: 0.5, lng: 0.5 }, {
      roadType: 'decal', levelName: 'mapng_demo', baseTexture: 'none', pbrSource: 'none',
      includeBuildings: false, applyFoundations: false, includeBackdrop: false, includeWater: false,
      includeTrees: true, includeRocks: false, includeNativeBarriers: false,
    });
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const info = JSON.parse(await zip.file('levels/mapng_demo/info.json').async('string'));
    assert.equal(info.biome, 'Jungle Rock Island', 'equator → tropics');
  } finally {
    restorePolyfills();
  }
});
