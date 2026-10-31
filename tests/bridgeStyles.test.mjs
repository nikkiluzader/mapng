import test from 'node:test';
import assert from 'node:assert/strict';
import { paintOf, typeOfTags, styleDecks, spansOf, inStyledSpan, buildStyleGeometry } from '../services/bridgeStyles.js';

// a straight part along x from x0 to x1 at road height z over flat ground at 0
const part = (x0, x1, y, z, extra = {}) => {
  const xy = []; for (let x = x0; x <= x1 + 1e-9; x += 2) xy.push([x, y]);
  return { xy, z: xy.map(() => z), half: 4, ...extra };
};
const flat = () => 0;
const builder = () => ({ pos: [], uv: [], tri(a, b, c) { this.pos.push(...a, ...b, ...c); this.uv.push(0, 0, 0, 0, 0, 0); }, quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); } });

test('paint and type from tags', () => {
  assert.equal(paintOf(''), 'grey');
  assert.equal(paintOf('Navy'), 'blue');
  assert.equal(paintOf('#f04a00'), 'orange', 'the Golden Gate');
  assert.equal(typeOfTags({ structure: 'truss' }), 'truss');
  assert.equal(typeOfTags({ structure: 'humpback' }), 'stoneArch');
  assert.equal(typeOfTags({ structure: 'beam' }), null, 'a beam bridge stays a plain deck');
  assert.equal(typeOfTags({}), null);
});

test('spans: the stretches clear of the ground, long enough', () => {
  const p = part(0, 100, 0, 10);
  p.z = p.xy.map(([x]) => (x < 20 || x > 80 ? 1 : 10));
  const sp = spansOf(p, flat);
  assert.equal(sp.length, 1);
  assert.ok(sp[0].s0 >= 18 && sp[0].s1 <= 82);
});

test('a type belongs to the parts in the tagged outline, not the whole deck with its ramps', () => {
  const bridge = part(0, 100, 0, 12);
  const ramp = part(100, 400, 0, 6);          // a long approach in the same deck
  const deck = { parts: [bridge, ramp] };
  const outline = { ring: [[-5, -20], [105, -20], [105, 20], [-5, 20]], tags: { man_made: 'bridge', 'bridge:structure': 'truss' } };
  assert.equal(styleDecks([deck], { outlines: [outline], groundAt: flat }), 1);
  assert.equal(deck.style.type, 'truss');
  assert.ok(deck.style.spans.every((sp) => sp.part === 0), 'spans on the bridge part only');
  assert.equal(deck.style.source, 'bridge outline');
});

test('a twin span (its own deck, side by side, about as long) shares the type; a ramp beside does not', () => {
  const a = { parts: [part(0, 100, 0, 12, { structure: 'arch' })] };
  const twin = { parts: [part(0, 100, 20, 12)] };
  const longRamp = { parts: [part(-200, 300, -15, 8)] };
  styleDecks([a, twin, longRamp], { groundAt: flat });
  assert.equal(twin.style?.type, 'arch');
  assert.equal(twin.style.source, 'twin');
  assert.equal(longRamp.style, undefined);
});

test('no piers inside a styled span; steel members stay outside the drawn lanes', () => {
  const p = part(0, 100, 0, 12, { structure: 'truss' });
  const deck = { parts: [p] };
  styleDecks([deck], { groundAt: flat });
  assert.equal(inStyledSpan(deck, 0, 50, 0), true);
  assert.equal(inStyledSpan({ parts: [p] }, 0, 50, 0), false, 'an unstyled deck keeps its piers');
  const g = buildStyleGeometry(deck, { groundAt: flat, newBuilder: builder });
  assert.ok(g.steel.pos.length > 0);
  // every steel vertex lower than 6.5 m over the road stands outside the lanes (|y| > half)
  for (let i = 0; i < g.steel.pos.length; i += 3) {
    const y = g.steel.pos[i + 1]; const z = g.steel.pos[i + 2];
    if (z < 12 + 6.4) assert.ok(Math.abs(y) > 4, `a member in the lanes at y ${y.toFixed(2)}, z ${z.toFixed(2)}`);
  }
});

test('stone arches under a low canal bridge: built, from the water up to just under the road', () => {
  const p = part(0, 14, 0, 2.6, { structure: 'humpback' });
  const deck = { parts: [p] };
  styleDecks([deck], { groundAt: flat });
  assert.equal(deck.style.type, 'stoneArch');
  const g = buildStyleGeometry(deck, { groundAt: flat, newBuilder: builder });
  assert.ok(g.stone.pos.length > 0, 'the vault and its spandrels');
  for (let i = 2; i < g.stone.pos.length; i += 3) assert.ok(g.stone.pos[i] <= 2.6 + 1e-6, 'nothing over the road');
});

test('a cable-stayed span: no pylon leg or stay low over the deck lanes (sampled along every member)', async () => {
  const { linkCrossings } = await import('../services/bridgeStyles.js');
  const p = part(0, 160, 0, 15, { structure: 'cable-stayed', half: 8 });
  const deck = { parts: [p] };
  styleDecks([deck], { groundAt: flat });
  linkCrossings([deck]);
  const segBuilder = () => ({ ...builder(), segments: [] });
  const g = buildStyleGeometry(deck, { groundAt: flat, newBuilder: segBuilder });
  assert.ok(g.cable.segments.length > 0 && g.concrete.segments.length > 0);
  // the lanes: |y| under the half width, 0..6.5 m over the road (a member's own width counted)
  for (const b of [g.cable, g.concrete]) {
    for (const [a, c, w] of b.segments) {
      for (let t = 0; t <= 1.0001; t += 0.02) {
        const y = a[1] + (c[1] - a[1]) * t; const z = a[2] + (c[2] - a[2]) * t;
        const inner = b === g.cable ? 8 - 1 : 8;   // a stay may cross the outermost metre (the edge strip) low
        if (Math.abs(y) < inner + w / 2 && z > 15 && z < 15 + 6.5) assert.fail(`a member over the lanes at y ${y.toFixed(2)}, z ${z.toFixed(2)}`);
      }
    }
  }
});

test('a crossing of two decks side by side: one pylon, nothing low over either deck\'s lanes', async () => {
  const { linkCrossings } = await import('../services/bridgeStyles.js');
  const main = { parts: [part(0, 200, 0, 15, { structure: 'cable-stayed', half: 8 })] };
  const side = { parts: [part(20, 180, -14, 15, { structure: 'cable-stayed', half: 4 })] };
  styleDecks([main, side], { groundAt: flat });
  assert.equal(linkCrossings([main, side]), 1);
  const segBuilder = () => ({ ...builder(), segments: [] });
  const gs = [main, side].map((d) => buildStyleGeometry(d, { groundAt: flat, newBuilder: segBuilder }));
  assert.equal(gs[1].concrete.segments.length + gs[1].cable.segments.length, 0, 'the side deck draws no pylon of its own');
  const lanes = [[0, 8], [-14, 4]];
  for (const b of [gs[0].cable, gs[0].concrete]) {
    for (const [a, c, w] of b.segments) {
      for (let t = 0; t <= 1.0001; t += 0.02) {
        const y = a[1] + (c[1] - a[1]) * t; const z = a[2] + (c[2] - a[2]) * t;
        for (const [cy, h] of lanes) if (Math.abs(y - cy) < h - (b === gs[0].cable ? 1 : 0) + w / 2 && z > 15 && z < 15 + 6.5) assert.fail(`over the lanes of the deck at y ${cy}: y ${y.toFixed(2)}, z ${z.toFixed(2)}`);
      }
    }
  }
});

test('pylon legs keep out of a plain deck alongside (higher) and a road under the bridge', async () => {
  const { linkCrossings } = await import('../services/bridgeStyles.js');
  const main = { parts: [part(0, 200, 0, 15, { structure: 'cable-stayed', half: 8 })] };
  const ramp = { parts: [part(0, 200, -20, 18, { half: 9 })] };          // a ramp 3 m higher, no type
  const low = { parts: [part(0, 200, 13, 8, { half: 3 })] };             // a ramp lower down right beside: the east leg steps past it
  const road = { xy: [[0, -40], [200, -40]], half: 4 };                   // a street under the west side
  styleDecks([main, ramp, low], { groundAt: flat });
  linkCrossings([main, ramp, low], { roads: [road] });
  const segBuilder = () => ({ ...builder(), segments: [] });
  const g = buildStyleGeometry(main, { groundAt: flat, newBuilder: segBuilder });
  const lanes = [[0, 8, 15], [-20, 9, 18], [-40, 4, 0], [13, 3, 8]];   // centre, half, road height
  for (const b of [g.cable, g.concrete]) {
    for (const [a, c, w] of b.segments) {
      for (let t = 0; t <= 1.0001; t += 0.02) {
        const y = a[1] + (c[1] - a[1]) * t; const z = a[2] + (c[2] - a[2]) * t;
        for (const [cy, h, zr] of lanes) {
          const strip = b === g.cable && cy === 0 ? 1 : 0;
          if (Math.abs(y - cy) < h - strip + w / 2 && z > zr - 1 && z < zr + 6.5) assert.fail(`in the lanes at y ${cy}: y ${y.toFixed(2)}, z ${z.toFixed(2)}`);
        }
      }
    }
  }
});

test('stays never land between two flush decks without a barrier: they land on one', async () => {
  const { linkCrossings } = await import('../services/bridgeStyles.js');
  const main = { parts: [part(0, 200, 0, 15, { structure: 'cable-stayed', half: 8 })] };
  const flushDeck = { parts: [part(0, 200, -13, 15, { half: 4.2 })] };   // edge to edge with the main deck
  styleDecks([main, flushDeck], { groundAt: flat });
  linkCrossings([main, flushDeck]);
  const segBuilder = () => ({ ...builder(), segments: [] });
  const g = buildStyleGeometry(main, { groundAt: flat, newBuilder: segBuilder });
  // the west stays' feet: on the barrier's top (1.1 m over the road), the barrier drawn under them
  const feet = g.cable.segments.map(([a]) => a).filter((a) => a[1] < 0);
  assert.ok(feet.length > 4);
  for (const f of feet) assert.ok(Math.abs(f[2] - 16.1) < 1e-6, `a stay landing at z ${f[2]}`);
  const barrier = g.concrete.segments.filter(([a, c, w, h]) => w === 0.45 && a[1] < 0);
  assert.ok(barrier.length > 20, `a barrier along the west edge: ${barrier.length}`);
  assert.equal(g.concrete.segments.filter(([a, c, w]) => w === 0.45 && a[1] > 0).length, 0, 'none on the open east edge');
});

test('a suspension span: towers clear of a ramp alongside, cables and hangers only over the deck edges', async () => {
  const { linkCrossings } = await import('../services/bridgeStyles.js');
  const main = { parts: [part(0, 400, 0, 20, { structure: 'suspension', half: 8 })] };
  const ramp = { parts: [part(0, 400, -14, 20, { half: 4 })] };   // flush on the west edge
  styleDecks([main, ramp], { groundAt: flat });
  linkCrossings([main, ramp]);
  const segBuilder = () => ({ ...builder(), segments: [] });
  const g = buildStyleGeometry(main, { groundAt: flat, newBuilder: segBuilder });
  assert.ok(g.cable.segments.length > 30);
  const lanes = [[0, 8], [-14, 4]];
  for (const b of [g.cable, g.concrete, g.steel]) {
    for (const [a, c, w] of b.segments) {
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const y = a[1] + (c[1] - a[1]) * t; const z = a[2] + (c[2] - a[2]) * t;
        for (const [cy, h] of lanes) if (Math.abs(y - cy) < h + w / 2 - 0.01 && z > 20 && z < 26.5) assert.fail(`over the lanes at y ${cy}: y ${y.toFixed(2)} z ${z.toFixed(2)}`);
      }
    }
  }
});

test('a higher deck overlapping the edge: the stays land where the main deck is open, never under it', async () => {
  const { linkCrossings } = await import('../services/bridgeStyles.js');
  const main = { parts: [part(0, 200, 0, 15, { structure: 'cable-stayed', half: 8 })] };
  const over = { parts: [part(0, 200, -14, 16.8, { half: 7 })] };   // its surface from y -21.4 to -6.6, 1.8 m higher
  styleDecks([main, over], { groundAt: flat });
  linkCrossings([main, over]);
  const segBuilder = () => ({ ...builder(), segments: [] });
  const g = buildStyleGeometry(main, { groundAt: flat, newBuilder: segBuilder });
  const feet = g.cable.segments.map(([a]) => a).filter((a) => a[1] < 0);
  assert.ok(feet.length > 4);
  for (const f of feet) assert.ok(f[1] > -6.6 && f[1] < -5, `a stay's foot at y ${f[1].toFixed(2)}`);
  // and nothing in the higher deck's lanes
  for (const b of [g.cable, g.concrete]) {
    for (const [a, c, w] of b.segments) {
      for (let t = 0; t <= 1.0001; t += 0.02) {
        const y = a[1] + (c[1] - a[1]) * t; const z = a[2] + (c[2] - a[2]) * t;
        if (Math.abs(y + 14) < 7 + w / 2 - 0.4 && z > 16.8 && z < 16.8 + 6.5) assert.fail(`in the higher deck's lanes: y ${y.toFixed(2)} z ${z.toFixed(2)}`);
      }
    }
  }
});

test('a neighbour widened at a join (its drawn half widths, not its lanes\' half) still keeps the stays off it', async () => {
  const { linkCrossings } = await import('../services/bridgeStyles.js');
  const main = { parts: [part(0, 200, 0, 15, { structure: 'cable-stayed', half: 8 })] };
  const over = part(0, 200, -14, 16.3, { half: 4 });
  over.halfL = over.xy.map(() => 7); over.halfR = over.xy.map(() => 7);   // drawn out to y -6.6
  styleDecks([main, { parts: [over] }], { groundAt: flat });
  linkCrossings([main, { parts: [over] }]);
  const segBuilder = () => ({ ...builder(), segments: [] });
  const g = buildStyleGeometry(main, { groundAt: flat, newBuilder: segBuilder });
  const feet = g.cable.segments.map(([a]) => a).filter((a) => a[1] < 0);
  for (const f of feet) assert.ok(f[1] > -6.6, `a stay's foot under the widened deck at y ${f[1].toFixed(2)}`);
});

test('a deck arch carries a thin slab (no girders in its vault); a truss keeps its deck', async () => {
  const { thinArchDecks } = await import('../services/bridgeStyles.js');
  const arch = { parts: [part(0, 14, 0, 2.6, { structure: 'humpback' })] };
  const truss = { parts: [part(0, 100, 0, 12, { structure: 'truss' })] };
  styleDecks([arch, truss], { groundAt: flat });
  assert.equal(thinArchDecks([arch, truss]), 1);
  assert.equal(arch.parts[0].depth, 0.5);
  assert.equal(truss.parts[0].depth, undefined);
});
