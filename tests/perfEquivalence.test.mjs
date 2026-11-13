import test from 'node:test';
import assert from 'node:assert/strict';
import { makePolygon } from '../services/beamngWater.js';
import { buildCarriagewayIndex, isOnOtherCarriageway, carriagewaysAt } from '../services/roadMarkingCuts.js';

// the plain even-odd test the banded one must agree with, point for point
const plain = (x, y, ring) => { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i]; const [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside; } return inside; };
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

test('a long outline answers every point as the plain even-odd test does', () => {
  for (const n of [5, 23, 24, 25, 200, 3000]) {
    // a wobbly ring with flat runs, repeated heights and a closing point: the cases bands could get wrong
    const ring = Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; const r = 100 + 40 * Math.sin(a * 7) + (i % 9 === 0 ? 0 : rnd() * 15); return [Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a) / 3) * 3]; });
    ring.push([...ring[0]]);
    const hole = ring.map(([x, y]) => [x * 0.3 + 5, y * 0.3]);
    const poly = makePolygon(ring, [hole]);
    let checked = 0;
    for (let k = 0; k < 6000; k++) {
      // (many on the outline's own heights and vertices, where an edge's end decides)
      const v = ring[Math.floor(rnd() * ring.length)];
      const x = k % 3 === 0 ? v[0] : (rnd() - 0.5) * 340; const y = k % 2 === 0 ? v[1] : (rnd() - 0.5) * 340;
      const want = x >= poly.box[0] && x <= poly.box[2] && y >= poly.box[1] && y <= poly.box[3] && plain(x, y, ring) && !plain(x, y, hole);
      assert.equal(poly.contains(x, y), want, `n=${n} at ${x}, ${y}`); checked++;
    }
    assert.equal(checked, 6000);
  }
});

test('the carriageway index finds the same roads with numbers for its cells, far from the origin too', () => {
  const ways = [];
  for (let i = 0; i < 60; i++) { const x = (rnd() - 0.5) * 9000; const y = (rnd() - 0.5) * 9000; const a = rnd() * 6.28; ways.push({ owner: i, half: 3 + rnd() * 4, nodes: [[x, y, 1, 0], [x + Math.cos(a) * 80, y + Math.sin(a) * 80, 2, 0], [x + Math.cos(a) * 160 + 10, y + Math.sin(a) * 160, 3, 0]] }); }
  const index = buildCarriagewayIndex(ways);
  const brute = (x, y, margin, ignore) => index.segments.some((s) => { if (ignore(s.owner)) return false; const dx = s.bx - s.ax, dy = s.by - s.ay, len = dx * dx + dy * dy; const t = len > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / len)) : 0; const ex = s.ax + t * dx - x, ey = s.ay + t * dy - y; const reach = s.half + margin; return ex * ex + ey * ey < reach * reach; });
  let hits = 0;
  for (let k = 0; k < 4000; k++) {
    const w = ways[Math.floor(rnd() * ways.length)]; const n = w.nodes[Math.floor(rnd() * 3)];
    const x = n[0] + (rnd() - 0.5) * 30; const y = n[1] + (rnd() - 0.5) * 30; const ignore = (o) => o === (k % 5 === 0 ? w.owner : -1);
    const got = isOnOtherCarriageway(index, x, y, 0.5, ignore);
    assert.equal(got, brute(x, y, 0.5, ignore), `at ${x}, ${y}`); if (got) hits++;
    assert.equal(carriagewaysAt(index, x, y, 0.5).length > 0, brute(x, y, 0.5, () => false));
  }
  assert.ok(hits > 200, `only ${hits} hits: the test would not notice a broken index`);
});
