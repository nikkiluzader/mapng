// Level linter: checks an exported BeamNG level zip against the formats in
// BeamNG's official docs (digest: refs/output/beamng-master-reference.md).
// Pure: takes the zip bytes, returns findings. Used by scripts/lintLevel.mjs,
// the in-game batches and tests/levelLint.test.mjs.
//
// Finding: { level: 'error' | 'warn', check, msg, where? }. Errors are what
// the engine rejects or renders wrong (unparseable lines, missing files,
// missing materials, non-finite transforms); warnings are what it tolerates
// badly (non-power-of-two textures, oversize decal roads, duplicate names).
import JSZip from 'jszip';

const NDJSON = /(items\.level\.json|\.forest4\.json|\.prefab\.json|forestbrushes4\.json)$/;
const TOP_DIRS = new Set(['levels', 'vehicles', 'art', 'assets', 'lua', 'scripts', 'ui', 'gameplay', 'settings', 'trackEditor', 'vehicleGroups']);
const finite = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
const isPow2 = (v) => v >= 16 && (v & (v - 1)) === 0;
const DECAL_ROAD_SPAN_M = 2048;     // packed vertex range (engine: "packed position exceeded ... 2048 meters")

/**
 * gameHas(path): optional, true when a stock game file exists (with the
 * engine's .png/.dds/.jpg and .link fallbacks); gameMaterials: optional Set
 * of material names the game defines; gameDangling(path): true when the
 * game's own materials reference that (missing) path too, a dangling
 * reference inside the game (a warning, not ours). Without them stock paths
 * and stock material names are not checked.
 */
export async function lintLevelZip(bytes, { gameHas = null, gameMaterials = null, gameDangling = null } = {}) {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const nameSet = new Set(names);
  const findings = [];
  const add = (level, check, msg, where) => { if (findings.filter((f) => f.check === check).length < 200) findings.push({ level, check, msg, ...(where ? { where } : {}) }); };
  const counts = {};
  const text = async (n) => zip.file(n).async('string');

  // ── layout ──
  const tops = new Set(names.map((n) => n.split('/')[0]));
  for (const t of tops) if (!TOP_DIRS.has(t)) add('error', 'layout', `top-level folder "${t}" is not a mod folder BeamNG reads`);
  const levelDirs = [...new Set(names.filter((n) => n.startsWith('levels/')).map((n) => n.split('/')[1]))];
  if (levelDirs.length !== 1) add('error', 'layout', `expected one level folder under levels/, found ${levelDirs.length}`);
  const level = levelDirs[0];
  if (!level) return { level: null, findings, counts };
  const base = `levels/${level}/`;
  if (!names.some((n) => n.startsWith(`${base}main/`))) add('error', 'layout', 'no main/ folder: the game will not list the level');
  if (level !== level.toLowerCase() || /[^a-z0-9_]/.test(level)) add('warn', 'layout', `level name "${level}" is not lowercase_with_underscores`);
  // a level path resolves inside the zip, or (stock) in the game
  const resolves = (p) => {
    if (!p || typeof p !== 'string') return false;
    const rel = p.replace(/^\//, '');
    const alts = [rel, rel.replace(/\.(png|dds|jpg)$/i, '.dds'), rel.replace(/\.(png|dds|jpg)$/i, '.png'), rel.replace(/\.(png|dds|jpg)$/i, '.jpg'), `${rel}.link`];
    if (alts.some((a) => nameSet.has(a))) return true;
    if (rel.startsWith(base)) return false;
    return gameHas ? gameHas(rel) : true;
  };

  // ── JSON files parse ──
  const objects = [];   // { obj, file }
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    const t = await text(n);
    if (NDJSON.test(n)) {
      t.split('\n').forEach((line, i) => {
        if (!line.trim()) return;
        try {
          const o = JSON.parse(line);
          if (n.endsWith('items.level.json')) objects.push({ obj: o, file: n });
        } catch { add('error', 'json', `line ${i + 1} does not parse`, n); }
      });
    } else {
      try { JSON.parse(t); } catch (e) { add('error', 'json', `does not parse (${String(e.message).slice(0, 60)})`, n); }
    }
  }
  counts.objects = objects.length;
  const byClass = (c) => objects.filter(({ obj }) => obj.class === c).map(({ obj }) => obj);

  // ── scene tree ──
  const groups = new Set(byClass('SimGroup').map((g) => g.name));
  const seenName = new Map(); const seenPid = new Set();
  for (const { obj, file } of objects) {
    if (!obj.class) add('error', 'scene', 'object without a class', file);
    if (obj.name) {
      if (seenName.has(obj.name) && obj.class !== 'SimGroup') add('warn', 'names', `duplicate object name "${obj.name}"`, file);
      seenName.set(obj.name, obj);
    }
    if (obj.persistentId) {
      if (seenPid.has(obj.persistentId)) add('error', 'scene', `duplicate persistentId ${obj.persistentId}`, file);
      seenPid.add(obj.persistentId);
    }
    if (obj.__parent && !groups.has(obj.__parent)) add('error', 'scene', `__parent "${obj.__parent}" is not a SimGroup`, file);
    // a nested file's objects belong to the group its folder is named after
    const folder = file.replace(/\/items\.level\.json$/, '').split('/').pop();
    if (folder !== 'main' && obj.__parent && obj.__parent !== folder && obj.class !== 'SimGroup') add('warn', 'scene', `"${obj.name || obj.class}" in folder ${folder} has __parent ${obj.__parent}`, file);
  }
  for (const g of groups) {
    if (g === 'MissionGroup') continue;
    const has = names.some((n) => n.startsWith(base) && n.endsWith(`/${g}/items.level.json`));
    const children = objects.some(({ obj }) => obj.__parent === g);
    if (children && !has) add('warn', 'scene', `SimGroup ${g} has children but no ${g}/items.level.json folder`);
  }

  // ── transforms ──
  let badTransforms = 0;
  for (const { obj, file } of objects) {
    const bad = (obj.position !== undefined && !finite(obj.position, 3))
      || (obj.rotationMatrix !== undefined && !finite(obj.rotationMatrix, 9))
      || (obj.scale !== undefined && !(finite(obj.scale, 3) && obj.scale.every((v) => v > 0)));
    if (bad) { badTransforms++; add('error', 'transform', `non-finite or invalid position / rotation / scale on ${obj.class} ${obj.name || ''}`, file); }
    if (finite(obj.rotationMatrix, 9)) {
      const m = obj.rotationMatrix;
      const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
      if (Math.abs(det - 1) > 0.02) add('warn', 'transform', `rotationMatrix determinant ${det.toFixed(3)} on ${obj.class} ${obj.name || ''}`, file);
    }
  }
  counts.badTransforms = badTransforms;

  // ── info.json ──
  const infoName = `${base}info.json`;
  let info = null;
  if (!nameSet.has(infoName)) add('warn', 'info', 'no info.json: no title, previews or spawns');
  else {
    try { info = JSON.parse(await text(infoName)); } catch { /* reported above */ }
  }
  if (info) {
    const spawnNames = (info.spawnPoints || []).map((s) => s.objectname);
    if (info.defaultSpawnPointName && !spawnNames.includes(info.defaultSpawnPointName)) add('error', 'info', `defaultSpawnPointName ${info.defaultSpawnPointName} is not in spawnPoints`);
    for (const s of spawnNames) if (!seenName.has(s)) add('error', 'info', `spawn point ${s} names no scene object`);
    for (const p of info.previews || []) if (!nameSet.has(`${base}${p}`)) add('warn', 'info', `preview ${p} missing`);
    for (const m of info.minimap || []) if (m.file && !resolves(m.file.startsWith('/') ? m.file : `/${base}${m.file}`)) add('warn', 'info', `minimap ${m.file} missing`);
  }

  // ── terrain ──
  const terrains = byClass('TerrainBlock');
  if (terrains.length !== 1) add('error', 'terrain', `expected one TerrainBlock, found ${terrains.length}`);
  const tb = terrains[0];
  let terrainBox = null;
  const terrainMats = new Map();   // internalName -> material
  const terrainSets = new Set();
  for (const n of names.filter((n) => n.startsWith(base) && /terrains\/.*materials\.json$/.test(n))) {
    try {
      for (const [k, v] of Object.entries(JSON.parse(await text(n)))) {
        if (v?.class === 'TerrainMaterial') terrainMats.set(v.internalName || k, v);
        if (v?.class === 'TerrainMaterialTextureSet') terrainSets.add(v.name || k);
      }
    } catch { /* reported */ }
  }
  if (tb) {
    if (tb.scale && !(tb.scale.every((v) => v === 1))) add('error', 'terrain', 'TerrainBlock is scaled (use squareSize)');
    if (tb.materialTextureSet && !terrainSets.has(tb.materialTextureSet)) add('error', 'terrain', `materialTextureSet ${tb.materialTextureSet} is not defined`);
    const terPath = String(tb.terrainFile || '').replace(/^\//, '');
    if (!nameSet.has(terPath)) add('error', 'terrain', `terrainFile ${tb.terrainFile} missing`);
    else {
      const buf = await zip.file(terPath).async('uint8array');
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      const version = dv.getUint8(0); const size = dv.getUint32(1, true);
      if (version !== 9) add('error', 'terrain', `.ter version ${version} (9 expected)`);
      if (!isPow2(size) || size < 128 || size > 8192) add('warn', 'terrain', `.ter size ${size} is not a power of two in 128..8192`);
      const layerAt = 5 + size * size * 2;
      let off = layerAt + size * size;
      if (off + 4 > buf.byteLength) add('error', 'terrain', '.ter shorter than its size says');
      else {
        const count = dv.getUint32(off, true); off += 4;
        const matNames = [];
        for (let i = 0; i < count && off < buf.byteLength; i++) {
          const len = dv.getUint8(off); off += 1;
          matNames.push(new TextDecoder().decode(buf.subarray(off, off + len))); off += len;
        }
        if (count > 254) add('error', 'terrain', `${count} terrain materials (254 at most)`);
        for (const m of matNames) if (!terrainMats.has(m)) add('error', 'terrain', `.ter material ${m} is not a TerrainMaterial`);
        let badLayer = 0;
        for (let i = 0; i < size * size; i++) { const v = buf[layerAt + i]; if (v !== 255 && v >= count) badLayer++; }
        if (badLayer) add('error', 'terrain', `${badLayer} layer map samples index past the ${count} materials`);
        counts.terrain = { size, materials: count };
      }
      const sq = Number(tb.squareSize) || 1;
      const [px, py] = tb.position || [0, 0, 0];
      terrainBox = [px, py, px + size * sq, py + size * sq];
    }
  }
  for (const [name, m] of terrainMats) {
    for (const [k, v] of Object.entries(m)) {
      if (/Tex$|Map$/.test(k) && typeof v === 'string' && v && !resolves(v)) add('error', 'textures', `terrain material ${name} ${k} ${v} missing`);
    }
  }
  const inTerrain = (x, y, margin = 50) => !terrainBox || (x >= terrainBox[0] - margin && x <= terrainBox[2] + margin && y >= terrainBox[1] - margin && y <= terrainBox[3] + margin);

  // ── materials ──
  const matNames = new Set();
  const textures = [];
  for (const n of names.filter((x) => x.endsWith('materials.json') && !/terrains\//.test(x))) {
    let doc;
    try { doc = JSON.parse(await text(n)); } catch { continue; }
    for (const [k, m] of Object.entries(doc)) {
      if (!m || typeof m !== 'object') continue;
      matNames.add(k); if (m.name) matNames.add(m.name); if (m.mapTo) matNames.add(m.mapTo);
      const walk = (o) => {
        for (const [kk, v] of Object.entries(o || {})) {
          if (typeof v === 'string' && /Map$|Tex$|^cubemap$/.test(kk) && /\.(png|dds|jpg|jpeg)$/i.test(v)) textures.push({ path: v, mat: k, file: n });
          else if (v && typeof v === 'object') walk(v);
        }
      };
      walk(m);
    }
  }
  counts.materials = matNames.size;
  let missingTex = 0;
  for (const t of textures) {
    if (resolves(t.path)) continue;
    const rel = t.path.replace(/^\//, '');
    if (!rel.startsWith(base) && gameDangling?.(rel)) { add('warn', 'textures', `${t.mat}: ${t.path} missing in the game too (its own materials reference it)`, t.file); continue; }
    missingTex++; add('error', 'textures', `${t.mat}: ${t.path} missing`, t.file);
  }
  counts.textures = textures.length; counts.missingTextures = missingTex;
  // power-of-two PNGs in the zip (PNG IHDR: width at byte 16, height at 20)
  for (const n of names.filter((x) => x.startsWith(base) && x.endsWith('.png'))) {
    const head = await zip.file(n).async('uint8array');
    if (head.length < 24) continue;
    const w = (head[16] << 24 | head[17] << 16 | head[18] << 8 | head[19]) >>> 0;
    const h = (head[20] << 24 | head[21] << 16 | head[22] << 8 | head[23]) >>> 0;
    const ratioOk = w === h || w === 2 * h || h === 2 * w;
    if (!(isPow2(w) && isPow2(h)) || !ratioOk) {
      // (UI images, previews and minimaps are not textures)
      if (!/preview|minimap|\/ui\//i.test(n)) add('warn', 'textures', `${n.slice(base.length)} is ${w}x${h} (power of two, square or 2:1, needed)`);
    }
  }
  // (a material the level does not define may be the game's: only an error
  // when the game's material list says it is not)
  const knownMat = (m) => matNames.has(m) || (gameMaterials ? gameMaterials.has(m) : true);
  const needMat = (m, what, file) => { if (m && !knownMat(m)) add('error', 'materials', `${what} material "${m}" is defined neither in the level nor by the game`, file); };

  // ── roads ──
  let roads = 0;
  for (const { obj, file } of objects.filter(({ obj }) => obj.class === 'DecalRoad')) {
    roads++;
    const nodes = obj.nodes || [];
    if (nodes.length < 2) add('error', 'roads', `DecalRoad ${obj.name} has ${nodes.length} node(s)`, file);
    if (!nodes.every((n) => finite(n, 4) && n[3] > 0)) add('error', 'roads', `DecalRoad ${obj.name} has a node that is not [x, y, z, width>0]`, file);
    else {
      const xs = nodes.map((n) => n[0]); const ys = nodes.map((n) => n[1]);
      const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      if (span > DECAL_ROAD_SPAN_M) add('warn', 'roads', `DecalRoad ${obj.name} spans ${Math.round(span)} m (split it: packed vertex range)`, file);
      if (!nodes.every((n) => inTerrain(n[0], n[1]))) add('warn', 'roads', `DecalRoad ${obj.name} runs off the terrain`, file);
    }
    needMat(obj.material, `DecalRoad ${obj.name}`, file);
  }
  counts.decalRoads = roads;

  // ── statics ──
  let statics = 0; let missingShapes = 0;
  const shapeCache = new Map();
  for (const { obj, file } of objects.filter(({ obj }) => obj.class === 'TSStatic')) {
    statics++;
    if (!resolves(obj.shapeName)) { missingShapes++; add('error', 'shapes', `TSStatic ${obj.name} shape ${obj.shapeName} missing`, file); continue; }
    const rel = String(obj.shapeName).replace(/^\//, '');
    if (!nameSet.has(rel) || !rel.endsWith('.dae')) continue;
    if (!shapeCache.has(rel)) {
      const dae = await text(rel);
      const mats = [...dae.matchAll(/<material\s+id="([^"]+)"(?:\s+name="([^"]+)")?/g)].map((m) => m[2] || m[1]);
      shapeCache.set(rel, { mats, col: /Colmesh/i.test(dae) });
    }
    const s = shapeCache.get(rel);
    for (const m of s.mats) {
      const plain = m.replace(/-material$/, '');
      if (!knownMat(m) && !knownMat(plain)) add('error', 'materials', `${rel.slice(base.length)} uses material "${plain}", defined neither in the level nor by the game`, file);
    }
    if (obj.collisionType === 'Collision Mesh' && !s.col) add('warn', 'shapes', `${rel.slice(base.length)} has collisionType Collision Mesh but no Colmesh`, file);
    if (finite(obj.position, 3) && !inTerrain(obj.position[0], obj.position[1], 200)) add('warn', 'shapes', `TSStatic ${obj.name} stands off the terrain`, file);
  }
  counts.statics = statics; counts.missingShapes = missingShapes;

  // ── forest ──
  const itemTypes = new Map();
  const itemFile = names.find((n) => n.startsWith(base) && n.endsWith('managedItemData.json'));
  if (itemFile) {
    try {
      for (const [k, v] of Object.entries(JSON.parse(await text(itemFile)))) {
        itemTypes.set(v.internalName || k, v);
        if (v.shapeFile && !resolves(v.shapeFile)) add('error', 'forest', `forest item ${k} shape ${v.shapeFile} missing`, itemFile);
      }
    } catch { /* reported */ }
  }
  let forestItems = 0;
  for (const n of names.filter((x) => x.startsWith(base) && x.endsWith('.forest4.json'))) {
    for (const line of (await text(n)).split('\n')) {
      if (!line.trim()) continue;
      let it; try { it = JSON.parse(line); } catch { continue; }
      forestItems++;
      if (!itemTypes.has(it.type)) add('error', 'forest', `forest type ${it.type} not in managedItemData`, n);
      if (!finite(it.pos, 3) || !Number.isFinite(it.scale)) add('error', 'forest', `forest item of ${it.type} with invalid pos / scale`, n);
    }
  }
  counts.forestItems = forestItems;

  // ── ground cover ──
  for (const g of byClass('GroundCover')) {
    needMat(g.material, `GroundCover ${g.name}`);
    for (const l of (g.Types || g.layer || [])) {
      const layer = typeof l === 'string' ? l : l?.layer;
      // (tolerated: it draws nothing there)
      if (layer && !terrainMats.has(layer)) add('warn', 'groundcover', `GroundCover ${g.name} layer ${layer} is not a terrain material (draws nothing)`);
    }
  }

  // ── water ──
  for (const w of byClass('WaterBlock')) {
    if (!finite(w.scale, 3) || !w.scale.every((v) => v > 0)) add('error', 'water', `WaterBlock ${w.name} scale invalid`);
    else if (Number(w.gridElementSize) > Math.min(w.scale[0], w.scale[1])) add('warn', 'water', `WaterBlock ${w.name} gridElementSize ${w.gridElementSize} over its size`);
  }
  for (const r of byClass('River')) {
    if (!(r.nodes || []).length || !r.nodes.every((n) => finite(n, 8) && n[3] >= 0.25 && n[4] >= 0.25)) add('error', 'water', `River ${r.name} nodes not [x,y,z,width>=0.25,depth>=0.25,nx,ny,nz]`);
  }

  // ── decals ──
  const decalFile = `${base}main.decals.json`;
  if (nameSet.has(decalFile)) {
    try {
      const d = JSON.parse(await text(decalFile));
      const types = new Set();
      const dd = names.find((n) => n.startsWith(base) && n.endsWith('managedDecalData.json'));
      if (dd) for (const k of Object.keys(JSON.parse(await text(dd)))) types.add(k);
      // (v3.0: 15 values per instance with tiling; v2.0: 13, both read)
      const per = d.header?.version >= 3 ? 15 : 13;
      if (![2, 3].includes(Math.floor(d.header?.version))) add('warn', 'decals', `main.decals.json version ${d.header?.version}`);
      for (const [type, list] of Object.entries(d.instances || {})) {
        if (types.size && !types.has(type)) add('error', 'decals', `decal type ${type} not in managedDecalData`);
        if (!list.every((v) => Array.isArray(v) && v.length === per && v.every(Number.isFinite))) add('error', 'decals', `decal ${type} instances not ${per} finite numbers (version ${d.header?.version})`);
      }
    } catch { /* reported */ }
  }

  // ── tunnels (zone culling: a Zone and Portals for every tunnel) ──
  const tunnelShapes = byClass('TSStatic').filter((o) => /\/tunnels?\//.test(String(o.shapeName)));
  if (tunnelShapes.length && !byClass('Zone').length) add('error', 'tunnels', `${tunnelShapes.length} tunnel object(s) but no Zone`);
  if (byClass('Zone').length && !byClass('Portal').length) add('error', 'tunnels', 'Zones without Portals: the world goes dark through every opening');

  // ── spawn ──
  for (const s of byClass('SpawnSphere')) {
    if (!finite(s.position, 3)) add('error', 'spawn', `SpawnSphere ${s.name} position invalid`);
    else if (!inTerrain(s.position[0], s.position[1], 0)) add('error', 'spawn', `SpawnSphere ${s.name} is off the terrain`);
  }

  return { level, findings, counts };
}
