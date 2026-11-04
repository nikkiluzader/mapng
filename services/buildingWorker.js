// Buildings built on worker threads (services/parallel.js): each task is
// the buildings of a few tiles, built and written as Collada there. The
// context they read beyond themselves (neighbours' storeys, businesses
// inside, a hotel's main building) comes made by the exporter, which also
// chose them under the cap; the streets each worker indexes once from the
// shared roads. A dense 8 km export built and wrote its 51k buildings for
// ~33 s on its one main thread.
import { buildTexturedBuildings } from './beamngBuildings.js';
import { streetIndex } from './buildingDetails.js';
import { buildingTileScene } from './buildingTiles.js';
import { ColladaExporter } from './ColladaExporter.js';
import { DAE_OPTIONS, describeScene } from './daeWorker.js';
import { geoToWorldPoint, terrainDrape, terrainGroundAt } from './terrainLookup.js';

let made = null;   // this worker's terrain lookups and streets (the same shared data for every task)

function lookups(shared) {
  if (made?.shared === shared) return made;
  const td = shared.terrain; const sq = shared.squareSize;
  const project = (lat, lng) => geoToWorldPoint(lat, lng, td, sq, 0);
  // (the passages through buildings come made: courtyard archways are
  // found from the buildings' inner rings, which a worker has only some of)
  const streets = { ...streetIndex(shared.roads, project), passages: shared.passages };
  made = { shared, project, groundAt: terrainGroundAt(td, sq), drape: terrainDrape(td, sq), streets };
  return made;
}

/**
 * item { features, hints, business, hotelMain } (per feature: neighbours'
 * storeys, business tags, the hotel name it is the main building of);
 * shared { terrain, squareSize, tileM, roads, passages }. Returns the tiles' shapes
 * { key, origin, fullPx, data }, the count, the stats and the mesh tally.
 */
export function buildBuildingShare(task, shared) {
  // (a task comes as one JSON string: much cheaper to hand over than the
  // same features as objects)
  const item = typeof task === 'string' ? JSON.parse(task) : task;
  if (item.extras) return buildExtras(item, shared);
  const { project, groundAt, drape, streets } = lookups(shared);
  const levelsHints = new Map(); const businessTags = new Map(); const hotelMain = new Map();
  item.features.forEach((f, i) => {
    if (item.hints[i] != null) levelsHints.set(f, item.hints[i]);
    if (item.business[i]) businessTags.set(f, item.business[i]);
    if (item.hotelMain[i]) hotelMain.set(item.hotelMain[i], { f });
  });
  const built = buildTexturedBuildings(item.features, project, {
    maxBuildings: Infinity, tileM: shared.tileM, squareSize: shared.squareSize, groundAt, drape,
    part: 'buildings', context: { features: item.features, streets, levelsHints, businessTags, hotelMain },
  });
  return shapesOf(built, () => true);
}

/**
 * The extras (fountains, pools, fields, stands, racetracks: buildTexturedBuildings
 * part 'extras') from all the features, in tiles named apart ('x'); an extras
 * tile over a building tile keeps no lite copy of its own (buildingKeys).
 */
function buildExtras(item, shared) {
  const { project, groundAt, drape, streets } = lookups(shared);
  // (the features come with the stands already tagged; the extras read
  // nothing else of the buildings' context but the streets)
  const ctx = { features: item.features, streets, levelsHints: new Map(), businessTags: new Map(), hotelMain: new Map() };
  const built = buildTexturedBuildings(item.features, project, {
    maxBuildings: item.maxBuildings ?? Infinity, tileM: shared.tileM, squareSize: shared.squareSize, groundAt, drape,
    raceways: item.raceways, gateRoads: item.gateRoads,
    // ('water': fountains and pools, tiles 'x'; 'fields': pitches, stands, racetracks, lights, tiles 'y')
    part: item.extras, context: ctx, tileKeyPrefix: item.extras === 'water' ? 'x' : 'y',
  });
  const buildingKeys = new Set(item.buildingKeys);
  // (their shapes as scenes, written on every thread by the exporter: a
  // field's draped surfaces made one big tile, and this one thread wrote
  // them all for 8 s)
  return shapesOf(built, (t) => !buildingKeys.has(t.key.slice(1)), true);
}

function shapesOf(built, cloneLite, asScenes = false) {
  const triangles = built.meshes.reduce((n, m) => n + (m.geometry.index?.count ?? m.geometry.getAttribute('position')?.count ?? 0) / 3, 0);
  const tiles = built.tiles.map((t) => {
    const scene = buildingTileScene(t, { cloneLite: cloneLite(t) });
    if (asScenes) return { ...scene.meta, scene: describeScene(scene.root) };
    return { ...scene.meta, data: new ColladaExporter().parse(scene.root, undefined, DAE_OPTIONS)?.data ?? null };
  });
  return { tiles, count: built.count, stats: built.stats, meshes: built.meshes.length, triangles };
}
