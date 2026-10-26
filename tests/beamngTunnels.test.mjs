import test from 'node:test';
import assert from 'node:assert/strict';

import {
  solveTunnel, chainTunnelParts, tunnelGroundAt, tunnelHoleAt, tunnelReach, nearestOnTunnel,
  buildTubeGeometry, buildPortalGeometry, buildTunnelObjects, hitsTunnel, isBoredTunnelTag,
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

test('only plain tunnel=yes ways are bored', () => {
  assert.equal(isBoredTunnelTag({ tunnel: 'yes' }), true);
  for (const v of ['building_passage', 'culvert', 'flooded', 'avalanche_protector', 'no', undefined]) {
    assert.equal(isBoredTunnelTag({ tunnel: v }), false, String(v));
  }
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

test('a road on flat ground is no tunnel; nor is a short one', () => {
  const flat = solveTunnel({ xy: road(-200, 200), half: 4 }, { groundAt: () => 10 });
  assert.equal(flat.ok, false);
  const short = solveTunnel({ xy: road(0, 12), half: 4 }, { groundAt: ridge });
  assert.equal(short.ok, false);
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

test('tunnel parts chain into paths; a fork is left out', () => {
  const a = { xy: [[0, 0], [10, 0]] }; const b = { xy: [[20, 0], [10, 0]] }; const c = { xy: [[20, 0], [30, 0]] };
  const { paths, branched } = chainTunnelParts([a, b, c]);
  assert.equal(paths.length, 1);
  assert.deepEqual(paths[0].xy.map((p) => p[0]), [0, 10, 20, 30]);
  const fork = chainTunnelParts([a, b, { xy: [[10, 0], [10, 10]] }]);
  assert.equal(fork.paths.length, 0);
  assert.equal(fork.branched.length, 1);
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
