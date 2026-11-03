// A sidewalk strip's top as a row of panels, each clipped where an earlier
// strip or a curb cut has the ground (beamngSidewalks.js mergeWalks). Here so
// the same code runs in the page and, in the desktop app, on worker threads
// (panelsForItem): a work item carries a tile's strips and everything they
// need, and the triangles come back per strip, replayed in strip order.
import * as THREE from 'three';
import polygonClipping, { snapGeom } from './polyClip.js';

export const SLAB_TILE_M = 10;        // m of sidewalk to one unit of texture space, along and across alike
export const PANEL_SCRAP_M2 = 0.002;
const CROP_CELL = 32;
const CROP_PAD = 8;
const CUT_CELL = 16;
const cellKey = (cx, cy) => cx * 1048576 + cy;

export const ringArea = (ring) => ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;

export function pointInRing(x, y, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if ((r[i][1] > y) !== (r[j][1] > y) && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) inside = !inside;
  }
  return inside;
}

export function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a); const d2 = o(c, d, b); const d3 = o(a, b, c); const d4 = o(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  // (touching or collinear counts: the clip decides those)
  const on = (p, q, r) => Math.min(p[0], q[0]) <= r[0] && r[0] <= Math.max(p[0], q[0]) && Math.min(p[1], q[1]) <= r[1] && r[1] <= Math.max(p[1], q[1]);
  return (d1 === 0 && on(c, d, a)) || (d2 === 0 && on(c, d, b)) || (d3 === 0 && on(a, b, c)) || (d4 === 0 && on(a, b, d));
}

// a quad whose opposite sides do not cross (a panel at a hairpin can twist)
export function quadIsSimple(q) {
  return !segmentsCross(q[0], q[1], q[2], q[3]) && !segmentsCross(q[1], q[2], q[3], q[0]);
}

/**
 * Whether a closed ring and a polygon or multipolygon could share any area:
 * an edge of one crossing or touching an edge of the other, or one holding a
 * corner of the other. False only when they are surely apart.
 */
export function ringTouches(ring, geom) {
  const polys = typeof geom[0]?.[0]?.[0] === 'number' ? [geom] : geom;
  let rx0 = Infinity; let ry0 = Infinity; let rx1 = -Infinity; let ry1 = -Infinity;
  for (const p of ring) { rx0 = Math.min(rx0, p[0]); rx1 = Math.max(rx1, p[0]); ry0 = Math.min(ry0, p[1]); ry1 = Math.max(ry1, p[1]); }
  for (const poly of polys) {
    for (const other of poly) {
      if (!other.length) continue;
      if (pointInRing(ring[0][0], ring[0][1], other) || pointInRing(other[0][0], other[0][1], ring)) return true;
      for (let i = 0; i + 1 < other.length; i++) {
        const a = other[i]; const b = other[i + 1];
        if (Math.max(a[0], b[0]) < rx0 || Math.min(a[0], b[0]) > rx1 || Math.max(a[1], b[1]) < ry0 || Math.min(a[1], b[1]) > ry1) continue;
        for (let k = 0; k + 1 < ring.length; k++) if (segmentsCross(a, b, ring[k], ring[k + 1])) return true;
      }
    }
  }
  return false;
}

/**
 * Whether a simple quad and a polygon or multipolygon could share any area:
 * an edge of one crossing or touching an edge of the other, or one holding a
 * corner of the other. False only when they are surely apart (then clipping
 * the quad by it leaves the quad as it was).
 */
export function quadTouches(quad, geom) {
  const polys = typeof geom[0]?.[0]?.[0] === 'number' ? [geom] : geom;
  let qx0 = Infinity; let qy0 = Infinity; let qx1 = -Infinity; let qy1 = -Infinity;
  for (const p of quad) { qx0 = Math.min(qx0, p[0]); qx1 = Math.max(qx1, p[0]); qy0 = Math.min(qy0, p[1]); qy1 = Math.max(qy1, p[1]); }
  const quadRing = [...quad, quad[0]];
  for (const poly of polys) {
    for (const ring of poly) {
      if (!ring.length) continue;
      if (pointInRing(quad[0][0], quad[0][1], ring) || pointInRing(ring[0][0], ring[0][1], quadRing)) return true;
      for (let i = 0; i + 1 < ring.length; i++) {
        const a = ring[i]; const b = ring[i + 1];
        if (Math.max(a[0], b[0]) < qx0 || Math.min(a[0], b[0]) > qx1 || Math.max(a[1], b[1]) < qy0 || Math.min(a[1], b[1]) > qy1) continue;
        for (let k = 0; k < 4; k++) if (segmentsCross(a, b, quad[k], quad[(k + 1) % 4])) return true;
      }
    }
  }
  return false;
}

// texture coordinates on a strip, as a swept slab's: along its line, across its width
export function stripUv(strip, x, y) {
  let q = strip.along[0]; let d = Infinity;
  for (const o of strip.along) {
    const e = (o.x - x) ** 2 + (o.y - y) ** 2;
    if (e < d) { d = e; q = o; }
  }
  const on = (x - q.x) * q.tx + (y - q.y) * q.ty;
  const off = -(x - q.x) * q.ty + (y - q.y) * q.tx;
  return [(q.s + on) / SLAB_TILE_M, (off + strip.half) / SLAB_TILE_M];
}

/**
 * A strip's part around a panel: the strips cut once into padded cells
 * (cached). A panel inside its cell's padded box gets the same pieces as from
 * the whole strip; clipped against whole strips, hundreds of points each, a
 * city's walks took minutes.
 */
export function makeCropper() {
  const crops = new Map();
  return (o, x0, y0, x1, y1) => {
    const cx = Math.floor((x0 + x1) / 2 / CROP_CELL); const cy = Math.floor((y0 + y1) / 2 / CROP_CELL);
    const bx0 = cx * CROP_CELL - CROP_PAD; const by0 = cy * CROP_CELL - CROP_PAD;
    const bx1 = (cx + 1) * CROP_CELL + CROP_PAD; const by1 = (cy + 1) * CROP_CELL + CROP_PAD;
    // (a panel too big for its cell, or a strip inside it: the whole strip)
    if (x0 < bx0 || y0 < by0 || x1 > bx1 || y1 > by1) return o.shape;
    if (o.box[0] >= bx0 && o.box[1] >= by0 && o.box[2] <= bx1 && o.box[3] <= by1) return o.shape;
    let byCell = crops.get(o);
    if (!byCell) crops.set(o, (byCell = new Map()));
    const k = cellKey(cx, cy);
    if (!byCell.has(k)) {
      let piece;
      try { piece = polygonClipping.intersection(o.shape, [[[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1], [bx0, by0]]]); } catch { piece = o.shape; }
      byCell.set(k, piece);
    }
    return byCell.get(k);
  };
}

/** The curb cuts ({ shape, box, cut }) overlapping a box, in a grid of cells (their order as given). */
export function makeCutFinder(cutRings) {
  const cutGrid = new Map();
  for (const c of cutRings) {
    for (let gx = Math.floor(c.box[0] / CUT_CELL); gx <= Math.floor(c.box[2] / CUT_CELL); gx++) {
      for (let gy = Math.floor(c.box[1] / CUT_CELL); gy <= Math.floor(c.box[3] / CUT_CELL); gy++) {
        const key = `${gx},${gy}`;
        if (!cutGrid.has(key)) cutGrid.set(key, []);
        cutGrid.get(key).push(c);
      }
    }
  }
  return (x0, y0, x1, y1) => {
    const found = new Set();
    for (let gx = Math.floor(x0 / CUT_CELL); gx <= Math.floor(x1 / CUT_CELL); gx++) {
      for (let gy = Math.floor(y0 / CUT_CELL); gy <= Math.floor(y1 / CUT_CELL); gy++) {
        for (const c of cutGrid.get(`${gx},${gy}`) || []) if (c.box[0] <= x1 && x0 <= c.box[2] && c.box[1] <= y1 && y0 <= c.box[3]) found.add(c);
      }
    }
    return [...found];
  };
}

/** The walk height station nearest (x, y) in a map of cells ("cx,cy" -> [[x, y, top, ground]]), or null. */
export function makeLevelFinder(stations, cell) {
  return (x, y) => {
    const cx = Math.floor(x / cell); const cy = Math.floor(y / cell);
    let best = null; let d = Infinity;
    for (let r = 2; r <= 8 && !best; r += 3) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          for (const q of stations.get(`${cx + dx},${cy + dy}`) || []) {
            const e = (q[0] - x) ** 2 + (q[1] - y) ** 2;
            if (e < d) { d = e; best = q; }
          }
        }
      }
    }
    return best;
  };
}
// (how far makeLevelFinder looks: its widest ring of cells)
export const LEVEL_REACH_CELLS = 8;

/**
 * One strip's top (not a pocket's): tri(a, b, c, uvA, uvB, uvC) per
 * triangle, corners [x, y, z]. ctx: { before: the earlier strips overlapping
 * it, in order; cutsNear(x0, y0, x1, y1); cropNear(o, x0, y0, x1, y1);
 * levelAt(x, y) }.
 */
export function stripPanels(strip, ctx, tri) {
  const { before, cutsNear, cropNear, levelAt } = ctx;
  const isEmpty = (geom) => !geom.length;
  const level = (x, y) => { const q = levelAt(x, y); return [x, y, q ? q[2] : 0]; };
  const flatTri = (a, b, c) => {
    // (a cut can leave a piece with no area: nothing to draw)
    if (Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) < 1e-4) return;
    tri(a, b, c, stripUv(strip, ...a), stripUv(strip, ...b), stripUv(strip, ...c));
  };
  // a row of panels down the strip, cut only where another strip has the ground:
  // triangulating a whole long outline left slivers the game can't shade
  for (let k = 0; k + 1 < strip.left.length; k++) {
    const panel = [strip.left[k], strip.left[k + 1], strip.right[k + 1], strip.right[k]];
    const xs = panel.map((q) => q[0]); const ys = panel.map((q) => q[1]);
    const x0 = Math.min(...xs); const x1 = Math.max(...xs); const y0 = Math.min(...ys); const y1 = Math.max(...ys);
    // (and the road inside a rounded curb kept clear: the cuts)
    const near = [...before.filter((o) => o.box[0] <= x1 && o.box[2] >= x0 && o.box[1] <= y1 && o.box[3] >= y0), ...cutsNear(x0, y0, x1, y1)];
    if (!near.length && !strip.piece) {
      const [a, b, c, d] = panel.map(([x, y]) => level(x, y));
      flatTri(a, b, c); flatTri(a, c, d);
      continue;
    }
    // (polygon-clipping fails now and then on near-touching edges: rounded to
    // the centimetre, then without the corner cuts, then the whole panel;
    // one failure dropped the merge for the whole town)
    let panelShape = [[[...panel, panel[0]]]];
    // (a piece of a cut strip: only its own part of each panel, or every
    // piece drew the whole strip again over the others)
    if (strip.piece) {
      // (a panel clear of this piece's box has no part of it: every piece
      // of a cut strip walks all of the strip's panels)
      if (x1 < strip.box[0] || x0 > strip.box[2] || y1 < strip.box[1] || y0 > strip.box[3]) continue;
      let own = null;
      const mine = cropNear(strip, x0, y0, x1, y1);
      try { own = isEmpty(mine) ? [] : polygonClipping.intersection(panelShape, mine); } catch { try { own = polygonClipping.intersection(snapGeom(panelShape), snapGeom(strip.shape)); } catch { /* whole panel */ } }
      if (own && !own.length) continue;
      if (own) panelShape = own;
    }
    // (only shapes that really reach the panel: one near it by box alone
    // leaves it as it was, and each clip made garbage that, held over a
    // city's gigabytes, the collector spent most of its time on)
    const simple = quadIsSimple(panel);
    const nearShapes = near.map((o) => ({ cut: o.cut, geom: o.cut ? o.shape : cropNear(o, x0, y0, x1, y1) }))
      .filter((n) => !isEmpty(n.geom) && (!simple || quadTouches(panel, n.geom)));
    let pieces = nearShapes.length ? null : panelShape;
    for (const attempt of [() => polygonClipping.difference(panelShape, ...nearShapes.map((n) => n.geom)),
      () => polygonClipping.difference(snapGeom(panelShape), ...nearShapes.map((n) => snapGeom(n.geom))),
      () => polygonClipping.difference(snapGeom(panelShape), ...nearShapes.filter((n) => !n.cut).map((n) => snapGeom(n.geom)))]) {
      if (pieces) break;
      try { pieces = attempt(); } catch { /* next */ }
    }
    if (!pieces) pieces = panelShape;
    // (only scraps of nothing dropped: pieces under a sixteenth of a square
    // metre went too, some 900 holes through the walks across a town)
    pieces = pieces.filter((piece) => Math.abs(ringArea(piece[0])) >= PANEL_SCRAP_M2);
    for (const piece of pieces) {
      const rings = piece.map((ring) => ring.slice(0, -1));
      const flat = rings.map((ring) => ring.map(([x, y]) => new THREE.Vector2(x, y)));
      const all = rings.flat().map(([x, y]) => level(x, y));
      for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(flat[0], flat.slice(1))) flatTri(all[a], all[b], all[c]);
    }
  }
}

// (per triangle in a worker's result: three corners, then their three uvs)
export const PANEL_TRI_FLOATS = 15;

/**
 * A worker's work item: a tile's strips with all they need.
 *   item: { strips: [{ rank, shape, left, right, along, half, box, piece }],
 *           own: [rank], before: { rank: [rank] }, cuts: [{ shape, box, cut }],
 *           stations: [[key, points]], cell }
 * Resolves [[rank, Float64Array of triangles]] for the own strips.
 */
export function panelsForItem(item) {
  const byRank = new Map(item.strips.map((s) => [s.rank, s]));
  const ctxBase = {
    cutsNear: makeCutFinder(item.cuts),
    cropNear: makeCropper(),
    levelAt: makeLevelFinder(new Map(item.stations), item.cell),
  };
  const out = [];
  for (const rank of item.own) {
    const strip = byRank.get(rank);
    const tris = [];
    stripPanels(strip, { ...ctxBase, before: (item.before[rank] || []).map((r) => byRank.get(r)) },
      (a, b, c, ua, ub, uc) => { tris.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]); });
    out.push([rank, Float64Array.from(tris)]);
  }
  return out;
}
