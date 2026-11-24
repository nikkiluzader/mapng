// The themed synthetic test levels (asked for by the user, 2026-11-24): one level per kind of situation, made by the
// same plumbing as the coverage level (scripts/coverage/buildCoverageArea.mjs, the asset and tag coverage):
//
//   roads       flat ground: lane counts changing 4 -> 3 -> 2 -> 1 -> 4, a one-way pair, a dual carriageway with
//               slip roads, every junction shape, roundabouts from mini to two-lane, turn lanes at signals, curve
//               radii, every road class with each sidewalk option, tagged widths, every surface, a car park
//   structures  a gorge and a wide river valley bridged by every structure type, a viaduct, a rail bridge, road
//               overpasses on the flat, a footbridge; a ridge with short, long, curved, graded, rail and twin tunnels
//   terrain     a 350 m mountain with a switchback pass to a saddle and a ridge road, a steep street grid on a hill
//               side, a straight road across rolling hills (cuts and embankments), a valley road along a river
//
//   node scripts/coverage/testLevels.mjs <roads|structures|terrain|all> [region]
//
// Writes scratch/levelprobe/data/test_<suite>_<region>/ like the coverage area: export it with
// scripts/sweep/exportArea.mjs, label it with scripts/coverage/addLabels.py, tour it with the coverage tour.
import fs from 'node:fs';
import path from 'node:path';

globalThis.location ||= { protocol: 'https:' };
const store = new Map(); globalThis.localStorage ||= { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const AREAS = process.env.MAPNG_AREAS || path.join(REPO, 'scratch/levelprobe/data');
import { REGIONS } from './buildCoverageArea.mjs';

// ── the plumbing: OSM elements on a local metre grid (x east, y north from the centre) ──
export function makeBuilder(regionKey, size) {
  const R = REGIONS[regionKey]; if (!R) throw new Error(`unknown region ${regionKey}`);
  const half = size / 2;
  const kx = 111320 * Math.cos((R.lat * Math.PI) / 180); const ky = 111320;
  const ll = (x, y) => ({ lat: R.lat + y / ky, lon: R.lng + x / kx });
  const bounds = { north: R.lat + half / ky, south: R.lat - half / ky, east: R.lng + half / kx, west: R.lng - half / kx };
  let nid = 1; let wid = 1;
  const nodes = new Map(); const elements = []; const placed = [];
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
  // (a straight run as nodes every `step` m, ends included)
  // (through: points on the line it must include exactly, where another way joins it: evenly spaced nodes missed
  // them, and roads that should meet crossed without a junction)
  const run = (x0, y0, x1, y1, step = 20, through = []) => {
    const L = Math.hypot(x1 - x0, y1 - y0); const n = Math.max(1, Math.round(L / step)); const pts = [];
    for (let i = 0; i <= n; i++) pts.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
    const t = ([x, y]) => (((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / (L * L || 1));
    for (const p of through) { const tp = t(p); const near = pts.findIndex((q) => Math.abs(t(q) - tp) * L < step / 3); if (near > 0 && near < pts.length - 1) pts[near] = [p[0], p[1]]; else if (near < 0) pts.push([p[0], p[1]]); }
    return pts.sort((a, b) => t(a) - t(b));
  };
  const circle = (cx, cy, r, n = 24) => { const pts = []; for (let i = 0; i <= n; i++) { const a = (i / n) * 2 * Math.PI; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } pts[n] = pts[0]; return pts; };
  // (what the level holds, for the labels, the report and the tour: tour = [camera distance, yaw])
  const label = (what, x, y, tour = [60, 0]) => placed.push({ what, kind: 'structure', at: [Math.round(x), Math.round(y)], tour });
  // (a driver's view for the tour, not a label: the camera at eye height on the road at (x, y), looking along
  // `heading` (radians, 0 = east); find: 'down' onto a deck or road from above, 'up' onto a tunnel floor from below)
  // (fromZ: where a downward ray starts, just over the deck, so it cannot land on a pylon or a cable above it)
  const drive = (what, x, y, heading, find = 'down', fromZ = null) => placed.push({ what, kind: 'driver', at: [Math.round(x * 10) / 10, Math.round(y * 10) / 10], heading, find, ...(fromZ != null ? { fromZ } : {}) });
  // (along a polyline: the point and heading at a fraction of its length)
  const along = (pts, f) => {
    const seg = []; let L = 0;
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); L += l; }
    let d = f * L;
    for (let i = 1; i < pts.length; i++) {
      if (d <= seg[i - 1] || i === pts.length - 1) { const t = Math.min(1, d / (seg[i - 1] || 1)); const [ax, ay] = pts[i - 1]; const [bx, by] = pts[i]; return [ax + (bx - ax) * t, ay + (by - ay) * t, Math.atan2(by - ay, bx - ax)]; }
      d -= seg[i - 1];
    }
    return [...pts.at(-1), 0];
  };
  return { R, half, bounds, node, way, area, run, circle, label, drive, along, elements, placed };
}

export async function writeLevelArea({ name, size, b, heightAt, landCover, meta = {} }) {
  const dir = path.join(AREAS, name); fs.mkdirSync(dir, { recursive: true });
  const { parseOverpassResponse } = await import('../../services/osm.js');
  const features = parseOverpassResponse({ elements: b.elements }, b.bounds);
  fs.writeFileSync(path.join(dir, 'osm.json'), JSON.stringify(features));
  const half = size / 2;
  const h = new Float32Array(size * size);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) h[r * size + c] = heightAt(c + 0.5 - half, half - (r + 0.5));
  for (const f of ['mh.f32', 't30.f32']) fs.writeFileSync(path.join(dir, f), Buffer.from(h.buffer));
  const lcN = Math.ceil(size / 10); const lc = new Uint8Array(lcN * lcN);
  for (let r = 0; r < lcN; r++) for (let c = 0; c < lcN; c++) lc[r * lcN + c] = landCover ? landCover((c + 0.5) * 10 - half, half - (r + 0.5) * 10) : 30;
  for (const f of ['landcover.bin', `landcover_${lcN}.bin`]) fs.writeFileSync(path.join(dir, f), Buffer.from(lc));
  const KINDS = ['palm', 'live_oak', 'oak', 'broadleaf', 'conifer', 'juniper', 'eucalyptus', 'olive', 'cypress', 'tropical'];
  fs.writeFileSync(path.join(dir, 'tree_mix.json'), JSON.stringify({ shares: Object.fromEntries(KINDS.map((k) => [k, 1 / KINDS.length])), records: 1000 }, null, 1));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ name, center: { lat: b.R.lat, lng: b.R.lng }, size, mpp: 1, fetchBounds: b.bounds, bounds: b.bounds, gpxzSmooth: false, mh: { zoom: 17, metersPerPixel: 1, lidarFraction: 1, tiles: 0 }, synthetic: true, ...meta }, null, 1));
  fs.writeFileSync(path.join(dir, 'coverage_plan.json'), JSON.stringify({ name, placed: b.placed }, null, 1));
  if (fs.existsSync(path.join(dir, 'gametex.png'))) fs.unlinkSync(path.join(dir, 'gametex.png'));
  console.log(`${name}: ${features.length} features, ${b.placed.length} labelled situations -> ${path.relative(REPO, dir)}`);
}

// ── roads: flat, every road situation our rules handle ──
function roads(regionKey) {
  const SIZE = 2048; const b = makeBuilder(regionKey, SIZE); const { way, node, run, circle, label, area, drive } = b;
  const heightAt = () => 4;
  // 1. lane counts down and back up (y = 850): 4 -> 3 -> 2 -> 1 -> 4, one way per count, sharing their nodes
  {
    const steps = [[4, -900, -550], [3, -550, -300], [2, -300, -50], [1, -50, 200], [4, 200, 550]];
    for (const [lanes, x0, x1] of steps) {
      // (one road: the same name throughout, as mapped; a second one below with no name at all)
      way(run(x0, 850, x1, 850, 25), { highway: 'primary', lanes: String(lanes), name: 'Lane change road', ...(lanes === 1 ? { oneway: 'yes' } : {}) });
      way(run(x0, 790, x1, 790, 25), { highway: 'primary', lanes: String(lanes), ...(lanes === 1 ? { oneway: 'yes' } : {}) });
      label(`lanes=${lanes}${lanes === 1 ? ' oneway' : ''}`, (x0 + x1) / 2, 850, [55, 0]);
    }
    for (const x of [-550, -300, -50, 200]) label(`lane change at x=${x}`, x, 850, [45, 0]);
    label('unnamed lane change road', -200, 790, [60, 0]);
    // driver's views through each lane change, both roads, 40 m before it
    for (const x of [-550, -300, -50, 200]) { drive(`driver: lane change at x=${x}`, x - 40, 850, 0); drive(`driver: unnamed lane change at x=${x}`, x - 40, 790, 0); }
  }
  // 2. a one-way pair, 3 lanes each (y = 700, 680)
  way(run(-900, 700, 550, 700, 25), { highway: 'secondary', oneway: 'yes', lanes: '3', name: 'One-way east' });
  way(run(550, 670, -900, 670, 25), { highway: 'secondary', oneway: 'yes', lanes: '3', name: 'One-way west' });
  label('one-way pair, 3 lanes each', -200, 685, [70, 0]);
  // 3. a dual carriageway (y = 520 / 490) with slip roads to a cross road at x = 0
  {
    way(run(-900, 520, 900, 520, 30), { highway: 'trunk', oneway: 'yes', lanes: '2', name: 'Dual east' });
    way(run(900, 490, -900, 490, 30), { highway: 'trunk', oneway: 'yes', lanes: '2', name: 'Dual west' });
    way([[-300, 520], [-150, 560], [-20, 580]], { highway: 'trunk_link', oneway: 'yes', name: 'Off slip' });
    way([[20, 580], [150, 560], [300, 520]], { highway: 'trunk_link', oneway: 'yes', name: 'On slip' });
    way(run(-200, 580, 200, 580, 20), { highway: 'secondary', name: 'Slip road street' });
    label('dual carriageway', 600, 505, [70, 0]); label('off slip road', -150, 560, [60, 0]); label('on slip road', 150, 560, [60, 0]);
  }
  // 4. junction shapes (y = 300), 300 m apart
  {
    const y = 300; const arm = 90;
    // T with a stop sign on the minor arm
    way(run(-900, y, -700, y, 15, [[-800, y]]), { highway: 'secondary', name: 'T main' });
    way([[-800, y - arm], [-800, y - 8, { highway: 'stop' }], [-800, y]], { highway: 'residential', name: 'T minor' });
    label('T junction, stop', -800, y, [55, 0]);
    // crossroads with signals
    way(run(-600, y, -400, y, 15, [[-500, y]]), { highway: 'secondary', name: 'Cross EW' });
    way(run(-500, y - arm, -500, y + arm, 15, [[-500, y]]), { highway: 'secondary', name: 'Cross NS' });
    node(-500, y, { highway: 'traffic_signals' }); label('crossroads, signals', -500, y, [55, 0]);
    // offset (staggered) crossroads
    way(run(-300, y, -100, y, 15, [[-220, y], [-180, y]]), { highway: 'tertiary', name: 'Stagger main' });
    way([[-220, y - arm], [-220, y]], { highway: 'residential', name: 'Stagger south' });
    way([[-180, y], [-180, y + arm]], { highway: 'residential', name: 'Stagger north' });
    label('staggered crossroads', -200, y, [55, 0]);
    // Y junction (acute fork)
    way(run(0, y - arm, 0, y, 15), { highway: 'tertiary', name: 'Y stem' });
    way([[0, y], [35, y + 60], [70, y + 120]], { highway: 'tertiary', name: 'Y right' });
    way([[0, y], [-35, y + 60], [-70, y + 120]], { highway: 'tertiary', name: 'Y left' });
    label('Y fork', 0, y + 20, [55, 0]);
    // five-way
    for (let k = 0; k < 5; k++) { const a = (k / 5) * 2 * Math.PI + 0.3; way([[300, y], [300 + arm * Math.cos(a), y + arm * Math.sin(a)]], { highway: 'tertiary', name: `Five ${k}` }); }
    label('five-way junction', 300, y, [60, 0]);
    // skewed crossroads (30 degrees)
    way(run(500, y, 700, y, 15, [[600, y]]), { highway: 'secondary', name: 'Skew main' });
    way([[600 - 45, y - 78], [600, y], [600 + 45, y + 78]], { highway: 'residential', name: 'Skew minor' });
    label('skewed crossroads (60 degrees)', 600, y, [55, 0]);
  }
  // 5. roundabouts (y = 80): a mini node, a small one, a large one, a two-lane one, each with four arms
  {
    const y = 80; const arm = 80;
    way(run(-900, y, -700, y, 15, [[-800, y]]), { highway: 'residential', name: 'Mini EW' });
    way(run(-800, y - arm, -800, y + arm, 15, [[-800, y]]), { highway: 'residential', name: 'Mini NS' });
    node(-800, y, { highway: 'mini_roundabout' }); label('mini roundabout', -800, y, [45, 0]);
    drive('driver: towards the mini roundabout', -835, y - 1.8, 0);
    for (const [cx, r, tags, what] of [[-450, 15, { lanes: '1' }, 'small roundabout r=15 m'], [-50, 40, { lanes: '1' }, 'large roundabout r=40 m'], [400, 35, { lanes: '2' }, 'two-lane roundabout r=35 m']]) {
      const ring = circle(cx, y, r, 32);
      way(ring, { highway: 'secondary', junction: 'roundabout', oneway: 'yes', ...tags, name: what });
      for (const k of [0, 8, 16, 24]) { const [px, py] = ring[k]; const dx = px - cx; const dy = py - y; const L = Math.hypot(dx, dy); way([[px, py], [px + (dx / L) * arm, py + (dy / L) * arm]], { highway: 'secondary', name: `${what} arm` }); }
      label(what, cx, y, [r * 2.2 + 30, 0]);
      drive(`driver: into the ${what}`, cx - r - 45, y - 1.8, 0);
    }
  }
  // 6. turn lanes at a signalled junction (y = -150)
  {
    const y = -150;
    way(run(-900, y, -620, y, 20), { highway: 'primary', lanes: '3', 'turn:lanes:forward': 'left|through|right', 'lanes:forward': '3', 'lanes:backward': '1', name: 'Turn lane approach' });
    way(run(-620, y, -400, y, 20), { highway: 'primary', lanes: '2', name: 'Turn lane exit' });
    way(run(-620, y - 90, -620, y + 90, 15), { highway: 'secondary', name: 'Turn lane cross' });
    node(-620, y, { highway: 'traffic_signals' }); label('turn lanes: left|through|right', -700, y, [55, 0]);
    // a pedestrian crossing, zebra and signalled
    way(run(-300, y, 100, y, 20), { highway: 'secondary', name: 'Crossing street', sidewalk: 'both' });
    node(-200, y, { highway: 'crossing', crossing: 'zebra' }); way([[-200, y - 20], [-200, y], [-200, y + 20]], { highway: 'footway', footway: 'crossing', crossing: 'zebra' });
    node(0, y, { highway: 'crossing', crossing: 'traffic_signals' }); way([[0, y - 20], [0, y], [0, y + 20]], { highway: 'footway', footway: 'crossing', crossing: 'traffic_signals' });
    label('zebra crossing', -200, y, [40, 0]); label('signalled crossing', 0, y, [40, 0]);
    drive('driver: towards the zebra crossing', -230, y - 1.8, 0); drive('driver: towards the signalled crossing', -30, y - 1.8, 0);
    // a level crossing on a two-lane road
    way(run(300, y, 700, y, 20).map(([x, yy]) => [x, yy, x === 500 ? { railway: 'level_crossing' } : undefined]), { highway: 'secondary', name: 'Level crossing road' });
    way(run(500, y - 200, 500, y + 100, 20).map(([x, yy]) => [x, yy, yy === y ? { railway: 'level_crossing' } : undefined]), { railway: 'rail', name: 'Crossing line' });
    label('level crossing', 500, y, [40, 0]);
  }
  // 7. curves (y = -400): radii 30, 60, 120, 250 m as half circles off a straight
  {
    let x = -900; const y = -500;
    for (const r of [30, 60, 120, 200]) {
      const pts = []; for (let i = 0; i <= 24; i++) { const a = Math.PI - (i / 24) * Math.PI; pts.push([x + r + r * Math.cos(a), y + r * Math.sin(a)]); }
      way(pts, { highway: 'secondary', name: `Curve r=${r}` }); label(`curve radius ${r} m`, x + r, y + r, [r + 40, 0]);
      x += 2 * r + 60;
    }
  }
  // 8. road classes and sidewalks (y = -620): short parallel pieces, 40 m apart, each class, then sidewalk options
  {
    const classes = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'track', 'pedestrian', 'cycleway', 'footway', 'path', 'bridleway', 'steps'];
    classes.forEach((c, i) => { const x = -900 + i * 40; way(run(x, -700, x, -560, 20), { highway: c, ...(c === 'motorway' ? { oneway: 'yes' } : {}), name: `Class ${c}` }); label(`highway=${c}`, x, -630, [40, 0]); });
    ['both', 'left', 'right', 'no', 'separate'].forEach((s, i) => { const x = -200 + i * 50; way(run(x, -700, x, -560, 20), { highway: 'residential', sidewalk: s, name: `Sidewalk ${s}` }); label(`sidewalk=${s}`, x, -630, [40, 0]); });
    [4, 6, 8, 12].forEach((w, i) => { const x = 100 + i * 50; way(run(x, -700, x, -560, 20), { highway: 'tertiary', width: String(w), name: `Width ${w}` }); label(`width=${w}`, x, -630, [40, 0]); });
    [['yes', 'lit'], ['no', 'unlit']].forEach(([lit, what], i) => { const x = 350 + i * 50; way(run(x, -700, x, -560, 20), { highway: 'residential', lit, name: what }); label(`lit=${lit}`, x, -630, [40, 0]); });
  }
  // 9. surfaces (y = -820)
  ['asphalt', 'concrete', 'paving_stones', 'sett', 'cobblestone', 'gravel', 'fine_gravel', 'compacted', 'dirt', 'ground', 'grass', 'sand', 'unpaved'].forEach((s, i) => {
    const x = -900 + i * 45; way(run(x, -900, x, -760, 20), { highway: 'unclassified', surface: s, name: `Surface ${s}` }); label(`surface=${s}`, x, -830, [40, 0]);
  });
  // 10. a car park with aisles (y = -830, x = 400)
  {
    area(500, -830, 160, 100, { amenity: 'parking', parking: 'surface', name: 'Coverage car park' });
    for (const yy of [-860, -830, -800]) way(run(430, yy, 570, yy, 20), { highway: 'service', service: 'parking_aisle' });
    way([[500, -880], [500, -930]], { highway: 'service', name: 'Car park entrance' });
    label('car park with aisles', 500, -830, [90, 0]);
  }
  return { b, size: SIZE, heightAt };
}

// ── structures: bridges over a gorge and a wide valley, overpasses on the flat, tunnels through a ridge ──
function structures(regionKey) {
  const SIZE = 2048; const b = makeBuilder(regionKey, SIZE); const { way, run, label, drive, along } = b;
  const GORGE_X = -450; const VALLEY_X = 150; const RIDGE_X = 700;
  const heightAt = (x, y) => {
    let h = 60;
    const dg = Math.abs(x - GORGE_X); if (dg < 90) h -= 45 * Math.max(0, 1 - (dg / 90) ** 4);        // a steep 45 m gorge
    const dv = Math.abs(x - VALLEY_X); if (dv < 260) h -= 20 * Math.max(0, 1 - (dv / 260) ** 2);      // a wide 20 m valley
    const dr = Math.abs(x - RIDGE_X); if (dr < 220) h += 110 * Math.cos((Math.PI * dr) / 440) ** 2;    // a 110 m ridge
    return h;
  };
  way(run(GORGE_X, 1000, GORGE_X, -1000, 25), { waterway: 'stream', name: 'Gorge stream' });
  way(run(VALLEY_X, 1000, VALLEY_X, -1000, 25), { waterway: 'river', name: 'Valley river', width: '25' });
  // bridges across the gorge (west to east), one structure per row, 140 m apart
  const types = [[null, 'beam'], ['truss', 'truss'], ['arch', 'arch'], ['suspension', 'suspension'], ['cable-stayed', 'cable-stayed'], ['humpback', 'humpback (stone arch)'], ['viaduct', 'viaduct']];
  types.forEach(([st, what], i) => {
    const y = 840 - i * 140; const x0 = GORGE_X - 180; const x1 = GORGE_X + 180; const a = GORGE_X - 100; const c = GORGE_X + 100;
    way(run(x0, y, a, y, 20), { highway: 'secondary', name: `Gorge road ${what}` });
    way(run(a, y, c, y, 20), { highway: 'secondary', bridge: st === 'viaduct' ? 'viaduct' : 'yes', layer: '1', ...(st && st !== 'viaduct' ? { 'bridge:structure': st } : {}), name: `Gorge bridge ${what}` });
    way(run(c, y, x1, y, 20), { highway: 'secondary', name: `Gorge road ${what}` });
    label(`gorge bridge: ${what}`, GORGE_X, y, [120, -60]);
    label(`bridge end west (${what})`, a, y, [30, 60]); label(`bridge end east (${what})`, c, y, [30, -120]);
    // driver's views: 40 m before each end looking onto the deck, both ways, and mid-span
    drive(`driver: eastbound onto ${what}`, a - 40, y, 0); drive(`driver: westbound onto ${what}`, c + 40, y, Math.PI);
    // (on the deck: the ray from 8 m over the gorge's rim, under a pylon's top and the cables)
    const deckZ = heightAt(a, y) + 8;
    drive(`driver: on ${what}, mid-span east`, GORGE_X, y, 0, 'down', deckZ); drive(`driver: eastbound off ${what}`, c - 30, y, 0, 'down', deckZ);
    drive(`driver: westbound off ${what}`, a + 30, y, Math.PI, 'down', deckZ);
  });
  // a long viaduct across the wide valley, a rail bridge beside it, a footbridge over the river
  {
    const a = VALLEY_X - 230; const c = VALLEY_X + 230;
    for (const [y, tags, what] of [[700, { highway: 'trunk', lanes: '2' }, 'valley viaduct (road)'], [600, { railway: 'rail' }, 'valley rail bridge'], [300, { highway: 'footway' }, 'footbridge over the river']]) {
      const x0 = what.startsWith('foot') ? VALLEY_X - 40 : a; const x1 = what.startsWith('foot') ? VALLEY_X + 40 : c;
      way(run(x0 - 80, y, x0, y, 20), { ...tags });
      way(run(x0, y, x1, y, 20), { ...tags, bridge: 'yes', layer: '1', name: what });
      way(run(x1, y, x1 + 80, y, 20), { ...tags });
      label(what, VALLEY_X, y, [what.startsWith('foot') ? 50 : 160, -60]);
      label(`${what}: west end`, x0, y, [30, 60]); label(`${what}: east end`, x1, y, [30, -120]);
    }
  }
  // overpasses on the flat (x = 450 .. 600 is the ridge's foot: on the flat west of the valley instead, x = -850)
  {
    const X = -800;
    way(run(X - 150, -300, X + 150, -300, 20), { highway: 'primary', name: 'Under road' });
    way(run(X, -450, X, -360, 20), { highway: 'secondary', name: 'Over road' });
    way(run(X, -360, X, -240, 20), { highway: 'secondary', bridge: 'yes', layer: '1', name: 'Overpass' });
    way(run(X, -240, X, -150, 20), { highway: 'secondary', name: 'Over road' });
    label('road overpass on the flat', X, -300, [70, 60]);
    label('overpass south end', X, -360, [30, 60]); label('overpass north end', X, -240, [30, -120]);
    way(run(X - 150, -650, X + 150, -650, 20), { highway: 'motorway', oneway: 'yes', lanes: '3', name: 'Motorway under' });
    way(run(X, -800, X, -700, 20), { highway: 'tertiary', name: 'Motorway bridge road' });
    way(run(X, -700, X, -600, 20), { highway: 'tertiary', bridge: 'yes', layer: '1', name: 'Motorway overbridge' });
    way(run(X, -600, X, -500, 20), { highway: 'tertiary', name: 'Motorway bridge road' });
    label('bridge over a motorway', X, -650, [70, 60]);
  }
  // tunnels through the ridge (x = RIDGE_X): short, long (diagonal), curved, graded, rail, twin
  {
    const tun = (pts, tags, what, inside) => {
      // pts: approach / tunnel / approach split at indexes inside[0], inside[1]
      way(pts.slice(0, inside[0] + 1), tags);
      way(pts.slice(inside[0], inside[1] + 1), { ...tags, tunnel: 'yes', layer: '-1', name: what });
      way(pts.slice(inside[1]), tags);
      const [ax, ay] = pts[inside[0]]; const [bx, by] = pts[inside[1]];
      label(what, (ax + bx) / 2, (ay + by) / 2, [200, 0]);
      // (named by where they lie: a westbound line's first portal is its east one)
      const [wx, wy, ex, ey] = ax <= bx ? [ax, ay, bx, by] : [bx, by, ax, ay];
      label(`${what}: west portal`, wx, wy, [35, 60]); label(`${what}: east portal`, ex, ey, [35, -120]);
      // driver's views both ways: the entrance portal (from 30 m out), 25 %, 50 %, 75 % in, the exit portal
      const tube = pts.slice(inside[0], inside[1] + 1);
      for (const [dirName, line] of [['forward', tube], ['back', [...tube].reverse()]]) {
        const [sx, sy, sh] = along(line, 0); drive(`driver ${dirName}: ${what} entrance portal`, sx - 30 * Math.cos(sh), sy - 30 * Math.sin(sh), sh, 'down');
        for (const f of [0.25, 0.5, 0.75]) { const [x, y, h] = along(line, f); drive(`driver ${dirName}: ${what} ${f * 100} %`, x, y, h, 'up'); }
        // (the exit from 90 % in: nearer the portal the upward ray missed the tube's floor)
        const [ex, ey, eh] = along(line, 0.9); drive(`driver ${dirName}: ${what} exit portal`, ex, ey, eh, 'up');
      }
    };
    const line = (y, x0, x1) => run(x0, y, x1, y, 20);
    { const p = line(800, RIDGE_X - 300, RIDGE_X + 300); tun(p, { highway: 'secondary' }, 'short tunnel', [p.findIndex(([x]) => x >= RIDGE_X - 60), p.findIndex(([x]) => x >= RIDGE_X + 60)]); }
    { const p = run(RIDGE_X - 320, 400, RIDGE_X + 320, 640, 20); tun(p, { highway: 'primary', lanes: '2' }, 'long diagonal tunnel', [p.findIndex(([x]) => x >= RIDGE_X - 160), p.findIndex(([x]) => x >= RIDGE_X + 160)]); }
    { const p = []; for (let i = 0; i <= 40; i++) { const t = i / 40; p.push([RIDGE_X - 320 + 640 * t, 150 + 120 * Math.sin(Math.PI * t)]); } tun(p, { highway: 'secondary' }, 'curved tunnel', [10, 30]); }
    { const p = line(-100, RIDGE_X - 320, RIDGE_X + 320); tun(p, { highway: 'secondary', incline: '4%' }, 'graded tunnel', [p.findIndex(([x]) => x >= RIDGE_X - 150), p.findIndex(([x]) => x >= RIDGE_X + 150)]); }
    { const p = line(-300, RIDGE_X - 320, RIDGE_X + 320); tun(p, { railway: 'rail' }, 'rail tunnel', [p.findIndex(([x]) => x >= RIDGE_X - 150), p.findIndex(([x]) => x >= RIDGE_X + 150)]); }
    for (const [y, dir] of [[-520, 'east'], [-545, 'west']]) {
      const p = dir === 'east' ? line(y, RIDGE_X - 320, RIDGE_X + 320) : line(y, RIDGE_X + 320, RIDGE_X - 320);
      const i0 = p.findIndex(([x]) => Math.abs(x - (RIDGE_X + (dir === 'east' ? -150 : 150))) < 11);
      const i1 = p.findIndex(([x]) => Math.abs(x - (RIDGE_X + (dir === 'east' ? 150 : -150))) < 11);
      tun(p, { highway: 'motorway', oneway: 'yes', lanes: '2' }, `twin tunnel ${dir}bound`, [i0, i1]);
    }
  }
  const landCover = (x) => (Math.abs(x - RIDGE_X) < 200 ? 10 : 30);
  return { b, size: SIZE, heightAt, landCover };
}

// ── terrain: a mountain pass, a ridge road, steep streets, cuts and embankments, a valley road ──
function terrain(regionKey) {
  const SIZE = 2048; const b = makeBuilder(regionKey, SIZE); const { way, run, label } = b;
  const MTN = { x: 350, y: 350, r: 330, h: 350 };
  const heightAt = (x, y) => {
    let h = 30;
    h += MTN.h * Math.exp(-((x - MTN.x) ** 2 + (y - MTN.y) ** 2) / (2 * MTN.r * MTN.r));
    // a saddle: a second peak north-east, the pass between them
    h += 280 * Math.exp(-((x - 800) ** 2 + (y - 800) ** 2) / (2 * 220 * 220));
    // a hillside for the steep streets (west), rising 120 m over 600 m to the north
    // (blended in over 150 m: a hard edge at x = -400 was a 120 m cliff)
    h += Math.max(0, Math.min(1, (-400 - x) / 150)) * Math.max(0, Math.min(120, (y + 300) * 0.2));
    // a valley along y = -880 with a river, its floor falling 10 m west to east (a river runs downhill: on a level
    // floor crossed by the rolling hills it lay buried under every hump, its surface held at the lowest point so far)
    const dv = Math.abs(y + 880);
    // rolling hills (south), faded out before the valley
    h += Math.max(0, Math.min(1, (-350 - y) / 150)) * Math.max(0, Math.min(1, (dv - 140) / 100)) * 18 * Math.sin(x / 70) * Math.cos(y / 90);
    if (dv < 120) h -= 15 * (1 - (dv / 120) ** 2);
    if (dv < 240) h -= 0.005 * (x + 1000) * (1 - (dv / 240) ** 2);
    return h;
  };
  // the pass: switchbacks up the mountain's south face to the saddle between the two peaks
  {
    const pts = []; let y = -200; let dir = 1; const legs = 9; const R = 18;
    for (let k = 0; k < legs; k++) {
      const x0 = dir > 0 ? 150 : 550; const x1 = dir > 0 ? 550 : 150;
      for (let i = k === 0 ? 0 : 1; i <= 10; i++) pts.push([x0 + ((x1 - x0) * i) / 10, y]);
      // the hairpin: a half circle bulging outward, up to the next leg (2 R further north)
      if (k < legs - 1) for (let i = 1; i < 8; i++) { const a = -Math.PI / 2 + (i / 8) * Math.PI; pts.push([x1 + dir * R * Math.cos(a), y + R + R * Math.sin(a)]); }
      y += 2 * R; dir = -dir;
    }
    // on to the saddle
    for (let i = 1; i <= 15; i++) pts.push([pts.at(-1)[0] + 25, pts.at(-1)[1] + 25]);
    way(pts, { highway: 'secondary', name: 'Mountain pass' });
    // driver's views up the pass and back down: every 8 % of its length, hairpins included
    for (let f = 0.02; f < 1; f += 0.08) { const [x, y, h] = b.along(pts, f); b.drive(`driver up the pass ${Math.round(f * 100)} %`, x, y, h); }
    const down = [...pts].reverse();
    for (let f = 0.06; f < 1; f += 0.16) { const [x, y, h] = b.along(down, f); b.drive(`driver down the pass ${Math.round(f * 100)} %`, x, y, h); }
    label('pass: bottom', 150, -200, [60, 0]); label('pass: hairpins', 550, -128, [70, 0]); label('pass: top hairpins', 150, 70, [70, 0]);
    label('pass: up the east shoulder', pts.at(-1)[0] - 150, pts.at(-1)[1] - 150, [80, 0]);
  }
  // a ridge road from the summit west along the mountain's shoulder
  way(run(350, 350, -300, 500, 25), { highway: 'tertiary', name: 'Ridge road' }); label('steep ridge road (about 35 %)', 0, 430, [80, 0]);
  { const r = run(350, 350, -300, 500, 25); for (const f of [0.1, 0.4, 0.7]) { const [x, y, h] = b.along(r, f); b.drive(`driver down the ridge road ${f * 100} %`, x, y, h); } }
  // steep streets: a grid on the western hillside (slope 20 %)
  {
    const xs = []; for (let x = -950; x <= -500; x += 90) xs.push(x); const ys = []; for (let y = -300; y <= 300; y += 100) ys.push(y);
    for (const x of xs) way(run(x, -300, x, 300, 20, ys.map((y) => [x, y])), { highway: 'residential', name: `Steep street ${x}`, sidewalk: 'both' });
    for (const y of ys) way(run(-950, y, -500, y, 20, xs.map((x) => [x, y])), { highway: 'residential', name: `Contour street ${y}`, sidewalk: 'both' });
    label('steep street grid (20 %)', -725, 0, [150, 0]);
  }
  // a straight road across rolling hills: cuts and embankments
  way(run(-950, -600, 950, -600, 20), { highway: 'primary', lanes: '2', name: 'Rolling road' }); label('road across rolling hills', 0, -600, [120, 90]);
  way(run(-950, -480, 950, -480, 20), { highway: 'unclassified', name: 'Rolling lane' }); label('lane across rolling hills', 300, -480, [80, 90]);
  // a valley road along a river
  way(run(-1000, -880, 1000, -880, 25), { waterway: 'river', name: 'Valley river' });
  way(run(-950, -840, 950, -840, 20), { highway: 'secondary', name: 'Valley road' }); label('valley road beside the river', 0, -850, [80, 0]);
  const landCover = (x, y) => (heightAt(x, y) > 250 ? 60 : heightAt(x, y) > 150 ? 20 : y < -350 ? 40 : 10);
  return { b, size: SIZE, heightAt, landCover };
}

export const SUITES = { roads, structures, terrain };

if (import.meta.url === `file://${process.argv[1]}`) {
  const which = process.argv[2] || 'all'; const region = process.argv[3] || 'na_east';
  for (const s of which === 'all' ? Object.keys(SUITES) : [which]) {
    const { b, size, heightAt, landCover } = SUITES[s](region);
    await writeLevelArea({ name: `test_${s}_${region}`, size, b, heightAt, landCover, meta: { suite: s } });
  }
  process.exit(0);
}
