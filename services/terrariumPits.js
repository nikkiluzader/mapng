// ── Small pits in the sea beside a coast ─────────────────────────────────────
//
// A lighter blend than the ones above: single pixels of the 30 m source dragged 60 to 115 m down, drawn
// into the z15 tiles as round pits about 8 pixels across, a string of them along a shore (21 in one
// kilometre of Sint Eustatius's harbour, the user's test, 2026-11-13: dark round holes in the sea, and a
// level whose lowest point is -114 m for a harbour 2 m deep). The 5x5 test misses them (the pit is wider
// than the window, so its own neighbourhood is pit) and at 60 m they are under its 150 m anyway; the same
// pixels are in the lower zooms. They are filled from the ground around them: a pixel well under sea level
// with nearly the whole ring around it at least 20 m higher is a hole no 30 m survey has for real (a
// drowned valley or a dredged channel is low along its own line, so the ring is not all higher).
const SMALL_PIT_BELOW_M = -15;
const SMALL_PIT_DROP_M = 20;
const SMALL_PIT_RINGS = [12, 8];
const SMALL_PIT_APRON_PX = 6;
const SMALL_PIT_APRON_DROP_M = 3;
const PIT_RING = Array.from({ length: 16 }, (_, k) => [Math.cos((k * Math.PI) / 8), Math.sin((k * Math.PI) / 8)]);

/** Fill small round pits under sea level from the ground around them (in place). Returns the pixels changed. */
export const fillSmallSeaPits = (heights, size = 256, NO_DATA_VALUE = -99999) => {
  const ring = (x, y, r, skip) => {
    const out = [];
    for (const [dx, dy] of PIT_RING) {
      const xx = Math.round(x + dx * r); const yy = Math.round(y + dy * r);
      if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
      const v = heights[yy * size + xx];
      if (v !== NO_DATA_VALUE && !(skip && skip[yy * size + xx])) out.push(v);
    }
    return out;
  };
  const found = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const h = heights[y * size + x];
    if (h === NO_DATA_VALUE || h >= SMALL_PIT_BELOW_M) continue;
    for (const r of SMALL_PIT_RINGS) {
      const s = ring(x, y, r, null);
      if (s.length < 10) continue;
      let high = 0; for (const v of s) if (v > h + SMALL_PIT_DROP_M) high++;
      if (high >= s.length - 1) { found.push(y * size + x); break; }
    }
  }
  if (!found.length) return 0;
  // the pit and its apron (the dent's sloping sides): everything there under the ground around goes up to it
  const zone = new Uint8Array(size * size);
  for (const i of found) {
    const x = i % size; const y = Math.floor(i / size);
    for (let j = Math.max(0, y - SMALL_PIT_APRON_PX); j <= Math.min(size - 1, y + SMALL_PIT_APRON_PX); j++)
      for (let k = Math.max(0, x - SMALL_PIT_APRON_PX); k <= Math.min(size - 1, x + SMALL_PIT_APRON_PX); k++) zone[j * size + k] = 1;
  }
  const edits = [];
  for (let i = 0; i < zone.length; i++) {
    if (!zone[i] || heights[i] === NO_DATA_VALUE) continue;
    const s = ring(i % size, Math.floor(i / size), 14, zone);
    if (s.length < 6) continue;
    s.sort((p, q) => p - q);
    const med = s[s.length >> 1];
    if (heights[i] < med - SMALL_PIT_APRON_DROP_M) edits.push([i, med]);
  }
  for (const [i, v] of edits) heights[i] = v;
  return edits.length;
};

/** Whether a tile has such a pit (the cheap half of fillSmallSeaPits: stops at the first). */
export const hasSmallSeaPit = (heights, size = 256, NO_DATA_VALUE = -99999) => {
  for (let y = 0; y < size; y += 2) for (let x = 0; x < size; x += 2) {
    const h = heights[y * size + x];
    if (h === NO_DATA_VALUE || h >= SMALL_PIT_BELOW_M) continue;
    for (const r of SMALL_PIT_RINGS) {
      let n = 0; let high = 0;
      for (const [dx, dy] of PIT_RING) {
        const xx = Math.round(x + dx * r); const yy = Math.round(y + dy * r);
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const v = heights[yy * size + xx]; if (v === NO_DATA_VALUE) continue;
        n++; if (v > h + SMALL_PIT_DROP_M) high++;
      }
      if (n >= 10 && high >= n - 1) return true;
    }
  }
  return false;
};
