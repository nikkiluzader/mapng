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
// (2048 m at 1 m since 2026-11-24: the user asked for twice the room, every tree with space round it)
const SIZE = 2048; const MPP = 1; const HALF = (SIZE * MPP) / 2;
// layout
// (the hill well clear of the main line: across the hill's foot the line rose 13 m and came out on a viaduct)
const COAST_X = -900; const RIVER_Y = -940; const HILL = { x: 300, y: 720, r: 130, h: 55 };
const WATER_PAD = { x0: 462, x1: 1015, y0: 485, y1: 650 };   // the still-water block, flat ground
const RAIL_Y = 330; const ROAD_TUNNEL_Y = 760; const RAIL_TUNNEL_Y = 680;
const PLOT = 60; const PW = 60; const PLOT_X0 = -840; const PLOT_X1 = 1000; const PLOT_Y0 = -840; const PLOT_Y1 = -120;
const AREA_M = 30;   // a plot's area, in a 60 m plot
// footprints at their real size where the usual 30 m square is far off (the user, 2026-11-24): a shipping container
// is 12.2 x 2.44 m (a 40 ft box), a kiosk or a toilet block a few metres, a carport a car's bay or two
const REAL_SIZE = { 'building=container': [12.2, 2.44], 'building=kiosk': [4, 3], 'building=toilets': [6, 4], 'building=carport': [6, 5.5], 'building=hut': [5, 4], 'building=shed': [4, 3], 'building=garage': [6, 3.5] };
const TREE_GRID = { x0: -840, x1: 0, y0: -60, y1: 200, step: 30 };   // the arboretum: one tree per 30 m
// property tags that only mean something on a road: put on a short street in their plot
const ROAD_PROPERTY = /^(bridge|tunnel|sidewalk|maxspeed|priority_road|junction|lanes|surface|lit|oneway|cycleway|parking:lane|turn:lanes|width|hazard)=/;
// a wildcard's stand-in value
const STAND_IN = { shop: 'supermarket', amenity: 'bench', bridge: 'yes', tunnel: 'yes', sidewalk: 'both', maxspeed: '50', priority_road: 'designated', hazard: 'curve', man_made: 'tower', craft: 'carpenter', office: 'company', tourism: 'attraction', historic: 'memorial' };
// tags whose node belongs on a road
const ON_ROAD = /^(highway=(traffic_signals|crossing|mini_roundabout|turning_circle|speed_camera|street_lamp|bus_stop|motorway_junction)|traffic_calming=|barrier=(gate|lift_gate|swing_gate|sliding_gate|hampshire_gate|toll_booth|cattle_grid|border_control))/;
// tags that stand on a footway through a fence (walkers' gates; bollards and chains are left out on drivable roads)
const ON_PATH = /^barrier=(wicket_gate|kissing_gate|stile|turnstile|full-height_turnstile|bump_gate|entrance|bollard|block|kerb|cycle_barrier|chain)$/;
// signs that need a junction ahead: on a side road, on its approach to the plot street
const AT_JUNCTION = /^(highway=(stop|give_way)|traffic_sign=)/;
// tags that describe what a building is used for: their areas are buildings
const USE_OF_BUILDING = /^(amenity=(pub|fast_food|biergarten|nightclub|ice_cream|cafe|restaurant|bar)|tourism=(hotel|motel|hostel|guest_house)|shop=)/;
// tags that belong in the water: built at the coast (pier, breakwater, groyne) or across the river (dam)
const AT_COAST = /^man_made=(pier|breakwater|groyne|quay)$/;
const ACROSS_RIVER = /^waterway=(dam|weir|lock_gate)$/;

export function heightAt(x, y) {
  // (land a few metres above the sea, as a coastal town: a 20 m-high coast made every street ramp down to the coast
  // road and the railway climb out of the sea on a viaduct)
  let h = 4;
  const d2 = (x - HILL.x) ** 2 + (y - HILL.y) ** 2;
  // (the hill's skirt eased out over the water block, flat under it: a reservoir on its slope fell 17 m across)
  const pad = Math.max(WATER_PAD.x0 - x, x - WATER_PAD.x1, WATER_PAD.y0 - y, y - WATER_PAD.y1, 0);
  h += HILL.h * Math.exp(-d2 / (2 * HILL.r * HILL.r)) * Math.min(1, pad / 40);
  // the river valley: 5 m down, 50 m wide, easing out
  const dv = Math.abs(y - RIVER_Y); if (dv < 60) h -= 3.5 * Math.max(0, 1 - (dv / 60) ** 2);
  // the coast: down to the sea floor west of the coastline over 30 m
  // (a beach down to the sea over 30 m, then the sea floor down to 10 m)
  if (x < COAST_X + 30) h = Math.min(h, x >= COAST_X ? (4 * (x - COAST_X)) / 30 : -Math.min(10, (COAST_X - x) * 0.3));
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
  // a multipolygon: its outer ring and inner rings (holes) as untagged ways, members with their geometry, as Overpass
  // returns them
  const relation = (outer, inners, tags) => {
    const ring = (pts, role) => { const w = way(pts, undefined); return { type: 'way', ref: w.id, role, geometry: w.geometry }; };
    const r = { type: 'relation', id: rid++, members: [ring(outer, 'outer'), ...inners.map((h) => ring(h, 'inner'))], tags: { type: 'multipolygon', ...tags } };
    elements.push(r); return r;
  };
  const area = (cx, cy, w, h, tags) => way([[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2], [cx - w / 2, cy - h / 2]], tags);
  const line = (x0, y0, x1, y1, step, tags, nodeTag) => {
    const L = Math.hypot(x1 - x0, y1 - y0); const n = Math.max(1, Math.round(L / step)); const pts = [];
    for (let i = 0; i <= n; i++) pts.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, nodeTag ? nodeTag(i, n) : undefined]);
    return way(pts, tags);
  };
  const placed = [];   // what each plot holds, for the report

  // (each structure also names where the in-game tour looks from: tour = [distance, yaw])
  const structure = (what, x, y, tour) => placed.push({ what, kind: 'structure', at: [x, y], tour });
  // ── the sea, the coast, the river, the hill ──
  line(COAST_X, HALF + 20, COAST_X, -HALF - 20, 40, { natural: 'coastline' });
  // (the coast road: a node every 30 m and wherever a plot street meets it)
  {
    const ys = new Set(); for (let y = PLOT_Y0; y < PLOT_Y1; y += PLOT) ys.add(y);
    // (from the river's north bank: crossing the river untagged, it stood as a wall in the water)
    for (let y = RIVER_Y + 60; y <= HALF - 10; y += 30) ys.add(y);
    way([...ys].sort((a, b) => b - a).map((y) => [COAST_X + 40, y]), { highway: 'secondary', name: 'Coast Road', lanes: '2' });
    structure('coast and coast road', COAST_X + 20, -400, [70, 60]);
  }
  way([[COAST_X + 40, 100], [COAST_X - 70, 100]], { man_made: 'pier', name: 'Coverage Pier' });
  structure('pier', COAST_X - 30, 100, [50, 90]);
  // (the river, its water area, and the bridges: one per structure type, and a footbridge; the dam is a plot's)
  line(HALF + 20, RIVER_Y, COAST_X - 20, RIVER_Y, 25, { waterway: 'river', name: 'Coverage River' });
  area((HALF + COAST_X) / 2, RIVER_Y, HALF - COAST_X + 40, 30, { natural: 'water', water: 'river' });
  structure('river mouth', COAST_X, RIVER_Y, [90, 60]);
  const bridges = [null, 'truss', 'arch', 'humpback', 'suspension', 'cable-stayed'];
  bridges.forEach((st, i) => {
    const x = -690 + i * 210;   // (on a plot street's node: its junction joins)
    way([[x, RIVER_Y - 70], [x, RIVER_Y - 25]], { highway: 'tertiary', name: `Bridge Road ${i}` });
    way([[x, RIVER_Y - 25], [x, RIVER_Y + 25]], { highway: 'tertiary', bridge: 'yes', layer: '1', name: `Bridge Road ${i}`, ...(st ? { 'bridge:structure': st } : {}) });
    way([[x, RIVER_Y + 25], [x, PLOT_Y0]], { highway: 'tertiary', name: `Bridge Road ${i}` });
    structure(`road bridge, structure ${st || 'beam'}`, x + 18, RIVER_Y, [45, -60]);
  });
  way([[700, RIVER_Y - 30], [700, RIVER_Y - 20]], { highway: 'footway' });
  way([[700, RIVER_Y - 20], [700, RIVER_Y + 20]], { highway: 'footway', bridge: 'yes', layer: '1' });
  way([[700, RIVER_Y + 20], [700, RIVER_Y + 30]], { highway: 'footway' });
  structure('footbridge', 700, RIVER_Y, [40, -60]);
  // (the lake, clear of the tunnel approaches and the power lines)
  area(-450, 660, 160, 80, { natural: 'water', name: 'Coverage Lake' });
  structure('lake', -450, 660, [110, 0]);
  // (a wood and a scrub: land cover alone plants no trees, it only keeps or drops those of mapped woods and the
  // satellite's canopy, and a synthetic area has no satellite)
  area(800, 420, 300, 120, { natural: 'wood', name: 'Coverage Wood' });
  area(-650, 450, 260, 100, { natural: 'scrub', name: 'Coverage Scrub' });
  structure('wood', 800, 420, [120, 0]); structure('scrub', -650, 450, [110, 0]);
  // (the arboretum: single trees with room round each, every kind of the mix among them)
  for (let x = TREE_GRID.x0; x <= TREE_GRID.x1; x += TREE_GRID.step) for (let y = TREE_GRID.y0; y <= TREE_GRID.y1; y += TREE_GRID.step) node(x, y, { natural: 'tree' });
  structure('arboretum', (TREE_GRID.x0 + TREE_GRID.x1) / 2, (TREE_GRID.y0 + TREE_GRID.y1) / 2, [260, 0]);
  // (tunnels through the hill: a road and a railway)
  way([[0, ROAD_TUNNEL_Y], [160, ROAD_TUNNEL_Y]], { highway: 'secondary', name: 'Tunnel Road' });
  way([[160, ROAD_TUNNEL_Y], [440, ROAD_TUNNEL_Y]], { highway: 'secondary', tunnel: 'yes', layer: '-1', name: 'Tunnel Road' });
  way([[440, ROAD_TUNNEL_Y], [600, ROAD_TUNNEL_Y]], { highway: 'secondary', name: 'Tunnel Road' });
  structure('road tunnel west portal', 160, ROAD_TUNNEL_Y, [40, 60]); structure('road tunnel east portal', 440, ROAD_TUNNEL_Y, [40, -120]);
  // ── the railway: along y = RAIL_Y on the flat, a level crossing on a road of its own, a station platform away
  // from it, a siding off a switch, a rail tunnel ──
  {
    const xs = [-600]; for (let x = -840; x <= HALF + 20; x += 40) xs.push(x);
    xs.sort((a, b) => a - b);
    way(xs.map((x) => [x, RAIL_Y, x === -600 ? { railway: 'level_crossing' } : undefined]), { railway: 'rail', usage: 'main', gauge: '1435', name: 'Coverage Line' });
    way([[-600, RAIL_Y - 60], [-600, RAIL_Y], [-600, RAIL_Y + 60]], { highway: 'tertiary', name: 'Crossing Road' });
    structure('level crossing', -600, RAIL_Y, [30, 30]);
  }
  way([[-300, RAIL_Y - 8], [-160, RAIL_Y - 8]], { railway: 'platform', name: 'Coverage Station' });
  structure('railway platform', -230, RAIL_Y - 8, [40, 0]);
  way([[200, RAIL_Y], [300, RAIL_Y - 12], [480, RAIL_Y - 12]], { railway: 'rail', service: 'siding' });
  node(200, RAIL_Y, { railway: 'switch' });
  structure('siding switch', 220, RAIL_Y, [40, 0]);
  way([[0, RAIL_TUNNEL_Y], [170, RAIL_TUNNEL_Y]], { railway: 'rail', usage: 'branch' });
  way([[170, RAIL_TUNNEL_Y], [430, RAIL_TUNNEL_Y]], { railway: 'rail', usage: 'branch', tunnel: 'yes', layer: '-1' });
  way([[430, RAIL_TUNNEL_Y], [600, RAIL_TUNNEL_Y]], { railway: 'rail', usage: 'branch' });
  structure('rail tunnel west portal', 170, RAIL_TUNNEL_Y, [40, 60]); structure('rail tunnel east portal', 430, RAIL_TUNNEL_Y, [40, -120]);
  structure('hill over the tunnels', 300, 720, [220, 0]);
  // ── power: on towers, on poles, a minor line meeting the pole line at a shared node ──
  line(-840, 930, 960, 930, 240, { power: 'line', voltage: '220000' }, () => ({ power: 'tower' }));
  line(-840, 860, 960, 860, 80, { power: 'line' }, () => ({ power: 'pole' }));
  way([[-200, 860, { power: 'pole' }], [-200, 800, { power: 'pole' }], [-150, 780, { power: 'pole' }]], { power: 'minor_line' });
  structure('tower line', 0, 930, [80, 0]); structure('pole line and shared node', -200, 860, [45, 0]); structure('minor line', -180, 800, [45, 0]);

  // ── sports at their real sizes (the user, 2026-11-24: squeezed into a plot, a baseball field was 30 m) ──
  {
    const SPORT_FIELDS = [
      ['baseball', 150, 60, 120, 120], ['soccer', 340, 0, 105, 68], ['american_football', 340, 150, 110, 49],
      ['running', 560, 80, 176, 92, 'leisure=track'], ['tennis', 760, 240, 36, 18], ['basketball', 760, 190, 28, 15],
      ['volleyball', 760, 145, 18, 9], ['skateboard', 760, 95, 30, 20], ['multi', 760, 35, 40, 22], ['golf', 900, 140, 60, 200],
    ];
    for (const [sport, x, y, w, h, tag] of SPORT_FIELDS) {
      const tags = tag === 'leisure=track' ? { leisure: 'track', sport: 'running', lit: 'yes' } : { leisure: 'pitch', sport, lit: 'yes' };
      area(x, y, w, h, { ...tags, name: `cov ${sport} ${w} x ${h} m` });
      structure(`sport=${sport}, ${w} x ${h} m`, x, y, [Math.max(w, h) * 0.9 + 20, 0]);
    }
  }

  // ── still water at real sizes (the user, 2026-11-24: each kind in a 30 m square looked alike; a lake runs to
  // hundreds of metres, a canal is a long strip): a block north-east of the hill, the river kinds as long strips with
  // their lines through them in the empty last plot row. The Coverage Lake above is the plain lake. ──
  {
    const WATER = [
      ['reservoir', 560, 600, 160, 90], ['lagoon', 730, 605, 120, 70], ['salt_pool', 860, 610, 70, 40],
      ['pond', 490, 520, 35, 22], ['basin', 560, 520, 45, 28], ['fishpond', 640, 520, 50, 25], ['reflecting_pool', 730, 520, 60, 8],
    ];
    for (const [w, x, y, sx, sy] of WATER) {
      area(x, y, sx, sy, { natural: 'water', water: w, name: `cov water=${w} ${sx} x ${sy} m` });
      structure(`water=${w}, ${sx} x ${sy} m`, x, y, [Math.max(sx, sy) * 0.8 + 25, 0]);
    }
    // a wastewater plant's round tank, 28 m across
    { const pts = []; for (let a = 0; a <= 24; a++) pts.push([960 + 14 * Math.cos((a / 24) * 2 * Math.PI), 605 + 14 * Math.sin((a / 24) * 2 * Math.PI)]); pts[24] = pts[0];
      way(pts, { natural: 'water', water: 'wastewater', name: 'cov water=wastewater round tank 28 m' }); structure('water=wastewater, round tank 28 m', 960, 605, [45, 0]); }
    // a moat 8 m wide round a 30 m square keep (the outline with its keep as the hole)
    { const o = [[804, 499], [856, 499], [856, 541], [804, 541], [804, 499]]; const k = [[815, 510], [845, 510], [845, 530], [815, 530], [815, 510]];
      relation(o, [k], { natural: 'water', water: 'moat', name: 'cov water=moat 8 m round a keep' }); structure('water=moat, 8 m wide round a keep', 830, 520, [50, 0]); }
    // an oxbow: a crescent 15 m wide, 40 m round
    { const pts = []; for (let a = 0; a <= 12; a++) { const t = Math.PI * (0.15 + 0.7 * a / 12); pts.push([930 + 48 * Math.cos(t), 495 + 48 * Math.sin(t)]); }
      for (let a = 12; a >= 0; a--) { const t = Math.PI * (0.15 + 0.7 * a / 12); pts.push([930 + 33 * Math.cos(t), 495 + 33 * Math.sin(t)]); }
      pts.push(pts[0]); way(pts, { natural: 'water', water: 'oxbow', name: 'cov water=oxbow crescent 15 m wide' }); structure('water=oxbow, crescent', 930, 530, [55, 0]); }
    // the river kinds: long strips with their lines, as mapped
    for (const [w, x0, x1, half] of [['river', -760, -460, 15], ['canal', -400, -100, 7], ['stream', -40, 210, 2]]) {
      const y = -150;
      area((x0 + x1) / 2, y, x1 - x0, 2 * half, { natural: 'water', water: w, name: `cov water=${w} ${x1 - x0} x ${2 * half} m` });
      way([[x0 - 10, y], [x1 + 10, y]], { waterway: w, name: `cov line for water=${w}` });
      structure(`water=${w}, ${x1 - x0} x ${2 * half} m strip with its line`, (x0 + x1) / 2, y, [80, 0]);
    }
  }

  // ── the plots: one per tag MapNG builds ──
  const lib = JSON.parse(fs.readFileSync(path.join(REPO, 'data/osm-tag-library.json'), 'utf8'));
  const wanted = [];
  // (tags the layout's own structures already carry, not repeated in a plot: an inland coastline would cut the land)
  // (the platform plot too: a platform is raised beside its track, the station on the main line has one)
  // (and every still water kind: the water block above, at real sizes)
  const BUILT_ELSEWHERE = new Set(['natural=coastline', 'railway=platform']);
  const elsewhere = (tag) => BUILT_ELSEWHERE.has(tag) || /^water=/.test(tag) || tag === 'landuse=reservoir' || tag === 'landuse=basin';
  for (const [tag, e] of Object.entries(lib.tags)) {
    if (e.status !== 'built' && e.status !== 'partial') continue;
    if (elsewhere(tag)) continue;
    wanted.push({ tag, on: e.on, group: e.group });
    for (const also of e.also || []) if (!elsewhere(also)) wanted.push({ tag: also, on: e.on, group: e.group, also: tag });
  }
  // (a few the plots need with their values spelled out: every sport on a pitch, every surface of a road)
  // (every placed-object rule of data/tag-models.json, as a mapped point with the sub-tags its rule asks for)
  const models = JSON.parse(fs.readFileSync(path.join(REPO, 'data/tag-models.json'), 'utf8'));
  for (const [id, o] of Object.entries(models.objects || {})) {
    const extra = Object.fromEntries(Object.entries(o.when || {}).map(([k, vals]) => [k, vals[0]]));
    wanted.push({ tag: o.tag, on: ['node'], extra, rule: id });
  }
  const cols = Math.floor((PLOT_X1 - PLOT_X0) / PW); const rows = Math.floor((PLOT_Y1 - PLOT_Y0) / PLOT);
  if (wanted.length > cols * rows) throw new Error(`${wanted.length} plots wanted, the grid holds ${cols * rows}: widen it`);
  // (the streets: one along the south side of each plot row, with sidewalks)
  const streetNodes = [];
  for (let r = 0; r < rows; r++) {
    const y = PLOT_Y0 + r * PLOT;
    const pts = []; for (let c = 0; c <= cols; c++) pts.push([PLOT_X0 + c * PW, y]);
    for (let c = 0; c < cols; c++) pts.push([PLOT_X0 + c * PW + PW / 2, y]);
    pts.sort((a, b) => a[0] - b[0]);
    pts.unshift([COAST_X + 40, y]);   // (joined to the coast road)
    way(pts, { highway: 'residential', name: `Plot Street ${r + 1}`, sidewalk: 'both', lanes: '2' });
    streetNodes.push(y);
  }
  wanted.forEach((w, i) => {
    const c = i % cols; const r = Math.floor(i / cols);
    const x0 = PLOT_X0 + c * PW; const y0 = PLOT_Y0 + r * PLOT;
    const cx = x0 + PW / 2; const cy = y0 + PLOT / 2 + 4;
    const [k, v] = w.tag.split('='); const tags = { [k]: v === '*' ? (STAND_IN[k] || 'yes') : v, name: `cov ${w.tag}`, ...(w.extra || {}) };
    // (no building:levels: each class's own default height is what is being tested)
    // (a closed highway=* way is a loop unless tagged as an area: the plots' highway areas are plazas)
    if (k === 'highway' && w.on.includes('area')) tags.area = 'yes';
    // (a water= tag describes a water area; a river's, canal's or stream's area has its waterway line through it,
    // as mapped: the water is built along the line, the area shapes its banks)
    if (k === 'water') tags.natural = 'water';
    if (k === 'water' && ['river', 'canal', 'stream'].includes(v)) way([[x0 + 2, cy], [x0 + PW - 2, cy]], { waterway: v, name: `cov line for ${w.tag}` });
    if (USE_OF_BUILDING.test(w.tag)) tags.building ||= 'yes';
    const t = `${k}=${tags[k]}`;
    let kind; let at = [cx, cy];
    if (w.rule) {
      // (a placed-object rule: a point beside the plot street, as most are mapped)
      node(cx, y0 + 9, tags); kind = `object rule ${w.rule}`; at = [cx, y0 + 9];
    } else if (ON_PATH.test(t)) {
      // (a footway from the street through a fence, the barrier on the footway where it crosses the fence)
      way([[x0 + 3, cy], [cx, cy], [x0 + PW - 3, cy]], { barrier: 'fence' });
      way([[cx, y0], [cx, cy, tags], [cx, y0 + PLOT - 20]], { highway: 'footway' });
      kind = 'on a footway through a fence';
    } else if (AT_JUNCTION.test(t)) {
      // (a side road meeting the plot street; the sign on its last metres before the junction)
      if (k === 'traffic_sign') Object.assign(tags, { traffic_sign: 'maxspeed', maxspeed: '50' });
      // (ending well short of the next street: ended in its sidewalk, the dead end stood against a raised kerb)
      way([[cx, y0 + PLOT - 22], [cx, y0 + 9, tags], [cx, y0]], { highway: 'residential', name: `cov side road ${i}` });
      kind = 'on a side road before the junction'; at = [cx, y0 + 9];
    } else if (AT_COAST.test(t)) {
      // (out from the coast into the sea, beside this plot's row)
      const yy = y0 + PLOT / 2; way([[COAST_X + 30, yy], [COAST_X - 60, yy]], tags);
      kind = 'out from the coast'; at = [COAST_X - 20, yy];
    } else if (ACROSS_RIVER.test(t)) {
      // (across the whole valley, bank top to bank top: a dam with no drop under its crest is left to the ground)
      const xx = 860 + (i % 3) * 10; way([[xx, RIVER_Y - 58], [xx, RIVER_Y + 58]], tags);
      kind = 'across the river'; at = [xx, RIVER_Y];
    } else if (t === 'man_made=fuel_pump') {
      area(cx, cy, AREA_M, AREA_M, { amenity: 'fuel', name: 'cov fuel station for the pump' }); node(cx, cy, tags); kind = 'node in a fuel station';
    } else if (ROAD_PROPERTY.test(w.tag)) {
      // (on a short road of its own, joined to the plot street: a roundabout as a closed loop)
      if (w.tag === 'junction=roundabout') { const r0 = 14; const pts = []; for (let a = 0; a <= 12; a++) pts.push([cx + r0 * Math.cos((a / 12) * 2 * Math.PI), cy + r0 * Math.sin((a / 12) * 2 * Math.PI)]); pts[12] = pts[0]; way(pts, { highway: 'residential', ...tags }); }
      else way([[cx, y0], [cx, y0 + PLOT - 22]], { highway: 'residential', ...tags, ...(k === 'bridge' ? { layer: '1' } : k === 'tunnel' ? { layer: '-1' } : {}) });
      kind = 'on a road';
    } else if (w.on.includes('node') && ON_ROAD.test(w.tag)) { node(cx, y0, tags); kind = 'node on the street'; }
    else if (w.on.includes('area')) { const [sx, sy] = REAL_SIZE[t] || [AREA_M, AREA_M]; area(cx, cy, sx, sy, tags); kind = REAL_SIZE[t] ? `area, ${sx} x ${sy} m` : 'area'; }
    else if (w.on.includes('way')) { way([[x0 + 3, cy], [x0 + PW - 3, cy]], tags); kind = 'way'; }
    else { node(cx, cy, tags); kind = 'node'; }
    placed.push({ what: w.tag + (w.extra && Object.keys(w.extra).length ? ` ${JSON.stringify(w.extra)}` : ''), kind, at: at.map(Math.round), plot: [Math.round(cx), Math.round(cy)], also: w.also, rule: w.rule });
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
    // (the bands on land, from the top of the beach to the east edge: spread over the whole width, the trees' band
    // fell in the sea)
    else if (y > 260) lc[r * lcN + c] = x < COAST_X + 30 ? 30 : CLASSES[Math.min(CLASSES.length - 1, Math.floor(((x - COAST_X - 30) / (HALF - COAST_X - 30)) * CLASSES.length))];
    else lc[r * lcN + c] = 50;
  }
  // (under both names the tools read: landcover.bin for the export, landcover_<n>.bin for the game texture painter)
  for (const f of ['landcover.bin', `landcover_${lcN}.bin`]) fs.writeFileSync(path.join(dir, f), Buffer.from(lc));
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
