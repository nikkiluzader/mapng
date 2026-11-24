// The coverage level's test area: a synthetic place built from MapNG's own lists, so every tag MapNG builds, every
// game model it places and every model it generates appears in one level, without exporting a real town to test
// them (the user, 2026-11-24: "a full coverage synthetic test ... so we dont have to keep exporting a level from the
// real world to test our assets"). scripts/coverage/README.md has the whole flow.
//
//   node scripts/coverage/buildCoverageArea.mjs [region]      region: na_east | na_west | europe | tropical | asia | all
//
// Writes scratch/levelprobe/data/coverage_<region>/ (MAPNG_AREAS): meta.json, mh.f32 (the heightmap), osm.json (the
// features, through the app's own Overpass reader), landcover.bin (every WorldCover class) and tree_mix.json (every
// tree kind), so the export (scripts/sweep/exportArea.mjs) runs offline. The layout (x east, y north, metres from the
// centre; the area is 1024 m a side at 1 m):
//   - the sea west of x = -440 (coastline, a pier, a quay road along it);
//   - a river along y = -470 to the sea, bridged by one road bridge of each structure type and a footbridge;
//   - a hill at (0, 300), 40 m high, a road tunnel and a rail tunnel through it, a lake beside it;
//   - a railway along y = 200 with a level crossing on the coast road and a siding off a switch;
//   - power lines along y = 470 (towers), y = 430 (on poles, with a minor line meeting it at a shared node);
//   - a grid of plots between y = -410 and y = 150, one per tag of data/osm-tag-library.json MapNG builds (and each
//     tag's `also`), every plot beside a residential street with sidewalks; tags that live on a road (signals,
//     crossings, stop signs, speed bumps, gates) go on the street's own nodes.
import fs from 'node:fs';
import path from 'node:path';

globalThis.location ||= { protocol: 'https:' };
const store = new Map(); globalThis.localStorage ||= { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const AREAS = process.env.MAPNG_AREAS || path.join(REPO, 'scratch/levelprobe/data');
// Regional looks are picked from the place (services/regionalLook.js and friends): one centre per look.
export const REGIONS = {
  na_east: { lat: 39.95, lng: -75.17, label: 'East Coast USA' },
  na_west: { lat: 34.05, lng: -118.25, label: 'West Coast USA' },
  europe: { lat: 43.77, lng: 11.25, label: 'Italy / Europe' },
  tropical: { lat: 18.45, lng: -66.07, label: 'Tropical' },
  asia: { lat: 35.68, lng: 139.77, label: 'Japan / Asia' },
};
const SIZE = 1024; const MPP = 1; const HALF = (SIZE * MPP) / 2;
// layout
const COAST_X = -440; const RIVER_Y = -470; const HILL = { x: 0, y: 300, r: 100, h: 40 };
const RAIL_Y = 200; const ROAD_TUNNEL_Y = 320; const RAIL_TUNNEL_Y = 280;
const PLOT = 40; const PLOT_X0 = -400; const PLOT_X1 = 500; const PLOT_Y0 = -410; const PLOT_Y1 = 150;
// property tags that only mean something on a road: put on a short street in their plot
const ROAD_PROPERTY = /^(bridge|tunnel|sidewalk|maxspeed|priority_road|junction|lanes|surface|lit|oneway|cycleway|parking:lane|turn:lanes|width|hazard)=/;
// a wildcard's stand-in value
const STAND_IN = { shop: 'supermarket', amenity: 'bench', bridge: 'yes', tunnel: 'yes', sidewalk: 'both', maxspeed: '50', priority_road: 'designated', hazard: 'curve', man_made: 'tower', craft: 'carpenter', office: 'company', tourism: 'attraction', historic: 'memorial' };
// tags whose node belongs on a road
const ON_ROAD = /^(highway=(traffic_signals|crossing|stop|give_way|mini_roundabout|turning_circle|speed_camera|street_lamp|bus_stop|motorway_junction)|traffic_calming=|barrier=(gate|lift_gate|bollard|swing_gate|toll_booth|cattle_grid|kerb|block|cycle_barrier|chain|border_control))/;

export function heightAt(x, y) {
  let h = 20;
  const d2 = (x - HILL.x) ** 2 + (y - HILL.y) ** 2;
  h += HILL.h * Math.exp(-d2 / (2 * HILL.r * HILL.r));
  // the river valley: 5 m down, 50 m wide, easing out
  const dv = Math.abs(y - RIVER_Y); if (dv < 60) h -= 5 * Math.max(0, 1 - (dv / 60) ** 2);
  // the coast: down to the sea floor west of the coastline over 30 m
  if (x < COAST_X + 30) h = Math.min(h, 20 - Math.min(26, (COAST_X + 30 - x) * 0.6));
  return h;
}

export function buildCoverage(regionKey) {
  const R = REGIONS[regionKey]; if (!R) throw new Error(`unknown region ${regionKey}`);
  const kx = 111320 * Math.cos((R.lat * Math.PI) / 180); const ky = 111320;
  const ll = (x, y) => ({ lat: R.lat + y / ky, lon: R.lng + x / kx });
  const bounds = { north: R.lat + HALF / ky, south: R.lat - HALF / ky, east: R.lng + HALF / kx, west: R.lng - HALF / kx };
  let nid = 1; let wid = 1; let rid = 1;
  const nodes = new Map();   // "x,y" -> node element (shared nodes by position)
  const elements = [];
  const node = (x, y, tags) => {
    const k = `${x.toFixed(2)},${y.toFixed(2)}`;
    let n = nodes.get(k);
    if (!n) { n = { type: 'node', id: nid++, ...ll(x, y) }; nodes.set(k, n); elements.push(n); }
    if (tags) n.tags = { ...(n.tags || {}), ...tags };
    return n;
  };
  const way = (pts, tags) => {
    const ns = pts.map(([x, y, t]) => node(x, y, t));
    const w = { type: 'way', id: wid++, nodes: ns.map((n) => n.id), geometry: ns.map((n) => ({ lat: n.lat, lon: n.lon })), tags };
    elements.push(w); return w;
  };
  const area = (cx, cy, w, h, tags) => way([[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2], [cx - w / 2, cy - h / 2]], tags);
  const line = (x0, y0, x1, y1, step, tags, nodeTag) => {
    const L = Math.hypot(x1 - x0, y1 - y0); const n = Math.max(1, Math.round(L / step)); const pts = [];
    for (let i = 0; i <= n; i++) pts.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, nodeTag ? nodeTag(i, n) : undefined]);
    return way(pts, tags);
  };
  const placed = [];   // what each plot holds, for the report

  // ── the sea, the coast, the river, the hill ──
  line(COAST_X, HALF + 20, COAST_X, -HALF - 20, 40, { natural: 'coastline' });
  // (the coast road: a node every 30 m and wherever a plot street, the railway or the pier road meets it)
  {
    const rowsY = []; for (let y = PLOT_Y0; y < PLOT_Y1; y += PLOT) rowsY.push(y);
    const ys = new Set([...rowsY, RAIL_Y, 40]); for (let y = -HALF + 10; y <= HALF - 10; y += 30) ys.add(y);
    way([...ys].sort((a, b) => b - a).map((y) => [COAST_X + 10, y]), { highway: 'secondary', name: 'Coast Road', lanes: '2' });
  }
  way([[COAST_X, 40], [COAST_X - 60, 40]], { man_made: 'pier', name: 'Coverage Pier' });
  // (the river, its water area, and the bridges: one per structure type, and a footbridge)
  line(HALF + 20, RIVER_Y, COAST_X - 20, RIVER_Y, 25, { waterway: 'river', name: 'Coverage River' });
  area((HALF + COAST_X) / 2, RIVER_Y, HALF - COAST_X + 40, 30, { natural: 'water', water: 'river' });
  const bridges = [null, 'truss', 'arch', 'humpback', 'suspension', 'cable-stayed'];
  bridges.forEach((st, i) => {
    const x = -300 + i * 120;
    way([[x, RIVER_Y - 70], [x, RIVER_Y - 25]], { highway: 'tertiary', name: `Bridge Road ${i}` });
    way([[x, RIVER_Y - 25], [x, RIVER_Y + 25]], { highway: 'tertiary', bridge: 'yes', layer: '1', name: `Bridge Road ${i}`, ...(st ? { 'bridge:structure': st } : {}) });
    way([[x, RIVER_Y + 25], [x, RIVER_Y + 40]], { highway: 'tertiary', name: `Bridge Road ${i}` });
    placed.push({ what: `road bridge, structure ${st || 'beam'}`, at: [x, RIVER_Y] });
  });
  way([[420, RIVER_Y - 30], [420, RIVER_Y - 20]], { highway: 'footway' });
  way([[420, RIVER_Y - 20], [420, RIVER_Y + 20]], { highway: 'footway', bridge: 'yes', layer: '1' });
  way([[420, RIVER_Y + 20], [420, RIVER_Y + 30]], { highway: 'footway' });
  placed.push({ what: 'footbridge', at: [420, RIVER_Y] });
  area(-180, 300, 90, 60, { natural: 'water', name: 'Coverage Lake' });
  // (tunnels through the hill: a road and a railway)
  way([[-250, ROAD_TUNNEL_Y], [-110, ROAD_TUNNEL_Y]], { highway: 'secondary', name: 'Tunnel Road' });
  way([[-110, ROAD_TUNNEL_Y], [110, ROAD_TUNNEL_Y]], { highway: 'secondary', tunnel: 'yes', layer: '-1', name: 'Tunnel Road' });
  way([[110, ROAD_TUNNEL_Y], [250, ROAD_TUNNEL_Y]], { highway: 'secondary', name: 'Tunnel Road' });
  // ── the railway: along y = RAIL_Y, a level crossing on the coast road, a siding, a rail tunnel ──
  {
    const xs = [COAST_X - 20, COAST_X + 10]; for (let x = -400; x <= HALF + 20; x += 40) xs.push(x);
    way(xs.map((x) => [x, RAIL_Y, x === COAST_X + 10 ? { railway: 'level_crossing' } : undefined]), { railway: 'rail', usage: 'main', gauge: '1435', name: 'Coverage Line' });
  }
  way([[-40, RAIL_Y], [60, RAIL_Y - 12], [200, RAIL_Y - 12]], { railway: 'rail', service: 'siding' });
  node(-40, RAIL_Y, { railway: 'switch' });
  way([[-250, RAIL_TUNNEL_Y], [-100, RAIL_TUNNEL_Y]], { railway: 'rail', usage: 'branch' });
  way([[-100, RAIL_TUNNEL_Y], [100, RAIL_TUNNEL_Y]], { railway: 'rail', usage: 'branch', tunnel: 'yes', layer: '-1' });
  way([[100, RAIL_TUNNEL_Y], [250, RAIL_TUNNEL_Y]], { railway: 'rail', usage: 'branch' });
  way([[COAST_X + 40, RAIL_Y - 8], [COAST_X + 140, RAIL_Y - 8]], { railway: 'platform' });
  // ── power: on towers, on poles, a minor line meeting the pole line at a shared node ──
  line(-450, 470, 480, 470, 240, { power: 'line', voltage: '220000' }, () => ({ power: 'tower' }));
  line(-450, 430, 480, 430, 80, { power: 'line' }, () => ({ power: 'pole' }));
  way([[120, 430, { power: 'pole' }], [120, 380, { power: 'pole' }], [160, 360, { power: 'pole' }]], { power: 'minor_line' });

  // ── the plots: one per tag MapNG builds ──
  const lib = JSON.parse(fs.readFileSync(path.join(REPO, 'data/osm-tag-library.json'), 'utf8'));
  const wanted = [];
  for (const [tag, e] of Object.entries(lib.tags)) {
    if (e.status !== 'built' && e.status !== 'partial') continue;
    wanted.push({ tag, on: e.on, group: e.group });
    for (const also of e.also || []) wanted.push({ tag: also, on: e.on, group: e.group, also: tag });
  }
  // (a few the plots need with their values spelled out: every sport on a pitch, every surface of a road)
  const SPORTS = ['soccer', 'tennis', 'basketball', 'baseball', 'american_football', 'volleyball', 'running', 'golf', 'skateboard', 'multi'];
  for (const sport of SPORTS) wanted.push({ tag: 'leisure=pitch', on: ['area'], extra: { sport, lit: 'yes' } });
  const cols = Math.floor((PLOT_X1 - PLOT_X0) / PLOT); const rows = Math.floor((PLOT_Y1 - PLOT_Y0) / PLOT);
  if (wanted.length > cols * rows) throw new Error(`${wanted.length} plots wanted, the grid holds ${cols * rows}: widen it`);
  // (the streets: one along the south side of each plot row, with sidewalks)
  const streetNodes = [];
  for (let r = 0; r < rows; r++) {
    const y = PLOT_Y0 + r * PLOT;
    const pts = []; for (let c = 0; c <= cols; c++) pts.push([PLOT_X0 + c * PLOT, y]);
    for (let c = 0; c < cols; c++) pts.push([PLOT_X0 + c * PLOT + PLOT / 2, y]);
    pts.sort((a, b) => a[0] - b[0]);
    pts.unshift([COAST_X + 10, y]);   // (joined to the coast road)
    way(pts, { highway: 'residential', name: `Plot Street ${r + 1}`, sidewalk: 'both', lanes: '2' });
    streetNodes.push(y);
  }
  wanted.forEach((w, i) => {
    const c = i % cols; const r = Math.floor(i / cols);
    const x0 = PLOT_X0 + c * PLOT; const y0 = PLOT_Y0 + r * PLOT;
    const cx = x0 + PLOT / 2; const cy = y0 + PLOT / 2 + 3;
    const [k, v] = w.tag.split('='); const tags = { [k]: v === '*' ? (STAND_IN[k] || 'yes') : v, name: `cov ${w.tag}`, ...(w.extra || {}) };
    if (k === 'building' || tags.building) Object.assign(tags, { 'building:levels': String(1 + (i % 4)) });
    // (a water= tag describes a water area)
    if (k === 'water') tags.natural = 'water';
    let kind;
    if (ROAD_PROPERTY.test(w.tag)) {
      // (on a short road of its own, joined to the plot street: a roundabout as a closed loop)
      if (w.tag === 'junction=roundabout') { const r0 = 10; const pts = []; for (let a = 0; a <= 12; a++) pts.push([cx + r0 * Math.cos((a / 12) * 2 * Math.PI), cy + r0 * Math.sin((a / 12) * 2 * Math.PI)]); pts[12] = pts[0]; way(pts, { highway: 'residential', ...tags }); }
      else way([[cx, y0], [cx, y0 + PLOT - 6]], { highway: 'residential', ...tags, ...(k === 'bridge' ? { layer: '1' } : k === 'tunnel' ? { layer: '-1' } : {}) });
      kind = 'on a road';
    } else if (w.on.includes('node') && ON_ROAD.test(w.tag)) { node(cx, y0, tags); kind = 'node on the street'; }
    else if (w.on.includes('area')) { area(cx, cy, 24, 24, tags); kind = 'area'; }
    else if (w.on.includes('way')) { way([[x0 + 4, cy], [x0 + PLOT - 4, cy]], tags); kind = 'way'; }
    else { node(cx, cy, tags); kind = 'node'; }
    placed.push({ what: w.tag + (w.extra ? ` ${JSON.stringify(w.extra)}` : ''), kind, at: [Math.round(cx), Math.round(cy)], also: w.also });
  });
  return { region: regionKey, label: R.label, center: { lat: R.lat, lng: R.lng }, bounds, elements, placed };
}

async function writeArea(regionKey) {
  const cov = buildCoverage(regionKey);
  const name = `coverage_${regionKey}`; const dir = path.join(AREAS, name);
  fs.mkdirSync(dir, { recursive: true });
  const { parseOverpassResponse } = await import('../../services/osm.js');
  const features = parseOverpassResponse({ elements: cov.elements }, cov.bounds);
  fs.writeFileSync(path.join(dir, 'osm.json'), JSON.stringify(features));
  // the heightmap: rows from the north, as the areas' f32 files
  const h = new Float32Array(SIZE * SIZE);
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) h[r * SIZE + c] = heightAt((c + 0.5) * MPP - HALF, HALF - (r + 0.5) * MPP);
  // (the same heights under every name the tools read: mh for the export, t30 for the game texture painter)
  for (const f of ['mh.f32', 't30.f32']) fs.writeFileSync(path.join(dir, f), Buffer.from(h.buffer));
  // every WorldCover class, in bands across the north-east (10 m cells, rows from the north)
  const lcN = Math.ceil((SIZE * MPP) / 10); const lc = new Uint8Array(lcN * lcN).fill(30);
  const CLASSES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100];
  for (let r = 0; r < lcN; r++) for (let c = 0; c < lcN; c++) {
    const x = (c + 0.5) * 10 - HALF; const y = HALF - (r + 0.5) * 10;
    if (x < COAST_X) lc[r * lcN + c] = 80;
    else if (y > 180) lc[r * lcN + c] = CLASSES[Math.floor(((x + HALF) / (2 * HALF)) * CLASSES.length) % CLASSES.length];
    else lc[r * lcN + c] = 50;
  }
  fs.writeFileSync(path.join(dir, 'landcover.bin'), Buffer.from(lc));
  // every tree kind, equally (services/treeSpecies.js kinds)
  const KINDS = ['palm', 'live_oak', 'oak', 'broadleaf', 'conifer', 'juniper', 'eucalyptus', 'olive', 'cypress', 'tropical'];
  fs.writeFileSync(path.join(dir, 'tree_mix.json'), JSON.stringify({ shares: Object.fromEntries(KINDS.map((k) => [k, 1 / KINDS.length])), records: 1000 }, null, 1));
  const meta = { name, center: cov.center, size: SIZE, mpp: MPP, fetchBounds: cov.bounds, bounds: cov.bounds, gpxzSmooth: false, mh: { zoom: 17, metersPerPixel: MPP, lidarFraction: 1, tiles: 0 }, synthetic: true, coverage: { region: regionKey, label: cov.label } };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 1));
  fs.writeFileSync(path.join(dir, 'coverage_plan.json'), JSON.stringify({ region: regionKey, label: cov.label, placed: cov.placed }, null, 1));
  // (no cached game texture from an earlier layout)
  if (fs.existsSync(path.join(dir, 'gametex.png'))) fs.unlinkSync(path.join(dir, 'gametex.png'));
  console.log(`${name}: ${features.length} features, ${cov.placed.length} plots and structures (${cov.label}) -> ${path.relative(REPO, dir)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2] || 'na_east';
  for (const k of arg === 'all' ? Object.keys(REGIONS) : [arg]) await writeArea(k);
  process.exit(0);
}
