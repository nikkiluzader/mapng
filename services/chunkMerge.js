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

const LEVEL_WIDE = new Set(['TerrainBlock', 'LevelInfo', 'ScatterSky', 'TimeOfDay', 'CloudLayer', 'SkyBox', 'Sun', 'WaterPlane', 'SpawnSphere', 'CameraBookmark', 'BeamNGWorldIconsRenderer', 'CubemapData', 'Precipitation', 'Forest', 'ForestWindEmitter', 'GroundCover', 'TerrainMaterialSet', 'SFXEmitter']);
const LINES = new Set(['DecalRoad', 'River', 'MeshRoad']);
// (level files every chunk has a part of: joined here, see mergeLevelData)
const JOINED = new Set(['city.sites.json', 'signals.json', 'mapng_probes.json']);
const SITES_MAX_SPOTS = 3000;   // (BeamNG's Sites loader is n² log n: as exportBeamNGLevel.js SITES_MAX_PARKING_SPOTS)

const mv = (p, dx, dy, dz) => (Array.isArray(p) ? [p[0] + dx, p[1] + dy, (p[2] || 0) + dz, ...p.slice(3)] : p);

/**
 * The level files each chunk holds a part of, joined: data { sites, signals, probes } (null until the first chunk),
 * one chunk's parsed files `part`, moved by (dx, dy, dz); `n` the chunk's index (signal ids get their own block).
 */
export function mergeLevelData(data, part, dx, dy, dz, key, n) {
  const out = data || { sites: null, signals: { instances: [], controllers: [], sequences: [] }, probes: null };
  if (part.sites) {
    const s = part.sites;
    const zones = (s.zones || []).map((z) => ({ ...z, name: `${z.name}`, vertices: (z.vertices || []).map((v) => mv(v, dx, dy, dz)), top: z.top ? { ...z.top, pos: mv(z.top.pos, dx, dy, dz) } : z.top, bot: z.bot ? { ...z.bot, pos: mv(z.bot.pos, dx, dy, dz) } : z.bot }));
    const spots = (s.parkingSpots || []).map((sp) => ({ ...sp, name: sp.name ? `${sp.name}_c${key}` : sp.name, pos: mv(sp.pos, dx, dy, dz) }));
    if (!out.sites) out.sites = { ...s, zones: [], parkingSpots: [] };
    out.sites.zones.push(...zones); out.sites.parkingSpots.push(...spots);
  }
  if (part.signals) {
    const off = (n + 1) * 1000000; const id = (v) => (Number(v) > 0 ? Number(v) + off : v);
    const g = part.signals;
    out.signals.controllers.push(...(g.controllers || []).map((c) => ({ ...c, id: id(c.id) })));
    out.signals.sequences.push(...(g.sequences || []).map((q) => ({ ...q, id: id(q.id), name: `${q.name}_c${key}`, phases: (q.phases || []).map((ph) => ({ ...ph, controllerIds: (ph.controllerIds || []).map(id) })) })));
    out.signals.instances.push(...(g.instances || []).map((i) => ({ ...i, id: id(i.id), name: `${i.name}_c${key}`, controllerId: id(i.controllerId), sequenceId: id(i.sequenceId), group: i.group ? `${i.group}_c${key}` : i.group, pos: mv(i.pos, dx, dy, dz) })));
  }
  if (part.probes) {
    const pr = part.probes;
    if (!out.probes) out.probes = { ...pr, probes: [], lines: [] };
    out.probes.probes.push(...(pr.probes || []).map((q) => ({ ...q, x: q.x + dx, y: q.y + dy, z: q.z + dz })));
    out.probes.lines.push(...(pr.lines || []).map((l) => ({ ...l, p: (l.p || []).map((v) => mv(v, dx, dy, dz)) })));
  }
  return out;
}

/**
 * Roads cut at a seam joined back into one: two DecalRoads from different chunks with an end at the same point
 * (within `tol` m), the same material, width, one-way and drivability, become one road (the first's name and group),
 * so the game's road graph runs across the seam. A second pass joins ends up to `near` m apart when each is the
 * other's nearest (the two chunks can place a road a few cm apart); the joint is their midpoint. roads:
 * [{ o (the object), chunk }]; returns { removed (objects), joins }.
 */
export function joinSeamRoads(roads, tol = 0.05, near = 0.3) {
  const removed = new Set();
  const endOf = (r, at) => (at === 'first' ? r.o.nodes[0] : r.o.nodes.at(-1));
  const same = (a, b) => a.material === b.material && !!a.oneWay === !!b.oneWay && (a.drivability ?? 1) === (b.drivability ?? 1);
  let joins = 0;
  const join = (a, b) => {
    if (a.r.chunk === b.r.chunk || a.r === b.r || removed.has(a.r.o) || removed.has(b.r.o) || !same(a.r.o, b.r.o)) return false;
    const pa = endOf(a.r, a.at); const pb = endOf(b.r, b.at);
    if (Math.abs((pa[3] ?? 0) - (pb[3] ?? 0)) > 0.05) return false;
    let A = a; let B = b;
    if (A.at === 'first' && B.at === 'last') { A = b; B = a; }
    if ((A.at === 'first' || B.at === 'last') && A.r.o.oneWay) return false;   // (a one-way road is never reversed)
    const na = A.at === 'last' ? A.r.o.nodes : [...A.r.o.nodes].reverse();
    const nb = B.at === 'first' ? B.r.o.nodes : [...B.r.o.nodes].reverse();
    const j = na.at(-1).map((v, i) => (i < 3 ? (v + nb[0][i]) / 2 : v));
    A.r.o.nodes = [...na.slice(0, -1), j, ...nb.slice(1)];
    if (Array.isArray(A.r.o.position)) A.r.o.position = A.r.o.nodes[0].slice(0, 3);
    removed.add(B.r.o); joins++;
    // (B's other end is now A's last; A's ends are re-read from its nodes)
    B.r.joinedInto = A.r;
    return true;
  };
  const live = (e) => { let r = e.r; while (r.joinedInto) r = r.joinedInto; return r; };
  const endsList = () => {
    const out = [];
    for (const r of roads) if (!removed.has(r.o) && !r.joinedInto) for (const at of ['first', 'last']) out.push({ r, at, p: endOf(r, at) });
    return out;
  };
  // pass 1: exact meetings, per material (a road's surface and its painted lines meet at the same points); only a
  // plain meeting of two ends of one material, a junction on the seam stays as it is
  const k = (p) => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)}|`;
  const buckets = new Map();
  for (const e of endsList()) { const key = k(e.p) + e.r.o.material; if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(e); }
  for (const g of buckets.values()) if (g.length === 2) join({ r: live(g[0]), at: g[0].at }, { r: live(g[1]), at: g[1].at });
  // pass 2: near meetings, mutual nearest of the same material from another chunk
  const rest = endsList();
  const cell = (p) => `${Math.floor(p[0] / near)},${Math.floor(p[1] / near)}`;
  const grid = new Map();
  for (const e of rest) { const c = cell(e.p); if (!grid.has(c)) grid.set(c, []); grid.get(c).push(e); }
  const nearest = (e) => {
    let best = null; let bd = near; const [cx, cy] = cell(e.p).split(',').map(Number);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const f of grid.get(`${cx + dx},${cy + dy}`) || []) {
      if (f.r === e.r || f.r.chunk === e.r.chunk || f.r.o.material !== e.r.o.material) continue;
      const d = Math.hypot(f.p[0] - e.p[0], f.p[1] - e.p[1]); if (d < bd) { bd = d; best = f; }
    }
    return best;
  };
  for (const e of rest) {
    if (removed.has(e.r.o) || e.r.joinedInto) continue;
    const f = nearest(e); if (!f || removed.has(f.r.o) || f.r.joinedInto || nearest(f) !== e) continue;
    join(e, f);
  }
  return { removed, joins };
}

/** At most `max` spots, spread: every k-th (the exporter's own sampler keeps neighbourhoods; this keeps its order). */
function capSpots(spots, max = SITES_MAX_SPOTS) {
  if (spots.length <= max) return spots;
  const step = spots.length / max; const out = [];
  for (let i = 0; i < max; i++) out.push(spots[Math.floor(i * step)]);
  return out;
}

/** Text with the chunk's level paths rewritten: its own assets to chunks/<key>/, the game's bundled models to the root. */
export function rewritePaths(text, fromLevel, toLevel, key) {
  return text
    .split(`levels/${fromLevel}/map_assets/official_assets/`).join(`levels/${toLevel}/__OFFICIAL__/`)
    // (the anchor terrain's files are level-wide, kept at the root)
    .split(`levels/${fromLevel}/art/terrains/terrain.`).join(`levels/${toLevel}/__OFFICIAL__/../art/terrains/terrain.`)
    .split(`levels/${fromLevel}/`).join(`levels/${toLevel}/chunks/${key}/`)
    .split(`levels/${toLevel}/__OFFICIAL__/../art/terrains/terrain.`).join(`levels/${toLevel}/art/terrains/terrain.`)
    .split(`levels/${toLevel}/__OFFICIAL__/`).join(`levels/${toLevel}/map_assets/official_assets/`)
    .split('mapng_ground_').join(`mapng_ground_c${key}_`);
}

/** One object line moved by (dx, dy, dz) and renamed for the chunk. */
export function moveObject(o, dx, dy, dz, key) {
  const out = { ...o };
  if (Array.isArray(out.position)) out.position = [out.position[0] + dx, out.position[1] + dy, (out.position[2] || 0) + dz];
  if (LINES.has(out.class) && Array.isArray(out.nodes)) out.nodes = out.nodes.map((n) => [n[0] + dx, n[1] + dy, n[2] + dz, ...n.slice(3)]);
  // (level-wide objects keep their names: info.json and the game look them up, e.g. the spawn point, theForest)
  if (out.class !== 'SimGroup' && !LEVEL_WIDE.has(out.class) && typeof out.name === 'string' && out.name) out.name = `${out.name}_c${key}`;
  return out;
}

/**
 * Merge chunk zips into one level: chunks [{ zip (JSZip), key, levelName (the chunk's), offsetM: { x, y }, minHeight }],
 * the level's name; returns a JSZip of the level. JSZip is passed in (works in the browser and in Node).
 */
export async function mergeChunks(JSZip, chunks, levelName, { log = () => {}, bounds = null } = {}) {
  const out = new JSZip();
  const levelMin = Math.min(...chunks.map((c) => Number(c.minHeight) || 0));
  const gathered = new Map();   // path -> lines (items, forest) or decal instances
  const materials = new Map();  // path -> merged object
  let first = true; let joined = null; let n = 0;
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
      if (JOINED.has(rel)) {
        const j = JSON.parse(await f.async('string'));
        joined = mergeLevelData(joined, rel === 'city.sites.json' ? { sites: j } : rel === 'signals.json' ? { signals: j } : { probes: j }, dx, dy, dz, c.key, n);
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
          // (the anchor terrain's materials point at textures kept with the first chunk's assets)
          let text = isText ? await f.async('string') : null;
          if (text && rel === 'art/terrains/main.materials.json') text = text.split(`levels/${c.levelName}/art/terrains/`).join(`levels/${levelName}/chunks/${c.key}/art/terrains/`);
          out.file(`levels/${levelName}/${rel}`, isText ? text.split(`levels/${c.levelName}/`).join(`levels/${levelName}/`) : await f.async('uint8array'));
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
    first = false; n++;
  }
  if (joined?.sites) {
    const s = joined.sites; const all = s.parkingSpots.length; s.parkingSpots = capSpots(s.parkingSpots);
    s.dir = `/levels/${levelName}/`;
    out.file(`levels/${levelName}/city.sites.json`, JSON.stringify(s));
    log(`sites: ${s.zones.length} zone(s), ${s.parkingSpots.length} parking spot(s)${all > s.parkingSpots.length ? ` (of ${all}, capped for the game's loader)` : ''}`);
  }
  if (joined?.signals) {
    out.file(`levels/${levelName}/signals.json`, JSON.stringify(joined.signals, null, 2));
    log(`signals: ${joined.signals.instances.length} instance(s), ${joined.signals.controllers.length} controller(s), ${joined.signals.sequences.length} sequence(s)`);
  }
  if (joined?.probes) {
    if (bounds) joined.probes.geo = { ...(joined.probes.geo || {}), bounds, worldSize: joined.probes.geo?.worldSize };
    out.file(`levels/${levelName}/mapng_probes.json`, JSON.stringify(joined.probes));
  }
  // roads cut at the seams joined back into one each (the game's road graph then runs across)
  {
    const roads = [];
    for (const [path, lines] of gathered) {
      if (path === 'decals' || !path.endsWith('items.level.json')) continue;
      lines.forEach((l, i) => { if (l.includes('"DecalRoad"')) { const o = JSON.parse(l); if (Array.isArray(o.nodes) && o.nodes.length >= 2) roads.push({ o, chunk: String(o.name).split('_c').at(-1), path, i }); } });
    }
    const { removed, joins } = joinSeamRoads(roads);
    for (const r of roads) { const list = gathered.get(r.path); list[r.i] = removed.has(r.o) ? null : JSON.stringify(r.o); }
    for (const [path, lines] of gathered) if (path !== 'decals') gathered.set(path, lines.filter((l) => l !== null));
    log(`roads: ${joins} piece pair(s) cut at a seam joined back into one road`);
  }
  for (const [path, lines] of gathered) {
    if (path === 'decals') out.file(`levels/${levelName}/main.decals.json`, JSON.stringify(lines, null, 2));
    else out.file(path, lines.length ? lines.join('\n') + '\n' : '');
  }
  for (const [path, obj] of materials) out.file(path, JSON.stringify(obj, null, 2));
  return out;
}
