// Where a road's mapped line lies across its lanes: OpenStreetMap's placement tags (thecoachtoma, 2026-11-25: "I hope
// you have placement/placement:forward/placement:backward handled"; his Kaunas junctions add turn lanes beside the
// line with them). Without them the line is the carriageway's middle, as MapNG always drew it.
//
// The tag (wiki Key:placement, Proposal:Placement): left_of:N, middle_of:N, right_of:N place the line on the left edge,
// the middle or the right edge of lane N, the lanes numbered from 1 at the left looking along the way. A two-way road
// takes placement:forward (its forward lanes, looking along the way) or placement:backward (its backward lanes,
// looking against it). placement:start / placement:end: the line moves from one to the other along the way.
// transition: the way's line runs across the lanes (forks, joins): no fixed place, left to the junction code.
//
// placementShift(tags, { half, extraShift, leftHand }) -> null, or { start, end } in metres: how far the carriageway's
// middle stands to the LEFT of the mapped line (looking along the way; negative: to its right), at the way's first and
// last node. half: the driving lanes' half width (the tag counts lanes only; a shoulder or parking strip is no lane);
// extraShift: the carriageway's middle left of the lanes' middle (left extras wider than right ones). Pure.

const LANE_W_M = 3.25;          // a lane's width when the lanes are not counted (only to count them)
const PLACE = /^\s*(left_of|middle_of|right_of)\s*:\s*(\d+)\s*$/;

const int = (v) => { const n = Number.parseInt(String(v ?? ''), 10); return Number.isFinite(n) && n > 0 ? n : null; };

/** The road's lanes: { forward, backward } (one-way: backward 0; against its way, oneway=-1: forward 0 is NOT used,
 * the lanes are counted along the way as the tag counts them). */
export function laneCounts(tags = {}, half = 3.5) {
  const oneway = ['yes', 'true', '1', '-1', 'reverse'].includes(String(tags.oneway ?? '').trim().toLowerCase())
    || ['roundabout', 'circular'].includes(String(tags.junction ?? '')) || ['motorway'].includes(String(tags.highway ?? '')) && tags.oneway !== 'no';
  const total = int(tags.lanes) || Math.max(oneway ? 1 : 2, Math.round((2 * half) / LANE_W_M));
  if (oneway) return { oneway: true, forward: total, backward: 0, total };
  let f = int(tags['lanes:forward']); let b = int(tags['lanes:backward']);
  if (f && !b) b = Math.max(1, total - f);
  if (b && !f) f = Math.max(1, total - b);
  if (!f) { f = Math.ceil(total / 2); b = Math.max(1, total - f); }
  return { oneway: false, forward: f, backward: b, total: f + b };
}

const parseWidths = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const parts = String(v).split('|').map((x) => Number.parseFloat(String(x).trim()));
  return parts.length && parts.every((w) => Number.isFinite(w) && w > 0.5 && w < 10) ? parts : null;
};

/**
 * The lanes across the road, left to right looking along the way: [{ dir: 'f' | 'b', idx, w }], idx each lane's number
 * in its own direction's count (forward lanes from the left looking along the way, backward ones from the left looking
 * against it). w from width:lanes (one-way, or a two-way road's lanes all listed along the way) or
 * width:lanes:forward / :backward (each listed from the left looking its own way); else null (per-lane widths not
 * mapped, or not one per lane). Right-hand traffic: the backward lanes to the left of the forward ones.
 */
export function laneWidthsAcross(tags = {}, lanes = null, leftHand = false, at = null) {
  const lc = lanes || laneCounts(tags);
  // (no end asked for, and the widths change along the way, :start / :end: the wider end, the road drawn as wide as its
  // widest and narrowed along the way, laneWidthsAlong)
  if (!at && hasAlongWidths(tags)) {
    const s = laneWidthsAcross(tags, lc, leftHand, 'start'); const e = laneWidthsAcross(tags, lc, leftHand, 'end');
    if (!s || !e) return s || e;
    return e.reduce((a, l) => a + l.w, 0) > s.reduce((a, l) => a + l.w, 0) ? e : s;
  }
  // (at one end: width:lanes:start, width:lanes:forward:start, ..., each falling back to its plain key)
  const tag = (key) => parseWidths(at && tags[`${key}:${at}`] !== undefined ? tags[`${key}:${at}`] : tags[key]);
  if (lc.oneway) {
    const w = tag('width:lanes') || tag('width:lanes:forward');
    return w && w.length === lc.total ? w.map((x, i) => ({ dir: 'f', idx: i + 1, w: x })) : null;
  }
  let f = tag('width:lanes:forward'); let b = tag('width:lanes:backward');
  const all = tag('width:lanes');
  if ((!f || !b) && all && all.length === lc.total) {
    // (listed along the way, left to right: right-hand traffic the backward lanes first)
    const left = leftHand ? lc.forward : lc.backward;
    const L = all.slice(0, left); const R = all.slice(left);
    if (leftHand) { f = L; b = [...R].reverse(); } else { b = [...L].reverse(); f = R; }
  }
  // (one direction mapped: the other's lanes as wide as the mapped ones on average)
  if (f && !b && f.length === lc.forward) { const m = f.reduce((a, x) => a + x, 0) / f.length; b = Array(lc.backward).fill(m); }
  if (b && !f && b.length === lc.backward) { const m = b.reduce((a, x) => a + x, 0) / b.length; f = Array(lc.forward).fill(m); }
  if (!f || !b || f.length !== lc.forward || b.length !== lc.backward) return null;
  const F = f.map((x, i) => ({ dir: 'f', idx: i + 1, w: x }));
  // (backward lane 1 is the leftmost looking against the way: the rightmost of its block looking along it)
  const B = b.map((x, i) => ({ dir: 'b', idx: i + 1, w: x })).reverse();
  return leftHand ? [...F, ...B] : [...B, ...F];
}

const ALONG_KEY = /^width:lanes(:forward|:backward)?:(start|end)$/;
const hasAlongWidths = (tags) => Object.keys(tags).some((k) => ALONG_KEY.test(k));

/**
 * Lane widths changing along the way (width:lanes:start / :end, and :forward / :backward with them; wiki Key:width:lanes:
 * the widths at the way's first and last node, varying in between, as placement:start / :end): { start, end }, each
 * laneWidthsAcross at that end, the same lanes at both; null when they are not mapped or do not differ.
 */
export function laneWidthsAlong(tags = {}, lanes = null, leftHand = false) {
  if (!hasAlongWidths(tags)) return null;
  const lc = lanes || laneCounts(tags);
  const start = laneWidthsAcross(tags, lc, leftHand, 'start'); const end = laneWidthsAcross(tags, lc, leftHand, 'end');
  if (!start || !end || start.length !== end.length) return null;
  if (start.every((l, i) => Math.abs(l.w - end[i].w) < 1e-3)) return null;
  return { start, end };
}

/** The lanes across at a share t of the way (0 its first node, 1 its last): each lane's width blended. */
export const laneWidthsAt = (along, t) => along.start.map((l, i) => ({ ...l, w: l.w + (along.end[i].w - l.w) * Math.max(0, Math.min(1, t)) }));

/**
 * The carriageway's middle relative to the mapped line (m, left of the way's direction positive) for one placement
 * value, or null. dir: 'all' (a one-way road, or plain placement on a two-way one: every lane counted along the way),
 * 'forward', 'backward'. across: the lanes left to right (laneWidthsAcross, or equal lanes over the driving width).
 */
function shiftFor(value, dir, across) {
  const m = PLACE.exec(String(value ?? ''));
  if (!m) return null;
  const n = Number(m[2]); const kind = m[1];
  let k = -1;
  if (dir === 'all') k = n - 1;
  else k = across.findIndex((l) => l.dir === (dir === 'forward' ? 'f' : 'b') && l.idx === n);
  if (k < 0 || k >= across.length) return null;
  let left = 0; for (let i = 0; i < k; i++) left += across[i].w;
  const right = left + across[k].w;
  // (looking against the way, its left is the way's right)
  const back = dir === 'backward';
  const x = kind === 'middle_of' ? (left + right) / 2 : (kind === 'left_of') !== back ? left : right;
  const W = across.reduce((a, l) => a + l.w, 0);
  return -(W / 2 - x);
}

/** How far the carriageway's middle stands left of the mapped line, at the way's start and end; null: in the middle. */
export function placementShift(tags = {}, { half = 3.5, extraShift = 0, leftHand = false } = {}) {
  const keys = Object.keys(tags).filter((k) => /^placement(:|$)/.test(k));
  if (!keys.length) return null;
  const lanes = laneCounts(tags, half);
  // (the lanes across: their mapped widths, else equal lanes over the driving width; at each end its own, the widths
  // changing along the way, width:lanes:start / :end)
  const equal = () => {
    const w = (2 * half) / lanes.total;
    const F = Array.from({ length: lanes.forward }, (_, i) => ({ dir: 'f', idx: i + 1, w }));
    const B = Array.from({ length: lanes.backward }, (_, i) => ({ dir: 'b', idx: i + 1, w })).reverse();
    return lanes.oneway ? F : leftHand ? [...F, ...B] : [...B, ...F];
  };
  const acrossAt = { start: laneWidthsAcross(tags, lanes, leftHand, 'start') || equal(), end: laneWidthsAcross(tags, lanes, leftHand, 'end') || equal() };
  const pick = (suffix, at) => {
    const across = acrossAt[at];
    // (two-way: forward first, then backward, then a plain placement counted over every lane)
    const cands = lanes.oneway
      ? [[`placement${suffix}`, 'all'], [`placement:forward${suffix}`, 'all']]
      : [[`placement:forward${suffix}`, 'forward'], [`placement:backward${suffix}`, 'backward'], [`placement${suffix}`, 'all']];
    for (const [k, dir] of cands) {
      if (tags[k] === undefined) continue;
      const s = shiftFor(tags[k], dir, across);
      if (s !== null) return s;
    }
    return null;
  };
  const start = pick(':start', 'start');
  const end = pick(':end', 'end');
  const a = start ?? pick('', 'start'); const b = end ?? pick('', 'end');
  if (a === null && b === null) return null;
  const s0 = a ?? b; const s1 = b ?? a;
  // (never past the carriageway's edge: a line outside its own road is a tagging slip)
  const lim = Math.max(half, ...[acrossAt.start, acrossAt.end].map((x) => x.reduce((a, l) => a + l.w, 0) / 2));
  const clamp = (v) => Math.max(-lim, Math.min(lim, v));
  // (the lanes' middle from the tag, then the carriageway's from the extras either side of the lanes)
  const out = { start: clamp(s0) + extraShift, end: clamp(s1) + extraShift };
  return Math.abs(out.start) < 1e-6 && Math.abs(out.end) < 1e-6 ? null : out;
}

/** The shift at a share t (0 at the way's first node, 1 at its last) of its length. */
export const placementShiftAt = (shift, t) => (shift ? shift.start + (shift.end - shift.start) * Math.max(0, Math.min(1, t)) : 0);
