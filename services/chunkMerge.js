// A chunked level (refs/output/chunked-pipeline-plan.md): the chunks' exports merged into one level. Each chunk was
// exported on its own square grid in its own world frame (centre origin; heights from its own minimum) keeping only its
// core; here every chunk's outputs are moved into the level's frame and written once:
// - objects (items.level.json lines): position += the chunk's offset, z += its minimum's difference from the level's;
//   line nodes (DecalRoad, River, MeshRoad) likewise; leaf names suffixed with the chunk (names must be unique);
//   level-wide objects (sky, terrain anchor, spawn, water plane...) taken from the first chunk only;
// - forest items and decal instances: moved and gathered per file;
// - the chunk's own assets (ground models, its base texture, generated meshes, materials) under chunks/<key>/, every
//   reference rewritten; the game's own models bundled into the level (official_assets) kept once at the level root;
// - ground materials renamed per chunk (each shows its own base texture).
// Heights along the seams are evened before this, in each chunk's export (plan: "seam heights").

const LEVEL_WIDE = new Set(['TerrainBlock', 'LevelInfo', 'ScatterSky', 'TimeOfDay', 'CloudLayer', 'SkyBox', 'Sun', 'WaterPlane', 'SpawnSphere', 'CameraBookmark', 'BeamNGWorldIconsRenderer', 'CubemapData', 'Precipitation']);
const LINES = new Set(['DecalRoad', 'River', 'MeshRoad']);

/** Text with the chunk's level paths rewritten: its own assets to chunks/<key>/, the game's bundled models to the root. */
export function rewritePaths(text, fromLevel, toLevel, key) {
  return text
    .split(`levels/${fromLevel}/map_assets/official_assets/`).join(`levels/${toLevel}/__OFFICIAL__/`)
    .split(`levels/${fromLevel}/`).join(`levels/${toLevel}/chunks/${key}/`)
    .split(`levels/${toLevel}/__OFFICIAL__/`).join(`levels/${toLevel}/map_assets/official_assets/`)
    .split('mapng_ground_').join(`mapng_ground_c${key}_`);
}

/** One object line moved by (dx, dy, dz) and renamed for the chunk. */
export function moveObject(o, dx, dy, dz, key) {
  const out = { ...o };
  if (Array.isArray(out.position)) out.position = [out.position[0] + dx, out.position[1] + dy, (out.position[2] || 0) + dz];
  if (LINES.has(out.class) && Array.isArray(out.nodes)) out.nodes = out.nodes.map((n) => [n[0] + dx, n[1] + dy, n[2] + dz, ...n.slice(3)]);
  if (out.class !== 'SimGroup' && typeof out.name === 'string' && out.name) out.name = `${out.name}_c${key}`;
  return out;
}

/**
 * Merge chunk zips into one level: chunks [{ zip (JSZip), key, levelName (the chunk's), offsetM: { x, y }, minHeight }],
 * the level's name; returns a JSZip of the level. JSZip is passed in (works in the browser and in Node).
 */
export async function mergeChunks(JSZip, chunks, levelName, { log = () => {} } = {}) {
  const out = new JSZip();
  const levelMin = Math.min(...chunks.map((c) => Number(c.minHeight) || 0));
  const gathered = new Map();   // path -> lines (items, forest) or decal instances
  const materials = new Map();  // path -> merged object
  let first = true;
  for (const c of chunks) {
    const dx = c.offsetM.x; const dy = c.offsetM.y; const dz = (Number(c.minHeight) || 0) - levelMin;
    const from = `levels/${c.levelName}/`;
    let objects = 0; let assets = 0;
    for (const name of Object.keys(c.zip.files)) {
      const f = c.zip.files[name]; if (f.dir || !name.startsWith(from)) continue;
      const rel = name.slice(from.length);
      const isItems = rel.endsWith('items.level.json');
      const isForest = /^forest\/.*\.forest4\.json$/.test(rel);
      if (isItems || isForest) {
        const text = rewritePaths(await f.async('string'), c.levelName, levelName, c.key);
        const lines = text.split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((o) => first || !LEVEL_WIDE.has(o.class))
          .map((o) => (isForest ? { ...o, pos: [o.pos[0] + dx, o.pos[1] + dy, o.pos[2] + dz] } : moveObject(o, dx, dy, dz, c.key)));
        const path = `levels/${levelName}/${rel}`;
        const list = gathered.get(path) || []; gathered.set(path, list.concat(lines.map((o) => JSON.stringify(o)))); objects += lines.length;
        continue;
      }
      if (rel === 'main.decals.json') {
        const d = JSON.parse(await f.async('string'));
        const cur = gathered.get('decals') || { header: d.header, instances: {} };
        for (const [k, list] of Object.entries(d.instances || {})) {
          cur.instances[k] = (cur.instances[k] || []).concat(list.map((i) => i.map((v, n) => (n === 3 ? v + dx : n === 4 ? v + dy : n === 5 ? v + dz : v))));
        }
        gathered.set('decals', cur); continue;
      }
      if (rel.endsWith('materials.json') && rel !== 'art/terrains/main.materials.json') {
        const shared = rel.startsWith('map_assets/official_assets/');
        const path = shared ? `levels/${levelName}/${rel}` : `levels/${levelName}/chunks/${c.key}/${rel}`;
        const obj = JSON.parse(rewritePaths(await f.async('string'), c.levelName, levelName, c.key));
        materials.set(path, { ...(materials.get(path) || {}), ...obj }); continue;
      }
      // the game's bundled models: once, at the level root
      if (rel.startsWith('map_assets/official_assets/')) {
        const path = `levels/${levelName}/${rel}`;
        if (!out.file(path)) { out.file(path, await f.async('uint8array')); assets++; }
        continue;
      }
      // level-wide files (info, terrain anchor, scripts, previews): from the first chunk, at the root
      const levelWide = !rel.includes('/') || rel.startsWith('art/terrains/terrain.') || rel === 'art/terrains/main.materials.json' || rel.startsWith('groundModels/');
      if (levelWide) {
        if (first) {
          const isText = /\.(json|lua|txt|md)$/.test(rel);
          out.file(`levels/${levelName}/${rel}`, isText ? (await f.async('string')).split(`levels/${c.levelName}/`).join(`levels/${levelName}/`) : await f.async('uint8array'));
        }
        continue;
      }
      // the chunk's own assets
      const path = `levels/${levelName}/chunks/${c.key}/${rel}`;
      if (/\.(dae|json|lua|cs)$/.test(rel)) out.file(path, rewritePaths(await f.async('string'), c.levelName, levelName, c.key));
      else out.file(path, await f.async('uint8array'));
      assets++;
    }
    log(`chunk ${c.key}: moved by (${dx.toFixed(1)}, ${dy.toFixed(1)}, ${dz.toFixed(2)}) m; ${objects} object line(s), ${assets} asset file(s)`);
    first = false;
  }
  for (const [path, lines] of gathered) {
    if (path === 'decals') out.file(`levels/${levelName}/main.decals.json`, JSON.stringify(lines, null, 2));
    else out.file(path, lines.length ? lines.join('\n') + '\n' : '');
  }
  for (const [path, obj] of materials) out.file(path, JSON.stringify(obj, null, 2));
  return out;
}
