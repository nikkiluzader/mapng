import test from 'node:test';
import assert from 'node:assert/strict';

import {
  solveTunnel, chainTunnelParts, tunnelGroundAt, tunnelHoleAt, tunnelReach, nearestOnTunnel,
  buildTubeGeometry, buildPortalGeometry, buildWindowGeometry, buildTunnelObjects, hitsTunnel, isBoredTunnelTag, absorbBranch, fitBesideRoads,
  MAX_GRADE, LINING_M,
} from '../services/beamngTunnels.js';

// The scratch/tunnelspike ridge: flat ground at 20 m, a 70 m ridge across
// y = 0 with ~41° flanks from |y| = 150 to 230.
const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const ridge = (x, y) => 20 + 70 * smooth((230 - Math.abs(y)) / 80);
const road = (y0, y1, x = 0) => [[x, y0], [x, y1]];

// Apply a tunnel's terrain edits to a 1 m grid over its reach; returns
// { h(x, y), holes: Set of 'x,y' square keys } (square (x, y)..(x+1, y+1)).
function grade(t, groundAt) {
  const [x0, y0, x1, y1] = tunnelReach(t).map((v, i) => (i < 2 ? Math.floor(v) : Math.ceil(v)));
  const H = new Map();
  for (let y = y0; y <= y1 + 1; y++) for (let x = x0; x <= x1 + 1; x++) H.set(`${x},${y}`, tunnelGroundAt(t, x, y, groundAt(x, y)));
  const h = (x, y) => H.get(`${x},${y}`) ?? groundAt(x, y);
  const holes = new Set();
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const c = [h(x, y), h(x + 1, y), h(x, y + 1), h(x + 1, y + 1)];
      if (tunnelHoleAt(t, x + 0.5, y + 0.5, Math.min(...c), Math.max(...c))) holes.add(`${x},${y}`);
    }
  }
  return { h, holes, box: [x0, y0, x1, y1] };
}

const spikeTunnel = () => solveTunnel({ xy: road(-400, 400), half: 4 }, {
  groundAt: ridge,
  approaches: [{ xy: road(-400, -700) }, { xy: road(400, 700) }],
});

test('tunnel=yes ways are built, and avalanche galleries; not passages or culverts', () => {
  assert.equal(isBoredTunnelTag({ tunnel: 'yes' }), true);
  assert.equal(isBoredTunnelTag({ tunnel: 'avalanche_protector' }), true);
  for (const v of ['building_passage', 'culvert', 'flooded', 'no', undefined]) {
    assert.equal(isBoredTunnelTag({ tunnel: v }), false, String(v));
  }
});

// a hillside rising 0.5 m per m to the left (-x) of a road along +y
const hillside = (x) => 50 - 0.5 * x;

test('a tunnel on a hillside with too little rock over it is a gallery, not a sunken box', () => {
  const t = solveTunnel({ xy: road(-150, 150), half: 4 }, { groundAt: hillside, approaches: [{ xy: road(-150, -400) }, { xy: road(150, 400) }] });
  assert.equal(t.ok, true, t.reason);
  assert.equal(t.kind, 'gallery');
  assert.equal(t.uphill, -1, 'the wall on the uphill (left) side');
  // the road stays where it is
  for (const p of t.line) assert.ok(Math.abs(p.z - 50) < 0.5, `road at ${p.z.toFixed(2)}`);
  // nothing opens; under the roof the floor is the road; uphill the rock is
  // cut back over the roof; it is no box sunk under the slope
  assert.equal(tunnelHoleAt(t, 0, 0, 40, 60), false);
  assert.ok(Math.abs(tunnelGroundAt(t, -3, 0, hillside(-3)) - 50) < 0.5);
  assert.ok(tunnelGroundAt(t, -12, 0, hillside(-12)) <= 50 + t.headTop + 4 * (12 - t.W - 1.1) + 1e-6);
  const objs = buildTunnelObjects(t, 'g', () => 'id');
  assert.equal(objs.lightCount, 0, 'open to the daylight: no lights');
  assert.ok(buildTubeGeometry(t)[0].pos.length > 0);
});

test('tunnel=avalanche_protector is a gallery whatever the ground', () => {
  const t = solveTunnel({ xy: road(-60, 60), half: 3, gallery: true }, { groundAt: hillside });
  assert.equal(t.ok, true, t.reason);
  assert.equal(t.kind, 'gallery');
});

test('a gallery: a ribbed wall uphill, the hillside brought up to its roof behind it, backfilled on a gentle slope and run out past the ends', () => {
  const gentle = (x) => 50 - 0.1 * x;                 // uphill to the left (-x), far too low for the roof
  const t = solveTunnel({ xy: road(-60, 60), half: 3, gallery: true }, { groundAt: gentle });
  assert.equal(t.ok, true, t.reason);
  assert.equal(t.uphill, -1);
  const inner = t.W + 0.5;
  const top = 50 + t.headTop;
  // the road and walkway on the floor
  assert.ok(Math.abs(tunnelGroundAt(t, -(inner - 0.1), 0, gentle(-(inner - 0.1))) - 50) < 0.3);
  // the bank meets the roof's top just past the walkway, and stays up over the roof's edge
  assert.ok(tunnelGroundAt(t, -(inner + 1.3), 0, gentle(-(inner + 1.3))) > top - 0.3);
  assert.ok(tunnelGroundAt(t, -(inner + 2), 0, gentle(-(inner + 2))) > top - 0.1, 'level over the roof edge');
  // backfill falls 1:1 back to the natural slope
  const far = -(inner + 1.2 + 25);
  assert.ok(Math.abs(tunnelGroundAt(t, far, 0, gentle(far)) - gentle(far)) < 1e-6);
  // past the north end, beside the road: the fill falls along the road too; on the road nothing is filled
  const bx = -(inner + 1.3);
  const z63 = tunnelGroundAt(t, bx, 63, gentle(bx)); const z66 = tunnelGroundAt(t, bx, 66, gentle(bx));
  assert.ok(z63 < top - 0.5 && z66 < z63 && z66 > gentle(bx) + 0.3, `${z63} ${z66}`);
  assert.equal(tunnelGroundAt(t, bx, 72, gentle(bx)), gentle(bx));
  assert.equal(tunnelGroundAt(t, 0, 63, gentle(0)), gentle(0));
  // the valley side is never raised
  assert.ok(tunnelGroundAt(t, inner + 5, 0, gentle(inner + 5)) <= gentle(inner + 5));
  // the uphill wall stands at the walkway's edge, in front of the bank (0.6 m thick):
  // nothing of the mesh below the roof behind it, in the hillside
  const pos = buildTubeGeometry(t)[0].pos;
  let wall = 0;
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i] < -(inner + 0.61) && Math.abs(pos[i + 1]) < 55) assert.ok(pos[i + 2] >= 50 + 5.2 - 0.6, `mesh at x ${pos[i].toFixed(2)} z ${pos[i + 2].toFixed(2)}`);
    if (pos[i] < -(inner - 0.01) && pos[i + 2] < 51) wall++;
  }
  assert.ok(wall > 0, 'the uphill wall');
  // its pilasters stand out into the gallery, never past the walkway's edge into the lanes
  for (let i = 0; i < pos.length; i += 3) if (pos[i + 2] < 50 + 4) assert.ok(Math.abs(pos[i]) >= t.W - 1e-6, `mesh in the lanes at x ${pos[i].toFixed(2)}`);
  // terrain left as it was (shaping off): the concrete back wall
  const walled = buildTubeGeometry({ ...t, keepWall: true })[0].pos;
  let low = 0;
  for (let i = 0; i < walled.length; i += 3) if (walled[i] < -(inner - 0.01) && walled[i + 2] < 51) low++;
  assert.ok(low > 0, 'the wall stands on the uphill side');
});

test('the spike ridge: portals on the flanks, the road under the hill', () => {
  const t = spikeTunnel();
  assert.equal(t.ok, true, t.reason);
  const yS = t.line[t.iS].y; const yN = t.line[t.iN].y;
  assert.ok(yS > -230 && yS < -190, `south portal at y=${yS.toFixed(1)}`);
  assert.ok(yN < 230 && yN > 190, `north portal at y=${yN.toFixed(1)}`);
  for (let i = t.iS; i <= t.iN; i++) {
    const p = t.line[i];
    assert.ok(ridge(p.x, p.y) - p.z >= t.need - 1e-6 || Math.abs(i - t.iS) < 3 || Math.abs(i - t.iN) < 3, `covered at y=${p.y}`);
  }
  for (let i = 1; i < t.line.length; i++) {
    const g = Math.abs(t.line[i].z - t.line[i - 1].z) / (t.line[i].s - t.line[i - 1].s);
    assert.ok(g <= MAX_GRADE + 0.01, `grade ${g.toFixed(3)} at ${i}`);
  }
});

test('terrain: no ground inside the bore, holes only just behind the headwalls', () => {
  const t = spikeTunnel();
  const { h, holes, box } = grade(t, ridge);
  let inside = 0;
  for (let y = box[1]; y <= box[3]; y++) {
    for (let x = box[0]; x <= box[2]; x++) {
      const n = nearestOnTunnel(t, x + 0.5, y + 0.5, 20);
      if (!n || n.into < 0 || Math.abs(n.d) > t.W) continue;
      const lo = Math.min(h(x, y), h(x + 1, y), h(x, y + 1), h(x + 1, y + 1));
      const hi = Math.max(h(x, y), h(x + 1, y), h(x, y + 1), h(x + 1, y + 1));
      const roof = n.z + t.wall + t.arch * Math.sqrt(Math.max(0, 1 - (n.d / t.W) ** 2));
      if (!holes.has(`${x},${y}`) && hi > n.z + 0.05 && lo < roof) inside++;
    }
  }
  assert.equal(inside, 0, 'terrain squares reaching into the bore');
  assert.ok(holes.size > 0 && holes.size < 60, `${holes.size} hole squares`);
  for (const k of holes) {
    const [x, y] = k.split(',').map(Number);
    const n = nearestOnTunnel(t, x + 0.5, y + 0.5);
    assert.ok(n.into > 0 && n.into < t.headDepth, `hole at into ${n.into.toFixed(2)} sits inside a headwall`);
  }
  // the cutting floor is at road level, the hill over the bore untouched
  const p = t.line[t.iS - 5];
  assert.ok(Math.abs(h(Math.round(p.x), Math.round(p.y)) - p.z) < 0.6, 'cutting floor at the road');
  assert.equal(h(0, 0), ridge(0, 0), 'hill over the middle untouched');
});

test('a short way is no tunnel', () => {
  const short = solveTunnel({ xy: road(0, 12), half: 4 }, { groundAt: ridge });
  assert.equal(short.ok, false);
});

test('a tunnel mapped under flat ground is cut and cover: a box under the street, trenches out', () => {
  const flat = () => 10;
  const t = solveTunnel({ xy: road(-200, 200), half: 4 }, { groundAt: flat, approaches: [{ xy: road(-200, -600) }, { xy: road(200, 600) }] });
  assert.equal(t.ok, true, t.reason);
  assert.equal(t.kind, 'cutcover');
  // (the vertical curves at the portals may take up to 0.5 m of the cover)
  for (let i = t.iS; i <= t.iN; i++) assert.ok(10 - t.line[i].z >= t.need - 0.5 - 1e-6, `under the street at ${t.line[i].y}`);
  assert.ok(t.need < 8, `${t.need.toFixed(1)} m deep: a box, not a bore`);
  assert.ok(t.headTop - t.need < 0.5, 'headwall to the street, not 10 m over it');
  // the trenches climb back to the street at the tunnel grade
  assert.ok(Math.abs(t.line[0].z - 10) < 0.3 && Math.abs(t.line[t.line.length - 1].z - 10) < 0.3, 'trench ends at the street');
  for (let i = 1; i < t.line.length; i++) {
    assert.ok(Math.abs(t.line[i].z - t.line[i - 1].z) / (t.line[i].s - t.line[i - 1].s) <= MAX_GRADE + 0.01);
  }
  // the street over it is left alone
  assert.equal(tunnelGroundAt(t, 0, 0, 10), 10);
});

test('a ramp splitting off inside a tunnel: one group, the main path and its branch', () => {
  const main = [{ xy: [[0, -200], [0, 100]] }, { xy: [[0, 100], [0, 200]] }];
  const ramp = { xy: [[0, 100], [8, 200]] };
  const { paths, branched, trees } = chainTunnelParts([...main, ramp]);
  assert.equal(paths.length, 0);
  assert.equal(branched.length, 0);
  assert.equal(trees.length, 1);
  assert.equal(trees[0].main.idx.length, 2, 'the longest path is the main tunnel');
  assert.deepEqual(trees[0].branches[0].xy[0], [0, 100], 'the branch starts at the junction');
});

test('a branch off a branch inside a tunnel: the main tunnel and its branch built, only the sub-branch left over', () => {
  const main = [{ xy: [[0, -200], [0, 100]] }, { xy: [[0, 100], [0, 200]] }];
  const ramp = [{ xy: [[0, 100], [20, 150]] }, { xy: [[20, 150], [30, 220]] }];
  const sub = { xy: [[20, 150], [60, 180]] };
  const { branched, trees } = chainTunnelParts([...main, ...ramp, sub]);
  assert.equal(trees.length, 1, 'built as a tree');
  assert.ok(trees[0].main.idx.length >= 2 && trees[0].branches.length >= 1, 'a main tunnel and a branch');
  assert.equal(trees[0].leftover.length, branched.flat().length);
  assert.ok(branched.flat().length <= 2, 'only the pieces past the fork are left over');
});

test('a ramp taken into the tunnel: the bore widens on its side out to the portal, then its own trench', () => {
  const flat = () => 10;
  const t = solveTunnel({ xy: road(-200, 200), half: 4 }, { groundAt: flat, approaches: [{ xy: road(-200, -600) }, { xy: road(200, 600) }] });
  // splitting off right 100 m in, 16 m off the main road at the portal, then away
  const xy = [[0, 100], [8, 200], [40, 400]];
  const res = absorbBranch(t, { xy, half: 2, tunnelLength: Math.hypot(8, 100) }, { groundAt: flat });
  assert.equal(res.ok, true, res.reason);
  const portal = t.line[t.iN];
  // travel is +y: right of travel is +x
  assert.ok(portal.wr - t.W > 5.5, `widened ${(portal.wr - t.W).toFixed(1)} m on the ramp's side at the portal`);
  assert.equal(portal.wl, t.W, 'the other side as it was');
  const before = t.line.find((p) => p.y > 0 && p.y < 90);
  assert.ok(before.wr - t.W < 0.5, 'not widened before the junction');
  assert.equal(t.cuts.length, 1, 'its own trench where it leaves the main one');
  // the ramp's road is in the bore: inside the widened outline, no hole over it
  assert.equal(hitsTunnel([t], 8, 199, t.line[t.iN].z + 1, t.line[t.iN].z + 2), true);
  // and its own trench reaches down to it
  const cut = t.cuts[0].line[1];
  assert.ok(cut.z < 10 && tunnelGroundAt(t, cut.x, cut.y, 10) <= cut.z + 0.05, 'the ground cut down to the ramp');
});

test('a dip in the hill is made up with fill over the bore', () => {
  const notch = (x, y) => ridge(x, y) - (Math.abs(y) < 20 ? 64 : 0);   // a gully across the ridge
  const t = solveTunnel({ xy: road(-400, 400), half: 4 }, { groundAt: notch, approaches: [{ xy: road(-400, -700) }, { xy: road(400, 700) }] });
  assert.equal(t.ok, true, t.reason);
  assert.ok(t.fill > 0, 'cover made up');
  const n = nearestOnTunnel(t, 0, 0);
  assert.ok(tunnelGroundAt(t, 0, 0, notch(0, 0)) >= n.z + t.need - 1e-6, 'filled to the cover');
});

test('a bridge meeting the portal: its height, no cutting', () => {
  const t = solveTunnel({ xy: road(-215, 400), half: 4 }, {
    groundAt: ridge,
    approaches: [{ xy: road(-215, -500), deckZ: 23 }, { xy: road(400, 700) }],
  });
  assert.equal(t.ok, true, t.reason);
  assert.ok(Math.abs(t.line[0].z - 23) < 1e-6, 'starts at the deck');
  assert.ok(t.line[0].y >= -215, 'no cutting out along the bridge');
});

test('tunnel parts chain into paths; a fork splits into the longest path and a branch', () => {
  const a = { xy: [[0, 0], [10, 0]] }; const b = { xy: [[20, 0], [10, 0]] }; const c = { xy: [[20, 0], [30, 0]] };
  const { paths } = chainTunnelParts([a, b, c]);
  assert.equal(paths.length, 1);
  assert.deepEqual(paths[0].xy.map((p) => p[0]), [0, 10, 20, 30]);
  const fork = chainTunnelParts([a, b, { xy: [[10, 0], [10, 6]] }]);
  assert.equal(fork.paths.length, 0);
  assert.equal(fork.branched.length, 0);
  assert.equal(fork.trees.length, 1);
  assert.equal(fork.trees[0].branches.length, 1);
});

test('geometry, lights and zones', () => {
  const t = spikeTunnel();
  const pieces = buildTubeGeometry(t);
  assert.ok(pieces.length >= 2, 'a 430 m tube in pieces');
  for (const piece of pieces) assert.equal(piece.pos.length % 9, 0);
  const portal = buildPortalGeometry(t, 'S');
  assert.ok(portal.pos.length / 9 > 50, 'headwall + wingwalls');
  let k = 0;
  const objs = buildTunnelObjects(t, 'tunnel_1', () => `id${k++}`);
  assert.ok(objs.lightCount > 40 && objs.lightCount < 90, `${objs.lightCount} lights`);
  assert.ok(objs.lights.every((o) => !('child' in o) && !o.nightLight), 'lights not night-only');
  assert.ok(objs.zones.filter((o) => o.class === 'Zone').length >= 8);
  // inside the bore is blocked, the hilltop over it is not
  const mid = t.line[Math.round((t.iS + t.iN) / 2)];
  assert.equal(hitsTunnel([t], mid.x, mid.y, mid.z, mid.z + 2), true);
  assert.equal(hitsTunnel([t], mid.x, mid.y, ridge(mid.x, mid.y), ridge(mid.x, mid.y) + 10), false);
  assert.ok(LINING_M > 0);
});

test('a portal in a vertical cliff: rock cut back over the headwall, no slot, nothing in the bore', () => {
  // flat at 20 m, a sheer 130 m cliff at y = -150 (one grid square), the
  // plateau falling back to 20 m by y = 400
  const cliff = (x, y) => (y < -150 ? 20 : 20 + 130 * Math.max(0, Math.min(1, (400 - y) / 100)));
  const t = solveTunnel({ xy: road(-400, 500), half: 4 }, { groundAt: cliff, approaches: [{ xy: road(-400, -700) }, { xy: road(500, 800) }] });
  assert.equal(t.ok, true, t.reason);
  const { h, holes, box } = grade(t, cliff);
  let inside = 0;
  for (let y = box[1]; y <= box[3]; y++) {
    for (let x = box[0]; x <= box[2]; x++) {
      const n = nearestOnTunnel(t, x + 0.5, y + 0.5, 20);
      if (!n || n.into < 0 || Math.abs(n.d) > t.W) continue;
      const c = [h(x, y), h(x + 1, y), h(x, y + 1), h(x + 1, y + 1)];
      const roof = n.z + t.wall + t.arch * Math.sqrt(Math.max(0, 1 - (n.d / t.W) ** 2));
      if (!holes.has(`${x},${y}`) && Math.max(...c) > n.z + 0.05 && Math.min(...c) < roof) inside++;
    }
  }
  assert.equal(inside, 0, 'terrain squares reaching into the bore');
  for (const k of holes) {
    const [x, y] = k.split(',').map(Number);
    const n = nearestOnTunnel(t, x + 0.5, y + 0.5);
    const hi = Math.max(h(x, y), h(x + 1, y), h(x, y + 1), h(x + 1, y + 1));
    assert.ok(hi <= n.z + 11, `hole square rises ${(hi - n.z).toFixed(1)} m over the road`);
  }
  // over the headwall the cliff is cut back, then rises again
  const p = t.line[t.iS];
  const at = (into) => h(Math.round(p.x), Math.round(p.y + into));
  assert.ok(at(t.headDepth) - p.z < 11, `ground at the headwall's back ${(at(t.headDepth) - p.z).toFixed(1)} m`);
  assert.ok(at(60) - p.z > 100, 'cliff stands again further in');
});

test('ends too far apart in height for any road grade: no tunnel', () => {
  const step = (x, y) => (y < -150 ? 20 : 150);
  const t = solveTunnel({ xy: road(-400, 200), half: 4 }, { groundAt: step, approaches: [{ xy: road(-400, -700) }, { xy: road(200, 500) }] });
  assert.equal(t.ok, false);
  assert.match(t.reason, /apart in height/);
});

test('a bore close behind a cliff face gets gallery windows through it, and nowhere else', () => {
  // the spike ridge with a canyon east of the road (x > 14) along its middle
  const canyon = (x, y) => (x > 14 && Math.abs(y) < 100 ? 20 : ridge(x, y));
  const t = solveTunnel({ xy: road(-400, 400), half: 4 }, {
    groundAt: canyon,
    approaches: [{ xy: road(-400, -700) }, { xy: road(400, 700) }],
  });
  assert.ok(t.ok, t.reason);
  assert.ok(t.windows.length >= 2, `${t.windows.length} windows`);
  for (const w of t.windows) {
    assert.equal(w.side, 1, 'on the canyon side (right of travel)');
    assert.ok(Math.abs(w.y) + w.halfLen <= 100, `window at y=${w.y.toFixed(0)} inside the canyon stretch`);
    assert.ok(w.face > t.W + LINING_M && w.face <= 15, `face at ${w.face}`);
  }
  for (let k = 1; k < t.windows.length; k++) assert.ok(t.windows[k].s - t.windows[k - 1].s >= 70, 'spaced out');
  // one walk-in gallery (the one nearest a portal), the rest small windows
  assert.equal(t.windows.filter((q) => q.kind === 'gallery').length, 1);
  // the plain spike ridge has rock all round: none
  assert.equal(spikeTunnel().windows.length, 0);

  const { h, holes } = grade(t, canyon);
  const w = t.windows[0];
  const at = (a, r) => [Math.round(w.x + a * w.tx + r * w.ty), Math.round(w.y + a * w.ty - r * w.tx)];
  // the face's line at the window's sill, the window's squares open down to it only
  const [sx, sy] = at(0, Math.max(w.face, t.W + LINING_M + 1));
  assert.ok(Math.abs(h(sx, sy) - (w.z + w.sill - 0.3)) < 0.35, `face line at ${(h(sx, sy) - w.z).toFixed(2)} over the road`);
  const near = [...holes].map((k) => k.split(',').map(Number)).filter(([x, y]) => Math.abs(y + 0.5 - w.y) < 6);
  assert.ok(near.length > 0, 'squares opened at the window');
  for (const [x, y] of near) {
    const c = [h(x, y), h(x + 1, y), h(x, y + 1), h(x + 1, y + 1)];
    assert.ok(Math.min(...c) >= w.z + w.sill - 1.5 && Math.max(...c) <= w.z + Math.max(w.spring + w.rise + LINING_M + 1.5, t.need) + 0.5, `square ${x},${y} spans ${Math.min(...c).toFixed(1)}..${Math.max(...c).toFixed(1)}`);
  }
  // the tube's wall is open there, and the passage / face plate built
  const geo = buildWindowGeometry(t);
  assert.ok(geo && geo.pos.length > 0);
  assert.ok(hitsTunnel([t], ...at(0, w.face - 1), w.z + 1, w.z + 2), 'the face plate counts as structure');
  // nothing of the tube's wall across the middle of each opening
  const crossing = (pieces, o, d) => {
    let hits = 0;
    for (const { pos } of pieces) {
      for (let k = 0; k < pos.length; k += 9) {
        const A = pos.slice(k, k + 3); const B = pos.slice(k + 3, k + 6); const C = pos.slice(k + 6, k + 9);
        const e1 = B.map((v, i) => v - A[i]); const e2 = C.map((v, i) => v - A[i]);
        const pv = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
        const det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
        if (Math.abs(det) < 1e-9) continue;
        const tv = o.map((v, i) => v - A[i]);
        const u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) / det;
        const qv = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
        const v = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) / det;
        const dist = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) / det;
        if (u >= 0 && v >= 0 && u + v <= 1 && dist >= 0 && dist <= 1) hits++;
      }
    }
    return hits;
  };
  // a zone Portal through each window: from inside, the world beyond renders
  let n = 0;
  const objs = buildTunnelObjects(t, 'tunnel_t001', () => `id${n++}`);
  assert.equal(objs.zones.filter((o) => o.class === 'Portal' && o.name.includes('window_portal')).length, t.windows.length);
  for (const q of t.windows) {
    const v = q.z + (q.floor + Math.min(t.wall, q.spring)) / 2 + 0.3;
    const o = [q.x + q.side * (t.W - 0.5) * q.ty, q.y - q.side * (t.W - 0.5) * q.tx, v];
    const d = [q.side * 1.5 * q.ty, -q.side * 1.5 * q.tx, 0];   // from inside the tube out through the wall
    assert.equal(crossing(buildTubeGeometry(t), o, d), 0, `tube wall across the window at ${q.s.toFixed(0)}`);
    assert.ok(crossing(buildTubeGeometry({ ...t, windows: [] }), o, d) > 0, 'a plain tube has its wall there');
  }
});

test('another road beside a portal: its ground left alone, the headwall and wingwalls clear of it', () => {
  const t = spikeTunnel();
  const p = t.line[t.iS];
  // a ramp running alongside the cutting, its edge 2 m past the lining
  const off = t.W + LINING_M + 2 + 3.5;
  const ramp = { xy: [[p.x + off, p.y - 200], [p.x + off, p.y + 30]], half: 3.5 };
  const plain = buildPortalGeometry(t, 'S').pos;
  const reachOf = (pos) => { let m = 0; for (let i = 0; i < pos.length; i += 3) if (pos[i + 1] < p.y + 3) m = Math.max(m, pos[i] - p.x); return m; };
  assert.ok(reachOf(plain) > off - 3.5, 'without the ramp the headwall reaches into it');
  fitBesideRoads(t, [ramp], ridge);
  assert.ok(reachOf(buildPortalGeometry(t, 'S').pos) <= off - 3.5 + 0.05, 'headwall and wingwall stop at its edge');
  // its ground is not graded
  for (let y = p.y - 60; y <= p.y; y += 5) assert.equal(tunnelGroundAt(t, p.x + off, y, ridge(p.x + off, y)), ridge(p.x + off, y));
  // the far side keeps its full headwall
  let left = 0;
  for (let i = 0; i < plain.length; i += 3) left = Math.min(left, plain[i] - p.x);
  let left2 = 0; const pos2 = buildPortalGeometry(t, 'S').pos;
  for (let i = 0; i < pos2.length; i += 3) left2 = Math.min(left2, pos2[i] - p.x);
  assert.ok(Math.abs(left2 - left) < 0.01, 'the other side unchanged');
  // a street crossing over the tube still gets the cover over it (low ground
  // there opened squares down to the box)
  const q = t.line[t.iS + 4];
  const street = { xy: [[q.x - 30, q.y], [q.x + 30, q.y]], half: 4 };
  const before = tunnelGroundAt(t, q.x, q.y, q.z);
  fitBesideRoads(t, [ramp, street], ridge);
  assert.equal(tunnelGroundAt(t, q.x, q.y, q.z), before, 'cover over the tube under the street');
  assert.ok(before > q.z + t.crown, 'made up over the crown');
});

test('terrain left as surveyed (raw): the bore runs out to where the ground meets the road, its headwall bigger, an apron in front, holes along the mouth', () => {
  // OSM's tunnel ends at the foot of each flank: the survey has the portal faces
  const path = { xy: road(-232, 232), half: 3.5 };
  const shaped = solveTunnel(path, { groundAt: ridge });
  const raw = solveTunnel(path, { groundAt: ridge, raw: true });
  assert.ok(shaped.ok && raw.ok);
  const len = (t) => t.line[t.iN].s - t.line[t.iS].s;
  assert.ok(len(raw) > len(shaped) + 10, `raw bore ${len(raw).toFixed(0)} m runs further out than the shaped one ${len(shaped).toFixed(0)} m`);
  assert.equal(raw.raw, true);
  assert.ok(raw.headHalf > shaped.headHalf && raw.headTop > shaped.headTop && raw.headDepth > shaped.headDepth, 'a bigger headwall');
  // outside the bore the road is on the surveyed ground
  raw.line.forEach((p, k) => { if (k < raw.iS || k > raw.iN) assert.ok(Math.abs(p.z - p.g) <= 1.01, `off the ground by ${(p.z - p.g).toFixed(2)} m at ${p.s.toFixed(0)}`); });
  // the portal geometry carries an apron in front of the face, on the road's own grade
  const g = buildPortalGeometry(raw, 'S');
  const pS = raw.line[raw.iS];
  let apron = 0;
  const ap = g.apron?.pos || [];
  for (let k = 0; k < ap.length; k += 3) if (Math.abs(ap[k + 2] - pS.z) < 0.6 && (ap[k + 1] - pS.y) * pS.ty + (ap[k] - pS.x) * pS.tx < -1) apron++;
  assert.ok(apron >= 2, 'apron vertices out in front of the face, its own part (it takes the road decal)');
  assert.equal(buildPortalGeometry(shaped, 'S').apron, null, 'shaped tunnels: no apron');
});

// A low box: an underpass of a few metres under a lid (a piste, a lawn), the
// road level through it. Fine elevation shows the lid's top as the ground.
const lidGround = ({ notch = 0 } = {}) => (x, y) => {
  // the road at 10 m along x = 0; a 5.5 m lid over it from y = -50 to 50,
  // its faces vertical; `notch`: the lid's last metres cut down to the road
  // along the centre line (what road smoothing leaves), 2 m either side
  const under = Math.abs(y) <= 50;
  if (!under) return 10;
  if (notch && Math.abs(x) <= 2 && Math.abs(y) > 50 - notch) return 10;
  return 15.5;
};

test('a low lid over a level road is a low box: the road where it is, nothing dug', () => {
  const g = lidGround();
  const t = solveTunnel({ xy: road(-70, 70), half: 4 }, { groundAt: g, approaches: [{ xy: road(-70, -200) }, { xy: road(70, 200) }] });
  assert.equal(t.ok, true, t.reason);
  assert.equal(t.low, true);
  assert.notEqual(t.kind, 'cutcover');
  for (const p of t.line) assert.ok(Math.abs(p.z - 10) < 0.2, `road at ${p.z.toFixed(2)} m, y ${p.y}`);
  // the faces at the lid's ends
  assert.ok(Math.abs(Math.abs(t.line[t.iS].y) - 50) <= 3 && Math.abs(Math.abs(t.line[t.iN].y) - 50) <= 3, `faces at ${t.line[t.iS].y}, ${t.line[t.iN].y}`);
  // the mouth in front of each face: at the road across the lanes
  const { h } = grade(t, g);
  for (const y of [-56, -53, 53, 56]) for (const x of [-4, -2, 0, 2, 4]) assert.ok(h(x, y) <= 10.05, `ground ${h(x, y).toFixed(2)} at ${x}, ${y}`);
  // the lid beside the box left standing
  assert.equal(h(30, 0), 15.5);
});

test('a low box reaches the real face where the lid\'s end is notched along the centre line', () => {
  const g = lidGround({ notch: 8 });
  const t = solveTunnel({ xy: road(-70, 70), half: 4 }, { groundAt: g, approaches: [{ xy: road(-70, -200) }, { xy: road(70, 200) }] });
  assert.equal(t.ok, true, t.reason);
  assert.equal(t.low, true);
  assert.ok(Math.abs(t.line[t.iS].y) >= 47 && Math.abs(t.line[t.iN].y) >= 47, `faces at ${t.line[t.iS].y}, ${t.line[t.iN].y}: not 8 m inside the lid`);
});

test('a lid on one side only (a hillside) is no low box', () => {
  const hill = (x, y) => (Math.abs(y) <= 50 ? 10 + Math.max(0, x) * 1.5 : 10);
  const t = solveTunnel({ xy: road(-70, 70), half: 4 }, { groundAt: hill, approaches: [{ xy: road(-70, -200) }, { xy: road(70, 200) }] });
  assert.ok(!t.low, 'not a low box');
});

test('a gallery where the survey has no road bench (the roof taken out, the slope drawn through): the road carried through from its ends', () => {
  // the hillside rises to the right (+x) at 35 %; a level bench for the road only outside y = -80..80;
  // the verge on the valley side is level with the road, which falls from 12 m to 10 m
  const roadZ = (y) => 11 - y / 100;
  const g = (x, y) => (Math.abs(y) > 80 ? (Math.abs(x) <= 6 ? roadZ(y) : roadZ(y) + (x > 0 ? 0.35 * (x - 6) : 0.5 * (x + 6)))
    : (x <= -6 ? roadZ(y) + 0.5 * (x + 6) : roadZ(y) + 0.35 * (x + 6)));
  const t = solveTunnel({ xy: road(-100, 100), half: 4, gallery: true }, { groundAt: g });
  assert.equal(t.ok, true, t.reason);
  assert.equal(t.uphill, 1);
  assert.ok(t.unbenched > 50, `${t.unbenched} stations without a bench`);
  // the survey's centre line stands 2.1 m over the real road there; the road is within 0.3 m of the real one
  for (const p of t.line) assert.ok(Math.abs(p.z - roadZ(p.y)) < 0.3, `road ${p.z.toFixed(2)} at y ${p.y}, really ${roadZ(p.y).toFixed(2)}`);
  // the valley side: a verge level with the road, no drop at the lane's edge
  const edge = t.W + 0.5 + 0.6;
  assert.ok(Math.abs(tunnelGroundAt(t, -(edge + 1.5), 0, g(-(edge + 1.5), 0) - 3) - roadZ(0)) < 0.3, 'verge');
});

test('a gallery on a coarse survey (no road bench anywhere, a smooth slope): the road stays at the centre line\'s height', () => {
  const slope = (x, y) => 100 - y / 100 + 0.35 * x;
  const t = solveTunnel({ xy: road(-100, 100), half: 4, gallery: true }, { groundAt: slope });
  assert.equal(t.ok, true, t.reason);
  assert.equal(t.unbenched, 0);
  for (const p of t.line) assert.ok(Math.abs(p.z - slope(0, p.y)) < 0.2, `road ${p.z.toFixed(2)} at y ${p.y}`);
});

test('a low box whose grade meets the face over the road in front: the ground made up to it, the apron on it, no step', () => {
  // the road level at 10 m in front of the lid and 12 m behind it, the tagged way's ends 20 m out
  const roadZ = (y) => (y < -50 ? 10 : y > 50 ? 12 : 10 + (2 * (y + 50)) / 100);
  const g = (x, y) => (Math.abs(y) <= 50 ? roadZ(y) + 5.5 : roadZ(y));
  const t = solveTunnel({ xy: road(-70, 70), half: 4 }, { groundAt: g, approaches: [{ xy: road(-70, -200) }, { xy: road(70, 200) }] });
  assert.equal(t.ok, true, t.reason);
  assert.equal(t.low, true);
  const zAt = (y) => t.line.reduce((a, b) => (Math.abs(b.y - y) < Math.abs(a.y - y) ? b : a)).z;
  assert.ok(zAt(-51) - 10 > 0.1, `the grade at the face ${zAt(-51).toFixed(2)}: over the road in front (what this test is about)`);
  // the ground in front of the face is the road's line, and the apron lies on it
  const { h } = grade(t, g);
  for (const y of [-56, -54, -52]) assert.ok(Math.abs(h(0, y) - zAt(y)) < 0.08, `ground ${h(0, y).toFixed(2)} vs road line ${zAt(y).toFixed(2)} at y ${y}`);
  const ap = buildPortalGeometry(t, 'S').apron.pos;
  for (let k = 0; k < ap.length; k += 3) if (ap[k + 2] > 9.5) assert.ok(Math.abs(ap[k + 2] - zAt(ap[k + 1])) < 0.08, `apron ${ap[k + 2].toFixed(2)} at y ${ap[k + 1].toFixed(1)}`);
  // eased back to the ground further out: no step along the centre line (1 m apart)
  for (let y = -68; y < -51; y++) assert.ok(Math.abs(h(0, y + 1) - h(0, y)) <= 0.08, `step ${(h(0, y + 1) - h(0, y)).toFixed(2)} at y ${y}`);
});

test('a portal\'s frame never stands out of the road inside it (a box on a grade: no sill across the lane)', () => {
  // the road climbing 6 % through the lid
  const roadZ = (y) => 10 + 0.06 * (y + 70);
  const g = (x, y) => (Math.abs(y) <= 50 ? roadZ(y) + 5.5 : roadZ(y));
  const t = solveTunnel({ xy: road(-70, 70), half: 4 }, { groundAt: g, approaches: [{ xy: road(-70, -200) }, { xy: road(70, 200) }] });
  assert.equal(t.ok, true, t.reason);
  const zAt = (y) => { let a = t.line[0]; for (const p of t.line) if (Math.abs(p.y - y) < Math.abs(a.y - y)) a = p; return a.z + (y - a.y) * 0.06; };
  for (const end of ['S', 'N']) {
    const pos = buildPortalGeometry(t, end).pos;
    for (let k = 0; k < pos.length; k += 3) {
      if (Math.abs(pos[k]) > t.W + 0.7) continue;                     // (the opening's own corners: the sill spans the lanes between them)
      const over = pos[k + 2] - zAt(pos[k + 1]);
      assert.ok(over <= 0.02 || over > 3, `portal ${end}: frame ${over.toFixed(2)} m over the road at y ${pos[k + 1].toFixed(1)}`);
    }
  }
});

test('ground left standing inside a low box is opened: only under the roof, never the lid over it', async () => {
  const { lowMouthHoleAt } = await import('../services/beamngTunnels.js');
  const g = lidGround();
  const t = solveTunnel({ xy: road(-70, 70), half: 4 }, { groundAt: g, approaches: [{ xy: road(-70, -200) }, { xy: road(70, 200) }] });
  const yIn = (m) => t.line[t.iS].y + m;
  assert.equal(lowMouthHoleAt(t, 0, yIn(5), 10.8), true, 'a ramp of ground 0.8 m over the road, 5 m in');
  assert.equal(lowMouthHoleAt(t, 0, yIn(5), 15.5), false, 'the lid over the box stays');
  assert.equal(lowMouthHoleAt(t, 0, yIn(20), 10.8), true, 'and as far in as it stands');
  assert.equal(lowMouthHoleAt(t, 0, yIn(-3), 10.8), false, 'in front of the face: the road is on the ground there');
  assert.equal(lowMouthHoleAt(t, 12, yIn(5), 10.8), false, 'beside the box');
});

test('a thin roof sloping down to the road on the open side is a gallery roof as a survey draws it: an arcade', () => {
  // bare-earth lidar has no overhang: a gallery's roof is ground 10 m over
  // the road, its edge smeared into a slope down to road level 8 m further
  // out (the lakeside D 902: its first 85 m stayed a closed tube)
  const smear = (x, y) => (Math.abs(y) < 100 ? (x <= 6 ? Math.min(ridge(x, y), 30) : x < 14 ? 30 - (11 * (x - 6)) / 8 : 19) : ridge(x, y));
  const t = solveTunnel({ xy: road(-400, 400), half: 4 }, { groundAt: smear, approaches: [{ xy: road(-400, -700) }, { xy: road(400, 700) }] });
  assert.ok(t.ok, t.reason);
  assert.equal(t.arcades.length, 1, 'one arcade along the thin-roofed stretch');
  assert.equal(t.arcades[0].side, 1);
  assert.ok(t.arcades[0].s1 - t.arcades[0].s0 > 150, `it runs ${Math.round(t.arcades[0].s1 - t.arcades[0].s0)} m`);
  assert.ok(t.arcades[0].rock > 3, 'the ground is kept under the sill out to the smeared face');
  // the same slope under a thick roof is a hillside over a bore: no arcade
  const thick = (x, y) => (Math.abs(y) < 100 ? (x <= 6 ? Math.min(ridge(x, y), 45) : x < 14 ? 45 - (26 * (x - 6)) / 8 : 19) : ridge(x, y));
  assert.equal(solveTunnel({ xy: road(-400, 400), half: 4 }, { groundAt: thick, approaches: [{ xy: road(-400, -700) }, { xy: road(400, 700) }] }).arcades.length, 0);
});

test('a mountain road climbing away from its portal on the ground has no long cutting', () => {
  // a road running north at 10 %, a 14 m spur across it between
  // y = -30 and 30: the tunnel is the spur; outside it the road is on the ground
  // (through the spur at 4 %, as a tunnel is built)
  const base = (y) => (Math.abs(y) <= 30 ? 0.04 * y : Math.sign(y) * (1.2 + 0.1 * (Math.abs(y) - 30)));
  const ground = (x, y) => 100 + base(y) + 14 * Math.exp(-((y / 14) ** 2));
  const line = (y0, y1) => { const pts = []; const n = Math.ceil(Math.abs(y1 - y0) / 10); for (let i = 0; i <= n; i++) pts.push([0, y0 + ((y1 - y0) * i) / n]); return pts; };
  const t = solveTunnel({ xy: line(-30, 30), half: 4 }, { groundAt: ground, approaches: [{ xy: line(-30, -380) }, { xy: line(30, 380) }] });
  assert.equal(t.ok, true, t.reason);
  const sS = t.line[t.iS].s; const sN = t.line[t.iN].s;
  const before = sS - t.line[0].s; const after = t.line[t.line.length - 1].s - sN;
  // (held to the tunnel's own grade, the uphill approach fell ever further
  // under the hillside: a cutting 250 m long with a wall along it. Tester report, 0.2.16)
  assert.ok(before < 110 && after < 110, `approaches ${before.toFixed(0)} m and ${after.toFixed(0)} m`);
  // and the ground beside the road 170 m on is not graded for it
  assert.equal(tunnelGroundAt(t, 6, 200, ground(6, 200)), ground(6, 200));
  assert.equal(tunnelGroundAt(t, 6, -200, ground(6, -200)), ground(6, -200));
});

test('a bore with the open air right beside it for a long way is an arcade there: openings all along, no cover made up', () => {
  // the spike ridge, a lake's cliff right beside the road (x > 8) along 200 m of its middle:
  // mapped as one tunnel, in fact an avalanche gallery along that stretch
  // (the roof near the surface there, as on a ledge: 16 m of ground over the road)
  const ledge = (x, y) => (Math.abs(y) < 100 ? (x > 8 ? 20 : Math.min(ridge(x, y), 36)) : ridge(x, y));
  const t = solveTunnel({ xy: road(-400, 400), half: 4 }, {
    groundAt: ledge,
    approaches: [{ xy: road(-400, -700) }, { xy: road(400, 700) }],
  });
  assert.ok(t.ok, t.reason);
  assert.equal(t.arcades.length, 1);
  const a = t.arcades[0];
  assert.equal(a.side, 1, 'on the lake side (right of travel)');
  assert.ok(a.s1 - a.s0 > 150, `the arcade runs ${Math.round(a.s1 - a.s0)} m`);
  const open = t.windows.filter((w) => w.arcade);
  // (an opening every 10 m, 8 m wide, a pillar between)
  assert.ok(open.length >= 15, `${open.length} openings`);
  for (const w of open) { assert.equal(w.kind, 'gallery'); assert.ok(Math.abs(w.y) <= 100); }
  for (let k = 1; k < open.length; k++) assert.ok(Math.abs((open[k].s - open[k - 1].s) - 10) < 0.5, 'evenly spaced');
  // no cover is made up over the tube there: the roof stands in the open
  const mid = t.line.find((p) => Math.abs(p.y) < 1);
  assert.equal(tunnelGroundAt(t, 0, 0, mid.z + 2), mid.z + 2, 'low ground over the arcade is left');
  // ground standing in the tube along the arcade opens
  assert.equal(tunnelHoleAt(t, 0, 0, mid.z + 1), true);
  // on the open side nothing is brought up into the openings: from the lining
  // out past the face the ground stays as low as it lies (a grid point raised
  // to a face plate there hung a curtain of terrain in every opening; seen in game)
  for (let y = -80; y <= 80; y += 1) {
    const here = t.line.reduce((b, p) => (Math.abs(p.y - y) < Math.abs(b.y - y) ? p : b));
    for (let x = t.W + 0.25; x <= t.W + 5; x += 0.25) {
      assert.ok(tunnelGroundAt(t, x, y, 20) <= here.z + 1.2, `ground at x ${x}, y ${y} raised to ${tunnelGroundAt(t, x, y, 20).toFixed(1)} (road ${here.z.toFixed(1)})`);
    }
  }
  // the ridge with no lake beside it: no arcade
  assert.equal(spikeTunnel().arcades.length, 0);
  // a bore deep in the rock with a cliff face beside it: windows, a few, no arcade
  const deep = solveTunnel({ xy: road(-400, 400), half: 4 }, { groundAt: (x, y) => (x > 8 && Math.abs(y) < 100 ? 20 : ridge(x, y)), approaches: [{ xy: road(-400, -700) }, { xy: road(400, 700) }] });
  assert.equal(deep.arcades.length, 0);
  assert.ok(deep.windows.length >= 1 && deep.windows.length <= 4, `${deep.windows.length} windows`);
});
