import test from 'node:test';
import assert from 'node:assert/strict';

import {
  solveTunnel, chainTunnelParts, tunnelGroundAt, tunnelHoleAt, tunnelReach, nearestOnTunnel,
  buildTubeGeometry, buildPortalGeometry, buildWindowGeometry, buildTunnelObjects, hitsTunnel, isBoredTunnelTag, absorbBranch,
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
  for (let i = t.iS; i <= t.iN; i++) assert.ok(10 - t.line[i].z >= t.need - 1e-6, `under the street at ${t.line[i].y}`);
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
