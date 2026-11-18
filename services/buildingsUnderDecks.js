// Buildings a raised deck runs over: kept under it. Nothing here knows about any place.
//
// A railway viaduct through a city has buildings mapped in its arches and a station under its tracks; a road
// viaduct has sheds and shops under it. Built to their usual height they stood up through the deck, the track
// running through their walls (London Bridge's viaduct and station). A building a deck's middle line runs over for
// THROUGH_MIN_M or more is held to the room under that deck: its height capped, its roof flat; where there is no
// room for a storey it is left out (the deck's own structure stands there).
import { fastHypot } from './fastMath.js';

const THROUGH_MIN_M = 3;      // the deck's line inside the footprint for at least this long
const ROOM_MIN_M = 2.5;       // less room than this under the deck: no building
const CLEAR_M = 0.3;          // the roof this far under the deck's underside
const STEP_M = 1;
const LEVEL_M = 3;

const inRing = (x, y, g) => {
  let k = false;
  for (let i = 0, j = g.length - 1; i < g.length; j = i++) {
    if (((g[i][1] > y) !== (g[j][1] > y)) && (x < ((g[j][0] - g[i][0]) * (y - g[i][1])) / (g[j][1] - g[i][1]) + g[i][0])) k = !k;
  }
  return k;
};
const metres = (v) => { const n = Number.parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

/**
 * buildings: features ({ tags, geometry: [{ lat, lng }] }); decks: [{ xy: [[x, y]], z: [underside's world z per
 * point] }]; toXY(p) -> [x, y]; groundAt(x, y). Returns { replace: Map(feature -> its copy, held under the deck, or
 * a copy of type 'under_deck' where it is left out), capped, left }.
 */
export function buildingsUnderDecks(buildings = [], decks = [], { toXY, groundAt }) {
  const replace = new Map(); let capped = 0; let left = 0;
  const lines = decks.filter((d) => d?.xy?.length > 1 && d.z?.length === d.xy.length).map((d) => {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const [x, y] of d.xy) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return { ...d, box: [x0, y0, x1, y1] };
  });
  if (!lines.length) return { replace, capped, left };
  for (const f of buildings) {
    if (!(f?.geometry?.length > 2)) continue;
    const g = f.geometry.map(toXY);
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const [x, y] of g) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    let under = Infinity;
    for (const d of lines) {
      if (d.box[0] > x1 || d.box[2] < x0 || d.box[1] > y1 || d.box[3] < y0) continue;
      let through = 0; let low = Infinity;
      for (let i = 0; i + 1 < d.xy.length; i++) {
        const [ax, ay] = d.xy[i]; const [bx, by] = d.xy[i + 1]; const L = fastHypot(bx - ax, by - ay);
        if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(ay, by) < y0 || Math.min(ay, by) > y1) continue;
        const n = Math.max(1, Math.ceil(L / STEP_M));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          if (inRing(ax + (bx - ax) * t, ay + (by - ay) * t, g)) { through += L / n; low = Math.min(low, d.z[i] + (d.z[i + 1] - d.z[i]) * t); }
        }
      }
      if (through >= THROUGH_MIN_M) under = Math.min(under, low);
    }
    if (!Number.isFinite(under)) continue;
    const tags = f.tags || {};
    const base = Math.min(...g.map(([x, y]) => groundAt(x, y))) + (metres(tags.min_height) || 0);
    const room = under - CLEAR_M - base;
    // (a building that starts above the deck: a hall over the tracks, left as mapped)
    if (room < 0 && (metres(tags.min_height) || 0) > 0) continue;
    if (room < ROOM_MIN_M) { replace.set(f, { ...f, type: 'under_deck' }); left++; continue; }
    const levels = metres(tags['building:levels'] ?? tags.levels);
    const own = metres(tags.height) ?? (levels ? levels * LEVEL_M + (metres(tags['roof:height']) || 0) : null);
    if (own != null && own - (metres(tags.min_height) || 0) <= room) continue;
    const t = { ...tags, height: String(Math.round((room + (metres(tags.min_height) || 0)) * 10) / 10), 'roof:shape': 'flat' };
    for (const k of ['building:levels', 'levels', 'roof:levels', 'roof:height']) delete t[k];
    replace.set(f, { ...f, tags: t }); capped++;
  }
  return { replace, capped, left };
}
