// The sidewalk test level (asked for by the user, 2026-11-24: "make sure this synthetic test covers every scenario you
// can think of"): every rule of the sidewalk builders (services/beamngSidewalks.js, pavedSidewalks.js, pavedArea.js,
// plazas.js, quayWalls.js) and every sidewalk fault seen so far, each on its own 200 m plot of a 9 x 9 grid.
//
//   rows 0-1   the tags: sidewalk=* values and sides, widths, width changes, road classes, untagged streets in and
//              out of town
//   row 2      junction corners: T, cross, skewed, sharp, obtuse, staggered, mixed classes, 5-way, roundabouts,
//              cul-de-sacs, curves and messy geometry
//   row 3      crossings (zebra, signals, islands, raised, kerb tags, inferred sidewalks), driveways, parking, medians
//   row 4      building fronts and lawns, street furniture, mapped footways (sidewalk lines near and far, plain
//              footways, stubs, surfaces), plazas
//   row 5      rail crossings, overpasses, bridges with sidewalks, footbridges, cycle tracks
//   column 0   the sea: a sea wall promenade, a street at the wall, a beach, a pier, a harbour quay, steps to the
//              beach, a sea-front square, a cliff path
//   rows 6-8   a canal with quays, a river with banks, a lake boardwalk (west); hills (east): streets up and across
//              slopes, a junction on a slope, steps, embankments and cuttings, terraces with a retaining wall, a
//              hairpin
//
// Every street that should count as in town has buildings along it (buildUrbanRoadClassifier); a plot meant as out
// of town has none. Local plot coordinates run -100..100; streets stay inside -90..90 so plots never touch.
//
// Nothing here is used by the export: it only writes OSM data for scripts/sweep/exportArea.mjs.

const COAST_X = -880;           // the coastline, land to the east (column 0's local x = -80)
const SEA_FLOOR = -4;
const BASE = 4;

export function sidewalks(regionKey, makeBuilder) {
  const SIZE = 2048; const b = makeBuilder(regionKey, SIZE);
  const { way, node, run, label, drive, along } = b;
  const heights = [];           // per plot: { cx, cy, dz(lx, ly) } added to the base

  const plot = (col, row, title, fn, dz = null) => {
    const cx = -800 + col * 200; const cy = 800 - row * 200;
    const G = ([x, y, t]) => [cx + x, cy + y, t];
    const o = {
      cx, cy,
      // a way through local points
      st: (pts, tags) => way(pts.map(G), tags),
      // a straight local run, nodes every `step` m and at each `through` point
      ln: (x0, y0, x1, y1, tags, step = 10, through = []) => way(run(cx + x0, cy + y0, cx + x1, cy + y1, step, through.map(([x, y]) => [cx + x, cy + y])), tags),
      nd: (x, y, tags) => node(cx + x, cy + y, tags),
      // a building (axis-aligned rectangle round its centre)
      bx: (x, y, w, h, tags = { building: 'yes' }) => way([[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2], [x - w / 2, y - h / 2]].map(G), tags),
      // an area from local points (closed)
      ar: (pts, tags) => way([...pts, pts[0]].map(G), tags),
      // houses along an east-west street at y: both sides unless side is given, the fronts `back` m from its centre
      row: (x0, x1, y, { back = 8, depth = 10, w = 12, gap = 4, side = 0, tags = { building: 'house' } } = {}) => {
        for (const s of side ? [side] : [1, -1]) for (let x = x0 + w / 2; x + w / 2 <= x1; x += w + gap) o.bx(x, y + s * (back + depth / 2), w, depth, tags);
      },
      // ... and along a north-south street at x
      col: (y0, y1, x, { back = 8, depth = 10, w = 12, gap = 4, side = 0, tags = { building: 'house' } } = {}) => {
        for (const s of side ? [side] : [1, -1]) for (let y = y0 + w / 2; y + w / 2 <= y1; y += w + gap) o.bx(x + s * (back + depth / 2), y, depth, w, tags);
      },
      // (the tour's camera: no fixed direction, so ingame_tour.lua takes the first of its eight with a clear line to
      // the spot: along the street, over the houses that hid it from a fixed side; 40 m at most, sidewalks are small)
      lab: (what, x, y, tour = [40]) => label(`${title}: ${what}`, cx + x, cy + y, [Math.min(40, tour[0]), null]),
      // a walker's view at eye height on the sidewalk (x, y), looking along heading (radians, 0 = east)
      walk: (what, x, y, heading) => drive(`walker: ${title}: ${what}`, cx + x, cy + y, heading),
      drv: (what, x, y, heading) => drive(`driver: ${title}: ${what}`, cx + x, cy + y, heading),
    };
    fn(o);
    if (dz) heights.push({ cx, cy, dz });
  };

  // a street of the tag plots: east-west at y with houses both sides, a label and walker views on both sidewalks
  const tagStreet = (o, y, tags, what, { houses = true, back = 8 } = {}) => {
    o.ln(-85, y, 85, y, { highway: 'residential', name: what, ...tags }, 10);
    if (houses) o.row(-80, 80, y, { back });
    o.lab(what, 0, y, [45, 0]);
    o.walk(`${what}, north side`, -60, y + 4.5, 0); o.walk(`${what}, south side`, 60, y - 4.5, Math.PI);
  };
  const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  // a plot's height eased to the base over its last `ease` m (no road comes near its edge)
  const eased = (f, ease = 18) => (lx, ly) => f(lx, ly) * smooth((100 - Math.max(Math.abs(lx), Math.abs(ly))) / ease);

  // ═════ row 0: sidewalk values ═════
  plot(1, 0, 'sidewalk values A', (o) => {
    tagStreet(o, 70, { sidewalk: 'both' }, 'sidewalk=both');
    tagStreet(o, 25, { sidewalk: 'left' }, 'sidewalk=left (north side: node order runs east)');
    tagStreet(o, -20, { sidewalk: 'right' }, 'sidewalk=right (south side)');
    tagStreet(o, -65, { sidewalk: 'no' }, 'sidewalk=no (bare curb in town)');
  });
  plot(2, 0, 'sidewalk values B', (o) => {
    tagStreet(o, 70, { sidewalk: 'none' }, 'sidewalk=none');
    tagStreet(o, 25, { sidewalk: 'yes' }, 'sidewalk=yes');
    tagStreet(o, -20, { 'sidewalk:both': 'yes' }, 'sidewalk:both=yes');
    tagStreet(o, -65, { 'sidewalk:both': 'no' }, 'sidewalk:both=no');
  });
  plot(3, 0, 'sidewalk sides', (o) => {
    tagStreet(o, 70, { 'sidewalk:left': 'yes', 'sidewalk:right': 'no' }, 'sidewalk:left=yes + sidewalk:right=no');
    tagStreet(o, 25, { sidewalk: 'both', 'sidewalk:right': 'no' }, 'sidewalk=both overridden by sidewalk:right=no');
    // sidewalk=separate: the sidewalks are mapped as their own footways, 5 m from the centre
    tagStreet(o, -20, { sidewalk: 'separate' }, 'sidewalk=separate + footway=sidewalk lines', { back: 10 });
    for (const s of [1, -1]) o.ln(-85, -20 + s * 5.5, 85, -20 + s * 5.5, { highway: 'footway', footway: 'sidewalk' }, 10);
    tagStreet(o, -65, { 'sidewalk:right': 'separate', 'sidewalk:left': 'yes' }, 'sidewalk:left=yes, right mapped separately');
    o.ln(-85, -70.5, 85, -70.5, { highway: 'footway', footway: 'sidewalk' }, 10);
  });
  plot(4, 0, 'sidewalk widths', (o) => {
    tagStreet(o, 70, { sidewalk: 'both', 'sidewalk:width': '1.2' }, 'sidewalk:width=1.2');
    tagStreet(o, 25, { sidewalk: 'both', 'sidewalk:width': '3' }, 'sidewalk:width=3', { back: 9 });
    tagStreet(o, -20, { sidewalk: 'both', 'sidewalk:both:width': '5' }, 'sidewalk:both:width=5', { back: 11 });
    tagStreet(o, -65, { sidewalk: 'both', 'sidewalk:width': '8' }, 'sidewalk:width=8 (held to 6)', { back: 13 });
  });
  plot(5, 0, 'width per side and changes', (o) => {
    tagStreet(o, 70, { sidewalk: 'both', 'sidewalk:left:width': '4', 'sidewalk:right:width': '1.5' }, 'left 4 m, right 1.5 m', { back: 10 });
    // one street, its sidewalk 2 m then 4 m (two ways sharing the node at x = 0)
    o.ln(-85, 25, 0, 25, { highway: 'residential', name: 'Width step', sidewalk: 'both', 'sidewalk:width': '2' });
    o.ln(0, 25, 85, 25, { highway: 'residential', name: 'Width step', sidewalk: 'both', 'sidewalk:width': '4' });
    o.row(-80, 80, 25, { back: 10 }); o.lab('sidewalk width 2 m -> 4 m at x = 0', 0, 25, [40, 0]);
    o.walk('width step, north side', -20, 29.5, 0);
    // the sidewalk stops halfway (both -> no)
    o.ln(-85, -20, 0, -20, { highway: 'residential', name: 'Sidewalk ends', sidewalk: 'both' });
    o.ln(0, -20, 85, -20, { highway: 'residential', name: 'Sidewalk ends', sidewalk: 'no' });
    o.row(-80, 80, -20); o.lab('sidewalk both -> no at x = 0 (the loose end)', 0, -20, [40, 0]);
    o.walk('sidewalk end, north side', -25, -15.5, 0);
    // the side switches (left -> right)
    o.ln(-85, -65, 0, -65, { highway: 'residential', name: 'Side switch', sidewalk: 'left' });
    o.ln(0, -65, 85, -65, { highway: 'residential', name: 'Side switch', sidewalk: 'right' });
    o.row(-80, 80, -65); o.lab('sidewalk left -> right at x = 0', 0, -65, [40, 0]);
  });
  plot(6, 0, 'road classes A', (o) => {
    tagStreet(o, 70, { highway: 'primary', sidewalk: 'both' }, 'primary, sidewalk=both', { back: 11 });
    tagStreet(o, 25, { highway: 'secondary', sidewalk: 'both' }, 'secondary, sidewalk=both', { back: 10 });
    tagStreet(o, -20, { highway: 'tertiary', sidewalk: 'both' }, 'tertiary, sidewalk=both');
    tagStreet(o, -65, { highway: 'unclassified', sidewalk: 'both' }, 'unclassified, sidewalk=both');
  });
  plot(7, 0, 'road classes B', (o) => {
    tagStreet(o, 70, { highway: 'living_street', sidewalk: 'both' }, 'living_street, sidewalk=both');
    tagStreet(o, 25, { highway: 'service', sidewalk: 'both' }, 'service, sidewalk=both (not a curbed class)');
    tagStreet(o, -20, { highway: 'trunk', sidewalk: 'both' }, 'trunk, sidewalk=both (not a curbed class)', { back: 12 });
    tagStreet(o, -65, { oneway: 'yes', lanes: '1', sidewalk: 'both' }, 'one-way, 1 lane, sidewalk=both');
  });
  plot(8, 0, 'road classes C', (o) => {
    tagStreet(o, 70, { highway: 'cycleway', sidewalk: 'both' }, 'cycleway, sidewalk=both');
    tagStreet(o, 25, { lanes: '4', width: '14', sidewalk: 'both' }, 'residential, 4 lanes, width=14', { back: 12 });
    tagStreet(o, -20, { highway: 'track', sidewalk: 'both' }, 'track, sidewalk=both');
    tagStreet(o, -65, { highway: 'pedestrian' }, 'highway=pedestrian street (a line)');
  });

  // ═════ row 1: untagged streets, in town and out ═════
  plot(1, 1, 'untagged in town', (o) => {
    tagStreet(o, 70, {}, 'untagged, houses 2 m behind the curb line (paved to the fronts?)', { back: 6 });
    tagStreet(o, 25, {}, 'untagged, houses 15 m back (front lawns kept)', { back: 15 });
    tagStreet(o, -20, { highway: 'tertiary' }, 'untagged tertiary, shops at 5 m', { houses: false });
    o.row(-80, 80, -20, { back: 7, w: 20, gap: 0, tags: { building: 'retail' } });
    tagStreet(o, -65, { highway: 'service' }, 'untagged service in town');
  });
  plot(2, 1, 'out of town', (o) => {
    tagStreet(o, 70, {}, 'untagged residential, no buildings (open edge)', { houses: false });
    tagStreet(o, 25, { sidewalk: 'both' }, 'sidewalk=both, no buildings', { houses: false });
    tagStreet(o, -20, { highway: 'tertiary' }, 'untagged tertiary, no buildings', { houses: false });
    // houses on one side only
    tagStreet(o, -65, {}, 'untagged, houses on the north side only', { houses: false });
    o.row(-80, 80, -65, { side: 1 });
  });
  // a cycleway with a sidewalk of its own (thecoachtoma, 2026-11-24: "cycleways can have sidewalks too", his photo: an
  // asphalt cycle path out in the open, a paved sidewalk along its left, highway=cycleway + sidewalk=left, and
  // width:sidewalk:<side> for its width)
  plot(4, 1, 'cycleway with a sidewalk', (o) => {
    o.ln(-85, 60, 85, 60, { highway: 'cycleway', surface: 'asphalt', sidewalk: 'left', 'width:sidewalk:left': '2.5', name: 'Cycle path A' }, 10);
    o.lab('cycleway out of town, sidewalk=left, width:sidewalk:left=2.5 (Toma\'s photo)', 0, 60, [35]);
    o.walk('on the cycleway\'s sidewalk', -60, 62.5, 0); o.drv('riding the cycleway', -60, 59.5, 0);
    o.ln(-85, 0, 85, 0, { highway: 'cycleway', surface: 'asphalt', sidewalk: 'left', 'width:sidewalk:left': '2.5', 'sidewalk:left:surface': 'paving_stones', name: 'Cycle path B' }, 10);
    o.lab('the same, sidewalk:left:surface=paving_stones', 0, 0, [35]);
    o.walk('on the paving-stone sidewalk', -60, 2.5, 0);
    o.ln(-85, -60, 85, -60, { highway: 'cycleway', surface: 'asphalt', sidewalk: 'right', name: 'Cycle path C' }, 10); o.row(-80, 80, -60, { back: 8 });
    o.lab('cycleway in town, sidewalk=right', 0, -60, [35]);
    o.walk('on the town cycleway\'s sidewalk', 60, -62.5, Math.PI);
  });
  // kerbs mapped as lines and road surfaces as areas (Splatplays' Armadale, 2026-11-25: barrier=kerb along every
  // street, area:highway=*): the street as wide as its kerbs (kerbWidths.js), its curb on the kerb, a mapped sidewalk
  // flush against it
  plot(5, 1, 'mapped kerbs', (o) => {
    // an 8 m street between mapped kerbs, wider than its class's 5.5 m, its sidewalks mapped as footways at the kerb
    o.ln(-85, 60, 85, 60, { highway: 'tertiary', sidewalk: 'separate', lane_markings: 'no', name: 'Kerbed street' }, 10, [[0, 60]]);
    for (const s of [1, -1]) {
      o.ln(-85, 60 + s * 4, -8, 60 + s * 4, { barrier: 'kerb' }, 10); if (s > 0) o.ln(8, 64, 85, 64, { barrier: 'kerb' }, 10); else o.ln(-8, 56, 85, 56, { barrier: 'kerb' }, 10);
      o.ln(-85, 60 + s * 5.2, 85, 60 + s * 5.2, { highway: 'footway', footway: 'sidewalk' }, 10);
    }
    o.row(-80, -14, 60, { back: 11, side: 1 }); o.row(14, 80, 60, { back: 11, side: 1 }); o.row(-80, 80, 60, { back: 11, side: -1 });
    // ... a side street joining from the north, kerbs round its corners
    o.ln(0, 60, 0, 95, { highway: 'residential', sidewalk: 'separate', name: 'Kerbed side street' }, 10);
    for (const s of [1, -1]) {
      const arc = Array.from({ length: 7 }, (_, i) => { const a = (i / 6) * (Math.PI / 2); return [s * (3.5 + 4.5 - 4.5 * Math.cos(a)), 64 + 4.5 - 4.5 * Math.sin(a)]; }).reverse();
      o.st([[s * 3.5, 95], [s * 3.5, 68.5], ...arc.slice(1), [s * 8, 64]], { barrier: 'kerb' });
    }
    o.lab('8 m between mapped kerbs (barrier=kerb), sidewalks mapped at the kerb: no trench', -40, 60, [35]);
    o.lab('side street with kerbs round its corners', 0, 66, [35]);
    o.walk('on the mapped sidewalk at the kerb', -60, 65.2, 0); o.drv('driving the kerbed street', -60, 58, 0);
    // a road's surface mapped as an area (area:highway), sidewalk=both
    o.ln(-85, 0, 85, 0, { highway: 'residential', sidewalk: 'both', name: 'Road area street' }, 10);
    o.ar([[-85, -3.6], [85, -3.6], [85, 3.6], [-85, 3.6]], { 'area:highway': 'residential', surface: 'asphalt' });
    o.row(-80, 80, 0, { back: 9 });
    o.lab('road surface mapped as area:highway=residential, 7.2 m', 0, 0, [35]);
    // kerbs on one side only: the street keeps its class width
    // bare curbs: sidewalk=separate, the sidewalk mapped on the north side only; the south side is a bare curb, the
    // verge behind it graded up to its top (Splatplays: "the curb section should match the level of sidewalks")
    o.ln(-85, -30, 85, -30, { highway: 'tertiary', sidewalk: 'separate', lane_markings: 'no', name: 'Bare curb street' }, 10);
    for (const s2 of [1, -1]) o.ln(-85, -30 + s2 * 3.7, 85, -30 + s2 * 3.7, { barrier: 'kerb' }, 10);
    o.ln(-85, -24.8, 85, -24.8, { highway: 'footway', footway: 'sidewalk' }, 10);
    o.lab('sidewalk=separate, none mapped on the south side: a bare curb, the verge at its top', 0, -33.7, [30]);
    o.walk('on the verge behind the bare curb', -40, -35, 0);
    o.ln(-85, -60, 85, -60, { highway: 'residential', name: 'One kerb street' }, 10);
    o.ln(-85, -56, 85, -56, { barrier: 'kerb' }, 10); o.row(-80, 80, -60, { back: 9 });
    o.lab('a kerb mapped on one side only (the class width kept)', 0, -60, [35]);
  });
  // traffic islands mapped as areas (Splatplays' Galliers Avenue, 2026-11-25): a street splitting into one-way
  // carriageways before a junction, short islands between them; the median raised only along the islands
  // corners where no rounded corner fits for the corner's own streets, and a sidewalk mapped beside a concrete trunk road
  // (the user's St. Augustine level, 2026-11-26: Cordova x King St.'s corners ended square with grass between, Ponce de
  // Leon Blvd had a dirt strip and a sidewalk raised with curbs on both sides)
  plot(7, 1, 'corners and verges', (o) => {
    // A: a crossroads whose side street's line jogs 7 m sideways in its last 5 m into the junction (as Cordova St. into
    // King St.): its carriageway sweeps across one corner
    o.ln(-85, 45, 85, 45, { highway: 'residential', sidewalk: 'both', name: 'Bend main' }, 10, [[0, 45]]);
    o.st([[0, 45], [-7, 40], [-7, 0]], { highway: 'residential', sidewalk: 'both', name: 'Bend side' });
    o.ln(0, 45, 0, 90, { highway: 'residential', sidewalk: 'both', name: 'Bend north' });
    o.row(-80, -20, 45); o.row(20, 80, 45);
    o.lab('side street bending into the junction: corners paved square, curb along the road', 0, 45, [50, 0]);
    o.walk('round the bent corner', -20, 39, 0);
    // B: a main street drawn as two ways of different widths meeting at a T
    o.ln(-85, -5, 0, -5, { highway: 'residential', sidewalk: 'both', width: '7', name: 'Two widths' });
    o.ln(0, -5, 85, -5, { highway: 'residential', sidewalk: 'both', width: '13', name: 'Two widths' });
    o.ln(0, -5, 0, -40, { highway: 'residential', sidewalk: 'both', name: 'Two widths side' });
    o.lab('main street of two widths at a T: both corners joined', 0, -5, [45, 0]);
    // C: a concrete trunk road with its sidewalk mapped 2.5 m off its edge (a lawn verge between), houses behind
    o.ln(-85, -70, 85, -70, { highway: 'trunk', lanes: '2', oneway: 'yes', surface: 'concrete', name: 'Concrete boulevard' }, 10);
    o.ln(-85, -62.5, 85, -62.5, { highway: 'footway', footway: 'sidewalk' }, 10);
    o.row(-80, 80, -70, { side: 1, back: 16 });
    o.lab('concrete trunk with a mapped sidewalk 2.5 m off: grass verge, sidewalk flush, no dirt edge', 0, -66, [40, 0]);
    o.walk('along the boulevard sidewalk', -40, -62.5, 0);
  });
  plot(8, 1, 'sidewalks set back', (o) => {
    // a diagonal downtown street (no houses near) with its sidewalks mapped as their own ways: on the north-east side
    // 8.5 m back from the road's edge (a bayfront sidewalk along a seawall), a grass verge between, clean edges; on the
    // south-west side 1 m off, paved to the curb (St. Augustine's Avenida Menendez came out a paved strip with a
    // sawtooth edge on its set-back side, the user 2026-11-26)
    const d = (t, off) => [-60 + t * 120 * 0.8 + off * 0.6, -60 + t * 120 * 0.6 - off * 0.8];
    o.st([d(0, 0), d(0.5, 0), d(1, 0)], { highway: 'tertiary', lanes: '2', name: 'Bayfront avenue', 'sidewalk:both': 'separate' });
    o.st([d(0, -13.5), d(0.5, -13.5), d(1, -13.5)], { highway: 'footway', footway: 'sidewalk', surface: 'concrete' });
    o.st([d(0, 6.5), d(0.5, 6.5), d(1, 6.5)], { highway: 'footway', footway: 'sidewalk', surface: 'concrete' });
    o.ar([[30, -60], [70, -60], [70, -20], [30, -20]], { landuse: 'commercial' });
    o.lab('sidewalk 8.5 m back: grass verge to it, straight edges; the other side 1 m off, paved to the curb', 0, 0, [40, 0]);
    o.walk('along the set-back sidewalk', -22, -34, Math.atan2(0.6, 0.8));
  });
  plot(6, 1, 'traffic islands', (o) => {
    o.ln(-60, -90, -60, 90, { highway: 'residential', name: 'Cross street' }, 10, [[-60, 0], [-60, 3.5], [-60, -3.5]]);
    o.ln(20, 0, 85, 0, { highway: 'tertiary', name: 'Island avenue' }, 10);
    o.st([[20, 0], [10, 3.5], [0, 3.5], [-20, 3.5], [-40, 3.5], [-60, 3.5]], { highway: 'tertiary', oneway: 'yes', name: 'Island avenue' });
    o.st([[-60, -3.5], [-40, -3.5], [-20, -3.5], [0, -3.5], [10, -3.5], [20, 0]], { highway: 'tertiary', oneway: 'yes', name: 'Island avenue' });
    for (const s of [1, -1]) {
      o.st([[-55, s * 7], [10, s * 7], [25, s * 4.5], [85, s * 4.5]], { barrier: 'kerb' });
    }
    o.ar([[-52, -1.4], [-46, -1.4], [-46, 1.4], [-52, 1.4]], { 'area:highway': 'traffic_island' });
    o.ar([[-42, -1.4], [-38, -1.4], [-38, 1.4], [-42, 1.4]], { 'area:highway': 'traffic_island' });
    o.ar([[-20, -1.6], [0, -1.6], [8, 0], [0, 1.6], [-20, 1.6]], { 'area:highway': 'traffic_island' });
    o.row(-50, 80, 0, { back: 13 }); o.col(-80, 80, -60, { back: 9, side: -1 });
    o.lab('a split before a junction, islands mapped as areas: raised only there, paved between', -30, 0, [40]);
    o.drv('driving west to the junction', 40, 2, Math.PI);
  });
  plot(3, 1, 'unmapped ground and other roads', (o) => {
    // a second road 3 m behind the curb: the strip between is no sidewalk (UNMAPPED_ROAD_CLEAR_M)
    tagStreet(o, 70, {}, 'untagged, a service road 9 m away in parallel', { houses: false });
    o.ln(-85, 61, 85, 61, { highway: 'service', name: 'Parallel service' }); o.row(-80, 80, 70, { side: 1 }); o.row(-80, 80, 61, { side: -1, back: 7 });
    // a wall 3 m behind the curb along a bare street
    tagStreet(o, 25, {}, 'untagged, a wall 4 m behind the curb', { houses: false });
    o.ln(-80, 32, 80, 32, { barrier: 'wall', height: '2' }); o.row(-80, 80, 25, { side: -1 });
    // a fence and a hedge behind sidewalks
    tagStreet(o, -20, { sidewalk: 'both' }, 'sidewalk=both, fence north, hedge south', { houses: false });
    o.ln(-80, -14, 80, -14, { barrier: 'fence' }); o.ln(-80, -26, 80, -26, { barrier: 'hedge' });
    o.row(-80, 80, -20, { back: 12 });
    // a landuse=grass verge mapped between curb and houses
    tagStreet(o, -65, {}, 'untagged, mapped grass verge to the houses', { back: 10 });
    for (const s of [1, -1]) o.ar([[-85, -65 + s * 4], [85, -65 + s * 4], [85, -65 + s * 9], [-85, -65 + s * 9]], { landuse: 'grass' });
  });

  // ═════ row 2: junction corners ═════
  const arms = (o, cx, cy, list, tags = { highway: 'residential', sidewalk: 'both' }, len = 60) => {
    for (const [ang, extra] of list) {
      const a = (ang * Math.PI) / 180;
      o.ln(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len, { ...tags, ...(extra || {}) }, 10);
    }
  };
  // houses round a junction: a block in each sector between neighbouring arms
  const blocks = (o, cx, cy, angles, r = 22) => {
    const s = [...angles].sort((p, q) => p - q);
    for (let i = 0; i < s.length; i++) {
      const a0 = s[i]; const a1 = i + 1 < s.length ? s[i + 1] : s[0] + 360;
      if (a1 - a0 < 50) continue;
      const m = (((a0 + a1) / 2) * Math.PI) / 180;
      o.bx(cx + Math.cos(m) * r, cy + Math.sin(m) * r, 12, 12);
    }
  };
  plot(1, 2, 'T and cross', (o) => {
    arms(o, -40, 40, [[0], [180], [-90]]); blocks(o, -40, 40, [0, 180, -90]); o.lab('T junction', -40, 40, [50, 0]);
    o.walk('round the T corner', -55, 33, 0);
    arms(o, 40, -40, [[0], [90], [180], [-90]]); blocks(o, 40, -40, [0, 90, 180, -90]); o.lab('crossroads', 40, -40, [50, 0]);
    o.walk('round the cross corner', 25, -45, 0);
  });
  plot(2, 2, 'skewed and sharp', (o) => {
    arms(o, -45, 45, [[0], [180], [-135]], undefined, 40); blocks(o, -45, 45, [0, 180, -135]); o.lab('skewed T (45 degrees)', -45, 45, [50, 0]);
    arms(o, 45, 45, [[180], [-30], [30]], undefined, 40); o.lab('fork at 60 degrees', 45, 45, [50, 0]);
    arms(o, -45, -45, [[0], [180], [-160]], undefined, 40); o.lab('sharp junction (20 degrees: past the corner rule)', -45, -45, [50, 0]);
    arms(o, 45, -45, [[180], [20]], undefined, 40); o.bx(45, -30, 12, 10); o.lab('bend of 160 degrees between two ways', 45, -45, [50, 0]);
  });
  plot(3, 2, 'staggered and short', (o) => {
    o.ln(-85, 40, 85, 40, { highway: 'residential', sidewalk: 'both', name: 'Stagger main' }, 10, [[-8, 40], [8, 40]]);
    o.ln(-8, 40, -8, 90, { highway: 'residential', sidewalk: 'both' }); o.ln(8, 40, 8, -10, { highway: 'residential', sidewalk: 'both' });
    o.row(-80, -25, 40); o.row(25, 80, 40); o.lab('staggered crossroads (two Ts 16 m apart)', 0, 40, [50, 0]);
    // a street 10 m long between two junctions
    o.ln(-85, -50, 85, -50, { highway: 'residential', sidewalk: 'both', name: 'Short link main' }, 10, [[-5, -50], [5, -50]]);
    o.ln(-5, -50, -5, -90, { highway: 'residential', sidewalk: 'both' }); o.ln(5, -50, 5, -90, { highway: 'residential', sidewalk: 'both' });
    o.row(-80, -20, -50); o.row(20, 80, -50); o.lab('10 m of street between two side streets', 0, -50, [45, 0]);
  });
  plot(4, 2, 'mixed classes', (o) => {
    arms(o, -40, 40, [[0, { highway: 'primary' }], [180, { highway: 'primary' }], [-90]]); blocks(o, -40, 40, [0, 180, -90], 26);
    o.lab('primary with a residential side street (6 m and 3 m corners)', -40, 40, [55, 0]);
    // the side street has sidewalks, the main road none
    arms(o, 40, -40, [[0, { sidewalk: 'no' }], [180, { sidewalk: 'no' }], [90]]); blocks(o, 40, -40, [0, 180, 90]);
    o.lab('side street with sidewalks meeting a main road without', 40, -40, [50, 0]);
  });
  plot(5, 2, 'five ways and a dead end', (o) => {
    arms(o, -30, 30, [[0], [72], [144], [216], [288]], undefined, 55); o.lab('five-way junction', -30, 30, [55, 0]);
    o.ln(30, -50, 85, -50, { highway: 'residential', sidewalk: 'both', name: 'Dead end' }); o.row(35, 80, -50);
    o.lab('dead end without a turning circle', 30, -50, [40, 0]); o.walk('to the dead end', 60, -45.5, Math.PI);
  });
  plot(6, 2, 'roundabouts', (o) => {
    // (counter-clockwise, as right-hand traffic drives it: its right side, the sidewalk, is the outside)
    const ring = []; for (let i = 0; i <= 24; i++) { const a = (i / 24) * 2 * Math.PI; ring.push([-35 + 20 * Math.cos(a), 35 + 20 * Math.sin(a)]); }
    ring[24] = ring[0];
    o.st(ring, { highway: 'residential', junction: 'roundabout', sidewalk: 'right', name: 'Roundabout' });
    for (const ang of [0, 90, 180, 270]) { const a = (ang * Math.PI) / 180; o.ln(-35 + 20 * Math.cos(a), 35 + 20 * Math.sin(a), -35 + 62 * Math.cos(a), 35 + 62 * Math.sin(a), { highway: 'residential', sidewalk: 'both' }); }
    blocks(o, -35, 35, [0, 90, 180, 270], 40); o.lab('roundabout r = 20 m, sidewalk outside', -35, 35, [70, 0]);
    o.walk('round the roundabout', -35, 9, 0);
    arms(o, 45, -45, [[0], [90], [180], [270]], undefined, 40); o.nd(45, -45, { highway: 'mini_roundabout' });
    blocks(o, 45, -45, [0, 90, 180, 270]); o.lab('mini roundabout', 45, -45, [45, 0]);
  });
  plot(7, 2, 'cul-de-sacs', (o) => {
    // (its end 30 m short of the loop's stem: the bulb, about 10 m round, ran into it)
    o.ln(-85, 50, -40, 50, { highway: 'residential', sidewalk: 'both', name: 'Turning circle' }); o.nd(-40, 50, { highway: 'turning_circle' });
    o.row(-80, -55, 50); o.lab('cul-de-sac with a turning circle', -40, 50, [40, 0]); o.walk('to the turning circle', -65, 54.5, 0);
    // a lollipop: a loop at the end of a stem
    const loop = []; for (let i = 0; i <= 16; i++) { const a = Math.PI + (i / 16) * 2 * Math.PI; loop.push([45 + 15 * Math.cos(a), 50 + 15 * Math.sin(a)]); } loop[16] = loop[0];
    o.ln(-10, 50, 30, 50, { highway: 'residential', sidewalk: 'both' }); o.st(loop, { highway: 'residential', sidewalk: 'both', name: 'Loop' });
    o.bx(45, 50, 10, 10); o.lab('cul-de-sac loop round an island of houses', 45, 50, [50, 0]);
    // a turning loop as a closed ring with one way in, untagged
    o.ln(-85, -50, 0, -50, { highway: 'residential', name: 'Plain end' }); o.row(-80, -5, -50);
    o.lab('untagged street ending in town', 0, -50, [40, 0]);
  });
  plot(8, 2, 'curves and messy lines', (o) => {
    // south along x = -80, a left turn of r = 15 m round (-65, 45), east to x = -50
    const arc = []; for (let i = 0; i <= 12; i++) { const a = Math.PI + (i / 12) * (Math.PI / 2); arc.push([-65 + 15 * Math.cos(a), 45 + 15 * Math.sin(a)]); }
    o.st([[-80, 85], [-80, 65], ...arc, [-50, 30]], { highway: 'residential', sidewalk: 'both', name: 'Tight curve' });
    o.lab('tight curve, r = 15 m', -70, 40, [45, 0]);
    const s = []; for (let i = 0; i <= 40; i++) { const x = -40 + i * 3; s.push([x, 45 + 18 * Math.sin((i / 40) * 2 * Math.PI)]); }
    o.st(s, { highway: 'residential', sidewalk: 'both', name: 'S bend' }); o.lab('S bend', 20, 45, [45, 0]);
    // zigzag: nodes 0.4 m off the line every 3 m (dewobble), and nodes every metre
    const z = []; for (let i = 0; i <= 50; i++) z.push([-75 + i * 3, -30 + (i % 2 ? 0.4 : -0.4)]);
    o.st(z, { highway: 'residential', sidewalk: 'both', name: 'Wobbly' }); o.row(-70, 70, -30, { back: 9 }); o.lab('wobbly nodes (0.4 m zigzag)', 0, -30, [40, 0]);
    o.walk('along the wobbly street', -50, -25.5, 0);
    o.ln(-85, -75, 85, -75, { highway: 'residential', sidewalk: 'both', name: 'Dense nodes' }, 1); o.lab('a node every metre', 0, -75, [40, 0]);
  });

  // ═════ row 3: crossings, driveways, parking, medians ═════
  const crossing = (o, x, y, tags, len = 9, extra = {}) => {
    o.nd(x, y, { highway: 'crossing', ...tags });
    o.st([[x, y - len, extra.endA], [x, y], [x, y + len, extra.endB]], { highway: 'footway', footway: 'crossing', ...tags });
  };
  plot(1, 3, 'crossings A', (o) => {
    o.ln(-85, 50, 85, 50, { highway: 'secondary', sidewalk: 'both', name: 'Zebra street' }, 10, [[0, 50]]);
    crossing(o, 0, 50, { crossing: 'uncontrolled', 'crossing:markings': 'zebra' }); o.row(-80, -10, 50, { back: 10 }); o.row(10, 80, 50, { back: 10 });
    o.lab('zebra crossing mid-block', 0, 50, [35, 0]); o.walk('up to the zebra', -20, 55, 0);
    arms(o, 0, -40, [[0], [90], [180], [270]], { highway: 'secondary', sidewalk: 'both' }, 70); o.nd(0, -40, { highway: 'traffic_signals' });
    for (const [x, y] of [[20, -40], [-20, -40]]) { o.nd(x, y, { highway: 'crossing', crossing: 'traffic_signals' }); o.st([[x, y - 9], [x, y], [x, y + 9]], { highway: 'footway', footway: 'crossing', crossing: 'traffic_signals' }); }
    blocks(o, 0, -40, [0, 90, 180, 270], 30); o.lab('signalled junction with crossings', 0, -40, [55, 0]);
  });
  plot(2, 3, 'crossings B', (o) => {
    o.ln(-85, 55, 85, 55, { highway: 'primary', lanes: '4', sidewalk: 'both', name: 'Island street' }, 10, [[-30, 55]]);
    crossing(o, -30, 55, { crossing: 'uncontrolled', 'crossing:island': 'yes' }, 14); o.row(-80, 80, 55, { back: 14 });
    o.lab('crossing with an island (crossing:island=yes)', -30, 55, [40, 0]);
    o.ln(-85, 0, 85, 0, { highway: 'residential', sidewalk: 'both', name: 'Raised crossing street' }, 10, [[0, 0]]);
    o.nd(0, 0, { highway: 'crossing', crossing: 'uncontrolled', traffic_calming: 'table' });
    o.st([[0, -8], [0, 0], [0, 8]], { highway: 'footway', footway: 'crossing', crossing: 'uncontrolled', traffic_calming: 'table' });
    o.row(-80, 80, 0); o.lab('raised crossing (traffic_calming=table)', 0, 0, [35, 0]);
    // kerb tags on the crossing's ends
    o.ln(-85, -55, 85, -55, { highway: 'residential', sidewalk: 'both', name: 'Kerb tag street' }, 10, [[-40, -55], [0, -55], [40, -55]]);
    crossing(o, -40, -55, { crossing: 'unmarked' }, 8, { endA: { kerb: 'lowered' }, endB: { kerb: 'lowered' } });
    crossing(o, 0, -55, { crossing: 'unmarked' }, 8, { endA: { kerb: 'raised' }, endB: { kerb: 'raised' } });
    crossing(o, 40, -55, { crossing: 'unmarked' }, 8, { endA: { kerb: 'flush' }, endB: { kerb: 'flush' } });
    o.row(-80, 80, -55, { back: 10 }); o.lab('kerb=lowered / raised / flush at crossing ends', 0, -55, [45, 0]);
  });
  plot(3, 3, 'inferred sidewalks', (o) => {
    // an untagged street whose crossing ends 4 m past its centre: sidewalks taken from the crossing
    o.ln(-85, 50, 85, 50, { highway: 'residential', name: 'Inferred street' }, 10, [[0, 50]]);
    crossing(o, 0, 50, { crossing: 'zebra' }, 6); o.row(-80, 80, 50, { back: 9 });
    o.lab('untagged street, a crossing ending beside it (sidewalks inferred)', 0, 50, [40, 0]);
    // a crossing whose footways carry on past the street into a park path
    o.ln(-85, -10, 85, -10, { highway: 'residential', name: 'Path crossing street' }, 10, [[0, -10]]);
    o.nd(0, -10, { highway: 'crossing', crossing: 'unmarked' });
    o.st([[0, -40], [0, -10], [0, 30]], { highway: 'footway', footway: 'crossing', crossing: 'unmarked' });
    o.ar([[-85, -15], [85, -15], [85, -45], [-85, -45]], { leisure: 'park' });
    o.lab('a park path crossing an untagged street', 0, -10, [40, 0]);
    // a cycle crossing
    o.ln(-85, -70, 85, -70, { highway: 'residential', sidewalk: 'both', name: 'Cycle crossing street' }, 10, [[30, -70]]);
    o.nd(30, -70, { highway: 'crossing', crossing: 'traffic_signals', bicycle: 'yes' });
    o.st([[30, -85], [30, -70], [30, -55]], { highway: 'cycleway', cycleway: 'crossing', crossing: 'traffic_signals' });
    o.row(-80, 80, -70); o.lab('cycleway crossing (cycleway=crossing)', 30, -70, [40, 0]);
  });
  plot(4, 3, 'driveways', (o) => {
    const drives = [-60, -40, -20, 0, 20];
    o.ln(-85, 40, 85, 40, { highway: 'residential', sidewalk: 'both', name: 'Driveway street' }, 10, [...drives.map((x) => [x, 40]), [62, 40], [70, 40]]);
    for (const x of drives) { o.ln(x, 40, x, 58, { highway: 'service', service: 'driveway' }); o.bx(x, 64, 8, 10, { building: 'garage' }); }
    o.row(-80, 80, 40, { side: -1 });
    o.lab('five driveways in a row', -20, 40, [45, 0]); o.walk('along the driveways', -75, 44.5, 0);
    // a driveway 6 m from a corner
    o.ln(70, 40, 70, 90, { highway: 'residential', sidewalk: 'both' }); o.ln(62, 40, 62, 58, { highway: 'service', service: 'driveway' });
    o.lab('driveway 8 m from a corner', 66, 40, [35, 0]);
    // an alley through the block, a wide parking entrance
    o.ln(-85, -40, 85, -40, { highway: 'residential', sidewalk: 'both', name: 'Alley street' }, 10, [[-30, -40], [40, -40]]);
    o.ln(-30, -40, -30, -95, { highway: 'service', service: 'alley' }); o.row(-80, -36, -40); o.row(-24, 30, -40);
    o.lab('an alley through the block', -30, -40, [40, 0]);
    o.ln(40, -40, 40, -55, { highway: 'service', service: 'parking_aisle' });
    o.ar([[30, -55], [70, -55], [70, -90], [30, -90]], { amenity: 'parking', parking: 'surface' });
    o.lab('parking entrance off a street with sidewalks', 40, -40, [40, 0]);
  });
  plot(5, 3, 'parking', (o) => {
    tagStreet(o, 60, { sidewalk: 'both' }, 'car park right behind the north sidewalk', { houses: false });
    o.ar([[-60, 64], [60, 64], [60, 90], [-60, 90]], { amenity: 'parking', parking: 'surface' }); o.row(-80, 80, 60, { side: -1 });
    tagStreet(o, 0, { sidewalk: 'both', 'parking:both': 'lane', 'parking:both:orientation': 'parallel' }, 'parking lanes both sides (parking:both=lane)', { back: 10 });
    tagStreet(o, -60, {}, 'untagged, car park against the curb', { houses: false });
    o.ar([[-60, -57], [60, -57], [60, -30], [-60, -30]], { amenity: 'parking', parking: 'surface' }); o.row(-80, 80, -60, { side: -1 });
  });
  plot(6, 3, 'medians', (o) => {
    const dual = (y, gap, cls, what) => {
      // (right-hand traffic: the eastbound carriageway is the southern one, so each one's right side is the outer side;
      // one name for both, as mapped: findMedians pairs the carriageways of a divided road by it)
      o.ln(-85, y - gap / 2, 85, y - gap / 2, { highway: cls, oneway: 'yes', lanes: '2', sidewalk: 'right', name: what }, 10);
      o.ln(85, y + gap / 2, -85, y + gap / 2, { highway: cls, oneway: 'yes', lanes: '2', sidewalk: 'right', name: what }, 10);
      o.lab(`${what}: two carriageways ${gap} m apart`, 0, y, [55, 0]);
    };
    // (the sidewalk on each carriageway's right: the outer side)
    dual(65, 12, 'secondary', 'median 12 m'); o.row(-80, 80, 65, { back: 16 });
    dual(25, 8, 'primary', 'narrow median'); o.row(-80, 80, 25, { back: 13, side: 1 });
    dual(-20, 9.5, 'trunk', 'trunk with a narrow median');
    dual(-65, 30, 'tertiary', 'wide median, ground between');
  });
  plot(7, 3, 'median crossing', (o) => {
    o.ln(-85, -6, 85, -6, { highway: 'secondary', oneway: 'yes', lanes: '2', sidewalk: 'right', name: 'Crossing dual' }, 10, [[0, -6]]);
    o.ln(85, 6, -85, 6, { highway: 'secondary', oneway: 'yes', lanes: '2', sidewalk: 'right', name: 'Crossing dual' }, 10, [[0, 6]]);
    o.nd(0, 6, { highway: 'crossing', crossing: 'traffic_signals' }); o.nd(0, -6, { highway: 'crossing', crossing: 'traffic_signals' });
    o.st([[0, -18], [0, -6], [0, 0], [0, 6], [0, 18]], { highway: 'footway', footway: 'crossing', crossing: 'traffic_signals' });
    o.row(-80, 80, 0, { back: 20 }); o.lab('crossing over both carriageways and the median', 0, 0, [45, 0]);
    o.walk('to the median crossing', -20, 12, 0);
    // a side street meeting a dual carriageway through its median
    o.ln(-85, -62, 85, -62, { highway: 'secondary', oneway: 'yes', sidewalk: 'right', name: 'Gap dual' }, 10, [[20, -62]]);
    o.ln(85, -50, -85, -50, { highway: 'secondary', oneway: 'yes', sidewalk: 'right', name: 'Gap dual' }, 10, [[20, -50]]);
    o.ln(20, -50, 20, -95, { highway: 'residential', sidewalk: 'both' }, 10, [[20, -62]]); o.ln(20, -50, 20, -20, { highway: 'residential', sidewalk: 'both' });
    o.lab('side street through a gap in the median', 20, -56, [45, 0]);
  });

  // ═════ row 4: fronts, furniture, mapped footways, plazas ═════
  plot(1, 4, 'building fronts', (o) => {
    // fronts 0, 2, 5 and 8 m behind the curb of an untagged street (the curb about 3 m from its centre)
    const ys = [70, 25, -20, -65]; const gaps = [0, 2, 5, 8];
    ys.forEach((y, i) => tagStreet(o, y, {}, `untagged, fronts ${gaps[i]} m behind the curb`, { back: 3 + gaps[i] }));
  });
  plot(2, 4, 'arcade and passage', (o) => {
    tagStreet(o, 60, { sidewalk: 'both' }, 'sidewalk=both, a building passage through the north row');
    o.ln(0, 64.5, 0, 90, { highway: 'footway', tunnel: 'building_passage' });
    tagStreet(o, 0, { sidewalk: 'both' }, 'sidewalk=both under arcades (building:part over it)', { houses: false });
    for (let x = -80; x < 80; x += 20) { o.bx(x + 10, 9, 20, 10, { building: 'retail', 'building:levels': '3' }); o.bx(x + 10, 3.5, 20, 3, { 'building:part': 'yes', 'min_level': '1', 'building:levels': '3' }); }
    tagStreet(o, -60, { sidewalk: 'both' }, 'sidewalk=both, a covered footway (covered=yes)', { houses: false });
    o.ln(-60, -55.5, 60, -55.5, { highway: 'footway', footway: 'sidewalk', covered: 'yes' });
  });
  plot(3, 4, 'street furniture', (o) => {
    o.ln(-85, 40, 85, 40, { highway: 'secondary', sidewalk: 'both', name: 'Furnished street' }, 10, [[0, 40]]);
    o.row(-80, 80, 40, { back: 11 });
    for (let x = -75; x <= 75; x += 25) { o.nd(x, 46, { highway: 'street_lamp' }); o.nd(x + 12, 34, { natural: 'tree' }); }
    o.nd(-30, 46, { highway: 'bus_stop', shelter: 'yes', bench: 'yes' }); o.nd(30, 46, { amenity: 'bench' });
    o.nd(10, 34, { amenity: 'waste_basket' }); o.nd(-10, 34, { amenity: 'post_box' });
    o.lab('lamps, trees, a bus stop, a bench, a bin and a post box on the sidewalks', 0, 40, [45, 0]);
    o.walk('past the furniture', -70, 45.5, 0);
    o.ln(-85, -40, 85, -40, { highway: 'residential', sidewalk: 'both', name: 'Tree row street' }); o.ln(-80, -35, 80, -35, { natural: 'tree_row' });
    o.row(-80, 80, -40, { back: 10 });
    for (const x of [-20, -16, -12]) o.nd(x, -45, { barrier: 'bollard' });
    o.lab('a tree row and bollards on the sidewalks', 0, -40, [45, 0]);
  });
  plot(4, 4, 'mapped sidewalk lines', (o) => {
    const near = (y, off, what) => { o.ln(-85, y, 85, y, { highway: 'residential', sidewalk: 'separate', name: what }, 10); for (const s of [1, -1]) o.ln(-85, y + s * off, 85, y + s * off, { highway: 'footway', footway: 'sidewalk' }, 10); o.row(-80, 80, y, { back: off + 3 }); o.lab(what, 0, y, [45, 0]); o.walk(`${what}, on the north footway`, -60, y + off, 0); };
    near(65, 4, 'footway=sidewalk 4 m from the centre');
    near(15, 9, 'footway=sidewalk 9 m out (the strip between paved)');
    near(-40, 17, 'footway=sidewalk 17 m out (past the gap rule)');
  });
  plot(5, 4, 'plain footways', (o) => {
    tagStreet(o, 60, {}, 'a plain footway 4 m from the centre (closed up to the curb)', { back: 10 });
    o.ln(-85, 64, 85, 64, { highway: 'footway' });
    tagStreet(o, 0, { sidewalk: 'both' }, 'footways meeting the sidewalk: a T, a stub 2 m short, one at 45 degrees', { back: 12 });
    o.ln(-40, 4.5, -40, 40, { highway: 'footway' }); o.ln(0, 7, 0, 40, { highway: 'footway' }); o.ln(30, 4.5, 60, 34.5, { highway: 'footway' });
    tagStreet(o, -60, {}, 'a footway across the street with no crossing tag', { houses: false });
    o.ln(15, -90, 15, -30, { highway: 'footway' }, 10, [[15, -60]]);
  });
  plot(6, 4, 'lawns and parks', (o) => {
    // houses with a mapped sidewalk line 3 m behind the curb: a lawn strip between
    o.ln(-85, 60, 85, 60, { highway: 'residential', sidewalk: 'separate', name: 'Lawn verge street' }); for (const s of [1, -1]) o.ln(-85, 60 + s * 7, 85, 60 + s * 7, { highway: 'footway', footway: 'sidewalk' });
    o.row(-80, 80, 60, { back: 16 }); o.lab('houses, a lawn between curb and sidewalk', 0, 60, [45, 0]); o.walk('along the lawn verge', -60, 67, 0);
    // a park beside a street with paths inside it
    tagStreet(o, 0, { sidewalk: 'both' }, 'a park along the south sidewalk, paths in it', { houses: false });
    o.row(-80, 80, 0, { side: 1 }); o.ar([[-85, -5], [85, -5], [85, -50], [-85, -50]], { leisure: 'park' });
    o.st([[-60, -4.5], [-30, -30], [30, -30], [60, -4.5]], { highway: 'footway' }); o.ln(0, -30, 0, -50, { highway: 'footway', surface: 'gravel' });
    tagStreet(o, -70, {}, 'untagged, a playground against the curb', { houses: false });
    o.ar([[-40, -66], [40, -66], [40, -90], [-40, -90]], { leisure: 'playground' });
  });
  plot(7, 4, 'footway surfaces', (o) => {
    const surf = ['paving_stones', 'sett', 'bricks', 'asphalt', 'concrete', 'gravel', 'dirt'];
    o.ln(-85, 85, 85, 85, { highway: 'residential', sidewalk: 'no', name: 'Surface street' }); o.row(-80, 80, 85, { side: 1 });
    surf.forEach((s, i) => { const x = -75 + i * 25; o.ln(x, 81, x, 10, { highway: 'footway', surface: s }); o.lab(`footway surface=${s}`, x, 45, [30, 90]); });
    // out of town: an untagged footway and a trail (dirt paths), no buildings near
    o.st([[-80, -20], [-40, -40], [0, -30], [40, -60], [80, -50]], { highway: 'footway' }); o.lab('untagged footway out of town (a dirt path)', 0, -30, [40, 0]);
    o.st([[-80, -70], [0, -85], [80, -75]], { highway: 'footway', sac_scale: 'hiking' }); o.lab('footway tagged as a trail', 0, -82, [40, 0]);
  });
  plot(8, 4, 'plazas', (o) => {
    o.ar([[-70, 20], [70, 20], [70, 85], [-70, 85]], { highway: 'pedestrian', area: 'yes', surface: 'sett', name: 'Sett square' });
    o.bx(0, 55, 16, 16, { building: 'civic' }); o.ln(-85, 15, 85, 15, { highway: 'residential', sidewalk: 'both', name: 'Square street' }, 10, [[-40, 15]]);
    o.ln(-40, 15, -40, 90, { highway: 'service', access: 'destination' }, 10);
    o.lab('pedestrian square (sett) with a building in it and a service road across', 0, 50, [70, 0]);
    o.ar([[-70, -20], [0, -20], [0, -80], [-70, -80]], { 'area:highway': 'pedestrian' }); o.lab('area:highway=pedestrian', -35, -50, [50, 0]);
    o.ln(20, -10, 20, -90, { highway: 'pedestrian', surface: 'paving_stones', name: 'Pedestrian lane' }); o.col(-80, -15, 20, { back: 6 });
    o.nd(20, -12, { barrier: 'bollard' }); o.lab('pedestrian street with a bollard at its mouth', 20, -50, [45, 90]);
  });

  // ═════ row 5: rail, overpasses, bridges, cycle tracks ═════
  plot(1, 5, 'rail crossings', (o) => {
    o.ln(-85, 30, 85, 30, { highway: 'residential', sidewalk: 'both', name: 'Level crossing street' }, 10, [[0, 30]]);
    o.ln(0, -90, 0, 90, { railway: 'rail', name: 'Sidewalk test line' }, 10, [[0, 30], [0, -40], [0, -78]]); o.nd(0, 30, { railway: 'level_crossing' });
    // a station (Splatplays' Sherwood, 2026-11-25): a second track and a platform, a path over both tracks at its end
    o.ln(5, -90, 5, -10, { railway: 'rail', name: 'Sidewalk test line, second track' }, 10, [[5, -78]]);
    o.ar([[8, -70], [12, -70], [12, -20], [8, -20]], { railway: 'platform', public_transport: 'platform' });
    o.st([[-30, -78], [0, -78], [5, -78], [10, -78], [40, -78]], { highway: 'footway', surface: 'asphalt' });
    o.nd(0, -78, { railway: 'crossing' }); o.nd(5, -78, { railway: 'crossing' });
    o.lab('footway over two tracks at a platform\'s end (Sherwood station)', 3, -78, [35, 0]);
    o.walk('crossing the two tracks', -15, -78, 0);
    o.row(-80, -15, 30); o.row(15, 80, 30); o.lab('sidewalks over a level crossing', 0, 30, [40, 0]); o.walk('across the tracks', -20, 34.5, 0);
    o.st([[-30, -40], [0, -40], [30, -40]], { highway: 'footway' }); o.nd(0, -40, { railway: 'crossing' }); o.lab('footway over the line (railway=crossing)', 0, -40, [35, 0]);
  });
  plot(2, 5, 'under an overpass', (o) => {
    o.ln(-85, 0, 85, 0, { highway: 'residential', sidewalk: 'both', name: 'Under the deck' }); o.row(-80, -25, 0); o.row(25, 80, 0);
    o.ln(0, -90, 0, -40, { highway: 'secondary', name: 'Overpass' }); o.ln(0, -40, 0, 40, { highway: 'secondary', bridge: 'yes', layer: '1', name: 'Overpass' }); o.ln(0, 40, 0, 90, { highway: 'secondary', name: 'Overpass' });
    o.lab('sidewalks under a road bridge', 0, 0, [45, 0]); o.walk('under the deck', -25, 4.5, 0);
  });
  plot(3, 5, 'bridge with sidewalks', (o) => {
    o.ar([[-90, -8], [90, -8], [90, 8], [-90, 8]], { natural: 'water', water: 'river' }); o.ln(-95, 0, 95, 0, { waterway: 'river' }, 20);
    o.ln(-30, -90, -30, -20, { highway: 'residential', sidewalk: 'both' }); o.ln(-30, -20, -30, 20, { highway: 'residential', sidewalk: 'both', bridge: 'yes', layer: '1' }); o.ln(-30, 20, -30, 90, { highway: 'residential', sidewalk: 'both' });
    o.col(-85, -25, -30); o.col(25, 85, -30); o.lab('road bridge with sidewalk=both: both ends', -30, 0, [45, 90]);
    o.walk('onto the bridge, north', -25.5, -35, Math.PI / 2); o.walk('off the bridge, north end', -25.5, 15, Math.PI / 2);
    // the bridge's sidewalks mapped as footways beside it
    o.ln(40, -90, 40, -20, { highway: 'residential', sidewalk: 'separate' }); o.ln(40, -20, 40, 20, { highway: 'residential', sidewalk: 'separate', bridge: 'yes', layer: '1' }); o.ln(40, 20, 40, 90, { highway: 'residential', sidewalk: 'separate' });
    for (const s of [1, -1]) { o.ln(40 + s * 5, -90, 40 + s * 5, -20, { highway: 'footway', footway: 'sidewalk' }); o.ln(40 + s * 5, -20, 40 + s * 5, 20, { highway: 'footway', footway: 'sidewalk', bridge: 'yes', layer: '1' }); o.ln(40 + s * 5, 20, 40 + s * 5, 90, { highway: 'footway', footway: 'sidewalk' }); }
    o.col(-85, -25, 40, { back: 9 }); o.lab('bridge sidewalks mapped as footways beside the road', 40, 0, [45, 90]);
  }, (lx, ly) => (Math.abs(lx) < 98 && Math.abs(ly) < 8.5 ? -3 : 0));
  plot(4, 5, 'footbridge', (o) => {
    o.ln(-85, 0, 85, 0, { highway: 'primary', lanes: '4', sidewalk: 'both', name: 'Under the footbridge' }); o.row(-80, -20, 0, { back: 14 }); o.row(20, 80, 0, { back: 14 });
    o.ln(0, -60, 0, -18, { highway: 'footway' }); o.ln(0, -18, 0, 18, { highway: 'footway', bridge: 'yes', layer: '1' }); o.ln(0, 18, 0, 60, { highway: 'footway' });
    o.lab('footbridge over a street with sidewalks', 0, 0, [45, 90]);
    // steps up to a footbridge
    o.ln(-60, -60, -60, -30, { highway: 'steps', incline: 'up' }); o.ln(-60, -30, -60, 30, { highway: 'footway', bridge: 'yes', layer: '1' }); o.ln(-60, 30, -60, 60, { highway: 'steps', incline: 'down' });
    o.lab('steps up to a footbridge', -60, 0, [45, 90]);
  });
  plot(5, 5, 'cycle tracks', (o) => {
    tagStreet(o, 50, { sidewalk: 'both', 'cycleway:both': 'track' }, 'sidewalk + cycleway:both=track (on the way)', { back: 11 });
    tagStreet(o, -10, { sidewalk: 'separate' }, 'separate cycleway and footway lines beside the street', { back: 13 });
    for (const s of [1, -1]) { o.ln(-85, -10 + s * 5, 85, -10 + s * 5, { highway: 'cycleway' }); o.ln(-85, -10 + s * 8, 85, -10 + s * 8, { highway: 'footway', footway: 'sidewalk' }); }
    tagStreet(o, -70, {}, 'shared footway and cycleway (bicycle=designated) beside the street', { back: 10 });
    o.ln(-85, -64.5, 85, -64.5, { highway: 'footway', bicycle: 'designated', foot: 'designated', segregated: 'no' });
  });
  plot(6, 5, 'steps and paths on the flat', (o) => {
    tagStreet(o, 50, { sidewalk: 'both' }, 'steps leading off the sidewalk', { back: 10 });
    o.ln(0, 54.5, 0, 75, { highway: 'steps' }); o.ln(-40, 54.5, -40, 75, { highway: 'path' }); o.ln(40, 54.5, 40, 75, { highway: 'bridleway' });
    tagStreet(o, -30, { sidewalk: 'both' }, 'a footway ending 1 m short of the sidewalk', { back: 10 });
    o.ln(0, -24.5, 0, 0, { highway: 'footway' });
  });
  plot(7, 5, 'tunnel and covered street', (o) => {
    // a road into a short cut-and-cover tunnel under a mound (sidewalks stop at the portal)
    o.ln(-85, 0, -30, 0, { highway: 'residential', sidewalk: 'both', name: 'Tunnel street' }); o.ln(-30, 0, 30, 0, { highway: 'residential', sidewalk: 'both', tunnel: 'yes', layer: '-1', name: 'Tunnel street' }); o.ln(30, 0, 85, 0, { highway: 'residential', sidewalk: 'both', name: 'Tunnel street' });
    o.row(-80, -35, 0); o.row(35, 80, 0); o.lab('street with sidewalks through a short tunnel', 0, 0, [55, 0]);
    o.walk('to the tunnel portal', -55, 4.5, 0);
  }, eased((lx, ly) => Math.max(0, 8 * (1 - Math.max(Math.abs(lx) / 40, Math.abs(ly) / 60))), 10));
  plot(8, 5, 'level and steep curbs together', (o) => {
    // two streets meeting at a shallow 10 degree fork, and a pair of parallel streets 12 m apart
    o.ln(-85, 40, 0, 40, { highway: 'residential', sidewalk: 'both' }); o.ln(0, 40, 85, 40, { highway: 'residential', sidewalk: 'both' }); o.ln(0, 40, 85, 55, { highway: 'residential', sidewalk: 'both' });
    o.lab('fork at 10 degrees', 20, 43, [45, 0]);
    o.ln(-85, -30, 85, -30, { highway: 'residential', sidewalk: 'both', name: 'Close pair A' }); o.ln(-85, -42, 85, -42, { highway: 'residential', sidewalk: 'both', name: 'Close pair B' });
    o.row(-80, 80, -30, { side: 1 }); o.row(-80, 80, -42, { side: -1 }); o.lab('two parallel streets 12 m apart (sidewalks meet between)', 0, -36, [45, 0]);
  });

  // ═════ column 0: the sea (the coastline at x = -880, local -80) ═════
  const seaFront = (y0, y1, kind) => ({ y0, y1, kind });
  const fronts = [];
  plot(0, 0, 'sea wall promenade', (o) => {
    o.ln(-79, 95, -79, -95, { barrier: 'retaining_wall', material: 'concrete' }, 10);
    o.ln(-75, 95, -75, -95, { highway: 'footway', name: 'Promenade', surface: 'paving_stones' }, 10);
    o.ln(-60, 95, -60, -95, { highway: 'residential', sidewalk: 'both', name: 'Promenade street' }, 10); o.col(-90, 90, -60, { side: 1, back: 9 });
    o.lab('promenade footway along a sea wall, a street behind', -70, 0, [50, 90]); o.walk('along the promenade', -75, -40, Math.PI / 2);
  }); fronts.push(seaFront(700, 1100, 'wall'));
  plot(0, 1, 'street at the sea wall', (o) => {
    o.ln(-79, 95, -79, -95, { barrier: 'retaining_wall', material: 'concrete' }, 10);
    o.ln(-73, 95, -73, -95, { highway: 'residential', sidewalk: 'both', name: 'Sea wall street' }, 10); o.col(-90, 90, -73, { side: 1, back: 9 });
    o.lab('street with sidewalk=both right at the sea wall', -73, 0, [45, 90]); o.walk('on the seaward sidewalk', -77, -40, Math.PI / 2);
  }); fronts.push(seaFront(500, 700, 'wall'));
  plot(0, 2, 'beach', (o) => {
    o.ar([[-80, 90], [-50, 90], [-50, -90], [-80, -90]], { natural: 'beach' });
    o.ln(-45, 95, -45, -95, { highway: 'residential', sidewalk: 'both', name: 'Beach road' }, 10); o.col(-90, 90, -45, { side: 1, back: 9 });
    o.ln(-49.5, 0, -82, 0, { highway: 'footway' }); o.lab('street at the top of a beach, a footway down to the water', -55, 0, [50, 90]);
  }); fronts.push(seaFront(300, 500, 'beach'));
  plot(0, 3, 'pier', (o) => {
    o.ln(-79, 95, -79, -95, { barrier: 'retaining_wall' }, 10);
    o.ar([[-79, -4], [-79, 4], [-140, 4], [-140, -4]], { man_made: 'pier' }); o.ln(-74, 0, -138, 0, { highway: 'footway' }, 6);
    o.ln(-70, 95, -70, -95, { highway: 'residential', sidewalk: 'both', name: 'Pier street' }, 10); o.col(-90, 90, -70, { side: 1, back: 9 });
    o.lab('a pier with a footway out over the sea', -110, 0, [60, 90]);
  }); fronts.push(seaFront(100, 300, 'wall'));
  plot(0, 4, 'harbour quay', (o) => {
    o.ln(-80, 95, -80, -95, { man_made: 'quay' }, 10);
    o.ln(-72, 95, -72, -95, { highway: 'service', name: 'Quay road' }, 10); o.ln(-77, 95, -77, -95, { highway: 'footway', footway: 'sidewalk' }, 10);
    o.col(-90, 90, -72, { side: 1, back: 12, w: 30, tags: { building: 'warehouse' } });
    o.lab('harbour quay (man_made=quay) with a sidewalk line at the edge', -76, 0, [45, 90]);
  }); fronts.push(seaFront(-100, 100, 'quay'));
  plot(0, 5, 'steps to the beach', (o) => {
    // (the beach 1 m over the sea from the coastline to the wall 15 m inland; the promenade 3 m over the beach)
    o.ln(-65, 95, -65, -95, { barrier: 'retaining_wall' }, 10); o.ar([[-80, 90], [-66, 90], [-66, -90], [-80, -90]], { natural: 'beach' });
    o.ln(-61, 95, -61, -95, { highway: 'footway', name: 'Upper promenade' }, 10); o.ln(-61, 0, -76, 0, { highway: 'steps' });
    o.ln(-50, 95, -50, -95, { highway: 'residential', sidewalk: 'both' }, 10); o.col(-90, 90, -50, { side: 1, back: 9 });
    o.lab('steps from a promenade down a sea wall to a beach', -65, 0, [45, 90]);
  }); fronts.push(seaFront(-300, -100, 'lowbeach'));
  plot(0, 6, 'sea-front square', (o) => {
    o.ln(-79, 95, -79, -95, { barrier: 'retaining_wall' }, 10);
    o.ar([[-78, 40], [-40, 40], [-40, -40], [-78, -40]], { highway: 'pedestrian', area: 'yes', surface: 'paving_stones', name: 'Harbour square' });
    o.ln(-35, 95, -35, -95, { highway: 'residential', sidewalk: 'both' }, 10); o.col(-90, 90, -35, { side: 1, back: 9 });
    o.lab('a paved square at the sea wall', -60, 0, [55, 90]);
  }); fronts.push(seaFront(-500, -300, 'wall'));
  plot(0, 7, 'cliff path', (o) => {
    o.st([[-70, 90], [-72, 40], [-68, 0], [-71, -40], [-69, -90]], { highway: 'footway' }); o.st([[-67, 90], [-69, 40], [-65, 0], [-68, -40], [-66, -90]], { barrier: 'fence' });
    o.lab('a footway along a cliff edge, a fence inland', -70, 0, [55, 90]);
  }); fronts.push(seaFront(-700, -500, 'cliff'));
  plot(0, 8, 'sea wall without a sidewalk', (o) => {
    o.ln(-79, 95, -79, -95, { barrier: 'retaining_wall' }, 10);
    o.ln(-74, 95, -74, -95, { highway: 'residential', 'sidewalk:left': 'no', 'sidewalk:right': 'yes', name: 'One-sided sea street' }, 10); o.col(-90, 90, -74, { side: 1, back: 9 });
    o.lab('sea street: a sidewalk inland only, a bare curb at the wall', -74, 0, [45, 90]);
  }); fronts.push(seaFront(-1050, -700, 'wall'));
  way(run(COAST_X, 1044, COAST_X, -1044, 20), { natural: 'coastline' });

  // ═════ rows 6-8, west: canal, river, lake ═════
  plot(1, 6, 'canal with quays', (o) => {
    o.ar([[-95, -10], [95, -10], [95, 10], [-95, 10]], { natural: 'water', water: 'canal' }); o.ln(-95, 0, 95, 0, { waterway: 'canal' }, 20);
    for (const s of [1, -1]) { o.ln(-90, s * 16, 90, s * 16, { highway: 'residential', sidewalk: 'both', name: s > 0 ? 'North quay' : 'South quay' }, 10); o.row(-85, 85, s * 16, { side: s, back: 9 }); }
    o.lab('canal 20 m wide, quay streets with sidewalks both sides', 0, 0, [55, 0]); o.walk('on the canal-side sidewalk', -60, 11.5, 0);
  }, (lx, ly) => (Math.abs(lx) < 98 && Math.abs(ly) < 10.5 ? -3 : 0));
  plot(2, 6, 'canal bridge and quay walk', (o) => {
    o.ar([[-95, -10], [95, -10], [95, 10], [-95, 10]], { natural: 'water', water: 'canal' }); o.ln(-95, 0, 95, 0, { waterway: 'canal' }, 20);
    o.ln(-90, 22, 90, 22, { highway: 'residential', sidewalk: 'both', name: 'Quay walk street' }, 10, [[0, 22]]); o.ln(-90, 12, 90, 12, { highway: 'footway', footway: 'sidewalk' }); o.row(-85, 85, 22, { side: 1, back: 9 });
    o.ln(-90, -22, 90, -22, { highway: 'residential', sidewalk: 'both', name: 'Canal south' }, 10, [[0, -22]]);
    o.ln(0, 22, 0, 14, { highway: 'residential', sidewalk: 'both' }); o.ln(0, 14, 0, -14, { highway: 'residential', sidewalk: 'both', bridge: 'yes', layer: '1' }); o.ln(0, -14, 0, -22, { highway: 'residential', sidewalk: 'both' });
    o.lab('a canal bridge with sidewalks between two quay streets', 0, 0, [45, 90]); o.lab('a sidewalk line along the quay edge, 10 m from the street', -50, 12, [40, 0]);
  }, (lx, ly) => (Math.abs(lx) < 98 && Math.abs(ly) < 10.5 ? -3 : 0));
  plot(1, 7, 'river banks', (o) => {
    o.ar([[-95, -15], [95, -15], [95, 15], [-95, 15]], { natural: 'water', water: 'river' }); o.ln(-95, 0, 95, 0, { waterway: 'river' }, 20);
    o.ln(-90, 30, 90, 30, { highway: 'residential', sidewalk: 'both', name: 'Bank street' }, 10); o.row(-85, 85, 30, { side: 1, back: 9 });
    o.ln(-90, 20, 90, 20, { highway: 'footway', name: 'Bank path' }, 10);
    o.lab('a street at the top of a sloping bank, a path on the bank', 0, 22, [50, 0]);
    o.ln(-90, -32, 90, -32, { highway: 'residential', sidewalk: 'both', name: 'Low bank street' }, 10); o.row(-85, 85, -32, { side: -1, back: 9 });
    o.lab('a street with its sidewalk over a 3 m drop to the water (bank rule)', 0, -26, [45, 0]);
  }, (lx, ly) => { const d = Math.abs(ly); if (Math.abs(lx) > 98) return 0; if (ly > 0) return d < 15 ? -3 : d < 27 ? -3 * (1 - (d - 15) / 12) : 0; return d < 15 ? -3 : d < 27.5 ? -3 * smooth(1 - (d - 25.5) / 2) : 0; });
  plot(2, 7, 'lake boardwalk', (o) => {
    o.ar([[-60, -60], [60, -60], [60, 60], [-60, 60]], { natural: 'water', water: 'lake', name: 'Boardwalk lake' });
    o.ln(-85, 0, -60, 0, { highway: 'footway' }); o.ln(-60, 0, 60, 0, { highway: 'footway', bridge: 'boardwalk', layer: '1' }); o.ln(60, 0, 85, 0, { highway: 'footway' });
    o.ln(-85, 75, 85, 75, { highway: 'residential', sidewalk: 'both' }); o.row(-80, 80, 75, { side: 1 });
    o.ln(0, 70.5, 0, 60, { highway: 'footway' }); o.ln(0, 60, 0, 40, { highway: 'footway', bridge: 'yes', layer: '1' });
    o.lab('a boardwalk across a lake', 0, 0, [60, 0]); o.lab('a footway from the sidewalk onto a jetty', 0, 55, [40, 0]);
  }, (lx, ly) => (Math.abs(lx) < 60 && Math.abs(ly) < 60 ? -2.5 : 0));
  plot(1, 8, 'dock basin', (o) => {
    o.ar([[-50, -50], [50, -50], [50, 50], [-50, 50]], { natural: 'water', water: 'basin' });
    o.ar([[-62, -62], [62, -62], [62, 62], [-62, 62]], { highway: 'pedestrian', area: 'yes', surface: 'paving_stones' });
    o.ln(-85, 75, 85, 75, { highway: 'residential', sidewalk: 'both' }); o.row(-80, 80, 75, { side: 1 });
    o.lab('a paved square round a dock basin', 0, 55, [60, 0]);
  }, (lx, ly) => (Math.abs(lx) < 50 && Math.abs(ly) < 50 ? -3 : 0));
  plot(2, 8, 'floating jetty', (o) => {
    o.ln(-90, 40, 90, 40, { highway: 'residential', sidewalk: 'both', name: 'Marina street' }); o.row(-85, 85, 40, { side: 1 });
    o.ar([[-95, 25], [95, 25], [95, -95], [-95, -95]], { natural: 'water', water: 'reservoir' });
    o.ar([[-3, 25], [3, 25], [3, -40], [-3, -40]], { man_made: 'pier', floating: 'yes' }); o.ln(0, 35.5, 0, 25, { highway: 'footway' }); o.ln(0, 25, 0, -38, { highway: 'footway' });
    o.lab('a floating pier 2.5 m below the street (gangway)', 0, 15, [45, 90]);
  }, (lx, ly) => (ly < 25 && Math.abs(lx) < 98 && ly > -98 ? -3 : 0));

  // ═════ rows 6-8, east: hills ═════
  plot(5, 6, 'streets up a slope', (o) => {
    o.ln(-50, -80, -50, 80, { highway: 'residential', sidewalk: 'both', name: 'Up 8 %' }, 10); o.col(-75, 75, -50);
    o.ln(40, -80, 40, 80, { highway: 'residential', sidewalk: 'both', name: 'Up 15 %' }, 10); o.col(-75, 75, 40);
    o.lab('8 % street (climbing north)', -50, 0, [50, 0]); o.lab('15 % street', 40, 0, [50, 0]);
    o.walk('up the 15 % sidewalk', 44.5, -50, Math.PI / 2); o.walk('down the 15 % sidewalk', 35.5, 50, -Math.PI / 2);
  }, eased((lx, ly) => (lx < -5 ? 0.08 : 0.15) * Math.max(-85, Math.min(85, ly)) + (lx < -5 ? 7 : 13)));
  // a divided street across a slope, a narrow slab median between its carriageways: the two halves of the island meet
  // at one height (Splatplays' Galliers Avenue: each half at its own road's height met in a step, a groove)
  plot(4, 6, 'divided street across a slope', (o) => {
    // (right-hand traffic: eastbound on the south side)
    o.ln(-85, -2.7, 85, -2.7, { highway: 'tertiary', oneway: 'yes', name: 'Slope boulevard' }, 10);
    o.ln(85, 2.7, -85, 2.7, { highway: 'tertiary', oneway: 'yes', name: 'Slope boulevard' }, 10);
    o.row(-80, 80, 0, { back: 14 });
    o.lab('divided street across a 1.5 % slope: the slab median\'s halves meet level in the middle', 0, 0, [35]);
    o.walk('along the median', -60, 0, 0);
  }, eased((lx, ly) => 0.015 * ly + 12));
  plot(6, 6, 'street across a slope', (o) => {
    o.ln(-85, 20, 85, 20, { highway: 'residential', sidewalk: 'both', name: 'Across 10 %' }); o.row(-80, 80, 20);
    o.ln(-85, -50, 85, -50, { highway: 'residential', sidewalk: 'both', name: 'Across 25 %' }); o.row(-80, 80, -50);
    o.lab('street across a 10 % slope: sidewalks level across', 0, 20, [45, 0]); o.lab('street across a 25 % slope', 0, -50, [45, 0]);
    o.walk('along the uphill sidewalk', -60, 24.5, 0); o.walk('along the downhill sidewalk', 60, 15.5, Math.PI);
  }, eased((lx, ly) => (ly > -15 ? 0.1 * (ly + 15) : 0.25 * (ly + 15)) + 18));
  plot(7, 6, 'junction on a slope', (o) => {
    arms(o, 0, 0, [[0], [90], [180], [270]], undefined, 80); blocks(o, 0, 0, [0, 90, 180, 270], 30);
    o.lab('crossroads on a 10 % slope (falling east)', 0, 0, [60, 0]); o.walk('round the uphill corner', -20, 5, 0);
  }, eased((lx) => -0.1 * Math.max(-85, Math.min(85, lx)) + 9));
  plot(8, 6, 'hairpin', (o) => {
    const pts = []; for (let i = 0; i <= 10; i++) pts.push([-80 + i * 12, -40]); for (let i = 1; i < 10; i++) { const a = -Math.PI / 2 + (i / 10) * Math.PI; pts.push([40 + 20 * Math.cos(a), -20 + 20 * Math.sin(a)]); } for (let i = 0; i <= 10; i++) pts.push([40 - i * 12, 0]);
    o.st(pts, { highway: 'residential', sidewalk: 'both', name: 'Hairpin street' }); o.lab('hairpin with sidewalks, climbing', 40, -20, [55, 0]);
  }, eased((lx, ly) => 0.12 * (Math.max(-40, Math.min(0, ly)) + 40) + (lx > 40 ? 0 : 0) + 4));
  plot(5, 7, 'steps and ramps on a slope', (o) => {
    o.ln(-85, 50, 85, 50, { highway: 'residential', sidewalk: 'both', name: 'Upper street' }); o.row(-80, 80, 50, { side: 1 });
    o.ln(-85, -50, 85, -50, { highway: 'residential', sidewalk: 'both', name: 'Lower street' }); o.row(-80, 80, -50, { side: -1 });
    o.ln(-40, -45.5, -40, 45.5, { highway: 'steps' }); o.lab('steps between two streets 10 m apart in height', -40, 0, [45, 90]);
    o.st([[30, -45.5], [60, -10], [30, 25], [40, 45.5]], { highway: 'footway' }); o.lab('a ramped footway between them', 40, 0, [45, 90]);
  }, eased((lx, ly) => 0.1 * Math.max(-50, Math.min(50, ly)) + 9));
  plot(6, 7, 'embankment and cutting', (o) => {
    o.ln(-85, 40, 85, 40, { highway: 'residential', sidewalk: 'both', name: 'On the bank' }); o.lab('street with sidewalks on a 3 m embankment', 0, 40, [45, 0]);
    o.ln(-85, -40, 85, -40, { highway: 'residential', sidewalk: 'both', name: 'In the cut' }); o.lab('street with sidewalks in a 3 m cutting', 0, -40, [45, 0]);
    o.walk('along the embankment sidewalk', -50, 44.5, 0); o.walk('along the cutting sidewalk', -50, -35.5, 0);
  }, (lx, ly) => {
    // the bank: 3 m up 6 m either side of the north street, down to the base by 12 m; the cut: the ground 3 m over the
    // south street from 12 m out, back to the base by 30 m; both faded out at the plot's east and west ends
    const up = Math.abs(ly - 40); const dn = Math.abs(ly + 40);
    const bank = up < 6 ? 3 : up < 12 ? 3 * (1 - (up - 6) / 6) : 0;
    const cut = dn < 6 ? 0 : dn < 12 ? 3 * ((dn - 6) / 6) : dn < 24 ? 3 : dn < 30 ? 3 * (1 - (dn - 24) / 6) : 0;
    return (bank + cut) * smooth((95 - Math.abs(lx)) / 10);
  });
  plot(7, 7, 'terraces', (o) => {
    o.ln(-85, 8, 85, 8, { highway: 'residential', sidewalk: 'both', name: 'Upper terrace' }); o.ln(-85, -8, 85, -8, { highway: 'residential', sidewalk: 'both', name: 'Lower terrace' });
    o.ln(-85, 0, 85, 0, { barrier: 'retaining_wall' }); o.row(-80, 80, 8, { side: 1 }); o.row(-80, 80, -8, { side: -1 });
    o.lab('two streets 3 m apart in height, a retaining wall between their sidewalks', 0, 0, [45, 0]);
  }, eased((lx, ly) => (ly > 0 ? 3 : 0) + 4));
  plot(8, 7, 'steep cross street', (o) => {
    o.ln(-85, 0, 85, 0, { highway: 'residential', sidewalk: 'both', name: 'Steep along' }, 10, [[0, 0]]); o.ln(0, -85, 0, 0, { highway: 'residential', sidewalk: 'both' });
    o.row(-80, -15, 0); o.row(15, 80, 0, { side: 1 }); o.lab('T on a 20 % hill: the side street climbs, the main street runs level', 0, 0, [55, 0]);
  }, eased((lx, ly) => 0.2 * Math.min(0, Math.max(-85, ly)) + 18));
  plot(5, 8, 'stepped street', (o) => {
    o.ln(-85, 0, 85, 0, { highway: 'pedestrian', name: 'Stepped lane' }); o.ln(-85, 30, 85, 30, { highway: 'residential', sidewalk: 'both', name: 'Grade change street' });
    o.row(-80, 80, 30, { side: 1 }); o.row(-80, 80, 0, { side: -1, back: 6 });
    o.lab('a street whose grade changes from 0 to 12 % and back', 0, 30, [50, 0]);
  }, eased((lx) => (lx < -30 ? 0 : lx < 30 ? 0.12 * (lx + 30) : 7.2) + 4));
  plot(6, 8, 'retaining wall behind the sidewalk', (o) => {
    o.ln(-85, 0, 85, 0, { highway: 'residential', sidewalk: 'both', name: 'Wall street' }); o.ln(-80, 5.5, 80, 5.5, { barrier: 'retaining_wall' });
    o.row(-80, 80, 0, { side: -1 }); o.lab('a 4 m retaining wall right behind the north sidewalk', 0, 3, [40, 0]);
    o.walk('along the wall', -50, 4, 0);
  }, eased((lx, ly) => (ly > 6 ? 4 : 0) + 4));
  plot(7, 8, 'cross-slope driveways', (o) => {
    const drives = [-40, 0, 40];
    o.ln(-85, 0, 85, 0, { highway: 'residential', sidewalk: 'both', name: 'Hillside driveways' }, 10, drives.map((x) => [x, 0]));
    for (const x of drives) { o.ln(x, 0, x, 20, { highway: 'service', service: 'driveway' }); o.bx(x, 27, 10, 10, { building: 'house' }); }
    o.lab('driveways up a 15 % bank from a street with sidewalks', 0, 0, [45, 0]);
  }, eased((lx, ly) => 0.15 * Math.max(-20, Math.min(40, ly)) + 7));
  plot(8, 8, 'stairs street', (o) => {
    o.ln(0, -85, 0, 85, { highway: 'steps', name: 'Stair street', width: '4' }); o.col(-80, 80, 0, { back: 5 });
    o.ln(-85, 85, 85, 85, { highway: 'residential', sidewalk: 'both' }); o.ln(-85, -85, 85, -85, { highway: 'residential', sidewalk: 'both' });
    o.lab('a stair street between two streets (steps, width=4)', 0, 0, [55, 90]);
  }, eased((lx, ly) => 0.12 * Math.max(-85, Math.min(85, ly)) + 14, 12));

  // the coast's ground, row by row: a wall drops straight to the sea; a beach slopes; a cliff is 8 m up
  const coastAt = (x, y) => {
    const f = fronts.find((s) => y >= s.y0 && y < s.y1) || { kind: 'wall' };
    if (f.kind === 'beach') return x >= COAST_X + 30 ? null : x >= COAST_X ? (BASE * (x - COAST_X)) / 30 : -Math.min(-SEA_FLOOR, (COAST_X - x) * 0.3);
    if (f.kind === 'lowbeach') return x >= COAST_X + 15 ? null : x >= COAST_X ? 1 + (x - COAST_X) * 0.02 : Math.max(SEA_FLOOR, 1 - (COAST_X - x) * 0.3);
    // (8 m over the land behind at the edge, back down to it 40-60 m inland)
    if (f.kind === 'cliff') return x >= COAST_X ? BASE + 8 * Math.min(1, (x - COAST_X) / 2) * smooth((COAST_X + 60 - x) / 20) : SEA_FLOOR;
    return x >= COAST_X + 0.5 ? null : SEA_FLOOR;
  };
  const heightAt = (x, y) => {
    const c = x < COAST_X + 70 ? coastAt(x, y) : null;
    if (c != null) return c;
    let h = BASE;
    for (const p of heights) { const lx = x - p.cx; const ly = y - p.cy; if (Math.abs(lx) <= 100 && Math.abs(ly) <= 100) h += p.dz(lx, ly); }
    return h;
  };
  const landCover = (x, y) => (x < COAST_X ? 80 : 50);
  return { b, size: SIZE, heightAt, landCover };
}
