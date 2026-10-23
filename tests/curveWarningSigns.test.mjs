import test from 'node:test';
import assert from 'node:assert/strict';

import { findCurves, placeCurveWarnings, CURVE_SIGN_SETS } from '../services/curveWarningSigns.js';
import { placeBollards } from '../services/bollards.js';
import { BOLLARD_SHAPES } from '../services/beamngPropLibrary.js';

// A road at 2 m spacing: straight, an arc of `radius` turning `deg` (left if
// positive), then straight again.
function roadWithArc(radius, deg, { straight = 120, then = null } = {}) {
  const pts = [];
  let x = 0; let y = 0; let h = 0;
  const step = (len) => { for (let s = 0; s < len; s += 2) { pts.push([x, y, 0]); x += 2 * Math.cos(h); y += 2 * Math.sin(h); } };
  const arc = (r, d) => { const n = Math.round((Math.abs(d) * Math.PI / 180 * r) / 2); for (let i = 0; i < n; i++) { pts.push([x, y, 0]); x += 2 * Math.cos(h); y += 2 * Math.sin(h); h += (2 / r) * Math.sign(d); } };
  step(straight); arc(radius, deg);
  if (then) { step(then.gap); arc(then.radius, then.deg); }
  step(straight);
  pts.push([x, y, 0]);
  return pts;
}
const cw = (nodes, tags = { highway: 'tertiary' }) => ({ owner: 1, half: 3.5, highway: tags.highway, tags, nodes });
const place = (carriageways, style = 'americas') => placeCurveWarnings({ carriageways, heightAt: () => 0, style });

test('curves are found where the road turns sharply, not on gentle bends', () => {
  const sharp = findCurves(roadWithArc(50, 90));
  assert.equal(sharp.length, 1);
  assert.ok(Math.abs(sharp[0].radius - 50) < 8, `radius ~50 m: ${sharp[0].radius.toFixed(1)}`);
  assert.ok(sharp[0].turn > 1.3, 'turning left ~90°');
  assert.equal(findCurves(roadWithArc(400, 30)).length, 0, 'a 400 m bend is no curve to warn of');
  assert.equal(findCurves(roadWithArc(100, 20)).length, 0, 'a 20° kink is not either');
});

test('a sharp curve: an advance warning each way and chevrons on its outside', () => {
  const { props, counts } = place([cw(roadWithArc(50, 90))]);
  assert.equal(counts.curveLeft, 1, 'travelling along the road it curves left');
  assert.equal(counts.curveRight, 1, 'and right the other way');
  assert.ok(counts.chevronLeft >= 3 && counts.chevronRight >= 3, 'a 50 m radius gets chevrons both ways');
  const sign = props.find((p) => p.kind === 'curveLeft');
  assert.equal(sign.shape, CURVE_SIGN_SETS.americas.curveLeft);
  // the curve reads as starting a few metres before the arc (curvature is measured over ±10 m)
  assert.ok(Math.abs(sign.position[0] - 70) < 7 && Math.abs(sign.position[1] + 5) < 0.6, `~50 m before the curve, on the right kerb: ${sign.position}`);
  assert.ok(Math.abs(sign.yaw - Math.atan2(-1, 0)) < 1e-6, 'facing the traffic heading east');
  // chevrons of a left curve stand outside it: to the right of travel (south / east of the arc centre)
  for (const c of props.filter((p) => p.kind === 'chevronLeft')) {
    const d = Math.hypot(c.position[0] - 120, c.position[1] - 50);
    assert.ok(d > 50 + 3, `outside the arc: ${d.toFixed(1)} m from its centre`);
  }
});

test('an S-bend is a reverse curve; residential streets and slow roads get nothing', () => {
  const s = roadWithArc(60, 70, { then: { gap: 40, radius: 60, deg: -70 } });
  const { counts, props } = place([cw(s)], 'white');
  // an S-bend turned round is still left-then-right: a left reverse curve both ways
  assert.equal(counts.reverseLeft, 2);
  assert.ok(props.filter((p) => p.kind === 'reverseLeft').every((p) => p.shape === CURVE_SIGN_SETS.white.reverseLeft));
  assert.equal(place([cw(roadWithArc(50, 90), { highway: 'residential' })]).props.length, 0);
  assert.equal(place([cw(roadWithArc(50, 90), { highway: 'tertiary', maxspeed: '25 mph' })]).props.length, 0);
  assert.equal(place([cw(roadWithArc(50, 90), { highway: 'tertiary', oneway: 'yes' })]).counts.curveRight, undefined, 'one-way: one direction only');
});

test('bollards: steel by default, concrete where mapped, none on a drawn road', () => {
  const node = (x, tags) => ({ type: 'street_furniture', geometry: [{ lat: 0, lng: x }], tags: { barrier: 'bollard', ...tags } });
  const { bollards, skipped } = placeBollards({
    features: [node(1, {}), node(2, { material: 'concrete' }), node(3, {}), { type: 'street_furniture', geometry: [{ lat: 0, lng: 4 }], tags: { amenity: 'bench' } }],
    toWorld: (lat, lng) => [lng, lat], heightAt: () => 5, onDrawnRoad: (x) => x === 3,
  });
  assert.equal(bollards.length, 2);
  assert.equal(bollards[0].shape, BOLLARD_SHAPES.steel.shapeFile);
  assert.equal(bollards[1].shape, BOLLARD_SHAPES.concrete.shapeFile);
  assert.equal(bollards[0].position[2], 5);
  assert.equal(skipped.onRoad, 1);
});
