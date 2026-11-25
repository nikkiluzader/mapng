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

// (a placement value -> the line's distance from the left edge of the lanes it counts, in lane widths)
function along(value) {
  const m = PLACE.exec(String(value ?? ''));
  if (!m) return null;
  const n = Number(m[2]);
  return (n - 1) + (m[1] === 'left_of' ? 0 : m[1] === 'middle_of' ? 0.5 : 1);
}

/**
 * The carriageway's middle relative to the mapped line (m, left of the way's direction positive) for one placement
 * value, or null. dir: 'all' (a one-way road, or plain placement on a two-way one: every lane counted along the way),
 * 'forward', 'backward'.
 */
function shiftFor(value, dir, lanes, half, leftHand) {
  const p = along(value);
  if (p === null) return null;
  const w = (2 * half) / lanes.total;
  const W = 2 * half;
  // y: the line's place across the carriageway, left of its middle positive (looking along the way)
  let y;
  if (dir === 'all') {
    if (p > lanes.total) return null;
    y = W / 2 - p * w;
  } else if (dir === 'forward') {
    if (p > lanes.forward) return null;
    // (right-hand traffic: the backward lanes to the left of the forward ones, looking along the way)
    const before = leftHand ? 0 : lanes.backward;
    y = W / 2 - (before + p) * w;
  } else {
    if (p > lanes.backward) return null;
    // (looking against the way: its left is the way's right; the forward lanes come first in right-hand traffic)
    const before = leftHand ? 0 : lanes.forward;
    y = -(W / 2 - (before + p) * w);
  }
  return -y;
}

/** How far the carriageway's middle stands left of the mapped line, at the way's start and end; null: in the middle. */
export function placementShift(tags = {}, { half = 3.5, extraShift = 0, leftHand = false } = {}) {
  const keys = Object.keys(tags).filter((k) => /^placement(:|$)/.test(k));
  if (!keys.length) return null;
  const lanes = laneCounts(tags, half);
  const pick = (suffix) => {
    // (two-way: forward first, then backward, then a plain placement counted over every lane)
    const cands = lanes.oneway
      ? [[`placement${suffix}`, 'all'], [`placement:forward${suffix}`, 'all']]
      : [[`placement:forward${suffix}`, 'forward'], [`placement:backward${suffix}`, 'backward'], [`placement${suffix}`, 'all']];
    for (const [k, dir] of cands) {
      if (tags[k] === undefined) continue;
      const s = shiftFor(tags[k], dir, lanes, half, leftHand);
      if (s !== null) return s;
    }
    return null;
  };
  const plain = pick('');
  const start = pick(':start');
  const end = pick(':end');
  const a = start ?? plain; const b = end ?? plain;
  if (a === null && b === null) return null;
  const s0 = a ?? b; const s1 = b ?? a;
  // (never past the carriageway's edge: a line outside its own road is a tagging slip)
  const clamp = (v) => Math.max(-half, Math.min(half, v));
  // (the lanes' middle from the tag, then the carriageway's from the extras either side of the lanes)
  const out = { start: clamp(s0) + extraShift, end: clamp(s1) + extraShift };
  return Math.abs(out.start) < 1e-6 && Math.abs(out.end) < 1e-6 ? null : out;
}

/** The shift at a share t (0 at the way's first node, 1 at its last) of its length. */
export const placementShiftAt = (shift, t) => (shift ? shift.start + (shift.end - shift.start) * Math.max(0, Math.min(1, t)) : 0);
