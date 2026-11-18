// A map from a grid's pixel index to a number, in place of a Map where a pass edits pixels: the same answers in
// the same order, with no limit on how many.
//
// A Map holds at most 2^24 entries (about 16.7 million): carving a lake bed under a great lake at 8 km stopped
// there ("Map maximum size exceeded", the lake beds skipped) after 20 s of filling it. Here the values sit in
// tiles of the grid, made only where a pixel is set (float64: what a Map keeps), with a byte per pixel for
// whether it is set and the indices in the order first set (a Map's order: set again, a key keeps its place).
// get / has / set / size / keys() / entries / for...of as a Map's; no delete (none of the passes deletes).
const SHIFT = 16;                 // 65536 pixels a tile
const TILE = 1 << SHIFT;
const MASK = TILE - 1;

export class PixelEdits {
  constructor() {
    this.vals = new Map();        // tile → Float64Array
    this.isSet = new Map();       // tile → Uint8Array
    this.order = new Int32Array(1024);
    this.size = 0;
  }

  has(idx) {
    const s = this.isSet.get(idx >>> SHIFT);
    return !!s && s[idx & MASK] === 1;
  }

  get(idx) {
    const s = this.isSet.get(idx >>> SHIFT);
    return s && s[idx & MASK] === 1 ? this.vals.get(idx >>> SHIFT)[idx & MASK] : undefined;
  }

  set(idx, v) {
    const t = idx >>> SHIFT;
    let s = this.isSet.get(t); let vals;
    if (!s) { s = new Uint8Array(TILE); vals = new Float64Array(TILE); this.isSet.set(t, s); this.vals.set(t, vals); } else vals = this.vals.get(t);
    const j = idx & MASK;
    if (s[j] !== 1) {
      s[j] = 1;
      if (this.size === this.order.length) { const grown = new Int32Array(this.order.length * 2); grown.set(this.order); this.order = grown; }
      this.order[this.size++] = idx;
    }
    vals[j] = v;
    return this;
  }

  * keys() { for (let i = 0; i < this.size; i++) yield this.order[i]; }

  * entries() { for (let i = 0; i < this.size; i++) { const idx = this.order[i]; yield [idx, this.vals.get(idx >>> SHIFT)[idx & MASK]]; } }

  [Symbol.iterator]() { return this.entries(); }
}
