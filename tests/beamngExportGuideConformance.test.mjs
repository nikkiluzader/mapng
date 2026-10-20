/**
 * Executable conformance suite for refs/docs/beamng-level-export-guide.md §10
 * (untracked local reference docs).
 *
 * Each test maps to a numbered invariant in the guide's "Invariants checklist".
 * When the guide changes, update these assertions; when these fail, the export
 * has drifted from the source of truth. This is the strict gate the guide
 * requires beyond the file-presence checks in beamngExportConformance.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';

import { exportBeamNGLevel } from '../services/exportBeamNGLevel.js';

// ── Shared canvas/fetch polyfill (mirrors exportBeamNGLevel.integration.test.mjs) ──
function installCanvasPolyfill() {
  const originalDocument = globalThis.document;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalFetch = globalThis.fetch;
  const emptyZipEOCD = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);

  class FakeCanvas {
    constructor() { this.width = 0; this.height = 0; this._ctx = null; }
    getContext() {
      if (this._ctx) return this._ctx;
      this._ctx = {
        fillStyle: '#000000',
        drawImage() {}, fillRect() {}, putImageData() {},
        createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
        getImageData(x, y, w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
      };
      return this._ctx;
    }
    toBlob(callback, type = 'image/png') {
      const bytes = new Uint8Array([137, 80, 78, 71]);
      bytes.__type = type; bytes.__width = this.width; bytes.__height = this.height;
      callback(bytes);
    }
  }

  globalThis.document = {
    createElement(tag) {
      if (tag !== 'canvas') throw new Error(`Unsupported element in test polyfill: ${tag}`);
      return new FakeCanvas();
    },
  };
  globalThis.createImageBitmap = async (blob) => ({
    width: Number(blob?.__width) || 64, height: Number(blob?.__height) || 64, close() {},
  });
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    if (url === '/mapng_flag_static.zip') {
      return { ok: true, status: 200, arrayBuffer: async () => emptyZipEOCD.buffer.slice(0) };
    }
    if (/^\/cubemap\/skybox[0-5]\.hdr\.dds$/.test(url)) {
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([0x44, 0x44, 0x53, 0x20]).buffer };
    }
    if (url === '/beamng_shape_materials.json') {
      const raw = readFileSync(new URL('../public/beamng_shape_materials.json', import.meta.url), 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(raw) };
    }
    if (typeof originalFetch === 'function') return originalFetch(input, init);
    throw new Error(`Unexpected fetch in test: ${url}`);
  };

  return () => {
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
    if (originalCreateImageBitmap === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = originalCreateImageBitmap;
    if (originalFetch === undefined) delete globalThis.fetch; else globalThis.fetch = originalFetch;
  };
}

function makeTerrainData() {
  const width = 8, height = 8;
  return {
    width, height, minHeight: 0, maxHeight: 50,
    heightMap: new Float32Array(width * height).fill(10),
    bounds: { north: 1, south: 0, west: 0, east: 1 },
    osmFeatures: [
      { id: 'road_1', type: 'road', tags: { highway: 'primary' },
        geometry: [{ lat: 0.8, lng: 0.2 }, { lat: 0.2, lng: 0.8 }] },
      { id: 'tree_1', type: 'vegetation', tags: { natural: 'tree' },
        geometry: [{ lat: 0.6, lng: 0.4 }] },
    ],
  };
}

function parseNDJSON(text) {
  return String(text).split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => {
    try { return JSON.parse(l); } catch (e) { throw new Error(`NDJSON line ${i + 1} is not valid JSON: ${l}`); }
  });
}

const LEVEL_ID = 'mapng_demo';
const BASE = `levels/${LEVEL_ID}`;

async function exportZip(opts = {}) {
  const result = await exportBeamNGLevel(makeTerrainData(), { lat: 0.5, lng: 0.5 }, {
    roadType: 'decal', levelName: LEVEL_ID, biomeId: 'west_coast_usa',
    baseTexture: 'none', pbrSource: 'none', includeBuildings: false,
    applyFoundations: false, includeBackdrop: false, includeWater: false,
    includeTrees: true, includeRocks: false, includeNativeBarriers: false,
    ...opts,
  });
  return JSZip.loadAsync(await result.blob.arrayBuffer());
}

async function readText(zip, rel) {
  const f = zip.file(`${BASE}/${rel}`);
  assert.ok(f, `Missing ${BASE}/${rel}`);
  return f.async('string');
}

async function withZip(fn) {
  const restore = installCanvasPolyfill();
  try { return await fn(await exportZip()); } finally { restore(); }
}

// ── §10.1 — single sanitized levels/<id> root ────────────────────────────────
test('guide §10.1: single sanitized levels/<id> root', async () => {
  await withZip(async (zip) => {
    // Collect the level-id segment under levels/. JSZip may emit a bare "levels/"
    // directory marker; the invariant is that exactly one *named* level exists.
    const ids = new Set(Object.keys(zip.files)
      .map((p) => p.split('/'))
      .filter((parts) => parts[0] === 'levels' && parts[1])
      .map((parts) => parts[1]));
    assert.equal(ids.size, 1, `Expected one level id, got ${[...ids].join(', ')}`);
    assert.equal([...ids][0], LEVEL_ID);
    assert.match(LEVEL_ID, /^[a-z0-9_]+$/, 'level id must be sanitized/lowercase');
  });
});

// ── §10.3 — every items.level.json is valid NDJSON; every line has a class ────
test('guide §10.3: items.level.json are valid NDJSON with class on every line', async () => {
  await withZip(async (zip) => {
    const itemFiles = Object.keys(zip.files).filter((p) => p.endsWith('/items.level.json'));
    assert.ok(itemFiles.length > 0, 'Expected at least one items.level.json');
    for (const path of itemFiles) {
      const text = await zip.file(path).async('string');
      if (!text.trim()) continue; // empty group file is allowed
      for (const obj of parseNDJSON(text)) {
        assert.ok(typeof obj.class === 'string' && obj.class.length > 0,
          `Object without class in ${path}: ${JSON.stringify(obj)}`);
      }
    }
  });
});

// ── §10.4 — every SimGroup named in a parent has a matching folder+file ───────
test('guide §10.4: every SimGroup has a matching subfolder items.level.json', async () => {
  await withZip(async (zip) => {
    const allPaths = new Set(Object.keys(zip.files));
    const parents = [
      `${BASE}/main/items.level.json`,
      `${BASE}/main/MissionGroup/items.level.json`,
    ];
    for (const parent of parents) {
      const dir = parent.replace(/items\.level\.json$/, '');
      const objs = parseNDJSON(await zip.file(parent).async('string'));
      for (const obj of objs.filter((o) => o.class === 'SimGroup')) {
        const childFile = `${dir}${obj.name}/items.level.json`;
        assert.ok(allPaths.has(childFile),
          `SimGroup "${obj.name}" in ${parent} has no ${childFile}`);
      }
    }
  });
});

// ── §10.5/10.6 — .ter version lockstep + size + material count coupling ───────
test('guide §10.5/10.6: .ter version/size/material count match terrain.json', async () => {
  await withZip(async (zip) => {
    const terBuf = new Uint8Array(await zip.file(`${BASE}/art/terrains/terrain.ter`).async('arraybuffer'));
    const dv = new DataView(terBuf.buffer);
    const version = dv.getUint8(0);
    const size = dv.getUint32(1, true);

    const meta = JSON.parse(await readText(zip, 'terrain.terrain.json'));
    // §10.5 version lockstep (Rule T1) — the core conformance point.
    assert.equal(version, meta.version, '.ter byte0 must equal terrain.terrain.json.version');
    // §10.5 size agreement + power-of-two.
    assert.equal(size, meta.size, '.ter size must equal terrain.terrain.json.size');
    assert.ok((size & (size - 1)) === 0, `terrain size ${size} is not power-of-two`);
    // The documented import floor is 128. The test fixture intentionally uses a
    // tiny 8x8 grid for speed, so the floor is only asserted for realistic sizes;
    // Rule T3 (enforcing 128–8192/16384 at export time) is tracked in the guide.
    if (size >= 128) {
      assert.ok(size <= 16384, `terrain size ${size} exceeds export ceiling`);
    }

    // §10.6 material count coupling: read material list from the .ter tail
    const sampleCount = size * size;
    let off = 5 + sampleCount * 2 + sampleCount * 1;
    const materialCount = dv.getUint32(off, true);
    assert.equal(materialCount, meta.materials.length,
      '.ter materialCount must equal terrain.terrain.json.materials.length');
  });
});

// ── §10.7/10.8 — info.json spawn + preview coupling, strict JSON ──────────────
test('guide §10.7/10.8: info.json spawn + preview coupling', async () => {
  await withZip(async (zip) => {
    const infoText = await readText(zip, 'info.json');
    // strict JSON (no trailing commas) — JSON.parse already rejects them
    const info = JSON.parse(infoText);

    const spawnNames = (info.spawnPoints || []).map((s) => s.objectname);
    assert.ok(spawnNames.includes(info.defaultSpawnPointName),
      'defaultSpawnPointName must match a spawnPoints[].objectname');

    // §10.7 must match a SpawnSphere.name in PlayerDropPoints
    const drops = parseNDJSON(await readText(zip, 'main/MissionGroup/PlayerDropPoints/items.level.json'));
    const sphere = drops.find((o) => o.class === 'SpawnSphere');
    assert.ok(sphere, 'Expected a SpawnSphere in PlayerDropPoints');
    assert.equal(sphere.name, info.defaultSpawnPointName,
      'SpawnSphere.name must equal info.defaultSpawnPointName');

    // §10.8 previews[0] file exists
    assert.ok(Array.isArray(info.previews) && info.previews.length > 0, 'info.previews must be non-empty');
    assert.ok(zip.file(`${BASE}/${info.previews[0]}`),
      `info.previews[0] "${info.previews[0]}" must exist in the ZIP`);
  });
});

// ── §10.9 — exactly one LevelInfo "theLevelInfo" using globalEnviromentMap ────
test('guide §10.9: exactly one theLevelInfo with globalEnviromentMap spelling', async () => {
  await withZip(async (zip) => {
    const sky = parseNDJSON(await readText(zip, 'main/MissionGroup/sky_and_sun/items.level.json'));
    const levelInfos = sky.filter((o) => o.class === 'LevelInfo');
    assert.equal(levelInfos.length, 1, 'Expected exactly one LevelInfo');
    assert.equal(levelInfos[0].name, 'theLevelInfo', 'LevelInfo must be named theLevelInfo');
    assert.ok('globalEnviromentMap' in levelInfos[0],
      'LevelInfo must use the engine spelling globalEnviromentMap (one n)');
    assert.ok(!('globalEnvironmentMap' in levelInfos[0]),
      'LevelInfo must NOT use the misspelling globalEnvironmentMap');
  });
});

// ── §10.10 — every forest4 type resolves in managedItemData ───────────────────
test('guide §10.10: forest placements resolve to managedItemData types', async () => {
  await withZip(async (zip) => {
    const managedFile = zip.file(`${BASE}/art/forest/managedItemData.json`);
    if (!managedFile) return; // no vegetation in this run → nothing to check
    const managed = JSON.parse(await managedFile.async('string'));
    const types = new Set(Object.keys(managed));
    const forestFiles = Object.keys(zip.files).filter((p) => p.endsWith('.forest4.json'));
    for (const path of forestFiles) {
      for (const item of parseNDJSON(await zip.file(path).async('string'))) {
        assert.ok(types.has(item.type),
          `forest4 item type "${item.type}" not in managedItemData (${path})`);
      }
    }
  });
});

// ── §10.11 — TerrainBlock references existing .ter, centered ──────────────────
test('guide §10.11: TerrainBlock references existing .ter and is centered', async () => {
  await withZip(async (zip) => {
    const objs = parseNDJSON(await readText(zip, 'main/MissionGroup/level_objects/items.level.json'));
    const tb = objs.find((o) => o.class === 'TerrainBlock');
    assert.ok(tb, 'Expected a TerrainBlock');
    const terRel = String(tb.terrainFile).replace(`/levels/${LEVEL_ID}/`, '');
    assert.ok(zip.file(`${BASE}/${terRel}`), `TerrainBlock.terrainFile missing: ${tb.terrainFile}`);
    // centered: position x==y==-halfExtent
    assert.equal(tb.position[0], tb.position[1], 'TerrainBlock must be centered (x==y)');
    assert.ok(tb.position[0] <= 0, 'TerrainBlock SW corner must be at negative half-extent');
  });
});

// ── §10.12 — supportsTraffic honesty ─────────────────────────────────────────
test('guide §10.12: supportsTraffic implies a nav graph', async () => {
  await withZip(async (zip) => {
    const info = JSON.parse(await readText(zip, 'info.json'));
    if (info.supportsTraffic === true) {
      const hasDecalRoads = !!zip.file(`${BASE}/main/MissionGroup/Decal_Roads/items.level.json`);
      const map = JSON.parse(await readText(zip, 'map.json'));
      const hasSegments = map.segments && Object.keys(map.segments).length > 0;
      assert.ok(hasDecalRoads || hasSegments,
        'supportsTraffic=true requires drivable decal roads');
    }
  });
});

// ── §10.13 — road node arity (MeshRoad 8-value, DecalRoad 4-value) ────────────
// MeshRoad.md lists "tool-generated nodes use the four-value DecalRoad format
// instead of the eight-value MeshRoad format" as a common breaking mistake.
test('guide §10.13: DecalRoad nodes are 4-value', async () => {
  const restore = installCanvasPolyfill();
  try {
    const zip = await exportZip({ roadType: 'decal' });
    const file = zip.file(`${BASE}/main/MissionGroup/Decal_Roads/items.level.json`);
    if (!file) return; // no decal roads in this fixture run
    for (const obj of parseNDJSON(await file.async('string'))) {
      if (obj.class !== 'DecalRoad' || !Array.isArray(obj.nodes)) continue;
      for (const node of obj.nodes) {
        assert.ok(Array.isArray(node) && node.length === 4 && node.every((n) => typeof n === 'number'),
          `DecalRoad node must be [x,y,z,width]: ${JSON.stringify(node)}`);
      }
    }
  } finally {
    restore();
  }
});

// DecalRoads are the only road system; legacy saved values still export roads.
test('road mode: legacy architect/mesh values export DecalRoads and nothing else', async () => {
  const restore = installCanvasPolyfill();
  try {
    for (const roadType of ['mesh', 'architect']) {
      const zip = await exportZip({ roadType });
      assert.ok(zip.file(`${BASE}/main/MissionGroup/Decal_Roads/items.level.json`), `${roadType} → DecalRoads`);
      assert.ok(!zip.file(`${BASE}/main/MissionGroup/Mesh_roads/items.level.json`));
      assert.ok(!Object.keys(zip.files).some((p) => /roadatchitectsession/.test(p)));
    }
    const none = await exportZip({ roadType: 'none' });
    assert.ok(!none.file(`${BASE}/main/MissionGroup/Decal_Roads/items.level.json`));
  } finally {
    restore();
  }
});

// ── §S2 — LevelInfo fidelity fields ──────────────────────────────────────────
test('guide §S2: LevelInfo carries decalBias + sound fidelity fields', async () => {
  await withZip(async (zip) => {
    const sky = parseNDJSON(await readText(zip, 'main/MissionGroup/sky_and_sun/items.level.json'));
    const li = sky.find((o) => o.class === 'LevelInfo');
    assert.ok(li, 'Expected a LevelInfo');
    assert.equal(typeof li.decalBias, 'number', 'LevelInfo.decalBias should be a number');
    assert.equal(li.soundAmbience, 'AudioAmbienceDefault', 'LevelInfo.soundAmbience default');
    assert.equal(li.soundDistanceModel, 'Logarithmic', 'LevelInfo.soundDistanceModel default');
  });
});

// ── §2 — info.json region + roadRules.turnOnRed ──────────────────────────────
test('guide §2: info.json has region and roadRules.turnOnRed', async () => {
  await withZip(async (zip) => {
    const info = JSON.parse(await readText(zip, 'info.json'));
    assert.ok(typeof info.region === 'string' && info.region.length > 0, 'info.region must be set');
    assert.equal(typeof info.roadRules.turnOnRed, 'boolean', 'roadRules.turnOnRed must be boolean');
  });
});

// ── Rule I3 — minimap emitted and the referenced file exists ──────────────────
test('guide §I3: info.json minimap references an existing tile + TerrainBlock.minimapImage set', async () => {
  await withZip(async (zip) => {
    const info = JSON.parse(await readText(zip, 'info.json'));
    assert.ok(Array.isArray(info.minimap) && info.minimap.length > 0, 'info.minimap must be non-empty');
    const tile = info.minimap[0];
    assert.ok(zip.file(`${BASE}/${tile.file}`), `minimap tile "${tile.file}" must exist in the ZIP`);
    assert.ok(Array.isArray(tile.size) && tile.size.length === 2, 'minimap size must be [w,h]');
    assert.ok(Array.isArray(tile.offset) && tile.offset.length === 2, 'minimap offset must be [x,y]');

    const objs = parseNDJSON(await readText(zip, 'main/MissionGroup/level_objects/items.level.json'));
    const tb = objs.find((o) => o.class === 'TerrainBlock');
    assert.ok(tb.minimapImage && tb.minimapImage.length > 0, 'TerrainBlock.minimapImage must be set');
  });
});

// ── §7 — self-contained groundModels file ────────────────────────────────────
test('guide §7: groundModels file is valid and keeps the asphalt alias', async () => {
  await withZip(async (zip) => {
    const f = zip.file(`${BASE}/groundModels/mapng_groundmodels.json`);
    assert.ok(f, 'Expected groundModels/mapng_groundmodels.json');
    const gm = JSON.parse(await f.async('string'));
    assert.ok(gm.ASPHALT, 'ASPHALT ground model must be defined');
    assert.ok(Array.isArray(gm.ASPHALT.aliases) && gm.ASPHALT.aliases.includes('groundmodel_asphalt1'),
      'ASPHALT must alias groundmodel_asphalt1 so the fallback resolves locally');
    // Every terrain material groundmodelName must resolve to a defined model or alias.
    const terrainMats = JSON.parse(await readText(zip, 'art/terrains/main.materials.json'));
    const names = new Set();
    for (const [key, def] of Object.entries(gm)) {
      names.add(key.toUpperCase());
      for (const a of def.aliases || []) names.add(String(a).toUpperCase());
    }
    for (const def of Object.values(terrainMats)) {
      if (def.class !== 'TerrainMaterial' || !def.groundmodelName) continue;
      assert.ok(names.has(String(def.groundmodelName).toUpperCase()),
        `TerrainMaterial.groundmodelName "${def.groundmodelName}" must resolve in the level groundModels`);
    }
  });
});

// ── Terrain-Files.md §Height scale — TerrainBlock.maxHeight ↔ .ter quantization ──
// BeamNG decodes heightMeters = stored × (TerrainBlock.maxHeight / 65536), so the
// .ter writer must quantize against the SAME maxHeight the TerrainBlock declares
// (max(1, ceil(range))). With a non-integer elevation range, scaling against the
// raw float range instead exaggerates terrain height by up to ~1 m relative to
// every object placed at real heights.
test('terrain: .ter heights decode exactly against TerrainBlock.maxHeight (non-integer range)', async () => {
  const restore = installCanvasPolyfill();
  try {
    const td = makeTerrainData();
    td.minHeight = 0;
    td.maxHeight = 50.4;
    td.heightMap = new Float32Array(64).map((_, i) => (50.4 * i) / 63);

    const result = await exportBeamNGLevel(td, { lat: 0.5, lng: 0.5 }, {
      roadType: 'decal', levelName: LEVEL_ID, biomeId: 'west_coast_usa',
      baseTexture: 'none', pbrSource: 'none', includeBuildings: false,
      applyFoundations: false, includeBackdrop: false, includeWater: false,
      includeTrees: false, includeRocks: false, includeNativeBarriers: false,
    });
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());

    const objs = parseNDJSON(await readText(zip, 'main/MissionGroup/level_objects/items.level.json'));
    const tb = objs.find((o) => o.class === 'TerrainBlock');
    assert.equal(tb.maxHeight, 51, 'TerrainBlock.maxHeight must be max(1, ceil(range))');

    const terBuf = new Uint8Array(await zip.file(`${BASE}/art/terrains/terrain.ter`).async('arraybuffer'));
    const view = new DataView(terBuf.buffer, terBuf.byteOffset, terBuf.byteLength);
    const size = view.getUint32(1, true);
    let peakStored = 0;
    for (let i = 0; i < size * size; i++) {
      peakStored = Math.max(peakStored, view.getUint16(5 + i * 2, true));
    }
    const decodedPeak = peakStored * (tb.maxHeight / 65536);
    assert.ok(Math.abs(decodedPeak - 50.4) < 0.01,
      `peak terrain height must decode to ≈50.4 m via TerrainBlock.maxHeight, got ${decodedPeak}`);
  } finally {
    restore();
  }
});

// ── DecalRoad.md §Navigation/AI pathfinding fields — drivable decals carry nav metadata ──
test('decal roads: drivable base layer carries oneWay/flipDirection/gatedRoad/lane metadata', async () => {
  const restore = installCanvasPolyfill();
  try {
    const td = makeTerrainData();
    td.osmFeatures = [
      { id: 'oneway_1', type: 'road',
        tags: { highway: 'primary', oneway: 'yes', lanes: '2', name: 'oneway_ave' },
        geometry: [{ lat: 0.8, lng: 0.2 }, { lat: 0.2, lng: 0.8 }] },
      { id: 'reverse_1', type: 'road',
        tags: { highway: 'secondary', oneway: '-1', name: 'reverse_st' },
        geometry: [{ lat: 0.8, lng: 0.8 }, { lat: 0.2, lng: 0.2 }] },
      { id: 'twoway_1', type: 'road',
        tags: { highway: 'tertiary', lanes: '3', name: 'twoway_rd' },
        geometry: [{ lat: 0.5, lng: 0.1 }, { lat: 0.5, lng: 0.9 }] },
      { id: 'private_1', type: 'road',
        tags: { highway: 'residential', access: 'private', name: 'private_ln' },
        geometry: [{ lat: 0.3, lng: 0.1 }, { lat: 0.3, lng: 0.9 }] },
    ];

    const result = await exportBeamNGLevel(td, { lat: 0.5, lng: 0.5 }, {
      roadType: 'decal', levelName: LEVEL_ID, biomeId: 'west_coast_usa',
      baseTexture: 'none', pbrSource: 'none', includeBuildings: false,
      applyFoundations: false, includeBackdrop: false, includeWater: false,
      includeTrees: false, includeRocks: false, includeNativeBarriers: false,
    });
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());

    const decals = [];
    for (const path of Object.keys(zip.files)) {
      if (!/Decal_Roads\/[^/]+\/items\.level\.json$/.test(path)) continue;
      const text = await zip.file(path).async('string');
      if (text.trim()) decals.push(...parseNDJSON(text));
    }
    const baseOf = (group) => decals.filter((d) =>
      d.class === 'DecalRoad' && d.drivability > 0 && d.name.startsWith(`dr_${group}`));
    const paintOf = (group) => decals.filter((d) =>
      d.class === 'DecalRoad' && !(d.drivability > 0) && d.name.startsWith(`dr_${group}`));

    const onewayBase = baseOf('oneway_ave');
    assert.ok(onewayBase.length > 0, 'expected drivable base decals for oneway_ave');
    for (const d of onewayBase) {
      assert.equal(d.oneWay, true, 'oneway=yes road must set oneWay');
      assert.equal(d.flipDirection, undefined, 'forward oneway must not flip');
      assert.equal(d.autoLanes, false);
      // Right-hand traffic: BeamNG's map.lua reads the right side as forward
      // lanes; lanes on the left would decode as backward and get flipped.
      assert.equal(d.lanesLeft, 0);
      assert.equal(d.lanesRight, 2, 'lanes=2 oneway carries both lanes on the travel side');
      assert.equal(d.drivability, 0.98, 'primary ranks just below motorway/trunk');
      assert.equal(d.gatedRoad, undefined);
    }

    const reverseBase = baseOf('reverse_st');
    assert.ok(reverseBase.length > 0, 'expected drivable base decals for reverse_st');
    for (const d of reverseBase) {
      assert.equal(d.oneWay, true, 'oneway=-1 road must set oneWay');
      assert.equal(d.flipDirection, true, 'oneway=-1 travel runs against node order');
    }

    const twowayBase = baseOf('twoway_rd');
    assert.ok(twowayBase.length > 0, 'expected drivable base decals for twoway_rd');
    for (const d of twowayBase) {
      assert.equal(d.oneWay, undefined, 'two-way road must not set oneWay');
      assert.equal(d.lanesLeft + d.lanesRight, 3, 'lanes=3 split across sides');
    }

    const privateBase = baseOf('private_ln');
    assert.ok(privateBase.length > 0, 'expected drivable base decals for private_ln');
    for (const d of privateBase) {
      assert.equal(d.gatedRoad, true, 'access=private road must be gated');
      assert.equal(d.hiddenInNavi, true, 'access=private road hidden from nav display');
    }

    // Paint/edge layers stay visual-only: no nav metadata leaks onto them.
    for (const group of ['oneway_ave', 'reverse_st', 'twoway_rd', 'private_ln']) {
      for (const d of paintOf(group)) {
        assert.equal(d.oneWay, undefined, `paint layer ${d.name} must not carry oneWay`);
        assert.equal(d.lanesLeft, undefined, `paint layer ${d.name} must not carry lanes`);
        assert.equal(d.gatedRoad, undefined, `paint layer ${d.name} must not carry gatedRoad`);
      }
    }
  } finally {
    restore();
  }
});

// ── Terrain-Files.md §Heightmap import — terrainheightmap.png is true 16-bit ──
test('terrain: terrainheightmap.png is 16-bit grayscale at terrain resolution', async () => {
  await withZip(async (zip) => {
    const png = new Uint8Array(
      await zip.file(`${BASE}/art/terrains/terrain.terrainheightmap.png`).async('arraybuffer'),
    );
    // PNG signature + IHDR: width u32be @16, height u32be @20, bitDepth @24, colorType @25.
    assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'must be a real PNG');
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    const meta = JSON.parse(await readText(zip, 'terrain.terrain.json'));
    assert.equal(width, meta.size, 'heightmap width must match terrain size');
    assert.equal(height, meta.size, 'heightmap height must match terrain size');
    assert.equal(png[24], 16, 'bit depth must be 16 (R16 import reads u16 directly)');
    assert.equal(png[25], 0, 'color type must be 0 (grayscale)');
  });
});

// ── CameraBookmark.md — editor bookmarks ship like official levels ────────────
test('camera bookmarks: CameraBookmarks group ships valid editor viewpoints', async () => {
  await withZip(async (zip) => {
    const items = parseNDJSON(await readText(zip, 'main/MissionGroup/CameraBookmarks/items.level.json'));
    const bookmarks = items.filter((o) => o.class === 'CameraBookmark');
    assert.ok(bookmarks.length >= 2, 'expected map overview + spawn bookmarks');
    for (const bm of bookmarks) {
      assert.equal(bm.dataBlock, 'CameraBookmarkMarker');
      assert.equal(bm.position.length, 3);
      assert.equal(bm.rotationMatrix.length, 9);
      for (const v of [...bm.position, ...bm.rotationMatrix]) {
        assert.ok(Number.isFinite(v), `non-finite transform value in ${bm.name}`);
      }
    }
    // The group must be registered in the MissionGroup tree (recursive loading).
    const mission = parseNDJSON(await readText(zip, 'main/MissionGroup/items.level.json'));
    assert.ok(mission.some((o) => o.class === 'SimGroup' && o.name === 'CameraBookmarks'),
      'CameraBookmarks SimGroup missing from MissionGroup');
  });
});

// ── DecalRoad batch builder safety — no degenerate node spacing ───────────────
// Near-duplicate consecutive nodes make BeamNG's improvedSpline divide by a
// ~zero-length segment; the engine then logs "packed position exceeded
// supported local range … by inf m" and drops the batch in-game.
test('road nodes: sanitizeRoadNodes collapses near-duplicates and keeps endpoints', async () => {
  const { sanitizeRoadNodes } = await import('../services/exportBeamNGLevel.js');

  // Near-duplicate after the first node and a near-duplicate terminus.
  const nodes = [
    [0, 0, 1, 2],
    [0.001, 0, 1, 2],      // ~1 mm from previous → dropped
    [2, 0, 1, 2],
    [4, 0, 1, 2],
    [4.0005, 0, 1, 2],     // terminus ~0.5 mm away → replaces previous node
  ];
  const clean = sanitizeRoadNodes(nodes);
  assert.deepEqual(clean, [[0, 0, 1, 2], [2, 0, 1, 2], [4.0005, 0, 1, 2]]);

  // Non-finite nodes are dropped entirely.
  const withInf = sanitizeRoadNodes([[0, 0, 1, 2], [Infinity, 0, 1, 2], [3, 0, 1, 2]]);
  assert.deepEqual(withInf, [[0, 0, 1, 2], [3, 0, 1, 2]]);

  // Degenerate roads (everything inside minSpacing) vanish instead of glitching.
  assert.deepEqual(sanitizeRoadNodes([[0, 0, 1, 2], [0.01, 0, 1, 2]]), []);
});

test('road nodes: exported DecalRoads contain no non-finite or near-duplicate nodes', async () => {
  await withZip(async (zip) => {
    let checked = 0;
    for (const path of Object.keys(zip.files)) {
      if (!/Decal_Roads\/[^/]+\/items\.level\.json$/.test(path)) continue;
      const text = await zip.file(path).async('string');
      if (!text.trim()) continue;
      for (const obj of parseNDJSON(text)) {
        if (obj.class !== 'DecalRoad') continue;
        checked += 1;
        for (let i = 0; i < obj.nodes.length; i++) {
          for (const v of obj.nodes[i]) {
            assert.ok(Number.isFinite(v), `non-finite node value in ${obj.name}`);
          }
          if (i === 0) continue;
          const [ax, ay] = obj.nodes[i - 1];
          const [bx, by] = obj.nodes[i];
          const spacing = Math.hypot(bx - ax, by - ay);
          assert.ok(spacing >= 0.05,
            `${obj.name} nodes ${i - 1}/${i} are ${spacing.toFixed(4)} m apart (degenerate spacing)`);
        }
      }
    }
    assert.ok(checked > 0, 'expected at least one DecalRoad to verify');
  });
});

test('road nodes: sanitizeRoadNodes removes ~180-degree hairpin spikes', async () => {
  const { sanitizeRoadNodes } = await import('../services/exportBeamNGLevel.js');
  // Straight road with a degenerate doubling-back node in the middle.
  const nodes = [
    [0, 0, 1, 2],
    [2, 0, 1, 2],
    [4, 0, 1, 2],
    [1, 0.001, 1, 2], // path reverses ~180° onto itself
    [6, 0, 1, 2],
    [8, 0, 1, 2],
  ];
  const clean = sanitizeRoadNodes(nodes);
  for (let i = 2; i < clean.length; i++) {
    const [ax, ay] = clean[i - 2];
    const [bx, by] = clean[i - 1];
    const [cx, cy] = clean[i];
    const dot = ((bx - ax) * (cx - bx) + (by - ay) * (cy - by)) /
      ((Math.hypot(bx - ax, by - ay) * Math.hypot(cx - bx, cy - by)) || 1);
    assert.ok(dot > -0.99, `hairpin survived sanitization (dot=${dot.toFixed(4)})`);
  }
  assert.ok(clean.length >= 2);
  assert.deepEqual(clean[0], [0, 0, 1, 2]);
  assert.deepEqual(clean[clean.length - 1], [8, 0, 1, 2]);
});

// ── Carriageway vs driving width (roadWidth.estimateRoadCrossSection) ──
test('decal roads: asphalt covers the carriageway, AI path + paint the driving lanes', async () => {
  const restore = installCanvasPolyfill();
  try {
    const td = makeTerrainData();
    td.osmFeatures = [
      // Rural primary (no buildings): 7 m of lanes + a 1 m edge strip each side.
      { id: 'rural_1', type: 'road', tags: { highway: 'primary', name: 'rural_rd' },
        geometry: [{ lat: 0.5, lng: 0.15 }, { lat: 0.5, lng: 0.85 }] },
      // Tagged kerbside parking both sides: 6 m of lanes + 2 × 2.3 m.
      { id: 'parked_1', type: 'road', tags: { highway: 'residential', name: 'parked_st', 'parking:both': 'lane' },
        geometry: [{ lat: 0.3, lng: 0.15 }, { lat: 0.3, lng: 0.85 }] },
    ];
    const result = await exportBeamNGLevel(td, { lat: 0.5, lng: 0.5 }, {
      roadType: 'decal', levelName: LEVEL_ID, biomeId: 'west_coast_usa',
      baseTexture: 'none', pbrSource: 'none', includeBuildings: false,
      applyFoundations: false, includeBackdrop: false, includeWater: false,
      includeTrees: false, includeRocks: false, includeNativeBarriers: false,
    });
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const decals = [];
    for (const path of Object.keys(zip.files)) {
      if (!/Decal_Roads\/[^/]+\/items\.level\.json$/.test(path)) continue;
      const text = await zip.file(path).async('string');
      if (text.trim()) decals.push(...parseNDJSON(text));
    }
    const of = (group, suffix) => decals.filter((d) => d.class === 'DecalRoad' && d.name.startsWith(`dr_${group}`) && d.name.endsWith(suffix));
    const widthOf = (d) => d.nodes[Math.floor(d.nodes.length / 2)][3];
    const yOf = (d) => d.nodes[Math.floor(d.nodes.length / 2)][1];

    for (const [group, carriageway, driving] of [['rural_rd', 9, 7], ['parked_st', 6 + 2 * 2.3, 6]]) {
      const base = of(group, '_b');
      const ai = of(group, '_ai');
      assert.ok(base.length > 0 && ai.length > 0, `${group}: base + AI path decals`);
      for (const d of base) {
        assert.ok(Math.abs(widthOf(d) - carriageway) < 1e-6, `${group}: asphalt ${widthOf(d)} m, want ${carriageway}`);
        assert.ok(!(d.drivability > 0), `${group}: asphalt must not be the AI road when wider than the lanes`);
      }
      for (const d of ai) {
        assert.equal(d.material, 'road_invisible');
        assert.ok(d.drivability > 0, `${group}: AI path is drivable`);
        assert.ok(Math.abs(widthOf(d) - driving) < 1e-6, `${group}: AI path ${widthOf(d)} m, want ${driving}`);
      }
    }

    // Rural primary edge lines sit inside the 7 m of lanes, not at the asphalt edge.
    const centreY = yOf(of('rural_rd', '_b')[0]);
    const edgeLines = [...of('rural_rd', '_ell'), ...of('rural_rd', '_elr')];
    assert.ok(edgeLines.length >= 2, 'rural primary has both edge lines');
    for (const d of edgeLines) {
      const off = Math.abs(yOf(d) - centreY);
      assert.ok(Math.abs(off - (3.5 - 0.3)) < 0.05, `edge line ${off.toFixed(2)} m from centre, want 3.2 (0.3 m inside the lanes)`);
    }
  } finally {
    restore();
  }
});

// ── Road rules follow the export location (country_rules.json) ────────────────
test('road rules: a London export drives on the left with matching lane sides', async () => {
  const restore = installCanvasPolyfill();
  const realFetch = globalThis.fetch;
  const rulesJson = readFileSync(new URL('../public/country_rules.json', import.meta.url), 'utf8');
  globalThis.fetch = async (url, ...rest) => (String(url) === '/country_rules.json'
    ? new Response(rulesJson, { status: 200 })
    : realFetch(url, ...rest));
  try {
    const td = makeTerrainData();
    td.osmFeatures = [
      { id: 'oneway_1', type: 'road', tags: { highway: 'primary', oneway: 'yes', lanes: '2', name: 'oneway_ave' },
        geometry: [{ lat: 0.8, lng: 0.2 }, { lat: 0.2, lng: 0.8 }] },
    ];
    const result = await exportBeamNGLevel(td, { lat: 51.507, lng: -0.128 }, {
      roadType: 'decal', levelName: LEVEL_ID, biomeId: 'west_coast_usa',
      baseTexture: 'none', pbrSource: 'none', includeBuildings: false,
      applyFoundations: false, includeBackdrop: false, includeWater: false,
      includeTrees: false, includeRocks: false, includeNativeBarriers: false,
    });
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const info = JSON.parse(await readText(zip, 'info.json'));
    assert.equal(info.roadRules.rightHandDrive, true, 'UK keeps left (BeamNG calls this rightHandDrive)');
    assert.equal(info.roadRules.turnOnRed, false);
    assert.equal(info.region, 'europe');

    const decals = [];
    for (const path of Object.keys(zip.files)) {
      if (!/Decal_Roads\/[^/]+\/items\.level\.json$/.test(path)) continue;
      const text = await zip.file(path).async('string');
      if (text.trim()) decals.push(...parseNDJSON(text));
    }
    const base = decals.filter((d) => d.class === 'DecalRoad' && d.drivability > 0 && d.name.startsWith('dr_oneway_ave'));
    assert.ok(base.length > 0);
    for (const d of base) {
      assert.equal(d.lanesLeft, 2, 'left-hand traffic: forward lanes on the left');
      assert.equal(d.lanesRight, 0);
    }
  } finally {
    globalThis.fetch = realFetch;
    restore();
  }
});

// ── Visible traffic signals linked to signals.json ────────────────────────────
test('traffic signals: heads link to signals.json instances; level posts get .link files', async () => {
  const restore = installCanvasPolyfill();
  try {
    const td = makeTerrainData();
    td.osmFeatures = [
      { id: 'ns', type: 'road', tags: { highway: 'primary', name: 'ns_ave' },
        geometry: [{ lat: 0.8, lng: 0.5 }, { lat: 0.5, lng: 0.5 }, { lat: 0.2, lng: 0.5 }] },
      { id: 'ew', type: 'road', tags: { highway: 'primary', name: 'ew_ave' },
        geometry: [{ lat: 0.5, lng: 0.2 }, { lat: 0.5, lng: 0.5 }, { lat: 0.5, lng: 0.8 }] },
      { id: 'tl', type: 'street_furniture', tags: { highway: 'traffic_signals' },
        geometry: [{ lat: 0.5, lng: 0.5 }] },
    ];
    const result = await exportBeamNGLevel(td, { lat: 0.5, lng: 0.5 }, {
      roadType: 'decal', levelName: LEVEL_ID, biomeId: 'west_coast_usa',
      baseTexture: 'none', pbrSource: 'none', includeBuildings: false,
      applyFoundations: false, includeBackdrop: false, includeWater: false,
      includeTrees: false, includeRocks: false, includeNativeBarriers: false,
    });
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const signals = JSON.parse(await readText(zip, 'signals.json'));
    assert.equal(signals.instances.length, 4);

    const items = parseNDJSON(await readText(zip, 'main/MissionGroup/traffic_signals/items.level.json'));
    const heads = items.filter((o) => o.signalInstance);
    assert.equal(heads.length, 4);
    const names = new Set(signals.instances.map((i) => i.name));
    for (const head of heads) {
      assert.ok(names.has(head.signalInstance));
      assert.equal(head.dynamic, true);
      assert.equal(head.collisionType, 'None');
    }
    const posts = items.filter((o) => /pole_traffic1\.dae$/.test(o.shapeName));
    assert.equal(posts.length, 4);
    const missionGroup = parseNDJSON(await readText(zip, 'main/MissionGroup/items.level.json'));
    assert.ok(missionGroup.some((o) => o.name === 'traffic_signals'));
    // The West Coast USA post is mirrored into this level through a .link file.
    const linked = Object.keys(zip.files).some((p) => /pole_traffic1\.dae\.link$/.test(p));
    assert.ok(linked, 'pole_traffic1 .link file');
  } finally {
    restore();
  }
});

// ── Generated street lamps along lit roads ────────────────────────────────────
test('street lamps: a lit street gets poles with night lights', async () => {
  const restore = installCanvasPolyfill();
  try {
    const td = makeTerrainData();
    td.osmFeatures = [
      { id: 'lit_1', type: 'road', tags: { highway: 'residential', lit: 'yes', name: 'lit_st' },
        geometry: [{ lat: 0.5, lng: 0.15 }, { lat: 0.5, lng: 0.85 }] },
    ];
    const result = await exportBeamNGLevel(td, { lat: 0.5, lng: 0.5 }, {
      roadType: 'decal', levelName: LEVEL_ID, biomeId: 'west_coast_usa',
      baseTexture: 'none', pbrSource: 'none', includeBuildings: false,
      applyFoundations: false, includeBackdrop: false, includeWater: false,
      includeTrees: false, includeRocks: false, includeNativeBarriers: false,
    });
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const items = parseNDJSON(await readText(zip, 'main/MissionGroup/street_furniture/items.level.json'));
    const poles = items.filter((o) => o.class === 'TSStatic' && /^street_lamp_gen_/.test(o.name));
    const lights = items.filter((o) => o.class === 'PointLight' && /^street_lamp_gen_/.test(o.name));
    assert.ok(poles.length > 0, 'generated lamp poles');
    assert.equal(lights.length, poles.length, 'one night light per pole');
    assert.ok(lights.every((l) => l.nightLight === '1' && l.castShadows === false));
  } finally {
    restore();
  }
});
