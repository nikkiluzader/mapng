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
// (single objects of other classes: the MapNG flag at the spawn)
const LEVEL_WIDE_NAMES = new Set(['mapng_flag_marker']);
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
 * Roads cut at a seam joined back into one: two DecalRoads with an end at the same place, cut there by two different
 * chunks, with the same material, width, one-way and drivability, become one road (the first's name and group), so
 * the game's road graph runs across the seam.
 *
 * Two ends are one cut when they lie within `near` m of each other on the map AND within `dzMax` m in height (a
 * street and the viaduct over it, cut at the same seam point, are two cuts, each joined to its own other half), and
 * when each is the other's only such end: where three or more meet (a junction on the seam), nothing is joined and
 * the junction stays as the chunks built it. The joint is the two ends' midpoint. Joining runs until nothing is left
 * to join, so a road crossing several seams becomes one road again whatever order its pieces come in (until
 * 2026-11-23 the ends were read once, and the middle piece of three left the third unjoined).
 * roads: [{ o (the object), chunk }]; returns { removed (objects), joins, ambiguous (ends left because more than one
 * end could be their other half) }.
 */
export function joinSeamRoads(roads, near = 0.3, dzMax = 0.5) {
  const removed = new Set();
  // which chunk cut each end (a joined road's far end is the far piece's)
  for (const r of roads) r.ends = { first: r.chunk, last: r.chunk };
  const endOf = (r, at) => (at === 'first' ? r.o.nodes[0] : r.o.nodes[r.o.nodes.length - 1]);
  const same = (a, b) => a.material === b.material && !!a.oneWay === !!b.oneWay && (a.drivability ?? 1) === (b.drivability ?? 1);
  let joins = 0; let ambiguous = 0;
  const fits = (e, f) => {
    if (e.r === f.r || e.r.ends[e.at] === f.r.ends[f.at] || !same(e.r.o, f.r.o)) return false;
    const pa = e.p; const pb = f.p;
    const dx = pa[0] - pb[0]; const dy = pa[1] - pb[1];
    if (dx * dx + dy * dy > near * near) return false;
    if (Math.abs((pa[2] ?? 0) - (pb[2] ?? 0)) > dzMax) return false;
    if (Math.abs((pa[3] ?? 0) - (pb[3] ?? 0)) > 0.05) return false;
    // (a one-way road is never turned round: its pieces only join head to tail)
    if (e.r.o.oneWay && e.at === f.at) return false;
    return true;
  };
  const join = (a, b) => {
    let A = a; let B = b;
    if (A.at === 'first' && B.at === 'last') { A = b; B = a; }
    const na = A.at === 'last' ? A.r.o.nodes : [...A.r.o.nodes].reverse();
    const nb = B.at === 'first' ? B.r.o.nodes : [...B.r.o.nodes].reverse();
    const endA = na[na.length - 1]; const j = endA.map((v, i) => (i < 3 ? (v + nb[0][i]) / 2 : v));
    // (A's ends after the join: its own far end, then B's far end)
    const farA = A.at === 'last' ? A.r.ends.first : A.r.ends.last; const farB = B.at === 'first' ? B.r.ends.last : B.r.ends.first;
    A.r.o.nodes = [...na.slice(0, -1), j, ...nb.slice(1)];
    A.r.ends = { first: farA, last: farB };
    if (Array.isArray(A.r.o.position)) A.r.o.position = A.r.o.nodes[0].slice(0, 3);
    removed.add(B.r.o); B.r.gone = true; joins++;
  };
  const cell = (p) => `${Math.floor(p[0] / near)},${Math.floor(p[1] / near)}`;
  // (each round reads the ends as they are now; a round with no join ends it. A road of k pieces takes at most
  // about log2 k rounds, since every piece may join one neighbour a round)
  for (let round = 0; round < 64; round++) {
    const ends = [];
    for (const r of roads) if (!r.gone) for (const at of ['first', 'last']) ends.push({ r, at, p: endOf(r, at) });
    const grid = new Map();
    for (const e of ends) { const c = cell(e.p); let g = grid.get(c); if (!g) { g = []; grid.set(c, g); } g.push(e); }
    const others = (e) => {
      const out = []; const cx = Math.floor(e.p[0] / near); const cy = Math.floor(e.p[1] / near);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const g = grid.get(`${cx + dx},${cy + dy}`); if (g) for (const f of g) if (fits(e, f)) out.push(f); }
      return out;
    };
    let joined = 0; ambiguous = 0; const used = new Set();
    for (const e of ends) {
      if (used.has(e.r) || e.r.gone) continue;
      const mine = others(e); if (!mine.length) continue;
      if (mine.length > 1) { ambiguous++; continue; }
      const f = mine[0]; if (used.has(f.r) || f.r.gone) continue;
      const theirs = others(f); if (theirs.length !== 1 || theirs[0].r !== e.r || theirs[0].at !== e.at) { ambiguous++; continue; }
      join(e, f); used.add(e.r); used.add(f.r); joined++;
    }
    if (!joined) break;
  }
  // what is left: ends of two chunks' pieces at one place in plan and not at one height (the two chunks solved the
  // road apart: a step in it at the seam)
  let stepped = 0; let worstStep = 0; const steps = [];
  {
    const ends = [];
    for (const r of roads) if (!r.gone) for (const at of ['first', 'last']) ends.push({ r, at, p: endOf(r, at) });
    const grid = new Map();
    for (const e of ends) { const c = cell(e.p); let g = grid.get(c); if (!g) { g = []; grid.set(c, g); } g.push(e); }
    const seen = new Set();
    for (const e of ends) {
      const cx = Math.floor(e.p[0] / near); const cy = Math.floor(e.p[1] / near);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const f of grid.get(`${cx + dx},${cy + dy}`) || []) {
        if (f.r === e.r || seen.has(f) || e.r.ends[e.at] === f.r.ends[f.at] || !same(e.r.o, f.r.o)) continue;
        const ddx = e.p[0] - f.p[0]; const ddy = e.p[1] - f.p[1]; if (ddx * ddx + ddy * ddy > near * near) continue;
        const dz = Math.abs((e.p[2] ?? 0) - (f.p[2] ?? 0)); if (dz > dzMax) { stepped++; if (dz > worstStep) worstStep = dz; steps.push({ x: e.p[0], y: e.p[1], dz, a: e.r.o.name, b: f.r.o.name }); }
      }
      seen.add(e);
    }
  }
  for (const r of roads) { delete r.ends; delete r.gone; }
  steps.sort((a, b) => b.dz - a.dz);
  return { removed, joins, ambiguous, stepped, worstStep, steps };
}

/**
 * Every items file's SimGroup lines made unique by name (the first kept). gathered: Map(path -> lines of NDJSON);
 * changed in place. Returns how many lines were removed.
 */
export function dedupeGroups(gathered) {
  let dropped = 0;
  for (const [path, lines] of gathered) {
    if (path === 'decals' || !path.endsWith('items.level.json')) continue;
    const seen = new Set();
    const kept = lines.filter((l) => {
      if (!l.includes('"SimGroup"')) return true;
      let o; try { o = JSON.parse(l); } catch { return true; }
      if (o.class !== 'SimGroup' || typeof o.name !== 'string') return true;
      if (seen.has(o.name)) { dropped++; return false; }
      seen.add(o.name); return true;
    });
    if (kept.length !== lines.length) gathered.set(path, kept);
  }
  return dropped;
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
 * The merge, a chunk at a time: createChunkMerger(sink, levelName, opts) -> { add(chunk), finish() }.
 * sink: { put(path, data) -> Promise|void, has(path) -> bool } (a JSZip, or services/zipStreamWriter.js); chunk:
 * { zip (JSZip), key, levelName (the chunk's), offsetM: { x, y }, minHeight }.
 * add() writes the chunk's own files to the sink at once (its assets are most of the level's bytes) and keeps only
 * the text the level's files are joined from (object and forest lines, decals, materials, sites, signals, probes);
 * the chunk's zip can go after it. finish() joins and writes those. Heights: every chunk is set at its own height
 * relative to refMinHeight (the first chunk's lowest point unless given): a whole-level shift only, which no file
 * depends on. A level built in 442 pieces held all 442 chunk zips until the merge before this (a tester's road).
 */
export function createChunkMerger(sink, levelName, { log = () => {}, bounds = null, levelInfo = null, refMinHeight = null } = {}) {
  const put = (path, data) => sink.put(path, data);
  const gathered = new Map();   // path -> lines (items, forest) or decal instances
  const materials = new Map();  // path -> merged object
  let first = true; let joined = null; let n = 0; let ref = Number.isFinite(Number(refMinHeight)) ? Number(refMinHeight) : null;
  async function add(c) {
    if (!Number.isFinite(Number(c.minHeight))) throw new Error(`chunk ${c.key} has no lowest height: it cannot be set at its height in the level`);
    if (ref === null) ref = Number(c.minHeight);
    const dx = c.offsetM.x; const dy = c.offsetM.y; const dz = Number(c.minHeight) - ref;
    const from = `levels/${c.levelName}/`;
    let objects = 0; let assets = 0;
    for (const name of Object.keys(c.zip.files)) {
      const f = c.zip.files[name]; if (f.dir || !name.startsWith(from)) continue;
      const rel = name.slice(from.length);
      const isItems = rel.endsWith('items.level.json');
      const isForest = /^forest\/.*\.forest4\.json$/.test(rel);
      if (isItems || isForest) {
        const text = rewritePaths(await f.async('string'), c.levelName, levelName, c.key);
        const lines = text.split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((o) => first || (!LEVEL_WIDE.has(o.class) && !LEVEL_WIDE_NAMES.has(o.name)))
          .map((o) => (isForest ? { ...o, pos: [o.pos[0] + dx, o.pos[1] + dy, o.pos[2] + dz] } : moveObject(o, dx, dy, dz, c.key)))
          // (the level's settings for the whole level, not the first chunk's: its view distance)
          .map((o) => (o.class === 'LevelInfo' && levelInfo ? { ...o, ...levelInfo } : o));
        const path = `levels/${levelName}/${rel}`;
        const list = gathered.get(path) || []; for (const o of lines) list.push(JSON.stringify(o)); gathered.set(path, list); objects += lines.length;
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
          const into = cur.instances[k] || (cur.instances[k] = []);
          for (const i of list) into.push(i.map((v, m) => (m === 3 ? v + dx : m === 4 ? v + dy : m === 5 ? v + dz : v)));
        }
        gathered.set('decals', cur); continue;
      }
      // (materials, and the forest's item types: one object per file, every chunk's entries joined; the forest's types
      // once at the root, as each chunk declares the same ones and the game refuses a type declared twice)
      if ((rel.endsWith('materials.json') && rel !== 'art/terrains/main.materials.json') || rel === 'art/forest/managedItemData.json') {
        const shared = rel.startsWith('map_assets/official_assets/') || rel === 'art/forest/managedItemData.json';
        const path = shared ? `levels/${levelName}/${rel}` : `levels/${levelName}/chunks/${c.key}/${rel}`;
        const obj = JSON.parse(rewritePaths(await f.async('string'), c.levelName, levelName, c.key));
        materials.set(path, { ...(materials.get(path) || {}), ...obj }); continue;
      }
      // the game's bundled models: once, at the level root
      if (rel.startsWith('map_assets/official_assets/')) {
        const path = `levels/${levelName}/${rel}`;
        if (!sink.has(path)) { await put(path, await f.async('uint8array')); assets++; }
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
          await put(`levels/${levelName}/${rel}`, isText ? text.split(`levels/${c.levelName}/`).join(`levels/${levelName}/`) : await f.async('uint8array'));
        }
        continue;
      }
      // the chunk's own assets
      const path = `levels/${levelName}/chunks/${c.key}/${rel}`;
      if (/\.(dae|json|lua|cs)$/.test(rel)) await put(path, rewritePaths(await f.async('string'), c.levelName, levelName, c.key));
      else await put(path, await f.async('uint8array'));
      assets++;
    }
    log(`chunk ${c.key}: moved by (${dx.toFixed(1)}, ${dy.toFixed(1)}, ${dz.toFixed(2)}) m; ${objects} object line(s), ${assets} asset file(s)`);
    first = false; n++;
  }
  async function finish() {
    if (joined?.sites) {
      const s = joined.sites; const all = s.parkingSpots.length; s.parkingSpots = capSpots(s.parkingSpots);
      s.dir = `/levels/${levelName}/`;
      await put(`levels/${levelName}/city.sites.json`, JSON.stringify(s));
      log(`sites: ${s.zones.length} zone(s), ${s.parkingSpots.length} parking spot(s)${all > s.parkingSpots.length ? ` (of ${all}, capped for the game's loader)` : ''}`);
    }
    if (joined?.signals) {
      await put(`levels/${levelName}/signals.json`, JSON.stringify(joined.signals, null, 2));
      log(`signals: ${joined.signals.instances.length} instance(s), ${joined.signals.controllers.length} controller(s), ${joined.signals.sequences.length} sequence(s)`);
    }
    if (joined?.probes) {
      if (bounds) joined.probes.geo = { ...(joined.probes.geo || {}), bounds, worldSize: joined.probes.geo?.worldSize };
      await put(`levels/${levelName}/mapng_probes.json`, JSON.stringify(joined.probes));
    }
    // A folder is listed once. Every chunk lists its own groups (MissionGroup's "Decal_Roads", a road's group, a
    // tunnel's), and the same folder then stood in its parent's list once per chunk: the game loads a folder once for
    // each line that names it, so a level of six chunks loaded its roads 6 x 6 x 4 times over (135,468 DecalRoads for
    // 965, eight minutes for a 768 x 512 m level; seen in game 2026-11-23). The first line is kept.
    {
      const dropped = dedupeGroups(gathered);
      log(`groups: ${dropped ? `${dropped} repeated group line(s) removed (each folder is listed once, or the game loads it once per line)` : 'no group is listed twice'}`);
    }
    // roads cut at the seams joined back into one each (the game's road graph then runs across)
    {
      const roads = [];
      for (const [path, lines] of gathered) {
        if (path === 'decals' || !path.endsWith('items.level.json')) continue;
        lines.forEach((l, i) => { if (l.includes('"DecalRoad"')) { const o = JSON.parse(l); if (Array.isArray(o.nodes) && o.nodes.length >= 2) roads.push({ o, chunk: String(o.name).split('_c').at(-1), path, i }); } });
      }
      const { removed, joins, ambiguous, stepped, worstStep, steps } = joinSeamRoads(roads);
      for (const r of roads) { const list = gathered.get(r.path); list[r.i] = removed.has(r.o) ? null : JSON.stringify(r.o); }
      for (const [path, lines] of gathered) if (path !== 'decals') gathered.set(path, lines.filter((l) => l !== null));
      log(`roads: ${roads.length} road piece(s) looked at; ${joins} pair(s) cut at a seam joined back into one road${ambiguous ? `; ${ambiguous} end(s) left as built, where more than two pieces meet (a junction on a seam)` : ''}; ${stepped ? `${stepped} pair(s) of ends at one place and NOT at one height (over 0.5 m, the worst ${worstStep.toFixed(2)} m): a step in the road at a seam` : 'no two ends at one place stand at different heights'}`);
      for (const st of steps.slice(0, 12)) log(`roads: step of ${st.dz.toFixed(2)} m at (${st.x.toFixed(0)}, ${st.y.toFixed(0)}) between ${st.a} and ${st.b}`);
      if (steps.length > 12) log(`roads: ... and ${steps.length - 12} more step(s)`);
    }
    for (const [path, lines] of gathered) {
      if (path === 'decals') await put(`levels/${levelName}/main.decals.json`, JSON.stringify(lines, null, 2));
      else await put(path, lines.length ? lines.join('\n') + '\n' : '');
    }
    for (const [path, obj] of materials) await put(path, JSON.stringify(obj, null, 2));
  }
  return { add, finish };
}

/**
 * Merge chunk zips into one level: chunks [{ zip (JSZip), key, levelName (the chunk's), offsetM: { x, y }, minHeight }],
 * the level's name; returns a JSZip of the level (createChunkMerger with a JSZip as the sink). Heights from the lowest
 * chunk, as before.
 */
export async function mergeChunks(JSZip, chunks, levelName, { log = () => {}, bounds = null, levelInfo = null } = {}) {
  const out = new JSZip();
  for (const c of chunks) if (!Number.isFinite(Number(c.minHeight))) throw new Error(`chunk ${c.key} has no lowest height: it cannot be set at its height in the level`);
  const merger = createChunkMerger({ put: (p, d) => { out.file(p, d); }, has: (p) => !!out.file(p) }, levelName, { log, bounds, levelInfo, refMinHeight: Math.min(...chunks.map((c) => Number(c.minHeight))) });
  for (const c of chunks) await merger.add(c);
  await merger.finish();
  return out;
}
